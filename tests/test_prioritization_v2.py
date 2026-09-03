from __future__ import annotations

import copy
import math

import pytest

from molecular_prioritization.desirability import TransformSpec, apply_desirability
from molecular_prioritization.docking import add_docking_informed_scores
from molecular_prioritization.pipeline import prioritize_smiles
from molecular_prioritization.prioritization import (
    PRIORITIZATION_METHOD_LEGACY_V1,
    finalize_scientific_prioritization,
)
from molecular_prioritization.prioritization_profiles import (
    DockingPolicy,
    EndpointRule,
    LiabilityPolicy,
    PrioritizationProfile,
    profile_sha256,
)
from molecular_prioritization.prioritization_v2 import (
    DOCKING_NORMALIZATION_METHOD,
    PRIORITIZATION_METHOD_PROFILE_V2,
    score_candidates_v2,
)
from molecular_prioritization.scientific_endpoints import (
    PRODUCTION_ENDPOINT_DEFINITIONS,
    EndpointDefinition,
    ScientificEndpointRegistry,
)


def rule(
    *,
    role="objective",
    domain="molecular_quality",
    transform=None,
    weight=1.0,
    required=True,
    missing_policy="unrankable",
    uncertainty_policy="warning_only",
    uncertainty_transform=None,
):
    return EndpointRule(
        enabled=True,
        role=role,
        domain=domain,
        transform=transform or TransformSpec("identity_01", {}),
        weight=weight,
        required=required,
        missing_policy=missing_policy,
        uncertainty_policy=uncertainty_policy,
        notes="Synthetic P2.2 test-only rule.",
        uncertainty_transform=uncertainty_transform,
    )


def profile(
    rules,
    weights,
    component_weights,
    *,
    target_mode="custom",
    docking_required=False,
    reference=None,
    campaign_id="synthetic-campaign",
):
    return PrioritizationProfile(
        schema_version="moloptima-prioritization-profile-v2",
        profile_id="synthetic-p2.2-test-only",
        profile_version="0.0.2-test",
        status="draft",
        name="Synthetic P2.2 profile; not a scientific production profile",
        target_mode=target_mode,
        aggregation="weighted_arithmetic",
        component_weights=component_weights,
        domain_weights=weights,
        endpoint_rules=rules,
        missing_data_policy="renormalize_with_warning",
        uncertainty_policy="warning_only",
        liability_policy=LiabilityPolicy(
            penalty_aggregation="domain_weighted_arithmetic",
            gate_failure_behavior="exclude",
        ),
        docking_policy=DockingPolicy(
            normalization="within_library",
            docking_required=docking_required,
            campaign_id=campaign_id,
            reference_molecule_id="reference-test" if reference is not None else None,
            reference_best_vina_affinity_kcal_mol=reference,
        ),
    )


def candidate(molecule_id, values, *, uncertainties=None, valid=True, modes=None, status="success"):
    row = {
        "molecule_id": molecule_id,
        "canonical_smiles": f"C{molecule_id}",
        "valid_molecule": valid,
        "scientific_endpoint_values": dict(values),
        "scientific_endpoint_uncertainties": dict(uncertainties or {}),
    }
    if "best_vina_affinity_kcal_mol" in values:
        row["docking_result"] = {
            "status": status,
            "best_vina_affinity_kcal_mol": values["best_vina_affinity_kcal_mol"],
            "modes": modes or [],
        }
    return row


def by_id(rows):
    return {row["molecule_id"]: row for row in rows}


def explanation(row):
    return row["prioritization_v2"]


ADMET_ONLY = {"docking": 0.0, "admet": 1.0, "molecular_quality": 0.0}
DOCKING_ONLY = {"docking": 1.0, "admet": 0.0, "molecular_quality": 0.0}
QUALITY_ONLY = {"docking": 0.0, "admet": 0.0, "molecular_quality": 1.0}


