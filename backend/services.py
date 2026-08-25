"""Local-file services for uploads, jobs, and prioritization results."""

from __future__ import annotations

import csv
import inspect
import io
import json
import os
import shutil
from threading import RLock
from pathlib import Path
from uuid import uuid4
from datetime import datetime, timezone

from fastapi import HTTPException, UploadFile, status
from rdkit import Chem
from rdkit.Chem import rdDepictor
from rdkit.Chem.Draw import rdMolDraw2D

from molecular_prioritization import model_sources
from molecular_prioritization.admet_multitask_predictor import (
    unavailable_admet_prediction,
)
from molecular_prioritization.admet_registry import CLASSIFICATION_ENDPOINTS
from molecular_prioritization.pipeline import prioritize_csv
from molecular_prioritization.receptor import (
    ReceptorValidationError,
    VinaBoxConfig,
    validate_prepared_receptor,
)
from backend import job_runner


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = PROJECT_ROOT / "backend"
UPLOAD_DIR = BACKEND_DIR / "uploads"
RECEPTOR_DIR = BACKEND_DIR / "receptors"
JOB_OUTPUT_DIR = BACKEND_DIR / "job_outputs"
JOB_METADATA_DIR = BACKEND_DIR / "job_metadata"
JOB_ANNOTATION_DIR = BACKEND_DIR / "job_annotations"
REQUIRED_COLUMNS = {"molecule_id", "smiles"}
MAX_BATCH_SIZE = 1000
TERMINAL_JOB_STATUSES = {
    "completed",
    "completed_with_warnings",
    "failed",
    "cancelled",
}
_metadata_lock = RLock()
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
    "docking_score_normalized",
    "docking_priority_signal",
    "docking_rank_within_run",
    "docking_percentile_within_run",
    "combined_candidate_score",
    "combined_score_explanation",
    "combined_score_status",
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
    "structural_alert_status",
    "structural_alert_count",
    "structural_alert_categories",
    "structural_alert_names",
    "pains_alert",
    "brenk_alert",
    "medchem_alert_summary",
    "diversity_cluster_id",
    "diversity_cluster_size",
    "diversity_representative",
    "nearest_neighbor_molecule_id",
    "nearest_neighbor_similarity",
    "diversity_status",
    "chemical_space_x",
    "chemical_space_y",
    "chemical_space_status",
    "chemical_space_method",
    "chemical_space_warning",
    "target_reference_status",
    "target_reference_source",
    "target_reference_count",
    "nearest_active_reference_id",
    "nearest_active_compound_name",
    "nearest_active_similarity",
    "nearest_active_activity_class",
    "nearest_active_mechanism_class",
    "nearest_active_activity_type",
    "nearest_active_activity_value",
    "nearest_active_activity_units",
    "active_neighborhood_signal",
    "active_neighborhood_summary",
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

    try:
        rows = validate_molecule_csv(upload_path)
    except Exception:
        shutil.rmtree(upload_dir, ignore_errors=True)
        raise

    return {
        "upload_id": upload_id,
        "status": "uploaded",
        "filename": filename,
        "rows": rows,
        "path": relative_path(upload_path),
    }


