"""Controlled, provenance-rich rigid receptor preparation with Meeko."""

from __future__ import annotations

import hashlib
import importlib.util
import json
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
)


MEEKO_VERSION = "0.7.1"
GEMMI_VERSION = "0.7.5"
PREPARATION_SCHEMA_VERSION = "moloptima-receptor-preparation-v1"
PREPARATION_TIMEOUT_SECONDS = 300
SCIENTIFIC_WARNINGS = [
    "Receptor preparation generates a docking-ready PDBQT representation but does not repair missing residues or determine the biologically correct protonation state.",
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
    return {
        "status": "available" if not errors else "unavailable",
        "available": not errors,
        "tool": "Meeko",
        "version": packages["meeko"],
        "interface": "python_module_cli",
        "packages": packages,
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
    timeout_seconds: int = PREPARATION_TIMEOUT_SECONDS,
    python_executable: str | Path | None = None,
) -> dict[str, object]:
    """Prepare one immutable receptor artifact set via controlled Meeko CLI args."""

    runtime = receptor_preparation_runtime_status()
    if not runtime["available"]:
        raise ReceptorPreparationError(str(runtime["reason"]))
    try:
        original_bytes = original_pdb.read_bytes()
        original_text = original_bytes.decode("utf-8", errors="strict")
        atoms = parse_receptor_atoms(original_text)
    except (OSError, UnicodeError, ReceptorValidationError) as exc:
        raise ReceptorPreparationError(f"Receptor PDB is unreadable or invalid: {exc}") from exc

    inventory = receptor_structure_inventory(atoms)
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

    selected_atoms = []
    for atom in atoms:
        include = False
        if atom.record == "ATOM":
            include = atom.chain in selected
        elif atom.residue_name in {"HOH", "WAT", "H2O", "DOD"}:
            include = False
        else:
            include = bool(hetero_choices[hetero_group_id(atom)])
        if include and atom.altloc:
            include = altloc_choices.get(residue_key(atom)) == atom.altloc
        if include:
            selected_atoms.append(atom)
    if not any(atom.record == "ATOM" for atom in selected_atoms):
        raise ReceptorPreparationError("The receptor selection contains no protein atoms.")

    output_dir.mkdir(parents=True, exist_ok=False)
    original_artifact = output_dir / "original_receptor.pdb"
    selected_artifact = output_dir / "selected_receptor_input.pdb"
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
        selected_artifact.write_text(
            "\n".join(selected_lines) + "\nTER\nEND\n",
            encoding="utf-8",
        )
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
            "validation_status": "valid",
            "validation_result": "passed_existing_moloptima_pdbqt_validator",
            "runtime_duration_seconds": round(duration, 6),
            "warnings": list(SCIENTIFIC_WARNINGS),
        }
        _write_json_atomic(provenance_artifact, provenance)
        hash_paths = [original_artifact, selected_artifact, prepared_artifact, meeko_artifact, provenance_artifact]
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
