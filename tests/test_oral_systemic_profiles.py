from __future__ import annotations

import copy
from dataclasses import replace

import pytest

from molecular_prioritization.builtin_profiles import (
    CNS_LITERATURE_PROFILE_ID,
    CNS_LITERATURE_PROFILE_VERSION,
    GENERAL_SYSTEMIC_ORAL_DRAFT_SHA256,
    GENERAL_SYSTEMIC_ORAL_DRAFT_VERSION,
    GENERAL_SYSTEMIC_ORAL_PROFILE_ID,
    GENERAL_SYSTEMIC_ORAL_PROFILE_VERSION,
    ORAL_SYSTEMIC_ROUTE_WARNING,
    PERIPHERAL_SYSTEMIC_ORAL_DRAFT_SHA256,
    PERIPHERAL_SYSTEMIC_ORAL_DRAFT_VERSION,
    PERIPHERAL_SYSTEMIC_ORAL_PROFILE_ID,
    PERIPHERAL_SYSTEMIC_ORAL_PROFILE_VERSION,
    builtin_profile_catalog,
    load_builtin_profile,
)
from molecular_prioritization.desirability import TransformSpec
from molecular_prioritization.prioritization_profiles import DockingPolicy, profile_sha256
from molecular_prioritization.prioritization_v2 import score_candidates_v2


EXPECTED_CNS_SHA256 = "86d8f3ea0df54a1bca45a3c16e94c9d16a8d4b04e103b48af37fcc267025a47a"
EXPECTED_GENERAL_FROZEN_SHA256 = "97f5ad6a671dddd3ae8c7d983b0d6ff7478537ef97709faa1c86b28505515ba4"
EXPECTED_PERIPHERAL_FROZEN_SHA256 = "eb6d88becf219e4f33e3a94b60e16ebf5976bb8cf865864a6de7cddd1bdfa3c3"
CYP_ENDPOINTS = {
    "cyp1a2_veith", "cyp2c19_veith", "cyp2c9_veith",
    "cyp2d6_veith", "cyp3a4_veith",
}
DISPLAY_ONLY_CONTEXT = {
    "pgp_broccatelli", "PPBR_AZ", "Vdss_Lombardo", "SA", "structural_alerts",
}


@pytest.fixture(scope="module")
def cns():
    return load_builtin_profile(CNS_LITERATURE_PROFILE_ID, CNS_LITERATURE_PROFILE_VERSION)


@pytest.fixture(scope="module")
def general():
    return load_builtin_profile(
        GENERAL_SYSTEMIC_ORAL_PROFILE_ID, GENERAL_SYSTEMIC_ORAL_PROFILE_VERSION,
    )


@pytest.fixture(scope="module")
def general_draft():
    return load_builtin_profile(
        GENERAL_SYSTEMIC_ORAL_PROFILE_ID, GENERAL_SYSTEMIC_ORAL_DRAFT_VERSION,
    )


@pytest.fixture(scope="module")
def peripheral():
    return load_builtin_profile(
        PERIPHERAL_SYSTEMIC_ORAL_PROFILE_ID, PERIPHERAL_SYSTEMIC_ORAL_PROFILE_VERSION,
    )


@pytest.fixture(scope="module")
def peripheral_draft():
    return load_builtin_profile(
        PERIPHERAL_SYSTEMIC_ORAL_PROFILE_ID, PERIPHERAL_SYSTEMIC_ORAL_DRAFT_VERSION,
    )


def values(**overrides):
    baseline = {
        "best_vina_affinity_kcal_mol": -7.0,
        "hia_hou": 0.7,
        "Caco2_Wang": -5.5,
        "gmc_mpnn_bbb": 0.5,
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
        "PPBR_AZ": 90.0,
        "Vdss_Lombardo": 4.0,
        "SA": 3.0,
        "structural_alerts": 0,
    }
    baseline.update(overrides)
    return baseline


def candidate(molecule_id, endpoint_values):
    return {
        "molecule_id": molecule_id,
        "canonical_smiles": "CCO",
        "valid_molecule": True,
        "scientific_endpoint_values": endpoint_values,
        "scientific_endpoint_uncertainties": {"gmc_mpnn_bbb": 0.0424},
        "docking_result": {
            "status": "precomputed",
            "best_vina_affinity_kcal_mol": endpoint_values["best_vina_affinity_kcal_mol"],
        },
    }


