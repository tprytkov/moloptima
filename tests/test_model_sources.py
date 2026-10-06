import json
import threading
from pathlib import Path

import pytest

from molecular_prioritization import bbb_predictor, model_sources


def configure_temp_app_data(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    app_data = tmp_path / "app_data"
    template_dir = tmp_path / "tracked_templates"
    runtime_root = tmp_path / "runtime"
    template_dir.mkdir(parents=True)
    templates = {
        "model_manifest.json": {"last_checked": "", "models": {}},
        "public_data_manifest.json": {
            "last_checked": "",
            "sources": {
                source: {"source_name": source, "status": "not_requested"}
                for source in model_sources.PUBLIC_SOURCES
            },
        },
        "run_manifest.json": {"latest_run": None, "runs": {}},
    }
    for name, payload in templates.items():
        (template_dir / name).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    cache_root = app_data / "model_cache" / "huggingface"
    monkeypatch.setattr(model_sources, "APP_DATA_DIR", app_data)
    monkeypatch.setattr(model_sources, "MODEL_CACHE_DIR", app_data / "model_cache")
    monkeypatch.setattr(model_sources, "HUGGINGFACE_CACHE_DIR", cache_root)
    monkeypatch.setattr(model_sources, "PUBLIC_LOOKUP_CACHE_DIR", app_data / "public_lookup_cache")
    monkeypatch.setattr(model_sources, "TEMPLATE_MANIFEST_DIR", template_dir)
    monkeypatch.setattr(model_sources, "MODEL_MANIFEST_TEMPLATE_PATH", template_dir / "model_manifest.json")
    monkeypatch.setattr(
        model_sources,
        "PUBLIC_DATA_MANIFEST_TEMPLATE_PATH",
        template_dir / "public_data_manifest.json",
    )
    monkeypatch.setattr(model_sources, "RUN_MANIFEST_TEMPLATE_PATH", template_dir / "run_manifest.json")
    monkeypatch.setattr(model_sources, "RUNTIME_DATA_ROOT", runtime_root)
    monkeypatch.setattr(model_sources, "MANIFEST_DIR", runtime_root / "manifests")
    monkeypatch.setattr(model_sources, "MODEL_MANIFEST_PATH", runtime_root / "manifests" / "model_manifest.json")
    monkeypatch.setattr(
        model_sources,
        "PUBLIC_DATA_MANIFEST_PATH",
        runtime_root / "manifests" / "public_data_manifest.json",
    )
    monkeypatch.setattr(model_sources, "RUN_MANIFEST_PATH", runtime_root / "manifests" / "run_manifest.json")
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
        {
            "molecule_id": "mol_1",
            "bbb_model_status": "model_unavailable",
            "pubchem_lookup_status": "not_requested",
            "chembl_lookup_status": "not_requested",
            "patent_lookup_status": "not_requested",
        },
        {
            "molecule_id": "mol_2",
            "bbb_model_status": "not_run_invalid_molecule",
            "pubchem_lookup_status": "not_requested",
            "chembl_lookup_status": "not_requested",
            "patent_lookup_status": "not_requested",
        },
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
    assert run["public_lookup_requested"] is False
    assert run["pubchem_lookup_status_values"] == ["not_requested"]
    assert run["chembl_lookup_status_values"] == ["not_requested"]
    assert run["patent_lookup_status_values"] == ["not_requested"]


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


def test_public_data_manifest_records_public_source_statuses(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    configure_temp_app_data(tmp_path, monkeypatch)

    manifest = model_sources.update_public_data_manifest()

    assert set(manifest["sources"]) == {"PubChem", "ChEMBL", "SureChEMBL"}
    assert manifest["sources"]["PubChem"]["status"] == "available_when_requested"
    assert Path(manifest["sources"]["PubChem"]["cache_path"]).parts[-2:] == (
        "public_lookup_cache",
        "pubchem",
    )
    assert manifest["sources"]["ChEMBL"]["status"] == "available_when_requested"
    assert Path(manifest["sources"]["ChEMBL"]["cache_path"]).parts[-2:] == (
        "public_lookup_cache",
        "chembl",
    )
    assert manifest["sources"]["SureChEMBL"]["status"] == "available_when_requested"
    assert Path(manifest["sources"]["SureChEMBL"]["cache_path"]).parts[-2:] == (
        "public_lookup_cache",
        "surechembl",
    )
    assert all(source["last_checked"] for source in manifest["sources"].values())


def test_run_manifest_records_pubchem_lookup_completed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    configure_temp_app_data(tmp_path, monkeypatch)
    rows = [
        {
            "molecule_id": "mol_1",
            "bbb_model_status": "model_unavailable",
            "pubchem_lookup_status": "exact_match",
            "chembl_lookup_status": "not_requested",
            "patent_lookup_status": "not_requested",
            "pubchem_warning": "",
        },
        {
            "molecule_id": "mol_2",
            "bbb_model_status": "model_unavailable",
            "pubchem_lookup_status": "no_exact_match",
            "chembl_lookup_status": "not_requested",
            "patent_lookup_status": "not_requested",
            "pubchem_warning": "",
        },
    ]

    manifest = model_sources.update_run_manifest(
        job_id="job-pubchem",
        output_file="backend/job_outputs/job-pubchem/ranked_results.csv",
        rows=rows,
    )

    run = manifest["runs"]["job-pubchem"]
    assert run["public_lookup_requested"] is True
    assert run["pubchem_lookup_status_values"] == ["exact_match", "no_exact_match"]
    assert run["public_lookup_source_statuses"]["PubChem"]["status"] == "lookup_completed"
    public_manifest = model_sources.read_manifest(model_sources.PUBLIC_DATA_MANIFEST_PATH)
    assert public_manifest["sources"]["PubChem"]["status"] == "lookup_completed"


def test_run_manifest_records_chembl_lookup_completed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    configure_temp_app_data(tmp_path, monkeypatch)
    rows = [
        {
            "molecule_id": "mol_1",
            "bbb_model_status": "model_unavailable",
            "pubchem_lookup_status": "not_requested",
            "chembl_lookup_status": "exact_match",
            "patent_lookup_status": "not_requested",
            "chembl_warning": "",
        },
        {
            "molecule_id": "mol_2",
            "bbb_model_status": "model_unavailable",
            "pubchem_lookup_status": "not_requested",
            "chembl_lookup_status": "similarity_match",
            "patent_lookup_status": "not_requested",
            "chembl_warning": "",
        },
    ]

    manifest = model_sources.update_run_manifest(
        job_id="job-chembl",
        output_file="backend/job_outputs/job-chembl/ranked_results.csv",
        rows=rows,
    )

    run = manifest["runs"]["job-chembl"]
    assert run["public_lookup_requested"] is True
    assert run["pubchem_lookup_status_values"] == ["not_requested"]
    assert run["chembl_lookup_status_values"] == ["exact_match", "similarity_match"]
    assert run["public_lookup_source_statuses"]["ChEMBL"]["status"] == "lookup_completed"
    public_manifest = model_sources.read_manifest(model_sources.PUBLIC_DATA_MANIFEST_PATH)
    assert public_manifest["sources"]["ChEMBL"]["status"] == "lookup_completed"


def test_run_manifest_records_patent_lookup_completed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    configure_temp_app_data(tmp_path, monkeypatch)
    rows = [
        {
            "molecule_id": "mol_1",
            "bbb_model_status": "model_unavailable",
            "pubchem_lookup_status": "not_requested",
            "chembl_lookup_status": "not_requested",
            "patent_lookup_status": "match_found",
            "patent_warning": "",
        },
        {
            "molecule_id": "mol_2",
            "bbb_model_status": "model_unavailable",
            "pubchem_lookup_status": "not_requested",
            "chembl_lookup_status": "not_requested",
            "patent_lookup_status": "no_match",
            "patent_warning": "",
        },
    ]

    manifest = model_sources.update_run_manifest(
        job_id="job-patent",
        output_file="backend/job_outputs/job-patent/ranked_results.csv",
        rows=rows,
    )

    run = manifest["runs"]["job-patent"]
    assert run["public_lookup_requested"] is True
    assert run["pubchem_lookup_status_values"] == ["not_requested"]
    assert run["chembl_lookup_status_values"] == ["not_requested"]
    assert run["patent_lookup_status_values"] == ["match_found", "no_match"]
    assert run["public_lookup_source_statuses"]["SureChEMBL"]["status"] == "lookup_completed"
    public_manifest = model_sources.read_manifest(model_sources.PUBLIC_DATA_MANIFEST_PATH)
    assert public_manifest["sources"]["SureChEMBL"]["status"] == "lookup_completed"


def test_normal_operations_leave_tracked_templates_byte_identical(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    configure_temp_app_data(tmp_path, monkeypatch)
    template_paths = (
        model_sources.MODEL_MANIFEST_TEMPLATE_PATH,
        model_sources.PUBLIC_DATA_MANIFEST_TEMPLATE_PATH,
        model_sources.RUN_MANIFEST_TEMPLATE_PATH,
    )
    before = {path: path.read_bytes() for path in template_paths}
    rows = [
        {
            "molecule_id": "mol-1",
            "bbb_model_status": "model_unavailable",
            "pubchem_lookup_status": "not_requested",
            "chembl_lookup_status": "similarity_match",
            "patent_lookup_status": "not_requested",
            "chembl_warning": "",
        }
    ]

    model_sources.current_status_payload()
    model_sources.refresh_source_status_payload()
    model_sources.update_run_manifest(
        job_id="immutability-job",
        output_file="runtime/results.csv",
        rows=rows,
    )

    assert {path: path.read_bytes() for path in template_paths} == before
    assert model_sources.MODEL_MANIFEST_PATH.is_file()
    assert model_sources.PUBLIC_DATA_MANIFEST_PATH.is_file()
    assert model_sources.RUN_MANIFEST_PATH.is_file()
    assert model_sources.run_record_path("immutability-job").is_file()


def test_runtime_manifest_survives_readback_and_preserves_legacy_template(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    configure_temp_app_data(tmp_path, monkeypatch)
    legacy = {"latest_run": "legacy-job", "runs": {"legacy-job": {"row_count": 2}}}
    model_sources.RUN_MANIFEST_TEMPLATE_PATH.write_text(
        json.dumps(legacy, indent=2) + "\n",
        encoding="utf-8",
    )
    template_before = model_sources.RUN_MANIFEST_TEMPLATE_PATH.read_bytes()

    payload = model_sources.update_run_manifest(
        job_id="new-job",
        output_file="runtime/new.csv",
        rows=[],
    )
    reloaded = model_sources.read_runtime_manifest(
        model_sources.RUN_MANIFEST_PATH,
        model_sources.RUN_MANIFEST_TEMPLATE_PATH,
    )

    assert payload == reloaded
    assert set(reloaded["runs"]) == {"legacy-job", "new-job"}
    assert model_sources.RUN_MANIFEST_TEMPLATE_PATH.read_bytes() == template_before


def test_malformed_runtime_manifest_fails_safe_and_can_be_replaced(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    configure_temp_app_data(tmp_path, monkeypatch)
    model_sources.RUN_MANIFEST_PATH.parent.mkdir(parents=True)
    model_sources.RUN_MANIFEST_PATH.write_text("{not-json", encoding="utf-8")

    assert model_sources.read_runtime_manifest(
        model_sources.RUN_MANIFEST_PATH,
        model_sources.RUN_MANIFEST_TEMPLATE_PATH,
    ) == {}

    payload = model_sources.update_run_manifest(
        job_id="recovery-job",
        output_file="runtime/recovered.csv",
        rows=[],
    )
    assert model_sources.read_manifest(model_sources.RUN_MANIFEST_PATH) == payload


def test_runtime_data_root_is_portable_and_overrideable():
    assert model_sources.resolve_runtime_data_root(
        environ={model_sources.RUNTIME_DATA_ROOT_ENV: "D:/moloptima-state"},
        platform="win32",
        home=Path("C:/Users/example"),
    ) == Path("D:/moloptima-state")
    assert model_sources.resolve_runtime_data_root(
        environ={"APPDATA": "C:/Users/example/AppData/Roaming"},
        platform="win32",
        home=Path("C:/Users/example"),
    ) == Path("C:/Users/example/AppData/Roaming/MolOptima/runtime")
    assert model_sources.resolve_runtime_data_root(
        environ={},
        platform="linux",
        home=Path("/home/example"),
    ) == Path("/home/example/.local/share/MolOptima/runtime")


def test_concurrent_runs_keep_individual_and_index_records(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    configure_temp_app_data(tmp_path, monkeypatch)
    job_ids = [f"job-{index}" for index in range(6)]
    threads = [
        threading.Thread(
            target=model_sources.update_run_manifest,
            kwargs={"job_id": job_id, "output_file": f"runtime/{job_id}.csv", "rows": []},
        )
        for job_id in job_ids
    ]

    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    run_manifest = model_sources.read_manifest(model_sources.RUN_MANIFEST_PATH)
    assert set(run_manifest["runs"]) == set(job_ids)
    assert all(model_sources.run_record_path(job_id).is_file() for job_id in job_ids)
    assert not list(model_sources.MANIFEST_DIR.rglob("*.tmp"))
