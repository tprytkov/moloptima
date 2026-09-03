"""Opt-in, profile-driven Prioritization v2 scoring.

This module is deliberately separate from ``legacy_v1``.  Docking percentiles
use competition rank and ``(population_size - rank) / (population_size - 1)``;
a singleton population receives percentile 1.0.  Percentiles are explanatory
and never enter the score.
"""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Mapping, Sequence

from molecular_prioritization.desirability import apply_desirability
from molecular_prioritization.prioritization_profiles import (
    ADMET_SCORING_DOMAINS,
    PrioritizationProfile,
    profile_sha256,
)
from molecular_prioritization.scientific_endpoints import (
    SCIENTIFIC_ENDPOINTS,
    EndpointDefinition,
    ScientificEndpointRegistry,
)


PRIORITIZATION_METHOD_PROFILE_V2 = "profile_v2"
DOCKING_NORMALIZATION_METHOD = "within_library_min_max"
_REGRESSION_KEYS = {
    "Caco2_Wang": "caco2_wang",
    "Lipophilicity_AstraZeneca": "lipophilicity_astrazeneca",
    "Solubility_AqSolDB": "solubility_aqsoldb",
    "PPBR_AZ": "ppbr_az",
    "Vdss_Lombardo": "vdss_lombardo",
}


def score_candidates_v2(
    candidates: Sequence[Mapping[str, object]],
    profile: PrioritizationProfile,
    *,
    registry: ScientificEndpointRegistry = SCIENTIFIC_ENDPOINTS,
) -> list[dict[str, object]]:
    """Score copied candidate records through one explicit, validated v2 profile.

    The function never falls back to legacy scoring and never mutates its inputs.
    Test/integration callers may supply normalized values in
    ``scientific_endpoint_values`` and uncertainties in
    ``scientific_endpoint_uncertainties``.  Existing MolOptima result shapes are
    also read through the adapters below.
    """

    if not isinstance(profile, PrioritizationProfile):
        raise ValueError("Prioritization v2 requires a PrioritizationProfile.")
    profile_warnings = profile.validate_for_scoring(registry)
    digest = profile_sha256(profile)
    rows = [dict(candidate) for candidate in candidates]
    docking_contexts = _build_docking_contexts(rows, profile, registry)
    scored = [
        _score_one(
            row, profile, registry, docking_contexts[index],
            digest, profile_warnings,
        )
        for index, row in enumerate(rows)
    ]
    ranked_indices = sorted(
        (
            index for index, row in enumerate(scored)
            if row["v2_rank_eligible"] is True and _finite(row["v2_score"]) is not None
        ),
        key=lambda index: (
            -float(scored[index]["v2_score"]),
            str(scored[index].get("molecule_id") or "").casefold(),
            str(scored[index].get("canonical_smiles") or ""),
            index,
        ),
    )
    for rank, index in enumerate(ranked_indices, start=1):
        scored[index]["v2_rank"] = rank
        explanation = scored[index]["prioritization_v2"]
        explanation["summary"]["rank"] = rank
    ordered = sorted(
        scored,
        key=lambda row: (
            row["v2_rank"] is None,
            row["v2_rank"] if row["v2_rank"] is not None else math.inf,
            str(row.get("molecule_id") or "").casefold(),
        ),
    )
    return ordered


