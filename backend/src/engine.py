"""
Batch orchestrator: runs every event through

    detect (done already, by data_generator) -> diagnose -> decide -> execute

until it resolves (recovered / escalated / opted-out / closed-unrecovered)
or runs out of allowed automated attempts.

Cases are processed in true global chronological order via a priority
queue keyed by each case's own simulated clock - NOT case-by-case in
isolation. That matters for exactly one reason: max_messages_per_hour is
a constraint shared across every case in the batch (protecting sender
reputation / provider throughput), not a per-case rule, so it only means
anything if cases are interleaved by actual scheduled time rather than
run one-to-completion before the next starts. Every case still gets its
own deterministic RNG (see _case_seed) so outcomes stay independent of
processing order and of each other - the fix from BENCHMARKS.md's
closing section still holds; this only changes *when* cases are
processed relative to one another, not what randomness each one draws.

Time itself is still a per-case *simulated* clock, standing in for a real
scheduler/task queue in production (e.g. a durable workflow engine such
as Temporal), so a multi-week campaign can be shown without the tool
needing to run for multi-week wall-clock time.
"""
from __future__ import annotations

import hashlib
import heapq
import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from itertools import count

from . import diagnosis as diag
from . import policy
from .diagnosis import DECLINE_PROFILES
from .executor import ESCALATION_REVIEW_COST, execute
from .models import AttemptRecord, Category, CaseStatus, PolicyCheck, RiskEvent
from .policy import PolicyConfig


def _case_seed(batch_seed: int, case_id: str) -> int:
    """Deterministic per-case seed, independent of processing order.

    Each case gets its own random stream derived only from the batch seed
    and its own id - NOT a shared sequential stream across all cases. That
    matters: with a shared stream, tweaking one category's probability
    table shifts how many random draws happen before every case that
    follows it in the (shuffled) batch order, silently perturbing
    unrelated cases' outcomes - see BENCHMARKS.md's closing section for
    the calibration bug this actually caused. Uses hashlib rather than
    Python's built-in hash() because str/tuple hashing is randomised per-
    process unless PYTHONHASHSEED is fixed - hashlib is stable across
    runs and machines, which reproducibility depends on.
    """
    digest = hashlib.sha256(f"{batch_seed}:{case_id}".encode()).digest()
    return int.from_bytes(digest[:8], "big")


@dataclass
class CaseResult:
    event: RiskEvent
    status: CaseStatus
    attempts: list[AttemptRecord] = field(default_factory=list)
    amount_recovered: float = 0.0
    total_cost: float = 0.0
    escalation_cost: float = 0.0


@dataclass
class _CaseState:
    event: RiskEvent
    rng: random.Random
    sim_time: datetime
    attempt_number: int = 1
    status: CaseStatus = CaseStatus.ACTIVE
    attempts: list[AttemptRecord] = field(default_factory=list)
    amount_recovered: float = 0.0
    total_cost: float = 0.0
    escalation_cost: float = 0.0


# Only real outbound messaging counts against the shared throughput cap -
# a silent backend gateway retry never touches messaging infrastructure
# or a customer's inbox, so it has no bearing on sender reputation or
# provider rate limits, which is what this rule actually protects.
RATE_LIMITED_CHANNELS = {"email", "email+sms"}


def _hour_bucket(dt: datetime) -> datetime:
    return dt.replace(minute=0, second=0, microsecond=0)


