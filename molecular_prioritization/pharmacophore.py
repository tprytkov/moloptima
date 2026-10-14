"""Deterministic pose-specific ligand pharmacophores in a receptor coordinate frame.

Chemistry always comes from the immutable RDKit SDF template. Coordinates are
propagated only through the direct v2 template -> input PDBQT -> Vina mapping.
No ligand alignment, PDBQT bond inference, or nearest-atom matching occurs here.
"""

from __future__ import annotations

import hashlib
import json
import math
import platform
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

import numpy as np
from rdkit import Chem, RDConfig, rdBase
from rdkit.Chem import ChemicalFeatures
from scipy.optimize import linear_sum_assignment

from molecular_prioritization.interaction_analysis_input import (
    MAPPING_SCHEMA_VERSION_V2,
    InteractionAnalysisInputError,
    extract_vina_pose_model,
    resolve_template_pose_mapping_v2,
)


PHARMACOPHORE_SCHEMA_VERSION = "moloptima-pose-pharmacophore-v1"
GEOMETRY_POLICY_VERSION = "selected-pose-atom-centroid-v1"
MATCHING_POLICY_VERSION = "class-constrained-linear-assignment-v1"
PROTONATION_STATUS = "not_scientifically_resolved"

CANONICAL_FEATURE_MAPPING = {
    "Acceptor": "HBA",
    "Donor": "HBD",
    "Aromatic": "AROMATIC",
    "Hydrophobe": "HYDROPHOBIC",
    "LumpedHydrophobe": "HYDROPHOBIC",
    "PosIonizable": "POSITIVE_IONIZABLE",
    "NegIonizable": "NEGATIVE_IONIZABLE",
}
SUPPORTED_FEATURE_CLASSES = tuple(sorted(set(CANONICAL_FEATURE_MAPPING.values())))
IGNORED_RDKIT_FAMILIES = ("ZnBinder",)