def _score_one(
    row: dict[str, object],
    profile: PrioritizationProfile,
    registry: ScientificEndpointRegistry,
    docking: dict[str, object],
    digest: str,
    profile_warnings: tuple[str, ...],
) -> dict[str, object]:
    endpoint_scoring: dict[str, dict[str, object]] = {}
    raw_values: dict[str, object] = {}
    raw_uncertainties: dict[str, object] = {}
    missing_records: list[dict[str, object]] = []
    warnings = list(profile_warnings)
    exclusions: list[str] = []
    objective_by_domain: dict[str, list[dict[str, object]]] = defaultdict(list)
    configured_objectives_by_domain: dict[str, list[str]] = defaultdict(list)
    liability_entries: list[dict[str, object]] = []
    uncertainty_entries: list[dict[str, object]] = []
    gates: list[dict[str, object]] = []

    if row.get("valid_molecule") is False:
        exclusions.append("invalid_molecule")

    for endpoint_id in sorted(profile.endpoint_rules):
        rule = profile.endpoint_rules[endpoint_id]
        if not rule.enabled:
            continue
        definition = registry.get(endpoint_id)
        raw = _endpoint_value(row, endpoint_id, definition)
        uncertainty = _endpoint_uncertainty(row, endpoint_id, definition)
        reported_raw = _json_safe_value(raw)
        reported_uncertainty = _json_safe_value(uncertainty)
        raw_values[endpoint_id] = reported_raw
        raw_uncertainties[endpoint_id] = reported_uncertainty
        endpoint = {
            "raw_value": reported_raw,
            "raw_uncertainty": reported_uncertainty,
            "transform": rule.transform.type,
            "transform_parameters": dict(rule.transform.params),
            "desirability": None,
            "role": rule.role,
            "domain": rule.domain,
            "configured_weight": rule.weight,
            "normalized_weight": None,
            "contribution": None,
            "missing_state": None,
            "uncertainty_state": _uncertainty_state(rule, uncertainty),
        }
        endpoint_scoring[endpoint_id] = endpoint
        if rule.role == "objective" and rule.weight > 0:
            configured_objectives_by_domain[rule.domain].append(endpoint_id)
        if endpoint_id == "best_vina_affinity_kcal_mol":
            raw = docking["best_vina_affinity_kcal_mol"]
            raw_values[endpoint_id] = raw
            endpoint["raw_value"] = raw

        if _usable_value(raw, definition) is None:
            missing = _missing_outcome(endpoint_id, rule)
            endpoint["missing_state"] = missing
            missing_records.append(missing)
            warnings.append(f"{endpoint_id} is missing; {missing['action_taken']}.")
            if rule.missing_policy == "unrankable":
                exclusions.append(f"missing_required_endpoint:{endpoint_id}")
            elif rule.missing_policy == "penalty":
                liability_entries.append(_factor_entry(endpoint_id, rule, 0.0, "missing_data"))
            _apply_uncertainty(
                endpoint_id, rule, uncertainty, endpoint["uncertainty_state"],
                uncertainty_entries, exclusions, warnings,
            )
            continue

        if endpoint_id == "best_vina_affinity_kcal_mol":
            desirability = docking["within_library_docking_desirability"]
            endpoint["transform"] = DOCKING_NORMALIZATION_METHOD
            endpoint["transform_parameters"] = {
                "campaign_best_vina_affinity_kcal_mol": docking[
                    "campaign_best_vina_affinity_kcal_mol"
                ],
                "campaign_worst_vina_affinity_kcal_mol": docking[
                    "campaign_worst_vina_affinity_kcal_mol"
                ],
            }
        else:
            desirability = apply_desirability(raw, rule.transform)
        endpoint["desirability"] = desirability

        if rule.role == "objective" and rule.weight > 0:
            objective_by_domain[rule.domain].append({
                "endpoint_id": endpoint_id,
                "weight": rule.weight,
                "desirability": desirability,
            })
        elif rule.role == "penalty" and rule.weight > 0:
            entry = _factor_entry(endpoint_id, rule, desirability, "endpoint_liability")
            liability_entries.append(entry)
        elif rule.role == "gate":
            passed = desirability >= 1.0
            gate = {
                "endpoint_id": endpoint_id,
                "desirability": desirability,
                "passed": passed,
                "failure_behavior": profile.liability_policy.gate_failure_behavior,
            }
            gates.append(gate)
            if not passed:
                exclusions.append(f"gate_failed:{endpoint_id}")

        _apply_uncertainty(
            endpoint_id, rule, uncertainty, endpoint["uncertainty_state"],
            uncertainty_entries, exclusions, warnings,
        )

    if profile.docking_policy.docking_required and docking[
        "best_vina_affinity_kcal_mol"
    ] is None:
        exclusions.append("required_docking_unavailable")

    domains: dict[str, dict[str, object]] = {}
    available_domain_weights: dict[str, float] = {}
    for domain in sorted(configured_objectives_by_domain):
        members = objective_by_domain.get(domain, [])
        weight_total = sum(float(member["weight"]) for member in members)
        domain_score = None
        available_ids = []
        if weight_total > 0:
            domain_score = 0.0
            for member in members:
                normalized = float(member["weight"]) / weight_total
                contribution = normalized * float(member["desirability"])
                endpoint = endpoint_scoring[str(member["endpoint_id"])]
                endpoint["normalized_weight"] = normalized
                endpoint["contribution"] = contribution
                domain_score += contribution
                available_ids.append(member["endpoint_id"])
        configured_domain_weight = float(profile.domain_weights.get(domain, 0.0))
        if configured_domain_weight > 0 and domain_score is not None:
            available_domain_weights[domain] = configured_domain_weight
        domains[domain] = {
            "member_endpoints": configured_objectives_by_domain[domain],
            "available_endpoints": available_ids,
            "missing_endpoints": sorted(
                set(configured_objectives_by_domain[domain]) - set(available_ids)
            ),
            "domain_score": domain_score,
            "configured_weight": configured_domain_weight,
            "normalized_weight": None,
            "domain_contribution": None,
        }

    components = _component_summary(
        domains, available_domain_weights, endpoint_scoring, profile
    )
    base_score = sum(float(component["contribution"]) for component in components.values())
    if not any(
        component["score"] is not None and float(component["configured_weight"]) > 0
        for component in components.values()
    ):
        base_score = None
        exclusions.append("no_available_scoring_components")
    liability_factor, liability_domains = _aggregate_factors(liability_entries, profile)
    uncertainty_factor, uncertainty_domains = _aggregate_factors(uncertainty_entries, profile)
    eligible = not exclusions and base_score is not None
    final_score = (
        _bounded(base_score * liability_factor * uncertainty_factor)
        if eligible else None
    )
    if final_score is None:
        eligible = False

    reference_affinity = profile.docking_policy.reference_best_vina_affinity_kcal_mol
    docking["reference_molecule_id"] = profile.docking_policy.reference_molecule_id
    docking["reference_best_vina_affinity_kcal_mol"] = reference_affinity
    docking["delta_vina_vs_reference_kcal_mol"] = (
        None
        if docking["best_vina_affinity_kcal_mol"] is None or reference_affinity is None
        else float(docking["best_vina_affinity_kcal_mol"]) - reference_affinity
    )
    explanation = {
        "raw_inputs": {
            "endpoint_raw_values": raw_values,
            "endpoint_uncertainty": raw_uncertainties,
            "best_vina_affinity_kcal_mol": docking["best_vina_affinity_kcal_mol"],
        },
        "docking": docking,
        "endpoint_scoring": endpoint_scoring,
        "domains": domains,
        "components": components,
        "molecular_quality": components["molecular_quality"],
        "liabilities": {
            "penalty_aggregation": profile.liability_policy.penalty_aggregation,
            "penalty_endpoints": liability_entries,
            "domain_factors": liability_domains,
            "combined_penalty_factor": liability_factor,
            "gates": gates,
            "exclusion_reasons": _unique(exclusions),
        },
        "missing_data": missing_records,
        "uncertainty": {
            "raw_values": raw_uncertainties,
            "endpoint_outcomes": {
                endpoint_id: values["uncertainty_state"]
                for endpoint_id, values in endpoint_scoring.items()
            },
            "penalty_endpoints": uncertainty_entries,
            "domain_factors": uncertainty_domains,
            "warnings": [warning for warning in warnings if "uncertainty" in warning.lower()],
            "factor": uncertainty_factor,
        },
        "warnings": _unique(warnings),
        "summary": {
            "base_score": base_score,
            "docking_contribution": components["docking"]["contribution"],
            "admet_contribution": components["admet"]["contribution"],
            "molecular_quality_contribution": components["molecular_quality"]["contribution"],
            "combined_liability_penalty_factor": liability_factor,
            "uncertainty_penalty_factor": uncertainty_factor,
            "final_score": final_score,
            "rank_eligible": eligible,
            "rank": None,
        },
        "provenance": {
            "prioritization_method": PRIORITIZATION_METHOD_PROFILE_V2,
            "profile_id": profile.profile_id,
            "profile_version": profile.profile_version,
            "profile_status": profile.status,
            "schema_version": profile.schema_version,
            "target_mode": profile.target_mode,
            "profile_sha256": digest,
            "component_weights_configured": {
                component: profile.component_weights[component]
                for component in sorted(profile.component_weights)
            },
            "component_weights_normalized": {
                component: components[component]["normalized_weight"]
                for component in ("admet", "docking", "molecular_quality")
            },
            "admet_domain_weights_configured": {
                domain: profile.domain_weights[domain]
                for domain in sorted(ADMET_SCORING_DOMAINS)
                if domain in profile.domain_weights
            },
            "admet_domain_weights_normalized": {
                domain: domains[domain]["normalized_weight"]
                for domain in sorted(ADMET_SCORING_DOMAINS)
                if domain in domains
            },
            "campaign_id": profile.docking_policy.campaign_id,
            "docking_normalization_method": DOCKING_NORMALIZATION_METHOD,
            "docking_normalization_scope": "relative_within_campaign",
        },
    }
    return {
        **row,
        "prioritization_method": PRIORITIZATION_METHOD_PROFILE_V2,
        "v2_score": final_score,
        "v2_rank_eligible": eligible,
        "v2_rank": None,
        "prioritization_v2": explanation,
    }


