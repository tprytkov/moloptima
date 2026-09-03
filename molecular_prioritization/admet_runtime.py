"""Resolve packaged ADMET runners and their isolated, manifest-bound runtimes."""

from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Mapping

from molecular_prioritization.admet_release import PROJECT_ROOT, sha256_file


RESOURCE_SCHEMA_VERSION = "moloptima-admet-runtime-resources-v1"
RESOURCE_MANIFEST_RELATIVE_PATH = Path("resources/admet/runtime_manifest.json")
RUNTIME_PACKAGES = ("python", "chemprop", "lightning", "numpy", "rdkit", "torch")
RUNTIME_PROBE_TIMEOUT_SECONDS = 300
ISOLATED_RUNTIME_ENVIRONMENT_KEYS = {"RDBASE"}
FAMILY_ENVIRONMENT = {
    "gmc_mpnn_bbb": ("MOLOPTIMA_GMC_PYTHON", "MOLOPTIMA_GMC_RUNNER"),
    "chemprop_regression": ("MOLOPTIMA_CHEMPROP_PYTHON", "MOLOPTIMA_CHEMPROP_RUNNER"),
}
RUNTIME_PROBE = r"""
import importlib
import importlib.metadata
import json
import platform

versions = {"python": platform.python_version()}
for name in ("chemprop", "lightning", "numpy", "rdkit", "torch"):
    importlib.import_module(name)
    versions[name] = str(importlib.metadata.version(name))
print("MOLOPTIMA_RUNTIME=" + json.dumps(versions, sort_keys=True))
"""


