import csv
import io
import json
import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from rdkit import Chem

from backend import services
from backend.main import app


def sdf_bytes(smiles: str, name: str) -> bytes:
    molecule = Chem.MolFromSmiles(smiles)
    molecule.SetProp("_Name", name)
    return (Chem.MolToMolBlock(molecule) + "\n$$$$\n").encode()


def csv_bytes(count: int, *, prefix: str = "mol") -> bytes:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(["molecule_id", "smiles"])
    for index in range(count):
        writer.writerow([f"{prefix}_{index:04d}", "CCO"])
    return buffer.getvalue().encode()


@pytest.fixture
def import_client(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(services, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(services, "UPLOAD_DIR", tmp_path / "backend" / "uploads")
    monkeypatch.setattr(services, "IMPORT_JOB_DIR", tmp_path / "backend" / "import_jobs")
    return TestClient(app)


def create_job(client: TestClient, expected: int, **extra) -> str:
    response = client.post(
        "/api/molecules/import-jobs",
        json={"expected_file_count": expected, **extra},
    )
    assert response.status_code == 200, response.text
    return response.json()["import_job_id"]


def append_batch(client: TestClient, job_id: str, batch_index: int, files):
    return client.post(
        f"/api/molecules/import-jobs/{job_id}/batches",
        data={"batch_index": str(batch_index)},
        files=[("files", item) for item in files],
    )


def test_create_import_job_returns_pending_state(import_client):
    response = import_client.post("/api/molecules/import-jobs", json={"expected_file_count": 3})
    assert response.status_code == 200
    assert response.json() == {
        "import_job_id": response.json()["import_job_id"],
        "status": "pending",
        "expected_file_count": 3,
        "processed_file_count": 0,
        "parsed_record_count": 0,
        "batch_count": 0,
    }


def test_create_import_job_keeps_pasted_smiles_request_bounded(import_client):
    response = import_client.post(
        "/api/molecules/import-jobs",
        json={"expected_file_count": 251, "smiles_text": "\n".join(["CCO"] * 1001)},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Maximum batch size is 1,000 submitted molecule records."


def test_append_one_batch_reports_file_and_record_progress(import_client):
    job_id = create_job(import_client, 1)
    response = append_batch(import_client, job_id, 1, [("one.sdf", sdf_bytes("CCO", "one"), "chemical/x-mdl-sdfile")])
    assert response.status_code == 200
    assert response.json()["processed_file_count"] == 1
    assert response.json()["parsed_record_count"] == 1


def test_append_multiple_batches_accumulates_progress(import_client):
    job_id = create_job(import_client, 2)
    assert append_batch(import_client, job_id, 1, [("one.sdf", sdf_bytes("CCO", "one"), "chemical/x-mdl-sdfile")]).status_code == 200
    response = append_batch(import_client, job_id, 2, [("two.sdf", sdf_bytes("CCN", "two"), "chemical/x-mdl-sdfile")])
    assert response.status_code == 200
    assert response.json()["processed_file_count"] == 2
    assert response.json()["batch_count"] == 2


def test_finalize_produces_exactly_one_upload_id(import_client):
    job_id = create_job(import_client, 1)
    append_batch(import_client, job_id, 1, [("one.sdf", sdf_bytes("CCO", "one"), "chemical/x-mdl-sdfile")])
    response = import_client.post(f"/api/molecules/import-jobs/{job_id}/finalize")
    assert response.status_code == 200
    assert len(response.json()["upload_id"]) == 32
    assert [path.name for path in services.UPLOAD_DIR.iterdir()] == [response.json()["upload_id"]]


def test_three_batches_preserve_global_input_order(import_client):
    job_id = create_job(import_client, 3)
    for index, smiles in enumerate(("CCO", "CCN", "CCC"), start=1):
        append_batch(import_client, job_id, index, [(f"file_{index}.sdf", sdf_bytes(smiles, f"file_{index}"), "chemical/x-mdl-sdfile")])
    payload = import_client.post(f"/api/molecules/import-jobs/{job_id}/finalize").json()
    manifest = json.loads((services.UPLOAD_DIR / payload["upload_id"] / "molecule_collection.json").read_text())
    assert [row["source_filename"] for row in manifest["records"]] == ["file_1.sdf", "file_2.sdf", "file_3.sdf"]
    assert [row["molecule_id"] for row in manifest["records"]] == ["file_1", "file_2", "file_3"]


def test_duplicates_across_batches_use_existing_global_semantics(import_client):
    job_id = create_job(import_client, 2)
    append_batch(import_client, job_id, 1, [("original.sdf", sdf_bytes("CCO", "original"), "chemical/x-mdl-sdfile")])
    append_batch(import_client, job_id, 2, [("copy.sdf", sdf_bytes("CCO", "copy"), "chemical/x-mdl-sdfile")])
    payload = import_client.post(f"/api/molecules/import-jobs/{job_id}/finalize").json()
    assert payload["duplicate_count"] == 1
    assert [row["duplicate_structure"] for row in payload["preview"]] == [False, True]


def test_source_provenance_survives_finalization(import_client):
    job_id = create_job(import_client, 1)
    append_batch(import_client, job_id, 1, [("source.sdf", sdf_bytes("CCO", "source"), "chemical/x-mdl-sdfile")])
    payload = import_client.post(f"/api/molecules/import-jobs/{job_id}/finalize").json()
    row = payload["preview"][0]
    assert (row["source_filename"], row["source_record"], row["source_type"]) == ("source.sdf", "record:1", "sdf")


def test_partial_job_is_not_visible_as_finalized_upload(import_client):
    job_id = create_job(import_client, 2)
    append_batch(import_client, job_id, 1, [("one.sdf", sdf_bytes("CCO", "one"), "chemical/x-mdl-sdfile")])
    assert not services.UPLOAD_DIR.exists() or not any(services.UPLOAD_DIR.iterdir())
    assert import_client.post(f"/api/molecules/import-jobs/{job_id}/finalize").status_code == 409


def test_cancel_removes_temporary_state(import_client):
    job_id = create_job(import_client, 1)
    append_batch(import_client, job_id, 1, [("one.sdf", sdf_bytes("CCO", "one"), "chemical/x-mdl-sdfile")])
    response = import_client.delete(f"/api/molecules/import-jobs/{job_id}")
    assert response.status_code == 204
    assert not (services.IMPORT_JOB_DIR / job_id).exists()


def test_cancel_cannot_race_finalized_upload_publication(import_client, monkeypatch):
    job_id = create_job(import_client, 1)
    append_batch(import_client, job_id, 1, [("one.sdf", sdf_bytes("CCO", "one"), "chemical/x-mdl-sdfile")])
    persistence_started = threading.Event()
    allow_persistence = threading.Event()
    cancel_started = threading.Event()
    original_persist = services._persist_molecule_collection

    def delayed_persist(**kwargs):
        persistence_started.set()
        assert allow_persistence.wait(timeout=5)
        return original_persist(**kwargs)

    monkeypatch.setattr(services, "_persist_molecule_collection", delayed_persist)
    outcomes = {}

    def finalize():
        try:
            outcomes["finalize"] = services.finalize_molecule_import_job(job_id)
        except Exception as exc:  # pragma: no cover - asserted through outcomes
            outcomes["finalize_error"] = exc

    def cancel():
        cancel_started.set()
        try:
            services.cancel_molecule_import_job(job_id)
        except Exception as exc:
            outcomes["cancel_error"] = exc

    finalize_thread = threading.Thread(target=finalize)
    cancel_thread = threading.Thread(target=cancel)
    finalize_thread.start()
    assert persistence_started.wait(timeout=5)
    cancel_thread.start()
    assert cancel_started.wait(timeout=5)
    assert cancel_thread.is_alive()

    allow_persistence.set()
    finalize_thread.join(timeout=5)
    cancel_thread.join(timeout=5)

    assert not finalize_thread.is_alive()
    assert not cancel_thread.is_alive()
    assert "finalize_error" not in outcomes
    upload_id = outcomes["finalize"]["upload_id"]
    assert (services.UPLOAD_DIR / upload_id / "canonical_molecules.csv").is_file()
    assert outcomes["cancel_error"].status_code == 404
    assert not (services.IMPORT_JOB_DIR / job_id).exists()


def test_failed_batch_does_not_create_partial_upload_or_advance_job(import_client):
    job_id = create_job(import_client, 1)
    response = append_batch(import_client, job_id, 1, [("too-many.csv", csv_bytes(1001), "text/csv")])
    assert response.status_code == 400
    assert not services.UPLOAD_DIR.exists()
    metadata = json.loads((services.IMPORT_JOB_DIR / job_id / "job.json").read_text())
    assert metadata["processed_file_count"] == 0


def test_more_than_1000_total_records_finalize_successfully(import_client):
    job_id = create_job(import_client, 2)
    assert append_batch(import_client, job_id, 1, [("left.csv", csv_bytes(600, prefix="left"), "text/csv")]).status_code == 200
    assert append_batch(import_client, job_id, 2, [("right.csv", csv_bytes(600, prefix="right"), "text/csv")]).status_code == 200
    response = import_client.post(f"/api/molecules/import-jobs/{job_id}/finalize")
    assert response.status_code == 200
    assert response.json()["submitted_count"] == 1200


def test_individual_batch_file_count_remains_bounded(import_client):
    job_id = create_job(import_client, 251)
    files = [(f"{index}.sdf", sdf_bytes("CCO", str(index)), "chemical/x-mdl-sdfile") for index in range(251)]
    response = append_batch(import_client, job_id, 1, files)
    assert response.status_code == 400
    assert response.json()["detail"] == "Maximum import batch size is 250 files."


def test_normal_import_endpoint_remains_compatible(import_client):
    response = import_client.post(
        "/api/molecules/import",
        data={"smiles_text": "typed CCO"},
        files=[("files", ("one.sdf", sdf_bytes("CCN", "one"), "chemical/x-mdl-sdfile"))],
    )
    assert response.status_code == 200
    assert response.json()["submitted_count"] == 2


def test_multi_record_sdf_preserves_existing_invalid_record_behavior(import_client):
    multi = sdf_bytes("CCO", "one") + sdf_bytes("CCN", "two")
    job_id = create_job(import_client, 1)
    response = append_batch(import_client, job_id, 1, [("multi.sdf", multi, "chemical/x-mdl-sdfile")])
    assert response.status_code == 200
    payload = import_client.post(f"/api/molecules/import-jobs/{job_id}/finalize").json()
    assert payload["submitted_count"] == 1
    assert payload["multi_record_sdf_count"] == 1
    assert payload["valid_count"] == 0


def test_pasted_smiles_is_processed_once_across_batches(import_client):
    job_id = create_job(import_client, 2, smiles_text="typed CCN")
    append_batch(import_client, job_id, 1, [("one.sdf", sdf_bytes("CCO", "one"), "chemical/x-mdl-sdfile")])
    append_batch(import_client, job_id, 2, [("two.sdf", sdf_bytes("CCC", "two"), "chemical/x-mdl-sdfile")])
    payload = import_client.post(f"/api/molecules/import-jobs/{job_id}/finalize").json()
    assert payload["submitted_count"] == 3
    assert sum(row["source_type"] == "smiles" for row in payload["preview"]) == 1
