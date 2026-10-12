from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from rdkit import Chem

from molecular_prioritization.interaction_analysis_input import (
    INPUT_SCHEMA_VERSION,
    POCKET_CUTOFF_ANGSTROM,
    InteractionAnalysisInputError,
    build_interaction_analysis_input,
    extract_vina_pose_model,
    resolve_template_pose_mapping,
    write_interaction_analysis_input,
)
from molecular_prioritization.vina_docking import _prepare_rdkit_ligand


def pdbqt_atom(
    serial: int,
    name: str,
    residue: str,
    chain: str,
    residue_number: int,
    x: float,
    y: float,
    z: float,
    atom_type: str,
    *,
    record: str = "ATOM",
    insertion_code: str = " ",
) -> str:
    return (
        f"{record:<6}{serial:5d} {name:^4s} {residue:>3s} {chain}{residue_number:4d}"
        f"{insertion_code:1s}   {x:8.3f}{y:8.3f}{z:8.3f}  1.00  0.00     0.000 {atom_type}\n"
    )


def pdb_atom(
    serial: int,
    name: str,
    residue: str,
    chain: str,
    residue_number: int,
    x: float,
    y: float,
    z: float,
    element: str,
    *,
    record: str = "ATOM",
    insertion_code: str = " ",
) -> str:
    return (
        f"{record:<6}{serial:5d} {name:^4s} {residue:>3s} {chain}{residue_number:4d}"
        f"{insertion_code:1s}   {x:8.3f}{y:8.3f}{z:8.3f}  1.00 20.00          {element:>2s}\n"
    )


def pose_model(model: int, score: float, rmsd_lb: float, rmsd_ub: float, atoms: list[str]) -> str:
    return (
        f"MODEL {model}\n"
        f"REMARK VINA RESULT: {score:.3f} {rmsd_lb:.3f} {rmsd_ub:.3f}\n"
        + "".join(atoms)
        + "ENDMDL\n"
    )


def unique_cco_atoms() -> list[str]:
    # Deliberately reordered relative to the C-C-O template: O, terminal C, central C.
    return [
        pdbqt_atom(9, "O1", "LIG", "A", 1, 2.9, 0, 0, "OA"),
        pdbqt_atom(4, "C1", "LIG", "A", 1, 0, 0, 0, "C"),
        pdbqt_atom(7, "C2", "LIG", "A", 1, 1.5, 0, 0, "C"),
    ]


def write_template(path: Path, smiles: str) -> None:
    _prepare_rdkit_ligand(smiles, path, 20240517)


def test_extracts_exact_model_metadata_and_never_rewrites_parent(tmp_path):
    path = tmp_path / "poses.pdbqt"
    first = pose_model(1, -7.1, 0.0, 0.0, unique_cco_atoms())
    second_atoms = [line.replace("  2.900", "  3.125") for line in unique_cco_atoms()]
    second = pose_model(2, -6.5, 1.2, 1.8, second_atoms)
    path.write_text(first + second, encoding="utf-8")
    before = path.read_bytes()

    extracted = extract_vina_pose_model(path, 2, docking_job_id="job-1")

    expected_disk_model = before.decode("utf-8")[before.decode("utf-8").index("MODEL 2"):]
    assert extracted["model_text"] == expected_disk_model
    assert extracted["mode_number"] == extracted["model_number"] == 2
    assert extracted["vina_affinity_kcal_mol"] == -6.5
    assert extracted["rmsd_lb"] == 1.2
    assert extracted["rmsd_ub"] == 1.8
    assert extracted["atoms"][0]["coordinates"][0] == 3.125
    assert path.read_bytes() == before
    assert extracted["parent_pose_sha256"] == hashlib.sha256(before).hexdigest()


def test_missing_mode_is_explicit_analysis_only_failure(tmp_path):
    path = tmp_path / "poses.pdbqt"
    path.write_text(pose_model(1, -7.1, 0, 0, unique_cco_atoms()), encoding="utf-8")

    with pytest.raises(InteractionAnalysisInputError) as error:
        extract_vina_pose_model(path, 3)

    assert error.value.code == "pose_model_not_found"
    assert path.is_file()


