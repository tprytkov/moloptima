from __future__ import annotations

import json
import math

import pytest

from molecular_prioritization.desirability import (
    TRANSFORM_TYPES,
    TransformSpec,
    apply_desirability,
    validate_transform_spec,
)
from molecular_prioritization.docking import add_docking_informed_scores
from molecular_prioritization.prioritization import (
    PRIORITIZATION_METHOD_LEGACY_V1,
    finalize_scientific_prioritization,
)
from molecular_prioritization.prioritization_profiles import (
    DockingPolicy,
    EndpointRule,
    LiabilityPolicy,
    PrioritizationProfile,
    canonical_profile_json,
    profile_sha256,
)
from molecular_prioritization.scientific_endpoints import (
    PRODUCTION_ENDPOINT_DEFINITIONS,
    PUBLIC_SCIENTIFIC_ENDPOINT_IDS,
    EndpointDefinition,
    SCIENTIFIC_ENDPOINTS,
    ScientificEndpointRegistry,
)


EXPECTED_PUBLIC_ENDPOINTS = {
    "hia_hou", "pgp_broccatelli", "cyp1a2_veith", "cyp2c19_veith",
    "cyp2c9_veith", "cyp2d6_veith", "cyp3a4_veith", "herg_karim", "ames",
    "gmc_mpnn_bbb", "Caco2_Wang", "Lipophilicity_AstraZeneca",
    "Solubility_AqSolDB", "PPBR_AZ", "Vdss_Lombardo", "QED", "SA",
    "structural_alerts", "best_vina_affinity_kcal_mol",
}


def objective_rule(
    *,
    transform: TransformSpec | None = None,
    domain: str = "molecular_quality",
    weight: float = 1.0,
) -> EndpointRule:
    return EndpointRule(
        enabled=True,
        role="objective",
        domain=domain,
        transform=transform or TransformSpec("identity_01", {}),
        weight=weight,
        required=True,
        missing_policy="unrankable",
        uncertainty_policy="warning_only",
        notes="Synthetic P2.1 test rule.",
    )


def profile(
    *,
    endpoint_rules=None,
    domain_weights=None,
    component_weights=None,
    docking_policy=None,
    name="Synthetic complete P2.1 test profile",
) -> PrioritizationProfile:
    return PrioritizationProfile(
        schema_version="moloptima-prioritization-profile-v2",
        profile_id="synthetic-test-only",
        profile_version="0.0.1-test",
        status="draft",
        name=name,
        target_mode="custom",
        aggregation="weighted_arithmetic",
        component_weights=(
            {"docking": 0.0, "admet": 0.0, "molecular_quality": 1.0}
            if component_weights is None else component_weights
        ),
        domain_weights=domain_weights or {"molecular_quality": 1.0},
        endpoint_rules=endpoint_rules or {"QED": objective_rule()},
        missing_data_policy="renormalize_with_warning",
        uncertainty_policy="warning_only",
        liability_policy=LiabilityPolicy(
            penalty_aggregation="domain_weighted_arithmetic",
            gate_failure_behavior="exclude",
        ),
        docking_policy=docking_policy or DockingPolicy(
            normalization="within_library", docking_required=False,
        ),
    )


def test_current_public_endpoint_metadata_exists_without_internal_bbb_martins():
    assert set(PUBLIC_SCIENTIFIC_ENDPOINT_IDS) == EXPECTED_PUBLIC_ENDPOINTS
    assert "bbb_martins" not in PUBLIC_SCIENTIFIC_ENDPOINT_IDS
    assert SCIENTIFIC_ENDPOINTS.get("PPBR_AZ").units == "percent bound"
    assert SCIENTIFIC_ENDPOINTS.get("Vdss_Lombardo").units == "L/kg"
    assert SCIENTIFIC_ENDPOINTS.get("gmc_mpnn_bbb").units == "raw ensemble probability"


def test_endpoint_metadata_round_trip():
    definition = SCIENTIFIC_ENDPOINTS.get("Caco2_Wang")
    assert EndpointDefinition.from_dict(definition.to_dict()) == definition


def test_transform_endpoint_rule_and_profile_round_trip():
    transform = TransformSpec("increasing_sigmoid", {"midpoint": 0.5, "slope": 4.0})
    assert TransformSpec.from_dict(transform.to_dict()) == transform
    rule = objective_rule(transform=transform)
    assert EndpointRule.from_dict(rule.to_dict()) == rule
    original = profile(endpoint_rules={"QED": rule})
    assert PrioritizationProfile.from_dict(original.to_dict()) == original


