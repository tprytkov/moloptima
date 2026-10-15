"""Fail-closed adapter for isolated, pose-specific ProLIF fingerprints."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Mapping

from molecular_prioritization.admet_release import PROJECT_ROOT, sha256_file
from molecular_prioritization.admet_runtime import isolated_runtime_environment
from molecular_prioritization.model_sources import resolve_runtime_data_root, write_manifest


RUNTIME_MANIFEST = Path("resources/prolif/runtime_manifest.json")
RUNTIME_SCHEMA = "moloptima-prolif-runtime-resources-v1"
REQUEST_SCHEMA = "moloptima-prolif-runner-request-v1"
FINGERPRINT_SCHEMA = "moloptima-interaction-fingerprint-v1"
PYTHON_ENV = "MOLOPTIMA_PROLIF_PYTHON"
RUNNER_ENV = "MOLOPTIMA_PROLIF_RUNNER"
DEFAULT_TIMEOUT_SECONDS = 300


class InteractionAnalysisError(RuntimeError):
    """A typed analysis-only failure that never changes docking validity."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code


@dataclass(frozen=True)
class ResolvedProLIFRuntime:
    python: Path
    runner: Path
    python_source: str
    runner_source: str
    versions: Mapping[str, str]
    manifest: Mapping[str, object]


_verified_runtime_cache_lock = threading.Lock()
_verified_runtime_cache: tuple[tuple[object, ...], ResolvedProLIFRuntime] | None = None


def _prolif_runtime_environment(environ: Mapping[str, str] | None) -> dict[str, str]:
    """Keep packaged ProLIF resources read-only by disabling bytecode writes."""

    environment = isolated_runtime_environment(environ)
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    return environment