def save_receptor(file: UploadFile, *, receptor_id: str = "") -> dict[str, object]:
    """Store and validate an already prepared receptor PDBQT artifact."""

    filename = Path(file.filename or "").name
    if not filename.lower().endswith(".pdbqt"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Receptor must be a prepared .pdbqt file.")
    upload_id = uuid4().hex
    upload_dir = RECEPTOR_DIR / upload_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    upload_path = upload_dir / filename
    with upload_path.open("wb") as handle:
        shutil.copyfileobj(file.file, handle)
    try:
        artifact = validate_prepared_receptor(
            upload_path, receptor_id=receptor_id, source_filename=filename,
        )
    except ReceptorValidationError as exc:
        shutil.rmtree(upload_dir, ignore_errors=True)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return {
        "receptor_upload_id": upload_id, "status": "uploaded", "filename": filename,
        "receptor_id": artifact.receptor_id,
        "prepared_receptor_sha256": artifact.prepared_receptor_sha256,
        "size_bytes": artifact.size_bytes,
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
    enable_target_reference_discovery: bool = False,
    target_context: dict[str, object] | None = None,
    enable_docking: bool = True,
    receptor_upload_id: str = "",
    receptor_id: str = "",
    docking_configuration: dict[str, object] | None = None,
) -> dict[str, object]:
    """Create and enqueue one local molecular prioritization job."""

    pubchem_lookup_requested = enable_public_lookup if enable_pubchem_lookup is None else enable_pubchem_lookup
    input_path = find_upload_path(upload_id)
    submitted_count = validate_molecule_csv(input_path)
    job_id = uuid4().hex
    job_dir = JOB_OUTPUT_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    output_path = job_dir / "ranked_results.csv"
    target_reference_output_path = job_dir / "target_references.json"
    clean_target_context = sanitize_target_context(target_context)
    receptor = None
    docking_config = None
    docking_setup_error = ""
    if enable_docking:
        if not receptor_upload_id.strip():
            docking_setup_error = "Prepared receptor upload is required for docking."
        else:
            try:
                receptor = validate_prepared_receptor(
                    find_receptor_path(receptor_upload_id), receptor_id=receptor_id,
                )
            except (HTTPException, ReceptorValidationError) as exc:
                docking_setup_error = str(getattr(exc, "detail", exc))
        try:
            docking_config = VinaBoxConfig.from_mapping(docking_configuration or {})
        except ReceptorValidationError as exc:
            docking_setup_error = " | ".join(filter(None, (docking_setup_error, str(exc))))
    metadata = {
        "job_id": job_id,
        "upload_id": upload_id,
        "status": "queued",
        "stage": "queued",
        "input_file": relative_path(input_path),
        "output_file": relative_path(output_path),
        "created_at": utc_timestamp(),
        "started_at": None,
        "completed_at": None,
        "error_message": "",
        "row_count": 0,
        "submitted_count": submitted_count,
        "valid_count": None,
        "invalid_count": None,
        "duplicate_count": None,
        "processed_count": 0,
        "total_count": submitted_count,
        "admet_success_count": 0,
        "admet_failure_count": 0,
        "docking_success_count": 0,
        "docking_failure_count": 0,
        "eligible_count": 0,
        "fully_scored_count": 0,
        "partially_scored_count": 0,
        "unscorable_count": 0,
        "ranked_count": 0,
        "eligible_for_ranking_count": 0,
        "awaiting_or_missing_docking_count": 0,
        "docking_failed_or_unavailable_count": 0,
        "warning_count": 0,
        "cancellation_requested": False,
        "public_lookup_requested": pubchem_lookup_requested or enable_chembl_lookup or enable_patent_lookup,
        "pubchem_lookup_requested": pubchem_lookup_requested,
        "chembl_lookup_requested": enable_chembl_lookup,
        "patent_lookup_requested": enable_patent_lookup,
        "target_reference_discovery_requested": enable_target_reference_discovery,
        "target_context": clean_target_context,
        "target_reference_file": relative_path(target_reference_output_path),
        "docking_requested": enable_docking,
        "receptor_upload_id": receptor_upload_id,
        "receptor_id": receptor.receptor_id if receptor else receptor_id,
        "prepared_receptor_sha256": receptor.prepared_receptor_sha256 if receptor else None,
        "docking_configuration": docking_config.as_dict() if docking_config else {},
        "docking_setup_error": docking_setup_error,
    }
    write_job_metadata(metadata)
    job_runner.submit(
        job_id,
        _execute_prioritization_job,
        job_id,
        input_path,
        output_path,
        enable_public_lookup=enable_public_lookup,
        enable_pubchem_lookup=pubchem_lookup_requested,
        enable_chembl_lookup=enable_chembl_lookup,
        enable_patent_lookup=enable_patent_lookup,
        enable_target_reference_discovery=enable_target_reference_discovery,
        target_context=clean_target_context,
        target_reference_output_path=target_reference_output_path,
        enable_docking=enable_docking,
        receptor=receptor,
        docking_config=docking_config,
        docking_output_root=job_dir,
        docking_setup_error=docking_setup_error,
    )
    return metadata


def _execute_prioritization_job(
    job_id: str,
    input_path: Path,
    output_path: Path,
    **options: object,
) -> None:
    """Run the unchanged scientific pipeline and persist terminal metadata."""

    current = read_job_metadata(job_id)
    if current is None or current.get("status") == "cancelled":
        return
    update_job_metadata(
        job_id,
        status="running",
        stage="prioritization",
        started_at=utc_timestamp(),
    )
    try:
        def progress_callback(**values: object) -> None:
            update_job_metadata(job_id, **values)

        rows = call_prioritize_csv(
            input_path, output_path, progress_callback=progress_callback, **options
        )
        update_job_metadata(job_id, stage="prioritization")
        valid_count = sum(row.get("valid_molecule") is True for row in rows)
        invalid_count = len(rows) - valid_count
        admet_success_count = sum(
            row.get("admet_model_status") == "model_available" for row in rows
        )
        admet_failure_count = sum(
            row.get("valid_molecule") is True
            and row.get("admet_model_status") != "model_available"
            for row in rows
        )
        warning_count = _pipeline_warning_count(rows)
        docking_success_count = sum(
            row.get("docking_result", {}).get("status") == "success"
            for row in rows if isinstance(row.get("docking_result"), dict)
        )
        docking_failure_count = sum(
            row.get("valid_molecule") is True
            and isinstance(row.get("docking_result"), dict)
            and row.get("docking_result", {}).get("status") not in {"success", "precomputed", "not_requested"}
            for row in rows
        )
        eligible_count = sum(row.get("valid_molecule") is True for row in rows)
        fully_scored_count = sum(row.get("prioritization_status") == "fully_scored" for row in rows)
        partially_scored_count = sum(row.get("prioritization_status") == "partially_scored" for row in rows)
        unscorable_count = sum(
            row.get("prioritization_status") == "unscorable" for row in rows
        )
        ranked_count = sum(row.get("scientific_rank") is not None for row in rows)
        eligible_for_ranking_count = sum(row.get("rank_eligible") is True for row in rows)
        awaiting_or_missing_docking_count = sum(
            row.get("prioritization_status") == "awaiting_docking" for row in rows
        )
        docking_failed_or_unavailable_count = sum(
            row.get("prioritization_status") in {"docking_failed", "docking_unavailable"}
            for row in rows
        )
        metadata = read_job_metadata(job_id)
        if metadata is None:  # pragma: no cover - job metadata is created before submission
            raise RuntimeError(f"Job metadata disappeared during execution: {job_id}")
        model_sources.update_run_manifest(
            job_id=job_id,
            output_file=str(metadata["output_file"]),
            rows=rows,
        )
        update_job_metadata(
            job_id,
            status="completed_with_warnings" if warning_count else "completed",
            stage="completed",
            completed_at=utc_timestamp(),
            row_count=len(rows),
            valid_count=valid_count,
            invalid_count=invalid_count,
            processed_count=len(rows),
            admet_success_count=admet_success_count,
            admet_failure_count=admet_failure_count,
            docking_success_count=docking_success_count,
            docking_failure_count=docking_failure_count,
            eligible_count=eligible_count,
            fully_scored_count=fully_scored_count,
            partially_scored_count=partially_scored_count,
            unscorable_count=unscorable_count,
            ranked_count=ranked_count,
            eligible_for_ranking_count=eligible_for_ranking_count,
            awaiting_or_missing_docking_count=awaiting_or_missing_docking_count,
            docking_failed_or_unavailable_count=docking_failed_or_unavailable_count,
            warning_count=warning_count,
        )
    except Exception as exc:
        update_job_metadata(
            job_id,
            status="failed",
            stage="completed",
            completed_at=utc_timestamp(),
            error_message=str(exc),
        )


def _pipeline_warning_count(rows: list[dict[str, object]]) -> int:
    """Count explicit current-pipeline failure/unavailable warning states."""

    count = 0
    for row in rows:
        count += row.get("bbb_model_status") == "model_unavailable"
        count += row.get("admet_model_status") == "model_unavailable"
        docking_result = row.get("docking_result")
        count += (
            isinstance(docking_result, dict)
            and docking_result.get("status")
            not in {"success", "precomputed", "not_requested", "not_run_invalid_molecule"}
        )
        count += row.get("pubchem_lookup_status") == "lookup_failed"
        count += row.get("chembl_lookup_status") == "lookup_failed"
        count += row.get("patent_lookup_status") == "lookup_failed"
        count += row.get("structural_alert_status") == "alert_catalog_unavailable"
    return int(count)


def call_prioritize_csv(input_path: Path, output_path: Path, **options: object) -> list[dict[str, object]]:
    """Call the pipeline while keeping older test doubles compatible."""

    signature = inspect.signature(prioritize_csv)
    accepted_options = {
        key: value
        for key, value in options.items()
        if key in signature.parameters
    }
    return prioritize_csv(input_path, output_path, **accepted_options)


def get_result(job_id: str) -> dict[str, object]:
    """Return result metadata and rows for a completed job."""

    job = read_job_metadata(job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found.",
        )

    if job["status"] in {"failed", "cancelled"}:
        return {**job, "results": []}

    if job["status"] not in {"completed", "completed_with_warnings"}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Results are not ready; job status is {job['status']}.",
        )

    output_path = PROJECT_ROOT / str(job["output_file"])
    if not output_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Result file not found.",
        )

    with output_path.open(newline="", encoding="utf-8") as handle:
        rows = [_deserialize_result_row(row) for row in csv.DictReader(handle)]

    return {
        **job,
        "row_count": len(rows),
        "results": rows,
        "target_references": read_target_reference_metadata(job),
    }


