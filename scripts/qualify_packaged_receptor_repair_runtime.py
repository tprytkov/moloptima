"""Compare one receptor-repair fixture across external and packaged runtimes."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from molecular_prioritization.receptor import parse_receptor_atoms  # noqa: E402
from molecular_prioritization.receptor_repair import (  # noqa: E402
    WORKER,
    repair_runtime_status,
    resolve_repair_python,
)


def _run(python: Path, receptor: Path, output: Path) -> tuple[dict[str, object], float]:
    audit = output.with_suffix(".json")
    started = time.perf_counter()
    completed = subprocess.run(
        [str(python), str(WORKER), "--input", str(receptor), "--output", str(output), "--result", str(audit)],
        capture_output=True, text=True, shell=False, timeout=300,
    )
    elapsed = time.perf_counter() - started
    if completed.returncode:
        raise RuntimeError(completed.stdout.strip() or completed.stderr.strip() or "repair worker failed")
    return json.loads(audit.read_text(encoding="utf-8")), elapsed


def _atom_signature(path: Path) -> list[tuple[object, ...]]:
    atoms = parse_receptor_atoms(path.read_text(encoding="utf-8"))
    return [
        (
            atom.record, atom.chain, atom.residue_number, atom.insertion_code, atom.residue_name,
            atom.atom_name, atom.altloc, round(atom.x, 3), round(atom.y, 3), round(atom.z, 3), atom.element,
        )
        for atom in atoms
    ]


def qualify(*, external_python: Path, application_root: Path, receptor: Path) -> dict[str, object]:
    packaged_python, source = resolve_repair_python(application_root=application_root, environ={})
    if packaged_python is None or source != "packaged_runtime":
        raise RuntimeError("packaged receptor-repair runtime did not resolve deterministically")
    packaged_status = repair_runtime_status(application_root=application_root, environ={})
    if not packaged_status.get("available"):
        raise RuntimeError(str(packaged_status.get("reason") or "packaged runtime unavailable"))
    external_status = repair_runtime_status(external_python, application_root=application_root, environ={})
    if not external_status.get("available"):
        raise RuntimeError(str(external_status.get("reason") or "external runtime unavailable"))

    with tempfile.TemporaryDirectory(prefix="moloptima-receptor-repair-equivalence-") as temporary:
        root = Path(temporary)
        external_output = root / "external.pdb"
        packaged_output = root / "packaged.pdb"
        external_audit, external_seconds = _run(external_python, receptor, external_output)
        packaged_audit, packaged_seconds = _run(packaged_python, receptor, packaged_output)
        input_signature = _atom_signature(receptor)
        external_signature = _atom_signature(external_output)
        packaged_signature = _atom_signature(packaged_output)

    equivalent = external_signature == packaged_signature
    fixture_preserved = input_signature == packaged_signature
    audit_equivalent = {
        key: value for key, value in external_audit.items() if key != "runtime_duration_seconds"
    } == {
        key: value for key, value in packaged_audit.items() if key != "runtime_duration_seconds"
    }
    if not equivalent or not fixture_preserved or not audit_equivalent:
        raise RuntimeError("packaged receptor-repair output differs from the qualified external runtime or fixture")
    return {
        "schema_version": "moloptima-packaged-receptor-repair-equivalence-v1",
        "status": "PASS",
        "packaged_resolution_source": source,
        "external_python": str(external_python.resolve()),
        "packaged_python": str(packaged_python.resolve()),
        "versions": {
            "python": packaged_status.get("python_version"),
            "pdbfixer": packaged_status.get("pdbfixer_version"),
            "openmm": packaged_status.get("openmm_version"),
        },
        "api_smoke": packaged_status.get("api_smoke"),
        "openmm_platforms": packaged_status.get("openmm_platforms", []),
        "external_repair_seconds": round(external_seconds, 6),
        "packaged_repair_seconds": round(packaged_seconds, 6),
        "atom_count": len(packaged_signature),
        "atom_identity_and_coordinates_preserved": fixture_preserved,
        "scientific_payload_equivalent": equivalent and audit_equivalent,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--external-python", type=Path, required=True)
    parser.add_argument("--application-root", type=Path, default=PROJECT_ROOT)
    parser.add_argument("--receptor", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = qualify(
        external_python=args.external_python,
        application_root=args.application_root.resolve(),
        receptor=args.receptor.resolve(),
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"status": result["status"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
