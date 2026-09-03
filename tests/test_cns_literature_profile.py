from __future__ import annotations

import copy
import hashlib
from dataclasses import replace

import pytest

from molecular_prioritization.builtin_profiles import (
    CNS_LITERATURE_PROFILE_ID,
    CNS_LITERATURE_DRAFT_NOTICE,
    CNS_LITERATURE_EVALUATED_SHA256,
    CNS_LITERATURE_EVALUATED_VERSION,
    CNS_LITERATURE_PROFILE_NOTICE,
    CNS_LITERATURE_PROFILE_VERSION,
    BUILTIN_PROFILE_DIR,
    builtin_profile_catalog,
    load_builtin_profile,
)
from molecular_prioritization.desirability import TransformSpec, apply_desirability
from molecular_prioritization.prioritization_analysis import analyze_weight_sensitivity
from molecular_prioritization.prioritization_profiles import (
    DockingPolicy,
    PrioritizationProfile,
    canonical_profile_json,
    profile_sha256,
)
from molecular_prioritization.prioritization_v2 import score_candidates_v2


CYP_ENDPOINTS = {
    "cyp1a2_veith", "cyp2c19_veith", "cyp2c9_veith",
    "cyp2d6_veith", "cyp3a4_veith",
}
DISPLAY_ONLY_ENDPOINTS = {
    "pgp_broccatelli", "PPBR_AZ", "Vdss_Lombardo", "SA", "structural_alerts",
}


@pytest.fixture(scope="module")
def profile() -> PrioritizationProfile:
    return load_builtin_profile(CNS_LITERATURE_PROFILE_ID, CNS_LITERATURE_EVALUATED_VERSION)


def values(**overrides):
    baseline = {
        "best_vina_affinity_kcal_mol": -7.0,
        "hia_hou": 0.7,
        "Caco2_Wang": -5.5,
        "gmc_mpnn_bbb": 0.6,
        "Lipophilicity_AstraZeneca": 2.0,
        "Solubility_AqSolDB": -3.0,
        "QED": 0.7,
        "cyp1a2_veith": 0.1,
        "cyp2c19_veith": 0.1,
        "cyp2c9_veith": 0.1,
        "cyp2d6_veith": 0.1,
        "cyp3a4_veith": 0.1,
        "herg_karim": 0.1,
        "ames": 0.1,
        "pgp_broccatelli": 0.2,
        "PPBR_AZ": 92.0,
        "Vdss_Lombardo": 4.0,
        "SA": 3.0,
        "structural_alerts": 0,
    }
    baseline.update(overrides)
    return baseline


def candidate(molecule_id, endpoint_values, *, uncertainties=None):
    return {
        "molecule_id": molecule_id,
        "canonical_smiles": "CCO",
        "valid_molecule": True,
        "scientific_endpoint_values": endpoint_values,
        "scientific_endpoint_uncertainties": uncertainties or {},
        "docking_result": {
            "status": "precomputed",
            "best_vina_affinity_kcal_mol": endpoint_values["best_vina_affinity_kcal_mol"],
        },
    }


def scored_pair(profile, endpoint_id, left_value, right_value):
    rows = score_candidates_v2([
        candidate("left", values(**{endpoint_id: left_value})),
        candidate("right", values(**{endpoint_id: right_value})),
    ], profile)
    return {row["molecule_id"]: row["prioritization_v2"] for row in rows}


def test_builtin_profile_identity_load_validation_catalog_and_hash_are_deterministic(profile):
    assert profile.profile_id == CNS_LITERATURE_PROFILE_ID
    assert profile.profile_version == CNS_LITERATURE_EVALUATED_VERSION
    assert profile.status == "draft"
    assert profile.target_mode == "CNS"
    assert profile.schema_version == "moloptima-prioritization-profile-v2"
    assert profile.validate_for_scoring() == ()
    round_trip = PrioritizationProfile.from_dict(copy.deepcopy(profile.to_dict()))
    assert round_trip == profile
    assert canonical_profile_json(round_trip) == canonical_profile_json(profile)
    assert profile_sha256(round_trip) == profile_sha256(profile)
    assert profile_sha256(profile) == CNS_LITERATURE_EVALUATED_SHA256
    resource = BUILTIN_PROFILE_DIR / "moloptima_cns_literature_v2_0.1.0.json"
    assert hashlib.sha256(resource.read_bytes()).hexdigest() == (
        "25df67ee9d253b18ee304709a10f61a9c2bfedb6741989b8ddc77a853551b7ac"
    )
    record = next(
        item for item in builtin_profile_catalog()
        if item["profile_id"] == CNS_LITERATURE_PROFILE_ID
        and item["profile_version"] == CNS_LITERATURE_EVALUATED_VERSION
    )
    assert record["profile_sha256"] == profile_sha256(profile)
    assert record["notice"] == CNS_LITERATURE_DRAFT_NOTICE
    assert record["scoreable"] is True
    assert record["historical"] is True
    assert record["current"] is False


