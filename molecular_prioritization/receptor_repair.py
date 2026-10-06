"""Runtime discovery and subprocess adapter for isolated receptor repair."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from subprocess import run as run_process


PDBFIXER_VERSION = "1.12.0"
OPENMM_VERSION = "8.6.1"
RUNTIME_ENV = "MOLOPTIMA_RECEPTOR_REPAIR_PYTHON"
WORKER = Path(__file__).with_name("receptor_repair_worker.py")


class ReceptorRepairError(RuntimeError):
    pass


def resolve_repair_python(override: str | Path | None = None) -> tuple[Path | None, str]:
    candidates: list[tuple[Path, str]] = []
    if override:
        candidates.append((Path(override), "explicit_override"))
    if os.environ.get(RUNTIME_ENV):
        candidates.append((Path(os.environ[RUNTIME_ENV]), "environment_override"))
    root = Path(__file__).resolve().parents[1]
    candidates.extend([
        (root / "resources" / "receptor_preparation" / "runtime" / "python" / "python.exe", "packaged_runtime"),
        (root / "desktop" / "runtime" / "receptor_preparation" / "python" / "python.exe", "development_bundled_runtime"),
        (Path(sys.executable), "current_interpreter"),
    ])
    for path, source in candidates:
        if path.is_file():
            return path.resolve(), source
    return None, "unavailable"


def repair_runtime_status(override: str | Path | None = None) -> dict[str, object]:
    executable, source = resolve_repair_python(override)
    if executable is None:
        return {"available": False, "status": "unavailable", "reason": "No receptor-repair Python runtime was found.", "resolution_source": source}
    command = [str(executable), str(WORKER), "--probe"]
    try:
        completed = run_process(command, capture_output=True, text=True, timeout=30, check=False, shell=False)
        payload = json.loads((completed.stdout or "{}").splitlines()[-1])
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError, IndexError) as exc:
        return {"available": False, "status": "unavailable", "reason": f"Repair runtime probe failed: {exc}", "resolution_source": source}
    errors = []
    if completed.returncode or not payload.get("available"):
        errors.append(str(payload.get("error") or completed.stderr or "probe failed"))
    if payload.get("pdbfixer_version") != PDBFIXER_VERSION:
        errors.append(f"PDBFixer {PDBFIXER_VERSION} required; found {payload.get('pdbfixer_version') or 'unknown'}.")
    if payload.get("openmm_version") != OPENMM_VERSION:
        errors.append(f"OpenMM {OPENMM_VERSION} required; found {payload.get('openmm_version') or 'unknown'}.")
    return {**payload, "available": not errors, "status": "available" if not errors else "unavailable", "reason": " ".join(errors), "resolution_source": source, "interface": "isolated_subprocess"}


def run_repair(source: Path, destination: Path, audit_path: Path, *, python_executable: str | Path | None = None, timeout_seconds: int = 300) -> dict[str, object]:
    status = repair_runtime_status(python_executable)
    if not status["available"]:
        raise ReceptorRepairError(str(status["reason"]))
    executable, _ = resolve_repair_python(python_executable)
    command = [str(executable), str(WORKER), "--input", str(source), "--output", str(destination), "--result", str(audit_path)]
    started = time.perf_counter()
    try:
        completed = run_process(command, capture_output=True, text=True, timeout=timeout_seconds, check=False, shell=False)
    except subprocess.TimeoutExpired as exc:
        raise ReceptorRepairError(f"PDBFixer repair timed out after {timeout_seconds} seconds.") from exc
    if completed.returncode:
        try:
            error = json.loads((completed.stdout or "{}").splitlines()[-1]).get("error")
        except Exception:
            error = None
        raise ReceptorRepairError(str(error or completed.stderr or "PDBFixer repair failed."))
    if not destination.is_file() or not audit_path.is_file():
        raise ReceptorRepairError("PDBFixer repair did not create its required artifacts.")
    payload = json.loads(audit_path.read_text(encoding="utf-8"))
    payload["runtime_duration_seconds"] = round(time.perf_counter() - started, 6)
    audit_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return payload
