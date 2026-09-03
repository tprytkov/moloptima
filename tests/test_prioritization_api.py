from __future__ import annotations

import copy

from fastapi.testclient import TestClient

from backend import services
from backend.main import app
from backend.schemas import MoleculeAnalysisResult
from molecular_prioritization.admet_multitask_predictor import unavailable_admet_prediction
from molecular_prioritization.prioritization_profiles import (
    PrioritizationProfile,
    profile_sha256,
)
from molecular_prioritization.prioritization_v2 import score_candidates_v2


def synthetic_profile() -> dict[str, object]:
    return {
        "schema_version": "moloptima-prioritization-profile-v2",
        "profile_id": "synthetic-api-test-only",
        "profile_version": "0.0.1-test",
        "status": "draft",
        "name": "Synthetic API test profile; not production science",
        "target_mode": "custom",
        "aggregation": "weighted_arithmetic",
        "component_weights": {"docking": 0, "admet": 0, "molecular_quality": 1},
        "domain_weights": {"molecular_quality": 1},
        "endpoint_rules": {
            "QED": {
                "enabled": True,
                "role": "objective",
                "domain": "molecular_quality",
                "transform": {"type": "identity_01", "params": {}},
                "weight": 1,
                "required": True,
                "missing_policy": "unrankable",
                "uncertainty_policy": "warning_only",
                "notes": "Synthetic test-only rule.",
            }
        },
        "missing_data_policy": "renormalize_with_warning",
        "uncertainty_policy": "warning_only",
        "liability_policy": {
            "penalty_aggregation": "domain_weighted_arithmetic",
            "gate_failure_behavior": "exclude",
        },
        "docking_policy": {
            "normalization": "within_library",
            "docking_required": False,
            "campaign_id": None,
            "reference_molecule_id": None,
            "reference_best_vina_affinity_kcal_mol": None,
            "reference_delta_role": "explanatory_only",
        },
    }


def test_endpoint_metadata_is_public_registry_contract_without_bbb_martins():
    response = TestClient(app).get("/api/prioritization/metadata")
    assert response.status_code == 200
    payload = response.json()
    endpoint_ids = {endpoint["endpoint_id"] for endpoint in payload["endpoints"]}
    assert "bbb_martins" not in endpoint_ids
    assert {"gmc_mpnn_bbb", "QED", "best_vina_affinity_kcal_mol"} <= endpoint_ids
    assert all("description" in endpoint for endpoint in payload["endpoints"])
    assert payload["profile_options"]["component_ids"] == [
        "admet", "docking", "molecular_quality",
    ]
    assert payload["profile_options"]["docking_normalizations"] == ["within_library"]
    assert "default_profile" not in payload
    assert len(payload["builtin_profiles"]) == 6
    built_in = payload["builtin_profiles"][0]
    assert built_in["profile_id"] == "moloptima_cns_literature_v2"
    assert built_in["profile_version"] == "1.0.0"
    assert built_in["status"] == "frozen"
    assert built_in["current"] is True
    assert built_in["recommended"] is True
    assert built_in["read_only"] is True
    assert built_in["scoreable"] is True
    assert built_in["profile_sha256"] == profile_sha256(
        PrioritizationProfile.from_dict(built_in["profile"])
    )
    assert payload["builtin_profiles"][1]["profile_id"] == (
        "moloptima_general_systemic_oral_v2"
    )
    assert payload["builtin_profiles"][1]["profile_version"] == "1.0.0"
    assert payload["builtin_profiles"][1]["status"] == "frozen"
    assert payload["builtin_profiles"][1]["current"] is True
    assert payload["builtin_profiles"][1]["read_only"] is True
    assert payload["builtin_profiles"][2]["profile_id"] == (
        "moloptima_peripheral_systemic_oral_v2"
    )
    assert payload["builtin_profiles"][2]["profile_version"] == "1.0.0"
    assert payload["builtin_profiles"][2]["status"] == "frozen"
    assert payload["builtin_profiles"][2]["current"] is True
    assert payload["builtin_profiles"][2]["read_only"] is True
    assert all(
        historical["profile_version"] == "0.1.0"
        and historical["status"] == "draft"
        and historical["historical"] is True
        for historical in payload["builtin_profiles"][3:]
    )