def test_fixed_legacy_v1_score_and_rank_parity_and_default_path(monkeypatch):
    rows = [
        {"molecule_id": "strong", "canonical_smiles": "CC", "valid_molecule": True,
         "priority_score": 0.8, "docking_score": -10.0, "docking_status": "provided",
         "prioritization": {"components": {}, "warnings": []}},
        {"molecule_id": "weak", "canonical_smiles": "CCC", "valid_molecule": True,
         "priority_score": 0.6, "docking_score": -5.0, "docking_status": "provided",
         "prioritization": {"components": {}, "warnings": []}},
    ]
    scored = add_docking_informed_scores(copy.deepcopy(rows))
    assert [row["combined_candidate_score"] for row in scored] == [0.86, 0.42]
    ranked = finalize_scientific_prioritization(scored)
    assert [(row["molecule_id"], row["scientific_rank"]) for row in ranked] == [
        ("strong", 1), ("weak", 2)
    ]
    assert PRIORITIZATION_METHOD_LEGACY_V1 == "legacy_v1"
    assert PRIORITIZATION_METHOD_PROFILE_V2 == "profile_v2"
    default = prioritize_smiles([{"molecule_id": "default", "smiles": "CCO"}])
    assert "prioritization_v2" not in default[0]


def test_docking_normalization_context_rank_percentile_and_modes_are_explanatory_only():
    p = profile(
        {"best_vina_affinity_kcal_mol": rule(domain="docking")}, {"docking": 1},
        DOCKING_ONLY,
    )
    rows = score_candidates_v2([
        candidate("best", {"best_vina_affinity_kcal_mol": -10}, modes=[
            {"affinity_kcal_mol": -50}, {"affinity_kcal_mol": -1}
        ]),
        candidate("middle", {"best_vina_affinity_kcal_mol": -7.5}, modes=[
            {"affinity_kcal_mol": -100}
        ]),
        candidate("worst", {"best_vina_affinity_kcal_mol": -5}),
    ], p)
    contexts = {key: explanation(value)["docking"] for key, value in by_id(rows).items()}
    assert contexts["best"]["within_library_docking_desirability"] == 1
    assert contexts["middle"]["within_library_docking_desirability"] == pytest.approx(0.5)
    assert contexts["worst"]["within_library_docking_desirability"] == 0
    assert [contexts[key]["docking_rank"] for key in ("best", "middle", "worst")] == [1, 2, 3]
    assert [contexts[key]["docking_percentile"] for key in ("best", "middle", "worst")] == [1, 0.5, 0]
    for context in contexts.values():
        assert context["campaign_best_vina_affinity_kcal_mol"] == -10
        assert context["campaign_worst_vina_affinity_kcal_mol"] == -5
        assert context["docking_population_size"] == 3
        assert context["normalization_scope"] == "relative_within_campaign"
    assert explanation(by_id(rows)["best"])["endpoint_scoring"][
        "best_vina_affinity_kcal_mol"
    ]["transform"] == DOCKING_NORMALIZATION_METHOD


def test_identical_docking_is_one_with_competition_rank_and_singleton_percentile():
    p = profile(
        {"best_vina_affinity_kcal_mol": rule(domain="docking")},
        {"docking": 1}, DOCKING_ONLY,
    )
    equal = score_candidates_v2([
        candidate("b", {"best_vina_affinity_kcal_mol": -7}),
        candidate("a", {"best_vina_affinity_kcal_mol": -7}),
    ], p)
    for row in equal:
        context = explanation(row)["docking"]
        assert context["within_library_docking_desirability"] == 1
        assert context["docking_rank"] == 1
        assert context["docking_percentile"] == 1
    singleton = score_candidates_v2([
        candidate("one", {"best_vina_affinity_kcal_mol": -8})
    ], p)[0]
    assert explanation(singleton)["docking"]["docking_percentile"] == 1


@pytest.mark.parametrize("bad", [None, float("nan"), float("inf"), float("-inf")])
def test_failed_missing_or_nonfinite_docking_is_excluded_from_population(bad):
    p = profile(
        {"best_vina_affinity_kcal_mol": rule(domain="docking", missing_policy="warning_only")},
        {"docking": 1},
        DOCKING_ONLY,
    )
    values = {} if bad is None else {"best_vina_affinity_kcal_mol": bad}
    rows = score_candidates_v2([
        candidate("valid", {"best_vina_affinity_kcal_mol": -8}),
        candidate("bad", values, status="docking_failed"),
    ], p)
    context = explanation(by_id(rows)["bad"])["docking"]
    assert context["best_vina_affinity_kcal_mol"] is None
    assert context["docking_rank"] is None
    assert context["docking_population_size"] == 1


