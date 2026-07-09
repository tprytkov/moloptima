import csv
import json
from pathlib import Path

from fastapi.testclient import TestClient

from backend import services
from backend.main import app


def configure_temp_app_data(tmp_path: Path, monkeypatch):
    app_data = tmp_path / "app_data"
    monkeypatch.setattr(services.model_sources, "APP_DATA_DIR", app_data)
    monkeypatch.setattr(services.model_sources, "MODEL_CACHE_DIR", app_data / "model_cache")
    monkeypatch.setattr(
        services.model_sources,
        "HUGGINGFACE_CACHE_DIR",
        app_data / "model_cache" / "huggingface",
    )
    monkeypatch.setattr(
        services.model_sources,
        "PUBLIC_LOOKUP_CACHE_DIR",
        app_data / "public_lookup_cache",
    )
    monkeypatch.setattr(services.model_sources, "MANIFEST_DIR", app_data / "manifests")
    monkeypatch.setattr(
        services.model_sources,
        "MODEL_MANIFEST_PATH",
        app_data / "manifests" / "model_manifest.json",
    )
    monkeypatch.setattr(
        services.model_sources,
        "PUBLIC_DATA_MANIFEST_PATH",
        app_data / "manifests" / "public_data_manifest.json",
    )
    monkeypatch.setattr(
        services.model_sources,
        "RUN_MANIFEST_PATH",
        app_data / "manifests" / "run_manifest.json",
    )
    monkeypatch.setenv("MOLOPTIMA_BBB_MODEL_CACHE", str(app_data / "model_cache" / "huggingface"))


def test_health_endpoint():
    client = TestClient(app)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "moloptima-backend"}


