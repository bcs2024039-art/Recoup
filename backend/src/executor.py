"""
Simulates *executing* a decided action and observing an outcome.

In production this module would call a payment gateway's retry API, an
email/SMS/WhatsApp provider, or push a task into a relationship manager's
queue - which is exactly why the retry_payment and messaging branches
below go through adapters.py's interfaces rather than computing an
outcome inline. Swapping SimulatedGatewayAdapter for RazorpayAdapter (or
similar) at the bottom of this file is meant to be the only change
needed to point this pipeline at a real gateway.

Every probability below is grounded in a cited public benchmark rather
than picked to feel plausible - see BENCHMARKS.md for the full source
list, the reasoning behind each number, and - importantly - the places
where no clean public benchmark exists and that's said outright rather
than papered over. These are still generic industry averages, not this
(synthetic) business's own data; calibrate.py exists for the day real
historical outcomes do.
"""
from __future__ import annotations

import random

from . import llm_judgment as llm
from .adapters import SimulatedGatewayAdapter, SimulatedMessagingAdapter
from .diagnosis import DECLINE_PROFILES
from .models import Category, Decision, Diagnosis, ExecutionResult, RiskEvent

COST_PER_CHANNEL = {
    "gateway_retry": 2.0,
    "email": 0.3,
    "email+sms": 0.8,
    None: 0.0,
}

# Cost of a human actually reviewing an escalated case - NOT independently
# sourced as a single number (no public benchmark isolates "cost of one
# escalation decision"), but structurally informed by HighRadius's cited
# cost-of-collection breakdown: labor dominates early-stage costs, a
# single collections call runs ~$0.02/min at ~7 min average, and cost
# roughly doubles per aging bucket as more investigation time is needed.
# These are reasoned India-context estimates built on that structure, not
# a cited rupee figure - flagged exactly like INCENTIVE_BUMP is, rather
# than dressed up as sourced. See BENCHMARKS.md §7.
ESCALATION_REVIEW_COST = {
    "fraud_or_high_risk_signal": 40.0,          # often triaged by a semi-automated trust & safety queue first
    "diagnosis_requires_human_review": 120.0,   # a real conversation: dispute investigation or hardship negotiation
    "max_attempts_exhausted": 90.0,             # senior review before deciding continued pursuit vs. write-off
}

# Decline-reason-aware timing is what separates "basic retry" (10-25%
# recovery, per Stuut/Tagada) from "smart retry" (45-80%, median ~50-55%,
# per GR4VY/Finsi/Slicker) - see BENCHMARKS.md §1. insufficient_funds and
# do_not_honor are weighted toward the lower half of that range since both
# ultimately hinge on the customer's real-time bank balance, same
# structural problem UPI Autopay's own (lower, ~15-20%) recovery
# literature describes - see BENCHMARKS.md §6. processing_error is
# transient/technical rather than balance-related, so it sits higher.
PAYMENT_SUCCESS_BY_WAIT_DAYS = {
    "insufficient_funds": {0: 0.06, 1: 0.12, 3: 0.28, 5: 0.32, 7: 0.34, 10: 0.22},
    "processing_error": {0: 0.55, 1: 0.45, 3: 0.35},
    "do_not_honor": {1: 0.15, 2: 0.18, 3: 0.20, 5: 0.19, 7: 0.17},
    "limit_exceeded": {3: 0.20, 5: 0.25, 7: 0.35, 10: 0.28},
}
# Full-funnel completion (open -> click -> fix the card -> charge succeeds)
# has to sit *below* the raw 20-40% click-through rate reported for
# dunning emails, not above it - BENCHMARKS.md §2.
CARD_UPDATE_CLICK_THROUGH = 0.32
REAUTH_CLICK_THROUGH = 0.27   # an extra auth step adds friction vs. a plain card-update form
MULTI_CHANNEL_BUMP = 0.03    # email+sms outperforms email-only dunning - BENCHMARKS.md §2

# Retuned down from cumulating to ~27% (above even "high-performing" cart
# recovery programs) to land the blended, multi-touch rate around 12-18%,
# consistent with the cross-source consensus - BENCHMARKS.md §3.
CHECKOUT_BASE_RATE = {"browsing_cart": 0.02, "shipping_details": 0.035, "payment_details": 0.06}
CHECKOUT_TIME_DECAY = {1: 1.0, 2: 0.75, 3: 0.55}   # multiplier by attempt number (proxy for elapsed time)
INCENTIVE_BUMP = 0.05        # not independently sourced - no benchmark isolates just this effect, flagged in BENCHMARKS.md §3

# These model recovery via *automated dunning alone*, not the higher
# "ultimate eventual collection by any means" figures the AR-aging
# literature reports (95%+ / 85-90% / 73-80% / 50-60% by bucket) - the two
# are genuinely different metrics. See BENCHMARKS.md §4 for why these are
# a documented fraction of the cited figures rather than equal to them.
RECEIVABLE_BASE_RATE = {"early": 0.35, "follow_up": 0.24, "firm": 0.15, "pre_collections": 0.07}
PROMISE_HONOURED_RATE = 0.68  # already inside the ~60-85% cited range as-is - BENCHMARKS.md §5


def nearest_bucket_prob(table: dict[float, float], wait_days: float) -> float:
    keys = sorted(table.keys())
    closest = min(keys, key=lambda k: abs(k - wait_days))
    return table[closest]


