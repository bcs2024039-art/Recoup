#!/usr/bin/env python3
"""
Refit the recovery-probability tables from real historical outcomes.

Every table in executor.py is currently set from published industry
benchmarks (see BENCHMARKS.md) - a reasonable starting point for a
business that doesn't have its own history yet, but never a substitute
for that business's own data once it exists. This script is that
substitute: point it at a CSV of past cases and it re-derives each table
by empirical frequency - no assumptions, just counting.

Usage:
    python3 calibrate.py historical_outcomes.csv
    python3 calibrate.py --generate-sample 6000 sample_historical_outcomes.csv

CSV columns:
    category        payment_failure | checkout_abandonment | receivable_overdue
    action          retry_payment | request_card_update | request_reauth_payment |
                    send_checkout_reminder | send_dunning_reminder | await_promised_date
    decline_code    (retry_payment rows only)
    wait_days       (retry_payment rows only, integer days between decline and this attempt)
    drop_off_stage  (send_checkout_reminder rows only)
    attempt_number  (send_checkout_reminder rows only, 1-3)
    aging_bucket    (send_dunning_reminder rows only: early|follow_up|firm|pre_collections)
    channel         email | email+sms
    recovered       1 | 0

This never writes back into executor.py automatically - the printed
empirical rates are for a human to review (especially anything flagged
with a small sample size) before hand-updating the hardcoded tables.
"""
from __future__ import annotations

import argparse
import csv
import random
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from src import executor as ex  # noqa: E402


def load_outcomes(path: str) -> list[dict]:
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def calibrate_flat_rate(rows: list[dict], action: str) -> tuple[int, int]:
    matching = [r for r in rows if r["action"] == action]
    recovered = sum(int(r["recovered"]) for r in matching)
    return recovered, len(matching)


def calibrate_payment_retry(rows: list[dict]) -> dict[tuple[str, int], list[int]]:
    buckets: dict[tuple[str, int], list[int]] = defaultdict(lambda: [0, 0])
    for r in rows:
        if r["action"] != "retry_payment":
            continue
        code = r["decline_code"]
        table = ex.PAYMENT_SUCCESS_BY_WAIT_DAYS.get(code, ex.PAYMENT_SUCCESS_BY_WAIT_DAYS["do_not_honor"])
        wait_bucket = min(table.keys(), key=lambda k: abs(k - float(r["wait_days"])))
        key = (code, wait_bucket)
        buckets[key][0] += int(r["recovered"])
        buckets[key][1] += 1
    return buckets


def calibrate_checkout(rows: list[dict]) -> dict[tuple[str, str], list[int]]:
    buckets: dict[tuple[str, str], list[int]] = defaultdict(lambda: [0, 0])
    for r in rows:
        if r["action"] != "send_checkout_reminder":
            continue
        key = (r["drop_off_stage"], r["attempt_number"])
        buckets[key][0] += int(r["recovered"])
        buckets[key][1] += 1
    return buckets


def calibrate_receivable(rows: list[dict]) -> dict[str, list[int]]:
    buckets: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for r in rows:
        if r["action"] != "send_dunning_reminder":
            continue
        buckets[r["aging_bucket"]][0] += int(r["recovered"])
        buckets[r["aging_bucket"]][1] += 1
    return buckets


def pct(recovered: int, total: int) -> str:
    return f"{100 * recovered / total:.1f}%" if total else "n/a (0 samples)"


