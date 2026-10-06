"""Controlled, provenance-rich rigid receptor preparation with Meeko."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import math
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Mapping, Sequence

from molecular_prioritization.receptor import (
    PDB_ELEMENT_SYMBOLS,
    ReceptorAtom,
    ReceptorValidationError,
    audit_prepared_receptor_hydrogens,
    hetero_group_id,
    parse_receptor_atoms,
    receptor_structure_inventory,
    residue_key,
    validate_prepared_receptor,
    validate_receptor_pdb,
)
from molecular_prioritization.receptor_repair import (
    ReceptorRepairError,
    repair_runtime_status,
    run_repair,
)


MEEKO_VERSION = "0.7.1"
GEMMI_VERSION = "0.7.5"
PREPARATION_SCHEMA_VERSION = "moloptima-receptor-preparation-v2"
PREPARATION_TIMEOUT_SECONDS = 300
SCIENTIFIC_WARNINGS = [
    "Conservative PDBFixer repair adds detected missing side-chain heavy atoms only; missing residues, terminal completion, hydrogens, and minimization are disabled.",
    "Meeko/RDKit residue-template hydrogen completion is used without Reduce2 hydrogen optimization or pH-dependent protonation.",
    "MolOptima uses Meeko to prepare the AutoDock/Vina receptor representation. The final PDBQT retains the explicit polar/donor hydrogens required by the AutoDock atom representation; nonpolar hydrogens are not retained as independent docking atoms.",
    "Review retained cofactors, ions, waters, and hetero groups before docking.",
]


class ReceptorPreparationError(RuntimeError):
    """A receptor could not be prepared and must not be marked docking-ready."""


def receptor_preparation_runtime_status() -> dict[str, object]:
    """Report the exact production dependency contract without running preparation."""

    packages: dict[str, str | None] = {}
    errors: list[str] = []
    for package, expected in (("meeko", MEEKO_VERSION), ("gemmi", GEMMI_VERSION)):
        try:
            installed = version(package)
        except PackageNotFoundError:
            installed = None
        packages[package] = installed
        if installed != expected:
            errors.append(f"{package} {expected} is required; installed: {installed or 'not installed'}.")
    if importlib.util.find_spec("meeko") is None or importlib.util.find_spec("gemmi") is None:
        errors.append("The Meeko receptor-preparation modules are not importable.")
    repair = repair_runtime_status()
    if not repair["available"]:
        errors.append(str(repair["reason"]))
    return {
        "status": "available" if not errors else "unavailable",
        "available": not errors,
        "tool": "PDBFixer/OpenMM + Meeko",
        "version": packages["meeko"],
        "interface": "python_module_cli",
        "packages": packages,
        "repair_runtime": repair,
        "hydrogen_preparation": {
            "method": "meeko_rdkit_residue_template_hydrogen_completion",
            "final_pdbqt_representation": "autodock_polar_hydrogen_united_atom",
            "optimization": "not_performed",
            "protonation_status": "not_scientifically_resolved",
            "reduce2_available": False,
        },
        "reason": " ".join(errors),
        "warnings": list(SCIENTIFIC_WARNINGS),
    }


def prepare_receptor(
    original_pdb: Path,
    output_dir: Path,
    *,
    original_filename: str,
    receptor_id: str,
    selected_chains: Sequence[str],
    water_policy: str,
    hetero_choices: Mapping[str, bool],
    altloc_choices: Mapping[str, str],
    bound_ligand_id: str = "",
    pocket_definition_method: str = "",
    reference_ligand_id: str = "",
    ligand_removal_ids: Sequence[str] = (),
    pocket_config: Mapping[str, object] | None = None,
    timeout_seconds: int = PREPARATION_TIMEOUT_SECONDS,
    python_executable: str | Path | None = None,
) -> dict[str, object]:
    """Prepare one immutable receptor artifact set via controlled Meeko CLI args."""

    total_started = time.perf_counter()
    integrated_workflow = bool(pocket_definition_method)
    runtime = receptor_preparation_runtime_status()
    if not runtime["available"] and integrated_workflow:
        raise ReceptorPreparationError(str(runtime["reason"]))
    if not integrated_workflow:
        # Backward-compatible library path; the API/UI always supplies an explicit method.
        meeko_errors = [item for item in str(runtime.get("reason", "")).split(". ") if "PDBFixer" not in item and "OpenMM" not in item and "repair" not in item.lower()]
        if runtime.get("packages", {}).get("meeko") != MEEKO_VERSION or runtime.get("packages", {}).get("gemmi") != GEMMI_VERSION:
            raise ReceptorPreparationError(" ".join(meeko_errors) or "Meeko runtime unavailable.")
    if pocket_definition_method not in {"", "reference_ligand", "manual"}:
        raise ReceptorPreparationError("Pocket definition must be explicitly 'reference_ligand' or 'manual'.")
    pocket = dict(pocket_config or {})
    if integrated_workflow:
        required_box = ("center_x", "center_y", "center_z", "size_x", "size_y", "size_z")
        try:
            pocket = {key: float(pocket[key]) for key in required_box} | ({"padding": float(pocket["padding"])} if "padding" in pocket else {})
        except (KeyError, TypeError, ValueError) as exc:
            raise ReceptorPreparationError("An explicit finite docking box is required before receptor preparation.") from exc
        if not all(math.isfinite(value) for value in pocket.values()) or any(pocket[key] <= 0 for key in ("size_x", "size_y", "size_z")):
            raise ReceptorPreparationError("Docking-box centers must be finite and sizes must be finite positive values.")
    try:
        original_bytes = original_pdb.read_bytes()
        original_text = original_bytes.decode("utf-8", errors="strict")
        atoms = parse_receptor_atoms(original_text)
    except (OSError, UnicodeError, ReceptorValidationError) as exc:
        raise ReceptorPreparationError(f"Receptor PDB is unreadable or invalid: {exc}") from exc

    audit_started = time.perf_counter()
    inventory = receptor_structure_inventory(atoms)
    audit_duration = time.perf_counter() - audit_started
    selected = list(dict.fromkeys(str(chain) for chain in selected_chains))
    available_chains = [str(item["chain"]) for item in inventory["protein"]["chains"]]
    if not selected:
        raise ReceptorPreparationError("At least one protein chain must be selected.")
    if any(chain not in available_chains for chain in selected):
        raise ReceptorPreparationError("Selected protein chains do not match the parsed receptor inventory.")
    if water_policy != "remove_all":
        raise ReceptorPreparationError(
            "Stage 1 safely supports only explicit removal of all waters; selected-water retention is not available."
        )

    hetero_ids = {str(item["group_id"]) for item in inventory["hetero_groups"]}
    if set(hetero_choices) != hetero_ids or any(not isinstance(value, bool) for value in hetero_choices.values()):
        raise ReceptorPreparationError("Every inventoried non-water hetero group requires an explicit keep/exclude decision.")

    altloc_inventory = {
        str(item["residue_key"]): [str(choice) for choice in item["choices"]]
        for item in inventory["alternate_locations"]
    }
    if set(altloc_choices) != set(altloc_inventory):
        raise ReceptorPreparationError("Every residue with alternate locations requires an explicit conformer choice.")
    for key, choice in altloc_choices.items():
        if choice not in altloc_inventory[key]:
            raise ReceptorPreparationError(f"Alternate-location choice for {key} is not present in the receptor.")

    removal_ids = set(str(item) for item in ligand_removal_ids)
    if bound_ligand_id:
        removal_ids.add(bound_ligand_id)
    ligand_ids = {str(item["ligand_id"]) for item in validate_receptor_pdb(original_pdb)["bound_ligands"]}
    if not removal_ids.issubset(ligand_ids):
        raise ReceptorPreparationError("One or more selected ligand copies for removal were not found.")
    if pocket_definition_method == "reference_ligand":
        if not reference_ligand_id or reference_ligand_id not in ligand_ids:
            raise ReceptorPreparationError("Reference-ligand mode requires a valid selected ligand copy.")
        if reference_ligand_id not in removal_ids:
            raise ReceptorPreparationError("The selected reference ligand must be included in the removal set.")
    reference_atoms = [atom for atom in atoms if reference_ligand_id and hetero_group_id(atom) == reference_ligand_id]

    selected_atoms = []
    for atom in atoms:
        include = False
        if atom.record == "ATOM":
            include = atom.chain in selected
        elif atom.residue_name in {"HOH", "WAT", "H2O", "DOD"}:
            include = False
        else:
            include = bool(hetero_choices[hetero_group_id(atom)])
            if hetero_group_id(atom) in removal_ids:
                include = False
        if include and atom.altloc:
            include = altloc_choices.get(residue_key(atom)) == atom.altloc
        if include:
            selected_atoms.append(atom)
    if not any(atom.record == "ATOM" for atom in selected_atoms):
        raise ReceptorPreparationError("The receptor selection contains no protein atoms.")

    output_dir.mkdir(parents=True, exist_ok=False)
    original_artifact = output_dir / "original_receptor.pdb"
    selected_artifact = output_dir / "selected_receptor_input.pdb"
    ligand_removed_artifact = output_dir / "ligand_removed_receptor.pdb"
    protein_before_artifact = output_dir / "protein_before_repair.pdb"
    protein_repaired_artifact = output_dir / "protein_repaired.pdb"
    repair_audit_artifact = output_dir / "pdbfixer_detection_audit.json"
    repair_verification_artifact = output_dir / "repair_verification.json"
    repaired_receptor_artifact = output_dir / "repaired_receptor.pdb"
    meeko_input_artifact = output_dir / "meeko_input.pdb"
    manifest_artifact = output_dir / "preparation_manifest.json"
    prepared_artifact = output_dir / "prepared_receptor.pdbqt"
    meeko_artifact = output_dir / "meeko_receptor.json"
    provenance_artifact = output_dir / "receptor_preparation.json"
    hashes_artifact = output_dir / "SHA256SUMS"
    try:
        original_artifact.write_bytes(original_bytes)
        selected_lines: list[str] = []
        filled_element_columns = 0
        preserved_element_columns = 0
        for atom in selected_atoms:
            line, element_was_filled = _preparation_input_atom_line(atom)
            selected_lines.append(line)
            if element_was_filled:
                filled_element_columns += 1
            else:
                preserved_element_columns += 1
        ligand_removed_artifact.write_text("\n".join(selected_lines) + "\nTER\nEND\n", encoding="utf-8")
        protein_lines = [line for line, atom in zip(selected_lines, selected_atoms) if atom.record == "ATOM"]
        protein_before_artifact.write_text("\n".join(protein_lines) + "\nTER\nEND\n", encoding="utf-8")
        repair_audit: dict[str, object] = {"status": "legacy_not_run"}
        if integrated_workflow:
            try:
                repair_audit = run_repair(protein_before_artifact, protein_repaired_artifact, repair_audit_artifact)
            except ReceptorRepairError as exc:
                raise ReceptorPreparationError(f"Mandatory conservative receptor repair failed: {exc}") from exc
            verification_started = time.perf_counter()
            verification = _verify_repair(protein_before_artifact, protein_repaired_artifact, repair_audit, pocket)
            verification["runtime_duration_seconds"] = round(time.perf_counter() - verification_started, 6)
            _write_json_atomic(repair_verification_artifact, verification)
            repaired_lines = [line for line in protein_repaired_artifact.read_text(encoding="utf-8").splitlines() if line.startswith(("ATOM  ", "HETATM"))]
            retained_hetero_lines = [line for line, atom in zip(selected_lines, selected_atoms) if atom.record == "HETATM"]
            selected_artifact.write_text("\n".join(repaired_lines + retained_hetero_lines) + "\nTER\nEND\n", encoding="utf-8")
        else:
            shutil.copyfile(protein_before_artifact, protein_repaired_artifact)
            shutil.copyfile(ligand_removed_artifact, selected_artifact)
            _write_json_atomic(repair_audit_artifact, repair_audit)
            _write_json_atomic(repair_verification_artifact, {"status": "legacy_not_run"})
        shutil.copyfile(selected_artifact, repaired_receptor_artifact)
        shutil.copyfile(selected_artifact, meeko_input_artifact)
        executable = str(python_executable or sys.executable)
        command = [
            executable,
            "-m",
            "meeko.cli.mk_prepare_receptor",
            "--read_pdb",
            selected_artifact.name,
            "--write_pdbqt",
            prepared_artifact.name,
            "--write_json",
            meeko_artifact.name,
        ]
        started = time.perf_counter()
        try:
            completed = subprocess.run(
                command,
                cwd=output_dir,
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
                check=False,
                shell=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise ReceptorPreparationError(f"Meeko receptor preparation timed out after {timeout_seconds} seconds.") from exc
        duration = time.perf_counter() - started
        if completed.returncode != 0:
            diagnostic = _diagnostic(completed.stderr or completed.stdout)
            raise ReceptorPreparationError(f"Meeko receptor preparation failed (exit {completed.returncode}): {diagnostic}")
        if not prepared_artifact.is_file() or prepared_artifact.stat().st_size <= 0:
            raise ReceptorPreparationError("Meeko did not create the expected non-empty prepared_receptor.pdbqt output.")
        if not meeko_artifact.is_file() or meeko_artifact.stat().st_size <= 0:
            raise ReceptorPreparationError("Meeko did not create the expected receptor parameterization JSON.")
        try:
            validated = validate_prepared_receptor(
                prepared_artifact,
                receptor_id=receptor_id,
                source="moloptima_prepared",
                source_filename=original_filename,
            )
        except ReceptorValidationError as exc:
            raise ReceptorPreparationError(f"Generated receptor PDBQT failed MolOptima validation: {exc}") from exc
        hydrogen_audit = audit_prepared_receptor_hydrogens(prepared_artifact)

        retained = [item for item in inventory["hetero_groups"] if hetero_choices[str(item["group_id"])]]
        excluded = [item for item in inventory["hetero_groups"] if not hetero_choices[str(item["group_id"])]]
        explicit_h_count = int(inventory["explicit_hydrogen_atom_count"])
        hydrogen_status = (
            "input_explicit_hydrogens_present_template_completion_without_optimization"
            if explicit_h_count
            else "hydrogens_added_by_meeko_rdkit_templates_without_optimization"
        )
        provenance = {
            "schema_version": PREPARATION_SCHEMA_VERSION,
            "preparation_timestamp": datetime.now(timezone.utc).isoformat(),
            "receptor_id": receptor_id,
            "original_filename": Path(original_filename).name,
            "original_pdb_sha256": _sha256(original_artifact),
            "preparation_input": {
                "filename": selected_artifact.name,
                "sha256": _sha256(selected_artifact),
                "atom_count": len(selected_atoms),
                "normalization": {
                    "operation": "fill_missing_pdb_element_columns",
                    "missing_element_columns_filled": filled_element_columns,
                    "preexisting_element_columns_preserved": preserved_element_columns,
                    "description": (
                        "Formatting-only normalization filled blank PDB element columns 77-78 "
                        "from confidently inferred atom elements; no chemical repair was performed."
                    ),
                },
            },
            "selected_chains": selected,
            "water_policy": "remove_all",
            "removed_waters": inventory["waters"]["residues"],
            "retained_waters": [],
            "excluded_hetero_groups": excluded,
            "retained_hetero_groups": retained,
            "bound_ligand_selection": bound_ligand_id or None,
            "bound_ligand_excluded": bool(bound_ligand_id and not hetero_choices.get(bound_ligand_id, False)),
            "alternate_location_policy": "explicit_per_residue",
            "alternate_location_choices": dict(sorted(altloc_choices.items())),
            "pocket_definition_method": pocket_definition_method or "legacy_unspecified",
            "pocket": pocket,
            "reference_ligand_id": reference_ligand_id or None,
            "reference_ligand": None if not reference_atoms else {
                "ligand_id": reference_ligand_id,
                "residue_name": reference_atoms[0].residue_name,
                "chain": reference_atoms[0].chain,
                "residue_number": reference_atoms[0].residue_number,
                "insertion_code": reference_atoms[0].insertion_code,
                "source_coordinates": [
                    {"atom_name": atom.atom_name, "element": atom.element, "x": atom.x, "y": atom.y, "z": atom.z}
                    for atom in reference_atoms
                ],
            },
            "ligand_removal_ids": sorted(removal_ids),
            "repair_policy": "side_chain_heavy_atoms_only_no_missing_residues_no_terminals",
            "repair_audit": repair_audit,
            "repair_validation": verification if integrated_workflow else {"status": "legacy_not_run"},
            "repair_verification_file": repair_verification_artifact.name,
            "input_explicit_hydrogen_atom_count": explicit_h_count,
            "hydrogen_handling_method": "meeko_rdkit_residue_template_hydrogen_completion",
            "hydrogen_handling_status": hydrogen_status,
            "final_pdbqt_hydrogen_representation": hydrogen_audit,
            "final_pdbqt_hydrogen_policy": "autodock_polar_hydrogen_united_atom",
            "hydrogen_optimization": "not_performed",
            "protonation_status": "not_scientifically_resolved",
            "receptor_preparation_tool": "Meeko",
            "meeko_version": MEEKO_VERSION,
            "gemmi_version": GEMMI_VERSION,
            "invocation": {
                "interface": "python_module_cli",
                "arguments": command[1:],
                "shell": False,
                "timeout_seconds": timeout_seconds,
                "exit_code": completed.returncode,
                "stdout": _diagnostic(completed.stdout, limit=4000),
                "stderr": _diagnostic(completed.stderr, limit=4000),
            },
            "selected_receptor_atom_count": len(selected_atoms),
            "prepared_receptor_atom_count": hydrogen_audit["total_atom_record_count"],
            "prepared_pdbqt_filename": prepared_artifact.name,
            "prepared_pdbqt_sha256": validated.prepared_receptor_sha256,
            "prepared_pdbqt_size_bytes": prepared_artifact.stat().st_size,
            "validation_status": "valid",
            "validation_result": "passed_existing_moloptima_pdbqt_validator",
            "runtime_duration_seconds": round(duration, 6),
            "performance": {
                "receptor_audit_seconds": round(audit_duration, 6),
                "pdbfixer_repair_seconds": repair_audit.get("runtime_duration_seconds"),
                "repair_validation_seconds": verification.get("runtime_duration_seconds") if integrated_workflow else None,
                "meeko_preparation_seconds": round(duration, 6),
                "total_preparation_seconds": round(time.perf_counter() - total_started, 6),
            },
            "warnings": list(SCIENTIFIC_WARNINGS),
        }
        _write_json_atomic(provenance_artifact, provenance)
        _write_json_atomic(manifest_artifact, provenance)
        hash_paths = [original_artifact, ligand_removed_artifact, protein_before_artifact, protein_repaired_artifact, repair_audit_artifact, repair_verification_artifact, repaired_receptor_artifact, meeko_input_artifact, selected_artifact, prepared_artifact, meeko_artifact, provenance_artifact, manifest_artifact]
        hashes_artifact.write_text(
            "".join(f"{_sha256(path)}  {path.name}\n" for path in hash_paths),
            encoding="utf-8",
        )
        return {
            "artifact_directory": output_dir,
            "prepared_pdbqt": prepared_artifact,
            "provenance": provenance,
            "provenance_file": provenance_artifact,
            "sha256sums": hashes_artifact,
            "validated_artifact": validated,
        }
    except Exception:
        # Artifacts remain isolated for diagnosis; the caller must not publish them as ready.
        raise


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _atom_identity(atom: ReceptorAtom) -> tuple[str, str, str, str, str]:
    return (atom.chain, atom.residue_number, atom.insertion_code, atom.residue_name, atom.atom_name)


def _verify_repair(before_path: Path, repaired_path: Path, audit: Mapping[str, object], pocket: Mapping[str, object] | None = None) -> dict[str, object]:
    """Fail closed if repair changes existing coordinates or creates invalid geometry."""

    before = parse_receptor_atoms(before_path.read_text(encoding="utf-8"))
    after = parse_receptor_atoms(repaired_path.read_text(encoding="utf-8"))
    before_by_id = {_atom_identity(atom): atom for atom in before}
    after_by_id: dict[tuple[str, str, str, str, str], ReceptorAtom] = {}
    duplicates: list[str] = []
    for atom in after:
        key = _atom_identity(atom)
        if key in after_by_id:
            duplicates.append(":".join(key))
        after_by_id[key] = atom
    missing_existing = sorted(":".join(key) for key in set(before_by_id) - set(after_by_id))
    displacements = []
    for key, atom in before_by_id.items():
        other = after_by_id.get(key)
        if other:
            displacements.append(((atom.x-other.x)**2 + (atom.y-other.y)**2 + (atom.z-other.z)**2) ** 0.5)
    added = [atom for key, atom in after_by_id.items() if key not in before_by_id]
    clashes = []
    for added_atom in added:
        for other in after:
            if other is added_atom:
                continue
            distance = ((added_atom.x-other.x)**2 + (added_atom.y-other.y)**2 + (added_atom.z-other.z)**2) ** 0.5
            same_residue = (added_atom.chain, added_atom.residue_number, added_atom.insertion_code) == (other.chain, other.residue_number, other.insertion_code)
            if not same_residue and distance < 1.5:
                clashes.append({"atom": ":".join(_atom_identity(added_atom)), "other": ":".join(_atom_identity(other)), "distance_A": round(distance, 4)})
    maximum = max(displacements, default=0.0)
    expected_added = int(audit.get("added_atom_count", -1))
    errors = []
    if missing_existing:
        errors.append("pre-existing atoms were lost")
    if duplicates:
        errors.append("duplicate atom identities were produced")
    if maximum > 0.001:
        errors.append(f"pre-existing coordinates moved by up to {maximum:.4f} A")
    if len(added) != expected_added:
        errors.append(f"added-atom count mismatch ({len(added)} vs {expected_added})")
    if clashes:
        errors.append("new severe sub-1.5 A non-residue-local clashes were produced")
    if errors:
        raise ReceptorPreparationError("Receptor repair verification failed: " + "; ".join(errors))
    repaired_residues: dict[tuple[str, str, str], list[ReceptorAtom]] = {}
    for atom in added:
        repaired_residues.setdefault((atom.chain, atom.residue_number, atom.residue_name), []).append(atom)
    repair_details = []
    for (chain, number, name), residue_atoms in sorted(repaired_residues.items()):
        detail: dict[str, object] = {"chain": chain, "residue_number": number, "residue_name": name, "atoms_added": sorted(atom.atom_name for atom in residue_atoms), "repair_status": "passed"}
        if pocket:
            center = [float(pocket[f"center_{axis}"]) for axis in "xyz"]
            half = [float(pocket[f"size_{axis}"]) / 2 for axis in "xyz"]
            distances = []
            for atom in residue_atoms:
                offsets = [max(abs(value - c) - h, 0.0) for value, c, h in zip((atom.x, atom.y, atom.z), center, half)]
                distances.append(sum(value * value for value in offsets) ** 0.5)
            distance = min(distances)
            detail["distance_to_box_A"] = round(distance, 4)
            detail["pocket_proximity"] = {"inside": distance == 0, **{f"within_{cutoff}A": distance <= cutoff for cutoff in (4, 6, 8, 10)}}
        repair_details.append(detail)
    return {
        "status": "passed", "preexisting_atom_count": len(before), "repaired_atom_count": len(after),
        "added_atom_count": len(added), "added_atoms": [":".join(_atom_identity(atom)) for atom in added],
        "coordinate_preservation": {"maximum_displacement_A": maximum, "mean_displacement_A": sum(displacements) / len(displacements) if displacements else 0.0, "count_gt_0_001A": sum(value > 0.001 for value in displacements), "count_gt_0_01A": sum(value > 0.01 for value in displacements)},
        "duplicate_atom_names": len(duplicates), "severe_clash_threshold_A": 1.5,
        "severe_clash_count": len(clashes), "all_coordinates_finite": True,
        "repaired_residue_count": len(repair_details), "repaired_residues": repair_details,
    }


def _preparation_input_atom_line(atom: ReceptorAtom) -> tuple[str, bool]:
    """Return one Meeko input record, filling only a blank PDB element field."""

    line = atom.source_line
    existing = line[76:78].strip().upper() if len(line) >= 78 else ""
    identity = (
        f"{atom.record} serial {atom.serial}, atom '{atom.atom_name}', "
        f"residue {atom.residue_name} {atom.chain or '_'}:{atom.residue_number or '_'}"
    )
    if existing:
        if existing not in PDB_ELEMENT_SYMBOLS:
            raise ReceptorPreparationError(
                f"Preparation input has an invalid PDB element '{existing}' in columns 77-78 for {identity}."
            )
        return line, False
    if not atom.element or atom.element not in PDB_ELEMENT_SYMBOLS:
        raise ReceptorPreparationError(
            "Preparation input has blank PDB element columns 77-78 and the element cannot be "
            f"inferred confidently for {identity}. Correct this atom's element field before preparation."
        )
    padded = line.ljust(78)
    return f"{padded[:76]}{atom.element:>2}{padded[78:]}", True


def _pdbqt_atom_count(path: Path) -> int:
    return sum(1 for line in path.read_text(encoding="utf-8").splitlines() if line.startswith(("ATOM  ", "HETATM")))


def _diagnostic(value: str, *, limit: int = 1000) -> str:
    clean = " ".join((value or "").split())
    return clean[:limit] or "no diagnostic output"


def _write_json_atomic(path: Path, payload: dict[str, object]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)
