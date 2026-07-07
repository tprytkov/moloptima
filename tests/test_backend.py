import csv
import json
from pathlib import Path

from fastapi.testclient import TestClient

from backend import services
from backend.main import app


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

    def fake_prioritize_csv(input_path, output_path):
        rows = [
            {
                "molecule_id": "mol_1",
                "input_smiles": "CCO",
                "canonical_smiles": "CCO",
                "valid_molecule": True,
                "priority_score": 0.75,
                "bbb_prediction": "unavailable",
                "bbb_probability": None,
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

    def failing_prioritize_csv(input_path, output_path):
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
