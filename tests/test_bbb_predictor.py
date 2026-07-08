from pathlib import Path

from molecular_prioritization.bbb_predictor import (
    CHEMBERTA_BBB_MODEL_ID,
    UnavailableBBBPredictor,
    cache_candidates,
    configured_cache_dir,
    first_available_cache_dir,
    normalize_bbb_label,
    normalize_cache_root,
)


def test_unavailable_bbb_predictor_returns_clear_placeholder():
    predictor = UnavailableBBBPredictor("local model cache not found")

    prediction = predictor.predict("CCO", valid_molecule=True)

    assert prediction.bbb_prediction == "unavailable"
    assert prediction.bbb_probability is None
    assert prediction.bbb_model_status == "model_unavailable"
    assert prediction.bbb_warning == "local model cache not found"


def test_unavailable_bbb_predictor_marks_invalid_molecule_without_model_warning():
    predictor = UnavailableBBBPredictor("local model cache not found")

    prediction = predictor.predict(None, valid_molecule=False)

    assert prediction.bbb_prediction == "unavailable"
    assert prediction.bbb_probability is None
    assert prediction.bbb_model_status == "not_run_invalid_molecule"
    assert prediction.bbb_warning == "BBB prediction skipped for invalid molecule."


def test_cache_candidate_detection_uses_local_huggingface_layout(tmp_path: Path):
    cache_root = tmp_path / "huggingface"
    cache_candidates(cache_root, CHEMBERTA_BBB_MODEL_ID)[0].mkdir(parents=True)

    assert first_available_cache_dir([cache_root], CHEMBERTA_BBB_MODEL_ID) == cache_root


def test_configured_cache_dir_uses_default_app_cache(monkeypatch):
    monkeypatch.delenv("MOLOPTIMA_BBB_MODEL_CACHE", raising=False)

    cache_dir = configured_cache_dir()

    assert cache_dir.name == "huggingface"
    assert cache_dir.parts[-3:] == ("app_data", "model_cache", "huggingface")


def test_environment_cache_override_is_preserved(monkeypatch, tmp_path: Path):
    override = tmp_path / "custom_cache"
    monkeypatch.setenv("MOLOPTIMA_BBB_MODEL_CACHE", str(override))

    assert configured_cache_dir() == override


def test_direct_model_folder_override_normalizes_to_cache_root(tmp_path: Path):
    model_folder = cache_candidates(tmp_path / "huggingface", CHEMBERTA_BBB_MODEL_ID)[0]

    assert normalize_cache_root(model_folder, CHEMBERTA_BBB_MODEL_ID) == tmp_path / "huggingface"


def test_normalize_bbb_label():
    assert normalize_bbb_label("LABEL_1 positive permeable") == "high"
    assert normalize_bbb_label("LABEL_0 negative") == "low"
    assert normalize_bbb_label("other") == "uncertain"