def _build_docking_contexts(
    rows: list[dict[str, object]],
    profile: PrioritizationProfile,
    registry: ScientificEndpointRegistry,
) -> list[dict[str, object]]:
    del profile, registry
    affinities: dict[int, float] = {}
    for index, row in enumerate(rows):
        if row.get("valid_molecule") is False:
            continue
        affinity = _successful_docking_affinity(row)
        if affinity is not None:
            affinities[index] = affinity
    population = len(affinities)
    campaign_best = min(affinities.values()) if affinities else None
    campaign_worst = max(affinities.values()) if affinities else None
    contexts = []
    for index in range(len(rows)):
        affinity = affinities.get(index)
        rank = None
        percentile = None
        desirability = None
        if affinity is not None:
            rank = 1 + sum(value < affinity for value in affinities.values())
            percentile = 1.0 if population == 1 else (population - rank) / (population - 1)
            desirability = (
                1.0 if campaign_best == campaign_worst
                else (float(campaign_worst) - affinity)
                / (float(campaign_worst) - float(campaign_best))
            )
        contexts.append({
            "best_vina_affinity_kcal_mol": affinity,
            "within_library_docking_desirability": desirability,
            "docking_rank": rank,
            "docking_percentile": percentile,
            "docking_percentile_formula": (
                "(docking_population_size - competition_rank) / "
                "(docking_population_size - 1); singleton=1.0"
            ),
            "campaign_best_vina_affinity_kcal_mol": campaign_best,
            "campaign_worst_vina_affinity_kcal_mol": campaign_worst,
            "docking_population_size": population,
            "normalization_scope": "relative_within_campaign",
        })
    return contexts