def final_score(profile, **overrides):
    return score_candidates_v2([candidate("single", values(**overrides))], profile)[0]


def score_pair(profile, endpoint_id, less_favorable, more_favorable):
    rows = score_candidates_v2([
        candidate("less", values(**{endpoint_id: less_favorable})),
        candidate("more", values(**{endpoint_id: more_favorable})),
    ], profile)
    return {row["molecule_id"]: row for row in rows}


def without_identity_and_bbb(profile):
    payload = copy.deepcopy(profile.to_dict())
    for key in ("profile_id", "profile_version", "status", "name", "target_mode"):
        payload.pop(key)
    payload["endpoint_rules"].pop("gmc_mpnn_bbb")
    return payload


def test_profile_identities_validation_hashes_and_catalog(
    cns, general, general_draft, peripheral, peripheral_draft,
):
    assert profile_sha256(cns) == EXPECTED_CNS_SHA256
    assert (general.profile_id, general.profile_version, general.status, general.target_mode) == (
        GENERAL_SYSTEMIC_ORAL_PROFILE_ID, "1.0.0", "frozen", "neutral",
    )
    assert (peripheral.profile_id, peripheral.profile_version, peripheral.status, peripheral.target_mode) == (
        PERIPHERAL_SYSTEMIC_ORAL_PROFILE_ID, "1.0.0", "frozen", "peripheral",
    )
    assert general.validate_for_scoring() == peripheral.validate_for_scoring() == ()
    assert profile_sha256(general) == profile_sha256(copy.deepcopy(general))
    assert profile_sha256(peripheral) == profile_sha256(copy.deepcopy(peripheral))
    assert profile_sha256(general_draft) == GENERAL_SYSTEMIC_ORAL_DRAFT_SHA256
    assert profile_sha256(peripheral_draft) == PERIPHERAL_SYSTEMIC_ORAL_DRAFT_SHA256
    assert profile_sha256(general) == EXPECTED_GENERAL_FROZEN_SHA256
    assert profile_sha256(peripheral) == EXPECTED_PERIPHERAL_FROZEN_SHA256

    catalog = builtin_profile_catalog()
    assert [(record["profile_id"], record["profile_version"]) for record in catalog] == [
        (CNS_LITERATURE_PROFILE_ID, "1.0.0"),
        (GENERAL_SYSTEMIC_ORAL_PROFILE_ID, "1.0.0"),
        (PERIPHERAL_SYSTEMIC_ORAL_PROFILE_ID, "1.0.0"),
        (CNS_LITERATURE_PROFILE_ID, "0.1.0"),
        (GENERAL_SYSTEMIC_ORAL_PROFILE_ID, "0.1.0"),
        (PERIPHERAL_SYSTEMIC_ORAL_PROFILE_ID, "0.1.0"),
    ]
    assert [record["choice_label"] for record in catalog[:3]] == [
        "CNS Drug Discovery", "General Systemic Oral", "Peripheral Systemic Oral",
    ]
    assert all(record["current"] and record["read_only"] for record in catalog[:3])
    assert all(record["historical"] for record in catalog[3:])
    assert all(record["route_warning"] == ORAL_SYSTEMIC_ROUTE_WARNING for record in catalog[1:3])


@pytest.mark.parametrize(
    ("profile_id", "draft_version", "frozen_version"),
    [
        (GENERAL_SYSTEMIC_ORAL_PROFILE_ID, GENERAL_SYSTEMIC_ORAL_DRAFT_VERSION, GENERAL_SYSTEMIC_ORAL_PROFILE_VERSION),
        (PERIPHERAL_SYSTEMIC_ORAL_PROFILE_ID, PERIPHERAL_SYSTEMIC_ORAL_DRAFT_VERSION, PERIPHERAL_SYSTEMIC_ORAL_PROFILE_VERSION),
    ],
)
def test_draft_and_frozen_profiles_are_scientifically_and_behaviorally_identical(
    profile_id, draft_version, frozen_version,
):
    draft = load_builtin_profile(profile_id, draft_version)
    frozen = load_builtin_profile(profile_id, frozen_version)
    draft_science = draft.to_dict()
    frozen_science = frozen.to_dict()
    for field in ("profile_version", "status"):
        draft_science.pop(field)
        frozen_science.pop(field)
    assert frozen_science == draft_science

    candidates = [
        candidate("alpha", values(best_vina_affinity_kcal_mol=-8.2, gmc_mpnn_bbb=0.15, QED=0.82)),
        candidate("beta", values(best_vina_affinity_kcal_mol=-7.1, gmc_mpnn_bbb=0.85, herg_karim=0.7)),
        candidate("gamma", values(best_vina_affinity_kcal_mol=-6.4, Caco2_Wang=-6.0, Solubility_AqSolDB=-4.2)),
    ]
    draft_rows = score_candidates_v2(candidates, draft)
    frozen_rows = score_candidates_v2(candidates, frozen)
    for draft_row, frozen_row in zip(draft_rows, frozen_rows, strict=True):
        draft_result = copy.deepcopy(draft_row)
        frozen_result = copy.deepcopy(frozen_row)
        for result in (draft_result, frozen_result):
            provenance = result["prioritization_v2"]["provenance"]
            for field in ("profile_version", "profile_status", "profile_sha256"):
                provenance.pop(field)
        assert frozen_result == draft_result


