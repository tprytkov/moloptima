"""Isolated PDBFixer worker for MolOptima's conservative receptor repair policy."""

from __future__ import annotations

import argparse
import io
import json
import platform
from importlib.metadata import version
from pathlib import Path


BACKBONE_ATOMS = frozenset({"N", "CA", "C", "O"})
PROBE_PDB = """\
ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00 20.00           N
ATOM      2  CA  ALA A   1       1.450   0.000   0.000  1.00 20.00           C
ATOM      3  C   ALA A   1       2.100   1.300   0.000  1.00 20.00           C
ATOM      4  O   ALA A   1       1.600   2.400   0.000  1.00 20.00           O
TER
END
"""


def probe() -> dict[str, object]:
    import openmm
    import pdbfixer
    from openmm.app import PDBFile
    from pdbfixer import PDBFixer

    fixer = PDBFixer(pdbfile=io.StringIO(PROBE_PDB))
    fixer.findMissingResidues()
    fixer.missingResidues = {}
    fixer.findMissingAtoms()
    detected = sorted(str(atom.name) for atoms in fixer.missingAtoms.values() for atom in atoms)
    fixer.missingTerminals = {}
    fixer.addMissingAtoms()
    output = io.StringIO()
    PDBFile.writeFile(fixer.topology, fixer.positions, output, keepIds=True)
    atom_names = [str(atom.name) for atom in fixer.topology.atoms()]
    if detected != ["CB"] or "CB" not in atom_names or "ATOM" not in output.getvalue():
        raise RuntimeError("PDBFixer/OpenMM conservative repair API smoke returned an unexpected structure.")

    return {
        "available": True,
        "pdbfixer_version": version("pdbfixer"),
        "openmm_version": version("openmm"),
        "python_version": platform.python_version(),
        "policy": "side_chain_heavy_atoms_only_no_missing_residues_no_terminals",
        "api_smoke": "pdbfixer_side_chain_detection_and_openmm_pdb_write",
        "openmm_platforms": [openmm.Platform.getPlatform(index).getName() for index in range(openmm.Platform.getNumPlatforms())],
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
    except ModuleNotFoundError as exc:
        print(json.dumps({"available": False, "error_code": "package_missing", "missing_module": exc.name, "error": str(exc)}, sort_keys=True))
        return 2
    except (ImportError, OSError) as exc:
        print(json.dumps({"available": False, "error_code": "runtime_import_error", "error": str(exc)}, sort_keys=True))
        return 2
    except Exception as exc:
        print(json.dumps({"available": False, "error_code": "runtime_probe_error", "error": str(exc)}, sort_keys=True))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