def _successful_docking_affinity(row: Mapping[str, object]) -> float | None:
    result = row.get("docking_result")
    if isinstance(result, Mapping) and result.get("status") not in {"success", "precomputed"}:
        return None
    direct = row.get("scientific_endpoint_values")
    if isinstance(direct, Mapping) and "best_vina_affinity_kcal_mol" in direct:
        return _finite(direct.get("best_vina_affinity_kcal_mol"))
    if "best_vina_affinity_kcal_mol" in row:
        return _finite(row.get("best_vina_affinity_kcal_mol"))
    if not isinstance(result, Mapping) or result.get("status") not in {"success", "precomputed"}:
        return None
    return _finite(result.get("best_vina_affinity_kcal_mol"))


def _endpoint_value(
    row: Mapping[str, object], endpoint_id: str, definition: EndpointDefinition,
) -> object:
    values = row.get("scientific_endpoint_values")
    if isinstance(values, Mapping) and endpoint_id in values:
        return values.get(endpoint_id)
    if endpoint_id == "best_vina_affinity_kcal_mol":
        return _successful_docking_affinity(row)
    if endpoint_id == "QED":
        return row.get("qed")
    if endpoint_id == "SA":
        return row.get("sa_score")
    if endpoint_id == "structural_alerts":
        return row.get("structural_alert_count")
    if endpoint_id == "gmc_mpnn_bbb":
        bbb = row.get("bbb_result")
        return bbb.get("ensemble_probability") if isinstance(bbb, Mapping) else None
    if endpoint_id in _REGRESSION_KEYS:
        regression = row.get("admet_regression")
        endpoints = regression.get("endpoints") if isinstance(regression, Mapping) else None
        result = endpoints.get(_REGRESSION_KEYS[endpoint_id]) if isinstance(endpoints, Mapping) else None
        if not isinstance(result, Mapping):
            return None
        uncertainty_field = definition.uncertainty_field or ""
        representation_field = uncertainty_field.replace(
            "seed_standard_deviation_", "ensemble_mean_", 1
        )
        return result.get(representation_field, result.get("ensemble_mean_value"))
    endpoints = row.get("admet_predictions")
    result = endpoints.get(endpoint_id) if isinstance(endpoints, Mapping) else None
    if isinstance(result, Mapping):
        calibrated = _finite(result.get("calibrated_probability"))
        return calibrated if calibrated is not None else result.get("raw_probability")
    return None


