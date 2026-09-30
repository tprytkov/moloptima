from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import receptor_store
from backend.main import app
from molecular_prioritization import receptor_preparation
from molecular_prioritization.receptor import (
    ReceptorValidationError,
    audit_prepared_receptor_hydrogens,
    parse_receptor_atoms,
    receptor_structure_inventory,
    validate_prepared_receptor,
)
from molecular_prioritization.receptor_preparation import ReceptorPreparationError, prepare_receptor


FIXTURE = Path(__file__).parent / "fixtures" / "receptor_preparation" / "small_peptide.pdb"
MISSING_ELEMENTS_FIXTURE = (
    Path(__file__).parent / "fixtures" / "receptor_preparation" / "missing_element_columns.pdb"
)
VALID_PDBQT = "ATOM      1  C   ALA A   1       1.000   2.000   3.000  1.00  0.00     0.000 C\n"
INVENTORY_PDB = """\
ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00 20.00           N  
ATOM      2  N   GLY B   1       1.000   0.000   0.000  1.00 20.00           N  
HETATM    3  O   HOH A 201       2.000   0.000   0.000  1.00 20.00           O  
HETATM    4 ZN    ZN A 301       3.000   0.000   0.000  1.00 20.00          ZN  
HETATM    5  C1  LIG A 401       4.000   0.000   0.000  1.00 20.00           C  
HETATM    6  O1  LIG A 401       5.000   0.000   0.000  1.00 20.00           O  
END
"""


def _fake_meeko(command, **kwargs):
    assert kwargs["shell"] is False
    assert command[1:4] == ["-m", "meeko.cli.mk_prepare_receptor", "--read_pdb"]
    cwd = Path(kwargs["cwd"])
    (cwd / "prepared_receptor.pdbqt").write_text(VALID_PDBQT, encoding="utf-8")
    (cwd / "meeko_receptor.json").write_text('{"fixture": true}\n', encoding="utf-8")
    return subprocess.CompletedProcess(command, 0, "Files written", "")


def _prepare(tmp_path, monkeypatch, *, pdb_text=None, **overrides):
    source = tmp_path / "input.pdb"
    source.write_text(pdb_text or FIXTURE.read_text(encoding="utf-8"), encoding="utf-8")
    monkeypatch.setattr(receptor_preparation.subprocess, "run", _fake_meeko)
    values = {
        "original_filename": "public receptor; ignored argument.pdb",
        "receptor_id": "a" * 32,
        "selected_chains": ["A"],
        "water_policy": "remove_all",
        "hetero_choices": {},
        "altloc_choices": {},
    }
    values.update(overrides)
    return source, prepare_receptor(source, tmp_path / "run" / "receptor", **values)


def test_inventory_reports_chains_waters_ions_and_ligand_candidates_without_overclaiming():
    inventory = receptor_structure_inventory(parse_receptor_atoms(INVENTORY_PDB))
    assert inventory["protein"]["chains"] == [
        {"chain": "A", "residue_count": 1, "atom_count": 1},
        {"chain": "B", "residue_count": 1, "atom_count": 1},
    ]
    assert inventory["waters"]["count"] == 1
    assert [(item["residue_name"], item["type"]) for item in inventory["hetero_groups"]] == [
        ("LIG", "ligand_candidate"), ("ZN", "ion"),
    ]


def test_selection_is_explicit_and_meeko_command_is_controlled(tmp_path, monkeypatch):
    hetero = {"LIG:A:401:_": False, "ZN:A:301:_": True}
    source, result = _prepare(
        tmp_path,
        monkeypatch,
        pdb_text=INVENTORY_PDB,
        selected_chains=["A"],
        hetero_choices=hetero,
        bound_ligand_id="LIG:A:401:_",
    )
    selected = (result["artifact_directory"] / "selected_receptor_input.pdb").read_text(encoding="utf-8")
    assert "GLY B" not in selected
    assert "HOH" not in selected
    assert " LIG " not in selected
    assert " ZN " in selected
    assert source.read_text(encoding="utf-8") == (result["artifact_directory"] / "original_receptor.pdb").read_text(encoding="utf-8")
    provenance = result["provenance"]
    assert provenance["bound_ligand_excluded"] is True
    assert provenance["retained_hetero_groups"][0]["residue_name"] == "ZN"
    assert provenance["invocation"]["shell"] is False
    assert "public receptor" not in " ".join(provenance["invocation"]["arguments"])
    assert provenance["validation_status"] == "valid"
    assert result["validated_artifact"].source == "moloptima_prepared"