def _deserialize_result_row(row: dict[str, str]) -> dict[str, object]:
    """Restore nested ADMET output stored in the pipeline result CSV."""

    restored: dict[str, object] = dict(row)
    status_value = str(row.get("admet_model_status") or "model_unavailable")
    warning_value = str(
        row.get("admet_warning")
        or "Frozen ADMET result was unavailable in the stored pipeline output."
    )
    fallback = unavailable_admet_prediction(
        row.get("canonical_smiles"),
        prediction_status=status_value,
        warning=warning_value,
    )["endpoints"]
    fallback = {name: fallback[name] for name in CLASSIFICATION_ENDPOINTS}
    serialized = row.get("admet_predictions", "")
    if serialized:
        try:
            decoded = json.loads(serialized)
        except (TypeError, json.JSONDecodeError):
            decoded = None
        if isinstance(decoded, dict):
            for endpoint_name, endpoint_value in decoded.items():
                if endpoint_name in fallback and isinstance(endpoint_value, dict):
                    fallback[endpoint_name].update(endpoint_value)
    restored["admet_model_status"] = status_value
    restored["admet_warning"] = warning_value if status_value != "model_available" else str(
        row.get("admet_warning") or ""
    )
    restored["admet_predictions"] = fallback
    for field in ("bbb_result", "admet_regression", "admet_family_status", "docking_result", "prioritization"):
        serialized_nested = row.get(field, "")
        if serialized_nested:
            try:
                decoded_nested = json.loads(serialized_nested)
            except (TypeError, json.JSONDecodeError):
                decoded_nested = {}
            restored[field] = decoded_nested if isinstance(decoded_nested, dict) else {}
        else:
            restored[field] = {}
    return restored


