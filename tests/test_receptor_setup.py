from __future__ import annotations

import hashlib

from fastapi.testclient import TestClient

from backend import receptor_store
from backend.main import app


PDB_TEXT = """\
ATOM      1  N   ALA A   1      11.000  12.000  13.000  1.00 20.00           N  
HETATM    2  C1  LIG A 101       1.000   2.000   3.000  1.00 20.00           C  
HETATM    3  O1  LIG A 101       3.000   4.000   5.000  1.00 20.00           O  
HETATM    4  O   HOH A 201       8.000   8.000   8.000  1.00 20.00           O  
HETATM    5 NA    NA A 301       9.000   9.000   9.000  1.00 20.00          NA  
END
"""
PDBQT_TEXT = (
    "ATOM      1  C   REC A   1       1.000   2.000   3.000  1.00  0.00     0.000 C\n"
)


def client_with_storage(tmp_path, monkeypatch) -> TestClient:
    monkeypatch.setattr(receptor_store, "RECEPTOR_ROOT", tmp_path / "app_data" / "receptors")
    return TestClient(app)


def test_pdb_upload_preserves_source_hash_and_identifies_nonwater_ligand(tmp_path, monkeypatch):
    client = client_with_storage(tmp_path, monkeypatch)
    response = client.post(
        "/api/docking/receptors",
        files={"file": ("target protein.pdb", PDB_TEXT.encode(), "chemical/x-pdb")},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["source_receptor_sha256"] == hashlib.sha256(PDB_TEXT.encode()).hexdigest()
    assert payload["docking_receptor_sha256"] is None
    assert payload["docking_ready"] is False
    assert [item["residue_name"] for item in payload["bound_ligands"]] == ["LIG"]
    ligand = payload["bound_ligands"][0]
    assert ligand["centroid"] == {"center_x": 2.0, "center_y": 3.0, "center_z": 4.0}
    metadata = client.get(f"/api/docking/receptors/{payload['receptor_id']}")
    assert metadata.status_code == 200
    structure = client.get(f"/api/docking/receptors/{payload['receptor_id']}/structure")
    assert structure.status_code == 200
    assert structure.headers["x-moloptima-structure-format"] == "pdb"
    assert "HOH" in structure.text


def test_prepared_pdbqt_can_be_uploaded_directly_or_attached_to_pdb(tmp_path, monkeypatch):
    client = client_with_storage(tmp_path, monkeypatch)
    direct = client.post(
        "/api/docking/receptors",
        files={"file": ("prepared.pdbqt", PDBQT_TEXT.encode(), "chemical/x-pdbqt")},
    )
    assert direct.status_code == 200
    assert direct.json()["docking_ready"] is True
    assert direct.json()["docking_receptor_sha256"] == hashlib.sha256(PDBQT_TEXT.encode()).hexdigest()

    pdb = client.post(
        "/api/docking/receptors",
        files={"file": ("target.pdb", PDB_TEXT.encode(), "chemical/x-pdb")},
    ).json()
    attached = client.post(
        f"/api/docking/receptors?receptor_id={pdb['receptor_id']}",
        files={"file": ("prepared-target.pdbqt", PDBQT_TEXT.encode(), "chemical/x-pdbqt")},
    )
    assert attached.status_code == 200
    assert attached.json()["source_receptor_sha256"] == pdb["source_receptor_sha256"]
    assert attached.json()["docking_ready"] is True
    assert attached.json()["preparation_method"] == "user_supplied_pdbqt"
    assert attached.json()["receptor_source"] == "user_supplied_pdbqt"


def test_invalid_receptor_and_invalid_box_are_rejected(tmp_path, monkeypatch):
    client = client_with_storage(tmp_path, monkeypatch)
    invalid = client.post(
        "/api/docking/receptors",
        files={"file": ("invalid.pdb", b"REMARK no atoms\n", "chemical/x-pdb")},
    )
    assert invalid.status_code == 400
    receptor = client.post(
        "/api/docking/receptors",
        files={"file": ("prepared.pdbqt", PDBQT_TEXT.encode(), "chemical/x-pdbqt")},
    ).json()
    response = client.post("/api/docking/configurations", json={
        "receptor_id": receptor["receptor_id"], "center_method": "manual",
        "center_x": 0, "center_y": 0, "center_z": 0,
        "size_x": 20, "size_y": 0, "size_z": 20,
        "exhaustiveness": 8, "num_modes": 9, "seed": 2025, "worker_count": 2,
    })
    assert response.status_code == 422


def test_manual_configuration_is_saved_exactly(tmp_path, monkeypatch):
    client = client_with_storage(tmp_path, monkeypatch)
    receptor = client.post(
        "/api/docking/receptors",
        files={"file": ("prepared.pdbqt", PDBQT_TEXT.encode(), "chemical/x-pdbqt")},
    ).json()
    response = client.post("/api/docking/configurations", json={
        "receptor_id": receptor["receptor_id"], "center_method": "manual",
        "center_x": 0, "center_y": -1.25, "center_z": 3.5,
        "size_x": 20, "size_y": 21, "size_z": 22,
        "exhaustiveness": 8, "num_modes": 9, "energy_range": 4,
        "seed": 2025, "worker_count": 3,
    })
    assert response.status_code == 200
    payload = response.json()
    assert (payload["center_x"], payload["center_y"], payload["center_z"]) == (0.0, -1.25, 3.5)
    assert (payload["size_x"], payload["size_y"], payload["size_z"]) == (20.0, 21.0, 22.0)
    assert payload["worker_count"] == 3
    assert payload["cpu"] == 1
    assert payload["energy_range"] == 4.0
    saved = receptor_store.read_configuration(payload["configuration_id"])
    assert saved["energy_range"] == 4.0


def test_configuration_omits_energy_range_when_not_supplied(tmp_path, monkeypatch):
    client = client_with_storage(tmp_path, monkeypatch)
    receptor = client.post(
        "/api/docking/receptors",
        files={"file": ("prepared.pdbqt", PDBQT_TEXT.encode(), "chemical/x-pdbqt")},
    ).json()
    response = client.post("/api/docking/configurations", json={
        "receptor_id": receptor["receptor_id"], "center_method": "manual",
        "center_x": 0, "center_y": 1, "center_z": 2,
        "size_x": 20, "size_y": 21, "size_z": 22,
        "exhaustiveness": 8, "num_modes": 9, "seed": 2025, "worker_count": 3,
    })
    assert response.status_code == 200
    assert response.json()["energy_range"] is None
    saved = receptor_store.read_configuration(response.json()["configuration_id"])
    assert "energy_range" not in saved


def test_bound_ligand_configuration_uses_server_calculated_centroid(tmp_path, monkeypatch):
    client = client_with_storage(tmp_path, monkeypatch)
    receptor = client.post(
        "/api/docking/receptors",
        files={"file": ("target.pdb", PDB_TEXT.encode(), "chemical/x-pdb")},
    ).json()
    ligand_id = receptor["bound_ligands"][0]["ligand_id"]
    response = client.post("/api/docking/configurations", json={
        "receptor_id": receptor["receptor_id"], "center_method": "bound_ligand",
        "selected_ligand_id": ligand_id,
        "center_x": None, "center_y": None, "center_z": None,
        "size_x": 18, "size_y": 19, "size_z": 20,
        "exhaustiveness": 8, "num_modes": 9, "seed": 2025, "worker_count": 4,
    })
    assert response.status_code == 200
    assert (response.json()["center_x"], response.json()["center_y"], response.json()["center_z"]) == (2.0, 3.0, 4.0)
