import csv
import json
import threading
import time
from pathlib import Path

from fastapi.testclient import TestClient

from backend import services
from backend.main import app
from backend.schemas import ADMET_ENDPOINT_NAMES, ResultResponse
from molecular_prioritization import runtime_qualification
from molecular_prioritization.admet_multitask_predictor import (
    FROZEN_ENDPOINT_DEFINITIONS,
    unavailable_admet_prediction,
)
from molecular_prioritization.vina_docking import DockingCancelled


TERMINAL_STATUSES = {"completed", "completed_with_warnings", "failed", "cancelled"}


def wait_for_job(client: TestClient, job_id: str, timeout: float = 5.0) -> dict[str, object]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        response = client.get(f"/api/jobs/{job_id}")
        assert response.status_code == 200
        payload = response.json()
        if payload["status"] in TERMINAL_STATUSES:
            return payload
        time.sleep(0.01)
    raise AssertionError(f"Timed out waiting for job {job_id}")


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


def test_chemical_space_endpoints_use_existing_import_collection(tmp_path, monkeypatch):
    configure_temp_job_storage(tmp_path, monkeypatch)
    upload_id = "a" * 32
    upload_dir = services.UPLOAD_DIR / upload_id
    upload_dir.mkdir(parents=True)
    (upload_dir / "molecule_collection.json").write_text(json.dumps({"records": [
        {"molecule_id": "ethanol", "canonical_smiles": "CCO", "validation_status": "valid", "source_record": "row:1"},
        {"molecule_id": "propanol", "canonical_smiles": "CCCO", "validation_status": "valid", "source_record": "row:2"},
        {"molecule_id": "bad", "canonical_smiles": None, "validation_status": "invalid", "source_record": "row:3"},
    ]}), encoding="utf-8")
    client = TestClient(app)

    projection = client.post("/api/chemical-space/project", json={"upload_id": upload_id})
    neighbors = client.post("/api/chemical-space/neighbors", json={
        "upload_id": upload_id, "query_molecule_id": "ethanol", "top_k": 5,
    })
    scaffolds = client.post("/api/chemical-space/scaffolds", json={"upload_id": upload_id})

    assert projection.status_code == 200
    assert projection.json()["projected_count"] == 2
    assert projection.json()["excluded_count"] == 1
    assert neighbors.status_code == 200
    assert neighbors.json()["neighbors"][0]["molecule_id"] == "propanol"
    assert neighbors.json()["metadata"]["similarity_metric"] == "Tanimoto"
    assert scaffolds.status_code == 200
    assert scaffolds.json()["summary"]["molecule_count"] == 2
    assert scaffolds.json()["summary"]["scaffold_count"] == 0
    assert scaffolds.json()["summary"]["acyclic_count"] == 2


