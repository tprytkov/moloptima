"""Explanatory Pareto and weight-robustness analysis for Prioritization v2.

Neither analysis mutates candidate inputs, the source profile, scalar scores, or
scalar ranks.  Sensitivity samples are evaluated only by deriving profiles whose
``component_weights`` differ and calling the existing v2 scoring engine.
"""

from __future__ import annotations

import math
import random
import statistics
from collections.abc import Mapping, Sequence
from dataclasses import replace

from molecular_prioritization.prioritization_profiles import (
    PrioritizationProfile,
    profile_sha256,
)
from molecular_prioritization.prioritization_v2 import score_candidates_v2


PARETO_ANALYSIS_VERSION = "moloptima-pareto-v1"
SENSITIVITY_ANALYSIS_VERSION = "moloptima-weight-sensitivity-v1"
PARETO_DIMENSIONS = frozenset({"docking", "admet", "molecular_quality", "safety"})
COMPONENT_WEIGHT_IDS = ("docking", "admet", "molecular_quality")
PERTURBATION_METHOD = "bounded_relative_uniform_then_sum_normalization"


def analyze_pareto_fronts(
    results: Sequence[Mapping[str, object]],
    dimensions: Sequence[str],
) -> dict[str, object]:
    """Return deterministic non-dominated fronts for rank-eligible v2 results."""

    selected = _validated_dimensions(dimensions)
    eligible: list[dict[str, object]] = []
    for source_index, source in enumerate(results):
        explanation = source.get("prioritization_v2")
        if not isinstance(explanation, Mapping):
            raise ValueError("Pareto analysis requires Prioritization v2 explanations.")
        if source.get("v2_rank_eligible") is not True:
            continue
        vector = {
            dimension: _pareto_dimension(explanation, dimension, source, source_index)
            for dimension in selected
        }
        eligible.append({
            "source_index": source_index,
            "molecule_id": str(source.get("molecule_id") or ""),
            "scalar_rank": source.get("v2_rank"),
            "scalar_score": source.get("v2_score"),
            "objective_values": vector,
        })

    dominated_by: list[set[int]] = [set() for _ in eligible]
    dominates: list[set[int]] = [set() for _ in eligible]
    for left in range(len(eligible)):
        left_vector = eligible[left]["objective_values"]
        for right in range(left + 1, len(eligible)):
            right_vector = eligible[right]["objective_values"]
            if _dominates(left_vector, right_vector, selected):
                dominates[left].add(right)
                dominated_by[right].add(left)
            elif _dominates(right_vector, left_vector, selected):
                dominates[right].add(left)
                dominated_by[left].add(right)

    remaining_counts = [len(items) for items in dominated_by]
    fronts: dict[int, int] = {}
    current = [index for index, count in enumerate(remaining_counts) if count == 0]
    front_number = 1
    while current:
        next_front: list[int] = []
        for index in current:
            fronts[index] = front_number
            for dominated_index in sorted(dominates[index]):
                remaining_counts[dominated_index] -= 1
                if remaining_counts[dominated_index] == 0:
                    next_front.append(dominated_index)
        current = sorted(set(next_front))
        front_number += 1

    rows = []
    for index, item in enumerate(eligible):
        rows.append({
            **item,
            "pareto_front": fronts[index],
            "pareto_non_dominated": fronts[index] == 1,
            "pareto_dominated_by_count": len(dominated_by[index]),
            "pareto_dominates_count": len(dominates[index]),
            "pareto_dimensions_used": list(selected),
        })
    rows.sort(key=lambda row: (
        int(row["pareto_front"]),
        _rank_sort_value(row.get("scalar_rank")),
        str(row["molecule_id"]).casefold(),
        int(row["source_index"]),
    ))
    return {
        "analysis_version": PARETO_ANALYSIS_VERSION,
        "explanatory_only": True,
        "dimensions_used": list(selected),
        "rank_eligible_molecule_count": len(rows),
        "excluded_unrankable_count": len(results) - len(rows),
        "results": rows,
    }