def test_provenance_hashes_match_artifacts_and_original_is_preserved(tmp_path, monkeypatch):
    source, result = _prepare(tmp_path, monkeypatch)
    artifact_dir = result["artifact_directory"]
    provenance = json.loads((artifact_dir / "receptor_preparation.json").read_text(encoding="utf-8"))
    assert provenance["original_pdb_sha256"] == hashlib.sha256(source.read_bytes()).hexdigest()
    assert provenance["prepared_pdbqt_sha256"] == hashlib.sha256((artifact_dir / "prepared_receptor.pdbqt").read_bytes()).hexdigest()
    assert provenance["final_pdbqt_hydrogen_policy"] == "autodock_polar_hydrogen_united_atom"
    for line in (artifact_dir / "SHA256SUMS").read_text(encoding="utf-8").splitlines():
        digest, filename = line.split("  ", 1)
        assert digest == hashlib.sha256((artifact_dir / filename).read_bytes()).hexdigest()


def test_missing_element_columns_are_filled_only_in_derived_preparation_input(tmp_path, monkeypatch):
    source_bytes = MISSING_ELEMENTS_FIXTURE.read_bytes()
    source = tmp_path / "missing-elements.pdb"
    source.write_bytes(source_bytes)
    monkeypatch.setattr(receptor_preparation.subprocess, "run", _fake_meeko)
    result = prepare_receptor(
        source,
        tmp_path / "run" / "receptor",
        original_filename=source.name,
        receptor_id="a" * 32,
        selected_chains=["A"],
        water_policy="remove_all",
        hetero_choices={},
        altloc_choices={},
    )
    selected_path = result["artifact_directory"] / "selected_receptor_input.pdb"
    source_atoms = parse_receptor_atoms(source.read_text(encoding="utf-8"))
    selected_atoms = parse_receptor_atoms(selected_path.read_text(encoding="utf-8"))

    assert [atom.element for atom in source_atoms] == ["N", "C", "C", "O"]
    assert [atom.element for atom in selected_atoms] == ["N", "C", "C", "O"]
    selected_atom_lines = [
        line for line in selected_path.read_text(encoding="utf-8").splitlines()
        if line.startswith(("ATOM  ", "HETATM"))
    ]
    assert [line[76:78] for line in selected_atom_lines] == [" N", " C", " C", " O"]
    assert source.read_bytes() == source_bytes
    assert (result["artifact_directory"] / "original_receptor.pdb").read_bytes() == source_bytes
    assert len(source_atoms) == len(selected_atoms) == 4
    assert [atom.atom_name for atom in selected_atoms] == [atom.atom_name for atom in source_atoms]
    assert [atom.residue_name for atom in selected_atoms] == [atom.residue_name for atom in source_atoms]
    assert [atom.chain for atom in selected_atoms] == [atom.chain for atom in source_atoms]
    assert [atom.residue_number for atom in selected_atoms] == [atom.residue_number for atom in source_atoms]
    assert [(atom.x, atom.y, atom.z) for atom in selected_atoms] == [
        (atom.x, atom.y, atom.z) for atom in source_atoms
    ]
    normalization = result["provenance"]["preparation_input"]["normalization"]
    assert normalization["operation"] == "fill_missing_pdb_element_columns"
    assert normalization["missing_element_columns_filled"] == 4
    assert normalization["preexisting_element_columns_preserved"] == 0
    assert "no chemical repair" in normalization["description"]


def test_existing_valid_element_columns_are_preserved_byte_for_byte(tmp_path, monkeypatch):
    source, result = _prepare(tmp_path, monkeypatch)
    source_atom_lines = [
        line for line in source.read_text(encoding="utf-8").splitlines()
        if line.startswith(("ATOM  ", "HETATM"))
    ]
    selected_atom_lines = [
        line
        for line in (result["artifact_directory"] / "selected_receptor_input.pdb")
        .read_text(encoding="utf-8")
        .splitlines()
        if line.startswith(("ATOM  ", "HETATM"))
    ]
    assert selected_atom_lines == source_atom_lines
    normalization = result["provenance"]["preparation_input"]["normalization"]
    assert normalization["missing_element_columns_filled"] == 0
    assert normalization["preexisting_element_columns_preserved"] == len(source_atom_lines)


