from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from molecular_prioritization import receptor_repair
from molecular_prioritization.receptor_repair import ReceptorRepairError


def test_repair_runtime_prefers_explicit_then_environment(tmp_path, monkeypatch):
    explicit = tmp_path / "explicit.exe"
    environment = tmp_path / "environment.exe"
    explicit.write_bytes(b"python")
    environment.write_bytes(b"python")
    monkeypatch.setenv(receptor_repair.RUNTIME_ENV, str(environment))
    assert receptor_repair.resolve_repair_python(explicit) == (explicit.resolve(), "explicit_override")
    assert receptor_repair.resolve_repair_python() == (environment.resolve(), "environment_override")


def test_probe_requires_exact_pdbfixer_and_openmm_versions(tmp_path, monkeypatch):
    executable = tmp_path / "python.exe"
    executable.write_bytes(b"python")
    monkeypatch.setenv(receptor_repair.RUNTIME_ENV, str(executable))
    monkeypatch.setattr(receptor_repair, "run_process", lambda *args, **kwargs: subprocess.CompletedProcess(
        args[0], 0, json.dumps({
            "available": True, "pdbfixer_version": "1.12.0", "openmm_version": "8.6.1",
            "python_version": "3.11.16",
            "api_smoke": "pdbfixer_side_chain_detection_and_openmm_pdb_write",
        }), ""
    ))
    status = receptor_repair.repair_runtime_status()
    assert status["available"] is True
    assert status["resolution_source"] == "environment_override"


def _write_manifest(root: Path, candidates: list[str]) -> None:
    path = root / "resources" / "receptor_preparation" / "runtime_manifest.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({
        "schema_version": "moloptima-receptor-repair-runtime-v1",
        "python_candidates": candidates,
    }), encoding="utf-8")


def test_packaged_runtime_resolution_uses_manifest_and_never_primary_interpreter(tmp_path):
    candidate = tmp_path / "desktop" / "runtime" / "receptor_preparation" / "python" / "python.exe"
    candidate.parent.mkdir(parents=True)
    candidate.write_bytes(b"python")
    _write_manifest(tmp_path, ["desktop/runtime/receptor_preparation/python/python.exe"])
    assert receptor_repair.resolve_repair_python(application_root=tmp_path, environ={}) == (
        candidate.resolve(), "packaged_runtime",
    )
    candidate.unlink()
    assert receptor_repair.resolve_repair_python(application_root=tmp_path, environ={}) == (
        None, "unavailable",
    )


def test_missing_runtime_import_failure_and_timeout_remain_distinct(tmp_path, monkeypatch):
    _write_manifest(tmp_path, ["desktop/runtime/receptor_preparation/python/python.exe"])
    missing = receptor_repair.repair_runtime_status(application_root=tmp_path, environ={})
    assert (missing["status"], missing["error_code"]) == ("unavailable", "packaged_runtime_missing")

    executable = tmp_path / "python.exe"
    executable.write_bytes(b"python")
    monkeypatch.setattr(receptor_repair, "run_process", lambda *args, **kwargs: subprocess.CompletedProcess(
        args[0], 2, json.dumps({
            "available": False, "error_code": "runtime_import_error", "error": "DLL load failed",
        }), "",
    ))
    incompatible = receptor_repair.repair_runtime_status(
        executable, application_root=tmp_path, environ={}
    )
    assert incompatible["status"] == "incompatible"
    assert incompatible["error_code"] == "runtime_import_error"

    monkeypatch.setattr(receptor_repair, "run_process", lambda *args, **kwargs: (_ for _ in ()).throw(
        subprocess.TimeoutExpired(args[0], kwargs.get("timeout", 1))
    ))
    timed_out = receptor_repair.repair_runtime_status(
        executable, application_root=tmp_path, environ={}
    )
    assert timed_out["status"] == "error"
    assert timed_out["error_code"] == "runtime_probe_timeout"


def test_success_requires_exact_python_and_meaningful_api_smoke(tmp_path, monkeypatch):
    executable = tmp_path / "python.exe"
    executable.write_bytes(b"python")
    _write_manifest(tmp_path, [])
    payload = {
        "available": True,
        "pdbfixer_version": "1.12.0",
        "openmm_version": "8.6.1",
        "python_version": "3.11.15",
        "api_smoke": "import_only",
    }
    monkeypatch.setattr(receptor_repair, "run_process", lambda *args, **kwargs: subprocess.CompletedProcess(
        args[0], 0, json.dumps(payload), "",
    ))
    status = receptor_repair.repair_runtime_status(executable, application_root=tmp_path, environ={})
    assert status["status"] == "incompatible"
    assert "Python 3.11.16 required" in status["reason"]
    assert "API smoke" in status["reason"]


def test_probe_and_repair_timeout_fail_closed(tmp_path, monkeypatch):
    executable = tmp_path / "python.exe"
    executable.write_bytes(b"python")
    monkeypatch.setenv(receptor_repair.RUNTIME_ENV, str(executable))
    monkeypatch.setattr(receptor_repair, "repair_runtime_status", lambda *_: {"available": True, "reason": ""})
    monkeypatch.setattr(receptor_repair, "run_process", lambda *args, **kwargs: (_ for _ in ()).throw(
        subprocess.TimeoutExpired(args[0], kwargs.get("timeout", 1))
    ))
    with pytest.raises(ReceptorRepairError, match="timed out"):
        receptor_repair.run_repair(tmp_path / "input.pdb", tmp_path / "output.pdb", tmp_path / "audit.json")


def test_repair_error_propagates_worker_diagnostic(tmp_path, monkeypatch):
    executable = tmp_path / "python.exe"
    executable.write_bytes(b"python")
    monkeypatch.setenv(receptor_repair.RUNTIME_ENV, str(executable))
    monkeypatch.setattr(receptor_repair, "repair_runtime_status", lambda *_: {"available": True, "reason": ""})
    monkeypatch.setattr(receptor_repair, "run_process", lambda *args, **kwargs: subprocess.CompletedProcess(
        args[0], 2, json.dumps({"available": False, "error": "missing backbone atom"}), ""
    ))
    with pytest.raises(ReceptorRepairError, match="missing backbone atom"):
        receptor_repair.run_repair(tmp_path / "input.pdb", tmp_path / "output.pdb", tmp_path / "audit.json")
