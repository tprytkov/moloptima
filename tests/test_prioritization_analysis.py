from __future__ import annotations

import copy

import pytest

import molecular_prioritization.prioritization_analysis as analysis_module
from molecular_prioritization.desirability import TransformSpec
from molecular_prioritization.prioritization_analysis import (
    analyze_pareto_fronts,
    analyze_weight_sensitivity,
    generate_weight_perturbations,
)
from molecular_prioritization.prioritization_profiles import (
    DockingPolicy,
    EndpointRule,
    LiabilityPolicy,
    PrioritizationProfile,
    profile_sha256,
)
from molecular_prioritization.prioritization_v2 import score_candidates_v2


def rule(*, domain, role="objective", weight=1.0, transform=None):
    return EndpointRule(
        enabled=True,
        role=role,
        domain=domain,
        transform=transform or TransformSpec("identity_01", {}),
        weight=weight,
        required=True,
        missing_policy="unrankable",
        uncertainty_policy="warning_only",
        notes="Synthetic P2.4 analysis test rule.",
    )


def profile(*, gate=False):
    rules = {
        "hia_hou": rule(domain="absorption"),
        "QED": rule(domain="molecular_quality"),
    }
    domains = {"absorption": 1.0, "molecular_quality": 1.0}
    if gate:
        rules["ames"] = rule(
            domain="safety", role="gate", weight=0.0,
            transform=TransformSpec("threshold", {"threshold": 0.2, "operator": "lte"}),
        )
        domains["safety"] = 1.0
    return PrioritizationProfile(
        schema_version="moloptima-prioritization-profile-v2",
        profile_id="synthetic-p2.4-test-only",
        profile_version="0.0.4-test",
        status="draft",
        name="Synthetic P2.4 analysis profile; not production science",
        target_mode="custom",
        aggregation="weighted_arithmetic",
        component_weights={"docking": 0.0, "admet": 0.5, "molecular_quality": 0.5},
        domain_weights=domains,
        endpoint_rules=rules,
        missing_data_policy="renormalize_with_warning",
        uncertainty_policy="warning_only",
        liability_policy=LiabilityPolicy(
            penalty_aggregation="domain_weighted_arithmetic",
            gate_failure_behavior="exclude",
        ),
        docking_policy=DockingPolicy(normalization="within_library", docking_required=False),
    )


def candidate(molecule_id, hia, qed, *, ames=None):
    values = {"hia_hou": hia, "QED": qed}
    if ames is not None:
        values["ames"] = ames
    return {
        "molecule_id": molecule_id,
        "canonical_smiles": f"C{molecule_id}",
        "valid_molecule": True,
        "scientific_endpoint_values": values,
    }


def pareto_row(molecule_id, docking, admet, quality, safety=1.0, *, eligible=True, rank=1):
    return {
        "molecule_id": molecule_id,
        "v2_rank_eligible": eligible,
        "v2_rank": rank if eligible else None,
        "v2_score": 0.5 if eligible else None,
        "prioritization_v2": {
            "components": {
                "docking": {"score": docking},
                "admet": {"score": admet},
                "molecular_quality": {"score": quality},
            },
            "liabilities": {
                "combined_penalty_factor": safety,
                "exclusion_reasons": [] if eligible else ["gate_failed:ames"],
            },
        },
    }


def by_id(rows):
    return {row["molecule_id"]: row for row in rows}


def test_known_pareto_fronts_counts_and_identical_vectors_are_correct():
    rows = [
        pareto_row("dock", 1.0, 0.2, 0.5, rank=1),
        pareto_row("admet", 0.2, 1.0, 0.5, rank=2),
        pareto_row("balanced", 0.7, 0.7, 0.7, rank=3),
        pareto_row("balanced-tie", 0.7, 0.7, 0.7, rank=4),
        pareto_row("dominated", 0.3, 0.3, 0.3, rank=5),
    ]
    result = analyze_pareto_fronts(rows, ["docking", "admet", "molecular_quality"])
    found = by_id(result["results"])
    assert {found[name]["pareto_front"] for name in ("dock", "admet", "balanced", "balanced-tie")} == {1}
    assert found["dominated"]["pareto_front"] == 2
    assert found["balanced"]["pareto_dominated_by_count"] == 0
    assert found["balanced-tie"]["pareto_dominated_by_count"] == 0
    assert found["dominated"]["pareto_dominated_by_count"] == 2
    assert result["dimensions_used"] == ["docking", "admet", "molecular_quality"]


def test_pareto_excludes_unrankable_is_deterministic_and_never_modifies_scalar_results():
    rows = [
        pareto_row("eligible", 0.8, 0.8, 0.8),
        pareto_row("gated", 1.0, 1.0, 1.0, eligible=False),
    ]
    original = copy.deepcopy(rows)
    first = analyze_pareto_fronts(rows, ["docking", "admet", "molecular_quality", "safety"])
    second = analyze_pareto_fronts(rows, ["docking", "admet", "molecular_quality", "safety"])
    assert first == second
    assert [row["molecule_id"] for row in first["results"]] == ["eligible"]
    assert first["excluded_unrankable_count"] == 1
    assert rows == original


