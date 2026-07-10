"""Local-file services for uploads, jobs, and prioritization results."""

from __future__ import annotations

import csv
import io
import json
import shutil
from pathlib import Path
from uuid import uuid4
from datetime import datetime, timezone

from fastapi import HTTPException, UploadFile, status
from rdkit import Chem
from rdkit.Chem import rdDepictor
from rdkit.Chem.Draw import rdMolDraw2D

from molecular_prioritization import model_sources
from molecular_prioritization.pipeline import prioritize_csv


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = PROJECT_ROOT / "backend"
UPLOAD_DIR = BACKEND_DIR / "uploads"
JOB_OUTPUT_DIR = BACKEND_DIR / "job_outputs"
JOB_METADATA_DIR = BACKEND_DIR / "job_metadata"
JOB_ANNOTATION_DIR = BACKEND_DIR / "job_annotations"
REQUIRED_COLUMNS = {"molecule_id", "smiles"}
REVIEW_STATUSES = {"unreviewed", "selected", "watchlist", "deprioritized", "rejected"}
MAX_REVIEW_NOTE_LENGTH = 500
SDF_EXPORT_PROPERTIES = [
    "molecule_id",
    "priority_score",
    "valid_molecule",
    "bbb_prediction",
    "bbb_probability",
    "bbb_model_status",
    "mw",
    "tpsa",
    "hba",
    "hbd",
    "qed",
    "lipinski_pass",
    "synthetic_feasibility_category",
    "docking_score",
    "known_compound_match",
    "known_compound_name",
    "closest_known_compound_name",
    "closest_known_compound_similarity",
    "pubchem_cid",
    "pubchem_preferred_name",
    "chembl_molecule_id",
    "chembl_pref_name",
    "chembl_activity_count",
    "patent_public_evidence_match",
    "patent_record_count",
    "evidence_summary_category",
    "biopharma_context_level",
    "recommended_review_focus",
    "review_status",
    "review_note",
]


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


def render_molecule_structure_svg(smiles: str, width: int = 280, height: int = 220) -> str:
    """Render a SMILES string to a lightweight 2D SVG structure preview."""

    clean_smiles = (smiles or "").strip()
    if not clean_smiles:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="SMILES is required for structure rendering.",
        )

    molecule = Chem.MolFromSmiles(clean_smiles)
    if molecule is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Invalid or unavailable structure for the provided SMILES.",
        )

    rdDepictor.Compute2DCoords(molecule)
    drawer = rdMolDraw2D.MolDraw2DSVG(width, height)
    drawer.DrawMolecule(molecule)
    drawer.FinishDrawing()
    return drawer.GetDrawingText()


def export_candidates_sdf(candidates: list[dict[str, object]]) -> dict[str, object]:
    """Build an SDF string for candidate rows with usable SMILES."""

    if not candidates:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Candidate list is empty.",
        )

    output = io.StringIO()
    writer = Chem.SDWriter(output)
    exported = 0
    skipped = 0

    for row in candidates:
        smiles = str(row.get("canonical_smiles") or row.get("input_smiles") or "").strip()
        if not smiles:
            skipped += 1
            continue

        molecule = Chem.MolFromSmiles(smiles)
        if molecule is None:
            skipped += 1
            continue

        rdDepictor.Compute2DCoords(molecule)
        molecule.SetProp("_Name", str(row.get("molecule_id") or f"candidate_{exported + 1}"))
        molecule.SetProp("source_smiles", smiles)
        for property_name in SDF_EXPORT_PROPERTIES:
            value = row.get(property_name)
            if value is None or value == "":
                continue
            molecule.SetProp(property_name, str(value))
        writer.write(molecule)
        exported += 1

    writer.close()
    if exported == 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"No valid candidate structures were available for SDF export. Skipped {skipped} row(s).",
        )

    return {
        "sdf": output.getvalue(),
        "exported": exported,
        "skipped": skipped,
    }


