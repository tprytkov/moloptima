"""Build the frozen, relocatable Windows ProLIF runtime outside Git."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = PROJECT_ROOT / "resources" / "prolif" / "runtime_manifest.json"
RUNNER_PATH = PROJECT_ROOT / "resources" / "prolif" / "prolif_runner.py"
NOTICE_PATH = PROJECT_ROOT / "resources" / "prolif" / "THIRD_PARTY_NOTICES.md"
DEFAULT_OUTPUT = PROJECT_ROOT / "desktop" / "runtime" / "prolif" / "python"
MATERIAL_PACKAGES = {
    "python", "prolif", "rdkit", "mdanalysis", "numpy", "scipy", "pandas",
    "networkx", "psutil", "dill", "gemmi", "multiprocess", "tqdm",
}
ALLOWED_RELOCATION_METADATA = {"Scripts/conda-unpack-script.py"}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def directory_size(path: Path) -> int:
    return sum(item.stat().st_size for item in path.rglob("*") if item.is_file())


def load_manifest(path: Path = MANIFEST_PATH) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def probe_runtime(python: Path, runner: Path = RUNNER_PATH) -> dict[str, str]:
    with tempfile.TemporaryDirectory(prefix="moloptima-prolif-package-probe-") as temporary:
        output = Path(temporary) / "probe.json"
        probe_environment = os.environ.copy()
        probe_environment["PYTHONDONTWRITEBYTECODE"] = "1"
        completed = subprocess.run(
            [str(python), str(runner), "--probe", "--output", str(output)],
            capture_output=True,
            text=True,
            env=probe_environment,
            shell=False,
            timeout=300,
        )
        if completed.returncode != 0:
            raise RuntimeError(f"ProLIF runtime probe failed: {completed.stderr.strip()}")
        payload = json.loads(output.read_text(encoding="utf-8"))
    versions = payload.get("versions")
    if not isinstance(versions, dict):
        raise RuntimeError("ProLIF runtime probe did not return versions")
    return {str(name): str(version) for name, version in versions.items()}


def validate_versions(observed: dict[str, str], manifest: dict[str, object]) -> None:
    expected = manifest.get("expected_versions")
    if not isinstance(expected, dict):
        raise RuntimeError("runtime manifest expected_versions is invalid")
    mismatches = {
        name: {"expected": version, "observed": observed.get(name)}
        for name, version in expected.items()
        if observed.get(name) != version
    }
    if mismatches:
        raise RuntimeError(f"frozen runtime version mismatch: {json.dumps(mismatches, sort_keys=True)}")


def _safe_extract(archive: Path, destination: Path) -> None:
    destination_resolved = destination.resolve()
    with zipfile.ZipFile(archive) as bundle:
        for member in bundle.infolist():
            target = (destination / member.filename).resolve()
            if target != destination_resolved and destination_resolved not in target.parents:
                raise RuntimeError(f"unsafe archive member: {member.filename}")
        bundle.extractall(destination)


def _copy_license_tree(source: Path, destination: Path) -> list[str]:
    copied: list[str] = []
    if not source.is_dir():
        return copied
    for item in sorted(path for path in source.rglob("*") if path.is_file()):
        relative = item.relative_to(source)
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(item, target)
        copied.append(relative.as_posix())
    return copied


def collect_license_inventory(source_prefix: Path, output: Path) -> list[dict[str, object]]:
    destination = output / "THIRD_PARTY_LICENSES"
    inventory: list[dict[str, object]] = []
    for metadata_path in sorted((source_prefix / "conda-meta").glob("*.json")):
        payload = json.loads(metadata_path.read_text(encoding="utf-8"))
        name = str(payload.get("name", "unknown"))
        version = str(payload.get("version", "unknown"))
        package_destination = destination / f"{name}-{version}"
        extracted = Path(str(payload.get("extracted_package_dir", "")))
        copied = _copy_license_tree(extracted / "info" / "licenses", package_destination)
        inventory.append({
            "name": name,
            "version": version,
            "license": payload.get("license"),
            "material": name.lower() in MATERIAL_PACKAGES,
            "license_files": copied,
        })

    site_packages = output / "Lib" / "site-packages"
    for metadata in sorted(site_packages.glob("*.dist-info")):
        license_files: list[str] = []
        for candidate in (metadata / "licenses", metadata / "LICENSE", metadata / "LICENSE.txt"):
            if candidate.is_dir():
                license_files.extend(_copy_license_tree(candidate, destination / metadata.name))
            elif candidate.is_file():
                target = destination / metadata.name / candidate.name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(candidate, target)
                license_files.append(candidate.name)
        if license_files:
            inventory.append({
                "python_distribution": metadata.name,
                "license_files": sorted(set(license_files)),
            })
    return inventory


def trim_build_residue(output: Path) -> list[str]:
    removed: list[str] = []
    conda_metadata = output / "conda-meta"
    if conda_metadata.is_dir():
        shutil.rmtree(conda_metadata)
        removed.append("conda-meta/")
    for item in list(output.rglob("*")):
        if item.is_dir() and item.name in {"__pycache__", ".pytest_cache"}:
            shutil.rmtree(item)
            removed.append(item.relative_to(output).as_posix() + "/")
        elif item.is_file() and (item.suffix in {".pyc", ".pyo"} or item.name == "direct_url.json"):
            item.unlink()
            removed.append(item.relative_to(output).as_posix())
    return removed


def find_private_prefix_leaks(
    root: Path,
    needles: list[bytes],
    *,
    allowed_paths: set[str] | None = None,
) -> list[str]:
    leaks: list[str] = []
    allowed_paths = allowed_paths or set()
    normalized_needles = {needle.lower() for needle in needles if needle}
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        with path.open("rb") as handle:
            previous = b""
            while chunk := handle.read(1024 * 1024):
                value = (previous + chunk).lower()
                if any(needle in value for needle in normalized_needles):
                    relative = path.relative_to(root).as_posix()
                    if relative not in allowed_paths:
                        leaks.append(relative)
                    break
                previous = value[-512:]
    return leaks


def finalize_existing_runtime(
    source_prefix: Path,
    output: Path,
    *,
    archive_size: int | None = None,
    started: float | None = None,
    trimmed_entry_count: int | None = None,
) -> dict[str, object]:
    """Finish validation without repeating the expensive conda-pack/extract stage."""
    manifest = load_manifest()
    resumed_cleanup = trim_build_residue(output)
    if trimmed_entry_count is None:
        trimmed_entry_count = len(resumed_cleanup)
    else:
        trimmed_entry_count += len(resumed_cleanup)
    packaged_versions = probe_runtime(output / "python.exe")
    validate_versions(packaged_versions, manifest)
    validate_layout(output)
    needles = [
        str(source_prefix).encode(),
        str(Path.home()).encode(),
        os.environ.get("USERNAME", "").encode(),
        str(PROJECT_ROOT).encode(),
    ]
    relocation_metadata = find_private_prefix_leaks(output, needles)
    actionable_leaks = [
        relative for relative in relocation_metadata
        if relative not in ALLOWED_RELOCATION_METADATA
    ]
    if actionable_leaks:
        raise RuntimeError(f"private build-prefix leakage detected: {actionable_leaks[:20]}")

    inventory = json.loads((output / "THIRD_PARTY_LICENSES.json").read_text(encoding="utf-8"))
    manifest_identity = sha256_file(MANIFEST_PATH)
    metadata: dict[str, object] = {
        "schema_version": "moloptima-packaged-prolif-runtime-v1",
        "platform": "win-64",
        "architecture": platform.machine(),
        "versions": packaged_versions,
        "runner_version": manifest["runner_version"],
        "runner_schema_version": manifest["runner_schema_version"],
        "runner_sha256": manifest["runner_sha256"],
        "runtime_manifest_sha256": manifest_identity,
        "archive_size_bytes": archive_size,
        "installed_size_bytes": directory_size(output),
        "trimmed_entry_count": trimmed_entry_count,
        "license_record_count": len(inventory),
        "allowed_relocation_metadata": sorted(
            set(relocation_metadata) & ALLOWED_RELOCATION_METADATA
        ),
        "private_prefix_leaks": actionable_leaks,
    }
    if started is not None:
        metadata["build_seconds"] = round(__import__("time").perf_counter() - started, 3)
    (output / "MOLOPTIMA_PROLIF_RUNTIME.json").write_text(
        json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return metadata


def validate_layout(output: Path) -> None:
    required = [
        output / "python.exe",
        output / "Lib" / "site-packages" / "prolif",
        output / "Lib" / "site-packages" / "rdkit",
        output / "Lib" / "site-packages" / "MDAnalysis",
        output / "THIRD_PARTY_NOTICES.md",
        output / "THIRD_PARTY_LICENSES.json",
    ]
    missing = [str(path.relative_to(output)) for path in required if not path.exists()]
    if missing:
        raise RuntimeError(f"packaged runtime layout is incomplete: {missing}")


def build(source_prefix: Path, output: Path, *, force: bool = False) -> dict[str, object]:
    if sys.platform != "win32" or platform.machine().lower() not in {"amd64", "x86_64"}:
        raise RuntimeError("the ProLIF package build requires 64-bit Windows")
    source_python = source_prefix / "python.exe"
    if not source_python.is_file():
        raise RuntimeError("source environment python.exe is unavailable")
    output = output.resolve()
    allowed_root = (PROJECT_ROOT / "desktop" / "runtime" / "prolif").resolve()
    if output != allowed_root / "python":
        raise RuntimeError(f"output must be the ignored staging path {allowed_root / 'python'}")
    if output.exists():
        if not force:
            raise RuntimeError("packaged runtime already exists; pass --force to rebuild")
        shutil.rmtree(output)

    manifest = load_manifest()
    source_versions = probe_runtime(source_python)
    validate_versions(source_versions, manifest)
    started = __import__("time").perf_counter()
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="moloptima-prolif-pack-") as temporary:
        archive = Path(temporary) / "prolif-runtime.zip"
        subprocess.run(
            ["conda-pack", "--prefix", str(source_prefix), "--output", str(archive),
             "--format", "zip", "--force"],
            check=True,
            shell=False,
        )
        archive_size = archive.stat().st_size
        _safe_extract(archive, output)

    inventory = collect_license_inventory(source_prefix, output)
    shutil.copy2(NOTICE_PATH, output / "THIRD_PARTY_NOTICES.md")
    (output / "THIRD_PARTY_LICENSES.json").write_text(
        json.dumps(inventory, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    removed = trim_build_residue(output)
    return finalize_existing_runtime(
        source_prefix,
        output,
        archive_size=archive_size,
        started=started,
        trimmed_entry_count=len(removed),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-prefix", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--force", action="store_true")
    parser.add_argument(
        "--resume-existing",
        action="store_true",
        help="validate and finalize an already extracted runtime without running conda-pack",
    )
    args = parser.parse_args()
    if args.resume_existing:
        result = finalize_existing_runtime(args.source_prefix.resolve(), args.output.resolve())
    else:
        result = build(args.source_prefix.resolve(), args.output, force=args.force)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
