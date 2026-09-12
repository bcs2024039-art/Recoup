"""
Root-cause diagnosis.

Design principle: use deterministic rules wherever the signal is already
structured and unambiguous (decline codes, drop-off stage, days overdue -
all finite, well-known enumerations). Only reach for LLM judgment when a
case is genuinely ambiguous: a repeated "do_not_honor" decline with no
further detail, or a free-text customer reply that needs interpreting.
"""
from __future__ import annotations

from . import llm_judgment as llm
from .models import Category, Diagnosis, DiagnosisMethod, RiskEvent

DECLINE_PROFILES = {
    "insufficient_funds": dict(label="Insufficient funds", retryable=True,
                                never_retry=False, requires_card_update=False,
                                recommended_wait_days=3),
    "expired_card": dict(label="Card expired", retryable=False,
                          never_retry=False, requires_card_update=True,
                          recommended_wait_days=1),
    "incorrect_number": dict(label="Card details entered incorrectly", retryable=False,
                              never_retry=False, requires_card_update=True,
                              recommended_wait_days=1),
    "stolen_card": dict(label="Card reported lost / stolen", retryable=False,
                         never_retry=True, requires_card_update=False,
                         recommended_wait_days=0),
    "processing_error": dict(label="Gateway / processing error", retryable=True,
                              never_retry=False, requires_card_update=False,
                              recommended_wait_days=0),
    "do_not_honor": dict(label="Bank declined, no reason given", retryable=True,
                          never_retry=False, requires_card_update=False,
                          recommended_wait_days=2, ambiguous=True),
    "limit_exceeded": dict(label="Card limit exceeded", retryable=True,
                            never_retry=False, requires_card_update=False,
                            recommended_wait_days=5),
}


def diagnose_payment_failure(event: RiskEvent, attempt_number: int) -> Diagnosis:
    code = event.signal.get("decline_code", "do_not_honor")
    profile = DECLINE_PROFILES.get(code, DECLINE_PROFILES["do_not_honor"])

    if profile.get("ambiguous") and attempt_number >= 2:
        # A do_not_honor decline that keeps recurring is genuinely ambiguous:
        # could be a soft decline that just needs patience, or the bank
        # quietly signalling something riskier. Worth a judgment call
        # instead of hard-coding a guess into a rule table.
        result = llm.diagnose_ambiguous_payment(event, attempt_number)
        return Diagnosis(
            root_cause=result["root_cause"],
            method=result["method"],
            confidence=result["confidence"],
            rationale=result["rationale"],
            never_retry=result.get("never_retry", False),
            needs_human=result.get("needs_human", False),
            recommended_action=result.get("recommended_action", "escalate_human"),
        )

    return Diagnosis(
        root_cause=profile["label"],
        method=DiagnosisMethod.RULE,
        confidence=0.95,
        rationale=f"Decline code '{code}' maps directly to a known category - no ambiguity to resolve.",
        never_retry=profile["never_retry"],
        needs_human=profile["never_retry"],
        recommended_action=("request_card_update" if profile["requires_card_update"]
                             else ("retry_payment" if profile["retryable"] else "escalate_human")),
    )


def diagnose_checkout_abandonment(event: RiskEvent, attempt_number: int) -> Diagnosis:
    stage = event.signal.get("drop_off_stage", "browsing_cart")
    labels = {
        "payment_details": "Friction at the final payment step",
        "shipping_details": "Hesitation over shipping cost or timing",
        "browsing_cart": "Low purchase intent / still comparing",
    }
    # Intentionally rule-based only: the signal is a small closed set of
    # numeric/categorical fields. There is nothing genuinely ambiguous here
    # for an LLM to resolve, so adding one would only add cost and latency
    # for no better a decision.
    return Diagnosis(
        root_cause=labels.get(stage, "Cart abandoned"),
        method=DiagnosisMethod.RULE,
        confidence=0.8,
        rationale=f"Drop-off stage '{stage}' maps to a known abandonment pattern.",
        recommended_action="send_checkout_reminder",
    )


def diagnose_receivable(event: RiskEvent, attempt_number: int, elapsed_days: int = 0) -> Diagnosis:
    reply = event.signal.get("customer_reply_text")
    # Age the invoice forward by however long the campaign has been running
    # (elapsed_days, the simulated time since detection) - an invoice that
    # was 12 days overdue when first flagged is further overdue by attempt 3.
    days_overdue = event.signal.get("days_overdue", 0) + elapsed_days

    if reply:
        # Free text from a human genuinely needs language understanding to
        # tell a promise-to-pay apart from a dispute or a hardship signal -
        # a keyword table alone would be quietly wrong on real phrasing.
        result = llm.classify_reply_intent(reply)
        needs_human = result["intent"] in ("dispute", "hardship")
        return Diagnosis(
            root_cause=f"Customer reply classified as: {result['intent'].replace('_', ' ')}",
            method=result["method"],
            confidence=result["confidence"],
            rationale=result["rationale"],
            needs_human=needs_human,
            recommended_action=("await_promised_date" if result["intent"] == "promise_to_pay"
                                 else ("escalate_human" if needs_human else "send_dunning_reminder")),
        )

    bucket = ("early" if days_overdue <= 15 else
              "follow_up" if days_overdue <= 30 else
              "firm" if days_overdue <= 60 else
              "pre_collections" if days_overdue <= 90 else
              "collections")
    return Diagnosis(
        root_cause=f"Invoice {days_overdue} days overdue ({bucket.replace('_', ' ')} stage)",
        method=DiagnosisMethod.RULE,
        confidence=0.9,
        rationale="Days-overdue bucket is a deterministic, auditable aging rule, recomputed against "
                   "the invoice's current age each round - no judgment needed.",
        needs_human=(bucket == "collections"),
        recommended_action="escalate_human" if bucket == "collections" else "send_dunning_reminder",
    )


def diagnose(event: RiskEvent, attempt_number: int, elapsed_days: int = 0) -> Diagnosis:
    if event.category == Category.PAYMENT_FAILURE:
        return diagnose_payment_failure(event, attempt_number)
    if event.category == Category.CHECKOUT_ABANDONMENT:
        return diagnose_checkout_abandonment(event, attempt_number)
    return diagnose_receivable(event, attempt_number, elapsed_days)
