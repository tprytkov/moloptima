from __future__ import annotations

import copy
import hashlib
import json
import math
from pathlib import Path

import pytest
from rdkit import Chem
from rdkit.Chem import AllChem

from molecular_prioritization.interaction_analysis_input import MAPPING_SCHEMA_VERSION_V2
from molecular_prioritization.pharmacophore import (
    CANONICAL_FEATURE_MAPPING,
    PHARMACOPHORE_SCHEMA_VERSION,
    PharmacophoreError,
    PoseResolvedMolecule,
    _orientation_angle_degrees,
    build_pose_resolved_molecule,
    check_pharmacophore_compatibility,
    compare_pharmacophore_features,
    extract_pharmacophore_features,
    feature_definition_provenance,
)
from molecular_prioritization.vina_docking import _prepare_rdkit_ligand


def _resolved(tmp_path: Path, smiles: str, *, name: str = "ligand") -> PoseResolvedMolecule:
    molecule = Chem.AddHs(Chem.MolFromSmiles(smiles))
    parameters = AllChem.ETKDGv3()
    parameters.randomSeed = 12345
    assert AllChem.EmbedMolecule(molecule, parameters) == 0
    molecule = Chem.RemoveHs(molecule)
    for atom in molecule.GetAtoms():
        atom.SetIntProp("_MolOptimaTemplateAtomIndex", atom.GetIdx())
        atom.SetIntProp("_MolOptimaPoseAtomIndex", atom.GetIdx() + 10)
        atom.SetIntProp("_MolOptimaInputPdbqtAtomIndex", atom.GetIdx() + 20)
    template = tmp_path / f"{name}.sdf"
    pose = tmp_path / f"{name}.pdbqt"
    template.write_text(f"template-{name}", encoding="utf-8")
    pose.write_text(f"pose-{name}", encoding="utf-8")
    return PoseResolvedMolecule(
        molecule=molecule,
        template_path=template,
        pose_path=pose,
        template_sha256=hashlib.sha256(template.read_bytes()).hexdigest(),
        pose_sha256=hashlib.sha256(pose.read_bytes()).hexdigest(),
        source_pose_mode=1,
        mapping={"schema_version": MAPPING_SCHEMA_VERSION_V2, "positional_identity_assumed": False},
        pose_atoms=(),
        receptor_identity="receptor-1",
        receptor_sha256="receptor-sha-1",
    )


def _feature_set(features: list[dict], *, receptor: str = "receptor-1", fdef: str = "fdef") -> dict:
    return {
        "schema_version": PHARMACOPHORE_SCHEMA_VERSION,
        "status": "available" if features else "no_supported_features",
        "receptor_identity": receptor,
        "receptor_sha256": f"sha-{receptor}",
        "mapping_schema": MAPPING_SCHEMA_VERSION_V2,
        "feature_definition": {
            "feature_definition_sha256": fdef,
            "canonical_feature_mapping_sha256": "mapping",
        },
        "features": features,
    }


def _feature(feature_id: str, feature_class: str, xyz: tuple[float, float, float], *, normal=None) -> dict:
    return {
        "feature_id": feature_id,
        "canonical_class": feature_class,
        "template_atom_indices": [int(feature_id.strip("rc") or 0)],
        "pose_atom_indices": [int(feature_id.strip("rc") or 0)],
        "feature_center_xyz": list(xyz),
        "plane_normal": normal,
    }


@pytest.mark.parametrize(
    ("smiles", "expected"),
    [
        ("CCO", {"HBA", "HBD"}),
        ("c1ccccc1", {"AROMATIC", "HYDROPHOBIC"}),
        ("C[NH2+]C", {"HBD", "POSITIVE_IONIZABLE"}),
        ("CC(=O)[O-]", {"HBA", "NEGATIVE_IONIZABLE"}),
        ("CCCC", {"HYDROPHOBIC"}),
    ],
)
def test_installed_base_features_cover_canonical_classes(tmp_path, smiles, expected):
    result = extract_pharmacophore_features(_resolved(tmp_path, smiles, name=hashlib.md5(smiles.encode()).hexdigest()))
    assert expected <= {item["canonical_class"] for item in result["features"]}