class PharmacophoreError(RuntimeError):
    """Typed qualification failure; never reinterpret it as an empty feature set."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class PoseResolvedMolecule:
    molecule: Chem.Mol
    template_path: Path
    pose_path: Path
    template_sha256: str
    pose_sha256: str
    source_pose_mode: int
    mapping: Mapping[str, Any]
    pose_atoms: tuple[Mapping[str, Any], ...]
    receptor_identity: str
    receptor_sha256: str
    reconstruction_seconds: float | None = None


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _stable_hash(payload: object) -> str:
    content = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def feature_definition_provenance(path: str | Path | None = None) -> dict[str, Any]:
    feature_path = Path(path) if path is not None else Path(RDConfig.RDDataDir) / "BaseFeatures.fdef"
    if not feature_path.is_file():
        raise PharmacophoreError(
            "feature_definition_unavailable", "RDKit pharmacophore feature definitions are unavailable."
        )
    try:
        ChemicalFeatures.BuildFeatureFactory(str(feature_path))
        content = feature_path.read_bytes()
    except Exception as exc:
        raise PharmacophoreError(
            "feature_definition_unavailable", "RDKit pharmacophore feature definitions are invalid."
        ) from exc
    mapping = dict(sorted(CANONICAL_FEATURE_MAPPING.items()))
    return {
        "python_version": platform.python_version(),
        "rdkit_version": rdBase.rdkitVersion,
        "feature_definition_file": feature_path.name,
        "feature_definition_sha256": hashlib.sha256(content).hexdigest(),
        "canonical_feature_mapping": mapping,
        "canonical_feature_mapping_sha256": _stable_hash(mapping),
        "ignored_rdkit_families": list(IGNORED_RDKIT_FAMILIES),
        "geometry_policy": GEOMETRY_POLICY_VERSION,
        "pharmacophore_schema_version": PHARMACOPHORE_SCHEMA_VERSION,
        "extraction_configuration": {
            "feature_centers": "unweighted centroid of participating selected-pose atom coordinates",
            "hba_direction": "unavailable",
            "hbd_direction": "unavailable",
            "aromatic_normal": "least-squares plane; sign has no meaning",
            "duplicate_policy": "same canonical class, RDKit family/type, and template atom set",
        },
    }


def build_pose_resolved_molecule(
    *,
    template_path: str | Path,
    input_pdbqt_path: str | Path,
    pose_path: str | Path,
    mode_number: int,
    receptor_identity: str,
    receptor_sha256: str,
) -> PoseResolvedMolecule:
    """Combine authoritative template chemistry with one selected Vina MODEL."""

    template = Path(template_path)
    pose = Path(pose_path)
    input_pdbqt = Path(input_pdbqt_path)
    if not template.is_file():
        raise PharmacophoreError("template_missing", "Authoritative ligand template is missing.")
    if not pose.is_file():
        raise PharmacophoreError("pose_missing", "Authoritative Vina pose artifact is missing.")
    if not input_pdbqt.is_file():
        raise PharmacophoreError("mapping_incompatible", "Authoritative pre-docking PDBQT is missing.")
    if not str(receptor_identity).strip() or not str(receptor_sha256).strip():
        raise PharmacophoreError("mapping_incompatible", "Receptor identity and artifact SHA-256 are required.")

    try:
        supplier = Chem.SDMolSupplier(str(template), removeHs=False, sanitize=True)
        template_molecule = supplier[0] if len(supplier) else None
    except Exception as exc:
        raise PharmacophoreError("chemical_graph_invalid", "Ligand template could not be parsed.") from exc
    if template_molecule is None or template_molecule.GetNumConformers() != 1:
        raise PharmacophoreError(
            "chemical_graph_invalid", "Ligand template must contain one valid three-dimensional molecule."
        )

    try:
        extracted = extract_vina_pose_model(pose, mode_number)
        mapping, _ = resolve_template_pose_mapping_v2(template, input_pdbqt, extracted)
    except InteractionAnalysisInputError as exc:
        code = "pose_missing" if exc.code == "pose_parse_failed" and not pose.is_file() else "mapping_incompatible"
        raise PharmacophoreError(code, str(exc)) from exc
    if mapping.get("schema_version") != MAPPING_SCHEMA_VERSION_V2:
        raise PharmacophoreError("mapping_incompatible", "Direct v2 atom mapping is required.")
    if mapping.get("positional_identity_assumed") is not False:
        raise PharmacophoreError("mapping_incompatible", "Positional atom identity is not permitted.")

    for atom in template_molecule.GetAtoms():
        atom.SetIntProp("_MolOptimaTemplateAtomIndex", atom.GetIdx())
    try:
        molecule = Chem.RemoveHs(template_molecule, sanitize=True)
        Chem.SanitizeMol(molecule)
    except Exception as exc:
        raise PharmacophoreError("chemical_graph_invalid", "Authoritative template chemistry is invalid.") from exc

    entries = {int(item["template_atom_index"]): item for item in mapping.get("entries", [])}
    pose_atoms = tuple(extracted.get("atoms") or ())
    conformer = Chem.Conformer(molecule.GetNumAtoms())
    for atom in molecule.GetAtoms():
        if not atom.HasProp("_MolOptimaTemplateAtomIndex"):
            raise PharmacophoreError("mapping_incompatible", "Template atom identity was not preserved.")
        template_index = atom.GetIntProp("_MolOptimaTemplateAtomIndex")
        entry = entries.get(template_index)
        if entry is None:
            raise PharmacophoreError("mapping_incompatible", "A template heavy atom has no direct pose mapping.")
        pose_index = int(entry["pose_pdbqt_atom_index"])
        try:
            coordinates = tuple(float(value) for value in pose_atoms[pose_index]["coordinates"])
        except (IndexError, KeyError, TypeError, ValueError) as exc:
            raise PharmacophoreError("geometry_unavailable", "Mapped pose coordinates are unavailable.") from exc
        if len(coordinates) != 3 or not all(math.isfinite(value) for value in coordinates):
            raise PharmacophoreError("geometry_unavailable", "Mapped pose coordinates are non-finite.")
        atom.SetIntProp("_MolOptimaPoseAtomIndex", pose_index)
        atom.SetIntProp("_MolOptimaInputPdbqtAtomIndex", int(entry["input_pdbqt_atom_index"]))
        conformer.SetAtomPosition(atom.GetIdx(), coordinates)
    molecule.RemoveAllConformers()
    molecule.AddConformer(conformer, assignId=True)
    return PoseResolvedMolecule(
        molecule=molecule,
        template_path=template.resolve(),
        pose_path=pose.resolve(),
        template_sha256=_sha256(template),
        pose_sha256=_sha256(pose),
        source_pose_mode=int(mode_number),
        mapping=mapping,
        pose_atoms=pose_atoms,
        receptor_identity=str(receptor_identity),
        receptor_sha256=str(receptor_sha256),
    )


def _canonical_plane_normal(points: np.ndarray) -> list[float] | None:
    if len(points) < 3:
        return None
    centered = points - points.mean(axis=0)
    if np.linalg.matrix_rank(centered, tol=1e-8) < 2:
        return None
    _, _, vh = np.linalg.svd(centered, full_matrices=False)
    normal = vh[-1]
    norm = float(np.linalg.norm(normal))
    if not math.isfinite(norm) or norm <= 1e-12:
        return None
    normal = normal / norm
    pivot = int(np.argmax(np.abs(normal)))
    if normal[pivot] < 0:
        normal = -normal
    return [round(float(value), 8) for value in normal]


def extract_pharmacophore_features(
    resolved: PoseResolvedMolecule,
    *,
    feature_definition_path: str | Path | None = None,
) -> dict[str, Any]:
    """Extract canonical RDKit features without changing authoritative chemistry."""

    provenance = feature_definition_provenance(feature_definition_path)
    feature_path = (
        Path(feature_definition_path)
        if feature_definition_path is not None
        else Path(RDConfig.RDDataDir) / "BaseFeatures.fdef"
    )
    extraction_started = time.perf_counter()
    try:
        factory = ChemicalFeatures.BuildFeatureFactory(str(feature_path))
        raw = list(factory.GetFeaturesForMol(resolved.molecule))
    except Exception as exc:
        raise PharmacophoreError("feature_extraction_failed", "RDKit feature extraction failed.") from exc

    feature_extraction_seconds = time.perf_counter() - extraction_started
    geometry_started = time.perf_counter()
    conformer = resolved.molecule.GetConformer()
    candidates: list[dict[str, Any]] = []
    ignored_counts: dict[str, int] = {}
    for feature in raw:
        family = str(feature.GetFamily())
        canonical_class = CANONICAL_FEATURE_MAPPING.get(family)
        if canonical_class is None:
            ignored_counts[family] = ignored_counts.get(family, 0) + 1
            continue
        atom_ids = tuple(int(value) for value in feature.GetAtomIds())
        if not atom_ids:
            raise PharmacophoreError("geometry_unavailable", "RDKit emitted a feature without atoms.")
        atoms = [resolved.molecule.GetAtomWithIdx(index) for index in atom_ids]
        try:
            template_indices = tuple(sorted(atom.GetIntProp("_MolOptimaTemplateAtomIndex") for atom in atoms))
            pose_indices = tuple(sorted(atom.GetIntProp("_MolOptimaPoseAtomIndex") for atom in atoms))
            input_indices = tuple(
                sorted(atom.GetIntProp("_MolOptimaInputPdbqtAtomIndex") for atom in atoms)
            )
        except (KeyError, RuntimeError) as exc:
            raise PharmacophoreError("mapping_incompatible", "Feature atoms lack direct pose provenance.") from exc
        points = np.asarray([
            tuple(float(value) for value in conformer.GetAtomPosition(index)) for index in atom_ids
        ])
        if points.shape != (len(atom_ids), 3) or not np.isfinite(points).all():
            raise PharmacophoreError("geometry_unavailable", "Feature coordinates are unavailable.")
        center = [round(float(value), 8) for value in points.mean(axis=0)]
        rdkit_type = str(feature.GetType())
        identity = {
            "canonical_class": canonical_class,
            "rdkit_family": family,
            "rdkit_type": rdkit_type,
            "template_atom_indices": list(template_indices),
        }
        normal = _canonical_plane_normal(points) if canonical_class == "AROMATIC" else None
        candidates.append({
            "schema_version": PHARMACOPHORE_SCHEMA_VERSION,
            "feature_id": f"phf_{_stable_hash(identity)[:20]}",
            **identity,
            "pose_atom_indices": list(pose_indices),
            "input_pdbqt_atom_indices": list(input_indices),
            "feature_center_xyz": center,
            "geometry_type": "aromatic_plane" if normal is not None else "atom_centroid",
            "direction_status": "unavailable",
            "direction_vector": None,
            "plane_normal": normal,
            "formal_charge": int(sum(atom.GetFormalCharge() for atom in atoms)),
            "source_pose_mode": resolved.source_pose_mode,
            "template_sha256": resolved.template_sha256,
            "pose_sha256": resolved.pose_sha256,
            "mapping_schema": resolved.mapping["schema_version"],
            "feature_definition_sha256": provenance["feature_definition_sha256"],
            "rdkit_version": rdBase.rdkitVersion,
            "protonation_status": PROTONATION_STATUS,
        })

    candidates.sort(key=lambda item: (
        item["canonical_class"], item["template_atom_indices"], item["rdkit_family"],
        item["rdkit_type"], item["feature_id"],
    ))
    features: list[dict[str, Any]] = []
    seen: set[tuple[object, ...]] = set()
    for candidate in candidates:
        key = (
            candidate["canonical_class"], candidate["rdkit_family"], candidate["rdkit_type"],
            tuple(candidate["template_atom_indices"]),
        )
        if key not in seen:
            seen.add(key)
            features.append(candidate)

    geometry_generation_seconds = time.perf_counter() - geometry_started
    hashing_started = time.perf_counter()
    scientific_identity = {
        "schema_version": PHARMACOPHORE_SCHEMA_VERSION,
        "template_sha256": resolved.template_sha256,
        "pose_sha256": resolved.pose_sha256,
        "source_pose_mode": resolved.source_pose_mode,
        "mapping_schema": resolved.mapping["schema_version"],
        "rdkit_version": rdBase.rdkitVersion,
        "feature_definition_sha256": provenance["feature_definition_sha256"],
        "canonical_feature_mapping": provenance["canonical_feature_mapping"],
        "geometry_policy": GEOMETRY_POLICY_VERSION,
        "features": features,
    }
    counts_by_class = {
        class_name: sum(feature["canonical_class"] == class_name for feature in features)
        for class_name in SUPPORTED_FEATURE_CLASSES
    }
    scientific_hash = _stable_hash(scientific_identity)
    hashing_seconds = time.perf_counter() - hashing_started
    return {
        "schema_version": PHARMACOPHORE_SCHEMA_VERSION,
        "status": "available" if features else "no_supported_features",
        "receptor_identity": resolved.receptor_identity,
        "receptor_sha256": resolved.receptor_sha256,
        "template_identity": resolved.template_path.name,
        "template_sha256": resolved.template_sha256,
        "pose_identity": resolved.pose_path.name,
        "pose_sha256": resolved.pose_sha256,
        "source_pose_mode": resolved.source_pose_mode,
        "mapping_schema": resolved.mapping["schema_version"],
        "mapping_positional_identity_assumed": resolved.mapping["positional_identity_assumed"],
        "feature_definition": provenance,
        "protonation_status": PROTONATION_STATUS,
        "raw_feature_count": len(raw),
        "supported_raw_feature_count": len(candidates),
        "canonical_feature_count": len(features),
        "duplicates_removed": len(candidates) - len(features),
        "ignored_feature_counts": dict(sorted(ignored_counts.items())),
        "feature_counts_by_class": counts_by_class,
        "features": features,
        "scientific_hash": scientific_hash,
        "performance_seconds": {
            "feature_extraction": feature_extraction_seconds,
            "geometry_generation": geometry_generation_seconds,
            "scientific_hashing": hashing_seconds,
        },
    }


def check_pharmacophore_compatibility(
    reference: Mapping[str, Any], comparison: Mapping[str, Any]
) -> dict[str, Any]:
    failures: list[str] = []
    for field in ("schema_version", "receptor_identity", "receptor_sha256", "mapping_schema"):
        if reference.get(field) != comparison.get(field):
            failures.append(field)
    reference_definition = reference.get("feature_definition") or {}
    comparison_definition = comparison.get("feature_definition") or {}
    for field in ("feature_definition_sha256", "canonical_feature_mapping_sha256"):
        if reference_definition.get(field) != comparison_definition.get(field):
            failures.append(field)
    valid_states = {"available", "no_supported_features"}
    if reference.get("status") not in valid_states:
        failures.append("reference_status")
    if comparison.get("status") not in valid_states:
        failures.append("comparison_status")
    return {
        "status": "compatible" if not failures else "incompatible",
        "incompatible_fields": failures,
        "common_receptor_coordinate_frame": not any(
            field in failures for field in ("receptor_identity", "receptor_sha256")
        ),
        "ligand_realignment_used": False,
    }


def _orientation_angle_degrees(first: Sequence[float], second: Sequence[float]) -> float:
    first_array = np.asarray(first, dtype=float)
    second_array = np.asarray(second, dtype=float)
    denominator = float(np.linalg.norm(first_array) * np.linalg.norm(second_array))
    if denominator <= 0 or not math.isfinite(denominator):
        return math.nan
    cosine = min(1.0, max(0.0, abs(float(np.dot(first_array, second_array))) / denominator))
    return math.degrees(math.acos(cosine))


def _assign_class_features(
    reference: list[Mapping[str, Any]],
    comparison: list[Mapping[str, Any]],
    distance_threshold: float,
    aromatic_orientation_tolerance_degrees: float | None,
) -> list[tuple[Mapping[str, Any], Mapping[str, Any], float, float | None]]:
    if not reference or not comparison:
        return []
    reference = sorted(reference, key=lambda item: str(item["feature_id"]))
    comparison = sorted(comparison, key=lambda item: str(item["feature_id"]))
    n_reference, n_comparison = len(reference), len(comparison)
    size = n_reference + n_comparison
    forbidden = 1_000_000.0
    unmatched = float(distance_threshold) + 1.0
    cost = np.full((size, size), forbidden, dtype=float)
    metadata: dict[tuple[int, int], tuple[float, float | None]] = {}
    for row, ref in enumerate(reference):
        for column, comp in enumerate(comparison):
            distance = math.dist(ref["feature_center_xyz"], comp["feature_center_xyz"])
            angle: float | None = None
            allowed = distance <= distance_threshold + 1e-12
            if allowed and aromatic_orientation_tolerance_degrees is not None:
                if ref["canonical_class"] == "AROMATIC":
                    if ref.get("plane_normal") is None or comp.get("plane_normal") is None:
                        allowed = False
                    else:
                        angle = _orientation_angle_degrees(ref["plane_normal"], comp["plane_normal"])
                        allowed = math.isfinite(angle) and angle <= aromatic_orientation_tolerance_degrees + 1e-12
            if allowed:
                cost[row, column] = distance + (row * (n_comparison + 1) + column) * 1e-12
                metadata[(row, column)] = (distance, angle)
        cost[row, n_comparison + row] = unmatched
    for column in range(n_comparison):
        cost[n_reference + column, column] = unmatched
    cost[n_reference:, n_comparison:] = 0.0
    rows, columns = linear_sum_assignment(cost)
    matches = []
    for row, column in zip(rows, columns, strict=True):
        if row < n_reference and column < n_comparison and (row, column) in metadata:
            distance, angle = metadata[(row, column)]
            matches.append((reference[row], comparison[column], distance, angle))
    return sorted(matches, key=lambda item: (item[0]["feature_id"], item[1]["feature_id"]))


def compare_pharmacophore_features(
    reference: Mapping[str, Any],
    comparison: Mapping[str, Any],
    *,
    distance_threshold_angstrom: float,
    aromatic_orientation_tolerance_degrees: float | None = None,
) -> dict[str, Any]:
    """Compare features directly in a verified common receptor frame."""

    threshold = float(distance_threshold_angstrom)
    if not math.isfinite(threshold) or threshold < 0:
        raise ValueError("distance_threshold_angstrom must be finite and non-negative")
    if aromatic_orientation_tolerance_degrees is not None:
        tolerance = float(aromatic_orientation_tolerance_degrees)
        if not math.isfinite(tolerance) or not 0 <= tolerance <= 90:
            raise ValueError("aromatic orientation tolerance must be between 0 and 90 degrees")
    else:
        tolerance = None
    compatibility = check_pharmacophore_compatibility(reference, comparison)
    if compatibility["status"] != "compatible":
        return {
            "status": "incompatible", "compatibility": compatibility,
            "distance_threshold_angstrom": threshold,
            "aromatic_orientation_tolerance_degrees": tolerance,
            "ligand_realignment_used": False,
        }

    reference_features = list(reference.get("features") or [])
    comparison_features = list(comparison.get("features") or [])
    matches = []
    for class_name in SUPPORTED_FEATURE_CLASSES:
        matches.extend(_assign_class_features(
            [item for item in reference_features if item["canonical_class"] == class_name],
            [item for item in comparison_features if item["canonical_class"] == class_name],
            threshold,
            tolerance,
        ))
    matches.sort(key=lambda item: (item[0]["canonical_class"], item[0]["feature_id"], item[1]["feature_id"]))
    matched_reference_ids = {str(item[0]["feature_id"]) for item in matches}
    matched_comparison_ids = {str(item[1]["feature_id"]) for item in matches}
    distances = [float(item[2]) for item in matches]
    match_records = [{
        "reference_feature_id": ref["feature_id"],
        "comparison_feature_id": comp["feature_id"],
        "canonical_class": ref["canonical_class"],
        "reference_template_atom_indices": ref["template_atom_indices"],
        "comparison_template_atom_indices": comp["template_atom_indices"],
        "reference_pose_atom_indices": ref["pose_atom_indices"],
        "comparison_pose_atom_indices": comp["pose_atom_indices"],
        "reference_xyz": ref["feature_center_xyz"],
        "comparison_xyz": comp["feature_center_xyz"],
        "distance_angstrom": round(distance, 8),
        "aromatic_orientation_angle_degrees": None if angle is None else round(angle, 8),
        "distance_threshold_angstrom": threshold,
        "aromatic_orientation_tolerance_degrees": tolerance,
    } for ref, comp, distance, angle in matches]
    reference_count = len(reference_features)
    comparison_count = len(comparison_features)
    matched_count = len(matches)
    if reference_count == 0 and comparison_count == 0:
        status = "both_empty"
    elif reference_count == 0 or comparison_count == 0:
        status = "one_empty"
    else:
        status = "available"
    counts_by_class = {
        class_name: sum(item[0]["canonical_class"] == class_name for item in matches)
        for class_name in SUPPORTED_FEATURE_CLASSES
    }
    return {
        "status": status,
        "compatibility": compatibility,
        "reference_feature_count": reference_count,
        "comparison_feature_count": comparison_count,
        "matched_feature_count": matched_count,
        "reference_coverage": None if reference_count == 0 else matched_count / reference_count,
        "comparison_coverage": None if comparison_count == 0 else matched_count / comparison_count,
        "pharmacophore_feature_overlap": (
            None if reference_count + comparison_count == 0
            else 2 * matched_count / (reference_count + comparison_count)
        ),
        "matched_feature_center_rmsd_angstrom": (
            math.sqrt(sum(value * value for value in distances) / matched_count)
            if matched_count >= 2 else None
        ),
        "single_match_distance_angstrom": distances[0] if matched_count == 1 else None,
        "mean_match_distance_angstrom": sum(distances) / matched_count if distances else None,
        "max_match_distance_angstrom": max(distances) if distances else None,
        "matched_features_by_class": counts_by_class,
        "reference_only_features": [
            item for item in reference_features if str(item["feature_id"]) not in matched_reference_ids
        ],
        "comparison_only_features": [
            item for item in comparison_features if str(item["feature_id"]) not in matched_comparison_ids
        ],
        "matches": match_records,
        "distance_threshold_angstrom": threshold,
        "aromatic_orientation_tolerance_degrees": tolerance,
        "matching_policy": MATCHING_POLICY_VERSION,
        "ligand_realignment_used": False,
    }
