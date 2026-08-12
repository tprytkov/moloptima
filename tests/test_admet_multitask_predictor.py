import json
import math
from pathlib import Path

import pytest

from molecular_prioritization import admet_multitask_predictor as predictor_module


TASKS = (
    "hia_hou",
    "pgp_broccatelli",
    "bbb_martins",
    "cyp1a2_veith",
    "cyp2c19_veith",
    "cyp2c9_veith",
    "cyp2d6_veith",
    "cyp3a4_veith",
    "herg_karim",
    "ames",
)


class FakeTokenizer:
    def __init__(self):
        self.last_call = None

    def __call__(self, smiles, **kwargs):
        import torch

        self.last_call = (smiles, kwargs)
        return {
            "input_ids": torch.tensor([[0, 4, 2]] * len(smiles)),
            "attention_mask": torch.tensor([[1, 1, 1]] * len(smiles)),
        }


def _write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


@pytest.fixture()
def synthetic_bundle(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    import torch

    bundle = tmp_path / "bundle"
    model_config = {
        "tasks": list(TASKS),
        "pooling": "masked_mean",
        "dropout": 0.15,
        "head_type": "linear",
        "head_output_size": 1,
        "local_files_only": True,
    }
    encoder_config = {
        "architectures": ["RobertaModel"],
        "model_type": "roberta",
        "vocab_size": 10,
        "hidden_size": 8,
        "num_hidden_layers": 1,
        "num_attention_heads": 2,
        "intermediate_size": 16,
        "max_position_embeddings": 130,
        "type_vocab_size": 1,
        "pad_token_id": 1,
        "bos_token_id": 0,
        "eos_token_id": 2,
    }
    calibration = {
        "endpoint_order": list(TASKS),
        "endpoints": {
            task: {
                "coefficient_a": None if task == "hia_hou" else 2.0,
                "intercept_b": None if task == "hia_hou" else -1.0,
            }
            for task in TASKS
        },
    }
    metadata = {
        "endpoint_order": list(TASKS),
        "endpoints": {
            task: {
                "display_name": "HIA" if task == "hia_hou" else task,
                "positive_class": f"positive {task}",
                "evidence_status": (
                    "limited_support"
                    if task == "hia_hou"
                    else "experimental_low_confidence"
                    if task == "bbb_martins"
                    else "strong"
                ),
                "calibration": "identity" if task == "hia_hou" else "platt",
            }
            for task in TASKS
        },
    }
    _write_json(bundle / "model/multitask_model_config.json", model_config)
    _write_json(bundle / "model/encoder_config/config.json", encoder_config)
    _write_json(bundle / "calibration/calibration_parameters.json", calibration)
    _write_json(bundle / "endpoint_metadata.json", metadata)
    _write_json(bundle / "tokenizer/tokenizer.json", {})
    _write_json(bundle / "tokenizer/tokenizer_config.json", {})

    model = predictor_module._build_model(
        bundle / "model/encoder_config", TASKS, dropout=0.15
    )
    for head in model.heads.values():
        torch.nn.init.zeros_(head.weight)
        torch.nn.init.constant_(head.bias, 1.0)
    torch.save(model.state_dict(), bundle / "model/model_state.pt")

    fake_tokenizer = FakeTokenizer()
    monkeypatch.setattr(predictor_module, "_load_tokenizer", lambda _: fake_tokenizer)
    return bundle


def test_predict_uses_frozen_calibration_metadata_and_sequence_limit(synthetic_bundle: Path):
    predictor = predictor_module.OfflineADMETMultitaskPredictor(synthetic_bundle)

    result = predictor.predict("CCO")

    assert result["prediction_status"] == "available"
    assert tuple(result["endpoints"]) == TASKS
    hia = result["endpoints"]["hia_hou"]
    assert hia["raw_logit"] == pytest.approx(1.0)
    assert hia["raw_probability"] == pytest.approx(1 / (1 + math.exp(-1)))
    assert hia["calibrated_probability"] == hia["raw_probability"]
    assert hia["binary_prediction"] == 1
    assert hia["evidence_status"] == "limited_support"
    assert "identity calibration" in hia["warning"]

    bbb = result["endpoints"]["bbb_martins"]
    assert bbb["calibrated_probability"] == pytest.approx(1 / (1 + math.exp(-1)))
    assert bbb["evidence_status"] == "experimental_low_confidence"
    assert "low-confidence" in bbb["warning"]
    assert predictor.tokenizer.last_call[1]["max_length"] == 128
    assert predictor.tokenizer.last_call[1]["truncation"] is True


def test_invalid_smiles_does_not_crash_mixed_batch(synthetic_bundle: Path):
    predictor = predictor_module.OfflineADMETMultitaskPredictor(synthetic_bundle)

    results = predictor.predict_batch(["CCO", "not-a-smiles", None])

    assert results[0]["prediction_status"] == "available"
    for result in results[1:]:
        assert result["prediction_status"] == "not_run"
        for endpoint in result["endpoints"].values():
            assert endpoint["raw_logit"] is None
            assert endpoint["raw_probability"] is None
            assert endpoint["calibrated_probability"] is None
            assert endpoint["binary_prediction"] is None
            assert "invalid" in endpoint["warning"]


def test_strict_state_loading_rejects_mismatched_synthetic_checkpoint(
    synthetic_bundle: Path,
):
    import torch

    state_path = synthetic_bundle / "model/model_state.pt"
    state = torch.load(state_path, map_location="cpu", weights_only=True)
    state.pop("heads.ames.bias")
    torch.save(state, state_path)

    with pytest.raises(predictor_module.ADMETBundleError, match="Strict loading"):
        predictor_module.OfflineADMETMultitaskPredictor(synthetic_bundle)


def test_bundle_validation_happens_before_loading(tmp_path: Path, monkeypatch):
    called = False

    def unexpected_tokenizer_load(_):
        nonlocal called
        called = True

    monkeypatch.setattr(predictor_module, "_load_tokenizer", unexpected_tokenizer_load)

    with pytest.raises(predictor_module.ADMETBundleError, match="missing required files"):
        predictor_module.OfflineADMETMultitaskPredictor(tmp_path)

    assert called is False


def test_public_loader_caches_one_instance(synthetic_bundle: Path):
    predictor_module._cached_predictor.cache_clear()

    first = predictor_module.load_admet_multitask_predictor(synthetic_bundle)
    second = predictor_module.load_admet_multitask_predictor(synthetic_bundle)

    assert first is second
    assert predictor_module._cached_predictor.cache_info().currsize == 1
    predictor_module._cached_predictor.cache_clear()