def test_feature_definition_provenance_is_frozen():
    provenance = feature_definition_provenance()
    assert provenance["rdkit_version"] == "2026.03.3"
    assert provenance["feature_definition_file"] == "BaseFeatures.fdef"
    assert provenance["feature_definition_sha256"] == "87ab54bd717af50a78a710d23e7737a2cafc96e5293bf6257ecdda86b6da3f65"
    assert provenance["canonical_feature_mapping"] == dict(sorted(CANONICAL_FEATURE_MAPPING.items()))


def test_extraction_is_deterministic_and_directions_are_unavailable(tmp_path):
    resolved = _resolved(tmp_path, "CC(=O)NC1=CC=CC=C1")
    first = extract_pharmacophore_features(resolved)
    second = extract_pharmacophore_features(resolved)
    assert first["scientific_hash"] == second["scientific_hash"]
    assert first["features"] == second["features"]
    assert all(item["direction_status"] == "unavailable" for item in first["features"])
    assert all(item["direction_vector"] is None for item in first["features"])


def test_atom_order_invariance_preserves_mapped_chemical_identity(tmp_path):
    resolved = _resolved(tmp_path, "CC(=O)NC1=CC=CC=C1")
    baseline = extract_pharmacophore_features(resolved)
    order = list(reversed(range(resolved.molecule.GetNumAtoms())))
    renumbered = Chem.RenumberAtoms(resolved.molecule, order)
    reordered = PoseResolvedMolecule(**{**resolved.__dict__, "molecule": renumbered})
    candidate = extract_pharmacophore_features(reordered)
    keys = lambda result: [
        (item["feature_id"], item["canonical_class"], item["template_atom_indices"], item["feature_center_xyz"])
        for item in result["features"]
    ]
    assert keys(candidate) == keys(baseline)


def test_aromatic_centroid_and_normal_are_geometrically_valid(tmp_path):
    result = extract_pharmacophore_features(_resolved(tmp_path, "c1ccccc1"))
    aromatic = next(item for item in result["features"] if item["canonical_class"] == "AROMATIC")
    assert aromatic["geometry_type"] == "aromatic_plane"
    assert math.isclose(sum(value * value for value in aromatic["plane_normal"]), 1.0, abs_tol=1e-6)
    assert len(aromatic["template_atom_indices"]) == 6


def test_plane_normal_comparison_is_sign_invariant():
    assert _orientation_angle_degrees([0, 0, 1], [0, 0, -1]) == pytest.approx(0)
    assert _orientation_angle_degrees([0, 0, 1], [1, 0, 0]) == pytest.approx(90)


def test_duplicate_policy_removes_only_exact_equivalent_emissions(tmp_path, monkeypatch):
    resolved = _resolved(tmp_path, "CCO")
    from molecular_prioritization import pharmacophore as module

    real_factory = module.ChemicalFeatures.BuildFeatureFactory(str(Path(module.RDConfig.RDDataDir) / "BaseFeatures.fdef"))

    class DuplicateFactory:
        def GetFeaturesForMol(self, molecule):
            features = list(real_factory.GetFeaturesForMol(molecule))
            return features + [features[0]]

    monkeypatch.setattr(module.ChemicalFeatures, "BuildFeatureFactory", lambda _: DuplicateFactory())
    result = extract_pharmacophore_features(resolved)
    assert result["duplicates_removed"] == 1
    assert result["supported_raw_feature_count"] == result["canonical_feature_count"] + 1


def test_valid_molecule_with_no_supported_features_is_not_an_error(tmp_path):
    result = extract_pharmacophore_features(_resolved(tmp_path, "C"))
    assert result["status"] == "no_supported_features"
    assert result["canonical_feature_count"] == 0


def test_ionizable_class_and_actual_formal_charge_are_separate(tmp_path):
    positive = extract_pharmacophore_features(_resolved(tmp_path, "C[NH2+]C", name="positive"))
    negative = extract_pharmacophore_features(_resolved(tmp_path, "CC(=O)[O-]", name="negative"))
    pos_feature = next(x for x in positive["features"] if x["canonical_class"] == "POSITIVE_IONIZABLE")
    neg_feature = next(x for x in negative["features"] if x["canonical_class"] == "NEGATIVE_IONIZABLE")
    assert pos_feature["formal_charge"] == 1
    assert neg_feature["formal_charge"] == -1
    assert positive["protonation_status"] == negative["protonation_status"] == "not_scientifically_resolved"


