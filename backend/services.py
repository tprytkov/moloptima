"""Local-file services for uploads, jobs, and prioritization results."""

from __future__ import annotations

import csv
import json
import shutil
from pathlib import Path
from uuid import uuid4
from datetime import datetime, timezone

from fastapi import HTTPException, UploadFile, status

from molecular_prioritization import model_sources
from molecular_prioritization.pipeline import prioritize_csv


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = PROJECT_ROOT / "backend"
UPLOAD_DIR = BACKEND_DIR / "uploads"
JOB_OUTPUT_DIR = BACKEND_DIR / "job_outputs"
JOB_METADATA_DIR = BACKEND_DIR / "job_metadata"
REQUIRED_COLUMNS = {"molecule_id", "smiles"}


def save_upload(file: UploadFile) -> dict[str, object]:
    """Save an uploaded molecule CSV and return upload metadata."""

    filename = Path(file.filename or "").name
    if not filename.lower().endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Upload must be a CSV file.",
        )

    upload_id = uuid4().hex
    upload_dir = UPLOAD_DIR / upload_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    upload_path = upload_dir / filename

    with upload_path.open("wb") as handle:
        shutil.copyfileobj(file.file, handle)

    rows = validate_molecule_csv(upload_path)

    return {
        "upload_id": upload_id,
        "status": "uploaded",
        "filename": filename,
        "rows": rows,
        "path": relative_path(upload_path),
    }


def run_prioritization_job(
    upload_id: str,
    *,
    enable_public_lookup: bool = False,
    enable_pubchem_lookup: bool | None = None,
    enable_chembl_lookup: bool = False,
) -> dict[str, object]:
    """Run the existing molecular prioritization pipeline for one upload."""

    pubchem_lookup_requested = enable_public_lookup if enable_pubchem_lookup is None else enable_pubchem_lookup
    input_path = find_upload_path(upload_id)
    job_id = uuid4().hex
    job_dir = JOB_OUTPUT_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    output_path = job_dir / "ranked_results.csv"
    metadata = {
        "job_id": job_id,
        "upload_id": upload_id,
        "status": "running",
        "input_file": relative_path(input_path),
        "output_file": relative_path(output_path),
        "created_at": utc_timestamp(),
        "completed_at": None,
        "error_message": "",
        "row_count": 0,
        "public_lookup_requested": pubchem_lookup_requested or enable_chembl_lookup,
        "pubchem_lookup_requested": pubchem_lookup_requested,
        "chembl_lookup_requested": enable_chembl_lookup,
    }
    write_job_metadata(metadata)

    try:
        rows = prioritize_csv(
            input_path,
            output_path,
            enable_public_lookup=enable_public_lookup,
            enable_pubchem_lookup=pubchem_lookup_requested,
            enable_chembl_lookup=enable_chembl_lookup,
        )
    except Exception as exc:
        metadata.update(
            {
                "status": "failed",
                "completed_at": utc_timestamp(),
                "error_message": str(exc),
                "row_count": 0,
            }
        )
        write_job_metadata(metadata)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Prioritization failed: {exc}",
        ) from exc

    metadata.update(
        {
            "status": "completed",
            "completed_at": utc_timestamp(),
            "row_count": len(rows),
        }
    )
    model_sources.update_run_manifest(
        job_id=job_id,
        output_file=metadata["output_file"],
        rows=rows,
    )
    write_job_metadata(metadata)
    return metadata


def get_result(job_id: str) -> dict[str, object]:
    """Return result metadata and rows for a completed job."""

    job = read_job_metadata(job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found.",
        )

    if job["status"] == "failed":
        return {**job, "results": []}

    output_path = PROJECT_ROOT / str(job["output_file"])
    if not output_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Result file not found.",
        )

    with output_path.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))

    return {
        **job,
        "row_count": len(rows),
        "results": rows,
    }


def get_latest_completed_job() -> dict[str, object]:
    """Return the latest completed prioritization job with result rows when available."""

    completed_jobs = [
        metadata
        for metadata in read_all_job_metadata()
        if metadata.get("status") == "completed" and metadata.get("completed_at")
    ]
    if not completed_jobs:
        return {"job": None}

    latest_job = max(completed_jobs, key=lambda metadata: str(metadata.get("completed_at", "")))
    return {"job": get_result(str(latest_job["job_id"]))}


def validate_molecule_csv(path: Path) -> int:
    """Validate required CSV columns and return the row count."""

    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        columns = set(reader.fieldnames or [])
        missing = sorted(REQUIRED_COLUMNS - columns)
        if missing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"CSV is missing required columns: {', '.join(missing)}.",
            )
        return sum(1 for _ in reader)


def write_job_metadata(metadata: dict[str, object]) -> None:
    JOB_METADATA_DIR.mkdir(parents=True, exist_ok=True)
    metadata_path = JOB_METADATA_DIR / f"{metadata['job_id']}.json"
    with metadata_path.open("w", encoding="utf-8") as handle:
        json.dump(metadata, handle, indent=2, sort_keys=True)
        handle.write("\n")


def read_job_metadata(job_id: str) -> dict[str, object] | None:
    metadata_path = JOB_METADATA_DIR / f"{job_id}.json"
    if not metadata_path.exists():
        return None
    try:
        with metadata_path.open("r", encoding="utf-8") as handle:
            metadata = json.load(handle)
    except json.JSONDecodeError:
        return None
    return metadata if isinstance(metadata, dict) else None


def read_all_job_metadata() -> list[dict[str, object]]:
    if not JOB_METADATA_DIR.exists():
        return []

    metadata_items: list[dict[str, object]] = []
    for metadata_path in sorted(JOB_METADATA_DIR.glob("*.json")):
        try:
            with metadata_path.open("r", encoding="utf-8") as handle:
                metadata = json.load(handle)
        except json.JSONDecodeError:
            continue
        if isinstance(metadata, dict):
            metadata_items.append(metadata)
    return metadata_items


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def find_upload_path(upload_id: str) -> Path:
    upload_dir = UPLOAD_DIR / upload_id
    if not upload_dir.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Upload not found.",
        )

    csv_files = sorted(upload_dir.glob("*.csv"))
    if not csv_files:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Uploaded CSV not found.",
        )
    return csv_files[0]


def relative_path(path: Path) -> str:
    try:
        return path.resolve().relative_to(PROJECT_ROOT.resolve()).as_posix()
    except ValueError:
        return path.name


def check_model_and_source_status() -> dict[str, object]:
    """Return current app-managed model and public source status."""

    return model_sources.current_status_payload()


def refresh_public_source_status() -> dict[str, object]:
    """Refresh planned public data source status without external lookups."""

    return model_sources.refresh_source_status_payload()
