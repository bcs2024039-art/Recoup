"""
Structured, replayable audit trail.

Every attempt across every case gets one JSON line with the full
detect -> diagnose -> decide -> execute chain and the rationale behind
each policy check, so any recovered (or NOT recovered, or escalated)
rupee can be traced back to exactly why the agent acted the way it did.
"""
from __future__ import annotations

import json
from dataclasses import asdict, is_dataclass
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any

from .models import AttemptRecord


def _default(obj: Any):
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, Enum):
        return obj.value
    if is_dataclass(obj):
        return asdict(obj)
    raise TypeError(f"Not JSON serialisable: {type(obj)}")


def record_to_dict(record: AttemptRecord) -> dict:
    """Fully-resolved, plain-JSON-safe dict (no Enum/datetime objects left)."""
    return json.loads(json.dumps(asdict(record), default=_default))


def write_jsonl(records: list[AttemptRecord], path: str | Path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(record_to_dict(r), ensure_ascii=False) + "\n")
