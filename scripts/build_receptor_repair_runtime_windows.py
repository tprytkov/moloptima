"""Build the frozen, relocatable Windows receptor-repair runtime outside Git."""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import re
import tempfile
import time
import zipfile
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = PROJECT_ROOT / "resources" / "receptor_preparation" / "runtime_manifest.json"
NOTICE_PATH = PROJECT_ROOT / "resources" / "receptor_preparation" / "THIRD_PARTY_NOTICES.md"
WORKER_PATH = PROJECT_ROOT / "molecular_prioritization" / "receptor_repair_worker.py"
DEFAULT_OUTPUT = PROJECT_ROOT / "desktop" / "runtime" / "receptor_preparation" / "python"
MATERIAL_PACKAGES = {"python", "pdbfixer", "openmm"}
ALLOWED_RELOCATION_METADATA: set[str] = set()


def directory_size(path: Path) -> int:
    return sum(item.stat().st_size for item in path.rglob("*") if item.is_file())


def load_manifest() -> dict[str, object]:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def probe_runtime(python: Path) -> dict[str, object]:
    environment = os.environ.copy()
    environment.pop("RDBASE", None)
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    completed = subprocess.run(
        [str(python), str(WORKER_PATH), "--probe"], capture_output=True, text=True,
        env=environment, shell=False, timeout=30,
    )
    try:
        payload = json.loads((completed.stdout or "{}").splitlines()[-1])
    except (json.JSONDecodeError, IndexError) as exc:
        raise RuntimeError("receptor-repair probe returned invalid output") from exc
    if completed.returncode or not payload.get("available"):
        raise RuntimeError(str(payload.get("error") or completed.stderr or "probe failed"))
    return payload


def validate_probe(payload: dict[str, object], manifest: dict[str, object]) -> None:
    expected = manifest.get("expected_versions")
    if not isinstance(expected, dict):
        raise RuntimeError("runtime manifest expected_versions is invalid")
    observed = {
        "python": payload.get("python_version"),
        "pdbfixer": payload.get("pdbfixer_version"),
        "openmm": payload.get("openmm_version"),
    }
    mismatches = {
        name: {"expected": version, "observed": observed.get(name)}
        for name, version in expected.items() if observed.get(name) != version
    }
    if mismatches:
        raise RuntimeError(f"frozen runtime version mismatch: {json.dumps(mismatches, sort_keys=True)}")
    if payload.get("api_smoke") != manifest.get("required_api_smoke"):
        raise RuntimeError("required receptor-repair API smoke did not complete")


def safe_extract(archive: Path, destination: Path) -> None:
    resolved = destination.resolve()
    with zipfile.ZipFile(archive) as bundle:
        for member in bundle.infolist():
            target = (destination / member.filename).resolve()
            if target != resolved and resolved not in target.parents:
                raise RuntimeError(f"unsafe archive member: {member.filename}")
        bundle.extractall(destination)


def make_openmm_library_path_relocatable(output: Path) -> None:
    """Replace conda-pack's build-prefix placeholder with a runtime-relative path."""
    version_path = output / "Lib" / "site-packages" / "openmm" / "version.py"
    source = version_path.read_text(encoding="utf-8")
    replacement = (
        "from pathlib import Path\n"
        "openmm_library_path = str(Path(__file__).resolve().parents[3] / 'Library' / 'lib')"
    )
    updated, count = re.subn(
        r"^openmm_library_path\s*=.*$", replacement, source, count=1, flags=re.MULTILINE
    )
    if count != 1:
        raise RuntimeError("OpenMM runtime library path was not found exactly once")
    version_path.write_text(updated, encoding="utf-8", newline="\n")


def copy_license_tree(source: Path, destination: Path) -> list[str]:
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


def collect_license_inventory(source: Path, output: Path) -> list[dict[str, object]]:
    destination = output / "THIRD_PARTY_LICENSES"
    inventory: list[dict[str, object]] = []
    for metadata_path in sorted((source / "conda-meta").glob("*.json")):
        payload = json.loads(metadata_path.read_text(encoding="utf-8"))
        name, package_version = str(payload.get("name", "unknown")), str(payload.get("version", "unknown"))
        extracted = Path(str(payload.get("extracted_package_dir", "")))
        copied = copy_license_tree(extracted / "info" / "licenses", destination / f"{name}-{package_version}")
        inventory.append({
            "name": name, "version": package_version, "license": payload.get("license"),
            "material": name.lower() in MATERIAL_PACKAGES, "license_files": copied,
        })
    return inventory


