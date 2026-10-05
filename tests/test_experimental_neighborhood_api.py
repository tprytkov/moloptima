import csv
import io
import json

import pytest
from fastapi.testclient import TestClient

from backend import services
from backend.main import app
from biopharma_intelligence.known_analogs import KnownSourceError


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(services, "UPLOAD_DIR", tmp_path / "uploads")
    return TestClient(app)


def write_collection():
    upload_id = "a" * 32
    folder = services.UPLOAD_DIR / upload_id
    folder.mkdir(parents=True)
    records = [{
        "molecule_id": "generated-1", "original_molecule_id": "Generated 1",
        "canonical_smiles": "Cc1ccccc1", "validation_status": "valid",
    }]
    (folder / "molecule_collection.json").write_text(json.dumps({"records": records}), encoding="utf-8")
    return upload_id


def search_payload():
    return {
        "contract_version": "moloptima-experimental-neighborhood-v1",
        "query_molecule": {"molecule_id": "generated-1", "canonical_smiles": "Cc1ccccc1"},
        "source": "ChEMBL", "exact_match": False, "exact_matches": [], "analogs": [],
        "search_provenance": {"source": "ChEMBL"}, "scientific_note": "Reference compounds only.",
    }


def records_payload():
    return {
        "contract_version": "moloptima-experimental-neighborhood-v1",
        "compound": {"source_compound_id": "CHEMBL2", "canonical_smiles": "CCO"},
        "records": [{
            "canonical_smiles": "CCO", "endpoint_name": "IC50", "original_value": "10",
            "original_unit": "nM", "relation": ">", "target": {"identifier": "T1", "name": "Target"},
            "assay_id": "A1", "assay_type": "B", "assay_system": "single protein", "readout": "binding",
            "source": "ChEMBL", "source_record_id": "ACT1", "publication_reference": "DOC1",
        }],
        "targets": ["Target"], "endpoints": ["IC50"], "returned_count": 1,
        "source_total_count": 1, "truncated": False, "normalization_summary": {},
        "provenance": {"source": "ChEMBL"}, "scientific_note": "Reference compounds only.",
    }


def test_search_api_uses_selected_collection_identity(client, monkeypatch):
    upload_id = write_collection()
    captured = {}
    def fake_search(query, **kwargs):
        captured.update(query)
        return search_payload()
    monkeypatch.setattr(services, "search_known_analogs", fake_search)
    response = client.post("/api/experimental-neighborhood/search", json={
        "upload_id": upload_id, "molecule_id": "generated-1", "source": "chembl", "max_analogs": 25,
    })
    assert response.status_code == 200
    assert captured["canonical_smiles"] == "Cc1ccccc1"
    assert captured["display_name"] == "Generated 1"
    assert response.json()["exact_match"] is False


def test_search_requires_valid_collection_member(client, monkeypatch):
    upload_id = write_collection()
    response = client.post("/api/experimental-neighborhood/search", json={
        "upload_id": upload_id, "molecule_id": "missing", "source": "chembl", "max_analogs": 10,
    })
    assert response.status_code == 404


def test_network_failure_code_is_preserved(client, monkeypatch):
    upload_id = write_collection()
    monkeypatch.setattr(services, "search_known_analogs", lambda *args, **kwargs: (_ for _ in ()).throw(KnownSourceError("rate_limited", "Retry later.")))
    response = client.post("/api/experimental-neighborhood/search", json={
        "upload_id": upload_id, "molecule_id": "generated-1", "source": "chembl", "max_analogs": 10,
    })
    assert response.status_code == 503
    assert response.json()["detail"] == {"code": "rate_limited", "message": "Retry later."}


def test_records_api_and_explicit_csv_preparation(client, monkeypatch):
    monkeypatch.setattr(services, "retrieve_experimental_records", lambda *args, **kwargs: records_payload())
    response = client.post("/api/experimental-neighborhood/records", json={
        "source": "chembl", "source_compound_id": "CHEMBL2", "limit": 500,
    })
    assert response.status_code == 200
    assert response.json()["records"][0]["relation"] == ">"
    export = client.get("/api/experimental-neighborhood/records/export.csv", params={
        "source": "chembl", "source_compound_id": "CHEMBL2",
    })
    assert export.status_code == 200
    rows = list(csv.DictReader(io.StringIO(export.text)))
    assert rows[0]["smiles"] == "CCO"
    assert rows[0]["relation"] == ">"
    assert rows[0]["source_record_id"] == "ACT1"


def test_request_contract_bounds_public_queries(client):
    response = client.post("/api/experimental-neighborhood/records", json={
        "source": "chembl", "source_compound_id": "CHEMBL2", "limit": 9999,
    })
    assert response.status_code == 422
