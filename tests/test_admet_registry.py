import csv
import math
from pathlib import Path

import pytest

from molecular_prioritization.admet_registry import (
    ADMETRegistry,
    CLASSIFICATION_ENDPOINTS,
    REGRESSION_ENDPOINTS,
)
from molecular_prioritization.admet_release import ADMETReleaseError, verify_sidecar
from molecular_prioritization.chemprop_regression_predictor import (
    ENDPOINTS,
    REPRESENTATIONS,
    ChempropRegressionPredictor,
)
from molecular_prioritization.gmc_bbb_predictor import GMCBBBPredictor, SEEDS
from molecular_prioritization.pipeline import prioritize_smiles


class FakeChemBERTa:
    def predict_batch(self, smiles):
        return [
            {"prediction_status": "available", "endpoints": {
                **{name: {"calibrated_probability": 0.2} for name in CLASSIFICATION_ENDPOINTS},
                "bbb_martins": {"calibrated_probability": 0.99},
            }}
            for _ in smiles
        ]


class FakeGMC:
    def predict_batch(self, molecule_ids, smiles):
        return [{
            "status": "success", "seed_probabilities": {str(seed): 0.6 for seed in SEEDS},
            "ensemble_probability": 0.6, "ensemble_standard_deviation": 0.0,
            "threshold": 0.5, "threshold_status": "provisional_raw",
            "raw_classification": "BBB+", "calibration_status": "not_frozen",
            "prediction": "BBB+", "model_family": "gmc_mpnn_bbb",
        } for _ in smiles]


class FakeRegression:
    def predict_batch(self, molecule_ids, smiles):
        return [{"status": "success", "endpoint_order": list(REGRESSION_ENDPOINTS), "endpoints": {
            name: {"status": "success", "unit": "frozen-unit", "ensemble_mean": 1.0}
            for name in REGRESSION_ENDPOINTS
        }} for _ in smiles]


def registry(**overrides):
    return ADMETRegistry(
        chemberta_factory=overrides.get("chemberta", FakeChemBERTa),
        gmc_factory=overrides.get("gmc", FakeGMC),
        regression_factory=overrides.get("regression", FakeRegression),
    )


def test_common_output_has_exactly_nine_classifiers_and_no_chemberta_bbb():
    result = registry().predict_batch(["one"], ["CCO"])[0]
    assert tuple(result["classification"]["endpoints"]) == CLASSIFICATION_ENDPOINTS
    assert "bbb_martins" not in result["classification"]["endpoints"]
    assert result["bbb"]["model_family"] == "gmc_mpnn_bbb"
    assert result["bbb"]["threshold_status"] == "provisional_raw"
    assert result["bbb"]["calibration_status"] == "not_frozen"


def test_one_family_failure_preserves_other_results():
    def missing():
        raise RuntimeError("missing GMC")
    result = registry(gmc=missing).predict_batch(["one"], ["CCO"])[0]
    assert result["status"] == "partial_success"
    assert result["classification"]["status"] == "available"
    assert result["regression"]["status"] == "success"
    assert result["bbb"]["status"] == "model_unavailable"


def test_pipeline_batches_only_valid_molecules_and_preserves_order():
    class RecordingRegistry:
        def __init__(self):
            self.calls = []
        def predict_batch(self, molecule_ids, smiles):
            self.calls.append((molecule_ids, smiles))
            return registry().predict_batch(molecule_ids, smiles)
    engine = RecordingRegistry()
    progress = []
    rows = prioritize_smiles([
        {"molecule_id": "ethanol", "smiles": "CCO"},
        {"molecule_id": "invalid", "smiles": "this_is_not_smiles"},
        {"molecule_id": "benzene", "smiles": "c1ccccc1"},
    ], admet_registry=engine, progress_callback=lambda **values: progress.append(values))
    assert engine.calls == [(["ethanol", "benzene"], ["CCO", "c1ccccc1"])]
    by_id = {row["molecule_id"]: row for row in rows}
    assert by_id["invalid"]["admet_model_status"] == "not_run_invalid_molecule"
    assert tuple(by_id["invalid"]["admet_predictions"]) == CLASSIFICATION_ENDPOINTS
    assert "bbb_martins" not in by_id["invalid"]["admet_predictions"]
    assert by_id["ethanol"]["bbb_result"]["prediction"] == "BBB+"
    assert by_id["ethanol"]["bbb_result"]["raw_classification"] == "BBB+"
    assert progress[0] == {
        "stage": "admet", "valid_count": 2, "invalid_count": 1,
        "processed_count": 1, "admet_success_count": 0, "admet_failure_count": 0,
    }
    assert progress[-1]["processed_count"] == 3
    assert progress[-1]["admet_success_count"] == 2