def get_latest_completed_job() -> dict[str, object]:
    """Return the latest completed prioritization job with result rows when available."""

    completed_jobs = [
        metadata
        for metadata in read_all_job_metadata()
        if metadata.get("status") in {"completed", "completed_with_warnings"}
        and metadata.get("completed_at")
    ]
    if not completed_jobs:
        return {"job": None}

    latest_job = max(completed_jobs, key=lambda metadata: str(metadata.get("completed_at", "")))
    return {"job": get_result(str(latest_job["job_id"]))}


def get_job_history(limit: int = 25) -> dict[str, object]:
    """Return recent prioritization job metadata for every supported status."""

    jobs = read_all_job_metadata()
    sorted_jobs = sorted(
        jobs,
        key=lambda metadata: str(metadata.get("created_at", "")),
        reverse=True,
    )
    return {
        "jobs": [history_metadata(metadata) for metadata in sorted_jobs[:limit]],
    }


def get_job_status(job_id: str) -> dict[str, object]:
    """Return the persisted current state for one job."""

    validate_existing_job_id(job_id)
    metadata = read_job_metadata(job_id)
    if metadata is None:  # pragma: no cover - guarded by validation
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")
    return metadata


def request_job_cancellation(job_id: str) -> dict[str, object]:
    """Persist a cancellation request and cancel only work that has not started."""

    metadata = get_job_status(job_id)
    if metadata.get("status") in TERMINAL_JOB_STATUSES:
        return metadata

    cancelled_before_start = job_runner.request_cancel(job_id)
    updates: dict[str, object] = {"cancellation_requested": True}
    if cancelled_before_start:
        updates.update(
            {
                "status": "cancelled",
                "stage": "completed",
                "completed_at": utc_timestamp(),
            }
        )
    return update_job_metadata(job_id, **updates)


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
    target_reference_requested = bool(metadata.get("target_reference_discovery_requested"))
    return {
        "job_id": metadata.get("job_id"),
        "created_at": metadata.get("created_at"),
        "completed_at": metadata.get("completed_at"),
        "row_count": metadata.get("row_count", 0),
        "status": metadata.get("status"),
        "stage": metadata.get("stage", "completed"),
        "started_at": metadata.get("started_at"),
        "submitted_count": metadata.get("submitted_count", metadata.get("row_count", 0)),
        "valid_count": metadata.get("valid_count"),
        "invalid_count": metadata.get("invalid_count"),
        "duplicate_count": metadata.get("duplicate_count"),
        "processed_count": metadata.get("processed_count", metadata.get("row_count", 0)),
        "total_count": metadata.get("total_count", metadata.get("row_count", 0)),
        "admet_success_count": metadata.get("admet_success_count", 0),
        "admet_failure_count": metadata.get("admet_failure_count", 0),
        "docking_success_count": metadata.get("docking_success_count", 0),
        "docking_failure_count": metadata.get("docking_failure_count", 0),
        "eligible_count": metadata.get("eligible_count", 0),
        "fully_scored_count": metadata.get("fully_scored_count", 0),
        "partially_scored_count": metadata.get("partially_scored_count", 0),
        "unscorable_count": metadata.get("unscorable_count", 0),
        "ranked_count": metadata.get("ranked_count", 0),
        "eligible_for_ranking_count": metadata.get("eligible_for_ranking_count", 0),
        "awaiting_or_missing_docking_count": metadata.get("awaiting_or_missing_docking_count", 0),
        "docking_failed_or_unavailable_count": metadata.get("docking_failed_or_unavailable_count", 0),
        "warning_count": metadata.get("warning_count", 0),
        "cancellation_requested": bool(metadata.get("cancellation_requested")),
        "error_message": metadata.get("error_message", ""),
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
        "target_reference_discovery_requested": target_reference_requested,
        "target_context": metadata.get("target_context") if isinstance(metadata.get("target_context"), dict) else {},
    }


