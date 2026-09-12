"""
FastAPI HTTP wrapper for the Revenue Recovery Agent batch engine.

Exposes:
  POST /batch   — run the Python engine, return JSON results
  GET  /health  — liveness probe

This is intentionally thin: all business logic lives in src/.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from src.data_generator import generate_batch
from src.engine import run_batch
from src.models import CaseStatus
from src.policy import PolicyConfig, MAX_AUTOMATED_ATTEMPTS

app = FastAPI(title="Revenue Recovery Agent API", version="1.0.0")

# Allow the Node Express server (same origin in production, cross-origin in dev)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class BatchRequest(BaseModel):
    seed: int = 42
    n: int = 90
    max_messages_per_hour: Optional[int] = 15


def _serialise_attempt(attempt) -> dict:
    d = attempt.diagnosis
    dec = attempt.decision
    ex = attempt.execution
    return {
        "caseId": attempt.case_id,
        "attemptNumber": attempt.attempt_number,
        "diagnosis": {
            "rootCause": d.root_cause,
            "method": d.method.value if hasattr(d.method, "value") else str(d.method),
            "confidence": d.confidence,
            "rationale": d.rationale,
            "neverRetry": d.never_retry,
            "needsHuman": d.needs_human,
            "recommendedAction": d.recommended_action,
        },
        "decision": {
            "action": dec.action,
            "blocked": dec.blocked,
            "reason": dec.reason,
            "toneTier": dec.tone_tier,
            "channel": dec.channel,
            "scheduledAt": dec.scheduled_at.isoformat() if dec.scheduled_at else None,
            "policyChecks": [
                {"rule": c.rule, "passed": c.passed, "detail": c.detail}
                for c in dec.policy_checks
            ],
            "autoEscalate": dec.auto_escalate,
        },
        "execution": {
            "executedAt": ex.executed_at.isoformat() if ex.executed_at else None,
            "messagePreview": ex.message_preview,
            "outcome": ex.outcome,
            "amountRecovered": ex.amount_recovered,
            "costEstimate": ex.cost_estimate,
        },
        "caseStatusAfter": attempt.case_status_after.value
        if hasattr(attempt.case_status_after, "value")
        else str(attempt.case_status_after),
    }


def _serialise_result(r) -> dict:
    e = r.event
    return {
        "event": {
            "id": e.id,
            "category": e.category.value if hasattr(e.category, "value") else str(e.category),
            "customerId": e.customer_id,
            "customerName": e.customer_name,
            "amount": e.amount,
            "currency": e.currency,
            "createdAt": e.created_at.isoformat(),
            "tzOffsetHours": e.tz_offset_hours,
            "localeHint": e.locale_hint,
            "optedOut": e.opted_out,
            "signal": e.signal,
        },
        "status": r.status.value if hasattr(r.status, "value") else str(r.status),
        "attempts": [_serialise_attempt(a) for a in r.attempts],
        "amountRecovered": r.amount_recovered,
        "totalCost": r.total_cost,
        "escalationCost": r.escalation_cost,
    }


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/batch")
def run_batch_endpoint(req: BatchRequest):
    config = PolicyConfig(
        max_attempts=dict(MAX_AUTOMATED_ATTEMPTS),
        max_messages_per_hour=(
            None if req.max_messages_per_hour == 0 else req.max_messages_per_hour
        ),
    )
    events = generate_batch(req.seed, req.n)
    results = run_batch(events, req.seed, config=config)
    return {
        "seed": req.seed,
        "n": req.n,
        "results": [_serialise_result(r) for r in results],
    }