def test_gmc_adapter_verifies_arithmetic_mean_and_threshold(monkeypatch, tmp_path):
    predictor = GMCBBBPredictor.__new__(GMCBBBPredictor)
    predictor.python, predictor.runner = "python", tmp_path / "runner.py"
    predictor.manifest, predictor.artifact_root = tmp_path / "manifest.json", tmp_path
    predictor.runner.touch()
    probabilities = [0.1, 0.3, 0.5, 0.7, 0.9]
    expected_standard_deviation = math.sqrt(
        sum((probability - 0.5) ** 2 for probability in probabilities) / 5
    )
    def fake_run(command, **kwargs):
        output = Path(command[command.index("--output-csv") + 1])
        with output.open("w", newline="", encoding="utf-8") as handle:
            fields = ["molecule_id", *(f"seed{s}_probability" for s in SEEDS), "ensemble_probability", "ensemble_standard_deviation", "threshold", "prediction", "status", "model_family", "manifest_version", "model_interface_version", "error_code", "error_message"]
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            writer.writerow({"molecule_id": "one", **{f"seed{s}_probability": p for s, p in zip(SEEDS, probabilities)}, "ensemble_probability": 0.5, "ensemble_standard_deviation": expected_standard_deviation, "threshold": 0.5, "prediction": "BBB+", "status": "success", "model_family": "gmc"})
        return type("Completed", (), {"returncode": 0, "stderr": "", "stdout": ""})()
    monkeypatch.setattr("molecular_prioritization.gmc_bbb_predictor.subprocess.run", fake_run)
    result = predictor.predict_batch(["one"], ["CCO"])[0]
    assert result["ensemble_probability"] == pytest.approx(sum(probabilities) / 5)
    assert result["ensemble_standard_deviation"] == pytest.approx(expected_standard_deviation)
    assert result["threshold"] == 0.5
    assert result["threshold_status"] == "provisional_raw"
    assert result["calibration_status"] == "not_frozen"
    assert result["raw_classification"] == "BBB+"
    assert result["prediction"] == "BBB+"


def test_regression_adapter_exposes_exact_units_and_transforms(monkeypatch, tmp_path):
    predictor = ChempropRegressionPredictor.__new__(ChempropRegressionPredictor)
    predictor.python, predictor.runner = "python", tmp_path / "runner.py"
    predictor.manifest, predictor.artifact_root = tmp_path / "manifest.json", tmp_path
    predictor.runner.touch()
    def fake_run(command, **kwargs):
        output = Path(command[command.index("--output-csv") + 1])
        base = {"molecule_id": "one", "status": "success", "endpoint_order_json": __import__('json').dumps(ENDPOINTS)}
        for endpoint in ENDPOINTS:
            suffix = REPRESENTATIONS[endpoint]
            base[f"{endpoint}_ensemble_mean_{suffix}"] = "1.25"
            base[f"{endpoint}_unit"] = suffix
            base[f"{endpoint}_representation"] = suffix
        with output.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(base))
            writer.writeheader(); writer.writerow(base)
        return type("Completed", (), {"returncode": 0, "stderr": "", "stdout": ""})()
    monkeypatch.setattr("molecular_prioritization.chemprop_regression_predictor.subprocess.run", fake_run)
    result = predictor.predict_batch(["one"], ["CCO"])[0]
    assert tuple(result["endpoints"]) == ENDPOINTS
    for endpoint, suffix in REPRESENTATIONS.items():
        assert result["endpoints"][endpoint]["unit"] == suffix
        assert result["endpoints"][endpoint]["representation"] == suffix


def test_checksum_mismatch_fails_closed(tmp_path):
    artifact, sidecar = tmp_path / "artifact.bin", tmp_path / "artifact.bin.sha256"
    artifact.write_bytes(b"corrupt")
    sidecar.write_text("0" * 64 + "  artifact.bin\n", encoding="ascii")
    with pytest.raises(ADMETReleaseError, match="SHA-256 mismatch"):
        verify_sidecar(artifact, sidecar)