def test_graph_mapping_handles_openbabel_style_reordering_and_validates_chemistry(tmp_path):
    template = tmp_path / "ligand.sdf"
    pose = tmp_path / "pose.pdbqt"
    write_template(template, "CCO")
    pose.write_text(pose_model(1, -7.0, 0, 0, unique_cco_atoms()), encoding="utf-8")

    mapping = resolve_template_pose_mapping(template, extract_vina_pose_model(pose, 1))

    assert [entry["pose_pdbqt_atom_index"] for entry in mapping["entries"]] == [1, 2, 0]
    assert mapping["positional_identity_assumed"] is False
    assert mapping["validation"] == {
        "heavy_atom_count": "passed",
        "atomic_elements": "passed",
        "graph_isomorphism": "passed",
        "bond_orders": "passed",
        "aromaticity": "passed",
        "formal_charges": "passed",
        "canonical_isomeric_smiles": "passed",
        "canonical_isomeric_smiles_value": "CCO",
    }


def test_ambiguous_graph_mapping_fails_instead_of_using_coordinates_as_identity(tmp_path):
    template = tmp_path / "ethane.sdf"
    pose = tmp_path / "pose.pdbqt"
    write_template(template, "CC")
    atoms = [
        pdbqt_atom(1, "C1", "LIG", "A", 1, 0, 0, 0, "C"),
        pdbqt_atom(2, "C2", "LIG", "A", 1, 1.5, 0, 0, "C"),
    ]
    pose.write_text(pose_model(1, -5.0, 0, 0, atoms), encoding="utf-8")

    with pytest.raises(InteractionAnalysisInputError, match="ambiguous") as error:
        resolve_template_pose_mapping(template, extract_vina_pose_model(pose, 1))

    assert error.value.code == "template_pose_mapping_failed"


def test_graph_automorphism_is_resolved_only_after_graph_match_by_template_geometry(tmp_path):
    template = tmp_path / "isopropanol.sdf"
    pose = tmp_path / "pose.pdbqt"
    write_template(template, "CC(C)O")
    molecule = Chem.RemoveHs(Chem.SDMolSupplier(str(template), removeHs=False)[0])
    conformer = molecule.GetConformer()
    pose_order = [2, 3, 0, 1]
    atoms = []
    for pose_index, template_index in enumerate(pose_order, start=1):
        point = conformer.GetAtomPosition(template_index)
        atoms.append(pdbqt_atom(
            pose_index, f"C{pose_index}", "LIG", "A", 1,
            point.x, point.y, point.z,
            "OA" if molecule.GetAtomWithIdx(template_index).GetSymbol() == "O" else "C",
        ))
    pose.write_text(pose_model(1, -5.0, 0, 0, atoms), encoding="utf-8")

    mapping = resolve_template_pose_mapping(template, extract_vina_pose_model(pose, 1))

    assert [entry["pose_pdbqt_atom_index"] for entry in mapping["entries"]] == [2, 3, 0, 1]
    assert mapping["coordinate_tiebreaker"]["status"] == "resolved_graph_automorphisms"
    assert mapping["coordinate_tiebreaker"]["candidate_count"] == 2


