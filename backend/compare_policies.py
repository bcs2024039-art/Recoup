#!/usr/bin/env python3
"""
The "cost of compliance" counterfactual.

Runs the SAME batch (same seed, same events) under two policy
configurations - the real one, and one with a specific *pacing* rule
relaxed - and reports the difference in recovered value, escalations,
and cost. Averages over multiple seeds by default, because single-seed
noise on a 200-case batch is large enough to be misleading on its own
(see BENCHMARKS.md's closing section).

Deliberately does NOT let you toggle off eligibility rules - fraud
never-retry, opt-out, dispute/hardship escalation. Those aren't a pacing
trade-off to measure the cost of; they're about not contacting people who
shouldn't be contacted at all, and treating that as a cost-benefit lever
isn't a legitimate business question even hypothetically. See
PolicyConfig's docstring in src/policy.py - there is deliberately no
toggle for those rules anywhere in this codebase, not just in this script.

Usage:
    python3 compare_policies.py quiet_hours
    python3 compare_policies.py attempt_cap --extra-attempts 2
    python3 compare_policies.py rate_limit --cap 3

Findings from running this (n=200, 20 seeds, committed for reference):

  quiet_hours    - essentially free: recovered value differs by ~0.003%
                   with quiet-hours enforcement on vs. off. Respecting
                   the 9pm-8am window costs nothing measurable, because
                   the recovery-probability model is bucketed by day and
                   attempt number, not by hour of day.
  rate_limit     - fires (verifiably - see the batch_rate_limit checks in
                   the audit trail) but also produces ~0% change in
                   recovered value at any tested cap, for the same
                   day/attempt-level bucketing reason. Its real effect is
                   redistributing *when* messages go out, not *whether*
                   they work - visible in the dashboard's contact-timing
                   histogram, not in the recovery-rate KPI.
  attempt_cap    - the one rule that isn't free. +2 attempts per category
                   moved recovered value from 53.9% to 58.3% of at-risk
                   value AND lowered total cost (fewer expensive human
                   escalations outweighs a couple more cheap automated
                   touches). Important caveat: for payment_failure
                   specifically, this isn't a pure business choice to
                   flip - NPCI's UPI Autopay framework caps recurring-
                   payment mandates at exactly 4 attempts (1 original +
                   3 retries, see BENCHMARKS.md §6), so extending that
                   cap could mean violating a real network rule for
                   UPI-based mandates, not just a self-imposed politeness
                   norm. Checkout and receivables have no equivalent
                   external constraint - the tradeoff there is real and
                   worth actually deciding on, not routed around.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from dataclasses import replace

from src.data_generator import generate_batch
from src.engine import run_batch
from src.policy import MAX_AUTOMATED_ATTEMPTS, PolicyConfig


def _run_seeds(config: PolicyConfig, n: int, seeds: int) -> dict:
    totals = dict(at_risk=0.0, recovered=0.0, escalated=0, opted_out=0,
                  closed_unrecovered=0, cost=0.0, escalation_cost=0.0)
    for seed in range(1, seeds + 1):
        events = generate_batch(seed, n)
        for r in run_batch(events, seed, config=config):
            totals["at_risk"] += r.event.amount
            totals["recovered"] += r.amount_recovered
            totals["cost"] += r.total_cost
            totals["escalation_cost"] += r.escalation_cost
            if r.status.value == "escalated_human":
                totals["escalated"] += 1
            elif r.status.value == "opted_out":
                totals["opted_out"] += 1
            elif r.status.value == "closed_unrecovered":
                totals["closed_unrecovered"] += 1
    return totals


def _print_comparison(label_a: str, a: dict, label_b: str, b: dict) -> None:
    rate_a = 100 * a["recovered"] / a["at_risk"] if a["at_risk"] else 0
    rate_b = 100 * b["recovered"] / b["at_risk"] if b["at_risk"] else 0
    print(f"{'':28s}{label_a:>20s}{label_b:>20s}{'delta':>16s}")
    print(f"{'Recovered value':28s}{a['recovered']:>20,.0f}{b['recovered']:>20,.0f}{b['recovered']-a['recovered']:>+16,.0f}")
    print(f"{'Recovery rate':28s}{rate_a:>19.2f}%{rate_b:>19.2f}%{rate_b-rate_a:>+15.2f}pp")
    print(f"{'Escalated to human':28s}{a['escalated']:>20d}{b['escalated']:>20d}{b['escalated']-a['escalated']:>+16d}")
    print(f"{'Total cost (incl. escalation)':28s}{a['cost']:>20,.2f}{b['cost']:>20,.2f}{b['cost']-a['cost']:>+16,.2f}")
    print(f"{'  of which, escalation cost':28s}{a['escalation_cost']:>20,.2f}{b['escalation_cost']:>20,.2f}{b['escalation_cost']-a['escalation_cost']:>+16,.2f}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("rule", choices=["quiet_hours", "rate_limit", "attempt_cap"])
    ap.add_argument("--n", type=int, default=200, help="events per batch")
    ap.add_argument("--seeds", type=int, default=20, help="seeds to average over")
    ap.add_argument("--cap", type=int, default=3, help="[rate_limit] messages/hour in the tightened run")
    ap.add_argument("--extra-attempts", type=int, default=2, help="[attempt_cap] attempts added per category")
    args = ap.parse_args()

    baseline = PolicyConfig()

    if args.rule == "quiet_hours":
        variant = replace(baseline, enforce_quiet_hours=False)
        label_a, label_b = "quiet hours ON", "quiet hours OFF"
    elif args.rule == "rate_limit":
        variant = replace(baseline, max_messages_per_hour=args.cap)
        label_a, label_b = f"cap={baseline.max_messages_per_hour}/hr", f"cap={args.cap}/hr"
    else:
        bumped = {k: v + args.extra_attempts for k, v in MAX_AUTOMATED_ATTEMPTS.items()}
        variant = replace(baseline, max_attempts=bumped)
        label_a, label_b = "standard caps", f"+{args.extra_attempts} attempts"

    print(f"Cost-of-compliance counterfactual: {args.rule}  (n={args.n}, {args.seeds} seeds averaged)\n")
    a = _run_seeds(baseline, args.n, args.seeds)
    b = _run_seeds(variant, args.n, args.seeds)
    _print_comparison(label_a, a, label_b, b)

    if args.rule == "attempt_cap":
        print("\nCaveat: for payment_failure, going beyond 4 total attempts isn't purely a")
        print("business choice - NPCI's UPI Autopay framework caps recurring-payment mandates")
        print("at exactly 4 (1 original + 3 retries). See BENCHMARKS.md §6 before acting on this")
        print("number for that category specifically; checkout and receivables have no such")
        print("external constraint.")


if __name__ == "__main__":
    main()
