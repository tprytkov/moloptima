from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from molecular_prioritization import receptor_preparation
from molecular_prioritization.receptor import identify_bound_ligands, parse_receptor_atoms
from molecular_prioritization.receptor_preparation import ReceptorPreparationError, _verify_repair, prepare_receptor


PDB = """\
ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00 20.00           N  
ATOM      2  CA  ALA A   1       1.450   0.000   0.000  1.00 20.00           C  
ATOM      3  C   ALA A   1       2.100   1.300   0.000  1.00 20.00           C  
ATOM      4  O   ALA A   1       1.600   2.400   0.000  1.00 20.00           O  
ATOM      5  CB  ALA A   1       1.900  -0.800   1.200  1.00 20.00           C  
HETATM    6  C1  LIG A 401      -2.000  -3.000  -4.000  1.00 20.00           C  
HETATM    7  O1  LIG A 401       2.000   3.000   4.000  1.00 20.00           O  
HETATM    8  C1  LIG B 401      20.000  20.000  20.000  1.00 20.00           C  
HETATM    9  O1  LIG B 401      21.000  21.000  21.000  1.00 20.00           O  
END
"""
PDBQT = "ATOM      1  C   ALA A   1       1.000   2.000   3.000  1.00  0.00     0.000 C\n"


def _fake_repair(source, destination, audit_path, **_kwargs):
    shutil.copyfile(source, destination)
    audit = {
        "available": True, "pdbfixer_version": "1.12.0", "openmm_version": "8.6.1",
        "added_atom_count": 0, "missing_residues_detected": [], "runtime_duration_seconds": 0.01,
    }
    audit_path.write_text(json.dumps(audit), encoding="utf-8")
    return audit


def _fake_meeko(command, **kwargs):
    output = Path(kwargs["cwd"])
    (output / "prepared_receptor.pdbqt").write_text(PDBQT, encoding="utf-8")
    (output / "meeko_receptor.json").write_text("{}\n", encoding="utf-8")
    return subprocess.CompletedProcess(command, 0, "ok", "")


def test_reference_ligand_box_uses_heavy_atom_bounds_and_four_angstrom_padding():
    ligands = identify_bound_ligands(parse_receptor_atoms(PDB))
    ligand = next(item for item in ligands if item.ligand_id == "LIG:A:401:_")
    assert ligand.as_dict()["heavy_atom_bounds"] == {
        "min_x": -2.0, "min_y": -3.0, "min_z": -4.0,
        "max_x": 2.0, "max_y": 3.0, "max_z": 4.0,
    }
    assert ligand.as_dict()["default_box"] == {
        "center_x": 0.0, "center_y": 0.0, "center_z": 0.0,
        "size_x": 12.0, "size_y": 14.0, "size_z": 16.0, "padding": 4.0,
    }


def test_integrated_reference_workflow_removes_explicit_copies_and_preserves_original(tmp_path, monkeypatch):
    source = tmp_path / "source.pdb"
    source.write_text(PDB, encoding="utf-8")
    original = source.read_bytes()
    monkeypatch.setattr(receptor_preparation, "run_repair", _fake_repair)
    monkeypatch.setattr(receptor_preparation.subprocess, "run", _fake_meeko)
    monkeypatch.setattr(receptor_preparation, "receptor_preparation_runtime_status", lambda: {
        "available": True, "packages": {"meeko": "0.7.1", "gemmi": "0.7.5"}, "reason": "",
    })
    result = prepare_receptor(
        source, tmp_path / "prepared", original_filename="source.pdb", receptor_id="a" * 32,
        selected_chains=["A"], water_policy="remove_all",
        hetero_choices={"LIG:A:401:_": False, "LIG:B:401:_": False}, altloc_choices={},
        pocket_definition_method="reference_ligand", reference_ligand_id="LIG:A:401:_",
        ligand_removal_ids=["LIG:A:401:_", "LIG:B:401:_"],
        pocket_config={"center_x": 0, "center_y": 0, "center_z": 0, "size_x": 12, "size_y": 14, "size_z": 16, "padding": 4},
    )
    assert source.read_bytes() == original
    assert " LIG " not in (result["artifact_directory"] / "ligand_removed_receptor.pdb").read_text(encoding="utf-8")
    assert result["provenance"]["ligand_removal_ids"] == ["LIG:A:401:_", "LIG:B:401:_"]
    assert (result["artifact_directory"] / "preparation_manifest.json").is_file()
    assert (result["artifact_directory"] / "prepared_receptor.pdbqt").is_file()


def test_integrated_manual_mode_requires_valid_box_and_runs_repair(tmp_path, monkeypatch):
    source = tmp_path / "source.pdb"
    source.write_text(PDB, encoding="utf-8")
    monkeypatch.setattr(receptor_preparation, "run_repair", _fake_repair)
    monkeypatch.setattr(receptor_preparation.subprocess, "run", _fake_meeko)
    monkeypatch.setattr(receptor_preparation, "receptor_preparation_runtime_status", lambda: {
        "available": True, "packages": {"meeko": "0.7.1", "gemmi": "0.7.5"}, "reason": "",
    })
    common = dict(original_filename="source.pdb", receptor_id="a" * 32, selected_chains=["A"],
                  water_policy="remove_all", hetero_choices={"LIG:A:401:_": False, "LIG:B:401:_": False},
                  altloc_choices={}, pocket_definition_method="manual")
    with pytest.raises(ReceptorPreparationError, match="positive"):
        prepare_receptor(source, tmp_path / "invalid", pocket_config={"center_x": -1, "center_y": 0, "center_z": 2, "size_x": 0, "size_y": 10, "size_z": 10}, **common)
    result = prepare_receptor(source, tmp_path / "valid", pocket_config={"center_x": -1, "center_y": 0, "center_z": 2, "size_x": 10, "size_y": 10, "size_z": 10}, **common)
    assert result["provenance"]["pocket_definition_method"] == "manual"
    assert result["provenance"]["repair_verification_file"] == "repair_verification.json"


def test_coordinate_displacement_quality_gate_fails(tmp_path):
    before = tmp_path / "before.pdb"
    after = tmp_path / "after.pdb"
    before.write_text(PDB.split("HETATM", 1)[0] + "END\n", encoding="utf-8")
    after.write_text(before.read_text(encoding="utf-8").replace("   0.000   0.000   0.000", "   0.010   0.000   0.000", 1), encoding="utf-8")
    with pytest.raises(ReceptorPreparationError, match="coordinates moved"):
        _verify_repair(before, after, {"added_atom_count": 0})
