"""
The compliance / "bounded behaviour" policy engine.

Every rule here is a plain function over explicit thresholds - no model,
no randomness. That is deliberate: these are the rules an auditor would
ask about, so they need to be provable by reading the code, not by
trusting a model's behaviour on average.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from .models import Category, Decision, Diagnosis, PolicyCheck, RiskEvent

MAX_AUTOMATED_ATTEMPTS = {
    Category.PAYMENT_FAILURE: 4,
    Category.CHECKOUT_ABANDONMENT: 3,
    Category.RECEIVABLE_OVERDUE: 4,
}

# Minimum hours between two automated touches, before any decline- or
# aging-specific adjustment is layered on top.
MIN_COOLDOWN_HOURS = {
    Category.PAYMENT_FAILURE: 12,
    Category.CHECKOUT_ABANDONMENT: 4,
    Category.RECEIVABLE_OVERDUE: 48,
}

# Above this amount, a human (relationship manager / collections lead)
# must be given visibility rather than letting automation run unwatched.
HIGH_VALUE_ESCALATION_THRESHOLD = {
    Category.PAYMENT_FAILURE: 5000,
    Category.CHECKOUT_ABANDONMENT: 20000,
    Category.RECEIVABLE_OVERDUE: 600000,
}

# Per RBI's Digital Payments E-mandate Framework, 2026: recurring-payment
# mandates above this ceiling require a fresh Additional Factor of
# Authentication, so a decline above it cannot be silently auto-retried -
# the customer must complete a re-authentication step instead. (The
# framework carves out a higher INR 1,00,000 ceiling for insurance/SIP/
# credit-card-bill categories specifically; we don't handle those
# categories here, so we apply the general INR 15,000 ceiling.)
AFA_REAUTH_THRESHOLD_INR = 15000

QUIET_HOURS_START = 21   # 9pm local
QUIET_HOURS_END = 8      # 8am local

# Batch-wide default cap on outbound messages per hour, across every case
# in the batch combined - a shared-resource constraint (protects sender
# reputation / respects provider throughput limits), unlike every other
# rule here which is evaluated per case. Actually enforced in engine.py,
# since only the batch orchestrator has visibility across cases; it lives
# here so every pacing knob is defined in one place. None disables it.
DEFAULT_MAX_MESSAGES_PER_HOUR: int | None = 15

RETRY_SCHEDULE_HOURS = {
    Category.CHECKOUT_ABANDONMENT: [4, 24, 72],
    Category.RECEIVABLE_OVERDUE: [72, 120, 168, 240],
}


@dataclass
class PolicyConfig:
    """Everything about *pacing* (when, how often) is configurable here,
    for exactly one purpose: measuring what these rules cost, via
    compare_policies.py's "cost of compliance" counterfactual.

    Deliberately excludes eligibility rules - never_retry_fraud_signal,
    do_not_contact_list, diagnosis_flagged_human_review (dispute/hardship)
    - because those aren't a pacing trade-off to measure the cost of.
    They're about not contacting people who shouldn't be contacted at
    all, which isn't a legitimate cost-benefit question even
    hypothetically, so there's deliberately no toggle for them anywhere
    in this codebase.
    """
    enforce_quiet_hours: bool = True
    max_attempts: dict[Category, int] = field(default_factory=lambda: dict(MAX_AUTOMATED_ATTEMPTS))
    max_messages_per_hour: int | None = DEFAULT_MAX_MESSAGES_PER_HOUR


DEFAULT_POLICY = PolicyConfig()


def _local_hour(dt: datetime, tz_offset_hours: float) -> float:
    local = dt + timedelta(hours=tz_offset_hours)
    return local.hour + local.minute / 60


def _push_past_quiet_hours(dt: datetime, tz_offset_hours: float) -> datetime:
    """Never schedule an outbound touch inside the 9pm-8am local window -
    reschedule it to the next 8am local instead of sending it late."""
    hour = _local_hour(dt, tz_offset_hours)
    if QUIET_HOURS_START <= hour or hour < QUIET_HOURS_END:
        local = dt + timedelta(hours=tz_offset_hours)
        next_morning_local = local.replace(hour=QUIET_HOURS_END, minute=0, second=0, microsecond=0)
        if hour >= QUIET_HOURS_START:
            next_morning_local += timedelta(days=1)
        return next_morning_local - timedelta(hours=tz_offset_hours)
    return dt


def _next_delay_hours(event: RiskEvent, attempt_number: int, recommended_wait_days: float | None) -> float:
    if event.category == Category.PAYMENT_FAILURE:
        base_days = recommended_wait_days if recommended_wait_days is not None else 3
        days = base_days + (attempt_number - 1) * 1.5
        return max(days * 24, MIN_COOLDOWN_HOURS[event.category])
    schedule = RETRY_SCHEDULE_HOURS[event.category]
    idx = min(attempt_number - 1, len(schedule) - 1)
    return max(schedule[idx], MIN_COOLDOWN_HOURS[event.category])


def _tone_tier(attempt_number: int) -> int:
    return min(attempt_number, 4)


def decide(event: RiskEvent, diagnosis: Diagnosis, attempt_number: int,
           sim_time: datetime, recommended_wait_days: float | None = None,
           config: PolicyConfig = DEFAULT_POLICY) -> Decision:
    checks: list[PolicyCheck] = []

    opted_out = event.opted_out
    checks.append(PolicyCheck("do_not_contact_list", passed=not opted_out,
                               detail="Customer has opted out - all automated contact halts immediately."
                                      if opted_out else "Not on the do-not-contact list."))
    if opted_out:
        return Decision(action="none", blocked=True, reason="opted_out",
                         tone_tier=0, channel=None, scheduled_at=None,
                         policy_checks=checks, auto_escalate=False)

    fraud = diagnosis.never_retry
    checks.append(PolicyCheck("never_retry_fraud_signal", passed=not fraud,
                               detail="Fraud/lost/stolen signal present - automation must never retry this."
                                      if fraud else "No fraud signal present."))
    if fraud:
        return Decision(action="escalate_human", blocked=True, reason="fraud_or_high_risk_signal",
                         tone_tier=0, channel=None, scheduled_at=sim_time,
                         policy_checks=checks, auto_escalate=True)

    max_attempts = config.max_attempts[event.category]
    exhausted = attempt_number > max_attempts
    checks.append(PolicyCheck("max_automated_attempts", passed=not exhausted,
                               detail=f"Attempt {attempt_number} of {max_attempts} allowed automated attempts."))
    if exhausted:
        auto_escalate = event.category != Category.CHECKOUT_ABANDONMENT
        return Decision(action="escalate_human" if auto_escalate else "close_unrecovered",
                         blocked=True, reason="max_attempts_exhausted",
                         tone_tier=0, channel=None, scheduled_at=sim_time,
                         policy_checks=checks, auto_escalate=auto_escalate)

    needs_human = diagnosis.needs_human
    checks.append(PolicyCheck("diagnosis_flagged_human_review", passed=not needs_human,
                               detail=diagnosis.rationale if needs_human else "No human-review flag from diagnosis."))
    if needs_human:
        return Decision(action="escalate_human", blocked=True, reason="diagnosis_requires_human_review",
                         tone_tier=0, channel=None, scheduled_at=sim_time,
                         policy_checks=checks, auto_escalate=True)

    threshold = HIGH_VALUE_ESCALATION_THRESHOLD[event.category]
    high_value = event.amount > threshold
    checks.append(PolicyCheck(
        "high_value_human_oversight", passed=True,   # never blocks automation outright, just adds visibility
        detail=(f"Amount INR {event.amount:.0f} exceeds INR {threshold:.0f} - relationship manager cc'd on this touch."
                if high_value else f"Amount INR {event.amount:.0f} within the automated-only threshold."),
    ))

    action = diagnosis.recommended_action or "send_checkout_reminder"

    if action == "retry_payment" and event.amount > AFA_REAUTH_THRESHOLD_INR:
        action = "request_reauth_payment"
        checks.append(PolicyCheck(
            "rbi_afa_reauth_threshold", passed=True,
            detail=(f"Amount INR {event.amount:.0f} exceeds the INR {AFA_REAUTH_THRESHOLD_INR:,} e-mandate "
                     "AFA-exempt ceiling - cannot silently auto-retry; customer must complete fresh authentication."),
        ))
    else:
        checks.append(PolicyCheck("rbi_afa_reauth_threshold", passed=True,
                                   detail="Within the e-mandate AFA-exempt ceiling - eligible for a silent retry."))

    delay_hours = _next_delay_hours(event, attempt_number, recommended_wait_days)
    scheduled_at = sim_time + timedelta(hours=delay_hours)
    if config.enforce_quiet_hours:
        pre_quiet = scheduled_at
        scheduled_at = _push_past_quiet_hours(scheduled_at, event.tz_offset_hours)
        checks.append(PolicyCheck("quiet_hours", passed=True,
                                   detail="Rescheduled past the 9pm-8am local quiet-hours window."
                                          if scheduled_at != pre_quiet else "Falls within allowed contact hours."))
    else:
        checks.append(PolicyCheck("quiet_hours", passed=True,
                                   detail="Quiet-hours enforcement disabled in this policy config "
                                          "(counterfactual run only - never disabled by default)."))

    channel = ("gateway_retry" if action == "retry_payment" else
               "email+sms" if high_value else "email")

    return Decision(action=action, blocked=False, reason="proceed",
                     tone_tier=_tone_tier(attempt_number), channel=channel,
                     scheduled_at=scheduled_at, policy_checks=checks, auto_escalate=False)