def execute(event: RiskEvent, diagnosis: Diagnosis, decision: Decision,
            attempt_number: int, rng: random.Random, elapsed_days: int = 0) -> ExecutionResult:
    if decision.blocked:
        return ExecutionResult(executed_at=None, message_preview=None,
                                outcome="n/a", amount_recovered=0.0, cost_estimate=0.0)

    cost = COST_PER_CHANNEL.get(decision.channel, 0.3)
    message = None
    idempotency_key = f"{event.id}:{attempt_number}"
    gateway = SimulatedGatewayAdapter(rng)
    messenger = SimulatedMessagingAdapter()

    if decision.action == "retry_payment":
        code = event.signal.get("decline_code", "do_not_honor")
        wait_days = max((decision.scheduled_at - event.created_at).total_seconds() / 86400, 0) if decision.scheduled_at else 0
        result = gateway.retry_charge(
            gateway_customer_id=event.customer_id, gateway_payment_method_id=f"pm_{event.customer_id}",
            amount=event.amount, currency=event.currency, idempotency_key=idempotency_key,
            simulation_hint={"decline_code": code, "wait_days": wait_days},
        )
        recovered = result.success

    elif decision.action == "request_card_update":
        reason = DECLINE_PROFILES.get(event.signal.get("decline_code"), {}).get("label", "a card issue")
        drafted = llm.draft_message(event, detail=f"your {event.signal.get('plan', 'subscription')} plan",
                                     reason=reason, tone_tier=decision.tone_tier, locale=event.locale_hint)
        message = drafted["text"]
        messenger.send(to_address=event.customer_id, channel=decision.channel or "email",
                        subject="Action needed on your payment method", body=message,
                        idempotency_key=idempotency_key)
        prob = CARD_UPDATE_CLICK_THROUGH + (MULTI_CHANNEL_BUMP if decision.channel == "email+sms" else 0.0)
        recovered = rng.random() < prob

    elif decision.action == "request_reauth_payment":
        drafted = llm.draft_message(
            event, detail=f"your {event.signal.get('plan', 'subscription')} plan renewal",
            reason="this amount needs a fresh authentication step under RBI e-mandate rules",
            tone_tier=decision.tone_tier, locale=event.locale_hint)
        message = drafted["text"]
        messenger.send(to_address=event.customer_id, channel=decision.channel or "email",
                        subject="Please re-authenticate your renewal", body=message,
                        idempotency_key=idempotency_key)
        prob = REAUTH_CLICK_THROUGH + (MULTI_CHANNEL_BUMP if decision.channel == "email+sms" else 0.0)
        recovered = rng.random() < prob

    elif decision.action == "send_checkout_reminder":
        stage = event.signal.get("drop_off_stage", "browsing_cart")
        base = CHECKOUT_BASE_RATE.get(stage, 0.1) * CHECKOUT_TIME_DECAY.get(attempt_number, 0.5)
        give_incentive = attempt_number >= 2 and event.amount >= 1500
        prob = base + (INCENTIVE_BUMP if give_incentive else 0)
        prob += MULTI_CHANNEL_BUMP if decision.channel == "email+sms" else 0.0
        drafted = llm.draft_message(event, detail=f"{event.signal.get('items_count')} item(s)",
                                     reason="cart abandoned at " + stage.replace("_", " "),
                                     tone_tier=decision.tone_tier, locale=event.locale_hint)
        message = drafted["text"] + ("  [10% off code: COMEBACK10]" if give_incentive else "")
        messenger.send(to_address=event.customer_id, channel=decision.channel or "email",
                        subject="You left something in your cart", body=message,
                        idempotency_key=idempotency_key)
        recovered = rng.random() < prob

    elif decision.action == "send_dunning_reminder":
        # Same aging formula diagnosis.py uses, so the bucket the customer
        # is actually messaged about matches the bucket their recovery odds
        # are drawn from - an invoice doesn't get easier to collect just
        # because we're on attempt 3 instead of attempt 1.
        days = event.signal.get("days_overdue", 0) + elapsed_days
        bucket = ("early" if days <= 15 else "follow_up" if days <= 30 else
                  "firm" if days <= 60 else "pre_collections")
        prob = RECEIVABLE_BASE_RATE.get(bucket, 0.2)
        prob += MULTI_CHANNEL_BUMP if decision.channel == "email+sms" else 0.0
        detail = f"INR {event.amount:.0f}, {days} days overdue"
        drafted = llm.draft_message(event, detail=detail, reason=f"{bucket.replace('_', ' ')}-stage follow-up",
                                     tone_tier=decision.tone_tier, locale=event.locale_hint)
        message = drafted["text"]
        messenger.send(to_address=event.customer_id, channel=decision.channel or "email",
                        subject="Following up on an overdue invoice", body=message,
                        idempotency_key=idempotency_key)
        recovered = rng.random() < prob

    elif decision.action == "await_promised_date":
        message = "(No new outbound message - waiting on the promised payment date.)"
        recovered = rng.random() < PROMISE_HONOURED_RATE
        cost = 0.0

    else:
        recovered = False

    amount_recovered = event.amount if recovered else 0.0
    return ExecutionResult(
        executed_at=decision.scheduled_at,
        message_preview=message,
        outcome="recovered" if recovered else "no_response",
        amount_recovered=amount_recovered,
        cost_estimate=cost,
    )