def generate_sample(path: str, n: int, seed: int = 7) -> None:
    """Synthetic SELF-TEST data only - sampled from executor.py's own
    current tables plus binomial noise, to prove the calibration math
    above can recover a known rate from outcome data. Not real data, and
    running this against it doesn't validate anything about the
    probabilities themselves - see BENCHMARKS.md for that."""
    rng = random.Random(seed)
    fieldnames = ["category", "action", "decline_code", "wait_days", "drop_off_stage",
                  "attempt_number", "aging_bucket", "channel", "recovered"]
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for _ in range(n):
            branch = rng.choices(
                ["retry", "card_update", "reauth", "checkout", "receivable", "promise"],
                weights=[30, 8, 4, 30, 24, 4], k=1)[0]
            row = dict.fromkeys(fieldnames, "")
            if branch == "retry":
                code = rng.choice(list(ex.PAYMENT_SUCCESS_BY_WAIT_DAYS.keys()))
                table = ex.PAYMENT_SUCCESS_BY_WAIT_DAYS[code]
                wait = rng.choice(list(table.keys()))
                row.update(category="payment_failure", action="retry_payment",
                           decline_code=code, wait_days=wait,
                           recovered=int(rng.random() < table[wait]))
            elif branch == "card_update":
                row.update(category="payment_failure", action="request_card_update",
                           recovered=int(rng.random() < ex.CARD_UPDATE_CLICK_THROUGH))
            elif branch == "reauth":
                row.update(category="payment_failure", action="request_reauth_payment",
                           recovered=int(rng.random() < ex.REAUTH_CLICK_THROUGH))
            elif branch == "checkout":
                stage = rng.choice(list(ex.CHECKOUT_BASE_RATE.keys()))
                attempt = rng.choice([1, 2, 3])
                prob = ex.CHECKOUT_BASE_RATE[stage] * ex.CHECKOUT_TIME_DECAY[attempt]
                row.update(category="checkout_abandonment", action="send_checkout_reminder",
                           drop_off_stage=stage, attempt_number=attempt,
                           recovered=int(rng.random() < prob))
            elif branch == "receivable":
                bucket = rng.choice(list(ex.RECEIVABLE_BASE_RATE.keys()))
                row.update(category="receivable_overdue", action="send_dunning_reminder",
                           aging_bucket=bucket,
                           recovered=int(rng.random() < ex.RECEIVABLE_BASE_RATE[bucket]))
            else:
                row.update(category="receivable_overdue", action="await_promised_date",
                           recovered=int(rng.random() < ex.PROMISE_HONOURED_RATE))
            w.writerow(row)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv_path", help="historical outcomes CSV to calibrate against (or write to, with --generate-sample)")
    ap.add_argument("--generate-sample", type=int, metavar="N",
                     help="skip calibration; write N synthetic self-test rows to csv_path instead")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    if args.generate_sample:
        generate_sample(args.csv_path, args.generate_sample, args.seed)
        print(f"Wrote {args.generate_sample} synthetic rows to {args.csv_path}")
        print("This is a SELF-TEST dataset, sampled from executor.py's own tables plus noise -")
        print("not real data. It exists to prove the calibration math below works, nothing more.")
        return

    rows = load_outcomes(args.csv_path)
    print(f"Loaded {len(rows)} historical outcomes from {args.csv_path}\n")

    print("=== Payment retry, by decline code / wait-days bucket ===")
    for (code, wait), (rec, tot) in sorted(calibrate_payment_retry(rows).items()):
        current = ex.PAYMENT_SUCCESS_BY_WAIT_DAYS.get(code, {}).get(wait, "?")
        flag = "   <- fewer than 30 samples, treat with caution" if tot < 30 else ""
        print(f"  {code:20s} wait={wait:>3}d   empirical={pct(rec, tot):>7}  (n={tot:>4})   hardcoded={current}{flag}")

    print("\n=== Card update / re-auth click-through ===")
    for action, current in [("request_card_update", ex.CARD_UPDATE_CLICK_THROUGH),
                             ("request_reauth_payment", ex.REAUTH_CLICK_THROUGH)]:
        rec, tot = calibrate_flat_rate(rows, action)
        print(f"  {action:24s} empirical={pct(rec, tot):>7}  (n={tot:>4})   hardcoded={current}")

    print("\n=== Checkout abandonment, by stage / attempt ===")
    for (stage, attempt), (rec, tot) in sorted(calibrate_checkout(rows).items()):
        current = ex.CHECKOUT_BASE_RATE.get(stage, 0) * ex.CHECKOUT_TIME_DECAY.get(int(attempt), 0)
        print(f"  {stage:16s} attempt={attempt}   empirical={pct(rec, tot):>7}  (n={tot:>4})   hardcoded={current:.3f} (excl. incentive/multi-channel bumps)")

    print("\n=== Receivables, by aging bucket ===")
    for bucket, (rec, tot) in sorted(calibrate_receivable(rows).items()):
        current = ex.RECEIVABLE_BASE_RATE.get(bucket, "?")
        print(f"  {bucket:16s} empirical={pct(rec, tot):>7}  (n={tot:>4})   hardcoded={current}")

    print("\n=== Promise-to-pay honoured ===")
    rec, tot = calibrate_flat_rate(rows, "await_promised_date")
    print(f"  empirical={pct(rec, tot)}  (n={tot})   hardcoded={ex.PROMISE_HONOURED_RATE}")

    print("\nThese rates are not written back into executor.py automatically -")
    print("review them (especially anything flagged with a small n) before updating")
    print("the hardcoded tables by hand.")


if __name__ == "__main__":
    main()
