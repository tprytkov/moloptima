import json
import math
import threading
import time
from pathlib import Path

import pytest

from molecular_prioritization import runtime_qualification
from molecular_prioritization.admet_registry import CLASSIFICATION_ENDPOINTS, REGRESSION_ENDPOINTS
from molecular_prioritization.chemprop_regression_predictor import REPRESENTATIONS
from molecular_prioritization.gmc_bbb_predictor import SEEDS
from molecular_prioritization.runtime_qualification import (
    FAIL,
    MOCK_TESTED_ONLY,
    NOT_RUN_RUNTIME_MISSING,
    QualificationConfig,
    QualificationDependencies,
    _qualify_chemberta,
    _qualify_gmc,
    _verify_chemberta_public_rows,
    _verify_gmc_row,
    run_qualification,
    sanitize_private_paths,
    scientific_runtime_status,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
GMC_RUNNER = PROJECT_ROOT / "resources/admet/runners/gmc_mpnn_bbb/v1/predict_gmc_mpnn_bbb.py"
REGRESSION_RUNNER = PROJECT_ROOT / "resources/admet/runners/chemprop_regression/v2/predict_chemprop_regression.py"


def test_scientific_runtime_status_reuses_production_contract_probes(monkeypatch, tmp_path):
    class ExternalRuntime:
        python_source = "packaged"
        runner_source = "packaged"
        runtime_versions = {"python": "3.11.15"}

    monkeypatch.setattr(runtime_qualification, "load_chemberta_predictor", lambda **_kwargs: object())
    monkeypatch.setattr(runtime_qualification, "GMCBBBPredictor", lambda **_kwargs: ExternalRuntime())
    monkeypatch.setattr(runtime_qualification, "ChempropRegressionPredictor", lambda **_kwargs: ExternalRuntime())
    monkeypatch.setattr(runtime_qualification, "receptor_preparation_runtime_status", lambda: {
        "available": True,
        "packages": {"meeko": "0.7.1", "gemmi": "0.7.5"},
        "hydrogen_preparation": {"protonation_status": "not_scientifically_resolved"},
        "reason": "",
    })
    monkeypatch.setattr(runtime_qualification, "resolve_vina_executable", lambda: (tmp_path / "vina.exe", "packaged"))
    monkeypatch.setattr(runtime_qualification, "resolve_obabel_executable", lambda: (tmp_path / "obabel.exe", "packaged"))
    monkeypatch.setattr(
        runtime_qualification,
        "probe_native_runtime_identity",
        lambda _path, argument, _label: (
            "AutoDock Vina 1.1.2" if argument == "--version" else "Open Babel 3.1.0"
        ),
    )

    scientific_runtime_status(application_root=tmp_path)
    payload = _wait_for_runtime_status(tmp_path)

    assert payload["status_source"] == "production_runtime_contract_probes"
    assert payload["inference_performed"] is False
    assert payload["components"]["chemberta"] == {
        "status": "available", "runtime_source": "application_process", "public_endpoint_count": 9,
    }
    gmc = payload["components"]["gmc_mpnn_bbb"]
    assert (gmc["ensemble_seed_count"], gmc["standard_deviation"]) == (5, "population")
    assert (gmc["threshold"], gmc["threshold_status"], gmc["calibration_status"]) == (
        0.5, "provisional_raw", "not_frozen",
    )
    regression = payload["components"]["chemprop_regression"]
    assert (regression["endpoint_count"], regression["ensemble_seed_count"], regression["standard_deviation"]) == (
        5, 5, "sample",
    )
    assert payload["components"]["receptor_preparation"]["status"] == "available"
    assert payload["components"]["docking"]["vina"]["identity"] == "AutoDock Vina 1.1.2"


def test_scientific_runtime_status_distinguishes_unavailable_and_incompatible(monkeypatch, tmp_path):
    def missing(**_kwargs):
        raise RuntimeError("model_release_missing: runtime is unavailable")

    def incompatible(**_kwargs):
        raise RuntimeError("runtime_incompatible: frozen version mismatch")

    monkeypatch.setattr(runtime_qualification, "load_chemberta_predictor", missing)
    monkeypatch.setattr(runtime_qualification, "GMCBBBPredictor", incompatible)
    monkeypatch.setattr(runtime_qualification, "ChempropRegressionPredictor", missing)
    monkeypatch.setattr(runtime_qualification, "receptor_preparation_runtime_status", lambda: {
        "available": False, "packages": {"meeko": None, "gemmi": None},
        "hydrogen_preparation": {}, "reason": "dependencies are not installed",
    })
    monkeypatch.setattr(runtime_qualification, "resolve_vina_executable", lambda: (_ for _ in ()).throw(
        RuntimeError("Packaged vina runtime manifest is invalid")
    ))
    monkeypatch.setattr(runtime_qualification, "resolve_obabel_executable", lambda: (_ for _ in ()).throw(
        RuntimeError("obabel runtime is unavailable")
    ))

    scientific_runtime_status(application_root=tmp_path)
    components = _wait_for_runtime_status(tmp_path)["components"]

    assert components["chemberta"]["status"] == "unavailable"
    assert components["gmc_mpnn_bbb"]["status"] == "incompatible"
    assert components["chemprop_regression"]["status"] == "unavailable"
    assert components["receptor_preparation"]["status"] == "unavailable"
    assert components["docking"]["vina"]["status"] == "incompatible"
    assert components["docking"]["openbabel"]["status"] == "unavailable"


def _wait_for_runtime_status(root: Path, predicate=None, timeout: float = 2.0):
    predicate = predicate or (lambda value: value["qualification_state"] == "complete")
    deadline = time.perf_counter() + timeout
    while time.perf_counter() < deadline:
        payload = scientific_runtime_status(application_root=root)
        if predicate(payload):
            return payload
        time.sleep(0.01)
    raise AssertionError("scientific runtime status did not reach the expected state")


def _fake_status_checks(overrides=None, calls=None):
    overrides = overrides or {}
    calls = calls if calls is not None else {}

    def check(name):
        def run():
            calls[name] = calls.get(name, 0) + 1
            value = overrides.get(name, {"status": "available", "runtime_source": "test"})
            return value() if callable(value) else value
        return run

    return {
        name: check(name)
        for name in (
            "chemberta", "gmc_mpnn_bbb", "chemprop_regression",
            "receptor_preparation", "docking",
        )
    }


def test_runtime_status_is_prompt_coalesced_partial_and_updates_cache(monkeypatch, tmp_path):
    release_gmc = threading.Event()
    calls = {}
    checks = _fake_status_checks(
        {"gmc_mpnn_bbb": lambda: (
            release_gmc.wait(1), {"status": "available", "runtime_source": "test"}
        )[1]},
        calls,
    )
    monkeypatch.setattr(runtime_qualification, "_runtime_status_checks", lambda _root: checks)

    started = time.perf_counter()
    initial = scientific_runtime_status(application_root=tmp_path)
    repeated = scientific_runtime_status(application_root=tmp_path)
    assert time.perf_counter() - started < 0.2
    assert initial["qualification_state"] == "checking"
    assert repeated["generation"] == initial["generation"]
    partial = _wait_for_runtime_status(
        tmp_path,
        lambda value: value["components"]["chemberta"]["status"] == "available"
        and value["components"]["gmc_mpnn_bbb"]["status"] == "checking",
    )
    assert partial["components"]["docking"]["status"] == "available"
    assert all(count == 1 for count in calls.values())

    release_gmc.set()
    completed = _wait_for_runtime_status(tmp_path)
    assert completed["components"]["gmc_mpnn_bbb"]["status"] == "available"
    assert completed["qualification_state"] == "complete"
    assert scientific_runtime_status(application_root=tmp_path) == completed


def test_runtime_status_timeout_is_terminal_and_incompatibility_is_preserved(monkeypatch, tmp_path):
    release_slow = threading.Event()
    checks = _fake_status_checks({
        "gmc_mpnn_bbb": lambda: (
            release_slow.wait(1), {"status": "available", "runtime_source": "test"}
        )[1],
        "chemprop_regression": {
            "status": "incompatible", "runtime_source": "unavailable",
            "reason": "runtime_incompatible",
        },
    })
    monkeypatch.setattr(runtime_qualification, "_runtime_status_checks", lambda _root: checks)
    monkeypatch.setattr(runtime_qualification, "SCIENTIFIC_RUNTIME_FAMILY_TIMEOUT_SECONDS", 0.05)

    scientific_runtime_status(application_root=tmp_path)
    completed = _wait_for_runtime_status(tmp_path)
    assert completed["components"]["gmc_mpnn_bbb"]["status"] == "error"
    assert completed["components"]["gmc_mpnn_bbb"]["reason"] == "runtime_probe_timeout"
    assert completed["components"]["chemprop_regression"]["status"] == "incompatible"
    assert all(item["status"] != "checking" for item in completed["components"].values())
    release_slow.set()


def test_runtime_status_refresh_starts_new_generation_without_blocking(monkeypatch, tmp_path):
    calls = {}
    checks = _fake_status_checks(calls=calls)
    monkeypatch.setattr(runtime_qualification, "_runtime_status_checks", lambda _root: checks)
    scientific_runtime_status(application_root=tmp_path)
    first = _wait_for_runtime_status(tmp_path)
    _wait_for_runtime_status(
        tmp_path,
        lambda _value: tmp_path.resolve() not in runtime_qualification._SCIENTIFIC_RUNTIME_STATUS_OPERATIONS,
    )

    started = time.perf_counter()
    refreshed = scientific_runtime_status(application_root=tmp_path, refresh=True)
    assert time.perf_counter() - started < 0.2
    assert refreshed["generation"] == first["generation"] + 1
    assert refreshed["qualification_state"] == "checking"
    assert refreshed["refreshing"] is True
    assert refreshed["components"]["chemberta"]["status"] == "available"
    assert refreshed["components"]["chemberta"]["refreshing"] is True
    second = _wait_for_runtime_status(tmp_path)
    assert second["refreshing"] is False
    assert all(count == 2 for count in calls.values())


class FakeChemBERTa:
    calls = []

    def predict_batch(self, smiles):
        self.calls.append(list(smiles))
        return [
            {
                "prediction_status": "available",
                "endpoints": {
                    **{
                        endpoint: {"calibrated_probability": 0.5}
                        for endpoint in CLASSIFICATION_ENDPOINTS
                    },
                    "bbb_martins": {"calibrated_probability": 0.99},
                },
            }
            for _ in smiles
        ]


class FakeGMC:
    def __init__(self, *, changing=False):
        self.runner = GMC_RUNNER
        self.runner_source = "test_double"
        self.python_source = "test_double"
        self.runtime_versions = {}
        self.calls = []
        self.changing = changing

    def predict_batch(self, molecule_ids, smiles):
        self.calls.append((list(molecule_ids), list(smiles)))
        offset = 0.01 if self.changing and len(self.calls) > 1 else 0.0
        values = [0.1 + offset, 0.3, 0.5, 0.7, 0.9]
        mean = sum(values) / len(values)
        sd = math.sqrt(sum((value - mean) ** 2 for value in values) / len(values))
        return [
            {
                "status": "success",
                "seed_probabilities": {str(seed): value for seed, value in zip(SEEDS, values, strict=True)},
                "ensemble_probability": mean,
                "ensemble_standard_deviation": sd,
                "threshold": 0.5,
                "threshold_status": "provisional_raw",
                "calibration_status": "not_frozen",
                "raw_classification": "BBB+",
                "manifest_version": "gmc-mpnn-bbb-production-v1",
                "model_interface_version": "test",
                "model_family": "GMC-MPNN",
            }
            for _ in smiles
        ]


class FakeRegression:
    def __init__(self, manifest_path):
        self.runner = REGRESSION_RUNNER
        self.runner_source = "test_double"
        self.python_source = "test_double"
        self.runtime_versions = {}
        self.manifest = manifest_path
        self.calls = []

    def predict_batch(self, molecule_ids, smiles):
        self.calls.append((list(molecule_ids), list(smiles)))
        endpoints = {}
        manifest = json.loads(Path(self.manifest).read_text())
        for endpoint in REGRESSION_ENDPOINTS:
            suffix = REPRESENTATIONS[endpoint]
            metadata = manifest["endpoints"][endpoint]
            item = {
                **{f"seed{seed}_{suffix}": float(seed) for seed in SEEDS},
                f"ensemble_mean_{suffix}": 72.2,
                f"seed_standard_deviation_{suffix}": 1.5,
                "unit": metadata["internal_model_output_unit"]
                if endpoint == "caco2_wang"
                else metadata["user_facing_unit"],
                "representation": "frozen-test-representation",
                "status": "success",
            }
            endpoints[endpoint] = item
        return [
            {
                "status": "success",
                "endpoint_order": list(REGRESSION_ENDPOINTS),
                "endpoints": endpoints,
                "manifest_schema_version": "1.0.0",
                "manifest_sha256": "test-manifest",
                "release_status": "frozen",
                "model_family": "chemprop_dmpnn",
            }
            for _ in smiles
        ]


def _regression_manifest(path: Path) -> Path:
    endpoints = {}
    for endpoint in REGRESSION_ENDPOINTS:
        endpoints[endpoint] = {
            "internal_model_output_unit": "log10(Papp [cm/s])" if endpoint == "caco2_wang" else "internal",
            "user_facing_unit": f"unit-{endpoint}",
            "scientific_transform": "log10" if endpoint == "vdss_lombardo" else "identity",
            "inverse_transform_for_user_output": "10**y" if endpoint == "vdss_lombardo" else "identity",
        }
    path.write_text(json.dumps({"endpoints": endpoints}), encoding="utf-8")
    return path


def _dependencies(tmp_path, *, gmc=None):
    regression = FakeRegression(_regression_manifest(tmp_path / "regression_manifest.json"))
    return QualificationDependencies(
        chemberta_factory=FakeChemBERTa,
        gmc_factory=(lambda: gmc or FakeGMC()),
        regression_factory=lambda: regression,
    )


def test_mocked_harness_never_creates_real_pass_and_isolates_invalid_smiles(tmp_path):
    FakeChemBERTa.calls = []
    gmc = FakeGMC()
    output = tmp_path / "qualification"
    summary = run_qualification(
        QualificationConfig(output_dir=output),
        dependencies=_dependencies(tmp_path, gmc=gmc),
    )
    assert summary["overall_status"] == MOCK_TESTED_ONLY
    assert summary["family_status"]["chemberta"] == MOCK_TESTED_ONLY
    assert summary["family_status"]["gmc_mpnn_bbb"] == MOCK_TESTED_ONLY
    assert summary["family_status"]["chemprop_regression"] == MOCK_TESTED_ONLY
    assert all(status != "PASS" for status in summary["family_status"].values())
    assert len(FakeChemBERTa.calls[0]) == 3
    assert all("not-a-smiles" not in call[1] for call in gmc.calls)
    molecules = json.loads((output / "qualification_predictions.json").read_text())["molecules"]
    invalid = next(item for item in molecules if item["molecule_id"] == "acceptance_invalid")
    assert invalid["inference_attempted"] is False


def _public_chemberta_row(endpoints=None):
    return {
        "status": "available",
        "endpoints": endpoints
        or {
            endpoint: {"calibrated_probability": 0.5}
            for endpoint in CLASSIFICATION_ENDPOINTS
        },
    }


def test_internal_bbb_is_audited_but_production_registry_controls_public_contract():
    result, rows = _qualify_chemberta(
        FakeChemBERTa,
        ["one"],
        ["CCO"],
        test_mode=True,
    )
    assert result["status"] == MOCK_TESTED_ONLY
    assert tuple(rows[0]["endpoints"]) == CLASSIFICATION_ENDPOINTS
    assert "bbb_martins" not in rows[0]["endpoints"]
    assert result["provenance"]["raw_internal_endpoint_count"] == 10
    assert result["provenance"]["public_endpoint_count"] == 9
    assert result["provenance"]["internal_bbb_martins_present"] is True
    assert result["provenance"]["public_bbb_martins_present"] is False


def test_public_chemberta_bbb_is_rejected():
    endpoints = _public_chemberta_row()["endpoints"]
    endpoints["bbb_martins"] = {"calibrated_probability": 0.8}
    with pytest.raises(ValueError, match="public endpoint contract"):
        _verify_chemberta_public_rows([_public_chemberta_row(endpoints)], 1)


def test_public_chemberta_missing_endpoint_is_rejected():
    endpoints = _public_chemberta_row()["endpoints"]
    endpoints.pop(CLASSIFICATION_ENDPOINTS[-1])
    with pytest.raises(ValueError, match="public endpoint contract"):
        _verify_chemberta_public_rows([_public_chemberta_row(endpoints)], 1)


def test_public_chemberta_unexpected_endpoint_is_rejected():
    endpoints = _public_chemberta_row()["endpoints"]
    endpoints["unexpected_endpoint"] = {"calibrated_probability": 0.8}
    with pytest.raises(ValueError, match="public endpoint contract"):
        _verify_chemberta_public_rows([_public_chemberta_row(endpoints)], 1)


def test_chemberta_without_successful_inference_cannot_pass():
    class NotRunChemBERTa:
        def predict_batch(self, smiles):
            return [
                {
                    "prediction_status": "not_run",
                    "endpoints": {
                        endpoint: {"calibrated_probability": None}
                        for endpoint in CLASSIFICATION_ENDPOINTS
                    },
                }
                for _ in smiles
            ]

    result, rows = _qualify_chemberta(
        NotRunChemBERTa,
        ["one"],
        ["CCO"],
        test_mode=False,
    )
    assert result["status"] == FAIL
    assert rows == []


def test_chemberta_release_hash_failure_remains_fail_closed():
    result, rows = _qualify_chemberta(
        lambda: (_ for _ in ()).throw(RuntimeError("SHA-256 mismatch for ChemBERTa release")),
        ["one"],
        ["CCO"],
        test_mode=False,
    )
    assert result["status"] == FAIL
    assert result["error_code"] == "hash_mismatch"
    assert rows == []


def test_missing_runtime_is_not_run_and_incompatible_runtime_is_fail(tmp_path):
    missing, _ = _qualify_gmc(
        lambda: (_ for _ in ()).throw(RuntimeError("packaged_runtime_missing: unavailable")),
        ["one"],
        ["CCO"],
        PROJECT_ROOT,
        test_mode=False,
    )
    incompatible, _ = _qualify_gmc(
        lambda: (_ for _ in ()).throw(RuntimeError("runtime_incompatible: wrong Chemprop")),
        ["one"],
        ["CCO"],
        PROJECT_ROOT,
        test_mode=False,
    )
    assert missing["status"] == NOT_RUN_RUNTIME_MISSING
    assert incompatible["status"] == FAIL


def test_runner_hash_mismatch_is_fail(tmp_path):
    predictor = FakeGMC()
    predictor.runner = tmp_path / "wrong-runner.py"
    predictor.runner.write_text("wrong", encoding="utf-8")
    result, _ = _qualify_gmc(
        lambda: predictor,
        ["one"],
        ["CCO"],
        PROJECT_ROOT,
        test_mode=False,
    )
    assert result["status"] == FAIL
    assert result["error_code"] == "hash_mismatch"


def test_gmc_arithmetic_and_deterministic_repeat_are_verified():
    valid = FakeGMC().predict_batch(["one"], ["CCO"])[0]
    _verify_gmc_row(valid)
    invalid = {**valid, "ensemble_probability": 0.1}
    with pytest.raises(ValueError, match="ensemble mean"):
        _verify_gmc_row(invalid)
    changing, _ = _qualify_gmc(
        lambda: FakeGMC(changing=True),
        ["one"],
        ["CCO"],
        PROJECT_ROOT,
        test_mode=False,
    )
    assert changing["status"] == FAIL
    assert "repeat" in changing["reason"].lower()


def test_existing_output_directory_is_rejected(tmp_path):
    output = tmp_path / "exists"
    output.mkdir()
    with pytest.raises(FileExistsError, match="already exists"):
        run_qualification(
            QualificationConfig(output_dir=output),
            dependencies=_dependencies(tmp_path),
        )


def test_private_paths_are_sanitized():
    payload = {"warning": r"failure under C:\Users\private-user\models\runner.py"}
    sanitized = sanitize_private_paths(payload)
    assert "private-user" not in sanitized["warning"]
    assert "<redacted-path>" in sanitized["warning"]


def test_required_outputs_and_sha256s_are_generated(tmp_path):
    output = tmp_path / "qualification"
    run_qualification(
        QualificationConfig(output_dir=output),
        dependencies=_dependencies(tmp_path),
    )
    required = {
        "qualification_summary.json",
        "qualification_predictions.json",
        "runtime_provenance.json",
        "SHA256SUMS",
    }
    assert required.issubset({path.name for path in output.iterdir()})
    lines = (output / "SHA256SUMS").read_text(encoding="ascii").splitlines()
    recorded = {line.split("  ", 1)[1] for line in lines}
    assert required.difference({"SHA256SUMS"}).issubset(recorded)
    for line in lines:
        digest, relative = line.split("  ", 1)
        assert len(digest) == 64
        assert (output / relative).is_file()
