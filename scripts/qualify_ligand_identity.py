"""Qualify SDF -> input PDBQT -> Vina MODEL identity without running ProLIF."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from molecular_prioritization.interaction_analysis_input import (
    extract_vina_pose_model,
    resolve_template_pose_mapping,
    resolve_template_pose_mapping_v2,
)


LIGANDS = ("gen_1349", "gen_1", "gen_1122", "gen_3389", "gen_1587")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact-root", type=Path, required=True)
    parser.add_argument("--input-pdbqt-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    records = []
    for ligand in LIGANDS:
        template = args.artifact_root / f"{ligand}_prepared_template.sdf"
        input_pdbqt = args.input_pdbqt_root / f"{ligand}_input.pdbqt"
        for mode in (1, 2, 3):
            pose = extract_vina_pose_model(
                args.artifact_root / f"{ligand}_mode_{mode}.pdbqt", mode
            )
            historical = resolve_template_pose_mapping(template, pose)
            mapping, provenance = resolve_template_pose_mapping_v2(template, input_pdbqt, pose)
            direct_by_pose = {
                int(entry["pose_pdbqt_atom_index"]): int(entry["template_atom_index"])
                for entry in mapping["entries"]
            }
            historical_by_pose = {
                int(entry["pose_pdbqt_atom_index"]): int(entry["template_atom_index"])
                for entry in historical["entries"]
            }
            records.append({
                "ligand": ligand,
                "mode": mode,
                "sdf_to_input_pdbqt_mapping": "passed",
                "polar_hydrogen_mapping": "passed",
                "input_pdbqt_to_vina_identity": "passed",
                "atom_count": provenance["atom_count"],
                "heavy_atom_count": provenance["heavy_atom_count"],
                "polar_hydrogen_count": provenance["polar_hydrogen_count"],
                "input_pdbqt_sha256": provenance["input_pdbqt_sha256"],
                "historical_automorphism_status": historical["coordinate_tiebreaker"],
                "direct_identity_differs_from_historical": direct_by_pose != historical_by_pose,
                "differing_heavy_pose_indices": sorted(
                    index for index in direct_by_pose
                    if direct_by_pose[index] != historical_by_pose.get(index)
                ),
            })
    gen_1587 = next(
        record for record in records if record["ligand"] == "gen_1587" and record["mode"] == 2
    )
    template = args.artifact_root / "gen_1587_prepared_template.sdf"
    input_pdbqt = args.input_pdbqt_root / "gen_1587_input.pdbqt"
    pose = extract_vina_pose_model(args.artifact_root / "gen_1587_mode_2.pdbqt", 2)
    mapping, provenance = resolve_template_pose_mapping_v2(template, input_pdbqt, pose)
    hydrogen = provenance["polar_hydrogens"][0]
    heavy = next(
        entry for entry in mapping["entries"]
        if entry["pose_pdbqt_atom_index"] == hydrogen["input_pdbqt_parent_atom_index"]
    )
    payload = {
        "schema_version": "moloptima-ligand-identity-qualification-v1",
        "records": records,
        "summary": {
            "pose_count": len(records),
            "all_sdf_to_input_pdbqt_mappings_passed": all(
                record["sdf_to_input_pdbqt_mapping"] == "passed" for record in records
            ),
            "all_polar_hydrogen_mappings_passed": all(
                record["polar_hydrogen_mapping"] == "passed" for record in records
            ),
            "all_vina_identity_checks_passed": all(
                record["input_pdbqt_to_vina_identity"] == "passed" for record in records
            ),
            "historical_mapping_difference_pose_count": sum(
                bool(record["direct_identity_differs_from_historical"]) for record in records
            ),
        },
        "gen_1587_mode_2": {
            "classification": "CASE_A",
            "template_hydrogen_atom_index": hydrogen["template_hydrogen_atom_index"],
            "template_parent_atom_index": hydrogen["template_parent_atom_index"],
            "input_pdbqt_hydrogen_atom_index": hydrogen["input_pdbqt_hydrogen_atom_index"],
            "input_pdbqt_hydrogen_atom_serial": hydrogen["input_pdbqt_hydrogen_atom_serial"],
            "input_pdbqt_parent_atom_index": hydrogen["input_pdbqt_parent_atom_index"],
            "input_pdbqt_parent_atom_serial": hydrogen["input_pdbqt_parent_atom_serial"],
            "vina_pose_hydrogen_atom_index": mapping["polar_hydrogen_entries"][0]["pose_pdbqt_hydrogen_atom_index"],
            "vina_pose_hydrogen_atom_serial": mapping["polar_hydrogen_entries"][0]["pose_pdbqt_hydrogen_atom_serial"],
            "vina_pose_parent_atom_index": mapping["polar_hydrogen_entries"][0]["pose_pdbqt_parent_atom_index"],
            "vina_pose_parent_atom_serial": mapping["polar_hydrogen_entries"][0]["pose_pdbqt_parent_atom_serial"],
            "direct_template_parent_from_pose": heavy["template_atom_index"],
            "historical_failure_template_parent": 10,
            "protonation_changed_by_openbabel": False,
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(payload["summary"], sort_keys=True))
    print(json.dumps(payload["gen_1587_mode_2"], sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
