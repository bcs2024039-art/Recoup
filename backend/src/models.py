"""
Core data models for the Revenue Recovery Agent.

Plain dataclasses on purpose - no ORM, no pydantic - so the whole engine
runs with zero external dependencies and is trivial to read end to end.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Optional


class Category(str, Enum):
    PAYMENT_FAILURE = "payment_failure"
    CHECKOUT_ABANDONMENT = "checkout_abandonment"
    RECEIVABLE_OVERDUE = "receivable_overdue"


class DiagnosisMethod(str, Enum):
    RULE = "rule"
    LLM = "llm"
    LLM_FALLBACK_HEURISTIC = "llm_fallback_heuristic"


class CaseStatus(str, Enum):
    ACTIVE = "active"
    RECOVERED = "recovered"
    ESCALATED_HUMAN = "escalated_human"
    OPTED_OUT = "opted_out"
    CLOSED_UNRECOVERED = "closed_unrecovered"


@dataclass
class RiskEvent:
    """A single piece of revenue put 'at risk' - what the agent detects."""
    id: str
    category: Category
    customer_id: str
    customer_name: str
    amount: float
    currency: str
    created_at: datetime
    tz_offset_hours: float
    locale_hint: str                       # "en" or "hi-en" (Hinglish-preferring)
    opted_out: bool
    signal: dict[str, Any] = field(default_factory=dict)   # category-specific raw fields


@dataclass
class Diagnosis:
    root_cause: str
    method: DiagnosisMethod
    confidence: float
    rationale: str
    never_retry: bool = False
    needs_human: bool = False
    recommended_action: Optional[str] = None


@dataclass
class PolicyCheck:
    rule: str
    passed: bool
    detail: str = ""


@dataclass
class Decision:
    action: str
    blocked: bool
    reason: str
    tone_tier: int
    channel: Optional[str]
    scheduled_at: Optional[datetime]
    policy_checks: list[PolicyCheck]
    auto_escalate: bool = False


@dataclass
class ExecutionResult:
    executed_at: Optional[datetime]
    message_preview: Optional[str]
    outcome: str                           # "recovered" | "no_response" | "n/a"
    amount_recovered: float
    cost_estimate: float


@dataclass
class AttemptRecord:
    """One full detect->diagnose->decide->execute cycle for one case."""
    case_id: str
    attempt_number: int
    category: Category
    diagnosis: Diagnosis
    decision: Decision
    execution: ExecutionResult
    case_status_after: CaseStatus