def run_prioritization_job(
    upload_id: str,
    *,
    enable_public_lookup: bool = False,
    enable_pubchem_lookup: bool | None = None,
    enable_chembl_lookup: bool = False,
    enable_patent_lookup: bool = False,
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
        "public_lookup_requested": pubchem_lookup_requested or enable_chembl_lookup or enable_patent_lookup,
        "pubchem_lookup_requested": pubchem_lookup_requested,
        "chembl_lookup_requested": enable_chembl_lookup,
        "patent_lookup_requested": enable_patent_lookup,
    }
    write_job_metadata(metadata)

    try:
        rows = prioritize_csv(
            input_path,
            output_path,
            enable_public_lookup=enable_public_lookup,
            enable_pubchem_lookup=pubchem_lookup_requested,
            enable_chembl_lookup=enable_chembl_lookup,
            enable_patent_lookup=enable_patent_lookup,
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


def get_job_history(limit: int = 25) -> dict[str, object]:
    """Return recent completed prioritization job metadata without result rows."""

    completed_jobs = [
        metadata
        for metadata in read_all_job_metadata()
        if metadata.get("status") == "completed" and metadata.get("completed_at")
    ]
    sorted_jobs = sorted(
        completed_jobs,
        key=lambda metadata: str(metadata.get("completed_at", "")),
        reverse=True,
    )
    return {
        "jobs": [history_metadata(metadata) for metadata in sorted_jobs[:limit]],
    }


def get_job_annotations(job_id: str) -> dict[str, object]:
    """Return saved local review annotations for one job."""

    validate_existing_job_id(job_id)
    annotation_path = annotation_file_path(job_id)
    if not annotation_path.exists():
        return {"job_id": job_id, "annotations": {}, "updated_at": None}

    try:
        with annotation_path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except json.JSONDecodeError:
        return {"job_id": job_id, "annotations": {}, "updated_at": None}

    annotations = payload.get("annotations") if isinstance(payload, dict) else {}
    return {
        "job_id": job_id,
        "annotations": sanitize_annotations(annotations if isinstance(annotations, dict) else {}),
        "updated_at": payload.get("updated_at") if isinstance(payload, dict) else None,
    }


def save_job_annotations(
    job_id: str,
    annotations: dict[str, dict[str, str]],
) -> dict[str, object]:
    """Persist local review annotations for one job."""

    validate_existing_job_id(job_id)
    sanitized_annotations = sanitize_annotations(annotations)
    payload = {
        "job_id": job_id,
        "annotations": sanitized_annotations,
        "updated_at": utc_timestamp(),
    }
    JOB_ANNOTATION_DIR.mkdir(parents=True, exist_ok=True)
    with annotation_file_path(job_id).open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")
    return payload


def sanitize_annotations(annotations: dict[str, object]) -> dict[str, dict[str, str]]:
    """Normalize review annotations to known statuses and short notes."""

    sanitized: dict[str, dict[str, str]] = {}
    for raw_key, raw_value in annotations.items():
        key = str(raw_key).strip()
        if not key or not isinstance(raw_value, dict):
            continue
        status_value = str(raw_value.get("review_status") or "unreviewed").strip().lower()
        review_status = status_value if status_value in REVIEW_STATUSES else "unreviewed"
        review_note = str(raw_value.get("review_note") or "").strip()
        sanitized[key] = {
            "review_status": review_status,
            "review_note": review_note[:MAX_REVIEW_NOTE_LENGTH],
        }
    return sanitized


def validate_existing_job_id(job_id: str) -> None:
    """Ensure job IDs are local filenames and refer to known metadata."""

    if not job_id or Path(job_id).name != job_id or any(separator in job_id for separator in ("/", "\\")):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found.",
        )
    if read_job_metadata(job_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found.",
        )


def annotation_file_path(job_id: str) -> Path:
    return JOB_ANNOTATION_DIR / f"{job_id}.json"


def history_metadata(metadata: dict[str, object]) -> dict[str, object]:
    """Project job metadata fields used by the run history UI."""

    pubchem_requested = bool(metadata.get("pubchem_lookup_requested"))
    chembl_requested = bool(metadata.get("chembl_lookup_requested"))
    patent_requested = bool(metadata.get("patent_lookup_requested"))
    return {
        "job_id": metadata.get("job_id"),
        "created_at": metadata.get("created_at"),
        "completed_at": metadata.get("completed_at"),
        "row_count": metadata.get("row_count", 0),
        "status": metadata.get("status"),
        "input_file": metadata.get("input_file"),
        "output_file": metadata.get("output_file"),
        "public_lookup_requested": bool(
            metadata.get("public_lookup_requested")
            or pubchem_requested
            or chembl_requested
            or patent_requested
        ),
        "pubchem_lookup_requested": pubchem_requested,
        "chembl_lookup_requested": chembl_requested,
        "patent_lookup_requested": patent_requested,
    }


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