def test_frozen_profile_is_current_valid_and_scientifically_identical(profile):
    frozen = load_builtin_profile(CNS_LITERATURE_PROFILE_ID, CNS_LITERATURE_PROFILE_VERSION)
    assert frozen.profile_version == "1.0.0"
    assert frozen.status == "frozen"
    assert frozen.target_mode == "CNS"
    assert frozen.validate_for_scoring() == ()

    evaluated_science = profile.to_dict()
    frozen_science = frozen.to_dict()
    for field in ("profile_version", "status"):
        evaluated_science.pop(field)
        frozen_science.pop(field)
    assert frozen_science == evaluated_science

    first_hash = profile_sha256(frozen)
    second_hash = profile_sha256(
        PrioritizationProfile.from_dict(copy.deepcopy(frozen.to_dict()))
    )
    assert len(first_hash) == 64
    assert second_hash == first_hash

    catalog = builtin_profile_catalog()
    assert [(record["profile_id"], record["profile_version"]) for record in catalog] == [
        ("moloptima_cns_literature_v2", "1.0.0"),
        ("moloptima_general_systemic_oral_v2", "1.0.0"),
        ("moloptima_peripheral_systemic_oral_v2", "1.0.0"),
        ("moloptima_cns_literature_v2", "0.1.0"),
        ("moloptima_general_systemic_oral_v2", "0.1.0"),
        ("moloptima_peripheral_systemic_oral_v2", "0.1.0"),
    ]
    current = catalog[0]
    assert current["current"] is current["recommended"] is True
    assert current["historical"] is False
    assert current["read_only"] is True
    assert current["notice"] == CNS_LITERATURE_PROFILE_NOTICE
    assert current["provenance"]["scientific_configuration_source_sha256"] == (
        CNS_LITERATURE_EVALUATED_SHA256
    )
    assert current["provenance"]["prospective_evaluation_candidate_count"] == 351
    assert current["provenance"]["prospective_evaluation_status"] == (
        "READY_FOR_SCIENTIFIC_REVIEW"
    )
    assert current["interpretation_notes"][-1] == (
        "These observations were not used to retune the profile."
    )


def test_evaluated_and_frozen_profiles_have_identical_real_scoring_behavior(profile):
    frozen = load_builtin_profile(CNS_LITERATURE_PROFILE_ID, CNS_LITERATURE_PROFILE_VERSION)
    candidates = [
        candidate("alpha", values(best_vina_affinity_kcal_mol=-8.4, QED=0.82)),
        candidate("beta", values(
            best_vina_affinity_kcal_mol=-7.2, gmc_mpnn_bbb=0.35,
            cyp1a2_veith=0.8, herg_karim=0.7,
        ), uncertainties={"gmc_mpnn_bbb": 0.08}),
        candidate("gamma", values(
            best_vina_affinity_kcal_mol=-6.5, Caco2_Wang=-6.0,
            Lipophilicity_AstraZeneca=3.7, Solubility_AqSolDB=-4.2,
        )),
    ]
    evaluated_rows = score_candidates_v2(candidates, profile)
    frozen_rows = score_candidates_v2(candidates, frozen)
    assert [row["molecule_id"] for row in evaluated_rows] == [
        row["molecule_id"] for row in frozen_rows
    ]
    for evaluated, released in zip(evaluated_rows, frozen_rows, strict=True):
        evaluated_explanation = evaluated["prioritization_v2"]
        released_explanation = released["prioritization_v2"]
        assert {
            key: value["desirability"]
            for key, value in evaluated_explanation["endpoint_scoring"].items()
        } == {
            key: value["desirability"]
            for key, value in released_explanation["endpoint_scoring"].items()
        }
        assert released_explanation["components"] == evaluated_explanation["components"]
        assert released_explanation["summary"]["base_score"] == (
            evaluated_explanation["summary"]["base_score"]
        )
        assert released_explanation["liabilities"] == evaluated_explanation["liabilities"]
        assert released["v2_score"] == evaluated["v2_score"]
        assert released["v2_rank_eligible"] == evaluated["v2_rank_eligible"]
        assert released["v2_rank"] == evaluated["v2_rank"]


def test_neutral_top_level_weights_and_approved_docking_policy(profile):
    assert profile.component_weights == {
        "docking": 1.0, "admet": 1.0, "molecular_quality": 1.0,
    }
    total = sum(profile.component_weights.values())
    assert {key: value / total for key, value in profile.component_weights.items()} == {
        "docking": pytest.approx(1 / 3),
        "admet": pytest.approx(1 / 3),
        "molecular_quality": pytest.approx(1 / 3),
    }
    policy = profile.docking_policy
    assert policy.normalization == "within_library"
    assert policy.docking_required is True
    assert policy.reference_molecule_id is None
    assert policy.reference_best_vina_affinity_kcal_mol is None
    assert policy.reference_delta_role == "explanatory_only"