def trim_build_residue(output: Path) -> list[str]:
    removed: list[str] = []
    conda_metadata = output / "conda-meta"
    if conda_metadata.is_dir():
        shutil.rmtree(conda_metadata)
        removed.append("conda-meta/")
    for relative in ("Scripts/conda-unpack.exe", "Scripts/conda-unpack-script.py"):
        path = output / relative
        if path.is_file():
            path.unlink()
            removed.append(relative)
    for item in list(output.rglob("*")):
        if item.is_dir() and item.name in {"__pycache__", ".pytest_cache"}:
            shutil.rmtree(item)
            removed.append(item.relative_to(output).as_posix() + "/")
        elif item.is_file() and (item.suffix in {".pyc", ".pyo"} or item.name == "direct_url.json"):
            item.unlink()
            removed.append(item.relative_to(output).as_posix())
    return removed


def find_private_prefix_leaks(root: Path, needles: list[bytes]) -> list[str]:
    leaks: list[str] = []
    normalized = {needle.lower() for needle in needles if needle}
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        with path.open("rb") as handle:
            previous = b""
            while chunk := handle.read(1024 * 1024):
                value = (previous + chunk).lower()
                if any(needle in value for needle in normalized):
                    relative = path.relative_to(root).as_posix()
                    if relative not in ALLOWED_RELOCATION_METADATA:
                        leaks.append(relative)
                    break
                previous = value[-512:]
    return leaks


def validate_layout(output: Path) -> None:
    required = [
        output / "python.exe",
        output / "Lib" / "site-packages" / "pdbfixer",
        output / "Lib" / "site-packages" / "openmm",
        output / "THIRD_PARTY_NOTICES.md",
        output / "THIRD_PARTY_LICENSES.json",
    ]
    missing = [str(path.relative_to(output)) for path in required if not path.exists()]
    if missing:
        raise RuntimeError(f"packaged receptor-repair runtime is incomplete: {missing}")


def build(source: Path, output: Path, *, force: bool = False) -> dict[str, object]:
    if sys.platform != "win32" or platform.machine().lower() not in {"amd64", "x86_64"}:
        raise RuntimeError("receptor-repair runtime packaging requires 64-bit Windows")
    if not (source / "python.exe").is_file():
        raise RuntimeError("source environment python.exe is unavailable")
    output = output.resolve()
    required_output = DEFAULT_OUTPUT.resolve()
    if output != required_output:
        raise RuntimeError(f"output must be the ignored staging path {required_output}")
    if output.exists():
        if not force:
            raise RuntimeError("packaged runtime already exists; pass --force to rebuild")
        shutil.rmtree(output)

    manifest = load_manifest()
    validate_probe(probe_runtime(source / "python.exe"), manifest)
    started = time.perf_counter()
    output.parent.mkdir(parents=True, exist_ok=True)
    conda_pack = shutil.which("conda-pack")
    if not conda_pack:
        raise RuntimeError("conda-pack is unavailable; install it outside the scientific runtime first")
    with tempfile.TemporaryDirectory(prefix="moloptima-receptor-repair-pack-") as temporary:
        archive = Path(temporary) / "runtime.zip"
        subprocess.run(
            [conda_pack, "--prefix", str(source), "--output", str(archive), "--format", "zip", "--force"],
            check=True, shell=False,
        )
        archive_size = archive.stat().st_size
        safe_extract(archive, output)

    make_openmm_library_path_relocatable(output)

    inventory = collect_license_inventory(source, output)
    shutil.copy2(NOTICE_PATH, output / NOTICE_PATH.name)
    (output / "THIRD_PARTY_LICENSES.json").write_text(
        json.dumps(inventory, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    removed = trim_build_residue(output)
    payload = probe_runtime(output / "python.exe")
    validate_probe(payload, manifest)
    removed.extend(trim_build_residue(output))
    validate_layout(output)
    private_prefix_leaks = find_private_prefix_leaks(output, [
        str(source).encode(), str(Path.home()).encode(), str(PROJECT_ROOT).encode(),
    ])
    if private_prefix_leaks:
        raise RuntimeError(f"private build-prefix leakage detected: {private_prefix_leaks[:20]}")
    metadata = {
        "schema_version": "moloptima-packaged-receptor-repair-runtime-v1",
        "platform": "win-64", "architecture": platform.machine(),
        "versions": {
            "python": payload["python_version"], "pdbfixer": payload["pdbfixer_version"],
            "openmm": payload["openmm_version"],
        },
        "api_smoke": payload["api_smoke"], "openmm_platforms": payload.get("openmm_platforms", []),
        "archive_size_bytes": archive_size, "installed_size_bytes": directory_size(output),
        "trimmed_entry_count": len(removed), "license_record_count": len(inventory),
        "private_prefix_leaks": private_prefix_leaks,
        "allowed_relocation_metadata": sorted(ALLOWED_RELOCATION_METADATA),
        "build_seconds": round(time.perf_counter() - started, 3),
    }
    (output / "MOLOPTIMA_RECEPTOR_REPAIR_RUNTIME.json").write_text(
        json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return metadata


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-prefix", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    result = build(args.source_prefix.resolve(), args.output, force=args.force)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