def _endpoint_uncertainty(
    row: Mapping[str, object], endpoint_id: str, definition: EndpointDefinition,
) -> object:
    values = row.get("scientific_endpoint_uncertainties")
    if isinstance(values, Mapping) and endpoint_id in values:
        return values.get(endpoint_id)
    if definition.uncertainty_field is None:
        return None
    if endpoint_id == "gmc_mpnn_bbb":
        bbb = row.get("bbb_result")
        return bbb.get("ensemble_standard_deviation") if isinstance(bbb, Mapping) else None
    if endpoint_id in _REGRESSION_KEYS:
        regression = row.get("admet_regression")
        endpoints = regression.get("endpoints") if isinstance(regression, Mapping) else None
        result = endpoints.get(_REGRESSION_KEYS[endpoint_id]) if isinstance(endpoints, Mapping) else None
        if not isinstance(result, Mapping):
            return None
        return result.get(definition.uncertainty_field, result.get("seed_standard_deviation_value"))
    return None


def _missing_outcome(endpoint_id: str, rule) -> dict[str, object]:
    actions = {
        "renormalize_with_warning": "excluded_from_normalization_with_warning",
        "penalty": "separate_zero_penalty_factor_applied",
        "unrankable": "candidate_marked_unrankable",
        "warning_only": "excluded_from_normalization_with_warning_only",
    }
    return {
        "endpoint_id": endpoint_id,
        "configured_policy": rule.missing_policy,
        "required": rule.required,
        "action_taken": actions[rule.missing_policy],
        "effect_on_normalization": "endpoint_not_included",
        "effect_on_score_ranking": (
            "rank_ineligible" if rule.missing_policy == "unrankable"
            else "penalty_factor_zero" if rule.missing_policy == "penalty"
            else "available_weights_renormalized"
        ),
    }


def _uncertainty_state(rule, uncertainty: object) -> dict[str, object]:
    return {
        "raw_uncertainty": uncertainty,
        "policy": rule.uncertainty_policy,
        "transform": (
            None if rule.uncertainty_transform is None
            else rule.uncertainty_transform.to_dict()
        ),
        "interpretation": "ensemble_disagreement_not_calibrated_uncertainty_probability",
    }


def _apply_uncertainty(
    endpoint_id: str,
    rule,
    uncertainty: object,
    state: dict[str, object],
    entries: list[dict[str, object]],
    exclusions: list[str],
    warnings: list[str],
) -> None:
    value = _finite(uncertainty)
    if value is None:
        state.update({"action": "not_available", "warning": None, "penalty_factor": None})
        return
    if rule.uncertainty_policy == "warning_only":
        warning = f"{endpoint_id} raw ensemble uncertainty is reported warning-only."
        warnings.append(warning)
        state.update({"action": "warning_only", "warning": warning, "penalty_factor": None})
        return
    factor = apply_desirability(value, rule.uncertainty_transform)
    if rule.uncertainty_policy == "penalty":
        entries.append(_factor_entry(endpoint_id, rule, factor, "uncertainty"))
        state.update({"action": "penalty_applied", "warning": None, "penalty_factor": factor})
    elif factor < 1.0:
        exclusions.append(f"uncertainty_threshold_failed:{endpoint_id}")
        state.update({
            "action": "candidate_marked_unrankable",
            "warning": f"{endpoint_id} exceeded the configured uncertainty threshold.",
            "penalty_factor": None,
        })
    else:
        state.update({"action": "threshold_passed", "warning": None, "penalty_factor": None})