def test_finite_affinity_from_failed_docking_status_is_not_normalized():
    p = profile({
        "QED": rule(),
        "best_vina_affinity_kcal_mol": rule(
            domain="docking", required=False, missing_policy="warning_only"
        ),
    }, {"molecular_quality": 1, "docking": 1}, {
        "docking": 0.5, "admet": 0, "molecular_quality": 0.5,
    })
    failed = {
        "molecule_id": "failed", "canonical_smiles": "CC", "valid_molecule": True,
        "scientific_endpoint_values": {"QED": 0.8},
        "docking_result": {
            "status": "docking_failed", "best_vina_affinity_kcal_mol": -99,
        },
    }
    valid = candidate("valid", {"QED": 0.7, "best_vina_affinity_kcal_mol": -7})
    rows = score_candidates_v2([failed, valid], p)
    context = explanation(by_id(rows)["failed"])["docking"]
    assert context["best_vina_affinity_kcal_mol"] is None
    assert context["docking_population_size"] == 1


def test_reference_delta_is_optional_correct_and_explanatory_only():
    rules = {"best_vina_affinity_kcal_mol": rule(domain="docking")}
    row = candidate("mol", {"best_vina_affinity_kcal_mol": -8})
    without = score_candidates_v2([
        row
    ], profile(rules, {"docking": 1}, DOCKING_ONLY, reference=None))[0]
    with_reference = score_candidates_v2(
        [row], profile(rules, {"docking": 1}, DOCKING_ONLY, reference=-7.25)
    )[0]
    assert explanation(without)["docking"]["delta_vina_vs_reference_kcal_mol"] is None
    assert explanation(with_reference)["docking"]["delta_vina_vs_reference_kcal_mol"] == -0.75
    assert without["v2_score"] == with_reference["v2_score"] == 1


def test_profile_required_docking_missing_is_explicitly_unrankable():
    p = profile(
        {"QED": rule()}, {"molecular_quality": 1}, QUALITY_ONLY,
        docking_required=True,
    )
    row = score_candidates_v2([candidate("mol", {"QED": 0.9})], p)[0]
    assert row["v2_score"] is None and row["v2_rank"] is None
    assert "required_docking_unavailable" in explanation(row)["liabilities"][
        "exclusion_reasons"
    ]


def test_generic_transform_endpoint_and_within_domain_normalization():
    transform = TransformSpec("increasing_sigmoid", {"midpoint": 0.5, "slope": 4})
    p = profile({
        "hia_hou": rule(domain="absorption", transform=transform, weight=3),
        "Caco2_Wang": rule(domain="absorption", weight=1),
    }, {"absorption": 1}, ADMET_ONLY)
    row = score_candidates_v2([
        candidate("mol", {"hia_hou": 0.75, "Caco2_Wang": 0.25})
    ], p)[0]
    endpoints = explanation(row)["endpoint_scoring"]
    expected_hia = apply_desirability(0.75, transform)
    assert endpoints["hia_hou"]["desirability"] == pytest.approx(expected_hia)
    assert endpoints["hia_hou"]["normalized_weight"] == 0.75
    assert endpoints["Caco2_Wang"]["normalized_weight"] == 0.25
    expected = 0.75 * expected_hia + 0.25 * 0.25
    assert explanation(row)["domains"]["absorption"]["domain_score"] == pytest.approx(expected)
    assert row["v2_score"] == pytest.approx(expected)