class ADMETRuntimeError(RuntimeError):
    """A fail-closed runner/runtime resource failure with a stable code."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code


@dataclass(frozen=True)
class ResolvedADMETRuntime:
    python: Path
    runner: Path
    python_source: str
    runner_source: str
    versions: Mapping[str, str]
    identity: Mapping[str, object]


PORTABLE_RUNTIME_IDENTITY_FIELDS = (
    "family", "status", "runtime_source", "model_source",
    "release_archive_sha256", "release_manifest_sha256",
    "runner_identity", "runner_sha256", "runner_resolution_source",
    "python_resolution_source", "runtime_manifest_schema_version",
    "runtime_versions", "production_manifest_identity",
)


def portable_runtime_identity(value: Mapping[str, object]) -> dict[str, object]:
    """Return the portable, public-safe subset of one execution identity."""

    result: dict[str, object] = {}
    for key in PORTABLE_RUNTIME_IDENTITY_FIELDS:
        item = value.get(key)
        if item is None or item == "":
            continue
        if key in {"runtime_versions", "production_manifest_identity"}:
            if isinstance(item, Mapping):
                result[key] = {
                    str(name): scalar
                    for name, scalar in sorted(item.items(), key=lambda pair: str(pair[0]))
                    if _portable_scalar(scalar)
                }
            continue
        if _portable_scalar(item):
            result[key] = item
    return result


def _portable_scalar(value: object) -> bool:
    if value is None or isinstance(value, (int, float, bool)):
        return True
    if not isinstance(value, str):
        return False
    normalized = value.replace("\\", "/")
    return not (
        normalized.startswith("/")
        or (len(normalized) >= 3 and normalized[0].isalpha() and normalized[1:3] == ":/")
    )


def portable_runtime_identities(values: object) -> list[dict[str, object]]:
    """Normalize persisted execution identities with deterministic family ordering."""

    if not isinstance(values, (list, tuple)):
        return []
    identities = [portable_runtime_identity(item) for item in values if isinstance(item, Mapping)]
    return sorted(
        (item for item in identities if item.get("family")),
        key=lambda item: str(item["family"]),
    )


def isolated_runtime_environment(
    environ: Mapping[str, str] | None = None,
) -> dict[str, str]:
    """Preserve the host environment without leaking RDKit data roots."""

    source = os.environ if environ is None else environ
    return {
        key: value
        for key, value in source.items()
        if key.upper() not in ISOLATED_RUNTIME_ENVIRONMENT_KEYS
    }


def resolve_admet_runtime(
    family: str,
    *,
    model_manifest: Path,
    application_root: str | Path | None = None,
    python_override: str | Path | None = None,
    runner_override: str | Path | None = None,
    environ: Mapping[str, str] | None = None,
    command_runner: Callable[..., object] = subprocess.run,
) -> ResolvedADMETRuntime:
    """Resolve overrides or verified packaged resources without current-Python fallback."""

    if family not in FAMILY_ENVIRONMENT:
        raise ADMETRuntimeError("runtime_manifest_invalid", "unknown ADMET model family")
    root = Path(application_root).resolve() if application_root is not None else PROJECT_ROOT
    resource_manifest = _load_resource_manifest(root)
    family_spec = resource_manifest["families"].get(family)
    if not isinstance(family_spec, dict):
        raise ADMETRuntimeError("runtime_manifest_invalid", "model family entry is missing")
    environment = os.environ if environ is None else environ
    python_env, runner_env = FAMILY_ENVIRONMENT[family]

    runner_value = runner_override or environment.get(runner_env, "").strip()
    if runner_value:
        runner = Path(runner_value).expanduser()
        runner_source = "explicit_override" if runner_override else "environment_override"
        if not runner.is_file():
            raise ADMETRuntimeError("runner_override_invalid", "configured runner does not exist")
    else:
        runner = _relative_resource(root, family_spec.get("runner_relative_path"))
        if not runner.is_file():
            raise ADMETRuntimeError("packaged_runner_missing", "bundled validated runner is unavailable")
        expected_sha = family_spec.get("runner_sha256")
        if not isinstance(expected_sha, str) or sha256_file(runner) != expected_sha:
            raise ADMETRuntimeError("packaged_runner_hash_mismatch", "bundled runner failed SHA-256 verification")
        runner_source = "packaged"

    python_value = python_override or environment.get(python_env, "").strip()
    if python_value:
        python = Path(python_value).expanduser()
        python_source = "explicit_override" if python_override else "environment_override"
        if not python.is_file():
            raise ADMETRuntimeError("runtime_override_invalid", "configured family Python does not exist")
    else:
        candidates = family_spec.get("python_relative_candidates")
        if not isinstance(candidates, list) or not all(isinstance(item, str) for item in candidates):
            raise ADMETRuntimeError("runtime_manifest_invalid", "packaged Python candidates are invalid")
        python = next(
            (candidate for value in candidates if (candidate := _relative_resource(root, value)).is_file()),
            None,
        )
        if python is None:
            raise ADMETRuntimeError("packaged_runtime_missing", "isolated family Python runtime is unavailable")
        python_source = "packaged"

    expected_versions = _load_expected_versions(
        family, model_manifest, family_spec.get("runtime_contract_manifest_version")
    )
    observed_versions = _verify_runtime(python, expected_versions, command_runner)
    sources = {python_source, runner_source}
    runtime_source = sources.pop() if len(sources) == 1 else "+".join(sorted(sources))
    identity = portable_runtime_identity({
        "family": family,
        "runtime_source": runtime_source,
        "runner_identity": family_spec.get("runner_identity") if runner_source == "packaged" else None,
        "runner_sha256": sha256_file(runner),
        "runner_resolution_source": runner_source,
        "python_resolution_source": python_source,
        "runtime_manifest_schema_version": resource_manifest.get("schema_version"),
        "runtime_versions": observed_versions,
    })
    return ResolvedADMETRuntime(
        python=python.resolve(),
        runner=runner.resolve(),
        python_source=python_source,
        runner_source=runner_source,
        versions=observed_versions,
        identity=identity,
    )


def _load_resource_manifest(root: Path) -> dict[str, object]:
    path = root / RESOURCE_MANIFEST_RELATIVE_PATH
    try:
        payload = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ADMETRuntimeError("runtime_manifest_invalid", "runtime resource manifest is unavailable") from exc
    if not isinstance(payload, dict) or payload.get("schema_version") != RESOURCE_SCHEMA_VERSION or not isinstance(
        payload.get("families"), dict
    ):
        raise ADMETRuntimeError("runtime_manifest_invalid", "unsupported runtime resource schema")
    return payload


def _relative_resource(root: Path, value: object) -> Path:
    if not isinstance(value, str) or not value or Path(value).is_absolute():
        raise ADMETRuntimeError("runtime_manifest_invalid", "resource path must be application-relative")
    return (root / Path(*value.replace("\\", "/").split("/"))).resolve()


def _load_expected_versions(
    family: str, model_manifest: Path, expected_manifest_version: object
) -> dict[str, str]:
    try:
        payload = json.loads(model_manifest.read_text(encoding="utf-8-sig"))
        if family == "gmc_mpnn_bbb":
            manifest_version = payload["manifest_version"]
            versions = payload["environment"]["packages"]
        else:
            manifest_version = payload["schema_version"]
            versions = payload["environment"]["expected_pinned"]["package_versions"]
        expected = {name: versions[name] for name in RUNTIME_PACKAGES}
    except (OSError, UnicodeError, json.JSONDecodeError, KeyError, TypeError) as exc:
        raise ADMETRuntimeError(
            "model_release_manifest_invalid", "authoritative runtime contract is unavailable"
        ) from exc
    if manifest_version != expected_manifest_version:
        raise ADMETRuntimeError(
            "model_release_manifest_invalid", "runtime contract manifest version is unsupported"
        )
    if not all(isinstance(value, str) and value for value in expected.values()):
        raise ADMETRuntimeError("model_release_manifest_invalid", "runtime contract contains invalid versions")
    return expected


def _verify_runtime(
    python: Path,
    expected: Mapping[str, str],
    command_runner: Callable[..., object],
) -> dict[str, str]:
    try:
        completed = command_runner(
            [str(python), "-c", RUNTIME_PROBE],
            capture_output=True,
            env=isolated_runtime_environment(),
            text=True,
            shell=False,
            timeout=RUNTIME_PROBE_TIMEOUT_SECONDS,
        )
        if getattr(completed, "returncode", 1) != 0:
            raise ValueError("runtime probe failed")
        line = next(
            value.removeprefix("MOLOPTIMA_RUNTIME=")
            for value in str(getattr(completed, "stdout", "")).splitlines()
            if value.startswith("MOLOPTIMA_RUNTIME=")
        )
        observed = json.loads(line)
    except (OSError, subprocess.SubprocessError, StopIteration, ValueError, json.JSONDecodeError) as exc:
        raise ADMETRuntimeError("runtime_incompatible", "family runtime compatibility probe failed") from exc
    if not isinstance(observed, dict):
        raise ADMETRuntimeError("runtime_incompatible", "family runtime returned an invalid probe result")
    mismatches = [name for name in RUNTIME_PACKAGES if observed.get(name) != expected[name]]
    if mismatches:
        raise ADMETRuntimeError(
            "runtime_incompatible", "family runtime does not match the frozen model release contract"
        )
    return {name: str(observed[name]) for name in RUNTIME_PACKAGES}
