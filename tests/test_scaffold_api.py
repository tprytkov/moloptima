import json

import pytest
from fastapi.testclient import TestClient

from backend import services
from backend.main import app


def record(molecule_id, smiles=None, *, valid=True, duplicate=False):
    return {
        "molecule_id": molecule_id,
        "original_molecule_id": molecule_id,
        "canonical_smiles": smiles if valid else None,
        "validation_status": "valid" if valid else "invalid",
        "duplicate_structure": duplicate,
    }


@pytest.fixture
def scaffold_client(tmp_path, monkeypatch):
    monkeypatch.setattr(services, "UPLOAD_DIR", tmp_path / "uploads")
    services._chemical_space_scaffolds_cached.cache_clear()
    return TestClient(app)


def write_collection(records):
    upload_id = f"{write_collection.counter:032x}"
    write_collection.counter += 1
    folder = services.UPLOAD_DIR / upload_id
    folder.mkdir(parents=True)
    (folder / "molecule_collection.json").write_text(json.dumps({"records": records}), encoding="utf-8")
    return upload_id


write_collection.counter = 1


@pytest.mark.parametrize(("records", "expected"), [
    ([], {"molecule_count": 0, "scaffold_count": 0, "acyclic_count": 0, "excluded_count": 0}),
    ([record("benzene", "c1ccccc1")], {"molecule_count": 1, "scaffold_count": 1, "acyclic_count": 0, "excluded_count": 0}),
    ([record("ethanol", "CCO")], {"molecule_count": 1, "scaffold_count": 0, "acyclic_count": 1, "excluded_count": 0}),
    ([record("ring", "c1ccccc1"), record("chain", "CCO"), record("bad", valid=False)], {"molecule_count": 2, "scaffold_count": 1, "acyclic_count": 1, "excluded_count": 1}),
])
def test_scaffold_api_summary_edge_cases(scaffold_client, records, expected):
    response = scaffold_client.post("/api/chemical-space/scaffolds", json={"upload_id": write_collection(records)})
    assert response.status_code == 200
    assert {key: response.json()["summary"][key] for key in expected} == expected


def test_scaffold_api_is_deterministic_preserves_duplicates_and_uses_cache(scaffold_client):
    upload_id = write_collection([
        record("phenol-a", "Oc1ccccc1"), record("phenol-b", "Oc1ccccc1", duplicate=True),
        record("aniline", "Nc1ccccc1"),
    ])
    first = scaffold_client.post("/api/chemical-space/scaffolds", json={"upload_id": upload_id})
    second = scaffold_client.post("/api/chemical-space/scaffolds", json={"upload_id": upload_id})
    assert first.status_code == 200
    assert first.json() == second.json()
    group = first.json()["scaffolds"][0]
    assert group["member_count"] == 3
    assert group["unique_structure_count"] == 2
    assert [member["molecule_id"] for member in group["members"]] == ["phenol-a", "phenol-b", "aniline"]
    cache = services._chemical_space_scaffolds_cached.cache_info()
    assert cache.hits >= 1