def test_existing_public_admet_result_shapes_are_adapted_without_changing_them():
    rules = {
        "hia_hou": rule(domain="absorption"),
        "gmc_mpnn_bbb": rule(domain="distribution_cns"),
        "Caco2_Wang": rule(
            domain="absorption",
            transform=TransformSpec("increasing_sigmoid", {"midpoint": -5, "slope": 1}),
        ),
    }
    p = profile(rules, {"absorption": 1, "distribution_cns": 1}, ADMET_ONLY)
    source = {
        "molecule_id": "public-shape",
        "canonical_smiles": "CCO",
        "valid_molecule": True,
        "admet_predictions": {
            "hia_hou": {"calibrated_probability": 0.7, "raw_probability": 0.6}
        },
        "bbb_result": {
            "ensemble_probability": 0.8,
            "ensemble_standard_deviation": 0.0424,
            "threshold_status": "provisional_raw",
            "calibration_status": "not_frozen",
        },
        "admet_regression": {"endpoints": {"caco2_wang": {
            "ensemble_mean_log10_papp_cm_per_s": -4.5,
            "seed_standard_deviation_log10_papp_cm_per_s": 0.12,
        }}},
    }
    before = copy.deepcopy(source)
    row = score_candidates_v2([source], p)[0]
    raw = explanation(row)["raw_inputs"]
    assert raw["endpoint_raw_values"] == {
        "hia_hou": 0.7, "gmc_mpnn_bbb": 0.8, "Caco2_Wang": -4.5,
    }
    assert raw["endpoint_uncertainty"] == {
        "hia_hou": None, "gmc_mpnn_bbb": 0.0424, "Caco2_Wang": 0.12,
    }
    assert source == before


def test_endpoint_count_does_not_implicitly_increase_domain_importance_and_admet_aggregates():
    rules = {
        "hia_hou": rule(domain="absorption"),
        "cyp1a2_veith": rule(domain="metabolism_transport"),
        "cyp2c19_veith": rule(domain="metabolism_transport"),
        "cyp2c9_veith": rule(domain="metabolism_transport"),
        "cyp2d6_veith": rule(domain="metabolism_transport"),
        "cyp3a4_veith": rule(domain="metabolism_transport"),
    }
    values = {"hia_hou": 1, **{key: 0 for key in rules if key.startswith("cyp")}}
    row = score_candidates_v2([
        candidate("mol", values)
    ], profile(
        rules, {"absorption": 1, "metabolism_transport": 1}, ADMET_ONLY,
    ))[0]
    domains = explanation(row)["domains"]
    assert domains["absorption"]["normalized_weight"] == 0.5
    assert domains["metabolism_transport"]["normalized_weight"] == 0.5
    assert row["v2_score"] == 0.5
    admet = explanation(row)["components"]["admet"]
    assert admet["score"] == 0.5
    assert admet["normalized_weight"] == 1


def test_quality_component_and_configurable_top_level_weights_reconstruct_base_score():
    rules = {
        "QED": rule(domain="molecular_quality", weight=1),
        "SA": rule(
            domain="molecular_quality", weight=1,
            transform=TransformSpec("decreasing_sigmoid", {"midpoint": 5, "slope": 2}),
        ),
        "hia_hou": rule(domain="absorption"),
        "best_vina_affinity_kcal_mol": rule(domain="docking"),
    }
    p = profile(
        rules, {"molecular_quality": 2, "absorption": 3, "docking": 5},
        {"docking": 50, "admet": 30, "molecular_quality": 20},
    )
    row = score_candidates_v2([
        candidate("mol", {"QED": 0.8, "SA": 5, "hia_hou": 0.6,
                          "best_vina_affinity_kcal_mol": -8})
    ], p)[0]
    result = explanation(row)
    quality = result["molecular_quality"]
    assert quality["score"] == pytest.approx((0.8 + 0.5) / 2)
    assert quality["underlying_endpoint_desirabilities"] == {"QED": 0.8, "SA": 0.5}
    assert result["components"]["admet"]["normalized_weight"] == 0.3
    assert quality["normalized_weight"] == 0.2
    assert result["components"]["docking"]["normalized_weight"] == 0.5
    assert result["domains"]["absorption"]["domain_contribution"] == pytest.approx(0.6)
    assert sum(
        component["contribution"] for component in result["components"].values()
        if component["contribution"] is not None
    ) == pytest.approx(result["summary"]["base_score"])
    assert result["provenance"]["component_weights_configured"] == {
        "admet": 30.0, "docking": 50.0, "molecular_quality": 20.0,
    }
    assert result["provenance"]["component_weights_normalized"] == {
        "admet": 0.3, "docking": 0.5, "molecular_quality": 0.2,
    }
    assert result["summary"]["base_score"] == pytest.approx(
        result["summary"]["docking_contribution"]
        + result["summary"]["admet_contribution"]
        + result["summary"]["molecular_quality_contribution"]
    )


