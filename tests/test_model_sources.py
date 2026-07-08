from pathlib import Path

import pytest

from molecular_prioritization import bbb_predictor, model_sources


def configure_temp_app_data(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    app_data = tmp_path / "app_data"
    cache_root = app_data / "model_cache" / "huggingface"
    monkeypatch.setattr(model_sources, "APP_DATA_DIR", app_data)
    monkeypatch.setattr(model_sources, "MODEL_CACHE_DIR", app_data / "model_cache")
    monkeypatch.setattr(model_sources, "HUGGINGFACE_CACHE_DIR", cache_root)
    monkeypatch.setattr(model_sources, "PUBLIC_LOOKUP_CACHE_DIR", app_data / "public_lookup_cache")
    monkeypatch.setattr(model_sources, "MANIFEST_DIR", app_data / "manifests")
    monkeypatch.setattr(model_sources, "MODEL_MANIFEST_PATH", app_data / "manifests" / "model_manifest.json")
    monkeypatch.setattr(
        model_sources,
        "PUBLIC_DATA_MANIFEST_PATH",
        app_data / "manifests" / "public_data_manifest.json",
    )
    monkeypatch.setattr(model_sources, "RUN_MANIFEST_PATH", app_data / "manifests" / "run_manifest.json")
    monkeypatch.setattr(bbb_predictor, "APP_MODEL_CACHE_DIR", cache_root)
    monkeypatch.delenv(bbb_predictor.MODEL_CACHE_ENV, raising=False)
    return cache_root


def test_app_managed_cache_path_resolution(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    cache_root = configure_temp_app_data(tmp_path, monkeypatch)

    assert bbb_predictor.configured_cache_dir() == cache_root
    assert model_sources.bbb_cache_root() == cache_root
    assert str(model_sources.bbb_cache_path()).endswith(
        "models--Yousuf7--ChemBERT-BBB-Permeability"
    )


def test_model_manifest_creation_records_bbb_model(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    configure_temp_app_data(tmp_path, monkeypatch)

    manifest = model_sources.update_model_manifest()
    record = manifest["models"]["bbb_chemberta"]

    assert record["model_label"] == "BBB/ChemBERTa"
    assert record["model_id"] == bbb_predictor.CHEMBERTA_BBB_MODEL_ID
    assert record["model_type"] == "bbb_prediction"
    assert record["backend"] == "transformers"
    assert record["cached"] is False
    assert record["status"] == "model_unavailable"
    assert record["last_checked"]


def test_missing_bbb_model_shows_unavailable(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    configure_temp_app_data(tmp_path, monkeypatch)

    record = model_sources.build_bbb_model_record()

    assert record.cached is False
    assert record.status == "model_unavailable"


def test_configured_local_bbb_model_path_is_recorded(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    configured_cache = tmp_path / "custom_bbb_cache"
    monkeypatch.setenv(bbb_predictor.MODEL_CACHE_ENV, str(configured_cache))
    configure_temp_app_data(tmp_path, monkeypatch)
    monkeypatch.setenv(bbb_predictor.MODEL_CACHE_ENV, str(configured_cache))

    manifest = model_sources.update_model_manifest()

    assert manifest["cache_root"] == str(configured_cache)
    assert str(configured_cache) in manifest["models"]["bbb_chemberta"]["cache_path"]


def test_latest_run_manifest_records_bbb_status(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    configure_temp_app_data(tmp_path, monkeypatch)
    rows = [
        {"molecule_id": "mol_1", "bbb_model_status": "model_unavailable"},
        {"molecule_id": "mol_2", "bbb_model_status": "not_run_invalid_molecule"},
    ]

    manifest = model_sources.update_run_manifest(
        job_id="job-1",
        output_file="backend/job_outputs/job-1/ranked_results.csv",
        rows=rows,
    )

    run = manifest["runs"]["job-1"]
    assert run["actual_bbb_model_status"] == "model_unavailable"
    assert run["fallback_placeholder_used"] is True
    assert run["bbb_model_status_values"] == ["model_unavailable", "not_run_invalid_molecule"]


def test_no_automatic_model_download_when_cache_missing(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    configure_temp_app_data(tmp_path, monkeypatch)
    imports = []
    real_import = __import__

    def tracking_import(name, *args, **kwargs):
        imports.append(name)
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr("builtins.__import__", tracking_import)
    with pytest.raises(bbb_predictor.BBBPredictorUnavailable):
        bbb_predictor.CachedChembertaBBBPredictor()

    assert "transformers" not in imports
    assert "torch" not in imports


def test_public_data_manifest_records_planned_inactive_sources(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    configure_temp_app_data(tmp_path, monkeypatch)

    manifest = model_sources.update_public_data_manifest()

    assert set(manifest["sources"]) == {"PubChem", "ChEMBL", "SureChEMBL"}
    assert {source["status"] for source in manifest["sources"].values()} == {"planned_inactive"}
    assert all(source["last_checked"] for source in manifest["sources"].values())