def test_uninferable_blank_element_fails_with_actionable_atom_identity(tmp_path, monkeypatch):
    ambiguous = "ATOM      1  Q1  ALA A   1       0.000   0.000   0.000  1.00 20.00\nEND\n"
    source = tmp_path / "ambiguous.pdb"
    source.write_text(ambiguous, encoding="utf-8")
    monkeypatch.setattr(receptor_preparation.subprocess, "run", _fake_meeko)

    with pytest.raises(
        ReceptorPreparationError,
        match=r"blank PDB element columns 77-78.*ATOM serial 1, atom 'Q1'.*ALA A:1",
    ):
        prepare_receptor(
            source,
            tmp_path / "ambiguous" / "receptor",
            original_filename="ambiguous.pdb",
            receptor_id="a" * 32,
            selected_chains=["A"],
            water_policy="remove_all",
            hetero_choices={},
            altloc_choices={},
        )
    assert source.read_text(encoding="utf-8") == ambiguous


def test_real_meeko_output_retains_only_polar_donor_hydrogens(tmp_path):
    result = prepare_receptor(
        FIXTURE,
        tmp_path / "real-polar-hydrogen" / "receptor",
        original_filename=FIXTURE.name,
        receptor_id="a" * 32,
        selected_chains=["A"],
        water_policy="remove_all",
        hetero_choices={},
        altloc_choices={},
    )
    prepared = result["prepared_pdbqt"]
    audit = audit_prepared_receptor_hydrogens(prepared)
    assert audit["total_atom_record_count"] == 12
    assert audit["explicit_hydrogen_atom_count"] == 2
    assert audit["explicit_hydrogen_autodock_types"] == ["HD", "HD"]
    assert audit["explicit_hydrogen_parent_elements"] == ["N", "N"]
    assert audit["carbon_bound_explicit_hydrogen_count"] == 0
    assert audit["polar_donor_hydrogen_count"] >= 1
    assert result["provenance"]["final_pdbqt_hydrogen_representation"] == audit
    assert validate_prepared_receptor(prepared).prepared_receptor_sha256 == hashlib.sha256(prepared.read_bytes()).hexdigest()


def test_validator_rejects_explicit_carbon_bound_nonpolar_hydrogen(tmp_path):
    pdbqt = tmp_path / "carbon-bound-hydrogen.pdbqt"
    pdbqt.write_text(
        "ATOM      1  C   ALA A   1       0.000   0.000   0.000  1.00  0.00     0.000 C \n"
        "ATOM      2  H   ALA A   1       1.090   0.000   0.000  1.00  0.00     0.000 H \n",
        encoding="utf-8",
    )
    with pytest.raises(ReceptorValidationError, match="carbon-bound hydrogen"):
        validate_prepared_receptor(pdbqt)


def test_invalid_generated_pdbqt_and_meeko_failure_fail_closed(tmp_path, monkeypatch):
    def invalid_output(command, **kwargs):
        cwd = Path(kwargs["cwd"])
        (cwd / "prepared_receptor.pdbqt").write_text("ATOM malformed\n", encoding="utf-8")
        (cwd / "meeko_receptor.json").write_text("{}\n", encoding="utf-8")
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr(receptor_preparation.subprocess, "run", invalid_output)
    with pytest.raises(ReceptorPreparationError, match="failed MolOptima validation"):
        prepare_receptor(
            FIXTURE, tmp_path / "invalid" / "receptor", original_filename="small.pdb",
            receptor_id="a" * 32, selected_chains=["A"], water_policy="remove_all",
            hetero_choices={}, altloc_choices={},
        )

    def failed(command, **kwargs):
        return subprocess.CompletedProcess(command, 2, "", "unsupported residue")

    monkeypatch.setattr(receptor_preparation.subprocess, "run", failed)
    with pytest.raises(ReceptorPreparationError, match="unsupported residue"):
        prepare_receptor(
            FIXTURE, tmp_path / "failed" / "receptor", original_filename="small.pdb",
            receptor_id="a" * 32, selected_chains=["A"], water_policy="remove_all",
            hetero_choices={}, altloc_choices={},
        )


