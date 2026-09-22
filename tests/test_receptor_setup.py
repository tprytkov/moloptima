from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path

from fastapi.testclient import TestClient

from backend import receptor_store
from backend.main import app
from molecular_prioritization import receptor_preparation


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
FIXTURE_ROOT = Path(__file__).parent / "fixtures" / "receptor_setup"
VISUALIZATION_PDB = FIXTURE_ROOT / "visualization_reference.pdb"
VISUALIZATION_PDBQT = FIXTURE_ROOT / "visualization_reference.pdbqt"


def client_with_storage(tmp_path, monkeypatch) -> TestClient:
    monkeypatch.setattr(receptor_store, "RECEPTOR_ROOT", tmp_path / "app_data" / "receptors")
    return TestClient(app)


def fixture_coordinates(path: Path) -> list[tuple[float, float, float]]:
    return [
        (float(line[30:38]), float(line[38:46]), float(line[46:54]))
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.startswith(("ATOM  ", "HETATM"))
    ]


def fake_meeko_with_visualization_fixture(command, **kwargs):
    assert kwargs["shell"] is False
    output_dir = Path(kwargs["cwd"])
    (output_dir / "prepared_receptor.pdbqt").write_bytes(VISUALIZATION_PDBQT.read_bytes())
    (output_dir / "meeko_receptor.json").write_text('{"fixture": true}\n', encoding="utf-8")
    return subprocess.CompletedProcess(command, 0, "Files written", "")


def assert_docking_identity(response, receptor: dict[str, object], expected_bytes: bytes, expected_format: str):
    expected_digest = hashlib.sha256(expected_bytes).hexdigest()
    assert response.status_code == 200
    assert response.content == expected_bytes
    assert response.headers["x-moloptima-structure-format"] == expected_format
    assert response.headers["x-moloptima-structure-representation"] == "docking"
    assert response.headers["x-moloptima-receptor-id"] == receptor["receptor_id"]
    assert response.headers["x-moloptima-artifact-sha256"] == expected_digest
    return expected_digest


def test_visualization_reference_pdb_and_pdbqt_share_the_same_coordinates():
    assert fixture_coordinates(VISUALIZATION_PDB) == fixture_coordinates(VISUALIZATION_PDBQT)


def test_docking_representation_falls_back_to_exact_source_pdb_before_preparation(tmp_path, monkeypatch):
    client = client_with_storage(tmp_path, monkeypatch)
    pdb_bytes = VISUALIZATION_PDB.read_bytes()
    receptor = client.post(
        "/api/docking/receptors",
        files={"file": (VISUALIZATION_PDB.name, pdb_bytes, "chemical/x-pdb")},
    ).json()

    response = client.get(
        f"/api/docking/receptors/{receptor['receptor_id']}/structure?representation=docking"
    )

    digest = assert_docking_identity(response, receptor, pdb_bytes, "pdb")
    assert digest == receptor["source_receptor_sha256"]
    assert "x-moloptima-docking-receptor-sha256" not in response.headers
    assert "x-moloptima-preparation-id" not in response.headers


def test_moloptima_prepared_docking_representation_is_exact_vina_receptor(tmp_path, monkeypatch):
    client = client_with_storage(tmp_path, monkeypatch)
    monkeypatch.setattr(receptor_preparation.subprocess, "run", fake_meeko_with_visualization_fixture)
    receptor = client.post(
        "/api/docking/receptors",
        files={"file": (VISUALIZATION_PDB.name, VISUALIZATION_PDB.read_bytes(), "chemical/x-pdb")},
    ).json()
    prepared = client.post(
        f"/api/docking/receptors/{receptor['receptor_id']}/prepare",
        json={
            "selected_chains": ["A"], "water_policy": "remove_all",
            "hetero_choices": {}, "altloc_choices": {}, "bound_ligand_id": "",
        },
    )
    assert prepared.status_code == 200
    prepared_metadata = prepared.json()

    response = client.get(
        f"/api/docking/receptors/{receptor['receptor_id']}/structure?representation=docking"
    )
    expected_bytes = receptor_store.prepared_receptor_path(receptor["receptor_id"]).read_bytes()
    digest = assert_docking_identity(response, prepared_metadata, expected_bytes, "pdbqt")
    assert expected_bytes == VISUALIZATION_PDBQT.read_bytes()
    assert digest == prepared_metadata["docking_receptor_sha256"]
    assert response.headers["x-moloptima-docking-receptor-sha256"] == digest
    assert response.headers["x-moloptima-preparation-id"] == prepared_metadata["preparation_id"]