def _load_manifest(root: Path) -> dict[str, object]:
    try:
        manifest = json.loads((root / RUNTIME_MANIFEST).read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise InteractionAnalysisError("interaction_runtime_incompatible", "runtime manifest is unavailable") from exc
    if manifest.get("schema_version") != RUNTIME_SCHEMA:
        raise InteractionAnalysisError("interaction_runtime_incompatible", "runtime manifest schema is unsupported")
    return manifest


def _relative(root: Path, value: object) -> Path:
    if not isinstance(value, str) or not value or Path(value).is_absolute():
        raise InteractionAnalysisError("interaction_runtime_incompatible", "runtime resource path is invalid")
    return (root / Path(*value.replace("\\", "/").split("/"))).resolve()


def _run(command_runner: Callable[..., object], args: list[str], **kwargs: object) -> object:
    try:
        return command_runner(args, **kwargs)
    except subprocess.TimeoutExpired as exc:
        raise InteractionAnalysisError("interaction_runtime_timeout", "isolated ProLIF process timed out") from exc
    except OSError as exc:
        raise InteractionAnalysisError("interaction_runtime_unavailable", "isolated ProLIF process could not start") from exc


def _runtime_file_identity(path: Path) -> tuple[str, int, int]:
    try:
        stat = path.stat()
    except OSError as exc:
        raise InteractionAnalysisError("interaction_runtime_unavailable", "isolated ProLIF runtime file is unavailable") from exc
    return str(path.resolve()), stat.st_size, stat.st_mtime_ns


def _verified_runtime_identity(
    *,
    root: Path,
    python: Path,
    runner: Path,
    python_source: str,
    runner_source: str,
    manifest: Mapping[str, object],
    command_runner: Callable[..., object],
) -> tuple[object, ...]:
    manifest_identity = hashlib.sha256(
        json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return (
        str(root),
        _runtime_file_identity(python),
        _runtime_file_identity(runner),
        python_source,
        runner_source,
        manifest_identity,
        id(command_runner),
    )


def resolve_prolif_runtime(
    *,
    application_root: str | Path | None = None,
    python_override: str | Path | None = None,
    runner_override: str | Path | None = None,
    environ: Mapping[str, str] | None = None,
    command_runner: Callable[..., object] = subprocess.run,
    verify_runtime: bool = True,
) -> ResolvedProLIFRuntime:
    """Resolve and verify an isolated runtime; current-Python fallback is forbidden."""

    root = Path(application_root).resolve() if application_root is not None else PROJECT_ROOT
    manifest = _load_manifest(root)
    values = os.environ if environ is None else environ
    runner_value = runner_override or str(values.get(RUNNER_ENV, "")).strip()
    if runner_value:
        runner = Path(runner_value).expanduser()
        runner_source = "explicit_override" if runner_override else "environment_override"
    else:
        runner = _relative(root, manifest.get("runner_relative_path"))
        runner_source = "packaged"
        if not runner.is_file() or sha256_file(runner) != manifest.get("runner_sha256"):
            raise InteractionAnalysisError("interaction_runtime_incompatible", "packaged runner failed SHA-256 verification")
    if not runner.is_file():
        raise InteractionAnalysisError("interaction_runtime_unavailable", "isolated ProLIF runner is unavailable")

    python_value = python_override or str(values.get(PYTHON_ENV, "")).strip()
    if python_value:
        python = Path(python_value).expanduser()
        python_source = "explicit_override" if python_override else "environment_override"
    else:
        candidates = manifest.get("python_relative_candidates", [])
        if not isinstance(candidates, list):
            raise InteractionAnalysisError("interaction_runtime_incompatible", "packaged Python candidates are invalid")
        python = next((candidate for value in candidates if (candidate := _relative(root, value)).is_file()), None)
        python_source = "packaged"
    if python is None or not python.is_file():
        raise InteractionAnalysisError("interaction_runtime_unavailable", "isolated ProLIF Python is unavailable")

    expected = manifest.get("expected_versions")
    if not isinstance(expected, dict) or not all(isinstance(key, str) and isinstance(value, str) for key, value in expected.items()):
        raise InteractionAnalysisError("interaction_runtime_incompatible", "frozen runtime versions are invalid")
    observed: Mapping[str, object] = expected
    if verify_runtime:
        cache_identity = _verified_runtime_identity(
            root=root,
            python=python,
            runner=runner,
            python_source=python_source,
            runner_source=runner_source,
            manifest=manifest,
            command_runner=command_runner,
        )
        global _verified_runtime_cache
        with _verified_runtime_cache_lock:
            if _verified_runtime_cache is not None and _verified_runtime_cache[0] == cache_identity:
                return _verified_runtime_cache[1]
            with tempfile.TemporaryDirectory(prefix="moloptima-prolif-probe-") as temporary:
                output = Path(temporary) / "probe.json"
                completed = _run(
                    command_runner,
                    [str(python), str(runner), "--probe", "--output", str(output)],
                    capture_output=True,
                    text=True,
                    shell=False,
                    env=_prolif_runtime_environment(values),
                    timeout=DEFAULT_TIMEOUT_SECONDS,
                )
                if getattr(completed, "returncode", 1) != 0:
                    raise InteractionAnalysisError("interaction_runtime_incompatible", "isolated runtime probe failed")
                try:
                    probe = json.loads(output.read_text(encoding="utf-8"))
                    observed = probe["versions"]
                except (OSError, KeyError, TypeError, json.JSONDecodeError) as exc:
                    raise InteractionAnalysisError("interaction_output_malformed", "runtime probe output is malformed") from exc
            if any(observed.get(name) != version for name, version in expected.items()):
                raise InteractionAnalysisError("interaction_runtime_incompatible", "runtime versions differ from the frozen manifest")
            resolved = ResolvedProLIFRuntime(
                python=python.resolve(), runner=runner.resolve(), python_source=python_source,
                runner_source=runner_source, versions={key: str(value) for key, value in observed.items()},
                manifest=manifest,
            )
            _verified_runtime_cache = (cache_identity, resolved)
            return resolved
    if any(observed.get(name) != version for name, version in expected.items()):
        raise InteractionAnalysisError("interaction_runtime_incompatible", "runtime versions differ from the frozen manifest")
    return ResolvedProLIFRuntime(
        python=python.resolve(), runner=runner.resolve(), python_source=python_source,
        runner_source=runner_source, versions={key: str(value) for key, value in observed.items()},
        manifest=manifest,
    )


def _canonical_hash(value: object) -> str:
    serialized = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(serialized).hexdigest()


def _scientific_fingerprint_payload(result: Mapping[str, object]) -> dict[str, object]:
    excluded = {
        "fingerprint_sha256", "performance_seconds", "runtime_diagnostics",
        "cache_identity", "cache_key", "cache_status",
    }
    return {key: value for key, value in result.items() if key not in excluded}


def _cache_identity(contract: Mapping[str, object], runtime: ResolvedProLIFRuntime) -> dict[str, object]:
    pose = contract["pose"]
    receptor = contract["receptor_analysis"]
    mapping = contract["template_pose_atom_mapping"]
    return {
        "input_schema_version": contract["schema_version"],
        "receptor_sha256": contract["authoritative_receptor_sha256"],
        "receptor_policy_version": receptor["policy_version"],
        "ligand_template_sha256": contract["ligand_template"]["sdf_sha256"],
        "parent_pose_sha256": pose["parent_pose_sha256"],
        "model_sha256": pose["model_sha256"],
        "model_number": pose["model_number"],
        "mapping_schema_version": mapping["schema_version"],
        "runner_version": runtime.manifest["runner_version"],
        "runner_sha256": sha256_file(runtime.runner),
        "runtime_versions": dict(runtime.versions),
        "interaction_configuration": runtime.manifest["supported_interactions"],
    }


def _validate_output(result: object, identity: Mapping[str, object] | None = None) -> dict[str, object]:
    if not isinstance(result, dict) or result.get("schema_version") != FINGERPRINT_SCHEMA:
        raise InteractionAnalysisError("interaction_output_malformed", "fingerprint output schema is invalid")
    if result.get("status") != "success":
        code = result.get("error_code", "interaction_runtime_failed")
        allowed = {
            "interaction_runtime_unavailable", "interaction_runtime_timeout", "interaction_runtime_failed",
            "interaction_runtime_incompatible", "interaction_output_malformed", "interaction_input_invalid",
        }
        raise InteractionAnalysisError(code if code in allowed else "interaction_runtime_failed", str(result.get("message", "analysis failed")))
    tokens = result.get("canonical_tokens")
    records = result.get("raw_interaction_records")
    if not isinstance(tokens, list) or tokens != sorted(set(tokens)) or not isinstance(records, list):
        raise InteractionAnalysisError("interaction_output_malformed", "fingerprint tokens or records are invalid")
    fingerprint_hash = result.get("fingerprint_sha256")
    if not isinstance(fingerprint_hash, str) or fingerprint_hash != _canonical_hash(_scientific_fingerprint_payload(result)):
        raise InteractionAnalysisError("interaction_output_malformed", "scientific fingerprint SHA-256 does not match")
    if identity is not None and result.get("cache_identity") != identity:
        raise InteractionAnalysisError("interaction_output_malformed", "cache identity does not match")
    return result


def get_cached_docking_pose_interactions(
    analysis_input: Mapping[str, object],
    *,
    cache_root: str | Path | None = None,
    application_root: str | Path | None = None,
    python_override: str | Path | None = None,
    runner_override: str | Path | None = None,
    environ: Mapping[str, str] | None = None,
) -> dict[str, object] | None:
    """Return one validated cached fingerprint without starting the isolated runtime."""

    if analysis_input.get("schema_version") not in {
        "moloptima-interaction-analysis-input-v1",
        "moloptima-interaction-analysis-input-v2",
    }:
        raise InteractionAnalysisError("interaction_input_invalid", "analysis input schema is unsupported")
    runtime = resolve_prolif_runtime(
        application_root=application_root,
        python_override=python_override,
        runner_override=runner_override,
        environ=environ,
        verify_runtime=False,
    )
    identity = _cache_identity(analysis_input, runtime)
    key = _canonical_hash(identity)
    root = (
        Path(cache_root)
        if cache_root is not None
        else resolve_runtime_data_root(environ=dict(environ) if environ is not None else None)
        / "interaction_analysis_cache"
    )
    cache_path = root / "v1" / f"{key}.json"
    if not cache_path.is_file():
        return None
    started = time.perf_counter()
    try:
        cached = _validate_output(json.loads(cache_path.read_text(encoding="utf-8")), identity)
    except (OSError, UnicodeError, json.JSONDecodeError, InteractionAnalysisError):
        return None
    returned = dict(cached)
    returned["cache_status"] = "hit"
    returned.setdefault("performance_seconds", {})["cached_retrieval"] = round(
        time.perf_counter() - started, 8
    )
    return returned


def analyze_docking_pose_interactions(
    analysis_input: Mapping[str, object],
    *,
    ligand_template_path: str | Path,
    receptor_topology_path: str | Path,
    prepared_receptor_path: str | Path,
    ligand_input_pdbqt_path: str | Path | None = None,
    cache_root: str | Path | None = None,
    application_root: str | Path | None = None,
    python_override: str | Path | None = None,
    runner_override: str | Path | None = None,
    environ: Mapping[str, str] | None = None,
    command_runner: Callable[..., object] = subprocess.run,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
) -> dict[str, object]:
    """Run optional interaction analysis without mutating or revalidating docking."""

    if analysis_input.get("schema_version") not in {
        "moloptima-interaction-analysis-input-v1",
        "moloptima-interaction-analysis-input-v2",
    }:
        raise InteractionAnalysisError("interaction_input_invalid", "analysis input schema is unsupported")
    if analysis_input.get("schema_version") == "moloptima-interaction-analysis-input-v2" and ligand_input_pdbqt_path is None:
        raise InteractionAnalysisError("interaction_input_invalid", "v2 analysis requires the persisted ligand input PDBQT")
    runtime = resolve_prolif_runtime(
        application_root=application_root, python_override=python_override,
        runner_override=runner_override, environ=environ, command_runner=command_runner,
        verify_runtime=False,
    )
    identity = _cache_identity(analysis_input, runtime)
    key = _canonical_hash(identity)
    root = Path(cache_root) if cache_root is not None else resolve_runtime_data_root(environ=dict(environ) if environ is not None else None) / "interaction_analysis_cache"
    cache_path = root / "v1" / f"{key}.json"
    cache_started = time.perf_counter()
    if cache_path.is_file():
        try:
            cached = _validate_output(json.loads(cache_path.read_text(encoding="utf-8")), identity)
            returned = dict(cached)
            returned["cache_status"] = "hit"
            returned.setdefault("performance_seconds", {})["cached_retrieval"] = round(time.perf_counter() - cache_started, 8)
            return returned
        except (OSError, UnicodeError, json.JSONDecodeError, InteractionAnalysisError):
            pass

    verified_runtime = resolve_prolif_runtime(
        application_root=application_root, python_override=python_override,
        runner_override=runner_override, environ=environ, command_runner=command_runner,
        verify_runtime=True,
    )
    verified_identity = _cache_identity(analysis_input, verified_runtime)
    if verified_identity != identity:
        raise InteractionAnalysisError("interaction_runtime_incompatible", "verified runtime identity differs from cache identity")
    runtime = verified_runtime

    request = {
        "schema_version": REQUEST_SCHEMA,
        "analysis_input": dict(analysis_input),
        "ligand_template_path": str(Path(ligand_template_path).resolve()),
        "receptor_topology_path": str(Path(receptor_topology_path).resolve()),
        "prepared_receptor_path": str(Path(prepared_receptor_path).resolve()),
    }
    if ligand_input_pdbqt_path is not None:
        request["ligand_input_pdbqt_path"] = str(Path(ligand_input_pdbqt_path).resolve())
    with tempfile.TemporaryDirectory(prefix="moloptima-prolif-run-") as temporary:
        request_path = Path(temporary) / "request.json"
        output_path = Path(temporary) / "output.json"
        request_path.write_text(json.dumps(request, sort_keys=True), encoding="utf-8")
        subprocess_started = time.perf_counter()
        completed = _run(
            command_runner,
            [str(runtime.python), str(runtime.runner), "--request", str(request_path), "--output", str(output_path)],
            capture_output=True, text=True, shell=False,
            env=_prolif_runtime_environment(environ), timeout=timeout_seconds,
        )
        startup_and_execution = time.perf_counter() - subprocess_started
        try:
            output = json.loads(output_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            if getattr(completed, "returncode", 1) != 0:
                raise InteractionAnalysisError("interaction_runtime_failed", "isolated ProLIF runner failed") from exc
            raise InteractionAnalysisError("interaction_output_malformed", "isolated ProLIF output is malformed") from exc
        result = _validate_output(output)
        if getattr(completed, "returncode", 1) != 0:
            raise InteractionAnalysisError("interaction_runtime_failed", "isolated ProLIF runner returned a failure exit")
    result["runtime_diagnostics"] = {
        "python_resolution_source": runtime.python_source,
        "runner_resolution_source": runtime.runner_source,
        "stderr": str(getattr(completed, "stderr", "")),
        "stdout": str(getattr(completed, "stdout", "")),
    }
    result.setdefault("performance_seconds", {})["subprocess_startup_and_execution"] = round(startup_and_execution, 8)
    runner_total = result["performance_seconds"].get("runner_total")
    if isinstance(runner_total, (int, float)):
        result["performance_seconds"]["subprocess_startup_overhead"] = round(
            max(0.0, startup_and_execution - float(runner_total)), 8
        )
    result["cache_identity"] = identity
    result["cache_key"] = key
    cache_write_started = time.perf_counter()
    write_manifest(cache_path, result)
    result["performance_seconds"]["cache_write"] = round(time.perf_counter() - cache_write_started, 8)
    result["cache_status"] = "miss"
    return result


def compare_interaction_fingerprints(
    first: Mapping[str, object] | None,
    second: Mapping[str, object] | None,
) -> dict[str, object]:
    """Compare unique canonical tokens under strict scientific compatibility."""

    started = time.perf_counter()
    if not first or not second or first.get("status") != "success" or second.get("status") != "success":
        return {"interaction_fingerprint_similarity": None, "status": "fingerprint_unavailable"}
    compatibility_fields = (
        ("schema_version",),
        ("receptor", "identity"),
        ("receptor", "authoritative_sha256"),
        ("receptor", "policy_version"),
        ("interaction_configuration",),
        ("mapping_schema_version",),
        ("runtime_provenance", "runner_version"),
        ("runtime_provenance", "versions"),
    )
    for path in compatibility_fields:
        left: object = first
        right: object = second
        for key in path:
            left = left.get(key) if isinstance(left, Mapping) else None
            right = right.get(key) if isinstance(right, Mapping) else None
        if left != right:
            return {"interaction_fingerprint_similarity": None, "status": "incompatible_receptor_context"}
    left_tokens = set(first.get("canonical_tokens", []))
    right_tokens = set(second.get("canonical_tokens", []))
    union = left_tokens | right_tokens
    if not union:
        return {"interaction_fingerprint_similarity": None, "status": "both_empty"}
    similarity = len(left_tokens & right_tokens) / len(union)
    return {
        "interaction_fingerprint_similarity": similarity,
        "status": "valid",
        "intersection_count": len(left_tokens & right_tokens),
        "union_count": len(union),
        "performance_seconds": {"jaccard_comparison": round(time.perf_counter() - started, 8)},
    }