def test_atom_center_feature_uses_selected_pose_coordinate(tmp_path):
    resolved = _resolved(tmp_path, "CCO")
    result = extract_pharmacophore_features(resolved)
    acceptor = next(item for item in result["features"] if item["canonical_class"] == "HBA")
    template_index = acceptor["template_atom_indices"][0]
    atom = next(
        atom for atom in resolved.molecule.GetAtoms()
        if atom.GetIntProp("_MolOptimaTemplateAtomIndex") == template_index
    )
    point = resolved.molecule.GetConformer().GetAtomPosition(atom.GetIdx())
    assert acceptor["feature_center_xyz"] == pytest.approx([point.x, point.y, point.z])


def test_self_comparison_is_exact(tmp_path):
    result = extract_pharmacophore_features(_resolved(tmp_path, "CC(=O)NC1=CC=CC=C1"))
    comparison = compare_pharmacophore_features(result, result, distance_threshold_angstrom=0)
    assert comparison["matched_feature_count"] == result["canonical_feature_count"]
    assert comparison["reference_coverage"] == comparison["comparison_coverage"] == 1
    assert comparison["pharmacophore_feature_overlap"] == 1
    assert comparison["matched_feature_center_rmsd_angstrom"] == 0
    assert all(match["distance_angstrom"] == 0 for match in comparison["matches"])


def test_one_to_one_assignment_is_global_and_order_independent():
    reference = _feature_set([
        _feature("r0", "HBA", (0, 0, 0)),
        _feature("r1", "HBA", (1, 0, 0)),
    ])
    comparison_features = [
        _feature("c0", "HBA", (0.4, 0, 0)),
        _feature("c1", "HBA", (-0.5, 0, 0)),
    ]
    first = compare_pharmacophore_features(reference, _feature_set(comparison_features), distance_threshold_angstrom=0.7)
    second = compare_pharmacophore_features(
        _feature_set(list(reversed(reference["features"]))),
        _feature_set(list(reversed(comparison_features))),
        distance_threshold_angstrom=0.7,
    )
    assert first["matched_feature_count"] == 2
    assert first == second


def test_feature_class_mismatch_does_not_match():
    result = compare_pharmacophore_features(
        _feature_set([_feature("r0", "HBA", (0, 0, 0))]),
        _feature_set([_feature("c0", "HBD", (0, 0, 0))]),
        distance_threshold_angstrom=1,
    )
    assert result["matched_feature_count"] == 0


def test_threshold_boundary_is_inclusive_and_single_match_is_not_rmsd():
    result = compare_pharmacophore_features(
        _feature_set([_feature("r0", "HBA", (0, 0, 0))]),
        _feature_set([_feature("c0", "HBA", (1, 0, 0))]),
        distance_threshold_angstrom=1,
    )
    assert result["matched_feature_count"] == 1
    assert result["single_match_distance_angstrom"] == 1
    assert result["matched_feature_center_rmsd_angstrom"] is None


def test_empty_semantics_are_explicit():
    both = compare_pharmacophore_features(_feature_set([]), _feature_set([]), distance_threshold_angstrom=1)
    assert both["status"] == "both_empty"
    assert both["pharmacophore_feature_overlap"] is None
    assert both["reference_coverage"] is both["comparison_coverage"] is None
    one = compare_pharmacophore_features(
        _feature_set([]), _feature_set([_feature("c0", "HBA", (0, 0, 0))]),
        distance_threshold_angstrom=1,
    )
    assert one["status"] == "one_empty"
    assert one["reference_coverage"] is None
    assert one["comparison_coverage"] == 0


@pytest.mark.parametrize(("field", "value"), [("receptor_identity", "other"), ("receptor_sha256", "other")])
def test_incompatible_receptor_frame_fails_closed(field, value):
    reference = _feature_set([])
    comparison = copy.deepcopy(reference)
    comparison[field] = value
    result = compare_pharmacophore_features(reference, comparison, distance_threshold_angstrom=1)
    assert result["status"] == "incompatible"
    assert field in result["compatibility"]["incompatible_fields"]


def test_incompatible_feature_definition_fails_closed():
    reference = _feature_set([])
    comparison = _feature_set([], fdef="different")
    compatibility = check_pharmacophore_compatibility(reference, comparison)
    assert compatibility["status"] == "incompatible"
    assert "feature_definition_sha256" in compatibility["incompatible_fields"]