def sanitize_target_context(target_context: dict[str, object] | None) -> dict[str, str]:
    """Normalize optional target-context fields stored in job metadata."""

    allowed_fields = [
        "target_name",
        "target_gene_symbol",
        "target_uniprot_id",
        "target_chembl_id",
        "pdb_id",
        "organism",
        "disease_context",
        "mechanism_context",
        "docking_protocol_notes",
        "binding_site_notes",
    ]
    values = target_context or {}
    return {field: str(values.get(field) or "").strip() for field in allowed_fields}


def read_target_reference_metadata(job: dict[str, object]) -> dict[str, object]:
    """Return target-reference sidecar metadata for a completed job."""

    reference_file = str(job.get("target_reference_file") or "").strip()
    if not reference_file:
        return {
            "enabled": False,
            "lookup_status": "not_requested",
            "cache_status": "not_used",
            "source": "not_used",
            "reference_count": 0,
            "references": [],
        }
    path = PROJECT_ROOT / reference_file
    if not path.exists():
        return {
            "enabled": bool(job.get("target_reference_discovery_requested")),
            "lookup_status": "not_available",
            "cache_status": "not_used",
            "source": "not_used",
            "reference_count": 0,
            "references": [],
        }
    try:
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except json.JSONDecodeError:
        return {
            "enabled": bool(job.get("target_reference_discovery_requested")),
            "lookup_status": "malformed_reference_metadata",
            "cache_status": "not_used",
            "source": "not_used",
            "reference_count": 0,
            "references": [],
        }
    return payload if isinstance(payload, dict) else {}


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
        row_count = sum(1 for _ in reader)
        if row_count > MAX_BATCH_SIZE:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Maximum batch size is {MAX_BATCH_SIZE:,} molecules per analysis; "
                    f"the submitted CSV contains {row_count:,} molecule records."
                ),
            )
        return row_count


