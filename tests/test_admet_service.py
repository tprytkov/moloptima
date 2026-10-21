from __future__ import annotations

import pytest

from molecular_prioritization.admet_registry import CLASSIFICATION_ENDPOINTS, REGRESSION_ENDPOINTS
from molecular_prioritization.admet_service import run_full_admet_panel
from molecular_prioritization.pipeline import prioritize_smiles


def _classification(value: float | None = 0.25) -> dict[str, object]:
    return {
        "status": "success",
        "endpoints": {
            name: {
                "raw_logit": value,
                "raw_probability": value,
                "calibrated_probability": value,
                "binary_prediction": None if value is None else int(value >= 0.5),
                "display_name": name,
                "positive_class_meaning": f"positive {name}",
                "evidence_status": "qualified",
                "warning": "",
            }
            for name in CLASSIFICATION_ENDPOINTS
        },
    }


def _regression(status: str = "success") -> dict[str, object]:
    return {
        "status": status,
        "endpoints": {
            name: {
                "status": status,
                "ensemble_mean_value": 0.0 if name == "caco2_wang" and status == "success" else (1.5 if status == "success" else None),
                "unit": f"unit-{name}" if status == "success" else None,
                "warning": "" if status == "success" else "runtime unavailable",
            }
            for name in REGRESSION_ENDPOINTS
        },
    }


def _bbb(status: str = "success") -> dict[str, object]:
    return {
        "status": status,
        "seed_probabilities": {"seed_1": 0.6} if status == "success" else {},
        "ensemble_probability": 0.6 if status == "success" else None,
        "ensemble_standard_deviation": 0.0 if status == "success" else None,
        "threshold": 0.5,
        "threshold_status": "provisional_raw",
        "raw_classification": "BBB+" if status == "success" else None,
        "calibration_status": "not_frozen",
        "prediction": "BBB+" if status == "success" else "unavailable",
        "warning": "" if status == "success" else "runtime unavailable",
        "model_family": "gmc_mpnn_bbb",
    }


class FakeRegistry:
    def __init__(self, *, regression_status: str = "success", classification_value: float | None = 0.25):
        self.regression_status = regression_status
        self.classification_value = classification_value
        self.calls: list[tuple[list[str], list[str]]] = []
        self.runtime_identities = [{"family": "chemberta", "status": "success"}]

    def predict_batch(self, molecule_ids, canonical_smiles):
        self.calls.append((list(molecule_ids), list(canonical_smiles)))
        rows = []
        for molecule_id, smiles in zip(molecule_ids, canonical_smiles, strict=True):
            classification = _classification(self.classification_value)
            bbb = _bbb()
            regression = _regression(self.regression_status)
            family_status = {
                "chemberta": "success",
                "gmc_bbb": "success",
                "chemprop_regression": self.regression_status,
            }
            rows.append({
                "molecule_id": molecule_id,
                "canonical_smiles": smiles,
                "status": "success" if self.regression_status == "success" else "partial_success",
                "warning": "" if self.regression_status == "success" else "runtime unavailable",
                "family_status": family_status,
                "classification": classification,
                "bbb": bbb,
                "regression": regression,
            })
        return rows


def _record(molecule_id: str, smiles: str, *, valid: bool = True) -> dict[str, object]:
    return {
        "molecule_id": molecule_id,
        "original_molecule_id": molecule_id,
        "canonical_smiles": smiles if valid else "",
        "input_smiles": smiles,
        "validation_status": "valid" if valid else "invalid",
        "failure_reason": "" if valid else "RDKit could not parse SMILES.",
    }


def test_full_panel_batches_valid_molecules_once_and_preserves_invalid_identity():
    registry = FakeRegistry()
    payload = run_full_admet_panel(
        [_record("a", "CCO"), _record("invalid", "not-smiles", valid=False), _record("b", "CCN")],
        registry=registry,
    )
    assert registry.calls == [(["a", "b"], ["CCO", "CCN"])]
    assert payload["endpoint_count"] == 15
    assert payload["model_families"] == ["chemberta", "gmc_mpnn_bbb", "chemprop_regression"]
    assert [row["molecule_id"] for row in payload["results"]] == ["a", "invalid", "b"]
    invalid = payload["results"][1]
    assert invalid["admet_model_status"] == "not_run_invalid_molecule"
    assert invalid["failure_reason"] == "RDKit could not parse SMILES."
    assert set(invalid["admet_predictions"]) == set(CLASSIFICATION_ENDPOINTS)
    assert set(invalid["admet_regression"]["endpoints"]) == set(REGRESSION_ENDPOINTS)


def test_zero_missing_and_partial_family_failure_remain_distinct():
    payload = run_full_admet_panel(
        [_record("zero", "CCO")],
        registry=FakeRegistry(regression_status="model_unavailable", classification_value=None),
    )
    row = payload["results"][0]
    assert row["admet_predictions"]["hia_hou"]["calibrated_probability"] is None
    assert row["bbb_result"]["ensemble_standard_deviation"] == 0.0
    assert row["admet_regression"]["endpoints"]["caco2_wang"]["ensemble_mean_value"] is None
    assert row["admet_family_status"] == {
        "chemberta": "success",
        "gmc_bbb": "success",
        "chemprop_regression": "model_unavailable",
    }
    assert row["admet_model_status"] == "partial_success"


def test_independent_and_combined_pipeline_admet_payloads_are_exactly_equal():
    record = _record("ethanol", "CCO")
    independent = run_full_admet_panel([record], registry=FakeRegistry())["results"][0]
    combined = prioritize_smiles([{"molecule_id": "ethanol", "smiles": "CCO"}], admet_registry=FakeRegistry())[0]
    for field in (
        "molecule_id", "canonical_smiles", "valid_molecule", "admet_model_status",
        "admet_warning", "admet_predictions", "bbb_result", "admet_regression", "admet_family_status",
    ):
        assert independent[field] == combined[field]


def test_registry_row_count_mismatch_fails_closed():
    registry = FakeRegistry()
    registry.predict_batch = lambda _ids, _smiles: []
    with pytest.raises(ValueError, match="wrong number"):
        run_full_admet_panel([_record("a", "CCO")], registry=registry)


def test_prediction_failure_remains_failed_without_hiding_other_family_results():
    row = run_full_admet_panel(
        [_record("ethanol", "CCO")], registry=FakeRegistry(regression_status="failed")
    )["results"][0]
    assert row["admet_family_status"]["chemberta"] == "success"
    assert row["bbb_result"]["ensemble_probability"] == 0.6
    assert row["admet_family_status"]["chemprop_regression"] == "failed"
    assert row["admet_regression"]["endpoints"]["caco2_wang"]["ensemble_mean_value"] is None
