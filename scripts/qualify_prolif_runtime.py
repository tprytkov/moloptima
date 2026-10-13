"""Run the focused, opt-in ProLIF qualification set against immutable artifacts."""

from __future__ import annotations

import argparse
import hashlib
import json
import tempfile
import time
from pathlib import Path

from rdkit import Chem, rdBase

from molecular_prioritization.interaction_analysis_input import build_interaction_analysis_input
from molecular_prioritization.interaction_fingerprints import (
    analyze_docking_pose_interactions,
    compare_interaction_fingerprints,
)


LIGANDS = ("gen_1349", "gen_1", "gen_1122", "gen_3389", "gen_1587")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact-root", type=Path, required=True)
    parser.add_argument("--receptor-dir", type=Path, required=True)
    parser.add_argument("--runtime-python", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--input-pdbqt-root", type=Path)
    parser.add_argument("--ligand", choices=LIGANDS)
    parser.add_argument("--mode", type=int, choices=(1, 2, 3))
    args = parser.parse_args()
    receptor_pdbqt = args.receptor_dir / "prepared_receptor.pdbqt"
    topology = args.receptor_dir / "meeko_input.pdb"
    provenance = args.receptor_dir / "receptor_preparation.json"
    records = []
    fingerprints: dict[tuple[str, int], dict[str, object]] = {}
    with tempfile.TemporaryDirectory(prefix="moloptima-prolif-qualification-") as temporary_name:
        temporary = Path(temporary_name)
        cache = temporary / "cache"
        selected_ligands = (args.ligand,) if args.ligand else LIGANDS
        selected_modes = (args.mode,) if args.mode else (1, 2, 3)
        for ligand in selected_ligands:
            template = args.artifact_root / f"{ligand}_prepared_template.sdf"
            mol = next(molecule for molecule in Chem.SDMolSupplier(str(template), removeHs=False) if molecule)
            canonical = Chem.MolToSmiles(Chem.RemoveHs(mol), canonical=True, isomericSmiles=True)
            metadata = temporary / f"{ligand}.json"
            metadata.write_text(json.dumps({
                "artifact_schema_version": "moloptima-ligand-template-v1",
                "artifact_id": ligand,
                "molecule_id": ligand,
                "canonical_isomeric_smiles": canonical,
                "sdf_sha256": sha256(template),
                "rdkit_version": rdBase.rdkitVersion,
                "conformer_generation_method": "qualified_existing_artifact",
                "conformer_seed": 20240517,
                "optimization_method": "qualified_existing_artifact",
                "explicit_hydrogen_policy": "all_hydrogens_explicit_before_openbabel",
                "docking_job_id": "9IIR-qualified",
            }), encoding="utf-8")
            for mode in selected_modes:
                print(f"qualifying {ligand} mode {mode}", flush=True)
                pose = args.artifact_root / f"{ligand}_mode_{mode}.pdbqt"
                contract = build_interaction_analysis_input(
                    docking_result={
                        "receptor_id": "9IIR-qualified",
                        "pose_sha256": sha256(pose),
                        "obabel_version": "qualified-existing-artifact",
                        "vina_version": "qualified-existing-artifact",
                    },
                    ligand_template_path=template,
                    ligand_template_metadata_path=metadata,
                    pose_path=pose,
                    mode_number=mode,
                    prepared_receptor_pdbqt_path=receptor_pdbqt,
                    meeko_input_pdb_path=topology,
                    receptor_preparation_provenance_path=provenance,
                    ligand_input_pdbqt_path=(
                        args.input_pdbqt_root / f"{ligand}_input.pdbqt"
                        if args.input_pdbqt_root else None
                    ),
                )
                try:
                    result = analyze_docking_pose_interactions(
                        contract,
                        ligand_template_path=template,
                        receptor_topology_path=topology,
                        prepared_receptor_path=receptor_pdbqt,
                        ligand_input_pdbqt_path=(
                            args.input_pdbqt_root / f"{ligand}_input.pdbqt"
                            if args.input_pdbqt_root else None
                        ),
                        cache_root=cache,
                        python_override=args.runtime_python,
                    )
                except Exception as exc:
                    raise RuntimeError(f"qualification failed for {ligand} mode {mode}: {exc}") from exc
                cached = analyze_docking_pose_interactions(
                    contract,
                    ligand_template_path=template,
                    receptor_topology_path=topology,
                    prepared_receptor_path=receptor_pdbqt,
                    ligand_input_pdbqt_path=(
                        args.input_pdbqt_root / f"{ligand}_input.pdbqt"
                        if args.input_pdbqt_root else None
                    ),
                    cache_root=cache,
                    python_override=args.runtime_python,
                )
                if (
                    result["fingerprint_sha256"] != cached["fingerprint_sha256"]
                    or result["raw_interaction_records"] != cached["raw_interaction_records"]
                    or result["canonical_tokens"] != cached["canonical_tokens"]
                    or cached["cache_status"] != "hit"
                ):
                    raise RuntimeError("deterministic cache qualification failed")
                fingerprints[(ligand, mode)] = result
                records.append({
                    "ligand": ligand,
                    "mode": mode,
                    "vina_affinity_kcal_mol": result["pose"]["vina_affinity_kcal_mol"],
                    "raw_interaction_count": result["raw_interaction_count"],
                    "unique_token_count": result["unique_token_count"],
                    "interaction_classes": sorted({item["interaction_type"] for item in result["raw_interaction_records"]}),
                    "residues": sorted({
                        f'{item["receptor"]["chain"]}:{item["receptor"]["residue_name"]}:{item["receptor"]["residue_number"]}'
                        for item in result["raw_interaction_records"]
                    }),
                    "fingerprint_sha256": result["fingerprint_sha256"],
                    "cache_status": result["cache_status"],
                    "cached_cache_status": cached["cache_status"],
                    "cache_key": result["cache_key"],
                    "performance_seconds": result["performance_seconds"],
                    "cached_retrieval_seconds": cached["performance_seconds"]["cached_retrieval"],
                    "cross_rdkit_validation": result["cross_rdkit_validation"],
                    "mapping_schema_version": result["mapping_schema_version"],
                    "runtime_provenance": result["runtime_provenance"],
                    "raw_interaction_records": result["raw_interaction_records"],
                    "canonical_tokens": result["canonical_tokens"],
                    "scientific_limitations": result["scientific_limitations"],
                })
        comparison_started = time.perf_counter()
        cross_mode = {
            f"gen_1122:{left}-{right}": compare_interaction_fingerprints(
                fingerprints[("gen_1122", left)], fingerprints[("gen_1122", right)]
            ) for left, right in ((1, 2), (1, 3), (2, 3))
            if ("gen_1122", left) in fingerprints and ("gen_1122", right) in fingerprints
        }
        cross_ligand = {
            f"{left}-{right}:mode1": compare_interaction_fingerprints(
                fingerprints[(left, 1)], fingerprints[(right, 1)]
            ) for left, right in (("gen_1349", "gen_1"), ("gen_3389", "gen_1587"), ("gen_1122", "gen_3389"))
            if (left, 1) in fingerprints and (right, 1) in fingerprints
        }
        comparison_total = time.perf_counter() - comparison_started
    payload = {
        "schema_version": "moloptima-prolif-qualification-report-v1",
        "runtime_python": str(args.runtime_python),
        "records": records,
        "cross_mode_similarity": cross_mode,
        "cross_ligand_similarity": cross_ligand,
        "comparison_total_seconds": comparison_total,
        "determinism_status": "passed",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "pose_count": len(records)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
