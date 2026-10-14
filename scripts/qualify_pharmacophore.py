"""Qualify pose-specific pharmacophores from authoritative fresh docking artifacts."""

from __future__ import annotations

import argparse
import csv
import json
import statistics
import sys
import time
from itertools import combinations
from pathlib import Path
from typing import Any

from rdkit import DataStructs

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from biopharma_intelligence.similarity import MORGAN_FP_SIZE, MORGAN_RADIUS, morgan_fingerprint
from molecular_prioritization.pharmacophore import (
    build_pose_resolved_molecule,
    compare_pharmacophore_features,
    extract_pharmacophore_features,
    feature_definition_provenance,
)
from molecular_prioritization.scaffolds import classify_scaffold_relationship, scaffold_identity


DISTANCE_THRESHOLDS = (0.75, 1.0, 1.5, 2.0)
ORIENTATION_THRESHOLDS = (15.0, 30.0, 45.0)


def _summary(values: list[float]) -> dict[str, float | None]:
    return {
        "median_seconds": statistics.median(values) if values else None,
        "minimum_seconds": min(values) if values else None,
        "maximum_seconds": max(values) if values else None,
    }


def _artifact(output_root: Path, relative: object) -> Path:
    path = (output_root / str(relative or "")).resolve()
    if output_root.resolve() not in path.parents or not path.is_file():
        raise RuntimeError(f"Authoritative docking artifact is missing: {relative}")
    return path