def test_internal_admet_domain_weights_change_composition_not_top_level_admet_weight():
    rules = {
        "hia_hou": rule(domain="absorption"),
        "gmc_mpnn_bbb": rule(domain="distribution_cns"),
        "QED": rule(),
    }
    values = {"hia_hou": 1.0, "gmc_mpnn_bbb": 0.0, "QED": 0.5}
    components = {"docking": 0, "admet": 4, "molecular_quality": 4}
    absorption_heavy = profile(
        rules, {"absorption": 3, "distribution_cns": 1, "molecular_quality": 1},
        components,
    )
    distribution_heavy = profile(
        rules, {"absorption": 1, "distribution_cns": 3, "molecular_quality": 1},
        components,
    )
    first = explanation(score_candidates_v2([candidate("mol", values)], absorption_heavy)[0])
    second = explanation(score_candidates_v2([candidate("mol", values)], distribution_heavy)[0])
    assert first["components"]["admet"]["score"] == 0.75
    assert second["components"]["admet"]["score"] == 0.25
    assert first["components"]["admet"]["normalized_weight"] == 0.5
    assert second["components"]["admet"]["normalized_weight"] == 0.5
    assert first["provenance"]["admet_domain_weights_normalized"] == {
        "absorption": 0.75, "distribution_cns": 0.25,
    }
    assert second["provenance"]["admet_domain_weights_normalized"] == {
        "absorption": 0.25, "distribution_cns": 0.75,
    }


def test_changing_top_level_admet_weight_does_not_change_internal_admet_composition():
    rules = {"hia_hou": rule(domain="absorption"), "QED": rule()}
    values = {"hia_hou": 0.8, "QED": 0.2}
    domains = {"absorption": 7, "molecular_quality": 11}
    admet_heavy = profile(
        rules, domains, {"docking": 0, "admet": 8, "molecular_quality": 2}
    )
    quality_heavy = profile(
        rules, domains, {"docking": 0, "admet": 2, "molecular_quality": 8}
    )
    first = explanation(score_candidates_v2([candidate("mol", values)], admet_heavy)[0])
    second = explanation(score_candidates_v2([candidate("mol", values)], quality_heavy)[0])
    assert first["components"]["admet"]["score"] == second["components"]["admet"]["score"] == 0.8
    assert first["summary"]["admet_contribution"] == pytest.approx(0.64)
    assert second["summary"]["admet_contribution"] == pytest.approx(0.16)


def test_endpoint_count_does_not_change_explicit_top_level_component_weight():
    components = {"docking": 0, "admet": 4, "molecular_quality": 6}
    one_admet_rule = {"hia_hou": rule(domain="absorption"), "QED": rule()}
    many_admet_rules = {
        **one_admet_rule,
        "cyp1a2_veith": rule(domain="metabolism_transport"),
        "cyp2c19_veith": rule(domain="metabolism_transport"),
        "cyp2c9_veith": rule(domain="metabolism_transport"),
        "cyp2d6_veith": rule(domain="metabolism_transport"),
        "cyp3a4_veith": rule(domain="metabolism_transport"),
    }
    values = {endpoint: 0.5 for endpoint in many_admet_rules}
    one = profile(
        one_admet_rule, {"absorption": 1, "molecular_quality": 1}, components,
    )
    many = profile(
        many_admet_rules,
        {"absorption": 1, "metabolism_transport": 1, "molecular_quality": 1},
        components,
    )
    first = explanation(score_candidates_v2([candidate("mol", values)], one)[0])
    second = explanation(score_candidates_v2([candidate("mol", values)], many)[0])
    assert first["components"]["admet"]["normalized_weight"] == 0.4
    assert second["components"]["admet"]["normalized_weight"] == 0.4