def test_positive_domain_and_endpoint_science_contract(profile):
    rules = profile.endpoint_rules
    assert {
        endpoint_id for endpoint_id, rule in rules.items()
        if rule.enabled and rule.role == "objective" and rule.domain in {
            "absorption", "distribution_cns", "developability",
        }
    } == {
        "hia_hou", "Caco2_Wang", "gmc_mpnn_bbb",
        "Lipophilicity_AstraZeneca", "Solubility_AqSolDB",
    }
    assert rules["hia_hou"].transform == TransformSpec("identity_01", {})
    assert rules["Caco2_Wang"].transform == TransformSpec(
        "minimum_plateau", {"minimum": -5.15, "width": 0.85},
    )
    assert apply_desirability(-6.0, rules["Caco2_Wang"].transform) == pytest.approx(0.0, abs=1e-12)
    assert apply_desirability(-5.15, rules["Caco2_Wang"].transform) == 1.0
    assert rules["gmc_mpnn_bbb"].transform == TransformSpec("identity_01", {})
    assert "provisional_raw" in rules["gmc_mpnn_bbb"].notes
    assert "not_frozen" in rules["gmc_mpnn_bbb"].notes
    assert rules["Lipophilicity_AstraZeneca"].transform == TransformSpec(
        "target_range", {"lower": 1.0, "upper": 3.0, "lower_width": 1.0, "upper_width": 1.0},
    )
    assert apply_desirability(0.0, rules["Lipophilicity_AstraZeneca"].transform) == 0.0
    assert apply_desirability(2.0, rules["Lipophilicity_AstraZeneca"].transform) == 1.0
    assert apply_desirability(4.0, rules["Lipophilicity_AstraZeneca"].transform) == 0.0
    assert rules["Solubility_AqSolDB"].transform == TransformSpec(
        "minimum_plateau", {"minimum": -2.0, "width": 2.0},
    )
    assert apply_desirability(-4.0, rules["Solubility_AqSolDB"].transform) == 0.0
    assert apply_desirability(-2.0, rules["Solubility_AqSolDB"].transform) == 1.0
    assert rules["QED"].role == "objective"
    assert rules["QED"].transform == TransformSpec("identity_01", {})


def test_context_liability_uncertainty_and_missing_policies(profile):
    rules = profile.endpoint_rules
    for endpoint_id in DISPLAY_ONLY_ENDPOINTS:
        assert rules[endpoint_id].role == "display_only"
        assert rules[endpoint_id].weight == 0.0
        assert rules[endpoint_id].missing_policy == "warning_only"
    assert "inhibition" in rules["pgp_broccatelli"].notes
    assert "substrate" in rules["pgp_broccatelli"].notes
    for endpoint_id in CYP_ENDPOINTS:
        rule = rules[endpoint_id]
        assert rule.role == "penalty"
        assert rule.domain == "metabolism_transport"
        assert rule.transform == TransformSpec("reverse_identity_01", {})
        assert rule.weight == 1.0
        assert rule.missing_policy == "warning_only"
    for endpoint_id in ("herg_karim", "ames"):
        rule = rules[endpoint_id]
        assert rule.role == "penalty"
        assert rule.domain == "safety"
        assert rule.transform == TransformSpec("reverse_identity_01", {})
        assert rule.role != "gate"
    assert not any(rule.role == "gate" for rule in rules.values())
    assert profile.uncertainty_policy == "warning_only"
    assert all(rule.uncertainty_policy == "warning_only" for rule in rules.values())
    positive = {"hia_hou", "Caco2_Wang", "gmc_mpnn_bbb", "Lipophilicity_AstraZeneca", "Solubility_AqSolDB", "QED"}
    assert all(rules[endpoint_id].missing_policy == "renormalize_with_warning" for endpoint_id in positive)


def test_reverse_identity_is_generic_bounded_deterministic_and_fail_closed():
    transform = TransformSpec("reverse_identity_01", {})
    assert apply_desirability(0.0, transform) == 1.0
    assert apply_desirability(0.25, transform) == 0.75
    assert apply_desirability(1.0, transform) == 0.0
    for invalid in (-0.01, 1.01, float("nan"), float("inf")):
        with pytest.raises(ValueError):
            apply_desirability(invalid, transform)