def test_pareto_rejects_legacy_results_without_a_v2_explanation():
    with pytest.raises(ValueError, match="requires Prioritization v2 explanations"):
        analyze_pareto_fronts(
            [{"molecule_id": "legacy", "priority_score": 0.8, "scientific_rank": 1}],
            ["admet"],
        )


def test_zero_perturbation_reproduces_baseline_and_source_profile_hash_unchanged():
    source_profile = profile()
    source_profile_dict = copy.deepcopy(source_profile.to_dict())
    source_hash = profile_sha256(source_profile)
    candidates = [candidate("a", 0.8, 0.9), candidate("b", 0.4, 0.3)]
    production = score_candidates_v2(candidates, source_profile)
    result = analyze_weight_sensitivity(
        candidates, source_profile,
        perturbation_magnitude=0.0, number_of_samples=8, analysis_seed=17,
    )
    baseline = {row["molecule_id"]: row for row in production}
    for row in result["results"]:
        assert row["minimum_rank"] == row["maximum_rank"] == row["baseline_rank"]
        assert row["baseline_score"] == baseline[row["molecule_id"]]["v2_score"]
        assert row["number_of_valid_perturbations"] == 8
    assert result["provenance"]["source_profile_sha256"] == source_hash
    assert profile_sha256(source_profile) == source_hash
    assert source_profile.to_dict() == source_profile_dict


def test_fixed_seed_normalized_weights_and_only_component_weights_change(monkeypatch):
    source_profile = profile()
    generated = generate_weight_perturbations(
        source_profile.component_weights,
        perturbation_magnitude=0.35, number_of_samples=12, analysis_seed=2025,
    )
    repeated = generate_weight_perturbations(
        source_profile.component_weights,
        perturbation_magnitude=0.35, number_of_samples=12, analysis_seed=2025,
    )
    assert generated == repeated
    assert all(sum(weights.values()) == pytest.approx(1.0) for weights in generated)

    observed_profiles = []
    production_score = analysis_module.score_candidates_v2

    def capture(candidates, derived_profile):
        observed_profiles.append(derived_profile)
        return production_score(candidates, derived_profile)

    monkeypatch.setattr(analysis_module, "score_candidates_v2", capture)
    analyze_weight_sensitivity(
        [candidate("a", 0.8, 0.2), candidate("b", 0.2, 0.8)],
        source_profile,
        perturbation_magnitude=0.35, number_of_samples=4, analysis_seed=2025,
    )
    source_without_weights = source_profile.to_dict()
    source_without_weights.pop("component_weights")
    for derived in observed_profiles[1:]:
        derived_without_weights = derived.to_dict()
        derived_without_weights.pop("component_weights")
        assert derived_without_weights == source_without_weights


def test_stable_fixture_has_fixed_rank_and_tradeoff_fixture_varies_without_input_mutation():
    source_profile = profile()
    stable = analyze_weight_sensitivity(
        [candidate("strong", 0.9, 0.9), candidate("weak", 0.1, 0.1)],
        source_profile,
        perturbation_magnitude=0.9, number_of_samples=80, analysis_seed=41,
    )
    assert by_id(stable["results"])["strong"]["minimum_rank"] == 1
    assert by_id(stable["results"])["strong"]["maximum_rank"] == 1

    tradeoff_candidates = [candidate("admet", 1.0, 0.0), candidate("quality", 0.0, 1.0)]
    original = copy.deepcopy(tradeoff_candidates)
    tradeoff = analyze_weight_sensitivity(
        tradeoff_candidates,
        source_profile,
        perturbation_magnitude=0.9, number_of_samples=120, analysis_seed=41,
    )
    assert by_id(tradeoff["results"])["admet"]["minimum_rank"] == 1
    assert by_id(tradeoff["results"])["admet"]["maximum_rank"] == 2
    assert by_id(tradeoff["results"])["admet"]["rank_standard_deviation"] > 0
    assert tradeoff_candidates == original


def test_hard_gated_molecule_remains_unrankable_in_every_analysis_sample():
    source_profile = profile(gate=True)
    result = analyze_weight_sensitivity(
        [candidate("pass", 0.8, 0.8, ames=0.1), candidate("gated", 1.0, 1.0, ames=0.9)],
        source_profile,
        perturbation_magnitude=0.8, number_of_samples=25, analysis_seed=5,
    )
    assert [row["molecule_id"] for row in result["results"]] == ["pass"]
    assert result["excluded_unrankable"][0]["molecule_id"] == "gated"
    assert "gate_failed:ames" in result["excluded_unrankable"][0]["exclusion_reasons"]