def test_rmsd_coverage_overlap_and_feature_level_records():
    reference = _feature_set([
        _feature("r0", "HBA", (0, 0, 0)), _feature("r1", "HBD", (2, 0, 0)),
    ])
    comparison = _feature_set([
        _feature("c0", "HBA", (0.3, 0, 0)), _feature("c1", "HBD", (2.4, 0, 0)),
        _feature("c2", "AROMATIC", (9, 0, 0), normal=[0, 0, 1]),
    ])
    result = compare_pharmacophore_features(reference, comparison, distance_threshold_angstrom=0.5)
    assert result["matched_feature_count"] == 2
    assert result["reference_coverage"] == 1
    assert result["comparison_coverage"] == pytest.approx(2 / 3)
    assert result["pharmacophore_feature_overlap"] == pytest.approx(0.8)
    assert result["matched_feature_center_rmsd_angstrom"] == pytest.approx(math.sqrt((0.09 + 0.16) / 2))
    assert len(result["matches"]) == 2
    assert len(result["comparison_only_features"]) == 1


def test_aromatic_orientation_filter_is_sign_invariant():
    reference = _feature_set([_feature("r0", "AROMATIC", (0, 0, 0), normal=[0, 0, 1])])
    opposite = _feature_set([_feature("c0", "AROMATIC", (0, 0, 0), normal=[0, 0, -1])])
    tilted = _feature_set([_feature("c0", "AROMATIC", (0, 0, 0), normal=[1, 0, 0])])
    assert compare_pharmacophore_features(
        reference, opposite, distance_threshold_angstrom=1,
        aromatic_orientation_tolerance_degrees=15,
    )["matched_feature_count"] == 1
    assert compare_pharmacophore_features(
        reference, tilted, distance_threshold_angstrom=1,
        aromatic_orientation_tolerance_degrees=45,
    )["matched_feature_count"] == 0


def test_same_ligand_different_pose_keeps_inventory_but_changes_geometry(tmp_path):
    first = _resolved(tmp_path, "CC(=O)NC1=CC=CC=C1", name="first")
    second_molecule = Chem.Mol(first.molecule)
    conformer = second_molecule.GetConformer()
    for index in range(second_molecule.GetNumAtoms()):
        point = conformer.GetAtomPosition(index)
        conformer.SetAtomPosition(index, (point.x + 3, point.y, point.z))
    second = PoseResolvedMolecule(**{**first.__dict__, "molecule": second_molecule, "pose_path": tmp_path / "second.pdbqt", "pose_sha256": "second"})
    second.pose_path.write_text("second", encoding="utf-8")
    a = extract_pharmacophore_features(first)
    b = extract_pharmacophore_features(second)
    assert [(f["canonical_class"], f["template_atom_indices"]) for f in a["features"]] == [
        (f["canonical_class"], f["template_atom_indices"]) for f in b["features"]
    ]
    assert [f["feature_center_xyz"] for f in a["features"]] != [f["feature_center_xyz"] for f in b["features"]]
    assert compare_pharmacophore_features(a, b, distance_threshold_angstrom=2)["matched_feature_count"] == 0


def _pdbqt_atom(serial, name, x, y, z, atom_type):
    return f"ATOM  {serial:5d} {name:^4s} LIG A   1    {x:8.3f}{y:8.3f}{z:8.3f}  1.00  0.00     0.000 {atom_type}\n"


def _pdbqt_lines_from_template(template: Path):
    molecule = Chem.SDMolSupplier(str(template), removeHs=False)[0]
    conformer = molecule.GetConformer()
    lines = []
    for atom in molecule.GetAtoms():
        if atom.GetSymbol() == "H" and not any(n.GetSymbol() in {"N", "O", "S"} for n in atom.GetNeighbors()):
            continue
        point = conformer.GetAtomPosition(atom.GetIdx())
        atom_type = {"H": "HD", "O": "OA", "N": "NA", "S": "SA"}.get(
            atom.GetSymbol(), "A" if atom.GetIsAromatic() else atom.GetSymbol()
        )
        lines.append(_pdbqt_atom(len(lines) + 1, atom.GetSymbol(), point.x, point.y, point.z, atom_type))
    return lines