def analyze_weight_sensitivity(
    candidates: Sequence[Mapping[str, object]],
    profile: PrioritizationProfile,
    *,
    perturbation_magnitude: float,
    number_of_samples: int,
    analysis_seed: int,
) -> dict[str, object]:
    """Measure scalar-rank variation under analysis-only top-level weight changes."""

    if not isinstance(profile, PrioritizationProfile):
        raise ValueError("Sensitivity analysis requires a PrioritizationProfile.")
    profile.validate_for_scoring()
    magnitude = _validated_magnitude(perturbation_magnitude)
    if isinstance(number_of_samples, bool) or not isinstance(number_of_samples, int):
        raise ValueError("Sensitivity number_of_samples must be an integer.")
    if not 1 <= number_of_samples <= 1000:
        raise ValueError("Sensitivity number_of_samples must be between 1 and 1000.")
    if isinstance(analysis_seed, bool) or not isinstance(analysis_seed, int):
        raise ValueError("Sensitivity analysis_seed must be an integer.")

    source_digest = profile_sha256(profile)
    tagged_candidates = [
        {**candidate, "_analysis_source_index": index}
        for index, candidate in enumerate(candidates)
    ]
    baseline = score_candidates_v2(tagged_candidates, profile)
    baseline_by_index = {
        int(row["_analysis_source_index"]): row for row in baseline
    }
    configurations = generate_weight_perturbations(
        profile.component_weights,
        perturbation_magnitude=magnitude,
        number_of_samples=number_of_samples,
        analysis_seed=analysis_seed,
    )
    ranks_by_index: dict[int, list[int]] = {
        index: []
        for index, row in baseline_by_index.items()
        if row.get("v2_rank_eligible") is True and row.get("v2_rank") is not None
    }
    configuration_records = []
    for sample_index, weights in enumerate(configurations, start=1):
        derived_profile = replace(profile, component_weights=weights)
        sampled = score_candidates_v2(tagged_candidates, derived_profile)
        for row in sampled:
            source_index = int(row["_analysis_source_index"])
            rank = row.get("v2_rank")
            if source_index not in ranks_by_index and rank is not None:
                raise ValueError(
                    "Top-level weight perturbation unexpectedly changed baseline rank eligibility."
                )
            if source_index in ranks_by_index and isinstance(rank, int):
                ranks_by_index[source_index].append(rank)
        configuration_records.append({
            "sample_index": sample_index,
            "component_weights": dict(weights),
            "analysis_profile_sha256": profile_sha256(derived_profile),
        })

    population_size = len(ranks_by_index)
    molecule_results = []
    for source_index, ranks in ranks_by_index.items():
        baseline_row = baseline_by_index[source_index]
        valid_count = len(ranks)
        molecule_results.append({
            "source_index": source_index,
            "molecule_id": str(baseline_row.get("molecule_id") or ""),
            "baseline_rank": baseline_row["v2_rank"],
            "baseline_score": baseline_row["v2_score"],
            "minimum_rank": min(ranks) if ranks else None,
            "maximum_rank": max(ranks) if ranks else None,
            "median_rank": statistics.median(ranks) if ranks else None,
            "mean_rank": statistics.fmean(ranks) if ranks else None,
            "rank_standard_deviation": statistics.pstdev(ranks) if ranks else None,
            "top_1_frequency": _top_k_frequency(ranks, 1),
            "top_5_frequency": (
                _top_k_frequency(ranks, 5) if population_size >= 5 else None
            ),
            "top_10_frequency": (
                _top_k_frequency(ranks, 10) if population_size >= 10 else None
            ),
            "number_of_valid_perturbations": valid_count,
        })
    molecule_results.sort(key=lambda row: (
        _rank_sort_value(row.get("baseline_rank")),
        str(row["molecule_id"]).casefold(),
        int(row["source_index"]),
    ))
    excluded = []
    for source_index, row in baseline_by_index.items():
        if source_index in ranks_by_index:
            continue
        explanation = row.get("prioritization_v2")
        liabilities = explanation.get("liabilities", {}) if isinstance(explanation, Mapping) else {}
        excluded.append({
            "source_index": source_index,
            "molecule_id": str(row.get("molecule_id") or ""),
            "reason": "baseline_not_rank_eligible",
            "exclusion_reasons": list(liabilities.get("exclusion_reasons", [])),
        })

    return {
        "analysis_version": SENSITIVITY_ANALYSIS_VERSION,
        "explanatory_only": True,
        "provenance": {
            "source_profile_id": profile.profile_id,
            "source_profile_version": profile.profile_version,
            "source_profile_sha256": source_digest,
            "perturbation_method": PERTURBATION_METHOD,
            "perturbation_magnitude": magnitude,
            "number_of_samples": number_of_samples,
            "analysis_seed": analysis_seed,
            "analysis_version": SENSITIVITY_ANALYSIS_VERSION,
            "perturbed_fields": ["component_weights"],
        },
        "rank_eligible_molecule_count": population_size,
        "results": molecule_results,
        "excluded_unrankable": excluded,
        "perturbed_configurations": configuration_records,
    }