def test_chemical_space_endpoint_rejects_unknown_collection():
    response = TestClient(app).post("/api/chemical-space/project", json={"upload_id": "f" * 32})
    assert response.status_code == 404


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
                    "docking_score": -8.5,
                    "docking_score_normalized": 0.9,
                    "docking_priority_signal": "strong_docking_signal",
                    "docking_rank_within_run": 1,
                    "docking_percentile_within_run": 100.0,
                    "combined_candidate_score": 0.84,
                    "combined_score_explanation": "Protocol-dependent docking signal.",
                    "combined_score_status": "calculated",
                    "structural_alert_status": "alerts_detected",
                    "structural_alert_count": 1,
                    "structural_alert_categories": "PAINS",
                    "structural_alert_names": "fake_alert",
                    "pains_alert": True,
                    "brenk_alert": False,
                    "medchem_alert_summary": "Screening signal only.",
                    "diversity_cluster_id": 1,
                    "diversity_cluster_size": 2,
                    "diversity_representative": True,
                    "nearest_neighbor_molecule_id": "mol_2",
                    "nearest_neighbor_similarity": 0.91,
                    "diversity_status": "clustered",
                    "chemical_space_x": 1.25,
                    "chemical_space_y": -0.5,
                    "chemical_space_status": "projected",
                    "chemical_space_method": "morgan_fingerprint_pca",
                    "target_reference_status": "references_found",
                    "target_reference_source": "local_curated",
                    "target_reference_count": 3,
                    "nearest_active_reference_id": "REF1",
                    "nearest_active_compound_name": "Active Ref",
                    "nearest_active_similarity": 0.87,
                    "nearest_active_activity_class": "active",
                    "nearest_active_mechanism_class": "PAM",
                    "active_neighborhood_signal": "near_known_active_space",
                    "active_neighborhood_summary": "Nearest target reference is Active Ref.",
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
    assert ">  <combined_candidate_score>" in sdf_text
    assert ">  <docking_priority_signal>" in sdf_text
    assert "Protocol-dependent docking signal." in sdf_text
    assert ">  <diversity_cluster_id>" in sdf_text
    assert ">  <nearest_neighbor_similarity>" in sdf_text
    assert ">  <chemical_space_x>" in sdf_text
    assert ">  <chemical_space_method>" in sdf_text
    assert ">  <nearest_active_compound_name>" in sdf_text
    assert ">  <active_neighborhood_signal>" in sdf_text
    assert "near_known_active_space" in sdf_text
    assert ">  <structural_alert_status>" in sdf_text
    assert ">  <pains_alert>" in sdf_text
    assert "Screening signal only." in sdf_text
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
    assert job_payload["status"] == "queued"
    assert job_payload["stage"] == "queued"
    assert job_payload["submitted_count"] == 1
    assert job_payload["row_count"] == 0
    assert job_payload["input_file"].endswith("molecules.csv")
    assert job_payload["output_file"].endswith("ranked_results.csv")
    assert job_payload["created_at"]
    assert job_payload["completed_at"] is None
    assert job_payload["error_message"] == ""
    terminal_job = wait_for_job(client, job_payload["job_id"])
    assert terminal_job["status"] == "completed_with_warnings"
    assert terminal_job["row_count"] == 1
    assert terminal_job["processed_count"] == 1
    assert terminal_job["valid_count"] == 1
    assert terminal_job["invalid_count"] == 0
    assert prioritize_options["enable_public_lookup"] is False
    assert prioritize_options["enable_pubchem_lookup"] is False
    assert prioritize_options["enable_chembl_lookup"] is False
    assert prioritize_options["enable_patent_lookup"] is False

    metadata_path = services.JOB_METADATA_DIR / f"{job_payload['job_id']}.json"
    assert metadata_path.exists()
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    assert metadata["status"] == "completed_with_warnings"

    result_response = client.get(f"/api/results/{job_payload['job_id']}")

    assert result_response.status_code == 200
    result_payload = result_response.json()
    assert result_payload["job_id"] == job_payload["job_id"]
    assert result_payload["status"] == "completed_with_warnings"
    assert result_payload["results"][0]["molecule_id"] == "mol_1"

    run_manifest = json.loads(
        services.model_sources.RUN_MANIFEST_PATH.read_text(encoding="utf-8")
    )
    latest_run = run_manifest["runs"][job_payload["job_id"]]
    assert latest_run["actual_bbb_model_status"] == "model_unavailable"
    assert latest_run["fallback_placeholder_used"] is True
    assert latest_run["bbb_model_status_values"] == ["model_unavailable"]
    assert latest_run["public_lookup_requested"] is False


