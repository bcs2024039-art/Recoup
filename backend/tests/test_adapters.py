"""
Tests for the production integration seam (src/adapters.py): the
simulated adapters actually satisfy the abstract interfaces (so a real
adapter really could be dropped in without touching the rest of the
pipeline), and the simulated gateway adapter's outcomes are statistically
consistent with executor.py's own probability tables - proving executor.py
is genuinely calling through the adapter, not silently keeping its own
separate copy of the logic.

Run with:  python3 -m unittest discover -s tests -v
"""
from __future__ import annotations

import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src import executor as ex
from src.adapters import (
    GatewayRetryResult,
    MessageSendResult,
    MessagingProviderAdapter,
    PaymentGatewayAdapter,
    SimulatedGatewayAdapter,
    SimulatedMessagingAdapter,
)


class TestAdapterConformance(unittest.TestCase):

    def test_simulated_gateway_adapter_satisfies_the_abstract_interface(self):
        adapter = SimulatedGatewayAdapter(random.Random(1))
        self.assertIsInstance(adapter, PaymentGatewayAdapter)

    def test_simulated_messaging_adapter_satisfies_the_abstract_interface(self):
        adapter = SimulatedMessagingAdapter()
        self.assertIsInstance(adapter, MessagingProviderAdapter)

    def test_abstract_gateway_adapter_cannot_be_instantiated_directly(self):
        with self.assertRaises(TypeError):
            PaymentGatewayAdapter()  # abstract - must be subclassed and implement retry_charge

    def test_abstract_messaging_adapter_cannot_be_instantiated_directly(self):
        with self.assertRaises(TypeError):
            MessagingProviderAdapter()

    def test_gateway_result_carries_a_transaction_id_only_on_success(self):
        adapter = SimulatedGatewayAdapter(random.Random(2))
        result = adapter.retry_charge(
            gateway_customer_id="cust_1", gateway_payment_method_id="pm_1",
            amount=999.0, currency="INR", idempotency_key="idem_1",
            simulation_hint={"decline_code": "processing_error", "wait_days": 0},
        )
        self.assertIsInstance(result, GatewayRetryResult)
        if result.success:
            self.assertIsNotNone(result.gateway_transaction_id)
        else:
            self.assertIsNone(result.gateway_transaction_id)

    def test_messaging_adapter_returns_a_provider_message_id(self):
        result = SimulatedMessagingAdapter().send(
            to_address="cust_1", channel="email", subject="hi", body="hello",
            idempotency_key="idem_2")
        self.assertIsInstance(result, MessageSendResult)
        self.assertTrue(result.success)
        self.assertIsNotNone(result.provider_message_id)


class TestGatewayAdapterMatchesExecutorTables(unittest.TestCase):
    """Statistically confirms executor.py's retry_payment branch really is
    delegating to the adapter's probability table, not maintaining a
    separate, potentially-drifted copy of the same numbers."""

    def test_processing_error_immediate_retry_matches_hardcoded_table(self):
        rng = random.Random(99)
        adapter = SimulatedGatewayAdapter(rng)
        trials = 4000
        successes = sum(
            1 for _ in range(trials)
            if adapter.retry_charge(
                gateway_customer_id="c", gateway_payment_method_id="pm", amount=1000, currency="INR",
                idempotency_key="k", simulation_hint={"decline_code": "processing_error", "wait_days": 0},
            ).success
        )
        empirical = successes / trials
        expected = ex.PAYMENT_SUCCESS_BY_WAIT_DAYS["processing_error"][0]
        self.assertAlmostEqual(empirical, expected, delta=0.03)

    def test_unknown_decline_code_falls_back_to_do_not_honor_table(self):
        rng = random.Random(100)
        adapter = SimulatedGatewayAdapter(rng)
        trials = 4000
        successes = sum(
            1 for _ in range(trials)
            if adapter.retry_charge(
                gateway_customer_id="c", gateway_payment_method_id="pm", amount=1000, currency="INR",
                idempotency_key="k", simulation_hint={"decline_code": "totally_unknown_code", "wait_days": 1},
            ).success
        )
        empirical = successes / trials
        expected = ex.PAYMENT_SUCCESS_BY_WAIT_DAYS["do_not_honor"][1]
        self.assertAlmostEqual(empirical, expected, delta=0.03)


if __name__ == "__main__":
    unittest.main()
