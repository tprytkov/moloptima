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
        args[0], 0, json.dumps({"available": True, "pdbfixer_version": "1.12.0", "openmm_version": "8.6.1"}), ""
    ))
    status = receptor_repair.repair_runtime_status()
    assert status["available"] is True
    assert status["resolution_source"] == "environment_override"


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