def test_general_matches_cns_except_target_specific_bbb(cns, general):
    assert without_identity_and_bbb(general) == without_identity_and_bbb(cns)
    cns_bbb = cns.endpoint_rules["gmc_mpnn_bbb"]
    general_bbb = general.endpoint_rules["gmc_mpnn_bbb"]
    assert (cns_bbb.role, cns_bbb.weight, cns_bbb.transform) == (
        "objective", 1.0, TransformSpec("identity_01", {}),
    )
    assert (general_bbb.enabled, general_bbb.role, general_bbb.weight) == (
        True, "display_only", 0.0,
    )
    assert general_bbb.transform == TransformSpec("identity_01", {})
    assert general_bbb.missing_policy == "warning_only"
    positive_admet_domains = {
        rule.domain for rule in general.endpoint_rules.values()
        if rule.enabled and rule.role == "objective" and rule.domain not in {
            "docking", "molecular_quality",
        }
    }
    assert positive_admet_domains == {"absorption", "developability"}


def test_peripheral_matches_general_except_bbb(general, peripheral):
    assert without_identity_and_bbb(peripheral) == without_identity_and_bbb(general)
    general_bbb = general.endpoint_rules["gmc_mpnn_bbb"]
    peripheral_bbb = peripheral.endpoint_rules["gmc_mpnn_bbb"]
    assert (general_bbb.role, general_bbb.weight, general_bbb.transform) == (
        "display_only", 0.0, TransformSpec("identity_01", {}),
    )
    assert (peripheral_bbb.enabled, peripheral_bbb.role, peripheral_bbb.domain) == (
        True, "penalty", "distribution_cns",
    )
    assert peripheral_bbb.transform == TransformSpec("reverse_identity_01", {})
    assert peripheral_bbb.weight == 1.0
    assert peripheral_bbb.missing_policy == "warning_only"
    assert not any(rule.role == "gate" for rule in peripheral.endpoint_rules.values())


def test_target_aware_bbb_directionality_and_visibility(cns, general, peripheral):
    general_low = final_score(general, gmc_mpnn_bbb=0.1)
    general_high = final_score(general, gmc_mpnn_bbb=0.9)
    assert general_low["v2_score"] == general_high["v2_score"]
    assert general_low["v2_rank"] == general_high["v2_rank"] == 1
    for row, expected in ((general_low, 0.1), (general_high, 0.9)):
        bbb = row["prioritization_v2"]["endpoint_scoring"]["gmc_mpnn_bbb"]
        assert bbb["raw_value"] == expected
        assert bbb["role"] == "display_only"
        assert bbb["contribution"] is None
        assert row["prioritization_v2"]["liabilities"]["gates"] == []

    peripheral_pair = score_pair(peripheral, "gmc_mpnn_bbb", 0.9, 0.1)
    assert peripheral_pair["more"]["v2_score"] > peripheral_pair["less"]["v2_score"]
    assert peripheral_pair["more"]["v2_rank"] == 1
    assert peripheral_pair["less"]["v2_rank"] == 2
    assert peripheral_pair["less"]["prioritization_v2"]["liabilities"]["gates"] == []

    cns_pair = score_pair(cns, "gmc_mpnn_bbb", 0.1, 0.9)
    assert cns_pair["more"]["prioritization_v2"]["components"]["admet"]["score"] > (
        cns_pair["less"]["prioritization_v2"]["components"]["admet"]["score"]
    )
    assert cns_pair["more"]["v2_score"] > cns_pair["less"]["v2_score"]
    assert cns_pair["more"]["v2_rank"] == 1
    assert all(
        row["prioritization_v2"]["liabilities"]["gates"] == []
        for row in cns_pair.values()
    )


