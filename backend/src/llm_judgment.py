"""
The only place in the codebase that calls (or simulates calling) an LLM.

Everywhere else in the pipeline - compliance gates, retry scheduling,
decline-code lookups, financial math - is deterministic on purpose: those
decisions need to be guaranteed, reproducible, and cheap to audit, and an
LLM would make them slower, non-deterministic, and harder to prove correct
without actually being better at them.

The three calls made here are the places where the input is genuinely
unstructured or ambiguous and a rule table would either be wrong or would
just be re-implementing language understanding badly:

  1. diagnose_ambiguous_payment - reasoning over a *pattern* of repeated,
     unhelpful decline codes (does this look like patience-needed or
     risk-needed?)
  2. classify_reply_intent - reading a free-text customer reply on an
     overdue invoice (promise to pay? dispute? hardship?)
  3. draft_message - writing the actual outreach copy, in tone and
     (optionally) in Hinglish

If GEMINI_API_KEY is set in the environment, these call the real Gemini
API. Otherwise they fall back to a heuristic that mimics the *shape* of
the judgment call so the pipeline still runs end to end offline. Every
fallback result is tagged `llm_fallback_heuristic` in the audit trail so
it is never confused with a real model call.
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request

from .models import DiagnosisMethod, RiskEvent

API_KEY = os.environ.get("GEMINI_API_KEY")
API_URL_TEMPLATE = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
MODEL = "gemini-3.7-flash"   # current stable/GA Gemini Flash model as of writing - check
                             # ai.google.dev/gemini-api/docs/models before relying on this long-term


def _call_gemini(system: str, user: str, max_tokens: int = 400) -> str | None:
    if not API_KEY:
        return None
    body = json.dumps({
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {"maxOutputTokens": max_tokens},
    }).encode()
    req = urllib.request.Request(
        API_URL_TEMPLATE.format(model=MODEL), data=body,
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": API_KEY,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read())
        candidates = data.get("candidates", [])
        if not candidates:
            return None
        parts = candidates[0].get("content", {}).get("parts", [])
        return "".join(p.get("text", "") for p in parts)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError, OSError):
        return None


def _strip_fences(text: str) -> str:
    text = text.strip()
    text = re.sub(r"^```(json)?", "", text).strip()
    text = re.sub(r"```$", "", text).strip()
    return text


def diagnose_ambiguous_payment(event: RiskEvent, attempt_number: int) -> dict:
    system = ('You are a payments risk analyst. Given a repeating ambiguous card '
              'decline pattern, decide whether to keep retrying automatically, ask '
              'the customer to update their card, or escalate to a human. Respond '
              'ONLY with JSON, no other text: {"root_cause": str, "confidence": '
              'float 0-1, "rationale": str (<=30 words), "recommended_action": '
              '"retry_payment"|"request_card_update"|"escalate_human", '
              '"never_retry": bool, "needs_human": bool}')
    user = (f"Customer tenure: {event.signal.get('customer_tenure_months')} months. "
            f"Plan amount: INR {event.amount:.0f}. Decline code: do_not_honor, repeated "
            f"across {attempt_number} attempts. Gateway: {event.signal.get('gateway')}.")

    raw = _call_gemini(system, user)
    if raw:
        try:
            parsed = json.loads(_strip_fences(raw))
            required = {"root_cause", "confidence", "rationale", "recommended_action"}
            if not required.issubset(parsed.keys()):
                raise KeyError("LLM JSON missing a required field")
            parsed["method"] = DiagnosisMethod.LLM
            parsed.setdefault("never_retry", False)
            parsed.setdefault("needs_human", False)
            return parsed
        except (json.JSONDecodeError, KeyError, TypeError):
            pass

    # Heuristic fallback: longer tenure -> probably still worth one more
    # patient retry; new customer + repeated unexplained failures -> more
    # likely worth a human look before we burn another attempt on them.
    tenure = event.signal.get("customer_tenure_months", 1)
    if tenure >= 6:
        return dict(
            root_cause="Likely a persistent soft decline from an established customer",
            confidence=0.55, method=DiagnosisMethod.LLM_FALLBACK_HEURISTIC,
            rationale="Long-tenure customers rarely churn silently; one more patient retry is worth it.",
            recommended_action="retry_payment", never_retry=False, needs_human=False,
        )
    return dict(
        root_cause="Repeated unexplained decline on a newer relationship",
        confidence=0.5, method=DiagnosisMethod.LLM_FALLBACK_HEURISTIC,
        rationale="Short tenure plus repeated opaque declines is worth a human glance before another attempt.",
        recommended_action="escalate_human", never_retry=False, needs_human=True,
    )


def classify_reply_intent(reply_text: str) -> dict:
    system = ('Classify a B2B accounts-receivable customer reply. Respond ONLY '
              'with JSON, no other text: {"intent": "promise_to_pay"|"dispute"|'
              '"hardship"|"other", "confidence": float 0-1, "rationale": str '
              '(<=25 words), "promised_date_hint": str or null}')
    raw = _call_gemini(system, reply_text)
    if raw:
        try:
            parsed = json.loads(_strip_fences(raw))
            required = {"intent", "confidence", "rationale"}
            if not required.issubset(parsed.keys()):
                raise KeyError("LLM JSON missing a required field")
            parsed["method"] = DiagnosisMethod.LLM
            return parsed
        except (json.JSONDecodeError, KeyError, TypeError):
            pass

    text = reply_text.lower()
    if any(w in text for w in ["dispute", "doesn't match", "po number", "incorrect invoice"]):
        intent = "dispute"
    elif any(w in text for w in ["cash flow", "crunch", "more days", "extension", "hardship"]):
        intent = "hardship"
    elif any(w in text for w in ["will clear", "will pay", "expect payment", "releasing payment", "by the"]):
        intent = "promise_to_pay"
    else:
        intent = "other"
    return dict(
        intent=intent, confidence=0.6, method=DiagnosisMethod.LLM_FALLBACK_HEURISTIC,
        rationale="Keyword-matched fallback (offline mode) standing in for real intent classification.",
    )


TEMPLATES = {
    ("payment_failure", "en"): "Hi {name}, your payment of INR {amount:.0f} for {detail} didn't go through ({reason}). {cta}",
    ("payment_failure", "hi-en"): "Hi {name}, aapka INR {amount:.0f} ka payment {detail} ke liye complete nahi hua ({reason}). {cta}",
    ("checkout_abandonment", "en"): "Hi {name}, you left {detail} worth INR {amount:.0f} in your cart. {cta}",
    ("checkout_abandonment", "hi-en"): "Hi {name}, aapne apne cart mein INR {amount:.0f} ka {detail} chhoda hua hai. {cta}",
    ("receivable_overdue", "en"): "Dear {name}, invoice for INR {amount:.0f} is {detail}. {cta}",
    ("receivable_overdue", "hi-en"): "Dear {name}, INR {amount:.0f} ka invoice {detail} hai. {cta}",
}

CTA_BY_TIER = {
    1: "Just a friendly nudge - happy to help if anything's blocking this.",
    2: "Could you take a look when you get a chance? Reply here if you need any help.",
    3: "This needs attention soon to avoid any service interruption - let us know how we can help.",
    4: "We'd like to resolve this together - a member of our team will reach out shortly.",
}


def draft_message(event: RiskEvent, detail: str, reason: str, tone_tier: int, locale: str) -> dict:
    system = ('Write a short (<=45 words), respectful revenue-recovery outreach '
              'message for a customer. Never sound threatening, always offer help. '
              'Match the requested tone tier and language. Respond with the message '
              'text only - no preamble, no quotes, no markdown.')
    user = (f"Category: {event.category.value}. Customer: {event.customer_name}. "
            f"Amount: INR {event.amount:.0f}. Detail: {detail}. Reason: {reason}. "
            f"Tone tier (1=friendly nudge, 4=final notice before human handoff): {tone_tier}. "
            f"Language: {'Hinglish (Roman script, casual code-mixed Hindi/English)' if locale == 'hi-en' else 'English'}.")
    raw = _call_gemini(system, user, max_tokens=150)
    if raw:
        return dict(text=raw.strip(), method=DiagnosisMethod.LLM)

    template = TEMPLATES.get((event.category.value, locale), TEMPLATES[(event.category.value, "en")])
    text = template.format(name=event.customer_name, amount=event.amount, detail=detail,
                            reason=reason, cta=CTA_BY_TIER.get(tone_tier, CTA_BY_TIER[1]))
    return dict(text=text, method=DiagnosisMethod.LLM_FALLBACK_HEURISTIC)