def generate_weight_perturbations(
    component_weights: Mapping[str, float],
    *,
    perturbation_magnitude: float,
    number_of_samples: int,
    analysis_seed: int,
) -> list[dict[str, float]]:
    """Generate deterministic relative perturbations normalized to sum to one."""

    magnitude = _validated_magnitude(perturbation_magnitude)
    source = {component: float(component_weights[component]) for component in COMPONENT_WEIGHT_IDS}
    if any(not math.isfinite(weight) or weight < 0 for weight in source.values()):
        raise ValueError("Sensitivity component weights must be finite and nonnegative.")
    if sum(source.values()) <= 0:
        raise ValueError("Sensitivity requires at least one positive component weight.")
    generator = random.Random(analysis_seed)
    configurations = []
    for _ in range(number_of_samples):
        perturbed = {
            component: weight * (1.0 + generator.uniform(-magnitude, magnitude))
            for component, weight in source.items()
        }
        total = sum(perturbed.values())
        configurations.append({
            component: perturbed[component] / total for component in COMPONENT_WEIGHT_IDS
        })
    return configurations


def _validated_dimensions(dimensions: Sequence[str]) -> tuple[str, ...]:
    if isinstance(dimensions, str) or not dimensions:
        raise ValueError("Pareto analysis requires at least one explicit dimension.")
    selected = tuple(dict.fromkeys(str(dimension) for dimension in dimensions))
    unknown = sorted(set(selected) - PARETO_DIMENSIONS)
    if unknown:
        raise ValueError(f"Unsupported Pareto dimensions: {', '.join(unknown)}")
    return selected


def _pareto_dimension(
    explanation: Mapping[str, object],
    dimension: str,
    source: Mapping[str, object],
    source_index: int,
) -> float:
    if dimension == "safety":
        liabilities = explanation.get("liabilities")
        value = liabilities.get("combined_penalty_factor") if isinstance(liabilities, Mapping) else None
    else:
        components = explanation.get("components")
        component = components.get(dimension) if isinstance(components, Mapping) else None
        value = component.get("score") if isinstance(component, Mapping) else None
    number = _finite_number(value)
    if number is None or not 0.0 <= number <= 1.0:
        molecule = str(source.get("molecule_id") or source_index)
        raise ValueError(
            f"Pareto dimension {dimension} is unavailable or not normalized for molecule {molecule}."
        )
    return number


def _dominates(
    left: Mapping[str, object], right: Mapping[str, object], dimensions: Sequence[str],
) -> bool:
    return all(float(left[key]) >= float(right[key]) for key in dimensions) and any(
        float(left[key]) > float(right[key]) for key in dimensions
    )


def _validated_magnitude(value: object) -> float:
    number = _finite_number(value)
    if number is None or not 0.0 <= number <= 1.0:
        raise ValueError("Sensitivity perturbation_magnitude must be between 0 and 1.")
    return number


def _finite_number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _rank_sort_value(value: object) -> float:
    return float(value) if isinstance(value, int) else math.inf


def _top_k_frequency(ranks: Sequence[int], k: int) -> float | None:
    if not ranks:
        return None
    return sum(rank <= k for rank in ranks) / len(ranks)