@pytest.mark.parametrize(
    ("endpoint_id", "less_favorable", "more_favorable"),
    [
        ("Caco2_Wang", -6.0, -5.15),
        ("gmc_mpnn_bbb", 0.2, 0.8),
        ("Solubility_AqSolDB", -4.0, -2.0),
    ],
)
def test_positive_endpoint_directionality(profile, endpoint_id, less_favorable, more_favorable):
    scored = scored_pair(profile, endpoint_id, less_favorable, more_favorable)
    assert scored["right"]["summary"]["final_score"] > scored["left"]["summary"]["final_score"]


def test_hia_and_lipophilicity_directionality_and_solubility_plateau(profile):
    hia = scored_pair(profile, "hia_hou", 0.2, 0.8)
    assert hia["right"]["summary"]["final_score"] > hia["left"]["summary"]["final_score"]
    lipophilicity = scored_pair(profile, "Lipophilicity_AstraZeneca", 2.0, 5.0)
    assert lipophilicity["left"]["summary"]["final_score"] > lipophilicity["right"]["summary"]["final_score"]
    plateau = scored_pair(profile, "Solubility_AqSolDB", -2.0, 0.0)
    assert plateau["left"]["summary"]["final_score"] == plateau["right"]["summary"]["final_score"]


@pytest.mark.parametrize("endpoint_id", ["cyp1a2_veith", "herg_karim", "ames"])
def test_high_classifier_liability_decreases_final_score(profile, endpoint_id):
    scored = scored_pair(profile, endpoint_id, 0.1, 0.9)
    assert scored["left"]["summary"]["final_score"] > scored["right"]["summary"]["final_score"]


@pytest.mark.parametrize(
    ("endpoint_id", "left_value", "right_value"),
    [
        ("PPBR_AZ", -5.0, 125.0),
        ("Vdss_Lombardo", 0.1, 50.0),
        ("pgp_broccatelli", 0.0, 1.0),
        ("structural_alerts", 0, 8),
        ("SA", 1.0, 10.0),
    ],
)
def test_display_only_context_never_changes_score(profile, endpoint_id, left_value, right_value):
    scored = scored_pair(profile, endpoint_id, left_value, right_value)
    assert scored["left"]["summary"]["final_score"] == scored["right"]["summary"]["final_score"]


def test_cyp_count_normalization_missing_liability_and_uncertainty_are_non_silent(profile):
    endpoint_values = values(**{endpoint_id: 0.5 for endpoint_id in CYP_ENDPOINTS})
    scored = score_candidates_v2([
        candidate("complete", endpoint_values, uncertainties={"gmc_mpnn_bbb": 0.0424}),
    ], profile)[0]["prioritization_v2"]
    assert scored["liabilities"]["domain_factors"]["metabolism_transport"]["factor"] == 0.5
    assert len(scored["liabilities"]["domain_factors"]["metabolism_transport"]["member_endpoints"]) == 5
    assert scored["uncertainty"]["raw_values"]["gmc_mpnn_bbb"] == 0.0424
    assert scored["uncertainty"]["factor"] == 1.0
    assert "warning-only" in " ".join(scored["warnings"])

    missing_values = values()
    del missing_values["cyp1a2_veith"]
    missing = score_candidates_v2([candidate("missing", missing_values)], profile)[0]["prioritization_v2"]
    record = next(item for item in missing["missing_data"] if item["endpoint_id"] == "cyp1a2_veith")
    assert record["configured_policy"] == "warning_only"
    assert record["effect_on_score_ranking"] == "available_weights_renormalized"
    assert missing["liabilities"]["combined_penalty_factor"] > 0.0


def test_reference_delta_is_explanatory_only(profile):
    row = candidate("molecule", values())
    baseline = score_candidates_v2([row], profile)[0]["prioritization_v2"]
    with_reference = replace(profile, docking_policy=DockingPolicy(
        normalization="within_library",
        docking_required=True,
        reference_molecule_id="literature-reference",
        reference_best_vina_affinity_kcal_mol=-7.5,
        reference_delta_role="explanatory_only",
    ))
    explained = score_candidates_v2([row], with_reference)[0]["prioritization_v2"]
    assert explained["docking"]["delta_vina_vs_reference_kcal_mol"] == 0.5
    assert explained["summary"]["final_score"] == baseline["summary"]["final_score"]


def test_sensitivity_compatibility_does_not_mutate_draft_profile(profile):
    before = copy.deepcopy(profile.to_dict())
    digest = profile_sha256(profile)
    candidates = [
        candidate("one", values(best_vina_affinity_kcal_mol=-8.0)),
        candidate("two", values(best_vina_affinity_kcal_mol=-7.0, QED=0.6)),
    ]
    analysis = analyze_weight_sensitivity(
        candidates, profile,
        perturbation_magnitude=0.1,
        number_of_samples=3,
        analysis_seed=2026,
    )
    assert analysis["explanatory_only"] is True
    assert analysis["provenance"]["source_profile_sha256"] == digest
    assert profile.to_dict() == before
    assert profile_sha256(profile) == digest