def test_soft_penalties_are_domain_aggregated_deterministically_and_never_increase_score():
    rules = {
        "QED": rule(),
        "herg_karim": rule(role="penalty", domain="safety", weight=1),
        "ames": rule(role="penalty", domain="safety", weight=3),
    }
    p = profile(rules, {"molecular_quality": 1, "safety": 2}, QUALITY_ONLY)
    row = score_candidates_v2([
        candidate("mol", {"QED": 0.8, "herg_karim": 0.5, "ames": 0.25})
    ], p)[0]
    summary = explanation(row)["summary"]
    assert summary["combined_liability_penalty_factor"] == pytest.approx(0.3125)
    assert summary["final_score"] == pytest.approx(0.8 * 0.3125)
    assert summary["final_score"] <= summary["base_score"]


def test_hard_gate_excludes_without_encoding_exclusion_as_zero():
    p = profile({
        "QED": rule(),
        "ames": rule(
            role="gate", domain="safety", weight=0,
            transform=TransformSpec("threshold", {"threshold": 0.2, "operator": "lte"}),
        ),
    }, {"molecular_quality": 1, "safety": 1}, QUALITY_ONLY)
    row = score_candidates_v2([candidate("mol", {"QED": 0.9, "ames": 0.8})], p)[0]
    assert row["v2_rank_eligible"] is False
    assert row["v2_score"] is None
    assert row["v2_rank"] is None
    assert "gate_failed:ames" in explanation(row)["liabilities"]["exclusion_reasons"]


@pytest.mark.parametrize(
    ("policy", "eligible", "expected_score", "action"),
    [
        ("renormalize_with_warning", True, 0.8, "excluded_from_normalization_with_warning"),
        ("warning_only", True, 0.8, "excluded_from_normalization_with_warning_only"),
        ("penalty", True, 0.0, "separate_zero_penalty_factor_applied"),
        ("unrankable", False, None, "candidate_marked_unrankable"),
    ],
)
def test_missing_data_policies_never_convert_missing_raw_value_to_zero(
    policy, eligible, expected_score, action
):
    p = profile({
        "QED": rule(),
        "SA": rule(required=False, missing_policy=policy),
    }, {"molecular_quality": 1}, QUALITY_ONLY)
    row = score_candidates_v2([candidate("mol", {"QED": 0.8})], p)[0]
    result = explanation(row)
    assert result["raw_inputs"]["endpoint_raw_values"]["SA"] is None
    assert result["endpoint_scoring"]["SA"]["desirability"] is None
    assert result["missing_data"][0]["action_taken"] == action
    assert result["domains"]["molecular_quality"]["missing_endpoints"] == ["SA"]
    assert row["v2_rank_eligible"] is eligible
    assert row["v2_score"] == expected_score


def test_uncertainty_warning_only_preserves_raw_gmc_sd_and_score():
    p = profile(
        {"gmc_mpnn_bbb": rule(domain="distribution_cns")},
        {"distribution_cns": 1}, ADMET_ONLY,
    )
    row = score_candidates_v2([
        candidate("mol", {"gmc_mpnn_bbb": 0.7}, uncertainties={"gmc_mpnn_bbb": 0.0424})
    ], p)[0]
    result = explanation(row)
    assert result["raw_inputs"]["endpoint_uncertainty"]["gmc_mpnn_bbb"] == 0.0424
    assert result["uncertainty"]["factor"] == 1
    assert row["v2_score"] == 0.7
    assert "not_calibrated_uncertainty_probability" in result[
        "endpoint_scoring"
    ]["gmc_mpnn_bbb"]["uncertainty_state"]["interpretation"]