def _comparison_summary(
    reference_key: str,
    comparison_key: str,
    result: dict[str, Any],
    molecule_metadata: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    reference_molecule = reference_key.split("::", 1)[0]
    comparison_molecule = comparison_key.split("::", 1)[0]
    relationship = molecule_metadata[f"{reference_molecule}::{comparison_molecule}"]
    return {
        "reference": reference_key,
        "comparison": comparison_key,
        "distance_threshold_angstrom": result["distance_threshold_angstrom"],
        "aromatic_orientation_tolerance_degrees": result["aromatic_orientation_tolerance_degrees"],
        "status": result["status"],
        "reference_feature_count": result["reference_feature_count"],
        "comparison_feature_count": result["comparison_feature_count"],
        "matched_feature_count": result["matched_feature_count"],
        "reference_coverage": result["reference_coverage"],
        "comparison_coverage": result["comparison_coverage"],
        "pharmacophore_feature_overlap": result["pharmacophore_feature_overlap"],
        "matched_feature_center_rmsd_angstrom": result["matched_feature_center_rmsd_angstrom"],
        "single_match_distance_angstrom": result["single_match_distance_angstrom"],
        "mean_match_distance_angstrom": result["mean_match_distance_angstrom"],
        "max_match_distance_angstrom": result["max_match_distance_angstrom"],
        "matched_features_by_class": result["matched_features_by_class"],
        "reference_only_count": len(result["reference_only_features"]),
        "comparison_only_count": len(result["comparison_only_features"]),
        "morgan_tanimoto": relationship["morgan_tanimoto"],
        "scaffold_relationship": relationship["scaffold_relationship"],
        "exact_scaffold_match": relationship["exact_scaffold_match"],
        "generic_framework_match": relationship["generic_framework_match"],
        "matches": result["matches"],
    }


def qualify(docking_results: Path, output_root: Path) -> dict[str, Any]:
    results = json.loads(docking_results.read_text(encoding="utf-8"))
    if not isinstance(results, list) or len(results) < 5:
        raise RuntimeError("Qualification requires at least five docking results.")
    if any(item.get("status") != "success" for item in results):
        raise RuntimeError("All qualification docking results must be successful.")

    feature_sets: dict[str, dict[str, Any]] = {}
    reconstruction_times: list[float] = []
    extraction_times: list[float] = []
    geometry_times: list[float] = []
    hashing_times: list[float] = []
    molecules: dict[str, dict[str, Any]] = {}
    for result in results:
        molecule_id = str(result["molecule_id"])
        modes = sorted(int(item["mode"]) for item in result.get("modes") or [])
        if len(modes) < 3:
            raise RuntimeError(f"{molecule_id} has fewer than three explicit Vina modes.")
        ligand = result.get("ligand_template") or {}
        template = _artifact(output_root, ligand.get("artifact_path"))
        input_pdbqt = _artifact(output_root, ligand.get("input_pdbqt_artifact_path"))
        pose = _artifact(output_root, result.get("pose_path"))
        molecules[molecule_id] = {
            "molecule_id": molecule_id,
            "canonical_smiles": result["canonical_smiles"],
            "docking_affinities_kcal_mol": result["mode_affinities_kcal_mol"],
            "template_identity": template.name,
            "input_pdbqt_identity": input_pdbqt.name,
            "pose_identity": pose.name,
        }
        for mode in modes[:3]:
            started = time.perf_counter()
            resolved = build_pose_resolved_molecule(
                template_path=template,
                input_pdbqt_path=input_pdbqt,
                pose_path=pose,
                mode_number=mode,
                receptor_identity=str(result["receptor_id"]),
                receptor_sha256=str(result["prepared_receptor_sha256"]),
            )
            reconstruction_times.append(time.perf_counter() - started)
            features = extract_pharmacophore_features(resolved)
            timings = features.pop("performance_seconds")
            extraction_times.append(float(timings["feature_extraction"]))
            geometry_times.append(float(timings["geometry_generation"]))
            hashing_times.append(float(timings["scientific_hashing"]))
            feature_sets[f"{molecule_id}::mode-{mode}"] = features

    molecule_relationships: dict[str, dict[str, Any]] = {}
    for reference_id in molecules:
        for comparison_id in molecules:
            reference_smiles = molecules[reference_id]["canonical_smiles"]
            comparison_smiles = molecules[comparison_id]["canonical_smiles"]
            reference_fp = morgan_fingerprint(reference_smiles)
            comparison_fp = morgan_fingerprint(comparison_smiles)
            tanimoto = float(DataStructs.TanimotoSimilarity(reference_fp, comparison_fp))
            reference_scaffold = scaffold_identity(reference_smiles)
            comparison_scaffold = scaffold_identity(comparison_smiles)
            scaffold = classify_scaffold_relationship(reference_scaffold, comparison_scaffold)
            molecule_relationships[f"{reference_id}::{comparison_id}"] = {
                "morgan_tanimoto": tanimoto,
                "morgan_radius": MORGAN_RADIUS,
                "morgan_bits": MORGAN_FP_SIZE,
                "scaffold_relationship": scaffold["code"],
                "exact_scaffold_match": scaffold["exact_match"],
                "generic_framework_match": scaffold["generic_framework_match"],
            }

    self_results: list[dict[str, Any]] = []
    for key, features in feature_sets.items():
        result = compare_pharmacophore_features(features, features, distance_threshold_angstrom=0)
        self_results.append({"pose": key, **result})
        if not (
            result["matched_feature_count"] == features["canonical_feature_count"]
            and result["reference_coverage"] == 1.0
            and result["comparison_coverage"] == 1.0
            and result["pharmacophore_feature_overlap"] == 1.0
            and (result["matched_feature_center_rmsd_angstrom"] or 0.0) == 0.0
        ):
            raise RuntimeError(f"Self-comparison failed for {key}.")

    distance_results: list[dict[str, Any]] = []
    orientation_results: list[dict[str, Any]] = []
    matching_times: list[float] = []
    for reference_key, comparison_key in combinations(sorted(feature_sets), 2):
        for threshold in DISTANCE_THRESHOLDS:
            started = time.perf_counter()
            result = compare_pharmacophore_features(
                feature_sets[reference_key], feature_sets[comparison_key],
                distance_threshold_angstrom=threshold,
            )
            matching_times.append(time.perf_counter() - started)
            distance_results.append(_comparison_summary(
                reference_key, comparison_key, result, molecule_relationships
            ))
        for orientation in ORIENTATION_THRESHOLDS:
            result = compare_pharmacophore_features(
                feature_sets[reference_key], feature_sets[comparison_key],
                distance_threshold_angstrom=1.5,
                aromatic_orientation_tolerance_degrees=orientation,
            )
            orientation_results.append(_comparison_summary(
                reference_key, comparison_key, result, molecule_relationships
            ))

    feature_counts: dict[str, dict[str, int]] = {}
    for key, result in feature_sets.items():
        feature_counts[key] = result["feature_counts_by_class"]
    return {
        "qualification_schema_version": "moloptima-pharmacophore-qualification-v1",
        "provenance": feature_definition_provenance(),
        "dataset": {
            "source": "new temporary run through the current MolOptima production docking pipeline",
            "historical_artifacts_recreated": False,
            "ligand_count": len(molecules),
            "pose_count": len(feature_sets),
            "explicit_modes_per_ligand": 3,
            "molecules": list(molecules.values()),
        },
        "feature_sets": feature_sets,
        "feature_counts_by_pose": feature_counts,
        "self_comparisons": self_results,
        "distance_thresholds_angstrom": list(DISTANCE_THRESHOLDS),
        "aromatic_orientation_thresholds_degrees": list(ORIENTATION_THRESHOLDS),
        "distance_comparisons": distance_results,
        "aromatic_orientation_comparisons": orientation_results,
        "molecule_relationships": molecule_relationships,
        "performance": {
            "pose_resolved_reconstruction": _summary(reconstruction_times),
            "feature_extraction": _summary(extraction_times),
            "geometry_generation": _summary(geometry_times),
            "feature_matching": _summary(matching_times),
            "scientific_hashing": _summary(hashing_times),
        },
        "policies": {
            "ligand_realignment_used": False,
            "ranking_performed": False,
            "composite_score_created": False,
            "protonation_status": "not_scientifically_resolved",
        },
    }


def _write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    fields = [
        "reference", "comparison", "distance_threshold_angstrom",
        "aromatic_orientation_tolerance_degrees", "status", "reference_feature_count",
        "comparison_feature_count", "matched_feature_count", "reference_coverage",
        "comparison_coverage", "pharmacophore_feature_overlap",
        "matched_feature_center_rmsd_angstrom", "single_match_distance_angstrom",
        "mean_match_distance_angstrom", "max_match_distance_angstrom",
        "reference_only_count", "comparison_only_count", "morgan_tanimoto",
        "scaffold_relationship", "exact_scaffold_match", "generic_framework_match",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--docking-results", required=True, type=Path)
    parser.add_argument("--output-root", required=True, type=Path)
    parser.add_argument("--output-json", required=True, type=Path)
    parser.add_argument("--output-csv", required=True, type=Path)
    args = parser.parse_args()
    report = qualify(args.docking_results.resolve(), args.output_root.resolve())
    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    _write_csv(args.output_csv, report["distance_comparisons"] + report["aromatic_orientation_comparisons"])
    print(json.dumps({
        "ligand_count": report["dataset"]["ligand_count"],
        "pose_count": report["dataset"]["pose_count"],
        "distance_comparison_count": len(report["distance_comparisons"]),
        "orientation_comparison_count": len(report["aromatic_orientation_comparisons"]),
        "output_json": str(args.output_json.resolve()),
        "output_csv": str(args.output_csv.resolve()),
    }, indent=2))


if __name__ == "__main__":
    main()
