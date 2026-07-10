"""Optional handling for precomputed docking scores."""

from __future__ import annotations

from dataclasses import dataclass


DOCKING_INFORMED_COLUMNS = [
    "docking_score_normalized",
    "docking_priority_signal",
    "docking_rank_within_run",
    "docking_percentile_within_run",
    "combined_candidate_score",
    "combined_score_explanation",
    "combined_score_status",
]

COMBINED_PRIORITY_WEIGHT = 0.70
COMBINED_DOCKING_WEIGHT = 0.30


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


def add_docking_informed_scores(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    """Add transparent run-level docking-informed candidate scores.

    More negative docking scores are treated as more favorable. This does not run
    docking and does not modify priority_score.
    """

    scored_rows = [dict(row) for row in rows]
    valid_docking_rows = [
        (index, float(row["docking_score"]))
        for index, row in enumerate(scored_rows)
        if row.get("valid_molecule") is True
        and row.get("docking_status") == "provided"
        and isinstance(row.get("docking_score"), int | float)
    ]

    if not valid_docking_rows:
        for row in scored_rows:
            _apply_unavailable_docking_score(row)
        return scored_rows

    sorted_by_docking = sorted(
        valid_docking_rows,
        key=lambda item: (item[1], str(scored_rows[item[0]].get("molecule_id", ""))),
    )
    best_score = sorted_by_docking[0][1]
    worst_score = sorted_by_docking[-1][1]
    score_range = worst_score - best_score
    row_rank = {row_index: rank for rank, (row_index, _score) in enumerate(sorted_by_docking, start=1)}
    docking_count = len(sorted_by_docking)

    for index, row in enumerate(scored_rows):
        if row.get("valid_molecule") is not True:
            _apply_invalid_molecule_docking_score(row)
            continue

        if row.get("docking_status") == "provided" and index in row_rank:
            docking_score = float(row["docking_score"])
            normalized = 1.0 if score_range == 0 else (worst_score - docking_score) / score_range
            normalized = round(max(0.0, min(normalized, 1.0)), 3)
            rank = row_rank[index]
            percentile = 100.0 if docking_count == 1 else ((docking_count - rank) / (docking_count - 1)) * 100
            combined_score = round(
                (float(row.get("priority_score") or 0.0) * COMBINED_PRIORITY_WEIGHT)
                + (normalized * COMBINED_DOCKING_WEIGHT),
                3,
            )

            row.update(
                {
                    "docking_score_normalized": normalized,
                    "docking_priority_signal": _docking_priority_signal(normalized),
                    "docking_rank_within_run": rank,
                    "docking_percentile_within_run": round(percentile, 1),
                    "combined_candidate_score": combined_score,
                    "combined_score_explanation": (
                        "Optional docking-informed score = 70% priority_score + "
                        "30% normalized docking_score. More negative docking scores "
                        "receive stronger normalized signals. Docking scores are receptor-, "
                        "site-, and protocol-dependent screening signals only."
                    ),
                    "combined_score_status": "calculated",
                }
            )
            continue

        _apply_missing_or_invalid_docking_score(row)

    return scored_rows


def _apply_invalid_molecule_docking_score(row: dict[str, object]) -> None:
    row.update(
        {
            "docking_score_normalized": None,
            "docking_priority_signal": "not_run_invalid_molecule",
            "docking_rank_within_run": None,
            "docking_percentile_within_run": None,
            "combined_candidate_score": None,
            "combined_score_explanation": "Docking-informed scoring skipped for invalid molecule.",
            "combined_score_status": "not_run_invalid_molecule",
        }
    )


def _apply_unavailable_docking_score(row: dict[str, object]) -> None:
    if row.get("valid_molecule") is not True:
        _apply_invalid_molecule_docking_score(row)
        return
    if row.get("docking_status") == "invalid_docking_score":
        _apply_missing_or_invalid_docking_score(row)
        return
    row.update(
        {
            "docking_score_normalized": None,
            "docking_priority_signal": "no_docking_signal",
            "docking_rank_within_run": None,
            "docking_percentile_within_run": None,
            "combined_candidate_score": None,
            "combined_score_explanation": (
                "Docking-informed scoring not available because no valid docking_score values "
                "were provided for this run."
            ),
            "combined_score_status": "docking_not_provided",
        }
    )


def _apply_missing_or_invalid_docking_score(row: dict[str, object]) -> None:
    status = "invalid_docking_score" if row.get("docking_status") == "invalid_docking_score" else "docking_missing_for_molecule"
    row.update(
        {
            "docking_score_normalized": None,
            "docking_priority_signal": "no_docking_signal",
            "docking_rank_within_run": None,
            "docking_percentile_within_run": None,
            "combined_candidate_score": None,
            "combined_score_explanation": (
                "Docking-informed scoring skipped for this molecule because a valid docking_score "
                "was not available. Provided docking scores remain protocol-dependent screening signals only."
            ),
            "combined_score_status": status,
        }
    )


def _docking_priority_signal(normalized_score: float) -> str:
    if normalized_score >= 0.75:
        return "strong_docking_signal"
    if normalized_score >= 0.40:
        return "moderate_docking_signal"
    return "limited_docking_signal"