def test_explicit_generic_regression_uncertainty_penalty_uses_profile_transform():
    uncertainty_transform = TransformSpec(
        "decreasing_sigmoid", {"midpoint": 0.2, "slope": 10}
    )
    p = profile({
        "Caco2_Wang": rule(
            domain="absorption", uncertainty_policy="penalty",
            uncertainty_transform=uncertainty_transform,
        )
    }, {"absorption": 1}, ADMET_ONLY)
    configured_rule = p.endpoint_rules["Caco2_Wang"]
    assert EndpointRule.from_dict(configured_rule.to_dict()) == configured_rule
    row = score_candidates_v2([
        candidate("mol", {"Caco2_Wang": 0.8}, uncertainties={"Caco2_Wang": 0.3})
    ], p)[0]
    expected_factor = apply_desirability(0.3, uncertainty_transform)
    assert explanation(row)["uncertainty"]["factor"] == pytest.approx(expected_factor)
    state = explanation(row)["endpoint_scoring"]["Caco2_Wang"]["uncertainty_state"]
    assert state["action"] == "penalty_applied"
    assert state["penalty_factor"] == pytest.approx(expected_factor)
    assert row["v2_score"] == pytest.approx(0.8 * expected_factor)


def test_incomplete_parameterized_uncertainty_policy_fails_before_scoring():
    p = profile({
        "Caco2_Wang": rule(domain="absorption", uncertainty_policy="penalty")
    }, {"absorption": 1}, ADMET_ONLY)
    with pytest.raises(ValueError, match="requires an explicit uncertainty_transform"):
        score_candidates_v2([candidate("mol", {"Caco2_Wang": 0.8})], p)


def test_uncertainty_threshold_can_make_candidate_unrankable():
    p = profile({
        "Caco2_Wang": rule(
            domain="absorption", uncertainty_policy="unrankable_above_threshold",
            uncertainty_transform=TransformSpec(
                "threshold", {"threshold": 0.2, "operator": "lte"}
            ),
        )
    }, {"absorption": 1}, ADMET_ONLY)
    row = score_candidates_v2([
        candidate("mol", {"Caco2_Wang": 0.8}, uncertainties={"Caco2_Wang": 0.3})
    ], p)[0]
    assert row["v2_score"] is None
    assert "uncertainty_threshold_failed:Caco2_Wang" in explanation(row)[
        "liabilities"
    ]["exclusion_reasons"]


def test_bbb_cns_peripheral_and_neutral_behavior_is_only_profile_configuration():
    value = {"gmc_mpnn_bbb": 0.8}
    cns = profile({
        "gmc_mpnn_bbb": rule(domain="distribution_cns")
    }, {"distribution_cns": 1}, ADMET_ONLY, target_mode="CNS")
    peripheral = profile({
        "gmc_mpnn_bbb": rule(
            domain="distribution_cns",
            transform=TransformSpec("decreasing_sigmoid", {"midpoint": 0.5, "slope": 10}),
        )
    }, {"distribution_cns": 1}, ADMET_ONLY, target_mode="peripheral")
    neutral = profile({
        "QED": rule(),
        "gmc_mpnn_bbb": rule(
            role="display_only", domain="distribution_cns", weight=0,
            missing_policy="warning_only",
        ),
    }, {"molecular_quality": 1, "distribution_cns": 1}, QUALITY_ONLY,
        target_mode="neutral")
    cns_row = score_candidates_v2([candidate("mol", value)], cns)[0]
    peripheral_row = score_candidates_v2([candidate("mol", value)], peripheral)[0]
    neutral_row = score_candidates_v2([candidate("mol", {**value, "QED": 0.6})], neutral)[0]
    assert cns_row["v2_score"] == 0.8
    assert peripheral_row["v2_score"] < 0.1
    assert neutral_row["v2_score"] == 0.6
    bbb = explanation(neutral_row)["endpoint_scoring"]["gmc_mpnn_bbb"]
    assert bbb["role"] == "display_only" and bbb["contribution"] is None
    assert "calibrated" not in str(explanation(cns_row)["raw_inputs"]).lower()


