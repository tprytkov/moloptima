"""App-managed model and public data source manifests."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from molecular_prioritization.bbb_predictor import (
    CHEMBERTA_BBB_MODEL_ID,
    MODEL_CACHE_ENV,
    cache_candidates,
    configured_cache_dir,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
APP_DATA_DIR = PROJECT_ROOT / "app_data"
MODEL_CACHE_DIR = APP_DATA_DIR / "model_cache"
HUGGINGFACE_CACHE_DIR = MODEL_CACHE_DIR / "huggingface"
PUBLIC_LOOKUP_CACHE_DIR = APP_DATA_DIR / "public_lookup_cache"
MANIFEST_DIR = APP_DATA_DIR / "manifests"
MODEL_MANIFEST_PATH = MANIFEST_DIR / "model_manifest.json"
PUBLIC_DATA_MANIFEST_PATH = MANIFEST_DIR / "public_data_manifest.json"
RUN_MANIFEST_PATH = MANIFEST_DIR / "run_manifest.json"
PUBLIC_SOURCES = ("PubChem", "ChEMBL", "SureChEMBL")


@dataclass(frozen=True)
class ModelManifestRecord:
    model_label: str
    model_id: str
    model_type: str
    backend: str
    cache_path: str
    cached: bool
    last_checked: str
    last_loaded: str
    status: str
    error_message: str


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def relative_path(path: Path) -> str:
    try:
        return path.resolve().relative_to(PROJECT_ROOT.resolve()).as_posix()
    except ValueError:
        return str(path)


def ensure_app_data_dirs() -> None:
    for path in (
        APP_DATA_DIR,
        MODEL_CACHE_DIR,
        HUGGINGFACE_CACHE_DIR,
        PUBLIC_LOOKUP_CACHE_DIR,
        MANIFEST_DIR,
    ):
        path.mkdir(parents=True, exist_ok=True)


def read_manifest(path: Path) -> dict[str, object]:
    if not path.exists():
        return {}
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def write_manifest(path: Path, payload: dict[str, object]) -> None:
    ensure_app_data_dirs()
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")


def bbb_cache_root() -> Path:
    return configured_cache_dir()


def bbb_cache_path() -> Path:
    candidates = cache_candidates(bbb_cache_root(), CHEMBERTA_BBB_MODEL_ID)
    for path in candidates:
        if path.exists():
            return path
    return candidates[0]


def is_bbb_model_cached() -> bool:
    return any(path.exists() for path in cache_candidates(bbb_cache_root(), CHEMBERTA_BBB_MODEL_ID))


def build_bbb_model_record(
    *,
    actual_status: str = "",
    error_message: str = "",
    loaded: bool = False,
) -> ModelManifestRecord:
    cached = is_bbb_model_cached()
    status = actual_status or ("cached" if cached else "model_unavailable")
    return ModelManifestRecord(
        model_label="BBB/ChemBERTa",
        model_id=CHEMBERTA_BBB_MODEL_ID,
        model_type="bbb_prediction",
        backend="transformers",
        cache_path=relative_path(bbb_cache_path()),
        cached=cached,
        last_checked=utc_timestamp(),
        last_loaded=utc_timestamp() if loaded else "",
        status=status,
        error_message=error_message,
    )


def update_model_manifest(record: ModelManifestRecord | None = None) -> dict[str, object]:
    record = record or build_bbb_model_record()
    payload = {
        "cache_root": relative_path(bbb_cache_root()),
        "env_var": MODEL_CACHE_ENV,
        "last_checked": utc_timestamp(),
        "models": {
            "bbb_chemberta": asdict(record),
        },
    }
    write_manifest(MODEL_MANIFEST_PATH, payload)
    return payload


def planned_public_source_statuses(
    *,
    pubchem_status: str = "available_when_requested",
    pubchem_last_successful_lookup: str = "",
    pubchem_error_message: str = "",
    chembl_status: str = "available_when_requested",
    chembl_last_successful_lookup: str = "",
    chembl_error_message: str = "",
    surechembl_status: str = "available_when_requested",
    surechembl_last_successful_lookup: str = "",
    surechembl_error_message: str = "",
) -> dict[str, dict[str, object]]:
    timestamp = utc_timestamp()
    sources = {
        source: {
            "source_name": source,
            "status": "planned_inactive",
            "last_checked": timestamp,
            "last_successful_lookup": "",
            "cache_path": relative_path(PUBLIC_LOOKUP_CACHE_DIR),
            "error_message": "",
        }
        for source in PUBLIC_SOURCES
    }
    sources["PubChem"].update(
        {
            "status": pubchem_status,
            "last_successful_lookup": pubchem_last_successful_lookup,
            "cache_path": relative_path(PUBLIC_LOOKUP_CACHE_DIR / "pubchem"),
            "error_message": pubchem_error_message,
        }
    )
    sources["ChEMBL"].update(
        {
            "status": chembl_status,
            "last_successful_lookup": chembl_last_successful_lookup,
            "cache_path": relative_path(PUBLIC_LOOKUP_CACHE_DIR / "chembl"),
            "error_message": chembl_error_message,
        }
    )
    sources["SureChEMBL"].update(
        {
            "status": surechembl_status,
            "last_successful_lookup": surechembl_last_successful_lookup,
            "cache_path": relative_path(PUBLIC_LOOKUP_CACHE_DIR / "surechembl"),
            "error_message": surechembl_error_message,
        }
    )
    return sources


def update_public_data_manifest(
    *,
    pubchem_status: str = "available_when_requested",
    pubchem_last_successful_lookup: str = "",
    pubchem_error_message: str = "",
    chembl_status: str = "available_when_requested",
    chembl_last_successful_lookup: str = "",
    chembl_error_message: str = "",
    surechembl_status: str = "available_when_requested",
    surechembl_last_successful_lookup: str = "",
    surechembl_error_message: str = "",
) -> dict[str, object]:
    payload = {
        "last_checked": utc_timestamp(),
        "sources": planned_public_source_statuses(
            pubchem_status=pubchem_status,
            pubchem_last_successful_lookup=pubchem_last_successful_lookup,
            pubchem_error_message=pubchem_error_message,
            chembl_status=chembl_status,
            chembl_last_successful_lookup=chembl_last_successful_lookup,
            chembl_error_message=chembl_error_message,
            surechembl_status=surechembl_status,
            surechembl_last_successful_lookup=surechembl_last_successful_lookup,
            surechembl_error_message=surechembl_error_message,
        ),
    }
    write_manifest(PUBLIC_DATA_MANIFEST_PATH, payload)
    return payload


def bbb_status_values(rows: Iterable[dict[str, object]]) -> list[str]:
    values = {
        str(row.get("bbb_model_status", "")).strip()
        for row in rows
        if str(row.get("bbb_model_status", "")).strip()
    }
    return sorted(values)


def row_status_values(rows: Iterable[dict[str, object]], column: str) -> list[str]:
    values = {
        str(row.get(column, "")).strip()
        for row in rows
        if str(row.get(column, "")).strip()
    }
    return sorted(values)


def summarize_pubchem_source(rows: list[dict[str, object]]) -> dict[str, str]:
    statuses = row_status_values(rows, "pubchem_lookup_status")
    if not statuses or statuses == ["not_requested"]:
        return {
            "status": "not_requested",
            "last_successful_lookup": "",
            "error_message": "",
        }
    if "exact_match" in statuses or "no_exact_match" in statuses:
        return {
            "status": "lookup_completed",
            "last_successful_lookup": utc_timestamp(),
            "error_message": "",
        }
    if "lookup_failed" in statuses:
        warnings = {
            str(row.get("pubchem_warning", "")).strip()
            for row in rows
            if str(row.get("pubchem_warning", "")).strip()
        }
        return {
            "status": "lookup_failed",
            "last_successful_lookup": "",
            "error_message": "; ".join(sorted(warnings)),
        }
    return {
        "status": "not_requested",
        "last_successful_lookup": "",
        "error_message": "",
    }


def summarize_chembl_source(rows: list[dict[str, object]]) -> dict[str, str]:
    statuses = row_status_values(rows, "chembl_lookup_status")
    if not statuses or statuses == ["not_requested"]:
        return {
            "status": "not_requested",
            "last_successful_lookup": "",
            "error_message": "",
        }
    if any(status in {"exact_match", "similarity_match", "no_match"} for status in statuses):
        return {
            "status": "lookup_completed",
            "last_successful_lookup": utc_timestamp(),
            "error_message": "",
        }
    if "lookup_failed" in statuses:
        warnings = {
            str(row.get("chembl_warning", "")).strip()
            for row in rows
            if str(row.get("chembl_warning", "")).strip()
        }
        return {
            "status": "lookup_failed",
            "last_successful_lookup": "",
            "error_message": "; ".join(sorted(warnings)),
        }
    return {
        "status": "not_requested",
        "last_successful_lookup": "",
        "error_message": "",
    }


def summarize_patent_source(rows: list[dict[str, object]]) -> dict[str, str]:
    statuses = row_status_values(rows, "patent_lookup_status")
    if not statuses or statuses == ["not_requested"]:
        return {
            "status": "not_requested",
            "last_successful_lookup": "",
            "error_message": "",
        }
    if any(status in {"match_found", "no_match"} for status in statuses):
        return {
            "status": "lookup_completed",
            "last_successful_lookup": utc_timestamp(),
            "error_message": "",
        }
    if "lookup_failed" in statuses:
        warnings = {
            str(row.get("patent_warning", "")).strip()
            for row in rows
            if str(row.get("patent_warning", "")).strip()
        }
        return {
            "status": "lookup_failed",
            "last_successful_lookup": "",
            "error_message": "; ".join(sorted(warnings)),
        }
    return {
        "status": "not_requested",
        "last_successful_lookup": "",
        "error_message": "",
    }


def update_run_manifest(
    *,
    job_id: str,
    output_file: str,
    rows: list[dict[str, object]],
) -> dict[str, object]:
    existing = read_manifest(RUN_MANIFEST_PATH)
    runs = existing.get("runs") if isinstance(existing.get("runs"), dict) else {}
    statuses = bbb_status_values(rows)
    pubchem_statuses = row_status_values(rows, "pubchem_lookup_status")
    chembl_statuses = row_status_values(rows, "chembl_lookup_status")
    patent_statuses = row_status_values(rows, "patent_lookup_status")
    public_lookup_requested = any(
        status not in {"", "not_requested"} for status in pubchem_statuses
    ) or any(status not in {"", "not_requested"} for status in chembl_statuses) or any(
        status not in {"", "not_requested"} for status in patent_statuses
    )
    model_available = "model_available" in statuses
    placeholder_used = any(status != "model_available" for status in statuses) or not model_available
    run = {
        "timestamp": utc_timestamp(),
        "selected_bbb_model_path": relative_path(bbb_cache_root()),
        "actual_bbb_model_status": "model_available" if model_available else "model_unavailable",
        "bbb_model_status_values": statuses,
        "fallback_placeholder_used": placeholder_used,
        "public_lookup_requested": public_lookup_requested,
        "pubchem_lookup_status_values": pubchem_statuses,
        "chembl_lookup_status_values": chembl_statuses,
        "patent_lookup_status_values": patent_statuses,
        "public_lookup_source_statuses": {
            "PubChem": summarize_pubchem_source(rows),
            "ChEMBL": summarize_chembl_source(rows),
            "SureChEMBL": summarize_patent_source(rows),
        },
        "output_file": output_file,
        "row_count": len(rows),
    }
    runs[job_id] = run
    payload = {
        "latest_run": job_id,
        "runs": runs,
    }
    write_manifest(RUN_MANIFEST_PATH, payload)
    update_model_manifest(
        build_bbb_model_record(
            actual_status=run["actual_bbb_model_status"],
            loaded=model_available,
            error_message="" if model_available else "BBB/ChemBERTa model was unavailable for latest run.",
        )
    )
    pubchem_source = summarize_pubchem_source(rows)
    chembl_source = summarize_chembl_source(rows)
    patent_source = summarize_patent_source(rows)
    update_public_data_manifest(
        pubchem_status=pubchem_source["status"],
        pubchem_last_successful_lookup=pubchem_source["last_successful_lookup"],
        pubchem_error_message=pubchem_source["error_message"],
        chembl_status=chembl_source["status"],
        chembl_last_successful_lookup=chembl_source["last_successful_lookup"],
        chembl_error_message=chembl_source["error_message"],
        surechembl_status=patent_source["status"],
        surechembl_last_successful_lookup=patent_source["last_successful_lookup"],
        surechembl_error_message=patent_source["error_message"],
    )
    return payload


def current_status_payload() -> dict[str, object]:
    ensure_app_data_dirs()
    model_manifest = update_model_manifest()
    public_manifest = read_manifest(PUBLIC_DATA_MANIFEST_PATH) or update_public_data_manifest()
    run_manifest = read_manifest(RUN_MANIFEST_PATH)
    return {
        "model_manifest": model_manifest,
        "public_data_manifest": public_manifest,
        "run_manifest": run_manifest,
    }


def refresh_source_status_payload() -> dict[str, object]:
    return {
        "model_manifest": update_model_manifest(),
        "public_data_manifest": update_public_data_manifest(),
        "run_manifest": read_manifest(RUN_MANIFEST_PATH),
    }
