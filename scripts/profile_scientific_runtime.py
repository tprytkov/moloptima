"""Profile packaged ProLIF discovery/imports and optional Design Logic synthesis.

This is a diagnostic tool. It does not enforce timing thresholds and does not
modify runtime resources or scientific caches.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Callable, Iterable


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def _summary(values: Iterable[float]) -> dict[str, float]:
    samples = list(values)
    if not samples:
        return {"minimum": 0.0, "median": 0.0, "maximum": 0.0}
    return {
        "minimum": min(samples),
        "median": statistics.median(samples),
        "maximum": max(samples),
    }


def _timed(operation: Callable[[], object]) -> tuple[object, float]:
    started = time.perf_counter()
    result = operation()
    return result, time.perf_counter() - started


def profile_resolution(application_root: Path, repetitions: int) -> dict[str, object]:
    """Measure deterministic resolution stages without mixing in science work."""

    rows: list[dict[str, float]] = []
    for _ in range(repetitions):
        row: dict[str, float] = {}
        root, row["application_resource_root_discovery"] = _timed(application_root.resolve)
        manifest_path = root / "resources" / "prolif" / "runtime_manifest.json"
        manifest, row["manifest_load"] = _timed(
            lambda: json.loads(manifest_path.read_text(encoding="utf-8-sig"))
        )
        candidates: list[Path] = []

        def construct_candidates() -> Path:
            runner = (root / Path(str(manifest["runner_relative_path"]))).resolve()
            candidates.extend(
                (root / Path(str(value))).resolve()
                for value in manifest["python_relative_candidates"]
            )
            return runner

        runner, row["candidate_path_construction"] = _timed(construct_candidates)

        def select_python() -> Path:
            if not runner.is_file():
                raise RuntimeError("packaged runner is unavailable")
            return next(candidate for candidate in candidates if candidate.is_file())

        python, row["candidate_filesystem_checks"] = _timed(select_python)

        def canonicalize_manifest() -> str:
            encoded = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
            return hashlib.sha256(encoded).hexdigest()

        manifest_identity, row["manifest_canonicalization"] = _timed(canonicalize_manifest)

        def metadata() -> tuple[os.stat_result, os.stat_result]:
            return python.stat(), runner.stat()

        (python_stat, runner_stat), row["interpreter_runner_metadata"] = _timed(metadata)

        def validate_runner() -> str:
            digest = hashlib.sha256(runner.read_bytes()).hexdigest()
            if digest != manifest["runner_sha256"]:
                raise RuntimeError("packaged runner SHA-256 differs from manifest")
            return digest

        _, row["runner_sha256_validation"] = _timed(validate_runner)

        def assemble_identity() -> tuple[object, ...]:
            return (
                str(root),
                (str(python.resolve()), python_stat.st_size, python_stat.st_mtime_ns),
                (str(runner.resolve()), runner_stat.st_size, runner_stat.st_mtime_ns),
                manifest_identity,
            )

        _, row["qualification_identity_assembly"] = _timed(assemble_identity)
        environment = {
            key: value
            for key, value in os.environ.items()
            if key.upper() != "MOLOPTIMA_PROLIF_PYTHON"
        }
        environment["PYTHONDONTWRITEBYTECODE"] = "1"
        with tempfile.TemporaryDirectory(prefix="moloptima-runtime-profile-") as temporary:
            output = Path(temporary) / "probe.json"

            def probe() -> subprocess.CompletedProcess[str]:
                completed = subprocess.run(
                    [str(python), str(runner), "--probe", "--output", str(output)],
                    capture_output=True,
                    text=True,
                    shell=False,
                    env=environment,
                    timeout=300,
                )
                if completed.returncode != 0:
                    raise RuntimeError("packaged runtime probe failed")
                return completed

            _, row["subprocess_package_import_version_probe"] = _timed(probe)

            def validate_probe() -> None:
                observed = json.loads(output.read_text(encoding="utf-8"))["versions"]
                expected = manifest["expected_versions"]
                if any(observed.get(name) != version for name, version in expected.items()):
                    raise RuntimeError("packaged versions differ from manifest")

            _, row["qualification_result_validation"] = _timed(validate_probe)
        row["total_cold_resolution"] = sum(row.values())
        rows.append(row)
    return {
        "repetitions": repetitions,
        "samples": rows,
        "summary": {
            name: _summary(row[name] for row in rows)
            for name in rows[0]
        },
    }


def profile_imports(application_root: Path, repetitions: int) -> dict[str, object]:
    manifest = json.loads(
        (application_root / "resources" / "prolif" / "runtime_manifest.json").read_text(
            encoding="utf-8-sig"
        )
    )
    python = next(
        candidate
        for value in manifest["python_relative_candidates"]
        if (candidate := (application_root / Path(str(value))).resolve()).is_file()
    )
    environment = dict(os.environ)
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    operations = {
        "python_startup": "pass",
        "rdkit_import": "import rdkit",
        "mdanalysis_import": "import MDAnalysis",
        "prolif_import": "import prolif",
    }
    samples: dict[str, list[float]] = {name: [] for name in operations}
    for _ in range(repetitions):
        for name, source in operations.items():
            started = time.perf_counter()
            completed = subprocess.run(
                [str(python), "-c", source],
                capture_output=True,
                text=True,
                shell=False,
                env=environment,
                timeout=300,
            )
            elapsed = time.perf_counter() - started
            if completed.returncode != 0:
                raise RuntimeError(f"{name} failed: {completed.stderr.strip()}")
            samples[name].append(elapsed)
    return {
        "repetitions": repetitions,
        "samples": samples,
        "summary": {name: _summary(values) for name, values in samples.items()},
    }


def profile_warm_resolution(application_root: Path, repetitions: int) -> dict[str, object]:
    """Populate the production process-local cache, then time cache validation."""

    from molecular_prioritization import interaction_fingerprints

    interaction_fingerprints._verified_runtime_cache = None
    environment = {
        key: value
        for key, value in os.environ.items()
        if key.upper() != "MOLOPTIMA_PROLIF_PYTHON"
    }
    interaction_fingerprints.resolve_prolif_runtime(
        application_root=application_root,
        environ=environment,
    )
    samples = []
    for _ in range(repetitions):
        started = time.perf_counter()
        interaction_fingerprints.resolve_prolif_runtime(
            application_root=application_root,
            environ=environment,
        )
        samples.append(time.perf_counter() - started)
    return {"repetitions": repetitions, "samples": samples, "summary": _summary(samples)}


def profile_design_logic(
    job_id: str,
    reference_molecule_id: str,
    comparison_molecule_ids: list[str],
    repetitions: int,
) -> dict[str, object]:
    from backend import design_logic_service

    if len(comparison_molecule_ids) < 5:
        raise ValueError("Design Logic profiling requires five comparison molecule IDs")
    results: dict[str, object] = {}
    for count in (1, 4, 5):
        selected = comparison_molecule_ids[:count]
        totals: list[float] = []
        workspace_times: list[float] = []
        pharmacophore_times: list[float] = []
        assembly_times: list[float] = []
        serialization_times: list[float] = []
        for _ in range(repetitions):
            recorded: dict[str, float] = {}

            def workspace_loader(*args: object, **kwargs: object) -> dict[str, object]:
                payload, elapsed = _timed(
                    lambda: design_logic_service.workspace(*args, **kwargs)
                )
                recorded["workspace"] = elapsed
                return payload  # type: ignore[return-value]

            def pharmacophore_loader(*args: object, **kwargs: object) -> dict[str, object]:
                payload, elapsed = _timed(
                    lambda: design_logic_service.pharmacophore_workspace(*args, **kwargs)
                )
                recorded["pharmacophore"] = elapsed
                return payload  # type: ignore[return-value]

            started = time.perf_counter()
            payload = design_logic_service.cross_layer_evidence(
                job_id,
                reference_molecule_id,
                1,
                selected,
                1,
                1.5,
                workspace_loader=workspace_loader,
                pharmacophore_loader=pharmacophore_loader,
            )
            total = time.perf_counter() - started
            _, serialization = _timed(
                lambda: json.dumps(payload, sort_keys=True, separators=(",", ":"))
            )
            totals.append(total)
            workspace_times.append(recorded["workspace"])
            pharmacophore_times.append(recorded["pharmacophore"])
            assembly_times.append(
                max(0.0, total - recorded["workspace"] - recorded["pharmacophore"])
            )
            serialization_times.append(serialization)
        results[f"1_plus_{count}"] = {
            "comparison_count": count,
            "total": _summary(totals),
            "workspace_input_and_cached_layers": _summary(workspace_times),
            "pharmacophore_retrieval_and_calculation": _summary(pharmacophore_times),
            "evidence_assembly": _summary(assembly_times),
            "serialization": _summary(serialization_times),
        }
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application-root", type=Path, required=True)
    parser.add_argument("--repetitions", type=int, default=5)
    parser.add_argument("--skip-imports", action="store_true")
    parser.add_argument("--job-id")
    parser.add_argument("--reference-molecule-id")
    parser.add_argument("--comparison-molecule-id", action="append", default=[])
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.repetitions < 1:
        parser.error("--repetitions must be positive")
    result: dict[str, object] = {
        "schema_version": "moloptima-scientific-runtime-profile-v1",
        "resolution": profile_resolution(args.application_root.resolve(), args.repetitions),
        "warm_cached_resolution": profile_warm_resolution(
            args.application_root.resolve(), args.repetitions
        ),
    }
    if not args.skip_imports:
        result["imports"] = profile_imports(args.application_root.resolve(), args.repetitions)
    if args.job_id or args.reference_molecule_id or args.comparison_molecule_id:
        if not args.job_id or not args.reference_molecule_id or len(args.comparison_molecule_id) < 5:
            parser.error("Design Logic profiling requires job, reference, and five comparisons")
        result["design_logic"] = profile_design_logic(
            args.job_id,
            args.reference_molecule_id,
            args.comparison_molecule_id,
            args.repetitions,
        )
    serialized = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized, encoding="utf-8")
    else:
        print(serialized, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