def test_result_api_preserves_all_ten_admet_endpoints(tmp_path: Path, monkeypatch):
    configure_temp_job_storage(tmp_path, monkeypatch)
    job_id = "admet-job"
    output_path = services.JOB_OUTPUT_DIR / job_id / "ranked_results.csv"
    output_path.parent.mkdir(parents=True)
    endpoint_payload = unavailable_admet_prediction(
        "CCO", prediction_status="available", warning=""
    )["endpoints"]
    for index, endpoint in enumerate(endpoint_payload.values()):
        endpoint.update(
            {
                "raw_logit": float(index),
                "raw_probability": 0.1 + index / 100,
                "calibrated_probability": 0.2 + index / 100,
                "binary_prediction": int(index % 2 == 0),
            }
        )
    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "molecule_id",
                "canonical_smiles",
                "priority_score",
                "admet_model_status",
                "admet_warning",
                "admet_predictions",
            ],
        )
        writer.writeheader()
        writer.writerow(
            {
                "molecule_id": "ethanol",
                "canonical_smiles": "CCO",
                "priority_score": 0.629,
                "admet_model_status": "model_available",
                "admet_warning": "",
                "admet_predictions": json.dumps(endpoint_payload),
            }
        )
    write_completed_job(job_id)

    response = TestClient(app).get(f"/api/results/{job_id}")

    assert response.status_code == 200
    row = response.json()["results"][0]
    assert row["admet_model_status"] == "model_available"
    assert row["admet_warning"] == ""
    assert set(row["admet_predictions"]) == ADMET_ENDPOINT_NAMES
    assert row["admet_predictions"] == {
        name: value for name, value in endpoint_payload.items() if name != "bbb_martins"
    }


def test_result_schema_preserves_unavailable_and_invalid_admet_results():
    for status in ("model_unavailable", "not_run_invalid_molecule"):
        endpoints = unavailable_admet_prediction(
            None, prediction_status=status, warning=f"{status} warning"
        )["endpoints"]
        endpoints.pop("bbb_martins")
        response = ResultResponse(
            job_id="job",
            status="completed",
            input_file="input.csv",
            output_file="output.csv",
            created_at="2026-01-01T00:00:00+00:00",
            row_count=1,
            results=[
                {
                    "admet_model_status": status,
                    "admet_warning": f"{status} warning",
                    "admet_predictions": endpoints,
                }
            ],
        )

        serialized = response.model_dump()["results"][0]
        assert serialized["admet_model_status"] == status
        assert set(serialized["admet_predictions"]) == ADMET_ENDPOINT_NAMES
        assert all(
            endpoint["calibrated_probability"] is None
            for endpoint in serialized["admet_predictions"].values()
        )


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
    assert [job["job_id"] for job in jobs] == [failed_job_id, latest_job_id, older_job_id]
    assert jobs[0]["status"] == "failed"
    assert jobs[1]["row_count"] == 1
    assert jobs[1]["pubchem_lookup_requested"] is True
    assert jobs[1]["chembl_lookup_requested"] is True
    assert jobs[1]["patent_lookup_requested"] is False
    assert jobs[2]["public_lookup_requested"] is False
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


def test_scientific_runtime_status_endpoint_uses_runtime_qualification_status(monkeypatch):
    expected = {
        "checked_at": "2026-08-27T22:00:00+00:00",
        "status_source": "production_runtime_contract_probes",
        "inference_performed": False,
        "qualification_state": "complete",
        "refreshing": False,
        "generation": 0,
        "probe_timings_seconds": {},
        "components": {
            "chemberta": {"status": "available", "public_endpoint_count": 9},
            "gmc_mpnn_bbb": {"status": "available", "ensemble_seed_count": 5},
            "chemprop_regression": {"status": "available", "endpoint_count": 5},
            "receptor_preparation": {"status": "available"},
            "docking": {"status": "available"},
        },
    }
    monkeypatch.setattr(
        services.runtime_qualification, "scientific_runtime_status", lambda **_kwargs: expected
    )

    response = TestClient(app).get("/api/scientific-runtime/status")
    refresh_response = TestClient(app).post("/api/scientific-runtime/refresh")

    assert response.status_code == 200
    assert response.json() == expected
    assert refresh_response.status_code == 200
    assert refresh_response.json() == expected


