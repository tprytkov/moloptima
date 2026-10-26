"""Runtime discovery and subprocess adapter for isolated receptor repair."""

from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path
from subprocess import run as run_process
from typing import Mapping


PDBFIXER_VERSION = "1.12.0"
OPENMM_VERSION = "8.6.1"
PYTHON_VERSION = "3.11.16"
REQUIRED_API_SMOKE = "pdbfixer_side_chain_detection_and_openmm_pdb_write"
RUNTIME_ENV = "MOLOPTIMA_RECEPTOR_REPAIR_PYTHON"
WORKER = Path(__file__).with_name("receptor_repair_worker.py")
RUNTIME_MANIFEST = Path("resources/receptor_preparation/runtime_manifest.json")
RUNTIME_SCHEMA = "moloptima-receptor-repair-runtime-v1"


class ReceptorRepairError(RuntimeError):
    pass


def _load_runtime_manifest(root: Path) -> dict[str, object]:
    try:
        payload = json.loads((root / RUNTIME_MANIFEST).read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ReceptorRepairError("Receptor-repair runtime manifest is unavailable or invalid.") from exc
    candidates = payload.get("python_candidates")
    if payload.get("schema_version") != RUNTIME_SCHEMA or not isinstance(candidates, list) or not all(
        isinstance(item, str) and item and not Path(item).is_absolute() for item in candidates
    ):
        raise ReceptorRepairError("Receptor-repair runtime manifest has an unsupported contract.")
    return payload


def _runtime_environment(environ: Mapping[str, str] | None = None) -> dict[str, str]:
    environment = dict(os.environ if environ is None else environ)
    for name in ("PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP"):
        if value := os.environ.get(name):
            environment.setdefault(name, value)
    environment.pop("RDBASE", None)
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    return environment


def resolve_repair_python(
    override: str | Path | None = None,
    *,
    application_root: str | Path | None = None,
    environ: Mapping[str, str] | None = None,
) -> tuple[Path | None, str]:
    root = Path(application_root).resolve() if application_root is not None else Path(__file__).resolve().parents[1]
    values = os.environ if environ is None else environ
    candidates: list[tuple[Path, str]] = []
    if override:
        candidates.append((Path(override), "explicit_override"))
    environment_value = str(values.get(RUNTIME_ENV, "")).strip()
    if environment_value:
        candidates.append((Path(environment_value), "environment_override"))
    manifest = _load_runtime_manifest(root)
    candidates.extend((root / Path(value), "packaged_runtime") for value in manifest["python_candidates"])
    for path, source in candidates:
        if path.is_file():
            return path.resolve(), source
    return None, "unavailable"


def repair_runtime_status(
    override: str | Path | None = None,
    *,
    application_root: str | Path | None = None,
    environ: Mapping[str, str] | None = None,
) -> dict[str, object]:
    try:
        executable, source = resolve_repair_python(
            override, application_root=application_root, environ=environ
        )
    except ReceptorRepairError as exc:
        return {
            "available": False, "status": "incompatible", "error_code": "runtime_manifest_invalid",
            "reason": str(exc), "resolution_source": "unavailable", "interface": "isolated_subprocess",
        }
    if executable is None:
        return {
            "available": False, "status": "unavailable", "error_code": "packaged_runtime_missing",
            "reason": "No isolated receptor-repair Python runtime was found.",
            "resolution_source": source, "interface": "isolated_subprocess",
        }
    command = [str(executable), str(WORKER), "--probe"]
    try:
        completed = run_process(
            command, capture_output=True, text=True, timeout=30, check=False, shell=False,
            env=_runtime_environment(environ),
        )
        payload = json.loads((completed.stdout or "{}").splitlines()[-1])
    except subprocess.TimeoutExpired:
        return {
            "available": False, "status": "error", "error_code": "runtime_probe_timeout",
            "reason": "Receptor-repair runtime probe timed out after 30 seconds.",
            "resolution_source": source, "interface": "isolated_subprocess",
        }
    except OSError as exc:
        return {
            "available": False, "status": "unavailable", "error_code": "runtime_start_failed",
            "reason": f"Receptor-repair runtime could not start: {exc}",
            "resolution_source": source, "interface": "isolated_subprocess",
        }
    except (json.JSONDecodeError, IndexError) as exc:
        return {
            "available": False, "status": "error", "error_code": "runtime_probe_error",
            "reason": f"Receptor-repair runtime returned an invalid probe result: {exc}",
            "resolution_source": source, "interface": "isolated_subprocess",
        }
    errors = []
    if completed.returncode or not payload.get("available"):
        errors.append(str(payload.get("error") or completed.stderr or "probe failed"))
    if payload.get("pdbfixer_version") != PDBFIXER_VERSION:
        errors.append(f"PDBFixer {PDBFIXER_VERSION} required; found {payload.get('pdbfixer_version') or 'unknown'}.")
    if payload.get("openmm_version") != OPENMM_VERSION:
        errors.append(f"OpenMM {OPENMM_VERSION} required; found {payload.get('openmm_version') or 'unknown'}.")
    if payload.get("python_version") != PYTHON_VERSION:
        errors.append(f"Python {PYTHON_VERSION} required; found {payload.get('python_version') or 'unknown'}.")
    if payload.get("api_smoke") != REQUIRED_API_SMOKE:
        errors.append("The required conservative receptor-repair API smoke did not complete.")
    if errors:
        error_code = str(payload.get("error_code") or "runtime_version_incompatible")
        status = "unavailable" if error_code == "package_missing" else "incompatible"
    else:
        error_code = ""
        status = "available"
    return {
        **payload,
        "available": not errors,
        "status": status,
        "error_code": error_code,
        "reason": " ".join(errors),
        "resolution_source": source,
        "interface": "isolated_subprocess",
        "python_executable": str(executable),
    }


def run_repair(source: Path, destination: Path, audit_path: Path, *, python_executable: str | Path | None = None, timeout_seconds: int = 300) -> dict[str, object]:
    status = repair_runtime_status(python_executable)
    if not status["available"]:
        raise ReceptorRepairError(str(status["reason"]))
    executable, _ = resolve_repair_python(python_executable)
    command = [str(executable), str(WORKER), "--input", str(source), "--output", str(destination), "--result", str(audit_path)]
    started = time.perf_counter()
    try:
        completed = run_process(
            command, capture_output=True, text=True, timeout=timeout_seconds, check=False, shell=False,
            env=_runtime_environment(),
        )
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