def test_pose_resolved_builder_uses_v2_mapping_and_pose_coordinates(tmp_path):
    template = tmp_path / "ligand.sdf"
    input_pdbqt = tmp_path / "ligand.pdbqt"
    pose = tmp_path / "pose.pdbqt"
    _prepare_rdkit_ligand("CCO", template, 2025)
    lines = _pdbqt_lines_from_template(template)
    input_pdbqt.write_text("ROOT\n" + "".join(lines) + "ENDROOT\n", encoding="utf-8")
    shifted = [line[:30] + f"{float(line[30:38]) + 5:8.3f}" + line[38:] for line in lines]
    pose.write_text("MODEL 1\nREMARK VINA RESULT: -5.0 0.0 0.0\n" + "".join(shifted) + "ENDMDL\n", encoding="utf-8")
    resolved = build_pose_resolved_molecule(
        template_path=template, input_pdbqt_path=input_pdbqt, pose_path=pose, mode_number=1,
        receptor_identity="receptor", receptor_sha256="receptor-sha",
    )
    assert resolved.mapping["schema_version"] == MAPPING_SCHEMA_VERSION_V2
    assert resolved.mapping["positional_identity_assumed"] is False
    assert resolved.molecule.GetConformer().GetAtomPosition(0).x == pytest.approx(
        Chem.SDMolSupplier(str(template), removeHs=False)[0].GetConformer().GetAtomPosition(0).x + 5,
        abs=0.001,
    )


def test_missing_and_invalid_inputs_have_typed_failures(tmp_path):
    missing = tmp_path / "missing"
    with pytest.raises(PharmacophoreError) as error:
        build_pose_resolved_molecule(
            template_path=missing, input_pdbqt_path=missing, pose_path=missing, mode_number=1,
            receptor_identity="r", receptor_sha256="s",
        )
    assert error.value.code == "template_missing"
    template = tmp_path / "bad.sdf"
    template.write_text("not an sdf", encoding="utf-8")
    pose = tmp_path / "pose.pdbqt"
    pose.write_text("x", encoding="utf-8")
    pdbqt = tmp_path / "input.pdbqt"
    pdbqt.write_text("x", encoding="utf-8")
    with pytest.raises(PharmacophoreError) as error:
        build_pose_resolved_molecule(
            template_path=template, input_pdbqt_path=pdbqt, pose_path=pose, mode_number=1,
            receptor_identity="r", receptor_sha256="s",
        )
    assert error.value.code == "chemical_graph_invalid"


def test_missing_pose_has_typed_failure(tmp_path):
    template = tmp_path / "ligand.sdf"
    input_pdbqt = tmp_path / "ligand.pdbqt"
    _prepare_rdkit_ligand("CCO", template, 2025)
    input_pdbqt.write_text("ROOT\n" + "".join(_pdbqt_lines_from_template(template)) + "ENDROOT\n", encoding="utf-8")
    with pytest.raises(PharmacophoreError) as error:
        build_pose_resolved_molecule(
            template_path=template, input_pdbqt_path=input_pdbqt,
            pose_path=tmp_path / "missing-pose.pdbqt", mode_number=1,
            receptor_identity="r", receptor_sha256="s",
        )
    assert error.value.code == "pose_missing"


def test_incompatible_direct_atom_mapping_has_typed_failure(tmp_path):
    template = tmp_path / "ligand.sdf"
    input_pdbqt = tmp_path / "ligand.pdbqt"
    pose = tmp_path / "pose.pdbqt"
    _prepare_rdkit_ligand("CCO", template, 2025)
    lines = _pdbqt_lines_from_template(template)
    input_pdbqt.write_text("not a PDBQT", encoding="utf-8")
    pose.write_text("MODEL 1\nREMARK VINA RESULT: -5.0 0.0 0.0\n" + "".join(lines) + "ENDMDL\n", encoding="utf-8")
    with pytest.raises(PharmacophoreError) as error:
        build_pose_resolved_molecule(
            template_path=template, input_pdbqt_path=input_pdbqt, pose_path=pose,
            mode_number=1, receptor_identity="r", receptor_sha256="s",
        )
    assert error.value.code == "mapping_incompatible"


def test_missing_feature_definition_is_typed(tmp_path):
    with pytest.raises(PharmacophoreError) as error:
        feature_definition_provenance(tmp_path / "missing.fdef")
    assert error.value.code == "feature_definition_unavailable"
