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


def configure_temp_job_storage(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(services, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(services, "UPLOAD_DIR", tmp_path / "backend" / "uploads")
    monkeypatch.setattr(services, "JOB_OUTPUT_DIR", tmp_path / "backend" / "job_outputs")
    monkeypatch.setattr(services, "JOB_METADATA_DIR", tmp_path / "backend" / "job_metadata")
    monkeypatch.setattr(services, "JOB_ANNOTATION_DIR", tmp_path / "backend" / "job_annotations")


def write_completed_job(job_id: str) -> None:
    services.write_job_metadata(
        {
            "job_id": job_id,
            "upload_id": "upload-1",
            "status": "completed",
            "input_file": "backend/uploads/upload-1/molecules.csv",
            "output_file": f"backend/job_outputs/{job_id}/ranked_results.csv",
            "created_at": "2026-01-01T00:00:00+00:00",
            "completed_at": "2026-01-01T00:01:00+00:00",
            "error_message": "",
            "row_count": 1,
        }
    )


def test_health_endpoint():
    client = TestClient(app)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "moloptima-backend"}


def test_structure_endpoint_returns_svg_for_valid_smiles():
    client = TestClient(app)

    response = client.get("/api/molecules/structure", params={"smiles": "CCO"})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/svg+xml")
    assert "<svg" in response.text
    assert "</svg>" in response.text


def test_structure_endpoint_handles_invalid_smiles_gracefully():
    client = TestClient(app)

    response = client.get("/api/molecules/structure", params={"smiles": "not-a-smiles"})

    assert response.status_code == 422
    assert "Invalid or unavailable structure" in response.json()["detail"]


def test_structure_endpoint_handles_missing_smiles_safely():
    client = TestClient(app)

    response = client.get("/api/molecules/structure")

    assert response.status_code == 422


def test_sdf_export_returns_sdf_for_valid_candidate():
    client = TestClient(app)

    response = client.post(
        "/api/candidates/export-sdf",
        json={
            "candidates": [
                {
                    "molecule_id": "ethanol",
                    "canonical_smiles": "CCO",
                    "priority_score": 0.81,
                    "review_status": "selected",
                    "review_note": "Include in handoff.",
                }
            ]
        },
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("chemical/x-mdl-sdfile")
    assert response.headers["x-moloptima-sdf-exported"] == "1"
    assert response.headers["x-moloptima-sdf-skipped"] == "0"
    assert "$$$$" in response.text
    assert ">  <molecule_id>" in response.text
    assert "ethanol" in response.text


def test_sdf_export_supports_multiple_molecules():
    client = TestClient(app)

    response = client.post(
        "/api/candidates/export-sdf",
        json={
            "candidates": [
                {"molecule_id": "ethanol", "canonical_smiles": "CCO"},
                {"molecule_id": "benzene", "input_smiles": "c1ccccc1"},
            ]
        },
    )

    assert response.status_code == 200
    assert response.headers["x-moloptima-sdf-exported"] == "2"
    assert response.text.count("$$$$") == 2


def test_sdf_export_skips_invalid_molecules_when_valid_rows_exist():
    client = TestClient(app)

    response = client.post(
        "/api/candidates/export-sdf",
        json={
            "candidates": [
                {"molecule_id": "invalid", "canonical_smiles": "not-a-smiles"},
                {"molecule_id": "ethanol", "canonical_smiles": "CCO"},
            ]
        },
    )

    assert response.status_code == 200
    assert response.headers["x-moloptima-sdf-exported"] == "1"
    assert response.headers["x-moloptima-sdf-skipped"] == "1"
    assert "ethanol" in response.text
    assert "invalid" not in response.text


def test_sdf_export_writes_key_properties():
    client = TestClient(app)

    response = client.post(
        "/api/candidates/export-sdf",
        json={
            "candidates": [
                {
                    "molecule_id": "mol_1",
                    "canonical_smiles": "CCO",
                    "bbb_prediction": "likely_crosses",
                    "mw": 46.07,
                    "tpsa": 20.23,
                    "chembl_molecule_id": "CHEMBL123",
                    "evidence_summary_category": "public_identity_context",
                    "review_status": "watchlist",
                    "review_note": "Review public data.",
                }
            ]
        },
    )

    assert response.status_code == 200
    sdf_text = response.text
    assert ">  <bbb_prediction>" in sdf_text
    assert "likely_crosses" in sdf_text
    assert ">  <chembl_molecule_id>" in sdf_text
    assert "CHEMBL123" in sdf_text
    assert ">  <review_note>" in sdf_text
    assert "Review public data." in sdf_text


def test_sdf_export_empty_candidate_list_handled_safely():
    client = TestClient(app)

    response = client.post("/api/candidates/export-sdf", json={"candidates": []})

    assert response.status_code == 422
    assert "Candidate list is empty" in response.json()["detail"]


def test_upload_run_and_get_results(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(services, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(services, "UPLOAD_DIR", tmp_path / "backend" / "uploads")
    monkeypatch.setattr(services, "JOB_OUTPUT_DIR", tmp_path / "backend" / "job_outputs")
    monkeypatch.setattr(services, "JOB_METADATA_DIR", tmp_path / "backend" / "job_metadata")
    configure_temp_app_data(tmp_path, monkeypatch)

    prioritize_options = {}

    def fake_prioritize_csv(
        input_path,
        output_path,
        *,
        enable_public_lookup=False,
        enable_pubchem_lookup=None,
        enable_chembl_lookup=False,
        enable_patent_lookup=False,
    ):
        prioritize_options["enable_public_lookup"] = enable_public_lookup
        prioritize_options["enable_pubchem_lookup"] = enable_pubchem_lookup
        prioritize_options["enable_chembl_lookup"] = enable_chembl_lookup
        prioritize_options["enable_patent_lookup"] = enable_patent_lookup
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
                "chembl_lookup_status": "not_requested",
                "patent_lookup_status": "not_requested",
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
    assert prioritize_options["enable_pubchem_lookup"] is False
    assert prioritize_options["enable_chembl_lookup"] is False
    assert prioritize_options["enable_patent_lookup"] is False

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


def test_job_history_endpoint_returns_recent_completed_jobs(tmp_path: Path, monkeypatch):
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
            "public_lookup_requested": False,
            "pubchem_lookup_requested": False,
            "chembl_lookup_requested": False,
            "patent_lookup_requested": False,
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
            "public_lookup_requested": True,
            "pubchem_lookup_requested": True,
            "chembl_lookup_requested": True,
            "patent_lookup_requested": False,
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
            "public_lookup_requested": True,
            "pubchem_lookup_requested": True,
            "chembl_lookup_requested": True,
            "patent_lookup_requested": True,
        }
    )

    client = TestClient(app)
    history_response = client.get("/api/jobs/history")
    result_response = client.get(f"/api/results/{older_job_id}")

    assert history_response.status_code == 200
    jobs = history_response.json()["jobs"]
    assert [job["job_id"] for job in jobs] == [latest_job_id, older_job_id]
    assert jobs[0]["row_count"] == 1
    assert jobs[0]["pubchem_lookup_requested"] is True
    assert jobs[0]["chembl_lookup_requested"] is True
    assert jobs[0]["patent_lookup_requested"] is False
    assert jobs[1]["public_lookup_requested"] is False
    assert result_response.status_code == 200
    assert result_response.json()["results"][0]["molecule_id"] == "old_mol"


def test_job_annotations_missing_file_returns_empty_annotations(tmp_path: Path, monkeypatch):
    configure_temp_job_storage(tmp_path, monkeypatch)
    write_completed_job("job-annotations")
    client = TestClient(app)

    response = client.get("/api/jobs/job-annotations/annotations")

    assert response.status_code == 200
    assert response.json() == {
        "job_id": "job-annotations",
        "annotations": {},
        "updated_at": None,
    }


def test_job_annotations_can_be_saved_and_reloaded(tmp_path: Path, monkeypatch):
    configure_temp_job_storage(tmp_path, monkeypatch)
    write_completed_job("job-annotations")
    client = TestClient(app)

    save_response = client.put(
        "/api/jobs/job-annotations/annotations",
        json={
            "annotations": {
                "aspirin": {
                    "review_status": "selected",
                    "review_note": "Advance for confirmatory review.",
                },
                "caffeine": {
                    "review_status": "watchlist",
                    "review_note": "Check public bioactivity context.",
                },
            }
        },
    )
    reload_response = client.get("/api/jobs/job-annotations/annotations")

    assert save_response.status_code == 200
    payload = save_response.json()
    assert payload["job_id"] == "job-annotations"
    assert payload["annotations"]["aspirin"]["review_status"] == "selected"
    assert payload["annotations"]["aspirin"]["review_note"] == "Advance for confirmatory review."
    assert payload["updated_at"]
    assert reload_response.status_code == 200
    assert reload_response.json()["annotations"] == payload["annotations"]


def test_job_annotations_normalize_unknown_status(tmp_path: Path, monkeypatch):
    configure_temp_job_storage(tmp_path, monkeypatch)
    write_completed_job("job-annotations")
    client = TestClient(app)

    response = client.put(
        "/api/jobs/job-annotations/annotations",
        json={
            "annotations": {
                "mol_1": {
                    "review_status": "not-a-status",
                    "review_note": "x" * 600,
                }
            }
        },
    )

    assert response.status_code == 200
    annotation = response.json()["annotations"]["mol_1"]
    assert annotation["review_status"] == "unreviewed"
    assert len(annotation["review_note"]) == 500


def test_job_annotations_reject_unknown_or_unsafe_job_id(tmp_path: Path, monkeypatch):
    configure_temp_job_storage(tmp_path, monkeypatch)
    client = TestClient(app)

    missing_response = client.get("/api/jobs/missing/annotations")
    unsafe_response = client.put(
        "/api/jobs/..%2Funsafe/annotations",
        json={"annotations": {}},
    )

    assert missing_response.status_code == 404
    assert unsafe_response.status_code == 404


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
    assert check_payload["public_data_manifest"]["sources"]["ChEMBL"]["status"] in {
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

    def fake_prioritize_csv(
        input_path,
        output_path,
        *,
        enable_public_lookup=False,
        enable_pubchem_lookup=None,
        enable_chembl_lookup=False,
        enable_patent_lookup=False,
    ):
        prioritize_options["enable_public_lookup"] = enable_public_lookup
        prioritize_options["enable_pubchem_lookup"] = enable_pubchem_lookup
        prioritize_options["enable_chembl_lookup"] = enable_chembl_lookup
        prioritize_options["enable_patent_lookup"] = enable_patent_lookup
        rows = [
            {
                "molecule_id": "mol_1",
                "input_smiles": "CCO",
                "canonical_smiles": "CCO",
                "valid_molecule": True,
                "priority_score": 0.75,
                "bbb_model_status": "model_unavailable",
                "pubchem_lookup_status": "exact_match",
                "chembl_lookup_status": "not_requested",
                "patent_lookup_status": "not_requested",
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
    assert prioritize_options["enable_pubchem_lookup"] is True
    assert prioritize_options["enable_chembl_lookup"] is False
    assert prioritize_options["enable_patent_lookup"] is False
    run_manifest = json.loads(
        services.model_sources.RUN_MANIFEST_PATH.read_text(encoding="utf-8")
    )
    latest_run = run_manifest["runs"][job_response.json()["job_id"]]
    assert latest_run["public_lookup_requested"] is True
    assert latest_run["pubchem_lookup_status_values"] == ["exact_match"]


def test_prioritization_job_passes_independent_chembl_flag(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(services, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(services, "UPLOAD_DIR", tmp_path / "backend" / "uploads")
    monkeypatch.setattr(services, "JOB_OUTPUT_DIR", tmp_path / "backend" / "job_outputs")
    monkeypatch.setattr(services, "JOB_METADATA_DIR", tmp_path / "backend" / "job_metadata")
    configure_temp_app_data(tmp_path, monkeypatch)
    prioritize_options = {}

    def fake_prioritize_csv(
        input_path,
        output_path,
        *,
        enable_public_lookup=False,
        enable_pubchem_lookup=None,
        enable_chembl_lookup=False,
        enable_patent_lookup=False,
    ):
        prioritize_options["enable_public_lookup"] = enable_public_lookup
        prioritize_options["enable_pubchem_lookup"] = enable_pubchem_lookup
        prioritize_options["enable_chembl_lookup"] = enable_chembl_lookup
        prioritize_options["enable_patent_lookup"] = enable_patent_lookup
        rows = [
            {
                "molecule_id": "mol_1",
                "input_smiles": "CCO",
                "canonical_smiles": "CCO",
                "valid_molecule": True,
                "priority_score": 0.75,
                "bbb_model_status": "model_unavailable",
                "pubchem_lookup_status": "not_requested",
                "chembl_lookup_status": "exact_match",
                "patent_lookup_status": "not_requested",
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
            "enable_chembl_lookup": True,
        },
    )

    assert job_response.status_code == 200
    assert prioritize_options["enable_public_lookup"] is False
    assert prioritize_options["enable_pubchem_lookup"] is False
    assert prioritize_options["enable_chembl_lookup"] is True
    assert prioritize_options["enable_patent_lookup"] is False
    run_manifest = json.loads(
        services.model_sources.RUN_MANIFEST_PATH.read_text(encoding="utf-8")
    )
    latest_run = run_manifest["runs"][job_response.json()["job_id"]]
    assert latest_run["public_lookup_requested"] is True
    assert latest_run["pubchem_lookup_status_values"] == ["not_requested"]
    assert latest_run["chembl_lookup_status_values"] == ["exact_match"]


def test_prioritization_job_passes_independent_patent_flag(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(services, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(services, "UPLOAD_DIR", tmp_path / "backend" / "uploads")
    monkeypatch.setattr(services, "JOB_OUTPUT_DIR", tmp_path / "backend" / "job_outputs")
    monkeypatch.setattr(services, "JOB_METADATA_DIR", tmp_path / "backend" / "job_metadata")
    configure_temp_app_data(tmp_path, monkeypatch)
    prioritize_options = {}

    def fake_prioritize_csv(
        input_path,
        output_path,
        *,
        enable_public_lookup=False,
        enable_pubchem_lookup=None,
        enable_chembl_lookup=False,
        enable_patent_lookup=False,
    ):
        prioritize_options["enable_public_lookup"] = enable_public_lookup
        prioritize_options["enable_pubchem_lookup"] = enable_pubchem_lookup
        prioritize_options["enable_chembl_lookup"] = enable_chembl_lookup
        prioritize_options["enable_patent_lookup"] = enable_patent_lookup
        rows = [
            {
                "molecule_id": "mol_1",
                "input_smiles": "CCO",
                "canonical_smiles": "CCO",
                "valid_molecule": True,
                "priority_score": 0.75,
                "bbb_model_status": "model_unavailable",
                "pubchem_lookup_status": "not_requested",
                "chembl_lookup_status": "not_requested",
                "patent_lookup_status": "match_found",
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
            "enable_patent_lookup": True,
        },
    )

    assert job_response.status_code == 200
    assert prioritize_options["enable_public_lookup"] is False
    assert prioritize_options["enable_pubchem_lookup"] is False
    assert prioritize_options["enable_chembl_lookup"] is False
    assert prioritize_options["enable_patent_lookup"] is True
    run_manifest = json.loads(
        services.model_sources.RUN_MANIFEST_PATH.read_text(encoding="utf-8")
    )
    latest_run = run_manifest["runs"][job_response.json()["job_id"]]
    assert latest_run["public_lookup_requested"] is True
    assert latest_run["patent_lookup_status_values"] == ["match_found"]


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

    def failing_prioritize_csv(
        input_path,
        output_path,
        *,
        enable_public_lookup=False,
        enable_pubchem_lookup=None,
        enable_chembl_lookup=False,
        enable_patent_lookup=False,
    ):
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