def test_canonical_json_and_sha_are_stable_across_mapping_insertion_order():
    rules_a = {
        "QED": objective_rule(weight=2),
        "SA": objective_rule(
            transform=TransformSpec("decreasing_sigmoid", {"midpoint": 5, "slope": 1}),
            weight=1,
        ),
    }
    rules_b = {"SA": rules_a["SA"], "QED": rules_a["QED"]}
    left = profile(
        endpoint_rules=rules_a,
        domain_weights={"molecular_quality": 3, "docking": 0},
    )
    right = profile(
        endpoint_rules=rules_b,
        domain_weights={"docking": 0.0, "molecular_quality": 3.0},
    )
    assert canonical_profile_json(left) == canonical_profile_json(right)
    assert profile_sha256(left) == profile_sha256(right)
    assert len(profile_sha256(left)) == 64
    assert json.loads(canonical_profile_json(left))["status"] == "draft"


def test_profile_sha_changes_for_scientifically_meaningful_change():
    baseline = profile()
    changed = profile(domain_weights={"molecular_quality": 2.0})
    assert profile_sha256(baseline) != profile_sha256(changed)


def test_canonicalization_rejects_private_absolute_paths_without_mutating_profile():
    original = profile(name=r"C:\private\profile")
    before = original.to_dict()
    with pytest.raises(ValueError, match="absolute paths"):
        canonical_profile_json(original)
    assert original.to_dict() == before


def test_unknown_endpoint_fails_closed_at_scoring_validation():
    candidate = profile(endpoint_rules={"unknown_endpoint": objective_rule()})
    with pytest.raises(ValueError, match="Unknown scientific endpoint"):
        candidate.validate_for_scoring()


def test_unknown_transform_role_domain_and_policies_fail_closed():
    with pytest.raises(ValueError, match="Unknown desirability transform"):
        TransformSpec("made_up", {})
    with pytest.raises(ValueError, match="Unknown endpoint role"):
        EndpointRule.from_dict({**objective_rule().to_dict(), "role": "made_up"})
    with pytest.raises(ValueError, match="Unknown scientific domain"):
        EndpointRule.from_dict({**objective_rule().to_dict(), "domain": "made_up"})
    with pytest.raises(ValueError, match="Unknown missing-data policy"):
        EndpointRule.from_dict({**objective_rule().to_dict(), "missing_policy": "made_up"})
    with pytest.raises(ValueError, match="Unknown uncertainty policy"):
        EndpointRule.from_dict({**objective_rule().to_dict(), "uncertainty_policy": "made_up"})


@pytest.mark.parametrize("weight", [-1, float("nan"), float("inf"), float("-inf")])
def test_negative_and_nonfinite_endpoint_weights_are_rejected(weight):
    with pytest.raises(ValueError, match="Endpoint weight"):
        objective_rule(weight=weight)


@pytest.mark.parametrize("weight", [-1, float("nan"), float("inf"), float("-inf")])
def test_negative_and_nonfinite_domain_weights_are_rejected(weight):
    with pytest.raises(ValueError, match="Domain weight"):
        profile(domain_weights={"molecular_quality": weight})


@pytest.mark.parametrize(
    "spec",
    [
        TransformSpec("increasing_sigmoid", {"midpoint": 0.5}),
        TransformSpec("increasing_sigmoid", {"midpoint": 0.5, "slope": 0}),
        TransformSpec("target_range", {"lower": 2, "upper": 1, "lower_width": 1, "upper_width": 1}),
        TransformSpec("target_range", {"lower": 1, "upper": 2, "lower_width": 0, "upper_width": 1}),
        TransformSpec("minimum_plateau", {"minimum": 1, "width": -1}),
        TransformSpec("threshold", {"threshold": 1, "operator": "equals"}),
        TransformSpec("identity_01", {"unexpected": 1}),
    ],
)
def test_invalid_or_incomplete_transform_parameters_are_rejected(spec):
    with pytest.raises(ValueError):
        validate_transform_spec(spec)


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_nonfinite_transform_parameters_are_rejected(value):
    with pytest.raises(ValueError, match="finite"):
        TransformSpec("increasing_sigmoid", {"midpoint": value, "slope": 1})


def test_increasing_and_decreasing_sigmoids_are_monotonic():
    increasing = TransformSpec("increasing_sigmoid", {"midpoint": 0, "slope": 2})
    decreasing = TransformSpec("decreasing_sigmoid", {"midpoint": 0, "slope": 2})
    assert apply_desirability(-1, increasing) < apply_desirability(0, increasing) < apply_desirability(1, increasing)
    assert apply_desirability(-1, decreasing) > apply_desirability(0, decreasing) > apply_desirability(1, decreasing)