def test_build_contract_selects_complete_residues_and_preserves_limitations(tmp_path):
    template = tmp_path / "ligand.sdf"
    metadata = tmp_path / "ligand.json"
    pose = tmp_path / "pose.pdbqt"
    receptor = tmp_path / "prepared_receptor.pdbqt"
    meeko_input = tmp_path / "meeko_input.pdb"
    receptor_provenance = tmp_path / "receptor_preparation.json"
    write_template(template, "CCO")
    template_sha = hashlib.sha256(template.read_bytes()).hexdigest()
    metadata.write_text(json.dumps({
        "artifact_schema_version": "moloptima-ligand-template-v1",
        "artifact_id": "ligand-1", "molecule_id": "mol-1",
        "canonical_isomeric_smiles": "CCO", "sdf_sha256": template_sha,
        "rdkit_version": "test", "conformer_generation_method": "RDKit ETKDGv3",
        "conformer_seed": 123, "optimization_method": "RDKit MMFF",
        "explicit_hydrogen_policy": "all_hydrogens_explicit_before_openbabel",
        "docking_job_id": "job-1",
    }), encoding="utf-8")
    pose.write_text(pose_model(1, -7.2, 0.0, 0.0, unique_cco_atoms()), encoding="utf-8")
    receptor_text = "".join([
        pdbqt_atom(1, "CA", "ALA", "A", 10, 5.0, 0, 0, "C"),
        # Same residue, outside 8 A: complete-residue policy must retain it.
        pdbqt_atom(2, "CB", "ALA", "A", 10, 15.0, 0, 0, "C"),
        pdbqt_atom(3, "H", "ALA", "A", 10, 5.9, 0, 0, "HD"),
        pdbqt_atom(4, "CA", "GLY", "B", 20, 30.0, 0, 0, "C"),
        pdbqt_atom(5, "ZN", "ZN", "A", 30, 6.0, 0, 0, "ZN", record="HETATM"),
    ])
    receptor.write_text(receptor_text, encoding="utf-8")
    meeko_input.write_text("".join([
        pdb_atom(1, "CA", "ALA", "A", 10, 5.0, 0, 0, "C"),
        pdb_atom(2, "CB", "ALA", "A", 10, 15.0, 0, 0, "C"),
        pdb_atom(4, "CA", "GLY", "B", 20, 30.0, 0, 0, "C"),
        pdb_atom(5, "ZN", "ZN", "A", 30, 6.0, 0, 0, "ZN", record="HETATM"),
    ]), encoding="utf-8")
    receptor_sha = hashlib.sha256(receptor.read_bytes()).hexdigest()
    receptor_provenance.write_text(json.dumps({
        "schema_version": "moloptima-receptor-preparation-v1",
        "prepared_pdbqt_sha256": receptor_sha,
        "protonation_status": "not_scientifically_resolved",
        "final_pdbqt_hydrogen_policy": "autodock_polar_hydrogen_united_atom",
    }), encoding="utf-8")
    docking_result = {
        "receptor_id": "receptor-1", "pose_sha256": hashlib.sha256(pose.read_bytes()).hexdigest(),
        "rdkit_version": "test", "obabel_version": "Open Babel test", "vina_version": "Vina test",
    }

    contract = build_interaction_analysis_input(
        docking_result=docking_result,
        ligand_template_path=template,
        ligand_template_metadata_path=metadata,
        pose_path=pose,
        mode_number=1,
        prepared_receptor_pdbqt_path=receptor,
        meeko_input_pdb_path=meeko_input,
        receptor_preparation_provenance_path=receptor_provenance,
    )

    assert contract["schema_version"] == INPUT_SCHEMA_VERSION
    region = contract["receptor_analysis"]
    assert region["distance_cutoff_angstrom"] == POCKET_CUTOFF_ANGSTROM == 8.0
    assert region["complete_residue_inclusion"] is True
    assert {item["residue_name"] for item in region["selected_residues"]} == {"ALA", "ZN"}
    assert len(region["selected_atom_records"]) == 4
    zinc = next(item for item in region["selected_residues"] if item["residue_name"] == "ZN")
    assert zinc["metal_or_cofactor_interaction_typing"] == "unsupported"
    assert region["protonation_status"] == "not_scientifically_resolved"
    assert contract["pose"]["vina_affinity_kcal_mol"] == -7.2


def test_missing_corrupt_or_deleted_analysis_artifacts_do_not_change_docking_result(tmp_path):
    docking_result = {"status": "success", "pose_sha256": "a" * 64, "vina_affinity": -7.5}
    missing = tmp_path / "missing.sdf"
    with pytest.raises(InteractionAnalysisInputError) as error:
        resolve_template_pose_mapping(missing, {"atoms": []})
    assert error.value.code == "ligand_template_missing"
    assert docking_result == {"status": "success", "pose_sha256": "a" * 64, "vina_affinity": -7.5}

    artifact = tmp_path / "analysis.json"
    write_interaction_analysis_input(artifact, {"schema_version": INPUT_SCHEMA_VERSION})
    artifact.write_text("corrupt", encoding="utf-8")
    artifact.unlink()
    assert docking_result["status"] == "success"


def test_receptor_analysis_failure_is_typed_and_docking_result_remains_valid(tmp_path):
    template = tmp_path / "ligand.sdf"
    metadata = tmp_path / "ligand.json"
    pose = tmp_path / "pose.pdbqt"
    write_template(template, "CCO")
    metadata.write_text(json.dumps({
        "artifact_schema_version": "moloptima-ligand-template-v1",
        "sdf_sha256": hashlib.sha256(template.read_bytes()).hexdigest(),
        "docking_job_id": "job-1",
    }), encoding="utf-8")
    pose.write_text(pose_model(1, -7.0, 0, 0, unique_cco_atoms()), encoding="utf-8")
    docking_result = {
        "status": "success", "pose_sha256": hashlib.sha256(pose.read_bytes()).hexdigest()
    }
    with pytest.raises(InteractionAnalysisInputError) as error:
        build_interaction_analysis_input(
            docking_result=docking_result,
            ligand_template_path=template,
            ligand_template_metadata_path=metadata,
            pose_path=pose,
            mode_number=1,
            prepared_receptor_pdbqt_path=tmp_path / "missing-receptor.pdbqt",
            meeko_input_pdb_path=tmp_path / "missing-input.pdb",
            receptor_preparation_provenance_path=tmp_path / "missing-provenance.json",
        )
    assert error.value.code == "unsupported_receptor_artifact"
    assert docking_result["status"] == "success"