def test_valid_profile_validation_returns_scoreability_hash_and_canonical_profile():
    profile = synthetic_profile()
    response = TestClient(app).post(
        "/api/prioritization/profiles/validate", json={"profile": profile}
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["structurally_valid"] is True
    assert payload["scoreable"] is True
    assert payload["errors"] == []
    assert payload["profile_sha256"] == profile_sha256(PrioritizationProfile.from_dict(profile))
    assert payload["profile"]["component_weights"] == {
        "docking": 0.0, "admet": 0.0, "molecular_quality": 1.0,
    }


def test_incomplete_profile_is_hashable_draft_but_rejected_for_scoring():
    profile = synthetic_profile()
    profile["component_weights"] = {}
    payload = TestClient(app).post(
        "/api/prioritization/profiles/validate", json={"profile": profile}
    ).json()
    assert payload["structurally_valid"] is True
    assert payload["scoreable"] is False
    assert len(payload["profile_sha256"]) == 64
    assert "explicit component weights" in payload["errors"][0]


def test_invalid_transform_weights_and_unknown_endpoint_fail_validation():
    cases = []
    invalid_transform = synthetic_profile()
    invalid_transform["endpoint_rules"]["QED"]["transform"] = {
        "type": "increasing_sigmoid", "params": {},
    }
    cases.append((invalid_transform, "parameters are invalid"))
    invalid_weight = synthetic_profile()
    invalid_weight["component_weights"]["molecular_quality"] = -1
    cases.append((invalid_weight, "Component weight"))
    unknown = synthetic_profile()
    unknown["endpoint_rules"]["unknown_endpoint"] = unknown["endpoint_rules"].pop("QED")
    cases.append((unknown, "Unknown scientific endpoint"))

    client = TestClient(app)
    for profile, message in cases:
        payload = client.post(
            "/api/prioritization/profiles/validate", json={"profile": profile}
        ).json()
        assert payload["scoreable"] is False
        assert message in payload["errors"][0]


def test_job_api_keeps_legacy_default_and_passes_explicit_v2_profile(monkeypatch):
    captured = []

    def fake_run(upload_id, **options):
        captured.append({"upload_id": upload_id, **options})
        return {
            "job_id": f"job-{len(captured)}",
            "upload_id": upload_id,
            "status": "queued",
            "stage": "queued",
            "input_file": "uploads/input.csv",
            "output_file": "jobs/output.csv",
            "created_at": "2026-01-01T00:00:00+00:00",
            "prioritization_method": options["prioritization_method"],
            "prioritization_profile_sha256": None,
        }

    monkeypatch.setattr(services, "run_prioritization_job", fake_run)
    client = TestClient(app)
    legacy = client.post("/api/jobs/prioritization", json={"upload_id": "upload-1"})
    v2 = client.post("/api/jobs/prioritization", json={
        "upload_id": "upload-2",
        "prioritization_method": "v2",
        "prioritization_profile": synthetic_profile(),
    })
    assert legacy.status_code == v2.status_code == 200
    assert captured[0]["prioritization_method"] == "legacy_v1"
    assert captured[0]["prioritization_profile"] is None
    assert captured[1]["prioritization_method"] == "v2"
    assert captured[1]["prioritization_profile"] == synthetic_profile()


def test_v2_job_fails_closed_without_a_scoreable_profile(tmp_path, monkeypatch):
    monkeypatch.setattr(services, "find_upload_path", lambda _upload_id: tmp_path / "input.csv")
    monkeypatch.setattr(services, "validate_molecule_csv", lambda _path: 1)
    client = TestClient(app)
    missing = client.post("/api/jobs/prioritization", json={
        "upload_id": "upload-v2", "prioritization_method": "v2",
    })
    incomplete = copy.deepcopy(synthetic_profile())
    incomplete["component_weights"] = {}
    invalid = client.post("/api/jobs/prioritization", json={
        "upload_id": "upload-v2", "prioritization_method": "v2",
        "prioritization_profile": incomplete,
    })
    assert missing.status_code == invalid.status_code == 422
    assert "requires an explicit complete profile" in missing.json()["detail"]
    assert "not scoreable" in invalid.json()["detail"]


def test_v2_explanation_contract_serializes_through_backend_result_schema():
    profile = PrioritizationProfile.from_dict(synthetic_profile())
    row = score_candidates_v2([{
        "molecule_id": "mol-v2",
        "canonical_smiles": "CCO",
        "valid_molecule": True,
        "scientific_endpoint_values": {"QED": 0.8},
    }], profile)[0]
    endpoints = unavailable_admet_prediction(
        "CCO", prediction_status="model_unavailable", warning="test-only unavailable"
    )["endpoints"]
    endpoints.pop("bbb_martins")
    serialized = MoleculeAnalysisResult.model_validate({
        **row,
        "admet_model_status": "model_unavailable",
        "admet_warning": "test-only unavailable",
        "admet_predictions": endpoints,
    }).model_dump()
    assert serialized["prioritization_method"] == "profile_v2"
    assert serialized["v2_score"] == 0.8
    assert serialized["prioritization_v2"]["summary"]["final_score"] == 0.8
    assert serialized["prioritization_v2"]["provenance"]["profile_sha256"] == profile_sha256(profile)


def test_pareto_analysis_route_is_opt_in_explanatory_and_excludes_unrankable():
    result = {
        "molecule_id": "eligible",
        "v2_rank_eligible": True,
        "v2_rank": 1,
        "v2_score": 0.8,
        "prioritization_v2": {
            "components": {
                "docking": {"score": 0.7},
                "admet": {"score": 0.8},
                "molecular_quality": {"score": 0.9},
            },
            "liabilities": {"combined_penalty_factor": 1.0},
        },
    }
    gated = copy.deepcopy(result)
    gated.update({"molecule_id": "gated", "v2_rank_eligible": False, "v2_rank": None, "v2_score": None})
    response = TestClient(app).post("/api/prioritization/analysis/pareto", json={
        "results": [result, gated],
        "dimensions": ["docking", "admet", "molecular_quality", "safety"],
    })
    assert response.status_code == 200
    payload = response.json()
    assert payload["explanatory_only"] is True
    assert payload["results"][0]["molecule_id"] == "eligible"
    assert payload["results"][0]["pareto_front"] == 1
    assert payload["excluded_unrankable_count"] == 1


def test_sensitivity_route_uses_scoreable_profile_and_invalid_profile_fails_closed():
    candidate = {
        "molecule_id": "mol",
        "canonical_smiles": "CCO",
        "valid_molecule": True,
        "scientific_endpoint_values": {"QED": 0.8},
    }
    request = {
        "candidates": [candidate],
        "profile": synthetic_profile(),
        "perturbation_magnitude": 0.1,
        "number_of_samples": 5,
        "analysis_seed": 2025,
    }
    client = TestClient(app)
    response = client.post("/api/prioritization/analysis/sensitivity", json=request)
    assert response.status_code == 200
    payload = response.json()
    assert payload["explanatory_only"] is True
    assert payload["results"][0]["baseline_rank"] == 1
    assert payload["provenance"]["source_profile_sha256"] == profile_sha256(
        PrioritizationProfile.from_dict(request["profile"])
    )

    invalid = copy.deepcopy(request)
    invalid["profile"]["component_weights"] = {}
    rejected = client.post("/api/prioritization/analysis/sensitivity", json=invalid)
    assert rejected.status_code == 422
    assert "valid scoreable v2 profile" in rejected.json()["detail"]
