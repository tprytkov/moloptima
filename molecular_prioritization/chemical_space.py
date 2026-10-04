"""Descriptive chemical-space projection and query-relative similarity helpers.

This module deliberately does not implement applicability-domain, activity-cliff,
scaffold, confidence, ranking, or decision logic.  The coordinates are a lossy
visualization; Tanimoto values are the quantitative structural comparison.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import rdkit
from rdkit import DataStructs

from biopharma_intelligence.similarity import (
    MORGAN_FP_SIZE,
    MORGAN_RADIUS,
    morgan_fingerprint,
)


PROJECTION_METHOD = "randomized_pca"
PROJECTION_SEED = 1729
PROJECTION_COMPONENTS = 2
PROJECTION_OVERSAMPLES = 8
PROJECTION_POWER_ITERATIONS = 3
PROJECTION_CAVEAT = (
    "This 2D projection is a lossy visual summary that may distort relationships "
    "in the high-dimensional fingerprint space. Apparent map distance is not a "
    "quantitative similarity score; use the query-relative Tanimoto values in "
    "Neighbors for quantitative fingerprint similarity."
)


@dataclass(frozen=True)
class FingerprintedRecord:
    index: int
    record: dict[str, Any]
    fingerprint: Any


def representation_metadata(*, numpy_version: str = np.__version__) -> dict[str, Any]:
    return {
        "representation": "Morgan fingerprint bit vector",
        "fingerprint_radius": MORGAN_RADIUS,
        "fingerprint_bits": MORGAN_FP_SIZE,
        "similarity_metric": "Tanimoto",
        "rdkit_version": rdkit.__version__,
        "projection_method": PROJECTION_METHOD,
        "projection_package": "NumPy",
        "projection_package_version": numpy_version,
        "projection_components": PROJECTION_COMPONENTS,
        "projection_seed": PROJECTION_SEED,
        "projection_oversamples": PROJECTION_OVERSAMPLES,
        "projection_power_iterations": PROJECTION_POWER_ITERATIONS,
        "projection_input": "centered binary fingerprint bits",
        "caveat": PROJECTION_CAVEAT,
    }


def fingerprint_records(records: list[dict[str, Any]]) -> tuple[list[FingerprintedRecord], list[dict[str, Any]]]:
    """Fingerprint valid records while retaining excluded records and source order."""

    included: list[FingerprintedRecord] = []
    excluded: list[dict[str, Any]] = []
    for index, source in enumerate(records):
        record = dict(source)
        smiles = str(record.get("canonical_smiles") or "").strip()
        validation_status = str(record.get("validation_status") or "").lower()
        if validation_status != "valid" or not smiles:
            excluded.append(_excluded_record(record, index, "invalid_or_unresolved_structure"))
            continue
        fingerprint = morgan_fingerprint(smiles)
        if fingerprint is None:
            excluded.append(_excluded_record(record, index, "fingerprint_generation_failed"))
            continue
        included.append(FingerprintedRecord(index=index, record=record, fingerprint=fingerprint))
    return included, excluded


def project_records(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Return a deterministic two-dimensional projection for valid records."""

    included, excluded = fingerprint_records(records)
    coordinates = _randomized_pca_coordinates([item.fingerprint for item in included])
    points = []
    for item, (x_value, y_value) in zip(included, coordinates, strict=True):
        points.append({
            **_record_identity(item.record, item.index),
            "canonical_smiles": str(item.record.get("canonical_smiles") or ""),
            "duplicate_structure": bool(item.record.get("duplicate_structure", False)),
            "x": round(float(x_value), 7),
            "y": round(float(y_value), 7),
        })
    return {
        "total_count": len(records),
        "projected_count": len(points),
        "excluded_count": len(excluded),
        "points": points,
        "excluded": excluded,
        "metadata": representation_metadata(),
    }


