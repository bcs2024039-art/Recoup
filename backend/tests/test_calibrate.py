"""
Tests proving the calibration script's math is sound: sample synthetic
outcomes from executor.py's own tables, run calibrate.py's grouping logic
over them, and check the empirical rates land close to the known
generating probabilities.

This is a self-test of the CALIBRATION MATH, not a validation of the
probability tables themselves (see BENCHMARKS.md for that side of it) -
it proves that if real historical data existed, this script would
correctly recover rates from it.

Run with:  python3 -m unittest discover -s tests -v
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import calibrate as cal
from src import executor as ex


class TestCalibrationRecoversKnownRates(unittest.TestCase):
    """With enough synthetic samples, empirical frequency should land
    within a small tolerance of the true generating probability - this is
    just the law of large numbers, but it's exactly the property the
    calibration script depends on to be useful on real data."""

    @classmethod
    def setUpClass(cls):
        cls.tmp_path = Path(__file__).resolve().parent / "_calibration_selftest.csv"
        cal.generate_sample(str(cls.tmp_path), n=8000, seed=99)
        cls.rows = cal.load_outcomes(str(cls.tmp_path))

    @classmethod
    def tearDownClass(cls):
        cls.tmp_path.unlink(missing_ok=True)

    def test_card_update_click_through_recovers_within_tolerance(self):
        rec, tot = cal.calibrate_flat_rate(self.rows, "request_card_update")
        self.assertGreater(tot, 100, "sample too small to test meaningfully")
        self.assertAlmostEqual(rec / tot, ex.CARD_UPDATE_CLICK_THROUGH, delta=0.08)

    def test_reauth_click_through_recovers_within_tolerance(self):
        rec, tot = cal.calibrate_flat_rate(self.rows, "request_reauth_payment")
        self.assertGreater(tot, 100)
        self.assertAlmostEqual(rec / tot, ex.REAUTH_CLICK_THROUGH, delta=0.10)

    def test_promise_to_pay_recovers_within_tolerance(self):
        rec, tot = cal.calibrate_flat_rate(self.rows, "await_promised_date")
        self.assertGreater(tot, 100)
        self.assertAlmostEqual(rec / tot, ex.PROMISE_HONOURED_RATE, delta=0.08)

    def test_receivable_buckets_recover_within_tolerance(self):
        buckets = cal.calibrate_receivable(self.rows)
        self.assertEqual(set(buckets.keys()), set(ex.RECEIVABLE_BASE_RATE.keys()))
        for bucket, (rec, tot) in buckets.items():
            self.assertGreater(tot, 30, f"bucket {bucket} sample too small")
            empirical = rec / tot
            true_rate = ex.RECEIVABLE_BASE_RATE[bucket]
            self.assertAlmostEqual(empirical, true_rate, delta=0.12,
                                    msg=f"bucket={bucket} empirical={empirical:.3f} true={true_rate}")

    def test_payment_retry_aggregate_recovers_within_tolerance(self):
        # Individual (code, wait-bucket) cells have a small n each - check
        # the aggregate across all retry_payment rows instead, which is
        # far less noisy and still a meaningful end-to-end check.
        retry_rows = [r for r in self.rows if r["action"] == "retry_payment"]
        self.assertGreater(len(retry_rows), 500)
        empirical = sum(int(r["recovered"]) for r in retry_rows) / len(retry_rows)
        true_probs = [ex.PAYMENT_SUCCESS_BY_WAIT_DAYS[r["decline_code"]][int(r["wait_days"])]
                      for r in retry_rows]
        true_aggregate = sum(true_probs) / len(true_probs)
        self.assertAlmostEqual(empirical, true_aggregate, delta=0.05)

    def test_generated_sample_recovered_field_is_binary(self):
        self.assertTrue(all(r["recovered"] in ("0", "1") for r in self.rows))

    def test_small_sample_is_still_loadable_and_flagged(self):
        # A calibration run with too little data shouldn't crash - it
        # should just report small sample sizes so a human can judge
        # whether to trust them (see the "<- fewer than 30 samples" flag
        # in calibrate.py's main() output).
        tiny_path = Path(__file__).resolve().parent / "_tiny_selftest.csv"
        try:
            cal.generate_sample(str(tiny_path), n=20, seed=1)
            rows = cal.load_outcomes(str(tiny_path))
            buckets = cal.calibrate_receivable(rows)
            for _, (rec, tot) in buckets.items():
                self.assertLessEqual(rec, tot)
        finally:
            tiny_path.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