@pytest.mark.parametrize("profile_fixture", ["general", "peripheral"])
@pytest.mark.parametrize(
    ("endpoint_id", "less_favorable", "more_favorable"),
    [
        ("hia_hou", 0.2, 0.8),
        ("Caco2_Wang", -6.0, -5.15),
        ("Lipophilicity_AstraZeneca", 4.5, 2.0),
        ("Solubility_AqSolDB", -4.0, -2.0),
    ],
)
def test_shared_positive_endpoint_directionality(
    request, profile_fixture, endpoint_id, less_favorable, more_favorable,
):
    profile = request.getfixturevalue(profile_fixture)
    scored = score_pair(profile, endpoint_id, less_favorable, more_favorable)
    assert scored["more"]["v2_score"] > scored["less"]["v2_score"]


@pytest.mark.parametrize("profile_fixture", ["general", "peripheral"])
@pytest.mark.parametrize("endpoint_id", [*sorted(CYP_ENDPOINTS), "herg_karim", "ames"])
def test_shared_liability_directionality(request, profile_fixture, endpoint_id):
    profile = request.getfixturevalue(profile_fixture)
    scored = score_pair(profile, endpoint_id, 0.9, 0.1)
    assert scored["more"]["v2_score"] > scored["less"]["v2_score"]


@pytest.mark.parametrize("profile_fixture", ["general", "peripheral"])
@pytest.mark.parametrize(
    ("endpoint_id", "left_value", "right_value"),
    [
        ("pgp_broccatelli", 0.0, 1.0),
        ("PPBR_AZ", 20.0, 99.0),
        ("Vdss_Lombardo", 0.1, 20.0),
        ("SA", 1.0, 9.0),
        ("structural_alerts", 0, 8),
    ],
)
def test_shared_context_endpoints_are_display_only(
    request, profile_fixture, endpoint_id, left_value, right_value,
):
    profile = request.getfixturevalue(profile_fixture)
    scored = score_pair(profile, endpoint_id, left_value, right_value)
    assert scored["more"]["v2_score"] == scored["less"]["v2_score"]


@pytest.mark.parametrize("profile_fixture", ["general", "peripheral"])
def test_reference_delta_is_explanatory_only(request, profile_fixture):
    profile = request.getfixturevalue(profile_fixture)
    row = candidate("reference-test", values())
    baseline = score_candidates_v2([row], profile)[0]["prioritization_v2"]
    with_reference = replace(profile, docking_policy=DockingPolicy(
        normalization="within_library",
        docking_required=True,
        reference_molecule_id="project-reference",
        reference_best_vina_affinity_kcal_mol=-7.5,
        reference_delta_role="explanatory_only",
    ))
    explained = score_candidates_v2([row], with_reference)[0]["prioritization_v2"]
    assert explained["docking"]["delta_vina_vs_reference_kcal_mol"] == 0.5
    assert explained["summary"]["final_score"] == baseline["summary"]["final_score"]


def test_shared_transform_and_policy_contracts(cns, general, peripheral):
    for profile in (general, peripheral):
        assert profile.component_weights == cns.component_weights
        assert profile.domain_weights == cns.domain_weights
        assert profile.liability_policy == cns.liability_policy
        assert profile.missing_data_policy == cns.missing_data_policy
        assert profile.uncertainty_policy == cns.uncertainty_policy == "warning_only"
        assert profile.docking_policy == cns.docking_policy
        for endpoint_id, cns_rule in cns.endpoint_rules.items():
            if endpoint_id == "gmc_mpnn_bbb":
                continue
            assert profile.endpoint_rules[endpoint_id] == cns_rule
        for endpoint_id in CYP_ENDPOINTS | {"herg_karim", "ames"}:
            assert profile.endpoint_rules[endpoint_id].transform == TransformSpec(
                "reverse_identity_01", {},
            )
        for endpoint_id in DISPLAY_ONLY_CONTEXT:
            assert profile.endpoint_rules[endpoint_id].role == "display_only"
