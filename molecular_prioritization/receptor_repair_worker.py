"""Isolated PDBFixer worker for MolOptima's conservative receptor repair policy."""

from __future__ import annotations

import argparse
import json
from importlib.metadata import version
from pathlib import Path


BACKBONE_ATOMS = frozenset({"N", "CA", "C", "O"})


def probe() -> dict[str, object]:
    import openmm  # noqa: F401
    import pdbfixer  # noqa: F401

    return {
        "available": True,
        "pdbfixer_version": version("pdbfixer"),
        "openmm_version": version("openmm"),
        "policy": "side_chain_heavy_atoms_only_no_missing_residues_no_terminals",
    }


def repair(source: Path, destination: Path) -> dict[str, object]:
    from openmm.app import PDBFile
    from pdbfixer import PDBFixer

    fixer = PDBFixer(filename=str(source))
    fixer.findMissingResidues()
    detected_missing_residues = [
        {"chain_index": int(key[0]), "residue_index": int(key[1]), "residues": list(value)}
        for key, value in sorted(fixer.missingResidues.items())
    ]
    fixer.missingResidues = {}
    fixer.findMissingAtoms()

    missing_atoms: list[dict[str, object]] = []
    forbidden: list[str] = []
    for residue, atom_templates in fixer.missingAtoms.items():
        for atom in atom_templates:
            name = str(atom.name)
            raw_element = atom.element
            element = str(getattr(raw_element, "symbol", raw_element) or "").upper()
            item = {
                "chain": str(residue.chain.id), "residue_number": str(residue.id),
                "residue_name": str(residue.name), "atom_name": name, "element": element,
            }
            missing_atoms.append(item)
            if name in BACKBONE_ATOMS or element in {"H", "D"}:
                forbidden.append(f"{residue.chain.id}:{residue.id}:{residue.name}:{name}")
    missing_terminals = {
        f"{residue.chain.id}:{residue.id}:{residue.name}": [str(getattr(atom, "name", atom)) for atom in atoms]
        for residue, atoms in fixer.missingTerminals.items()
    }
    if detected_missing_residues:
        raise RuntimeError("Missing residue blocks were detected; conservative repair stopped.")
    if forbidden:
        raise RuntimeError("Missing backbone or hydrogen atoms were detected; conservative repair stopped: " + ", ".join(forbidden[:10]))
    fixer.missingTerminals = {}
    fixer.addMissingAtoms()
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("w", encoding="utf-8") as handle:
        PDBFile.writeFile(fixer.topology, fixer.positions, handle, keepIds=True)
    return {
        **probe(),
        "missing_residues_detected": detected_missing_residues,
        "missing_atoms_detected": missing_atoms,
        "missing_terminals_detected_but_not_added": missing_terminals,
        "added_atom_count": len(missing_atoms),
        "missing_residues_added": False,
        "terminal_atoms_added": False,
        "hydrogens_added": False,
        "global_minimization_performed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--input")
    parser.add_argument("--output")
    parser.add_argument("--result")
    args = parser.parse_args()
    try:
        result = probe() if args.probe else repair(Path(args.input), Path(args.output))
        if args.result:
            Path(args.result).write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as exc:
        print(json.dumps({"available": False, "error": str(exc)}, sort_keys=True))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
