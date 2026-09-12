#!/usr/bin/env python3
"""
CLI entry point for the Revenue Recovery Agent batch engine.

Usage:
    python3 run_batch.py --n 200 --seed 42 --out output/

No external dependencies - pure Python 3 standard library.
"""
from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path

from src.audit import write_jsonl
from src.data_generator import generate_batch
from src.engine import run_batch
from src.models import CaseStatus
from src.policy import PolicyConfig, MAX_AUTOMATED_ATTEMPTS


def summarise(results) -> dict:
    by_cat = defaultdict(lambda: dict(count=0, at_risk=0.0, recovered=0.0,
                                       escalated=0, opted_out=0, closed_unrecovered=0,
                                       cost=0.0, escalation_cost=0.0))
    overall = dict(count=0, at_risk=0.0, recovered=0.0, escalated=0,
                   opted_out=0, closed_unrecovered=0, cost=0.0, escalation_cost=0.0)

    for r in results:
        cat = r.event.category.value
        by_cat[cat]["count"] += 1
        by_cat[cat]["at_risk"] += r.event.amount
        by_cat[cat]["recovered"] += r.amount_recovered
        by_cat[cat]["cost"] += r.total_cost
        by_cat[cat]["escalation_cost"] += r.escalation_cost
        overall["count"] += 1
        overall["at_risk"] += r.event.amount
        overall["recovered"] += r.amount_recovered
        overall["cost"] += r.total_cost
        overall["escalation_cost"] += r.escalation_cost
        if r.status == CaseStatus.ESCALATED_HUMAN:
            by_cat[cat]["escalated"] += 1
            overall["escalated"] += 1
        elif r.status == CaseStatus.OPTED_OUT:
            by_cat[cat]["opted_out"] += 1
            overall["opted_out"] += 1
        elif r.status == CaseStatus.CLOSED_UNRECOVERED:
            by_cat[cat]["closed_unrecovered"] += 1
            overall["closed_unrecovered"] += 1

    def pct(part, whole):
        return round(100 * part / whole, 1) if whole else 0.0

    overall["recovery_rate_pct"] = pct(overall["recovered"], overall["at_risk"])
    for s in by_cat.values():
        s["recovery_rate_pct"] = pct(s["recovered"], s["at_risk"])

    return {"overall": overall, "by_category": dict(by_cat)}


def main() -> None:
    ap = argparse.ArgumentParser(description="Run the AI Revenue Recovery batch agent.")
    ap.add_argument("--n", type=int, default=200, help="total number of events to generate")
    ap.add_argument("--seed", type=int, default=42, help="random seed, for reproducibility")
    ap.add_argument("--out", type=str, default="output", help="output directory")
    ap.add_argument("--max-messages-per-hour", type=int, default=15,
                     help="shared cap on outbound messages per hour across the whole batch; "
                          "0 disables the cap entirely (default: 15)")
    args = ap.parse_args()

    config = PolicyConfig(
        max_attempts=dict(MAX_AUTOMATED_ATTEMPTS),
        max_messages_per_hour=None if args.max_messages_per_hour == 0 else args.max_messages_per_hour,
    )

    events = generate_batch(args.seed, args.n)
    results = run_batch(events, args.seed, config=config)

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    all_attempts = [a for r in results for a in r.attempts]
    write_jsonl(all_attempts, out_dir / "audit_log.jsonl")

    summary = summarise(results)
    with (out_dir / "summary.json").open("w") as f:
        json.dump(summary, f, indent=2)

    with (out_dir / "cases.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["case_id", "category", "customer", "amount_inr", "status",
                    "attempts", "amount_recovered_inr", "cost_inr", "escalation_cost_inr"])
        for r in results:
            w.writerow([r.event.id, r.event.category.value, r.event.customer_name,
                        f"{r.event.amount:.0f}", r.status.value, len(r.attempts),
                        f"{r.amount_recovered:.0f}", f"{r.total_cost:.2f}", f"{r.escalation_cost:.2f}"])

    print(f"Processed {len(events)} events "
          f"(rate limit: {config.max_messages_per_hour or 'disabled'}/hr).\n")
    o = summary["overall"]
    print(f"  Total at-risk value:      INR {o['at_risk']:,.0f}")
    print(f"  Total recovered:          INR {o['recovered']:,.0f}  ({o['recovery_rate_pct']}%)")
    print(f"  Escalated to human:       {o['escalated']}  (review cost: INR {o['escalation_cost']:,.2f})")
    print(f"  Opted out (untouched):    {o['opted_out']}")
    print(f"  Closed, unrecovered:      {o['closed_unrecovered']}")
    print(f"  Total intervention cost:  INR {o['cost']:,.2f}  (incl. escalation review cost)")
    print(f"\nWritten to {out_dir}/audit_log.jsonl, summary.json, cases.csv")


if __name__ == "__main__":
    main()