def test_target_range_has_plateau_and_explicit_linear_shoulders():
    spec = TransformSpec(
        "target_range", {"lower": 2, "upper": 4, "lower_width": 2, "upper_width": 4},
    )
    assert apply_desirability(3, spec) == 1.0
    assert apply_desirability(1, spec) == 0.5
    assert apply_desirability(6, spec) == 0.5
    assert apply_desirability(-1, spec) == 0.0


def test_minimum_plateau_behavior():
    spec = TransformSpec("minimum_plateau", {"minimum": 4, "width": 2})
    assert apply_desirability(4, spec) == 1.0
    assert apply_desirability(3, spec) == 0.5
    assert apply_desirability(1, spec) == 0.0


def test_threshold_behavior():
    assert apply_desirability(2, TransformSpec("threshold", {"threshold": 2, "operator": "gte"})) == 1.0
    assert apply_desirability(3, TransformSpec("threshold", {"threshold": 2, "operator": "lte"})) == 0.0


def test_categorical_map_behavior():
    spec = TransformSpec("categorical_map", {"mapping": {"good": 1, "mixed": 0.5, "bad": 0}})
    assert apply_desirability("mixed", spec) == 0.5
    with pytest.raises(ValueError, match="no entry"):
        apply_desirability("unknown", spec)


def test_identity_01_accepts_unit_interval_and_rejects_outside():
    spec = TransformSpec("identity_01", {})
    assert apply_desirability(0, spec) == 0.0
    assert apply_desirability(0.5, spec) == 0.5
    assert apply_desirability(1, spec) == 1.0
    for value in (-0.01, 1.01):
        with pytest.raises(ValueError, match=r"\[0,1\]"):
            apply_desirability(value, spec)


def test_reverse_identity_01_inverts_only_bounded_values():
    spec = TransformSpec("reverse_identity_01", {})
    assert apply_desirability(0, spec) == 1.0
    assert apply_desirability(0.4, spec) == 0.6
    assert apply_desirability(1, spec) == 0.0
    for value in (-0.01, 1.01):
        with pytest.raises(ValueError, match=r"\[0,1\]"):
            apply_desirability(value, spec)


def test_every_numeric_transform_returns_finite_unit_interval_values():
    specs = (
        TransformSpec("increasing_sigmoid", {"midpoint": 0, "slope": 2}),
        TransformSpec("decreasing_sigmoid", {"midpoint": 0, "slope": 2}),
        TransformSpec("target_range", {"lower": -1, "upper": 1, "lower_width": 1, "upper_width": 1}),
        TransformSpec("minimum_plateau", {"minimum": 0, "width": 1}),
        TransformSpec("threshold", {"threshold": 0, "operator": "gte"}),
    )
    for spec in specs:
        for value in (-100, -1, 0, 1, 100):
            result = apply_desirability(value, spec)
            assert math.isfinite(result)
            assert 0 <= result <= 1


def test_synthetic_future_endpoint_uses_registry_transform_rule_and_profile_without_engine_branch():
    synthetic = EndpointDefinition(
        endpoint_id="future_endpoint_test_only",
        model_family="synthetic_test",
        value_type="continuous",
        units="synthetic units",
        semantic_direction="higher_favorable",
        uncertainty_field=None,
        public_status="public",
        description="Test-only endpoint proving metadata-driven extensibility.",
    )
    registry = ScientificEndpointRegistry((*PRODUCTION_ENDPOINT_DEFINITIONS, synthetic))
    rule = objective_rule(
        transform=TransformSpec("increasing_sigmoid", {"midpoint": 5, "slope": 1}),
        domain="developability",
    )
    candidate = profile(
        endpoint_rules={synthetic.endpoint_id: rule},
        domain_weights={"developability": 1},
        component_weights={"docking": 0, "admet": 1, "molecular_quality": 0},
    )
    assert candidate.validate_for_scoring(registry) == ()
    assert 0 < apply_desirability(6, rule.transform) < 1
    assert registry.get(synthetic.endpoint_id) == synthetic


def test_incomplete_draft_is_representable_but_not_scoreable():
    incomplete = profile(
        endpoint_rules={
            "QED": objective_rule(transform=TransformSpec("increasing_sigmoid", {})),
        },
    )
    assert incomplete.status == "draft"
    with pytest.raises(ValueError, match="parameters are invalid"):
        incomplete.validate_for_scoring()