def write_job_metadata(metadata: dict[str, object]) -> None:
    """Atomically persist one job metadata document."""

    with _metadata_lock:
        JOB_METADATA_DIR.mkdir(parents=True, exist_ok=True)
        metadata_path = JOB_METADATA_DIR / f"{metadata['job_id']}.json"
        temporary_path = JOB_METADATA_DIR / f".{metadata['job_id']}.{uuid4().hex}.tmp"
        try:
            with temporary_path.open("w", encoding="utf-8") as handle:
                json.dump(metadata, handle, indent=2, sort_keys=True)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_path, metadata_path)
        finally:
            temporary_path.unlink(missing_ok=True)


def update_job_metadata(job_id: str, **updates: object) -> dict[str, object]:
    """Read, update, and atomically rewrite one job metadata document."""

    with _metadata_lock:
        metadata = read_job_metadata(job_id)
        if metadata is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")
        metadata.update(updates)
        write_job_metadata(metadata)
        return metadata


def read_job_metadata(job_id: str) -> dict[str, object] | None:
    with _metadata_lock:
        metadata_path = JOB_METADATA_DIR / f"{job_id}.json"
        if not metadata_path.exists():
            return None
        try:
            with metadata_path.open("r", encoding="utf-8") as handle:
                metadata = json.load(handle)
        except json.JSONDecodeError:
            return None
        return normalize_job_metadata(metadata) if isinstance(metadata, dict) else None


def read_all_job_metadata() -> list[dict[str, object]]:
    with _metadata_lock:
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
                metadata_items.append(normalize_job_metadata(metadata))
        return metadata_items


def normalize_job_metadata(metadata: dict[str, object]) -> dict[str, object]:
    """Supply progress defaults when reading metadata from older MolOptima runs."""

    normalized = dict(metadata)
    row_count = int(normalized.get("row_count") or 0)
    status_value = str(normalized.get("status") or "failed")
    normalized.setdefault("stage", "completed" if status_value in TERMINAL_JOB_STATUSES else "queued")
    normalized.setdefault("started_at", normalized.get("created_at") if status_value != "queued" else None)
    normalized.setdefault("submitted_count", row_count)
    normalized.setdefault("valid_count", None)
    normalized.setdefault("invalid_count", None)
    normalized.setdefault("duplicate_count", None)
    normalized.setdefault("processed_count", row_count if status_value in TERMINAL_JOB_STATUSES else 0)
    normalized.setdefault("total_count", row_count)
    normalized.setdefault("admet_success_count", 0)
    normalized.setdefault("admet_failure_count", 0)
    normalized.setdefault("docking_success_count", 0)
    normalized.setdefault("docking_failure_count", 0)
    normalized.setdefault("eligible_count", 0)
    normalized.setdefault("fully_scored_count", 0)
    normalized.setdefault("partially_scored_count", 0)
    normalized.setdefault("unscorable_count", 0)
    normalized.setdefault("ranked_count", 0)
    normalized.setdefault("eligible_for_ranking_count", 0)
    normalized.setdefault("awaiting_or_missing_docking_count", 0)
    normalized.setdefault("docking_failed_or_unavailable_count", 0)
    normalized.setdefault("warning_count", 0)
    normalized.setdefault("cancellation_requested", False)
    return normalized


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


def find_receptor_path(receptor_upload_id: str) -> Path:
    if len(receptor_upload_id) != 32 or any(
        character not in "0123456789abcdef" for character in receptor_upload_id.lower()
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Receptor upload not found.")
    receptor_dir = RECEPTOR_DIR / receptor_upload_id
    if not receptor_dir.is_dir():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Receptor upload not found.")
    receptor_files = sorted(receptor_dir.glob("*.pdbqt"))
    if len(receptor_files) != 1:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Prepared receptor PDBQT not found.")
    return receptor_files[0]


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
