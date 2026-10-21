from __future__ import annotations

import json
import time
from pathlib import Path

from fastapi.testclient import TestClient

from backend import services
from backend.main import app
from molecular_prioritization.admet_registry import CLASSIFICATION_ENDPOINTS, REGRESSION_ENDPOINTS
from molecular_prioritization.admet_service import run_full_admet_panel


TERMINAL = {"completed", "completed_with_warnings", "failed", "cancelled"}


class FakeRegistry:
    def __init__(self, *, unavailable_family: str = ""):
        self.unavailable_family = unavailable_family
        self.runtime_identities = [
            {"family": family, "runtime_source": "test", "status": "success"}
            for family in ("chemberta", "gmc_mpnn_bbb", "chemprop_regression")
            if unavailable_family != "all" and family != unavailable_family
        ]

    def predict_batch(self, molecule_ids, canonical_smiles):
        rows = []
        for molecule_id, smiles in zip(molecule_ids, canonical_smiles, strict=True):
            chemberta_status = "model_unavailable" if self.unavailable_family in {"chemberta", "all"} else "success"
            gmc_status = "model_unavailable" if self.unavailable_family in {"gmc_mpnn_bbb", "all"} else "success"
            regression_status = "model_unavailable" if self.unavailable_family in {"chemprop_regression", "all"} else "success"
            warning = "runtime unavailable" if self.unavailable_family else ""
            classification = {
                "status": chemberta_status,
                "warning": warning if self.unavailable_family == "chemberta" else "",
                "endpoints": {
                    name: {
                        "raw_logit": None if chemberta_status != "success" else 0.0,
                        "raw_probability": None if chemberta_status != "success" else 0.0,
                        "calibrated_probability": None if chemberta_status != "success" else 0.0,
                        "binary_prediction": None if chemberta_status != "success" else 0,
                        "display_name": name,
                        "positive_class_meaning": f"positive {name}",
                        "evidence_status": "unavailable" if chemberta_status != "success" else "qualified",
                        "warning": warning if chemberta_status != "success" else "",
                    }
                    for name in CLASSIFICATION_ENDPOINTS
                },
            }
            bbb = {
                "status": gmc_status,
                "seed_probabilities": {} if gmc_status != "success" else {"seed_1": 0.6},
                "ensemble_probability": None if gmc_status != "success" else 0.6,
                "ensemble_standard_deviation": None if gmc_status != "success" else 0.0,
                "threshold": 0.5,
                "threshold_status": "provisional_raw",
                "raw_classification": None if gmc_status != "success" else "BBB+",
                "calibration_status": "not_frozen",
                "prediction": "unavailable" if gmc_status != "success" else "BBB+",
                "warning": warning if gmc_status != "success" else "",
            }
            regression = {
                "status": regression_status,
                "endpoints": {
                    name: {
                        "status": regression_status,
                        "ensemble_mean_value": None if regression_status != "success" else 0.0,
                        "unit": None if regression_status != "success" else f"unit-{name}",
                        "warning": warning if regression_status != "success" else "",
                    }
                    for name in REGRESSION_ENDPOINTS
                },
            }
            family_status = {
                "chemberta": chemberta_status,
                "gmc_bbb": gmc_status,
                "chemprop_regression": regression_status,
            }
            successes = sum(value == "success" for value in family_status.values())
            rows.append({
                "molecule_id": molecule_id,
                "canonical_smiles": smiles,
                "status": "success" if successes == 3 else "partial_success" if successes else "model_unavailable",
                "warning": warning,
                "family_status": family_status,
                "classification": classification,
                "bbb": bbb,
                "regression": regression,
            })
        return rows