def test_complete_synthetic_draft_passes_validate_for_scoring():
    candidate = profile()
    assert candidate.validate_for_scoring() == ()


def test_all_zero_scoreable_weight_configuration_fails():
    candidate = profile(endpoint_rules={"QED": objective_rule(weight=0)})
    with pytest.raises(ValueError, match="positive objective/domain weight"):
        candidate.validate_for_scoring()


def test_draft_may_omit_component_weights_but_scoring_rejects_it():
    draft = profile(component_weights={})
    assert draft.to_dict()["component_weights"] == {}
    with pytest.raises(ValueError, match="explicit component weights"):
        draft.validate_for_scoring()


def test_partial_or_all_zero_component_weights_are_not_scoreable():
    partial = profile(component_weights={"admet": 1, "molecular_quality": 0})
    with pytest.raises(ValueError, match="explicit component weights"):
        partial.validate_for_scoring()
    all_zero = profile(component_weights={
        "docking": 0, "admet": 0, "molecular_quality": 0,
    })
    with pytest.raises(ValueError, match="at least one positive component weight"):
        all_zero.validate_for_scoring()


@pytest.mark.parametrize("weight", [-1, float("nan"), float("inf"), float("-inf")])
def test_negative_and_nonfinite_component_weights_are_rejected(weight):
    with pytest.raises(ValueError, match="Component weight"):
        profile(component_weights={
            "docking": 0, "admet": 0, "molecular_quality": weight,
        })


def test_unknown_component_weight_is_rejected():
    with pytest.raises(ValueError, match="Unknown scoring component"):
        profile(component_weights={
            "docking": 0, "admet": 0, "molecular_quality": 1, "extra": 1,
        })


def test_within_library_docking_policy_and_optional_reference_round_trip():
    without_reference = DockingPolicy(normalization="within_library", docking_required=True)
    assert DockingPolicy.from_dict(without_reference.to_dict()) == without_reference
    assert without_reference.reference_molecule_id is None

    with_reference = DockingPolicy(
        normalization="within_library",
        docking_required=True,
        campaign_id="campaign-test",
        reference_molecule_id="reference-1",
        reference_best_vina_affinity_kcal_mol=-7.261,
    )
    assert DockingPolicy.from_dict(with_reference.to_dict()) == with_reference
    assert with_reference.reference_delta_role == "explanatory_only"


def test_unknown_docking_normalization_and_malformed_reference_fail_closed():
    with pytest.raises(ValueError, match="Unknown docking normalization"):
        DockingPolicy(normalization="fixed_sigmoid", docking_required=True)
    with pytest.raises(ValueError, match="requires reference_molecule_id"):
        DockingPolicy(
            normalization="within_library",
            docking_required=True,
            reference_best_vina_affinity_kcal_mol=-7,
        )


def test_qed_redundancy_warning_is_generic_and_does_not_change_profile():
    candidate = profile(endpoint_rules={
        "QED": objective_rule(),
        "MW": objective_rule(),
        "TPSA": objective_rule(),
        "rotatable_bonds": objective_rule(),
    })
    warnings = candidate.validation_warnings()
    assert len(warnings) == 1
    assert "double counting" in warnings[0]


def test_legacy_v1_identity_scores_and_ranks_remain_exact():
    assert PRIORITIZATION_METHOD_LEGACY_V1 == "legacy_v1"
    rows = [
        {
            "molecule_id": "strong", "canonical_smiles": "CCO", "valid_molecule": True,
            "priority_score": 0.8, "docking_score": -10.0, "docking_status": "provided",
            "prioritization": {"components": {}, "warnings": []},
        },
        {
            "molecule_id": "weak", "canonical_smiles": "CCC", "valid_molecule": True,
            "priority_score": 0.6, "docking_score": -5.0, "docking_status": "provided",
            "prioritization": {"components": {}, "warnings": []},
        },
    ]
    scored = add_docking_informed_scores(rows)
    assert [row["combined_candidate_score"] for row in scored] == [0.86, 0.42]
    ranked = finalize_scientific_prioritization(scored)
    assert [(row["molecule_id"], row["scientific_rank"]) for row in ranked] == [
        ("strong", 1), ("weak", 2),
    ]
    assert [row["scientific_ranking_score"] for row in ranked] == [0.86, 0.42]


def test_supported_transform_inventory_is_exact():
    assert TRANSFORM_TYPES == {
        "increasing_sigmoid", "decreasing_sigmoid", "target_range",
        "minimum_plateau", "threshold", "categorical_map", "identity_01",
        "reverse_identity_01",
    }