def nearest_neighbors(records: list[dict[str, Any]], query_molecule_id: str, top_k: int) -> dict[str, Any]:
    """Rank valid collection records by exact Tanimoto similarity to one record."""

    included, excluded = fingerprint_records(records)
    query = next((item for item in included if _molecule_id(item.record, item.index) == query_molecule_id), None)
    if query is None:
        raise ValueError("The selected molecule is not a valid member of this collection.")
    ranked = []
    for item in included:
        if item.index == query.index:
            continue
        ranked.append({
            **_record_identity(item.record, item.index),
            "canonical_smiles": str(item.record.get("canonical_smiles") or ""),
            "duplicate_structure": bool(item.record.get("duplicate_structure", False)),
            "similarity": float(DataStructs.TanimotoSimilarity(query.fingerprint, item.fingerprint)),
        })
    ranked.sort(key=lambda row: (-row["similarity"], row["molecule_id"], row["source_index"]))
    return {
        "query": {
            **_record_identity(query.record, query.index),
            "canonical_smiles": str(query.record.get("canonical_smiles") or ""),
        },
        "top_k": top_k,
        "neighbors": [{**row, "similarity": round(row["similarity"], 7)} for row in ranked[:top_k]],
        "valid_candidate_count": max(0, len(included) - 1),
        "excluded_count": len(excluded),
        "metadata": representation_metadata(),
    }


def _randomized_pca_coordinates(fingerprints: list[Any]) -> np.ndarray:
    count = len(fingerprints)
    if count == 0:
        return np.empty((0, 2), dtype=np.float32)
    if count == 1:
        return np.zeros((1, 2), dtype=np.float32)
    matrix = np.zeros((count, MORGAN_FP_SIZE), dtype=np.float32)
    for row_index, fingerprint in enumerate(fingerprints):
        DataStructs.ConvertToNumpyArray(fingerprint, matrix[row_index])
    matrix -= matrix.mean(axis=0, keepdims=True)
    if not np.any(matrix):
        return np.zeros((count, 2), dtype=np.float32)

    sketch_width = min(PROJECTION_COMPONENTS + PROJECTION_OVERSAMPLES, count, MORGAN_FP_SIZE)
    rng = np.random.default_rng(PROJECTION_SEED)
    omega = rng.standard_normal((MORGAN_FP_SIZE, sketch_width), dtype=np.float32)
    sample = matrix @ omega
    for _ in range(PROJECTION_POWER_ITERATIONS):
        sample = matrix @ (matrix.T @ sample)
        sample, _ = np.linalg.qr(sample, mode="reduced")
    basis, _ = np.linalg.qr(sample, mode="reduced")
    compressed = basis.T @ matrix
    left, singular_values, right = np.linalg.svd(compressed, full_matrices=False)
    component_count = min(PROJECTION_COMPONENTS, left.shape[1])
    coordinates = (basis @ left[:, :component_count]) * singular_values[:component_count]
    coordinates = _fix_component_signs(coordinates, right[:component_count])
    if component_count < PROJECTION_COMPONENTS:
        coordinates = np.pad(coordinates, ((0, 0), (0, PROJECTION_COMPONENTS - component_count)))
    return coordinates.astype(np.float32, copy=False)


def _fix_component_signs(coordinates: np.ndarray, loadings: np.ndarray) -> np.ndarray:
    fixed = coordinates.copy()
    for component in range(loadings.shape[0]):
        anchor = int(np.argmax(np.abs(loadings[component])))
        if loadings[component, anchor] < 0:
            fixed[:, component] *= -1
    return fixed


def _molecule_id(record: dict[str, Any], index: int) -> str:
    return str(record.get("molecule_id") or f"compound_{index + 1:03d}")


def _record_identity(record: dict[str, Any], index: int) -> dict[str, Any]:
    molecule_id = _molecule_id(record, index)
    return {
        "molecule_id": molecule_id,
        "display_name": str(record.get("original_molecule_id") or molecule_id),
        "source_index": index,
        "source_type": str(record.get("source_type") or ""),
        "source_filename": str(record.get("source_filename") or ""),
        "source_record": str(record.get("source_record") or ""),
        "validation_status": str(record.get("validation_status") or ""),
    }


def _excluded_record(record: dict[str, Any], index: int, reason: str) -> dict[str, Any]:
    return {
        **_record_identity(record, index),
        "reason": reason,
        "failure_reason": str(record.get("failure_reason") or ""),
    }