def _apply_rate_limit(decision, event: RiskEvent, hourly_sent: dict[datetime, int],
                       max_per_hour: int) -> None:
    """Mutates decision in place: if its hour-slot is at the shared cap,
    push scheduled_at forward (re-checking quiet hours at each candidate,
    so a rate-limit push can never silently reintroduce a quiet-hours
    violation) until a slot under the cap is found, and log it as a
    normal policy check either way.

    Keeps two related-but-distinct values carefully separate: `candidate`
    is the precise timestamp actually used as decision.scheduled_at, and
    `_hour_bucket(candidate)` is only ever used as the hourly_sent dict
    key for counting. An earlier version of this function collapsed the
    two - it set scheduled_at to the *bucket-truncated* value instead of
    the precise one, which is safe for tz_offset_hours=0 or any whole-
    hour offset but silently wrong for fractional ones. IST is +5:30: an
    exact local-8am instant (what _push_past_quiet_hours computes to
    escape quiet hours) has a non-zero reference-frame minute, so
    truncating it back to :00 shifts the *local* time backward by up to
    30 minutes - occasionally back into the quiet-hours window it had
    just escaped. Caught by test_engine.py's
    test_rate_limit_push_never_lands_in_quiet_hours, not by inspection -
    worth knowing about given most events in this dataset are IST.
    """
    candidate = decision.scheduled_at
    guard = 0
    while True:
        candidate = policy._push_past_quiet_hours(candidate, event.tz_offset_hours)
        bucket = _hour_bucket(candidate)
        if hourly_sent.get(bucket, 0) < max_per_hour or guard >= 24 * 14:
            break
        candidate = bucket + timedelta(hours=1)
        guard += 1

    pushed = candidate != decision.scheduled_at
    hourly_sent[_hour_bucket(candidate)] = hourly_sent.get(_hour_bucket(candidate), 0) + 1
    decision.scheduled_at = candidate
    decision.policy_checks.append(PolicyCheck(
        "batch_rate_limit", passed=True,
        detail=(f"Hour-slot at the shared {max_per_hour}/hr cap - pushed to {candidate.isoformat()}."
                if pushed else f"Under the shared {max_per_hour}/hr cap for this slot.")))


def run_batch(events: list[RiskEvent], seed: int,
              config: PolicyConfig = policy.DEFAULT_POLICY) -> list[CaseResult]:
    states: dict[str, _CaseState] = {
        e.id: _CaseState(event=e, rng=random.Random(_case_seed(seed, e.id)), sim_time=e.created_at)
        for e in events
    }
    max_rounds = {e.id: config.max_attempts[e.category] + 1 for e in events}

    hourly_sent: dict[datetime, int] = {}
    tie_breaker = count()
    heap: list[tuple[datetime, int, str]] = [
        (s.sim_time, next(tie_breaker), case_id) for case_id, s in states.items()
    ]
    heapq.heapify(heap)

    while heap:
        sim_time, _, case_id = heapq.heappop(heap)
        state = states[case_id]
        if state.status != CaseStatus.ACTIVE:
            continue
        event = state.event

        elapsed_days = max((sim_time - event.created_at).days, 0)
        d = diag.diagnose(event, state.attempt_number, elapsed_days)

        recommended_wait_days = None
        if event.category == Category.PAYMENT_FAILURE:
            code = event.signal.get("decline_code")
            recommended_wait_days = DECLINE_PROFILES.get(code, {}).get("recommended_wait_days")

        decision = policy.decide(event, d, state.attempt_number, sim_time,
                                  recommended_wait_days, config=config)

        if (not decision.blocked and config.max_messages_per_hour is not None
                and decision.channel in RATE_LIMITED_CHANNELS):
            _apply_rate_limit(decision, event, hourly_sent, config.max_messages_per_hour)

        result = execute(event, d, decision, state.attempt_number, state.rng, elapsed_days)

        if decision.blocked:
            if decision.reason == "opted_out":
                state.status = CaseStatus.OPTED_OUT
            elif decision.auto_escalate:
                state.status = CaseStatus.ESCALATED_HUMAN
                state.escalation_cost = ESCALATION_REVIEW_COST.get(decision.reason, 0.0)
                state.total_cost += state.escalation_cost
            else:
                state.status = CaseStatus.CLOSED_UNRECOVERED
        elif result.outcome == "recovered":
            state.status = CaseStatus.RECOVERED
        # else: stays ACTIVE, another attempt follows via the heap

        state.amount_recovered += result.amount_recovered
        state.total_cost += result.cost_estimate
        state.attempts.append(AttemptRecord(
            case_id=event.id, attempt_number=state.attempt_number, category=event.category,
            diagnosis=d, decision=decision, execution=result, case_status_after=state.status,
        ))

        if state.status == CaseStatus.ACTIVE:
            state.attempt_number += 1
            if state.attempt_number <= max_rounds[case_id] and decision.scheduled_at:
                state.sim_time = decision.scheduled_at
                heapq.heappush(heap, (state.sim_time, next(tie_breaker), case_id))
            else:
                # Defensive safety net only - policy.decide's own exhaustion
                # check (attempt_number > max_attempts) always resolves the
                # case on the round above, so this should be unreachable.
                state.status = CaseStatus.CLOSED_UNRECOVERED

    return [
        CaseResult(event=s.event, status=s.status, attempts=s.attempts,
                   amount_recovered=s.amount_recovered, total_cost=s.total_cost,
                   escalation_cost=s.escalation_cost)
        for s in states.values()
    ]