def test_explanation_and_provenance_reconstruct_final_score_and_campaign():
    p = profile({
        "QED": rule(),
        "herg_karim": rule(role="penalty", domain="safety"),
    }, {"molecular_quality": 2, "safety": 1}, QUALITY_ONLY,
        campaign_id="campaign-public-safe")
    row = score_candidates_v2([
        candidate("mol", {"QED": 0.75, "herg_karim": 0.8})
    ], p)[0]
    result = explanation(row)
    summary = result["summary"]
    assert summary["final_score"] == pytest.approx(
        summary["base_score"]
        * summary["combined_liability_penalty_factor"]
        * summary["uncertainty_penalty_factor"]
    )
    assert result["provenance"] == {
        "prioritization_method": "profile_v2",
        "profile_id": p.profile_id,
        "profile_version": p.profile_version,
        "profile_status": "draft",
        "schema_version": p.schema_version,
        "target_mode": "custom",
        "profile_sha256": profile_sha256(p),
        "component_weights_configured": {
            "admet": 0.0, "docking": 0.0, "molecular_quality": 1.0,
        },
        "component_weights_normalized": {
            "admet": 0.0, "docking": 0.0, "molecular_quality": 1.0,
        },
        "admet_domain_weights_configured": {},
        "admet_domain_weights_normalized": {},
        "campaign_id": "campaign-public-safe",
        "docking_normalization_method": "within_library_min_max",
        "docking_normalization_scope": "relative_within_campaign",
    }


def test_synthetic_future_endpoint_flows_to_domain_admet_and_final_without_engine_change():
    synthetic = EndpointDefinition(
        endpoint_id="future_endpoint_test_only",
        model_family="synthetic_test",
        value_type="continuous",
        units="test-units",
        semantic_direction="higher_favorable",
        uncertainty_field=None,
        public_status="public",
        description="Test-only extensibility endpoint.",
    )
    registry = ScientificEndpointRegistry((*PRODUCTION_ENDPOINT_DEFINITIONS, synthetic))
    transform = TransformSpec("increasing_sigmoid", {"midpoint": 5, "slope": 1})
    p = profile({
        synthetic.endpoint_id: rule(domain="developability", transform=transform)
    }, {"developability": 1}, ADMET_ONLY)
    row = score_candidates_v2([
        candidate("mol", {synthetic.endpoint_id: 6})
    ], p, registry=registry)[0]
    expected = apply_desirability(6, transform)
    assert explanation(row)["endpoint_scoring"][synthetic.endpoint_id]["desirability"] == expected
    assert explanation(row)["domains"]["developability"]["domain_score"] == expected
    assert explanation(row)["components"]["admet"]["score"] == expected
    assert row["v2_score"] == expected


def test_invalid_draft_profile_fails_before_any_candidate_score():
    p = profile({
        "QED": rule(transform=TransformSpec("increasing_sigmoid", {}))
    }, {"molecular_quality": 1}, QUALITY_ONLY)
    source = candidate("mol", {"QED": 0.8})
    with pytest.raises(ValueError, match="parameters are invalid"):
        score_candidates_v2([source], p)
    assert "v2_score" not in source


def test_deterministic_final_rank_tie_break_and_unrankable_no_rank():
    p = profile({"QED": rule()}, {"molecular_quality": 1}, QUALITY_ONLY)
    inputs = [
        candidate("z", {"QED": 0.8}),
        candidate("a", {"QED": 0.8}),
        candidate("missing", {}),
        candidate("invalid", {"QED": 1}, valid=False),
    ]
    first = score_candidates_v2(inputs, p)
    second = score_candidates_v2(inputs, p)
    assert [(row["molecule_id"], row["v2_rank"]) for row in first] == [
        ("a", 1), ("z", 2), ("invalid", None), ("missing", None)
    ]
    assert [(row["molecule_id"], row["v2_rank"]) for row in second] == [
        ("a", 1), ("z", 2), ("invalid", None), ("missing", None)
    ]
    assert by_id(first)["missing"]["v2_score"] is None
    assert by_id(first)["invalid"]["v2_score"] is None


def test_scored_values_are_finite_and_bounded():
    p = profile({"QED": rule()}, {"molecular_quality": 1}, QUALITY_ONLY)
    for value in (0, 0.1, 0.5, 1):
        row = score_candidates_v2([candidate(str(value), {"QED": value})], p)[0]
        assert math.isfinite(row["v2_score"])
        assert 0 <= row["v2_score"] <= 1
