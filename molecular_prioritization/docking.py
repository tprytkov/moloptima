"""Optional handling for precomputed docking scores."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DockingResult:
    """Precomputed docking score fields preserved from input CSVs."""

    docking_score: float | None
    docking_status: str


def parse_precomputed_docking_score(record: dict[str, str]) -> DockingResult:
    """Parse an optional docking_score value without running docking software."""

    if "docking_score" not in record:
        return DockingResult(docking_score=None, docking_status="not_provided")

    raw_value = record.get("docking_score")
    if raw_value is None or not raw_value.strip():
        return DockingResult(docking_score=None, docking_status="invalid_docking_score")

    try:
        return DockingResult(docking_score=float(raw_value), docking_status="provided")
    except ValueError:
        return DockingResult(docking_score=None, docking_status="invalid_docking_score")