def test_direct_pdbqt_docking_representation_returns_exact_uploaded_artifact(tmp_path, monkeypatch):
    client = client_with_storage(tmp_path, monkeypatch)
    pdbqt_bytes = VISUALIZATION_PDBQT.read_bytes()
    receptor = client.post(
        "/api/docking/receptors",
        files={"file": (VISUALIZATION_PDBQT.name, pdbqt_bytes, "chemical/x-pdbqt")},
    ).json()

    response = client.get(
        f"/api/docking/receptors/{receptor['receptor_id']}/structure?representation=docking",
        headers={"Origin": "http://localhost:5173"},
    )

    digest = assert_docking_identity(response, receptor, pdbqt_bytes, "pdbqt")
    assert digest == receptor["docking_receptor_sha256"]
    assert response.headers["x-moloptima-docking-receptor-sha256"] == digest
    exposed = response.headers["access-control-expose-headers"].lower()
    assert "x-moloptima-artifact-sha256" in exposed
    assert "x-moloptima-docking-receptor-sha256" in exposed


def test_attached_pdbqt_docking_representation_replaces_source_only_for_explicit_mode(tmp_path, monkeypatch):
    client = client_with_storage(tmp_path, monkeypatch)
    pdb_bytes = VISUALIZATION_PDB.read_bytes()
    pdbqt_bytes = VISUALIZATION_PDBQT.read_bytes()
    receptor = client.post(
        "/api/docking/receptors",
        files={"file": (VISUALIZATION_PDB.name, pdb_bytes, "chemical/x-pdb")},
    ).json()
    attached = client.post(
        f"/api/docking/receptors?receptor_id={receptor['receptor_id']}",
        files={"file": (VISUALIZATION_PDBQT.name, pdbqt_bytes, "chemical/x-pdbqt")},
    ).json()

    source_response = client.get(f"/api/docking/receptors/{receptor['receptor_id']}/structure")
    docking_response = client.get(
        f"/api/docking/receptors/{receptor['receptor_id']}/structure?representation=docking"
    )

    assert source_response.content == pdb_bytes
    assert source_response.headers["x-moloptima-structure-format"] == "pdb"
    digest = assert_docking_identity(docking_response, attached, pdbqt_bytes, "pdbqt")
    assert digest == attached["docking_receptor_sha256"]
    assert docking_response.content != source_response.content


def test_docking_representation_fails_closed_when_artifact_hash_no_longer_matches_metadata(tmp_path, monkeypatch):
    client = client_with_storage(tmp_path, monkeypatch)
    receptor = client.post(
        "/api/docking/receptors",
        files={"file": (VISUALIZATION_PDBQT.name, VISUALIZATION_PDBQT.read_bytes(), "chemical/x-pdbqt")},
    ).json()
    receptor_store.prepared_receptor_path(receptor["receptor_id"]).write_bytes(PDBQT_TEXT.encode())

    response = client.get(
        f"/api/docking/receptors/{receptor['receptor_id']}/structure?representation=docking"
    )

    assert response.status_code == 500
    assert response.json()["detail"] == "Stored receptor artifact identity does not match receptor metadata."


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
    assert tuple(saved[name] for name in ("center_x", "center_y", "center_z")) == (0.0, -1.25, 3.5)
    assert tuple(saved[name] for name in ("size_x", "size_y", "size_z")) == (20.0, 21.0, 22.0)
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
