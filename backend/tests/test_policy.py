"""
A few focused tests proving the compliance rules actually hold - these
are the properties an auditor would want enforced by the code itself,
not just asserted in a README.

Run with:  python3 -m unittest discover -s tests -v
"""
from __future__ import annotations

import sys
import unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src import diagnosis as diag
from src import policy
from src.models import Category, Diagnosis, DiagnosisMethod, RiskEvent


def make_event(**overrides) -> RiskEvent:
    base = dict(
        id="TEST-0001", category=Category.PAYMENT_FAILURE, customer_id="CUST-1",
        customer_name="Test User", amount=999.0, currency="INR",
        created_at=datetime(2026, 8, 1, 12, 0, 0), tz_offset_hours=5.5,
        locale_hint="en", opted_out=False,
        signal={"decline_code": "insufficient_funds", "plan": "Growth",
                "customer_tenure_months": 10},
    )
    base.update(overrides)
    return RiskEvent(**base)


def make_diagnosis(**overrides) -> Diagnosis:
    base = dict(root_cause="Insufficient funds", method=DiagnosisMethod.RULE,
                confidence=0.9, rationale="test", never_retry=False,
                needs_human=False, recommended_action="retry_payment")
    base.update(overrides)
    return Diagnosis(**base)


class TestComplianceRules(unittest.TestCase):

    def test_opted_out_customer_is_never_contacted(self):
        event = make_event(opted_out=True)
        decision = policy.decide(event, make_diagnosis(), 1, event.created_at)
        self.assertTrue(decision.blocked)
        self.assertEqual(decision.reason, "opted_out")
        self.assertIsNone(decision.channel)

    def test_fraud_signal_is_never_retried_and_escalates(self):
        event = make_event(signal={"decline_code": "stolen_card"})
        diagnosis = make_diagnosis(never_retry=True, needs_human=True,
                                    recommended_action="escalate_human")
        decision = policy.decide(event, diagnosis, 1, event.created_at)
        self.assertTrue(decision.blocked)
        self.assertTrue(decision.auto_escalate)
        self.assertEqual(decision.reason, "fraud_or_high_risk_signal")

    def test_stolen_card_end_to_end_never_gets_retried(self):
        event = make_event(signal={"decline_code": "stolen_card"})
        d = diag.diagnose(event, 1)
        self.assertTrue(d.never_retry)
        decision = policy.decide(event, d, 1, event.created_at)
        self.assertTrue(decision.blocked)
        self.assertEqual(decision.action, "escalate_human")

    def test_exceeding_max_attempts_blocks_further_automation(self):
        event = make_event()
        max_allowed = policy.MAX_AUTOMATED_ATTEMPTS[event.category]
        decision = policy.decide(event, make_diagnosis(), max_allowed + 1, event.created_at)
        self.assertTrue(decision.blocked)
        self.assertEqual(decision.reason, "max_attempts_exhausted")

    def test_within_attempt_budget_is_not_blocked(self):
        event = make_event()
        max_allowed = policy.MAX_AUTOMATED_ATTEMPTS[event.category]
        decision = policy.decide(event, make_diagnosis(), max_allowed, event.created_at)
        self.assertFalse(decision.blocked)

    def test_scheduled_contact_never_falls_in_quiet_hours(self):
        event = make_event(tz_offset_hours=5.5)
        near_quiet = datetime(2026, 8, 1, 17, 0, 0)  # +72h lands at 22:30 IST, pre-adjustment
        decision = policy.decide(event, make_diagnosis(), 1, near_quiet)
        self.assertIsNotNone(decision.scheduled_at)
        local_hour = policy._local_hour(decision.scheduled_at, event.tz_offset_hours)
        self.assertTrue(policy.QUIET_HOURS_END <= local_hour < policy.QUIET_HOURS_START,
                         f"scheduled local hour was {local_hour}, inside the quiet-hours window")

    def test_dispute_or_hardship_diagnosis_escalates_instead_of_auto_dunning(self):
        event = make_event(category=Category.RECEIVABLE_OVERDUE, amount=100000,
                            signal={"days_overdue": 20, "customer_reply_text": "we dispute this"})
        diagnosis = make_diagnosis(needs_human=True, recommended_action="escalate_human")
        decision = policy.decide(event, diagnosis, 1, event.created_at)
        self.assertTrue(decision.blocked)
        self.assertTrue(decision.auto_escalate)
        self.assertEqual(decision.reason, "diagnosis_requires_human_review")

    def test_high_value_case_still_gets_relationship_manager_visibility(self):
        event = make_event(category=Category.RECEIVABLE_OVERDUE, amount=900000,
                            signal={"days_overdue": 10})
        decision = policy.decide(event, make_diagnosis(recommended_action="send_dunning_reminder"),
                                  1, event.created_at)
        detail_texts = " ".join(c.detail for c in decision.policy_checks)
        self.assertIn("relationship manager", detail_texts.lower())

    def test_large_mandate_requires_reauth_instead_of_silent_retry(self):
        event = make_event(amount=29999, signal={"decline_code": "insufficient_funds"})
        decision = policy.decide(event, make_diagnosis(recommended_action="retry_payment"),
                                  1, event.created_at)
        self.assertEqual(decision.action, "request_reauth_payment")

    def test_small_mandate_is_eligible_for_silent_retry(self):
        event = make_event(amount=999, signal={"decline_code": "insufficient_funds"})
        decision = policy.decide(event, make_diagnosis(recommended_action="retry_payment"),
                                  1, event.created_at)
        self.assertEqual(decision.action, "retry_payment")

    def test_receivable_ages_forward_across_attempts_not_frozen_at_detection(self):
        event = make_event(category=Category.RECEIVABLE_OVERDUE, amount=50000,
                            signal={"days_overdue": 10})
        d_now = diag.diagnose(event, 1, elapsed_days=0)
        d_later = diag.diagnose(event, 2, elapsed_days=60)
        self.assertIn("early", d_now.root_cause.lower())
        self.assertNotEqual(d_now.root_cause, d_later.root_cause)


if __name__ == "__main__":
    unittest.main()