def configure_storage(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(services, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(services, "UPLOAD_DIR", tmp_path / "backend" / "uploads")
    monkeypatch.setattr(services, "ADMET_RUN_OUTPUT_DIR", tmp_path / "backend" / "admet_run_outputs")
    monkeypatch.setattr(services, "ADMET_RUN_METADATA_DIR", tmp_path / "backend" / "admet_run_metadata")


def write_collection(upload_id: str, records: list[dict[str, object]]) -> None:
    directory = services.UPLOAD_DIR / upload_id
    directory.mkdir(parents=True, exist_ok=True)
    payload = {
        "records": records,
        "summary": {
            "submitted_count": len(records),
            "valid_count": sum(record.get("validation_status") == "valid" for record in records),
            "invalid_count": sum(record.get("validation_status") != "valid" for record in records),
        },
    }
    (directory / "molecule_collection.json").write_text(json.dumps(payload), encoding="utf-8")


def record(molecule_id: str, smiles: str, *, valid: bool = True) -> dict[str, object]:
    return {
        "molecule_id": molecule_id,
        "original_molecule_id": molecule_id,
        "canonical_smiles": smiles if valid else "",
        "validation_status": "valid" if valid else "invalid",
        "failure_reason": "" if valid else "RDKit could not parse SMILES.",
    }


def use_fake_runtime(monkeypatch, *, unavailable_family: str = "") -> None:
    monkeypatch.setattr(
        services,
        "run_full_admet_panel",
        lambda records: run_full_admet_panel(records, registry=FakeRegistry(unavailable_family=unavailable_family)),
    )


def wait_for_run(client: TestClient, run_id: str) -> dict[str, object]:
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        payload = client.get(f"/api/admet/runs/{run_id}").json()
        if payload["status"] in TERMINAL:
            return payload
        time.sleep(0.01)
    raise AssertionError("Timed out waiting for independent ADMET run")


def test_independent_api_runs_full_panel_persists_and_preserves_invalid_rows(tmp_path, monkeypatch):
    configure_storage(tmp_path, monkeypatch)
    use_fake_runtime(monkeypatch)
    upload_id = "a" * 32
    write_collection(upload_id, [record("ethanol", "CCO"), record("bad", "not-smiles", valid=False)])
    client = TestClient(app)

    created = client.post("/api/admet/runs", json={"upload_id": upload_id}).json()
    terminal = wait_for_run(client, created["run_id"])
    assert terminal["status"] == "completed"
    assert terminal["processed_count"] == 2
    response = client.get(f"/api/admet/runs/{created['run_id']}/result")
    assert response.status_code == 200
    payload = response.json()
    assert payload["panel"] == "full_frozen_panel"
    assert payload["endpoint_count"] == 15
    assert payload["model_families"] == ["chemberta", "gmc_mpnn_bbb", "chemprop_regression"]
    assert len(payload["results"]) == 2
    assert len(payload["results"][0]["admet_predictions"]) + 1 + len(payload["results"][0]["admet_regression"]["endpoints"]) == 15
    assert payload["results"][0]["admet_predictions"]["hia_hou"]["calibrated_probability"] == 0.0
    assert payload["results"][0]["admet_regression"]["endpoints"]["caco2_wang"]["ensemble_mean_value"] == 0.0
    assert payload["results"][1]["admet_model_status"] == "not_run_invalid_molecule"
    assert Path(tmp_path / terminal["output_file"]).is_file()
    prioritization_ids = {job["job_id"] for job in client.get("/api/jobs/history").json()["jobs"]}
    assert created["run_id"] not in prioritization_ids


def test_partial_runtime_failure_completes_with_warnings_and_keeps_successes(tmp_path, monkeypatch):
    configure_storage(tmp_path, monkeypatch)
    use_fake_runtime(monkeypatch, unavailable_family="chemprop_regression")
    upload_id = "b" * 32
    write_collection(upload_id, [record("ethanol", "CCO")])
    client = TestClient(app)
    created = client.post("/api/admet/runs", json={"upload_id": upload_id}).json()
    terminal = wait_for_run(client, created["run_id"])
    assert terminal["status"] == "completed_with_warnings"
    result = client.get(f"/api/admet/runs/{created['run_id']}/result").json()["results"][0]
    assert result["admet_predictions"]["hia_hou"]["calibrated_probability"] == 0.0
    assert result["bbb_result"]["ensemble_probability"] == 0.6
    assert result["admet_regression"]["status"] == "model_unavailable"
    assert result["admet_regression"]["endpoints"]["caco2_wang"]["ensemble_mean_value"] is None


def test_all_runtime_families_unavailable_remain_explicit_results(tmp_path, monkeypatch):
    configure_storage(tmp_path, monkeypatch)
    use_fake_runtime(monkeypatch, unavailable_family="all")
    upload_id = "9" * 32
    write_collection(upload_id, [record("ethanol", "CCO")])
    client = TestClient(app)
    created = client.post("/api/admet/runs", json={"upload_id": upload_id}).json()
    terminal = wait_for_run(client, created["run_id"])
    assert terminal["status"] == "completed_with_warnings"
    assert terminal["admet_success_count"] == 0
    result = client.get(f"/api/admet/runs/{created['run_id']}/result").json()["results"][0]
    assert set(result["admet_family_status"].values()) == {"model_unavailable"}
    assert result["admet_predictions"]["hia_hou"]["calibrated_probability"] is None
    assert result["bbb_result"]["ensemble_probability"] is None
    assert result["admet_regression"]["endpoints"]["caco2_wang"]["ensemble_mean_value"] is None


def test_empty_and_invalid_only_collections_are_rejected(tmp_path, monkeypatch):
    configure_storage(tmp_path, monkeypatch)
    empty_id = "c" * 32
    invalid_id = "d" * 32
    write_collection(empty_id, [])
    write_collection(invalid_id, [record("bad", "bad", valid=False)])
    client = TestClient(app)
    assert client.post("/api/admet/runs", json={"upload_id": empty_id}).status_code == 422
    response = client.post("/api/admet/runs", json={"upload_id": invalid_id})
    assert response.status_code == 422
    assert "valid compound" in response.json()["detail"]


def test_request_forbids_selective_models_endpoints_and_unknown_panel(tmp_path, monkeypatch):
    configure_storage(tmp_path, monkeypatch)
    upload_id = "e" * 32
    write_collection(upload_id, [record("ethanol", "CCO")])
    client = TestClient(app)
    assert client.post("/api/admet/runs", json={"upload_id": upload_id, "endpoints": ["hia_hou"]}).status_code == 422
    assert client.post("/api/admet/runs", json={"upload_id": upload_id, "model_families": ["chemberta"]}).status_code == 422
    assert client.post("/api/admet/runs", json={"upload_id": upload_id, "panel": "bbb_only"}).status_code == 422


def test_run_identity_isolates_collections_and_detects_tampered_result(tmp_path, monkeypatch):
    configure_storage(tmp_path, monkeypatch)
    use_fake_runtime(monkeypatch)
    first_id, second_id = "1" * 32, "2" * 32
    write_collection(first_id, [record("first", "CCO")])
    write_collection(second_id, [record("second", "CCN")])
    client = TestClient(app)
    first = client.post("/api/admet/runs", json={"upload_id": first_id}).json()
    second = client.post("/api/admet/runs", json={"upload_id": second_id}).json()
    first_terminal = wait_for_run(client, first["run_id"])
    wait_for_run(client, second["run_id"])
    assert first["run_id"] != second["run_id"]
    assert first["molecule_collection_sha256"] != second["molecule_collection_sha256"]
    assert client.get(f"/api/admet/runs/{first['run_id']}/result").json()["results"][0]["molecule_id"] == "first"
    output_path = tmp_path / first_terminal["output_file"]
    payload = json.loads(output_path.read_text(encoding="utf-8"))
    payload["upload_id"] = second_id
    output_path.write_text(json.dumps(payload), encoding="utf-8")
    assert client.get(f"/api/admet/runs/{first['run_id']}/result").status_code == 409


def test_queued_run_can_cancel_without_unsafe_running_process_termination(tmp_path, monkeypatch):
    configure_storage(tmp_path, monkeypatch)
    upload_id = "f" * 32
    write_collection(upload_id, [record("ethanol", "CCO")])
    monkeypatch.setattr(services.job_runner, "submit", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(services.job_runner, "request_cancel", lambda _run_id: True)
    client = TestClient(app)
    created = client.post("/api/admet/runs", json={"upload_id": upload_id}).json()
    cancelled = client.post(f"/api/admet/runs/{created['run_id']}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    assert cancelled.json()["cancellation_requested"] is True
    assert client.get(f"/api/admet/runs/{created['run_id']}/result").json()["results"] == []


def test_result_is_not_available_before_run_completion(tmp_path, monkeypatch):
    configure_storage(tmp_path, monkeypatch)
    upload_id = "0" * 32
    write_collection(upload_id, [record("ethanol", "CCO")])
    monkeypatch.setattr(services.job_runner, "submit", lambda *_args, **_kwargs: None)
    client = TestClient(app)
    created = client.post("/api/admet/runs", json={"upload_id": upload_id}).json()
    response = client.get(f"/api/admet/runs/{created['run_id']}/result")
    assert response.status_code == 409
    assert "not ready" in response.json()["detail"]


def test_collection_identity_change_fails_run_before_inference(tmp_path, monkeypatch):
    configure_storage(tmp_path, monkeypatch)
    use_fake_runtime(monkeypatch)
    upload_id = "8" * 32
    write_collection(upload_id, [record("ethanol", "CCO")])
    monkeypatch.setattr(services.job_runner, "submit", lambda *_args, **_kwargs: None)
    client = TestClient(app)
    created = client.post("/api/admet/runs", json={"upload_id": upload_id}).json()
    write_collection(upload_id, [record("changed", "CCN")])
    services._execute_admet_job(created["run_id"])
    terminal = client.get(f"/api/admet/runs/{created['run_id']}").json()
    assert terminal["status"] == "failed"
    assert "identity changed" in terminal["error_message"]


def test_running_inference_reports_cancellation_as_unsupported(tmp_path, monkeypatch):
    configure_storage(tmp_path, monkeypatch)
    upload_id = "7" * 32
    write_collection(upload_id, [record("ethanol", "CCO")])
    monkeypatch.setattr(services.job_runner, "submit", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(services.job_runner, "request_cancel", lambda _run_id: False)
    client = TestClient(app)
    created = client.post("/api/admet/runs", json={"upload_id": upload_id}).json()
    services.update_admet_run_metadata(created["run_id"], status="running", stage="admet")
    response = client.post(f"/api/admet/runs/{created['run_id']}/cancel")
    assert response.status_code == 409
    assert "cannot be cancelled safely" in response.json()["detail"]
