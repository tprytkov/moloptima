"""Read-only size, file-count, trimming, and duplicate-runtime audit."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from collections import defaultdict
from pathlib import Path
from typing import Iterable


MODEL_SUFFIXES = {".bin", ".ckpt", ".onnx", ".pt", ".pth", ".safetensors"}
BINARY_SUFFIXES = {".dll", ".exe", ".pyd"}
DEPENDENCY_MARKERS = (
    "cuda", "cudnn", "mkl", "numpy", "openmp", "rdkit", "scipy", "torch",
    "vcomp", "libiomp", "python3",
)
NON_RUNTIME_PARTS = {"__pycache__", "docs", "doc", "examples", "tests", "test"}


def iter_files(root: Path) -> Iterable[Path]:
    for directory, _, filenames in os.walk(root):
        base = Path(directory)
        for filename in filenames:
            yield base / filename


def _label(root: Path, path: Path) -> str:
    relative = path.relative_to(root)
    parts = relative.parts
    if not parts:
        return root.name
    if parts[0] == "admet" and len(parts) > 1:
        return f"admet/{parts[1]}"
    return parts[0]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def audit(
    root: Path, *, hash_duplicates: bool, max_duplicate_groups: int = 50
) -> dict[str, object]:
    runtime_totals: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    directory_totals: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    largest_files: list[tuple[int, str]] = []
    model_bytes = 0
    model_files = 0
    trimming: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    duplicate_candidates: list[tuple[Path, str, int]] = []
    for path in iter_files(root):
        try:
            size = path.stat().st_size
        except OSError:
            continue
        relative = path.relative_to(root)
        label = _label(root, path)
        runtime_totals[label][0] += size
        runtime_totals[label][1] += 1
        largest_files.append((size, relative.as_posix()))
        parent = relative.parent
        while str(parent) not in {"", "."}:
            directory_totals[parent.as_posix()][0] += size
            directory_totals[parent.as_posix()][1] += 1
            parent = parent.parent
        suffix = path.suffix.lower()
        if suffix in MODEL_SUFFIXES:
            model_bytes += size
            model_files += 1
        lowered_parts = {part.lower() for part in relative.parts}
        if suffix in {".pyc", ".pyo"} or "__pycache__" in lowered_parts:
            trimming["bytecode"][0] += size
            trimming["bytecode"][1] += 1
        elif lowered_parts & NON_RUNTIME_PARTS:
            trimming["tests_docs_examples_name_based_review_required"][0] += size
            trimming["tests_docs_examples_name_based_review_required"][1] += 1
        lowered = relative.as_posix().lower()
        if suffix in BINARY_SUFFIXES and any(marker in lowered for marker in DEPENDENCY_MARKERS):
            duplicate_candidates.append((path, label, size))
    duplicates: list[dict[str, object]] = []
    theoretical_duplicate_bytes = 0
    if hash_duplicates:
        by_hash: dict[tuple[str, int], list[tuple[str, str]]] = defaultdict(list)
        for path, label, size in duplicate_candidates:
            by_hash[(_sha256(path), size)].append((label, path.relative_to(root).as_posix()))
        for (digest, size), copies in by_hash.items():
            labels = {label for label, _ in copies}
            if len(copies) < 2 or len(labels) < 2:
                continue
            saved = size * (len(copies) - 1)
            theoretical_duplicate_bytes += saved
            duplicates.append({
                "sha256": digest,
                "bytes_per_copy": size,
                "copy_count": len(copies),
                "theoretical_duplicate_bytes": saved,
                "copies": [path for _, path in copies],
            })
    duplicates.sort(key=lambda item: int(item["theoretical_duplicate_bytes"]), reverse=True)
    largest_files.sort(reverse=True)
    largest_directories = sorted(
        (
            {"path": path, "bytes": values[0], "file_count": values[1]}
            for path, values in directory_totals.items()
        ),
        key=lambda item: int(item["bytes"]),
        reverse=True,
    )
    duplicate_group_count = len(duplicates)
    return {
        "schema_version": "moloptima-runtime-size-audit-v1",
        "root": root.name,
        "total_bytes": sum(value[0] for value in runtime_totals.values()),
        "total_file_count": sum(value[1] for value in runtime_totals.values()),
        "runtimes": [
            {"runtime": name, "bytes": values[0], "file_count": values[1]}
            for name, values in sorted(runtime_totals.items())
        ],
        "model_weights": {"bytes": model_bytes, "file_count": model_files},
        "largest_directories": largest_directories[:20],
        "largest_files": [
            {"path": path, "bytes": size} for size, path in largest_files[:50]
        ],
        "safe_trimming_audit": [
            {"category": name, "bytes": values[0], "file_count": values[1]}
            for name, values in sorted(trimming.items())
        ],
        "duplicate_binary_candidate_count": len(duplicate_candidates),
        "cross_runtime_identical_binary_group_count": duplicate_group_count,
        "cross_runtime_identical_binary_groups": duplicates[:max_duplicate_groups],
        "theoretical_duplicate_bytes": theoretical_duplicate_bytes,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("--hash-duplicates", action="store_true")
    parser.add_argument("--max-duplicate-groups", type=int, default=50)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    if not root.is_dir():
        parser.error("root must be an existing directory")
    result = audit(
        root,
        hash_duplicates=args.hash_duplicates,
        max_duplicate_groups=max(0, args.max_duplicate_groups),
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