def test_scientific_runtime_get_is_prompt_and_coalesces_running_probe(tmp_path, monkeypatch):
    release = threading.Event()
    calls = {name: 0 for name in (
        "chemberta", "gmc_mpnn_bbb", "chemprop_regression",
        "receptor_preparation", "docking",
    )}

    def make_check(name):
        def check():
            calls[name] += 1
            if name == "gmc_mpnn_bbb":
                release.wait(1)
            return {"status": "available", "runtime_source": "test"}
        return check

    monkeypatch.setattr(services, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(
        runtime_qualification,
        "_runtime_status_checks",
        lambda _root: {name: make_check(name) for name in calls},
    )
    client = TestClient(app)

    started = time.perf_counter()
    first = client.get("/api/scientific-runtime/status")
    second = client.get("/api/scientific-runtime/status")
    elapsed = time.perf_counter() - started

    assert first.status_code == second.status_code == 200
    assert elapsed < 0.5
    assert first.json()["qualification_state"] == "checking"
    assert second.json()["generation"] == first.json()["generation"]
    assert calls["gmc_mpnn_bbb"] == 1
    release.set()


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
    wait_for_job(client, job_response.json()["job_id"])
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


def test_job_execution_persists_portable_admet_runtime_identities_from_progress(tmp_path, monkeypatch):
    current = {
        "job_id": "job-runtime-provenance", "status": "queued",
        "output_file": "backend/job_outputs/job-runtime-provenance/results.csv",
    }
    updates = []
    monkeypatch.setattr(services, "read_job_metadata", lambda _job_id: dict(current))
    monkeypatch.setattr(services, "update_job_metadata", lambda _job_id, **values: updates.append(values))
    monkeypatch.setattr(services.model_sources, "update_run_manifest", lambda **_kwargs: {})

    def fake_call(_input_path, _output_path, **options):
        options["progress_callback"](
            stage="admet",
            admet_runtime_identities=[{
                "family": "gmc_mpnn_bbb", "status": "success",
                "runtime_source": "packaged", "runner_sha256": "runner-sha",
                "private_path": r"C:\Users\private\runtime",
            }],
        )
        return [{
            "valid_molecule": True, "admet_model_status": "model_available",
            "docking_result": {"status": "not_requested"}, "rank_eligible": False,
        }]

    monkeypatch.setattr(services, "call_prioritize_csv", fake_call)
    services._execute_prioritization_job(
        "job-runtime-provenance", tmp_path / "input.csv", tmp_path / "output.csv",
    )

    persisted = next(item["admet_runtime_identities"] for item in updates if "admet_runtime_identities" in item)
    assert persisted == [{
        "family": "gmc_mpnn_bbb", "status": "success",
        "runtime_source": "packaged", "runner_sha256": "runner-sha",
    }]


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
    wait_for_job(client, job_response.json()["job_id"])
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
    wait_for_job(client, job_response.json()["job_id"])
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


def _molecule_csv_bytes(row_count: int) -> bytes:
    lines = ["molecule_id,smiles"]
    lines.extend(f"mol_{index},CCO" for index in range(1, row_count + 1))
    return ("\n".join(lines) + "\n").encode("utf-8")


def test_upload_accepts_exactly_1000_molecule_records(tmp_path: Path, monkeypatch):
    configure_temp_job_storage(tmp_path, monkeypatch)
    client = TestClient(app)

    response = client.post(
        "/api/molecules/upload",
        files={"file": ("molecules.csv", _molecule_csv_bytes(1000), "text/csv")},
    )

    assert response.status_code == 200
    assert response.json()["rows"] == 1000


def test_upload_rejects_1001_molecule_records_without_truncation(tmp_path: Path, monkeypatch):
    configure_temp_job_storage(tmp_path, monkeypatch)
    client = TestClient(app)

    response = client.post(
        "/api/molecules/upload",
        files={"file": ("molecules.csv", _molecule_csv_bytes(1001), "text/csv")},
    )

    assert response.status_code == 400
    assert "Maximum batch size is 1,000" in response.json()["detail"]
    assert "1,001 molecule records" in response.json()["detail"]
    assert not list(services.UPLOAD_DIR.glob("*/molecules.csv"))


def test_job_creation_returns_before_background_pipeline_finishes(tmp_path: Path, monkeypatch):
    configure_temp_job_storage(tmp_path, monkeypatch)
    configure_temp_app_data(tmp_path, monkeypatch)
    pipeline_started = threading.Event()
    release_pipeline = threading.Event()

    def blocking_prioritize_csv(input_path, output_path, **options):
        pipeline_started.set()
        assert release_pipeline.wait(timeout=5)
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        Path(output_path).write_text("molecule_id,valid_molecule\n", encoding="utf-8")
        return []

    monkeypatch.setattr(services, "prioritize_csv", blocking_prioritize_csv)
    client = TestClient(app)
    upload = client.post(
        "/api/molecules/upload",
        files={"file": ("molecules.csv", _molecule_csv_bytes(1), "text/csv")},
    ).json()

    response = client.post("/api/jobs/prioritization", json={"upload_id": upload["upload_id"]})

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "queued"
    assert payload["stage"] == "queued"
    assert payload["submitted_count"] == 1
    assert pipeline_started.wait(timeout=2)
    current = client.get(f"/api/jobs/{payload['job_id']}").json()
    assert current["status"] == "running"
    assert current["stage"] == "prioritization"
    cancellation = client.post(f"/api/jobs/{payload['job_id']}/cancel")
    assert cancellation.status_code == 200
    assert cancellation.json()["status"] == "running"
    assert cancellation.json()["cancellation_requested"] is True
    release_pipeline.set()
    terminal = wait_for_job(client, payload["job_id"])
    assert terminal["status"] == "completed"
    assert terminal["stage"] == "completed"
    assert terminal["cancellation_requested"] is True


def test_docking_stage_cancellation_marks_job_cancelled(tmp_path: Path, monkeypatch):
    configure_temp_job_storage(tmp_path, monkeypatch)
    configure_temp_app_data(tmp_path, monkeypatch)
    docking_started = threading.Event()

    def cancellable_prioritize_csv(
        input_path,
        output_path,
        *,
        progress_callback,
        cancellation_requested,
        **options,
    ):
        progress_callback(stage="docking", processed_count=0, docking_success_count=0, docking_failure_count=0)
        docking_started.set()
        deadline = time.monotonic() + 5
        while not cancellation_requested() and time.monotonic() < deadline:
            time.sleep(0.01)
        raise DockingCancelled("cancelled during docking")

    monkeypatch.setattr(services, "prioritize_csv", cancellable_prioritize_csv)
    client = TestClient(app)
    upload = client.post(
        "/api/molecules/upload",
        files={"file": ("molecules.csv", _molecule_csv_bytes(2), "text/csv")},
    ).json()
    job = client.post("/api/jobs/prioritization", json={
        "upload_id": upload["upload_id"], "enable_docking": True,
    }).json()
    assert docking_started.wait(timeout=2)
    cancellation = client.post(f"/api/jobs/{job['job_id']}/cancel")
    assert cancellation.status_code == 200
    terminal = wait_for_job(client, job["job_id"])
    assert terminal["status"] == "cancelled"
    assert terminal["stage"] == "completed"
    assert terminal["cancellation_requested"] is True


def test_job_history_includes_non_completed_statuses(tmp_path: Path, monkeypatch):
    configure_temp_job_storage(tmp_path, monkeypatch)
    for index, job_status in enumerate(("queued", "running", "failed", "cancelled"), start=1):
        services.write_job_metadata(
            {
                "job_id": f"job-{index}",
                "upload_id": "upload",
                "status": job_status,
                "stage": "queued" if job_status == "queued" else "prioritization",
                "input_file": "input.csv",
                "output_file": "output.csv",
                "created_at": f"2026-01-0{index}T00:00:00+00:00",
                "completed_at": None,
                "error_message": "",
                "row_count": 0,
            }
        )
    client = TestClient(app)

    response = client.get("/api/jobs/history")

    assert response.status_code == 200
    assert {job["status"] for job in response.json()["jobs"]} == {
        "queued",
        "running",
        "failed",
        "cancelled",
    }


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

    assert job_response.status_code == 200
    job_payload = job_response.json()
    assert job_payload["status"] == "queued"
    terminal_job = wait_for_job(client, job_payload["job_id"])
    assert terminal_job["status"] == "failed"
    assert terminal_job["error_message"] == "synthetic pipeline failure"

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
