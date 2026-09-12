"""
Integration seams for production.

These define the exact interface a real payment gateway or messaging
provider integration would implement. executor.py's simulated adapters
below satisfy these same interfaces, so swapping a simulated adapter for
a real one (RazorpayAdapter, TwilioAdapter, ...) is a drop-in replacement
- nothing else in the pipeline (diagnosis, policy, engine) needs to
change, because none of it talks to a gateway or a messaging provider
directly. It only ever talks to these two interfaces.

Deliberately thin. Production concerns that belong in a *concrete*
adapter, not here: OAuth/API-key management, retry-on-network-failure,
webhook signature verification, structured logging of the raw
request/response for support tooling. This file only defines the
contract; a real adapter has to do a fair amount of unglamorous work to
satisfy it correctly.

idempotency_key is on both interfaces, and is not optional, because it is
not optional in production: a scheduler retry, a duplicate webhook
delivery, or a network timeout-then-actually-succeeded case must never
double-charge a customer or double-send a message. The simulated
adapters below don't need it (there's no real network to retry against),
but a real adapter's contract has to include it or the interface itself
would be unsafe to build against.
"""
from __future__ import annotations

import random
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


@dataclass
class GatewayRetryResult:
    success: bool
    gateway_transaction_id: str | None
    raw_response: dict[str, Any]


class PaymentGatewayAdapter(ABC):
    """What executor.py's retry_payment action calls. Real
    implementations: RazorpayAdapter, StripeAdapter, CashfreeAdapter -
    each wrapping that provider's charge-retry API and translating its
    response into a GatewayRetryResult."""

    @abstractmethod
    def retry_charge(self, *, gateway_customer_id: str, gateway_payment_method_id: str,
                      amount: float, currency: str, idempotency_key: str) -> GatewayRetryResult:
        """Attempt to charge the customer's existing payment method again.
        A real implementation must be safe to call twice with the same
        idempotency_key (e.g. after a scheduler restart) without
        double-charging - the gateway's own idempotency-key support
        should be used to guarantee this, not reimplemented locally."""
        raise NotImplementedError


@dataclass
class MessageSendResult:
    success: bool
    provider_message_id: str | None
    raw_response: dict[str, Any]


class MessagingProviderAdapter(ABC):
    """What executor.py's messaging actions (card-update requests,
    checkout reminders, dunning) call. Real implementations:
    TwilioSmsAdapter, SendgridEmailAdapter, WhatsAppBusinessAdapter,
    Msg91Adapter - one per channel/provider combination in play."""

    @abstractmethod
    def send(self, *, to_address: str, channel: str, subject: str | None,
              body: str, idempotency_key: str) -> MessageSendResult:
        """channel is 'email' | 'sms' | 'whatsapp'. Same idempotency
        requirement as the gateway adapter above - a retried scheduler
        tick must never double-send."""
        raise NotImplementedError


class SimulatedGatewayAdapter(PaymentGatewayAdapter):
    """The adapter this prototype actually uses. Implements the same
    interface a real gateway adapter would, but decides success by
    drawing from executor.py's cited probability tables instead of
    calling a real API - see BENCHMARKS.md for where those numbers come
    from. simulation_hint carries the extra context (decline code, how
    long we waited before retrying) that a REAL gateway adapter would
    never need - a real gateway just tells you what happened, it doesn't
    need to be told the odds first. Kept as a separate parameter rather
    than folded into the abstract signature, so that signature stays
    honest about what a production integration actually requires."""

    def __init__(self, rng: random.Random):
        self._rng = rng

    def retry_charge(self, *, gateway_customer_id: str, gateway_payment_method_id: str,
                      amount: float, currency: str, idempotency_key: str,
                      simulation_hint: dict[str, Any] | None = None) -> GatewayRetryResult:
        from . import executor as ex  # local import: avoids a circular import at module load time

        hint = simulation_hint or {}
        code = hint.get("decline_code", "do_not_honor")
        wait_days = hint.get("wait_days", 0)
        table = ex.PAYMENT_SUCCESS_BY_WAIT_DAYS.get(code, ex.PAYMENT_SUCCESS_BY_WAIT_DAYS["do_not_honor"])
        prob = ex.nearest_bucket_prob(table, wait_days)
        success = self._rng.random() < prob
        return GatewayRetryResult(
            success=success,
            gateway_transaction_id=(f"sim_txn_{idempotency_key[:12]}" if success else None),
            raw_response={"simulated": True, "decline_code": code, "wait_days": wait_days, "probability_used": prob},
        )


class SimulatedMessagingAdapter(MessagingProviderAdapter):
    """Message *delivery* isn't a modeled failure mode in this
    simulation - only whether the customer responds afterward is (that
    stays in executor.py's own response-probability logic, deliberately
    kept out of this adapter). This adapter exists so the pipeline
    genuinely calls through the same interface a real one would, not to
    add a second, redundant success/failure roll."""

    def send(self, *, to_address: str, channel: str, subject: str | None,
              body: str, idempotency_key: str) -> MessageSendResult:
        return MessageSendResult(
            success=True,
            provider_message_id=f"sim_msg_{idempotency_key[:12]}",
            raw_response={"simulated": True, "channel": channel},
        )