def test_upload_run_and_get_results(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(services, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(services, "UPLOAD_DIR", tmp_path / "backend" / "uploads")
    monkeypatch.setattr(services, "JOB_OUTPUT_DIR", tmp_path / "backend" / "job_outputs")
    monkeypatch.setattr(services, "JOB_METADATA_DIR", tmp_path / "backend" / "job_metadata")
    configure_temp_app_data(tmp_path, monkeypatch)

    prioritize_options = {}

    def fake_prioritize_csv(input_path, output_path, *, enable_public_lookup=False):
        prioritize_options["enable_public_lookup"] = enable_public_lookup
        rows = [
            {
                "molecule_id": "mol_1",
                "input_smiles": "CCO",
                "canonical_smiles": "CCO",
                "valid_molecule": True,
                "priority_score": 0.75,
                "bbb_prediction": "unavailable",
                "bbb_probability": None,
                "bbb_model_status": "model_unavailable",
                "bbb_warning": "model missing",
                "pubchem_lookup_status": "not_requested",
            }
        ]
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        with Path(output_path).open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)
        return rows

    monkeypatch.setattr(services, "prioritize_csv", fake_prioritize_csv)
    client = TestClient(app)

    upload_response = client.post(
        "/api/molecules/upload",
        files={"file": ("molecules.csv", b"molecule_id,smiles\nmol_1,CCO\n", "text/csv")},
    )

    assert upload_response.status_code == 200
    upload_payload = upload_response.json()
    assert upload_payload["filename"] == "molecules.csv"
    assert upload_payload["status"] == "uploaded"
    assert upload_payload["rows"] == 1

    job_response = client.post(
        "/api/jobs/prioritization",
        json={"upload_id": upload_payload["upload_id"]},
    )

    assert job_response.status_code == 200
    job_payload = job_response.json()
    assert job_payload["status"] == "completed"
    assert job_payload["row_count"] == 1
    assert job_payload["input_file"].endswith("molecules.csv")
    assert job_payload["output_file"].endswith("ranked_results.csv")
    assert job_payload["created_at"]
    assert job_payload["completed_at"]
    assert job_payload["error_message"] == ""
    assert prioritize_options["enable_public_lookup"] is False

    metadata_path = services.JOB_METADATA_DIR / f"{job_payload['job_id']}.json"
    assert metadata_path.exists()
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    assert metadata["status"] == "completed"

    result_response = client.get(f"/api/results/{job_payload['job_id']}")

    assert result_response.status_code == 200
    result_payload = result_response.json()
    assert result_payload["job_id"] == job_payload["job_id"]
    assert result_payload["status"] == "completed"
    assert result_payload["results"][0]["molecule_id"] == "mol_1"

    run_manifest = json.loads(
        services.model_sources.RUN_MANIFEST_PATH.read_text(encoding="utf-8")
    )
    latest_run = run_manifest["runs"][job_payload["job_id"]]
    assert latest_run["actual_bbb_model_status"] == "model_unavailable"
    assert latest_run["fallback_placeholder_used"] is True
    assert latest_run["bbb_model_status_values"] == ["model_unavailable"]
    assert latest_run["public_lookup_requested"] is False


def test_latest_job_endpoint_returns_latest_completed_job(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(services, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(services, "JOB_OUTPUT_DIR", tmp_path / "backend" / "job_outputs")
    monkeypatch.setattr(services, "JOB_METADATA_DIR", tmp_path / "backend" / "job_metadata")

    older_job_id = "older-job"
    latest_job_id = "latest-job"
    failed_job_id = "failed-job"
    for job_id, molecule_id in [(older_job_id, "old_mol"), (latest_job_id, "latest_mol")]:
        output_path = services.JOB_OUTPUT_DIR / job_id / "ranked_results.csv"
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with output_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=["molecule_id", "priority_score"])
            writer.writeheader()
            writer.writerow({"molecule_id": molecule_id, "priority_score": 0.8})

    services.write_job_metadata(
        {
            "job_id": older_job_id,
            "upload_id": "upload-1",
            "status": "completed",
            "input_file": "backend/uploads/upload-1/molecules.csv",
            "output_file": f"backend/job_outputs/{older_job_id}/ranked_results.csv",
            "created_at": "2026-01-01T00:00:00+00:00",
            "completed_at": "2026-01-01T00:01:00+00:00",
            "error_message": "",
            "row_count": 1,
        }
    )
    services.write_job_metadata(
        {
            "job_id": latest_job_id,
            "upload_id": "upload-2",
            "status": "completed",
            "input_file": "backend/uploads/upload-2/molecules.csv",
            "output_file": f"backend/job_outputs/{latest_job_id}/ranked_results.csv",
            "created_at": "2026-01-02T00:00:00+00:00",
            "completed_at": "2026-01-02T00:01:00+00:00",
            "error_message": "",
            "row_count": 1,
        }
    )
    services.write_job_metadata(
        {
            "job_id": failed_job_id,
            "upload_id": "upload-3",
            "status": "failed",
            "input_file": "backend/uploads/upload-3/molecules.csv",
            "output_file": f"backend/job_outputs/{failed_job_id}/ranked_results.csv",
            "created_at": "2026-01-03T00:00:00+00:00",
            "completed_at": "2026-01-03T00:01:00+00:00",
            "error_message": "failed",
            "row_count": 0,
        }
    )

    client = TestClient(app)
    response = client.get("/api/jobs/latest")

    assert response.status_code == 200
    payload = response.json()
    assert payload["job"]["job_id"] == latest_job_id
    assert payload["job"]["status"] == "completed"
    assert payload["job"]["results"][0]["molecule_id"] == "latest_mol"


def test_latest_job_endpoint_returns_null_when_no_completed_job(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(services, "JOB_METADATA_DIR", tmp_path / "backend" / "job_metadata")
    services.write_job_metadata(
        {
            "job_id": "failed-job",
            "upload_id": "upload-1",
            "status": "failed",
            "input_file": "backend/uploads/upload-1/molecules.csv",
            "output_file": "backend/job_outputs/failed-job/ranked_results.csv",
            "created_at": "2026-01-01T00:00:00+00:00",
            "completed_at": "2026-01-01T00:01:00+00:00",
            "error_message": "failed",
            "row_count": 0,
        }
    )
    client = TestClient(app)

    response = client.get("/api/jobs/latest")

    assert response.status_code == 200
    assert response.json() == {"job": None}


def test_model_source_status_endpoints(tmp_path: Path, monkeypatch):
    configure_temp_app_data(tmp_path, monkeypatch)
    client = TestClient(app)

    check_response = client.get("/api/model-sources/status")
    refresh_response = client.post("/api/model-sources/refresh")

    assert check_response.status_code == 200
    assert refresh_response.status_code == 200
    check_payload = check_response.json()
    assert "bbb_chemberta" in check_payload["model_manifest"]["models"]
    assert set(refresh_response.json()["public_data_manifest"]["sources"]) == {
        "PubChem",
        "ChEMBL",
        "SureChEMBL",
    }
    assert check_payload["public_data_manifest"]["sources"]["PubChem"]["status"] in {
        "available_when_requested",
        "not_requested",
    }


def test_prioritization_job_passes_public_lookup_flag(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(services, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(services, "UPLOAD_DIR", tmp_path / "backend" / "uploads")
    monkeypatch.setattr(services, "JOB_OUTPUT_DIR", tmp_path / "backend" / "job_outputs")
    monkeypatch.setattr(services, "JOB_METADATA_DIR", tmp_path / "backend" / "job_metadata")
    configure_temp_app_data(tmp_path, monkeypatch)
    prioritize_options = {}

    def fake_prioritize_csv(input_path, output_path, *, enable_public_lookup=False):
        prioritize_options["enable_public_lookup"] = enable_public_lookup
        rows = [
            {
                "molecule_id": "mol_1",
                "input_smiles": "CCO",
                "canonical_smiles": "CCO",
                "valid_molecule": True,
                "priority_score": 0.75,
                "bbb_model_status": "model_unavailable",
                "pubchem_lookup_status": "exact_match",
            }
        ]
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        with Path(output_path).open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)
        return rows

    monkeypatch.setattr(services, "prioritize_csv", fake_prioritize_csv)
    client = TestClient(app)
    upload_response = client.post(
        "/api/molecules/upload",
        files={"file": ("molecules.csv", b"molecule_id,smiles\nmol_1,CCO\n", "text/csv")},
    )

    job_response = client.post(
        "/api/jobs/prioritization",
        json={
            "upload_id": upload_response.json()["upload_id"],
            "enable_public_lookup": True,
        },
    )

    assert job_response.status_code == 200
    assert prioritize_options["enable_public_lookup"] is True
    run_manifest = json.loads(
        services.model_sources.RUN_MANIFEST_PATH.read_text(encoding="utf-8")
    )
    latest_run = run_manifest["runs"][job_response.json()["job_id"]]
    assert latest_run["public_lookup_requested"] is True
    assert latest_run["pubchem_lookup_status_values"] == ["exact_match"]


def test_model_source_status_endpoint_reports_cached_bbb_model(tmp_path: Path, monkeypatch):
    configure_temp_app_data(tmp_path, monkeypatch)
    cache_root = tmp_path / "app_data" / "model_cache" / "huggingface"
    services.model_sources.cache_candidates(
        cache_root,
        services.model_sources.CHEMBERTA_BBB_MODEL_ID,
    )[0].mkdir(parents=True)
    client = TestClient(app)

    response = client.get("/api/model-sources/status")

    assert response.status_code == 200
    model = response.json()["model_manifest"]["models"]["bbb_chemberta"]
    assert model["cached"] is True
    assert model["status"] == "cached"


def test_upload_rejects_missing_required_columns(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(services, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(services, "UPLOAD_DIR", tmp_path / "backend" / "uploads")
    client = TestClient(app)

    response = client.post(
        "/api/molecules/upload",
        files={"file": ("bad.csv", b"id,value\nmol_1,CCO\n", "text/csv")},
    )

    assert response.status_code == 400
    assert "missing required columns" in response.json()["detail"]


def test_get_results_returns_404_for_unknown_job(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(services, "JOB_METADATA_DIR", tmp_path / "backend" / "job_metadata")
    client = TestClient(app)

    response = client.get("/api/results/missing")

    assert response.status_code == 404


def test_prioritization_failure_writes_failed_metadata(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(services, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(services, "UPLOAD_DIR", tmp_path / "backend" / "uploads")
    monkeypatch.setattr(services, "JOB_OUTPUT_DIR", tmp_path / "backend" / "job_outputs")
    monkeypatch.setattr(services, "JOB_METADATA_DIR", tmp_path / "backend" / "job_metadata")

    def failing_prioritize_csv(input_path, output_path, *, enable_public_lookup=False):
        raise RuntimeError("synthetic pipeline failure")

    monkeypatch.setattr(services, "prioritize_csv", failing_prioritize_csv)
    client = TestClient(app)

    upload_response = client.post(
        "/api/molecules/upload",
        files={"file": ("molecules.csv", b"molecule_id,smiles\nmol_1,CCO\n", "text/csv")},
    )
    upload_id = upload_response.json()["upload_id"]

    job_response = client.post(
        "/api/jobs/prioritization",
        json={"upload_id": upload_id},
    )

    assert job_response.status_code == 422
    assert "synthetic pipeline failure" in job_response.json()["detail"]

    metadata_files = list(services.JOB_METADATA_DIR.glob("*.json"))
    assert len(metadata_files) == 1
    metadata = json.loads(metadata_files[0].read_text(encoding="utf-8"))
    assert metadata["status"] == "failed"
    assert metadata["error_message"] == "synthetic pipeline failure"
    assert metadata["completed_at"]

    result_response = client.get(f"/api/results/{metadata['job_id']}")
    assert result_response.status_code == 200
    result_payload = result_response.json()
    assert result_payload["status"] == "failed"
    assert result_payload["results"] == []
