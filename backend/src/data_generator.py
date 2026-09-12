"""
Synthetic data generation for the three revenue-risk categories.

In production these events arrive as webhooks from a payment gateway
(Razorpay/Stripe/Cashfree), product analytics (checkout funnel events),
and the accounts-receivable / ERP system. Here we generate statistically
plausible synthetic events so the rest of the pipeline can be exercised
end to end and demoed offline, with a seeded RNG so a given seed always
reproduces the same batch.
"""
from __future__ import annotations

import random
from datetime import datetime, timedelta

from .models import Category, RiskEvent

PERSON_NAMES = [
    "Aarav", "Vivaan", "Aditya", "Ishaan", "Rohan", "Kabir", "Ananya", "Diya",
    "Saanvi", "Meera", "Priya", "Neha", "Karan", "Arjun", "Sanya", "Rhea",
]
COMPANY_NAMES = [
    "Global Traders", "Nimbus Retail", "BlueBridge Logistics", "Kestrel Foods",
    "Orchid Apparel", "Vertex Manufacturing", "Sundew Media", "Alpine Freight",
    "Copper Leaf Exports", "Ridgeline Components",
]

INDIA_TZ = 5.5
OTHER_TZ = [0.0, -5.0, 8.0, 1.0]

# Decline codes are standard across gateways (Razorpay/Stripe/Cashfree all
# expose an equivalent set). Weights are illustrative, roughly ordered by
# how common each reason tends to be in practice.
DECLINE_CODES = ["insufficient_funds", "do_not_honor", "expired_card", "processing_error",
                  "incorrect_number", "limit_exceeded", "stolen_card"]
DECLINE_WEIGHTS = [0.30, 0.25, 0.14, 0.10, 0.08, 0.10, 0.03]

# Monthly tiers plus one annual plan - the annual plan intentionally sits
# above the RBI e-mandate AFA-exempt ceiling (INR 15,000/transaction, per
# the 2026 e-mandate framework) so the "can't silently retry a large
# mandate" policy rule has real cases to fire on, not just monthly ones.
PLANS = [("Starter", 499), ("Growth", 999), ("Pro", 2999), ("Scale", 4999),
         ("Annual Pro", 29999)]

DROP_STAGES = ["browsing_cart", "shipping_details", "payment_details"]
DROP_WEIGHTS = [0.35, 0.25, 0.40]

B2B_REPLIES = [
    None, None, None, None,  # most invoices: no reply logged yet
    "Will clear this by the 30th, releasing payments in a batch this week.",
    "We dispute this invoice - PO number doesn't match our records, please resend.",
    "Facing a cash flow crunch this quarter, can we get 15 more days?",
    "Paid already, please check - will send UTR shortly.",
    "This has been escalated internally, expect payment by Friday.",
]

SIM_NOW = datetime(2026, 8, 23, 10, 0, 0)


def _rand_time(rng: random.Random, days_back: int) -> datetime:
    delta_minutes = rng.randint(0, max(days_back, 1) * 24 * 60)
    return SIM_NOW - timedelta(minutes=delta_minutes)


def _customer(rng: random.Random, b2b: bool = False) -> tuple[str, str]:
    name = rng.choice(COMPANY_NAMES if b2b else PERSON_NAMES)
    cid = f"CUST-{rng.randint(10000, 99999)}"
    return cid, name


def generate_payment_failures(rng: random.Random, n: int) -> list[RiskEvent]:
    events = []
    for i in range(n):
        cid, name = _customer(rng)
        plan, amount = rng.choice(PLANS)
        decline = rng.choices(DECLINE_CODES, weights=DECLINE_WEIGHTS, k=1)[0]
        tz = INDIA_TZ if rng.random() < 0.85 else rng.choice(OTHER_TZ)
        events.append(RiskEvent(
            id=f"PMT-{i:05d}",
            category=Category.PAYMENT_FAILURE,
            customer_id=cid,
            customer_name=name,
            amount=float(amount),
            currency="INR",
            created_at=_rand_time(rng, 21),
            tz_offset_hours=tz,
            locale_hint="hi-en" if rng.random() < 0.4 else "en",
            opted_out=rng.random() < 0.03,
            signal={
                "plan": plan,
                "decline_code": decline,
                "gateway": rng.choice(["Razorpay", "Stripe", "Cashfree"]),
                "customer_tenure_months": rng.randint(1, 48),
            },
        ))
    return events


def generate_checkout_abandonment(rng: random.Random, n: int) -> list[RiskEvent]:
    events = []
    for i in range(n):
        is_guest = rng.random() < 0.35
        if is_guest:
            cid, name = "GUEST", "Guest"
        else:
            cid, name = _customer(rng)
        cart = round(rng.choice([
            rng.uniform(300, 1500), rng.uniform(1500, 6000), rng.uniform(6000, 20000),
        ]), -1)
        stage = rng.choices(DROP_STAGES, weights=DROP_WEIGHTS, k=1)[0]
        tz = INDIA_TZ if rng.random() < 0.9 else rng.choice(OTHER_TZ)
        events.append(RiskEvent(
            id=f"CKT-{i:05d}",
            category=Category.CHECKOUT_ABANDONMENT,
            customer_id=cid,
            customer_name=name,
            amount=float(cart),
            currency="INR",
            created_at=_rand_time(rng, 10),
            tz_offset_hours=tz,
            locale_hint="hi-en" if rng.random() < 0.4 else "en",
            opted_out=(not is_guest) and rng.random() < 0.03,
            signal={
                "items_count": rng.randint(1, 6),
                "drop_off_stage": stage,
                "device": rng.choice(["mobile", "desktop"]),
                "is_returning_customer": (not is_guest) and rng.random() < 0.5,
            },
        ))
    return events


def generate_receivables(rng: random.Random, n: int) -> list[RiskEvent]:
    events = []
    for i in range(n):
        cid, name = _customer(rng, b2b=True)
        amount = round(rng.choice([
            rng.uniform(25000, 150000), rng.uniform(150000, 500000), rng.uniform(500000, 1500000),
        ]), -3)
        days_overdue = rng.choices(
            [rng.randint(1, 15), rng.randint(16, 30), rng.randint(31, 60),
             rng.randint(61, 90), rng.randint(91, 150)],
            weights=[0.35, 0.25, 0.20, 0.12, 0.08], k=1)[0]
        history_score = round(rng.betavariate(5, 2) * 100, 1)
        reply = rng.choice(B2B_REPLIES)
        tz = INDIA_TZ if rng.random() < 0.8 else rng.choice(OTHER_TZ)
        events.append(RiskEvent(
            id=f"RCV-{i:05d}",
            category=Category.RECEIVABLE_OVERDUE,
            customer_id=cid,
            customer_name=name,
            amount=float(amount),
            currency="INR",
            created_at=_rand_time(rng, 30),
            tz_offset_hours=tz,
            locale_hint="en",
            opted_out=False,
            signal={
                "days_overdue": days_overdue,
                "payment_history_score": history_score,
                "invoice_count_last_year": rng.randint(4, 48),
                "relationship_manager": rng.choice(["Ritu", "Sameer", "Anjali", None]),
                "customer_reply_text": reply,
            },
        ))
    return events


def generate_batch(seed: int, total: int) -> list[RiskEvent]:
    rng = random.Random(seed)
    third = total // 3
    remainder = total - third * 3
    events: list[RiskEvent] = []
    events += generate_payment_failures(rng, third + (1 if remainder > 0 else 0))
    events += generate_checkout_abandonment(rng, third + (1 if remainder > 1 else 0))
    events += generate_receivables(rng, third)
    rng.shuffle(events)
    return events