def test_missing_runtime_and_incomplete_scientific_choices_fail_closed(tmp_path, monkeypatch):
    monkeypatch.setattr(receptor_preparation, "receptor_preparation_runtime_status", lambda: {
        "available": False, "reason": "Meeko is missing",
    })
    with pytest.raises(ReceptorPreparationError, match="Meeko is missing"):
        prepare_receptor(
            FIXTURE, tmp_path / "missing" / "receptor", original_filename="small.pdb",
            receptor_id="a" * 32, selected_chains=["A"], water_policy="remove_all",
            hetero_choices={}, altloc_choices={},
        )


def test_altloc_choice_is_required_and_deterministic(tmp_path, monkeypatch):
    pdb = (
        "ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00 20.00           N  \n"
        "ATOM      2  CA AALA A   1       1.000   0.000   0.000  0.50 20.00           C  \n"
        "ATOM      3  CA BALA A   1       2.000   0.000   0.000  0.50 20.00           C  \n"
    )
    monkeypatch.setattr(receptor_preparation.subprocess, "run", _fake_meeko)
    source = tmp_path / "altloc.pdb"
    source.write_text(pdb, encoding="utf-8")
    with pytest.raises(ReceptorPreparationError, match="alternate locations"):
        prepare_receptor(
            source, tmp_path / "no-choice" / "receptor", original_filename="altloc.pdb",
            receptor_id="a" * 32, selected_chains=["A"], water_policy="remove_all",
            hetero_choices={}, altloc_choices={},
        )
    result = prepare_receptor(
        source, tmp_path / "chosen" / "receptor", original_filename="altloc.pdb",
        receptor_id="a" * 32, selected_chains=["A"], water_policy="remove_all",
        hetero_choices={}, altloc_choices={"A:1": "B"},
    )
    selected = (result["artifact_directory"] / "selected_receptor_input.pdb").read_text(encoding="utf-8")
    assert "CA BALA" in selected
    assert "CA AALA" not in selected


def test_real_meeko_api_path_prepares_and_validates_small_receptor(tmp_path, monkeypatch):
    monkeypatch.setattr(receptor_store, "RECEPTOR_ROOT", tmp_path / "app_data" / "receptors")
    client = TestClient(app)
    upload = client.post(
        "/api/docking/receptors",
        files={"file": (FIXTURE.name, FIXTURE.read_bytes(), "chemical/x-pdb")},
    )
    assert upload.status_code == 200
    receptor = upload.json()
    assert receptor["structure_inventory"]["protein"]["chains"][0]["chain"] == "A"
    prepared = client.post(f"/api/docking/receptors/{receptor['receptor_id']}/prepare", json={
        "selected_chains": ["A"], "water_policy": "remove_all",
        "hetero_choices": {}, "altloc_choices": {}, "bound_ligand_id": "",
    })
    assert prepared.status_code == 200, prepared.text
    payload = prepared.json()
    assert payload["docking_ready"] is True
    assert payload["receptor_source"] == "moloptima_prepared"
    assert payload["preparation_details"]["validation_status"] == "valid"
    structure = client.get(f"/api/docking/receptors/{receptor['receptor_id']}/structure")
    assert structure.headers["x-moloptima-structure-format"] == "pdb"
    assert structure.text == FIXTURE.read_text(encoding="utf-8")


def test_direct_user_pdbqt_remains_available_when_meeko_is_unavailable(tmp_path, monkeypatch):
    monkeypatch.setattr(receptor_store, "RECEPTOR_ROOT", tmp_path / "app_data" / "receptors")
    monkeypatch.setattr(receptor_store, "receptor_preparation_runtime_status", lambda: {
        "status": "unavailable", "available": False, "tool": "Meeko", "version": None,
        "interface": "python_module_cli", "reason": "missing",
    })
    client = TestClient(app)
    runtime = client.get("/api/docking/receptor-preparation/runtime")
    assert runtime.status_code == 200 and runtime.json()["available"] is False
    direct = client.post(
        "/api/docking/receptors",
        files={"file": ("prepared.pdbqt", VALID_PDBQT.encode(), "chemical/x-pdbqt")},
    )
    assert direct.status_code == 200
    assert direct.json()["receptor_source"] == "user_supplied_pdbqt"
    assert direct.json()["docking_ready"] is True


def test_receptor_preparation_source_has_no_open_babel_path():
    source = Path(receptor_preparation.__file__).read_text(encoding="utf-8").lower()
    assert "openbabel" not in source
    assert "obabel" not in source
