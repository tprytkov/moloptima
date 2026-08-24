"""Resolve and verify frozen ADMET release artifacts without developer paths."""

from __future__ import annotations

import hashlib
import os
import tarfile
from pathlib import Path
from pathlib import PurePosixPath


PROJECT_ROOT = Path(__file__).resolve().parents[1]
RELEASE_ROOT_ENV = "MOLOPTIMA_ADMET_RELEASE_ROOT"
LOCAL_RELEASE_ROOTS = (
    PROJECT_ROOT / "resources" / "admet",
    PROJECT_ROOT / "app_data" / "model_resources" / "admet",
)
EXTRACTED_CACHE_ROOT = PROJECT_ROOT / "app_data" / "model_cache" / "admet_release"


class ADMETReleaseError(RuntimeError):
    """A required frozen release artifact is unavailable or corrupt."""


def resolve_release_root() -> Path | None:
    configured = os.environ.get(RELEASE_ROOT_ENV, "").strip()
    candidates = (Path(configured).expanduser(),) if configured else LOCAL_RELEASE_ROOTS
    return next((path.resolve() for path in candidates if path.is_dir()), None)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_sidecar(path: Path, sidecar: Path) -> str:
    try:
        first = sidecar.read_text(encoding="utf-8-sig").splitlines()[0]
        expected = first.split()[0].lower()
    except (OSError, IndexError) as exc:
        raise ADMETReleaseError(f"Missing or invalid checksum sidecar for {path.name}.") from exc
    if len(expected) != 64 or any(char not in "0123456789abcdef" for char in expected):
        raise ADMETReleaseError(f"Invalid SHA-256 checksum for {path.name}.")
    actual = sha256_file(path)
    if actual != expected:
        raise ADMETReleaseError(f"SHA-256 mismatch for {path.name}.")
    return actual


def extracted_archive(
    archive: Path,
    *,
    checksum_sidecar: Path | None = None,
    expected_sha256: str | None = None,
) -> Path:
    """Verify and safely extract a runtime archive into the ignored app cache."""

    if not archive.is_file():
        raise ADMETReleaseError(f"Frozen runtime archive is missing: {archive.name}.")
    digest = verify_sidecar(archive, checksum_sidecar) if checksum_sidecar else sha256_file(archive)
    if expected_sha256 and digest != expected_sha256:
        raise ADMETReleaseError(f"SHA-256 mismatch for {archive.name}.")
    destination = EXTRACTED_CACHE_ROOT / archive.stem.replace(".tar", "") / digest[:16]
    ready = destination / ".verified"
    if ready.is_file() and ready.read_text(encoding="ascii").strip() == digest:
        return destination

    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, "r:gz") as bundle:
        root = destination.resolve()
        for member in bundle.getmembers():
            target = (destination / member.name).resolve()
            if target != root and root not in target.parents:
                raise ADMETReleaseError(f"Unsafe path in runtime archive: {member.name}.")
        bundle.extractall(destination, filter="data")
    ready.write_text(digest, encoding="ascii")
    return destination


def only_child_directory(path: Path) -> Path:
    children = [child for child in path.iterdir() if child.is_dir()]
    return children[0] if len(children) == 1 else path


def verify_bundle_inventory(bundle: Path) -> None:
    """Fail closed against a bundle's complete SHA256SUMS inventory."""

    sums = bundle / "SHA256SUMS.txt"
    if not sums.is_file():
        raise ADMETReleaseError(f"Bundle checksum inventory is missing: {bundle.name}.")
    recorded: dict[Path, str] = {}
    try:
        lines = sums.read_text(encoding="utf-8-sig").splitlines()
        for line in lines:
            if not line.strip():
                continue
            digest, declared = line.split(None, 1)
            parts = PurePosixPath(declared.strip().lstrip("*").replace("\\", "/")).parts
            if bundle.name in parts:
                parts = parts[parts.index(bundle.name) + 1 :]
            relative = Path(*parts)
            if not parts or ".." in parts or relative in recorded:
                raise ValueError("unsafe or duplicate checksum path")
            recorded[relative] = digest.lower()
    except (OSError, UnicodeError, ValueError) as exc:
        raise ADMETReleaseError(f"Invalid checksum inventory for {bundle.name}.") from exc
    actual_files = {
        path.relative_to(bundle)
        for path in bundle.rglob("*")
        if path.is_file() and path.name != "SHA256SUMS.txt"
    }
    if set(recorded) != actual_files:
        raise ADMETReleaseError(f"Checksum inventory mismatch for {bundle.name}.")
    for relative, expected in recorded.items():
        if sha256_file(bundle / relative) != expected:
            raise ADMETReleaseError(f"SHA-256 mismatch for bundle file: {relative.as_posix()}.")
