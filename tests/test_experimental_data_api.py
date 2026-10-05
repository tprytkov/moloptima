import csv
import io
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import services
from backend.main import app


@pytest.fixture
def experimental_client(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(services, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(services, "UPLOAD_DIR", tmp_path / "backend" / "uploads")
    monkeypatch.setattr(services, "EXPERIMENTAL_PREVIEW_DIR", tmp_path / "backend" / "experimental_previews")
    monkeypatch.setattr(services, "EXPERIMENTAL_DATASET_DIR", tmp_path / "backend" / "experimental_datasets")
    return TestClient(app)


def create_upload(client: TestClient) -> str:
    response = client.post(
        "/api/molecules/import",
        data={"smiles_text": "cmpd_a CCO\ncmpd_b CCN\ncmpd_c CCO"},
    )
    assert response.status_code == 200, response.text
    return response.json()["upload_id"]


def csv_payload(rows=None):
    fields = [
        "molecule_id", "smiles", "endpoint", "value", "unit", "relation", "target",
        "organism", "assay_id", "assay_type", "assay_system", "biological_mode",
        "source", "source_record_id", "uncertainty_type", "uncertainty_value",
    ]
    rows = rows or [
        {
            "molecule_id": "cmpd_a", "endpoint": "IC50", "value": "10", "unit": "nM", "relation": "=",
            "target": "Synthetic target", "organism": "Homo sapiens", "assay_id": "A1",
            "assay_type": "binding", "assay_system": "biochemical", "biological_mode": "inhibition",
            "source": "public-safe-demo", "source_record_id": "1", "uncertainty_type": "SD",
            "uncertainty_value": "0.2",
        },
        {
            "molecule_id": "cmpd_b", "endpoint": "IC50", "value": "10", "unit": "uM", "relation": ">",
            "target": "Synthetic target", "organism": "Homo sapiens", "assay_id": "A1",
            "assay_type": "binding", "assay_system": "biochemical", "biological_mode": "inhibition",
            "source": "public-safe-demo", "source_record_id": "2",
        },
    ]
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue().encode()


def preview(client: TestClient, upload_id: str, payload=None):
    return client.post(
        "/api/experimental-data/previews",
        data={"upload_id": upload_id, "column_mapping": "{}"},
        files={"file": ("assays.csv", payload or csv_payload(), "text/csv")},
    )


def test_preview_finalize_retrieve_filter_and_export(experimental_client):
    upload_id = create_upload(experimental_client)
    original_manifest = (services.UPLOAD_DIR / upload_id / "molecule_collection.json").read_bytes()
    response = preview(experimental_client, upload_id)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "preview"
    assert payload["summary"]["valid_measurements"] == 2
    assert payload["summary"]["censored_values"] == 1
    assert payload["measurements"][1]["normalization"]["transformed_relation"] == "<"

    finalized = experimental_client.post(
        f"/api/experimental-data/previews/{payload['preview_id']}/finalize"
    )
    assert finalized.status_code == 200, finalized.text
    dataset = finalized.json()
    dataset_id = dataset["experimental_dataset_id"]
    assert dataset["status"] == "finalized"
    assert dataset["record_counts"] == {"source_rows": 2, "measurements": 2, "excluded": 0}
    assert (services.UPLOAD_DIR / upload_id / "molecule_collection.json").read_bytes() == original_manifest

    retrieved = experimental_client.get(f"/api/experimental-data/{dataset_id}")
    assert retrieved.status_code == 200
    listed = experimental_client.get(
        f"/api/experimental-data/{dataset_id}/measurements", params={"query": "cmpd_b"}
    ).json()
    assert listed["filtered_count"] == 1
    assert listed["measurements"][0]["molecule_id"] == "cmpd_b"
    exported = experimental_client.get(f"/api/experimental-data/{dataset_id}/export.csv")
    assert exported.status_code == 200
    assert "original_value,original_unit" in exported.text
    assert "transformed_relation" in exported.text
    assert "public-safe-demo" in exported.text


def test_mixed_valid_invalid_preview_preserves_excluded_records(experimental_client):
    upload_id = create_upload(experimental_client)
    rows = [
        {
            "molecule_id": "cmpd_a", "endpoint": "IC50", "value": "10", "unit": "nM", "relation": "=",
            "target": "T", "organism": "human", "assay_id": "A", "assay_type": "binding",
            "assay_system": "biochemical", "biological_mode": "inhibition", "source": "demo", "source_record_id": "1",
        },
        {
            "molecule_id": "missing", "endpoint": "IC50", "value": "0", "unit": "mg/mL", "relation": "~",
            "target": "T", "organism": "human", "assay_id": "A", "assay_type": "binding",
            "assay_system": "biochemical", "biological_mode": "inhibition", "source": "demo", "source_record_id": "2",
        },
    ]
    response = preview(experimental_client, upload_id, csv_payload(rows))
    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"]["valid_measurements"] == 1
    assert payload["summary"]["invalid_measurements"] == 1
    finalized = experimental_client.post(
        f"/api/experimental-data/previews/{payload['preview_id']}/finalize"
    ).json()
    manifest = json.loads(
        (services.EXPERIMENTAL_DATASET_DIR / finalized["experimental_dataset_id"] / "manifest.json").read_text()
    )
    assert len(manifest["measurements"]) == 1
    assert len(manifest["excluded_records"]) == 1


def test_ambiguous_structure_link_is_not_silently_resolved(experimental_client):
    upload_id = create_upload(experimental_client)
    row = {
        "smiles": "CCO", "endpoint": "IC50", "value": "10", "unit": "nM", "relation": "=",
        "target": "T", "organism": "human", "assay_id": "A", "assay_type": "binding",
        "assay_system": "biochemical", "biological_mode": "inhibition", "source": "demo", "source_record_id": "1",
    }
    response = preview(experimental_client, upload_id, csv_payload([row]))
    record = response.json()["measurements"][0]
    assert record["linkage"]["status"] == "ambiguous"
    assert record["validation_status"] == "invalid"
    assert experimental_client.post(
        f"/api/experimental-data/previews/{response.json()['preview_id']}/finalize"
    ).status_code == 409


def test_dataset_and_measurement_ids_are_deterministic(experimental_client):
    upload_id = create_upload(experimental_client)
    first = preview(experimental_client, upload_id).json()
    second = preview(experimental_client, upload_id).json()
    assert first["experimental_dataset_id"] == second["experimental_dataset_id"]
    assert first["measurements"][0]["measurement_id"] == second["measurements"][0]["measurement_id"]


def test_failed_finalization_does_not_publish_partial_dataset(experimental_client, monkeypatch):
    upload_id = create_upload(experimental_client)
    payload = preview(experimental_client, upload_id).json()

    def fail_write(*_args, **_kwargs):
        raise OSError("synthetic failure")

    monkeypatch.setattr(services, "_write_experimental_csv", fail_write)
    with pytest.raises(OSError):
        services.finalize_experimental_preview(payload["preview_id"])
    assert not (services.EXPERIMENTAL_DATASET_DIR / payload["experimental_dataset_id"]).exists()