def _factor_entry(endpoint_id: str, rule, factor: float, source: str) -> dict[str, object]:
    return {
        "endpoint_id": endpoint_id,
        "domain": rule.domain,
        "configured_weight": rule.weight,
        "factor": _bounded(factor),
        "source": source,
    }


def _aggregate_factors(
    entries: list[dict[str, object]], profile: PrioritizationProfile,
) -> tuple[float, dict[str, object]]:
    if not entries:
        return 1.0, {}
    grouped: dict[str, list[dict[str, object]]] = defaultdict(list)
    for entry in entries:
        grouped[str(entry["domain"])].append(entry)
    domains: dict[str, object] = {}
    weighted = 0.0
    domain_total = 0.0
    for domain in sorted(grouped):
        members = grouped[domain]
        endpoint_total = sum(float(member["configured_weight"]) for member in members)
        if endpoint_total <= 0:
            continue
        domain_factor = sum(
            float(member["configured_weight"]) * float(member["factor"])
            for member in members
        ) / endpoint_total
        configured = float(profile.domain_weights.get(domain, 0.0))
        domains[domain] = {
            "member_endpoints": [member["endpoint_id"] for member in members],
            "factor": domain_factor,
            "configured_weight": configured,
        }
        if configured > 0:
            weighted += configured * domain_factor
            domain_total += configured
    return ((weighted / domain_total) if domain_total > 0 else 1.0), domains


def _component_summary(
    domains: dict[str, dict[str, object]],
    available_weights: Mapping[str, float],
    endpoint_scoring: Mapping[str, Mapping[str, object]],
    profile: PrioritizationProfile,
) -> dict[str, dict[str, object]]:
    groups = {
        "admet": ADMET_SCORING_DOMAINS,
        "molecular_quality": frozenset({"molecular_quality"}),
        "docking": frozenset({"docking"}),
    }
    components: dict[str, dict[str, object]] = {}
    for name, group in groups.items():
        members = sorted(
            domain for domain in domains if domain in group and domain in available_weights
        )
        internal_weight_total = sum(available_weights[domain] for domain in members)
        score = None
        if internal_weight_total > 0:
            score = 0.0
            for domain in members:
                normalized = available_weights[domain] / internal_weight_total
                contribution = normalized * float(domains[domain]["domain_score"])
                domains[domain]["normalized_weight"] = normalized
                domains[domain]["domain_contribution"] = contribution
                score += contribution
        configured = float(profile.component_weights[name])
        components[name] = {
            "member_domains": members,
            "underlying_endpoint_desirabilities": {
                endpoint_id: endpoint_scoring[endpoint_id]["desirability"]
                for domain in members
                for endpoint_id in domains[domain]["member_endpoints"]
            },
            "score": score,
            "configured_weight": configured,
            "normalized_weight": 0.0,
            "contribution": 0.0,
        }
    total = sum(
        float(component["configured_weight"])
        for component in components.values()
        if component["score"] is not None and float(component["configured_weight"]) > 0
    )
    if total > 0:
        for component in components.values():
            configured = float(component["configured_weight"])
            if configured <= 0 or component["score"] is None:
                continue
            normalized = configured / total
            component["normalized_weight"] = normalized
            component["contribution"] = normalized * float(component["score"])
    return components


def _usable_value(value: object, definition: EndpointDefinition) -> object | None:
    if definition.value_type == "categorical":
        return value if isinstance(value, str) else None
    if definition.value_type == "boolean":
        return value if isinstance(value, bool) else None
    return _finite(value)


def _finite(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _bounded(value: float) -> float:
    if not math.isfinite(value):
        raise ValueError("Prioritization v2 produced a non-finite score.")
    return min(1.0, max(0.0, value))


def _json_safe_value(value: object) -> object:
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def _unique(values: list[str]) -> list[str]:
    return list(dict.fromkeys(values))
