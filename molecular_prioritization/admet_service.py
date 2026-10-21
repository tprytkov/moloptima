"""Independent full-panel ADMET execution using the qualified production registry."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from molecular_prioritization.admet_registry import (
    ADMETRegistry,
    CLASSIFICATION_ENDPOINTS,
    REGRESSION_ENDPOINTS,
    invalid_admet_result,
)


PANEL_ID = "full_frozen_panel"
CONTRACT_VERSION = "moloptima-independent-admet-v1"
MODEL_FAMILIES = ("chemberta", "gmc_mpnn_bbb", "chemprop_regression")
FULL_PANEL_ENDPOINT_COUNT = len(CLASSIFICATION_ENDPOINTS) + 1 + len(REGRESSION_ENDPOINTS)


def run_full_admet_panel(
    records: Sequence[Mapping[str, object]],
    *,
    registry: ADMETRegistry | None = None,
) -> dict[str, object]:
    """Run the complete frozen ADMET panel for one normalized molecule collection.

    Valid molecules are submitted to the existing registry in one batch. Invalid
    collection members retain the same explicit unavailable representation used by
    the combined prioritization pipeline.
    """

    normalized_records = [dict(record) for record in records]
    valid_records = [record for record in normalized_records if _is_valid_record(record)]
    engine = registry or ADMETRegistry()
    valid_results = engine.predict_batch(
        [str(record.get("molecule_id") or "") for record in valid_records],
        [str(record.get("canonical_smiles") or "") for record in valid_records],
    ) if valid_records else []
    if len(valid_results) != len(valid_records):
        raise ValueError("ADMET registry returned the wrong number of molecule results.")

    valid_by_identity = {
        _record_identity(record): result
        for record, result in zip(valid_records, valid_results, strict=True)
    }
    results = []
    for record in normalized_records:
        molecule_id = str(record.get("molecule_id") or "")
        canonical_smiles = str(record.get("canonical_smiles") or "")
        if _is_valid_record(record):
            scientific_result = valid_by_identity[_record_identity(record)]
        else:
            scientific_result = invalid_admet_result(molecule_id, canonical_smiles or None)
        results.append(_public_molecule_result(record, scientific_result))

    return {
        "contract_version": CONTRACT_VERSION,
        "panel": PANEL_ID,
        "model_families": list(MODEL_FAMILIES),
        "endpoint_count": FULL_PANEL_ENDPOINT_COUNT,
        "runtime_identities": list(getattr(engine, "runtime_identities", [])),
        "results": results,
    }


def _is_valid_record(record: Mapping[str, object]) -> bool:
    return (
        str(record.get("validation_status") or "").casefold() == "valid"
        and bool(str(record.get("canonical_smiles") or "").strip())
    )


def _record_identity(record: Mapping[str, object]) -> tuple[str, str]:
    return (
        str(record.get("molecule_id") or ""),
        str(record.get("canonical_smiles") or ""),
    )


def _public_molecule_result(
    record: Mapping[str, object],
    scientific_result: Mapping[str, Any],
) -> dict[str, object]:
    classification = dict(scientific_result.get("classification") or {})
    bbb = dict(scientific_result.get("bbb") or {})
    regression = dict(scientific_result.get("regression") or {})
    family_status = dict(scientific_result.get("family_status") or {})
    overall_status = str(scientific_result.get("status") or "model_unavailable")
    valid = _is_valid_record(record)
    return {
        "molecule_id": str(record.get("molecule_id") or ""),
        "original_molecule_id": str(record.get("original_molecule_id") or record.get("molecule_id") or ""),
        "canonical_smiles": str(record.get("canonical_smiles") or ""),
        "validation_status": str(record.get("validation_status") or "invalid"),
        "failure_reason": str(record.get("failure_reason") or ""),
        "valid_molecule": valid,
        "admet_model_status": (
            "not_run_invalid_molecule"
            if not valid
            else "model_available" if overall_status == "success" else overall_status
        ),
        "admet_warning": str(scientific_result.get("warning") or ""),
        "admet_predictions": dict(classification.get("endpoints") or {}),
        "bbb_result": bbb,
        "admet_regression": regression,
        "admet_family_status": family_status,
    }
