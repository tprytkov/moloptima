"""Local-file services for uploads, jobs, and prioritization results."""

from __future__ import annotations

import csv
import hashlib
import inspect
import io
import json
import math
import os
import shutil
from functools import lru_cache
from threading import RLock
from pathlib import Path
from uuid import uuid4
from datetime import datetime, timezone

from fastapi import HTTPException, UploadFile, status
from rdkit import Chem
from rdkit.Chem import rdDepictor
from rdkit.Chem.Draw import rdMolDraw2D

from molecular_prioritization import model_sources, runtime_qualification
from molecular_prioritization.admet_multitask_predictor import (
    unavailable_admet_prediction,
)
from molecular_prioritization.admet_registry import CLASSIFICATION_ENDPOINTS
from molecular_prioritization.admet_runtime import portable_runtime_identities
from molecular_prioritization.builtin_profiles import builtin_profile_catalog
from molecular_prioritization.desirability import (
    TRANSFORM_PARAMETER_SCHEMAS,
    TRANSFORM_TYPES,
)
from molecular_prioritization.pipeline import prioritize_csv
from molecular_prioritization.chemical_space import nearest_neighbors, project_records
from molecular_prioritization.scaffolds import SCAFFOLD_ALGORITHM_VERSION, organize_scaffolds
from molecular_prioritization.matched_pairs import analyze_matched_pair_batch
from molecular_prioritization.molecule_inputs import (
    SourceInput,
    import_molecule_collection,
    write_canonical_collection,
)
from molecular_prioritization.prioritization_analysis import (
    analyze_pareto_fronts,
    analyze_weight_sensitivity,
)
from molecular_prioritization.prioritization_profiles import (
    ADMET_SCORING_DOMAINS,
    ENDPOINT_ROLES,
    MISSING_POLICIES,
    SCIENTIFIC_DOMAINS,
    SCORING_COMPONENTS,
    TARGET_MODES,
    UNCERTAINTY_POLICIES,
    PrioritizationProfile,
    profile_sha256,
)
from molecular_prioritization.receptor import (
    ReceptorValidationError,
    VinaBoxConfig,
    validate_prepared_receptor,
)
from molecular_prioritization.vina_docking import DockingCancelled
from molecular_prioritization.scientific_endpoints import SCIENTIFIC_ENDPOINTS
from molecular_prioritization.experimental_measurements import (
    SCHEMA_VERSION as EXPERIMENTAL_SCHEMA_VERSION,
    deterministic_identifier,
    parse_experimental_delimited,
)
from biopharma_intelligence.known_analogs import (
    KnownSourceError,
    retrieve_experimental_records,
    search_known_analogs,
)
from backend import job_runner, receptor_store, results_package


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = PROJECT_ROOT / "backend"
UPLOAD_DIR = BACKEND_DIR / "uploads"
RECEPTOR_DIR = BACKEND_DIR / "receptors"
JOB_OUTPUT_DIR = BACKEND_DIR / "job_outputs"
JOB_METADATA_DIR = BACKEND_DIR / "job_metadata"
JOB_ANNOTATION_DIR = BACKEND_DIR / "job_annotations"
IMPORT_JOB_DIR = BACKEND_DIR / "import_jobs"
EXPERIMENTAL_PREVIEW_DIR = BACKEND_DIR / "experimental_previews"
EXPERIMENTAL_DATASET_DIR = BACKEND_DIR / "experimental_datasets"
REQUIRED_COLUMNS = {"molecule_id", "smiles"}
MAX_BATCH_SIZE = 1000
MAX_IMPORT_BATCH_FILES = 250
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


def prioritization_metadata() -> dict[str, object]:
    """Return public, read-only profile-editor metadata from scientific registries."""

    endpoints = []
    for definition in SCIENTIFIC_ENDPOINTS.definitions(public_only=True):
        endpoints.append({
            "endpoint_id": definition.endpoint_id,
            "model_family": definition.model_family,
            "value_type": definition.value_type,
            "units": definition.units,
            "semantic_direction": definition.semantic_direction,
            "description": definition.description,
            "uncertainty_available": definition.uncertainty_field is not None,
        })
    return {
        "endpoints": endpoints,
        "builtin_profiles": builtin_profile_catalog(),
        "profile_options": {
            "prioritization_methods": ["legacy_v1", "v2"],
            "target_modes": sorted(TARGET_MODES),
            "component_ids": sorted(SCORING_COMPONENTS),
            "domains": sorted(SCIENTIFIC_DOMAINS),
            "admet_domains": sorted(ADMET_SCORING_DOMAINS),
            "endpoint_roles": sorted(ENDPOINT_ROLES),
            "missing_policies": sorted(MISSING_POLICIES),
            "uncertainty_policies": sorted(UNCERTAINTY_POLICIES),
            "transform_types": sorted(TRANSFORM_TYPES),
            "transform_schemas": {
                name: [dict(parameter) for parameter in TRANSFORM_PARAMETER_SCHEMAS[name]]
                for name in sorted(TRANSFORM_PARAMETER_SCHEMAS)
            },
            "docking_normalizations": ["within_library"],
        },
    }


def validate_prioritization_profile(payload: dict[str, object]) -> dict[str, object]:
    """Deserialize and validate through the sole PrioritizationProfile authority."""

    try:
        profile = PrioritizationProfile.from_dict(payload)
        digest = profile_sha256(profile)
    except (TypeError, ValueError) as exc:
        return {
            "structurally_valid": False,
            "scoreable": False,
            "profile_sha256": None,
            "warnings": [],
            "errors": [str(exc)],
            "profile": None,
        }
    try:
        warnings = list(profile.validate_for_scoring())
    except ValueError as exc:
        return {
            "structurally_valid": True,
            "scoreable": False,
            "profile_sha256": digest,
            "warnings": list(profile.validation_warnings()),
            "errors": [str(exc)],
            "profile": profile.to_dict(),
        }
    return {
        "structurally_valid": True,
        "scoreable": True,
        "profile_sha256": digest,
        "warnings": warnings,
        "errors": [],
        "profile": profile.to_dict(),
    }


def run_pareto_analysis(
    results: list[dict[str, object]], dimensions: list[str],
    *, job_id: str = "",
) -> dict[str, object]:
    """Run opt-in explanatory Pareto analysis without modifying stored results."""

    if any(row.get("analysis_mode") == "single_compound" for row in results):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Pareto analysis is not applicable to Single Compound Analysis.",
        )
    try:
        source_results = get_result(job_id)["results"] if job_id else results
        analysis = analyze_pareto_fronts(source_results, dimensions)
        if job_id:
            _persist_job_analysis(job_id, "pareto", analysis)
        return analysis
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Pareto analysis is invalid: {exc}",
        ) from exc


def run_weight_sensitivity_analysis(
    candidates: list[dict[str, object]],
    profile_payload: dict[str, object],
    *,
    perturbation_magnitude: float,
    number_of_samples: int,
    analysis_seed: int,
    job_id: str = "",
) -> dict[str, object]:
    """Run opt-in v2 sensitivity through the existing production scoring engine."""

    if any(row.get("analysis_mode") == "single_compound" for row in candidates):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Rank sensitivity is not applicable to Single Compound Analysis.",
        )
    try:
        source_candidates = candidates
        source_profile_payload = profile_payload
        if job_id:
            stored = get_result(job_id)
            source_candidates = list(stored["results"])
            persisted_profile = stored.get("prioritization_profile")
            if not isinstance(persisted_profile, dict):
                raise ValueError("The completed job does not contain an exact persisted v2 profile.")
            requested_sha = profile_sha256(PrioritizationProfile.from_dict(profile_payload))
            stored_sha = str(stored.get("prioritization_profile_sha256") or "")
            if requested_sha != stored_sha:
                raise ValueError("Sensitivity profile/result SHA mismatch.")
            source_profile_payload = persisted_profile
        profile = PrioritizationProfile.from_dict(source_profile_payload)
        profile.validate_for_scoring()
        analysis = analyze_weight_sensitivity(
            source_candidates,
            profile,
            perturbation_magnitude=perturbation_magnitude,
            number_of_samples=number_of_samples,
            analysis_seed=analysis_seed,
        )
        if job_id:
            _persist_job_analysis(job_id, "sensitivity", analysis)
        return analysis
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Sensitivity analysis requires a valid scoreable v2 profile: {exc}",
        ) from exc


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


def save_molecule_import(
    *,
    files: list[UploadFile],
    smiles_text: str = "",
    selected_structure_column: str = "",
) -> dict[str, object]:
    """Normalize all supported molecule inputs into one canonical collection."""

    source_inputs = _source_inputs_from_uploads(files)
    collection = import_molecule_collection(
        smiles_text=smiles_text,
        files=source_inputs,
        selected_structure_column=selected_structure_column,
    )
    summary = dict(collection["summary"])
    submitted_count = int(summary["submitted_count"])
    if submitted_count > MAX_BATCH_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Maximum batch size is {MAX_BATCH_SIZE:,} submitted molecule records.",
        )
    if submitted_count == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No supported molecule records were submitted.",
        )

    upload_id = uuid4().hex
    upload_dir = UPLOAD_DIR / upload_id
    try:
        return _persist_molecule_collection(
            collection=collection,
            source_inputs=source_inputs,
            smiles_text=smiles_text,
            upload_id=upload_id,
            upload_dir=upload_dir,
        )
    except Exception:
        shutil.rmtree(upload_dir, ignore_errors=True)
        raise


def create_molecule_import_job(
    *, expected_file_count: int, smiles_text: str = "", selected_structure_column: str = "",
) -> dict[str, object]:
    """Create temporary state for one logical, sequential multi-request import."""

    smiles_collection = import_molecule_collection(smiles_text=smiles_text)
    smiles_record_count = int(dict(smiles_collection["summary"])["submitted_count"])
    if smiles_record_count > MAX_BATCH_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Maximum batch size is {MAX_BATCH_SIZE:,} submitted molecule records.",
        )
    import_job_id = uuid4().hex
    job_dir = IMPORT_JOB_DIR / import_job_id
    job_dir.mkdir(parents=True, exist_ok=False)
    metadata = {
        "import_job_id": import_job_id,
        "status": "pending",
        "expected_file_count": expected_file_count,
        "processed_file_count": 0,
        "parsed_record_count": 0,
        "pasted_smiles_record_count": smiles_record_count,
        "batch_count": 0,
        "smiles_text": smiles_text,
        "selected_structure_column": selected_structure_column,
        "sources": [],
        "created_at": utc_timestamp(),
    }
    _write_import_job_metadata(job_dir, metadata)
    return _public_import_job(metadata)


def append_molecule_import_batch(
    import_job_id: str, *, batch_index: int, files: list[UploadFile],
) -> dict[str, object]:
    """Validate and durably stage one ordered transport batch."""

    if not files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Import batches must contain files.")
    if len(files) > MAX_IMPORT_BATCH_FILES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Maximum import batch size is {MAX_IMPORT_BATCH_FILES:,} files.",
        )

    with _metadata_lock:
        job_dir, metadata = _load_import_job(import_job_id)
        expected_batch = int(metadata["batch_count"]) + 1
        if batch_index != expected_batch:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Expected import batch {expected_batch}, received {batch_index}.",
            )
        source_inputs = _source_inputs_from_uploads(files)
        collection = import_molecule_collection(
            files=source_inputs,
            selected_structure_column=str(metadata.get("selected_structure_column") or ""),
        )
        batch_summary = dict(collection["summary"])
        batch_records = int(batch_summary["submitted_count"])
        if batch_records > MAX_BATCH_SIZE:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Maximum batch size is {MAX_BATCH_SIZE:,} submitted molecule records.",
            )

        current_count = int(metadata["processed_file_count"])
        expected_count = int(metadata["expected_file_count"])
        if current_count + len(source_inputs) > expected_count:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Import batch exceeds the job's expected file count.",
            )

        batches_dir = job_dir / "batches"
        batches_dir.mkdir(exist_ok=True)
        incoming_dir = batches_dir / f".incoming-{uuid4().hex}"
        batch_dir = batches_dir / f"{batch_index:06d}"
        incoming_dir.mkdir()
        staged_sources: list[dict[str, object]] = []
        try:
            for offset, source in enumerate(source_inputs, start=1):
                global_index = current_count + offset
                stored_name = f"{global_index:08d}_{Path(source.filename).name}"
                (incoming_dir / stored_name).write_bytes(source.content)
                staged_sources.append({
                    "index": global_index,
                    "filename": Path(source.filename).name,
                    "relative_path": f"batches/{batch_index:06d}/{stored_name}",
                })
            with (incoming_dir / "batch_collection.json").open("w", encoding="utf-8") as handle:
                json.dump(collection, handle, indent=2, sort_keys=True)
                handle.write("\n")
            incoming_dir.replace(batch_dir)
            metadata["sources"] = [*list(metadata.get("sources") or []), *staged_sources]
            metadata["processed_file_count"] = current_count + len(source_inputs)
            metadata["parsed_record_count"] = int(metadata["parsed_record_count"]) + batch_records
            metadata["batch_count"] = batch_index
            _write_import_job_metadata(job_dir, metadata)
        except Exception:
            shutil.rmtree(incoming_dir, ignore_errors=True)
            shutil.rmtree(batch_dir, ignore_errors=True)
            raise

    return {
        **_public_import_job(metadata),
        "batch_index": batch_index,
        "batch_file_count": len(source_inputs),
        "batch_submitted_count": batch_records,
        "batch_valid_count": int(batch_summary["valid_count"]),
        "batch_invalid_count": int(batch_summary["invalid_count"]),
    }


def finalize_molecule_import_job(import_job_id: str) -> dict[str, object]:
    """Atomically publish one canonical upload assembled from all staged batches."""

    with _metadata_lock:
        job_dir, metadata = _load_import_job(import_job_id)
        processed = int(metadata["processed_file_count"])
        expected = int(metadata["expected_file_count"])
        if processed != expected:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Import job has received {processed:,} of {expected:,} expected files.",
            )
        source_inputs = [
            SourceInput(
                filename=str(source["filename"]),
                content=(job_dir / str(source["relative_path"])).read_bytes(),
            )
            for source in sorted(list(metadata.get("sources") or []), key=lambda item: int(item["index"]))
        ]
        smiles_text = str(metadata.get("smiles_text") or "")
        collection = import_molecule_collection(
            smiles_text=smiles_text,
            files=source_inputs,
            selected_structure_column=str(metadata.get("selected_structure_column") or ""),
        )
        if int(dict(collection["summary"])["submitted_count"]) == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No supported molecule records were submitted.",
            )

        upload_id = uuid4().hex
        staged_upload_dir = job_dir / f"finalized-{upload_id}"
        final_upload_dir = UPLOAD_DIR / upload_id
        try:
            response = _persist_molecule_collection(
                collection=collection,
                source_inputs=source_inputs,
                smiles_text=smiles_text,
                upload_id=upload_id,
                upload_dir=staged_upload_dir,
                source_index_width=8,
            )
            UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
            staged_upload_dir.replace(final_upload_dir)
            response["path"] = relative_path(final_upload_dir / "canonical_molecules.csv")
        except Exception:
            shutil.rmtree(staged_upload_dir, ignore_errors=True)
            raise
        shutil.rmtree(job_dir, ignore_errors=True)
        return response


def cancel_molecule_import_job(import_job_id: str) -> None:
    """Remove an unfinished import job without touching finalized uploads."""

    with _metadata_lock:
        job_dir, _ = _load_import_job(import_job_id)
        shutil.rmtree(job_dir, ignore_errors=True)


def _source_inputs_from_uploads(files: list[UploadFile]) -> list[SourceInput]:
    return [
        SourceInput(filename=Path(file.filename or "unnamed").name, content=file.file.read())
        for file in files
    ]


def _persist_molecule_collection(
    *, collection: dict[str, object], source_inputs: list[SourceInput], smiles_text: str,
    upload_id: str, upload_dir: Path, source_index_width: int = 4,
) -> dict[str, object]:
    summary = dict(collection["summary"])
    sources_dir = upload_dir / "source_structures"
    upload_dir.mkdir(parents=True, exist_ok=False)
    sources_dir.mkdir()
    for index, source in enumerate(source_inputs, start=1):
        safe_name = Path(source.filename).name
        (sources_dir / f"{index:0{source_index_width}d}_{safe_name}").write_bytes(source.content)
    canonical_path = upload_dir / "canonical_molecules.csv"
    write_canonical_collection(collection, canonical_path, upload_dir / "molecule_collection.json")
    return {
        "upload_id": upload_id,
        "status": "ready" if int(summary["valid_count"]) else "no_valid_compounds",
        "filename": "mixed molecule collection" if len(source_inputs) + bool(smiles_text.strip()) > 1 else (
            source_inputs[0].filename if source_inputs else "entered_smiles.txt"
        ),
        "rows": int(summary["submitted_count"]),
        "path": relative_path(canonical_path),
        **summary,
        "preview": list(collection["records"])[:20],
    }


def project_chemical_space(upload_id: str) -> dict[str, object]:
    """Project the already-imported canonical collection without another upload."""

    manifest_path = _molecule_collection_manifest_path(upload_id)
    return _project_chemical_space_cached(str(manifest_path), manifest_path.stat().st_mtime_ns)


def chemical_space_neighbors(upload_id: str, query_molecule_id: str, top_k: int) -> dict[str, object]:
    """Return query-relative Tanimoto neighbors from the imported collection."""

    try:
        manifest_path = _molecule_collection_manifest_path(upload_id)
        return _chemical_space_neighbors_cached(
            str(manifest_path), manifest_path.stat().st_mtime_ns, query_molecule_id, top_k,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc


def chemical_space_scaffolds(upload_id: str) -> dict[str, object]:
    """Organize the already-imported collection by descriptive Murcko scaffold."""

    manifest_path = _molecule_collection_manifest_path(upload_id)
    return _chemical_space_scaffolds_cached(
        str(manifest_path), manifest_path.stat().st_mtime_ns, SCAFFOLD_ALGORITHM_VERSION,
    )


def experimental_neighborhood_search(
    upload_id: str, molecule_id: str, source: str, max_analogs: int, refresh: bool,
) -> dict[str, object]:
    """Run an explicit online exact/analog search for one imported molecule."""

    if source.lower() != "chembl":
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Unsupported known-compound source.")
    records = _load_molecule_collection_records(upload_id)
    selected = None
    for index, record in enumerate(records):
        stable_id = str(record.get("molecule_id") or f"compound_{index + 1:03d}")
        if stable_id == molecule_id:
            selected = {
                **record,
                "molecule_id": stable_id,
                "display_name": str(record.get("original_molecule_id") or stable_id),
            }
            break
    if selected is None or str(selected.get("validation_status") or "").lower() != "valid":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Selected molecule is not a valid member of this collection.")
    try:
        return search_known_analogs(selected, max_analogs=max_analogs, refresh=refresh)
    except KnownSourceError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": exc.code, "message": str(exc)},
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc


def experimental_neighborhood_records(
    source: str, source_compound_id: str, limit: int, refresh: bool,
) -> dict[str, object]:
    """Retrieve bounded assay-level records for one explicitly selected known compound."""

    if source.lower() != "chembl":
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Unsupported known-compound source.")
    try:
        return retrieve_experimental_records(source_compound_id, limit=limit, refresh=refresh)
    except KnownSourceError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": exc.code, "message": str(exc)},
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc


def matched_pair_batch(query: dict[str, object], references: list[dict[str, object]]) -> dict[str, object]:
    """Run bounded local structural transformation analysis without external lookup."""

    return analyze_matched_pair_batch(query, references)


def export_experimental_neighborhood_csv(source: str, source_compound_id: str) -> str:
    """Prepare reviewed public records as a Batch 10B-compatible CSV without persisting them."""

    payload = experimental_neighborhood_records(source, source_compound_id, 500, False)
    fields = [
        "smiles", "endpoint", "value", "unit", "relation", "target_identifier", "target_name",
        "organism", "assay_id", "assay_type", "assay_system", "readout", "source",
        "source_record_id", "citation", "comments",
    ]
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    for record in list(payload.get("records") or []):
        target = dict(record.get("target") or {})
        writer.writerow({
            "smiles": record.get("canonical_smiles"),
            "endpoint": record.get("endpoint_name"),
            "value": record.get("original_value"),
            "unit": record.get("original_unit"),
            "relation": record.get("relation"),
            "target_identifier": target.get("identifier"),
            "target_name": target.get("name"),
            "organism": target.get("organism"),
            "assay_id": record.get("assay_id"),
            "assay_type": record.get("assay_type"),
            "assay_system": record.get("assay_system"),
            "readout": record.get("readout"),
            "source": record.get("source"),
            "source_record_id": record.get("source_record_id"),
            "citation": record.get("publication_reference"),
            "comments": "Prepared from Experimental Neighborhood; import explicitly after the analog exists in the molecule collection.",
        })
    return buffer.getvalue()


def _load_molecule_collection_records(upload_id: str) -> list[dict[str, object]]:
    return _read_molecule_collection_records(_molecule_collection_manifest_path(upload_id))


def _molecule_collection_manifest_path(upload_id: str) -> Path:
    if len(upload_id) != 32 or any(character not in "0123456789abcdef" for character in upload_id.lower()):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Molecule collection not found.")
    manifest_path = UPLOAD_DIR / upload_id / "molecule_collection.json"
    if not manifest_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Molecule collection not found.")
    return manifest_path


def _read_molecule_collection_records(manifest_path: Path) -> list[dict[str, object]]:
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        records = payload.get("records")
        if not isinstance(records, list):
            raise ValueError("records are unavailable")
        return [dict(record) for record in records]
    except (OSError, json.JSONDecodeError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Molecule collection is unreadable.") from exc


def preview_experimental_measurements(
    file: UploadFile, *, upload_id: str, column_mapping: dict[str, str] | None = None,
) -> dict[str, object]:
    """Validate an experimental CSV/TSV and stage an inspectable, non-final preview."""

    filename = Path(file.filename or "experimental_measurements.csv").name
    content = file.file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Experimental measurement file is empty.")
    molecule_records = _load_molecule_collection_records(upload_id)
    try:
        parsed = parse_experimental_delimited(
            content, filename, molecule_records, column_mapping=column_mapping,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc

    preview_id = uuid4().hex
    preview_dir = EXPERIMENTAL_PREVIEW_DIR / preview_id
    preview_dir.mkdir(parents=True, exist_ok=False)
    dataset_id = deterministic_identifier(
        "experimental-dataset",
        EXPERIMENTAL_SCHEMA_VERSION,
        upload_id,
        parsed["source_sha256"],
        parsed["column_mapping"],
    )
    manifest = {
        **parsed,
        "preview_id": preview_id,
        "experimental_dataset_id": dataset_id,
        "upload_id": upload_id,
        "status": "preview",
        "previewed_at": utc_timestamp(),
        "source_file": {
            "filename": filename,
            "sha256": parsed["source_sha256"],
            "size_bytes": len(content),
            "format": Path(filename).suffix.lower().lstrip("."),
        },
    }
    try:
        source_dir = preview_dir / "source"
        source_dir.mkdir()
        (source_dir / filename).write_bytes(content)
        _write_json_atomic(preview_dir / "preview.json", manifest)
    except Exception:
        shutil.rmtree(preview_dir, ignore_errors=True)
        raise
    return _public_experimental_payload(manifest, preview=True)


def finalize_experimental_preview(preview_id: str) -> dict[str, object]:
    """Atomically publish a fully validated preview as an immutable versioned dataset."""

    preview_dir, manifest = _load_experimental_preview(preview_id)
    if int(dict(manifest.get("summary") or {}).get("valid_measurements") or 0) == 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Experimental dataset has no valid linked measurements to finalize.",
        )
    dataset_id = str(manifest["experimental_dataset_id"])
    final_dir = EXPERIMENTAL_DATASET_DIR / dataset_id
    if final_dir.exists():
        existing = _read_experimental_manifest(dataset_id)
        shutil.rmtree(preview_dir, ignore_errors=True)
        return _public_experimental_payload(existing)

    staging_dir = preview_dir / f"finalized-{dataset_id}"
    records = list(manifest.get("measurements") or [])
    valid_records = [dict(record) for record in records if record.get("validation_status") == "valid"]
    excluded_records = [dict(record) for record in records if record.get("validation_status") != "valid"]
    finalized = {
        **manifest,
        "status": "finalized",
        "finalized_at": utc_timestamp(),
        "measurements": valid_records,
        "excluded_records": excluded_records,
        "record_counts": {
            "source_rows": len(records),
            "measurements": len(valid_records),
            "excluded": len(excluded_records),
        },
    }
    finalized.pop("preview_id", None)
    try:
        staging_dir.mkdir(parents=True, exist_ok=False)
        source_dir = staging_dir / "source"
        source_dir.mkdir()
        for source_path in (preview_dir / "source").iterdir():
            shutil.copy2(source_path, source_dir / source_path.name)
        _write_json_atomic(staging_dir / "manifest.json", finalized)
        _write_experimental_csv(staging_dir / "measurements.csv", valid_records)
        _write_json_atomic(staging_dir / "excluded_records.json", {"records": excluded_records})
        EXPERIMENTAL_DATASET_DIR.mkdir(parents=True, exist_ok=True)
        staging_dir.replace(final_dir)
    except Exception:
        shutil.rmtree(staging_dir, ignore_errors=True)
        raise
    shutil.rmtree(preview_dir, ignore_errors=True)
    return _public_experimental_payload(finalized)


def get_experimental_dataset(dataset_id: str) -> dict[str, object]:
    return _public_experimental_payload(_read_experimental_manifest(dataset_id))


def list_experimental_measurements(
    dataset_id: str, *, query: str = "", endpoint: str = "", linkage_status: str = "",
    offset: int = 0, limit: int = 50,
) -> dict[str, object]:
    manifest = _read_experimental_manifest(dataset_id)
    records = [dict(item) for item in list(manifest.get("measurements") or [])]
    needle = query.strip().lower()
    endpoint_filter = endpoint.strip().lower()
    linkage_filter = linkage_status.strip().lower()
    filtered = []
    for record in records:
        if endpoint_filter and str(record.get("endpoint_id") or "").lower() != endpoint_filter:
            continue
        if linkage_filter and str(dict(record.get("linkage") or {}).get("status") or "").lower() != linkage_filter:
            continue
        if needle:
            searchable = " ".join([
                str(record.get("molecule_id") or ""), str(record.get("endpoint_name") or ""),
                str(dict(record.get("target") or {}).get("name") or ""),
                str(record.get("assay_id") or ""), str(record.get("source") or ""),
                " ".join(str(flag) for flag in list(record.get("quality_flags") or [])),
            ]).lower()
            if needle not in searchable:
                continue
        filtered.append(record)
    return {
        "experimental_dataset_id": dataset_id,
        "total_count": len(records),
        "filtered_count": len(filtered),
        "offset": offset,
        "limit": limit,
        "measurements": filtered[offset:offset + limit],
    }


def export_experimental_measurements_csv(dataset_id: str) -> str:
    manifest = _read_experimental_manifest(dataset_id)
    buffer = io.StringIO()
    fields = [
        "measurement_id", "molecule_id", "structure_identity_id", "endpoint_name", "measurement_type",
        "relation", "original_value", "original_unit", "normalized_value_molar", "normalized_unit",
        "transformed_endpoint", "transformed_relation", "transformed_value", "target_identifier",
        "target_name", "organism", "construct_or_isoform", "assay_id", "assay_protocol_version",
        "assay_type", "assay_system", "biological_mode", "readout", "source", "source_record_id",
        "replicate_id", "replicate_type", "replicate_count", "uncertainty_type", "uncertainty_value",
        "uncertainty_lower", "uncertainty_upper", "confidence_level", "uncertainty_scale",
        "linkage_status", "linkage_method", "quality_flags",
    ]
    writer = csv.DictWriter(buffer, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    for record in list(manifest.get("measurements") or []):
        writer.writerow(_experimental_csv_row(dict(record)))
    return buffer.getvalue()


def _public_experimental_payload(manifest: dict[str, object], *, preview: bool = False) -> dict[str, object]:
    records = list(manifest.get("measurements") or [])
    excluded = list(manifest.get("excluded_records") or [])
    return {
        "preview_id": manifest.get("preview_id") if preview else None,
        "experimental_dataset_id": manifest.get("experimental_dataset_id"),
        "upload_id": manifest.get("upload_id"),
        "status": manifest.get("status"),
        "schema_version": manifest.get("schema_version"),
        "normalization_version": manifest.get("normalization_version"),
        "source_file": manifest.get("source_file"),
        "column_mapping": manifest.get("column_mapping"),
        "summary": manifest.get("summary"),
        "record_counts": manifest.get("record_counts"),
        "previewed_at": manifest.get("previewed_at"),
        "finalized_at": manifest.get("finalized_at"),
        "measurements": records[:50],
        "excluded_records": excluded[:50] if not preview else [
            record for record in records[:50] if record.get("validation_status") != "valid"
        ],
    }


def _load_experimental_preview(preview_id: str) -> tuple[Path, dict[str, object]]:
    if not _valid_hex_id(preview_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Experimental preview not found.")
    preview_dir = EXPERIMENTAL_PREVIEW_DIR / preview_id
    path = preview_dir / "preview.json"
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Experimental preview not found.")
    try:
        return preview_dir, json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Experimental preview is unreadable.") from exc


def _read_experimental_manifest(dataset_id: str) -> dict[str, object]:
    if not _valid_hex_id(dataset_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Experimental dataset not found.")
    path = EXPERIMENTAL_DATASET_DIR / dataset_id / "manifest.json"
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Experimental dataset not found.")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if payload.get("schema_version") != EXPERIMENTAL_SCHEMA_VERSION:
            raise ValueError("unsupported schema")
        return payload
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Experimental dataset is unreadable.") from exc


def _write_experimental_csv(path: Path, records: list[dict[str, object]]) -> None:
    export_rows = [_experimental_csv_row(record) for record in records]
    fields = list(export_rows[0]) if export_rows else ["measurement_id"]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(export_rows)


def _experimental_csv_row(record: dict[str, object]) -> dict[str, object]:
    normalization = dict(record.get("normalization") or {})
    target = dict(record.get("target") or {})
    optional = dict(record.get("optional_metadata") or {})
    uncertainty = dict(record.get("uncertainty") or {})
    linkage = dict(record.get("linkage") or {})
    return {
        "measurement_id": record.get("measurement_id"),
        "molecule_id": record.get("molecule_id"),
        "structure_identity_id": record.get("structure_identity_id"),
        "endpoint_name": record.get("endpoint_name"),
        "measurement_type": record.get("measurement_type"),
        "relation": record.get("relation"),
        "original_value": record.get("original_value"),
        "original_unit": record.get("original_unit"),
        "normalized_value_molar": normalization.get("normalized_value_molar"),
        "normalized_unit": normalization.get("normalized_unit"),
        "transformed_endpoint": normalization.get("transformed_endpoint"),
        "transformed_relation": normalization.get("transformed_relation"),
        "transformed_value": normalization.get("transformed_value"),
        "target_identifier": target.get("identifier"), "target_name": target.get("name"),
        "organism": target.get("organism"), "construct_or_isoform": target.get("construct_or_isoform"),
        "assay_id": record.get("assay_id"), "assay_protocol_version": record.get("assay_protocol_version"),
        "assay_type": record.get("assay_type"), "assay_system": record.get("assay_system"),
        "biological_mode": record.get("biological_mode"), "readout": record.get("readout"),
        "source": record.get("source"), "source_record_id": record.get("source_record_id"),
        "replicate_id": optional.get("replicate_id"), "replicate_type": optional.get("replicate_type"),
        "replicate_count": record.get("replicate_count"), "uncertainty_type": uncertainty.get("type"),
        "uncertainty_value": uncertainty.get("value"), "uncertainty_lower": uncertainty.get("lower"),
        "uncertainty_upper": uncertainty.get("upper"), "confidence_level": uncertainty.get("confidence_level"),
        "uncertainty_scale": uncertainty.get("scale"), "linkage_status": linkage.get("status"),
        "linkage_method": linkage.get("method"),
        "quality_flags": json.dumps(record.get("quality_flags") or [], sort_keys=True),
    }


def _write_json_atomic(path: Path, payload: dict[str, object]) -> None:
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        with temporary.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def _valid_hex_id(value: str) -> bool:
    return len(value) == 32 and all(character in "0123456789abcdef" for character in value.lower())


@lru_cache(maxsize=4)
def _project_chemical_space_cached(manifest_path: str, modified_ns: int) -> dict[str, object]:
    del modified_ns
    return project_records(_read_molecule_collection_records(Path(manifest_path)))


@lru_cache(maxsize=32)
def _chemical_space_neighbors_cached(
    manifest_path: str, modified_ns: int, query_molecule_id: str, top_k: int,
) -> dict[str, object]:
    del modified_ns
    return nearest_neighbors(
        _read_molecule_collection_records(Path(manifest_path)), query_molecule_id, top_k,
    )


@lru_cache(maxsize=4)
def _chemical_space_scaffolds_cached(
    manifest_path: str, modified_ns: int, algorithm_version: str,
) -> dict[str, object]:
    del modified_ns, algorithm_version
    return organize_scaffolds(_read_molecule_collection_records(Path(manifest_path)))


def _import_job_path(import_job_id: str) -> Path:
    if len(import_job_id) != 32 or any(character not in "0123456789abcdef" for character in import_job_id.lower()):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import job not found.")
    return IMPORT_JOB_DIR / import_job_id


def _load_import_job(import_job_id: str) -> tuple[Path, dict[str, object]]:
    job_dir = _import_job_path(import_job_id)
    metadata_path = job_dir / "job.json"
    if not metadata_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import job not found.")
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Import job state is unreadable.") from exc
    if metadata.get("status") != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Import job is not pending.")
    return job_dir, metadata


def _write_import_job_metadata(job_dir: Path, metadata: dict[str, object]) -> None:
    temporary_path = job_dir / f"job-{uuid4().hex}.tmp"
    try:
        with temporary_path.open("w", encoding="utf-8") as handle:
            json.dump(metadata, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, job_dir / "job.json")
    finally:
        temporary_path.unlink(missing_ok=True)


def _public_import_job(metadata: dict[str, object]) -> dict[str, object]:
    return {
        "import_job_id": metadata["import_job_id"],
        "status": metadata["status"],
        "expected_file_count": metadata["expected_file_count"],
        "processed_file_count": metadata["processed_file_count"],
        "parsed_record_count": metadata["parsed_record_count"],
        "batch_count": metadata["batch_count"],
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


def save_docking_receptor(
    file: UploadFile,
    *,
    receptor_id: str = "",
    display_name: str = "",
) -> dict[str, object]:
    return receptor_store.save_receptor_upload(
        file, receptor_id=receptor_id, display_name=display_name,
    )


def get_docking_receptor(receptor_id: str) -> dict[str, object]:
    return receptor_store.read_receptor(receptor_id)


def get_docking_receptor_structure(
    receptor_id: str,
    *,
    representation: str = "source",
) -> tuple[bytes, str, dict[str, str]]:
    if representation == "docking":
        payload, structure_format, identity = receptor_store.docking_visualization_structure(receptor_id)
    else:
        path, structure_format = receptor_store.receptor_structure(receptor_id)
        payload = path.read_bytes()
        metadata = receptor_store.read_receptor(receptor_id)
        identity = {
            "receptor_id": receptor_id,
            "preparation_id": str(metadata.get("preparation_id") or ""),
            "artifact_sha256": hashlib.sha256(payload).hexdigest(),
            "docking_receptor_sha256": "",
            "structure_format": structure_format,
        }
    return payload, structure_format, identity


def get_receptor_preparation_runtime() -> dict[str, object]:
    return receptor_store.preparation_runtime_status()


def prepare_docking_receptor(receptor_id: str, values: dict[str, object]) -> dict[str, object]:
    return receptor_store.prepare_stored_receptor(receptor_id, values)


def save_docking_configuration(values: dict[str, object]) -> dict[str, object]:
    return receptor_store.save_configuration(values)


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
    docking_configuration_id: str = "",
    docking_configuration: dict[str, object] | None = None,
    prioritization_method: str = "legacy_v1",
    prioritization_profile: dict[str, object] | None = None,
) -> dict[str, object]:
    """Create and enqueue one local molecular prioritization job."""

    if prioritization_method not in {"legacy_v1", "v2"}:
        raise HTTPException(status_code=422, detail="Unknown prioritization method.")
    validated_profile = None
    profile_digest = None
    if prioritization_method == "v2":
        if prioritization_profile is None:
            raise HTTPException(
                status_code=422,
                detail="Prioritization v2 requires an explicit complete profile.",
            )
        validation = validate_prioritization_profile(prioritization_profile)
        if not validation["scoreable"]:
            raise HTTPException(
                status_code=422,
                detail="Prioritization v2 profile is not scoreable: "
                + " | ".join(str(error) for error in validation["errors"]),
            )
        validated_profile = validation["profile"]
        profile_digest = validation["profile_sha256"]

    pubchem_lookup_requested = enable_public_lookup if enable_pubchem_lookup is None else enable_pubchem_lookup
    input_path = find_upload_path(upload_id)
    submitted_count = validate_molecule_csv(input_path, enforce_batch_limit=False)
    import_manifest = read_molecule_collection_manifest(upload_id)
    import_summary = dict(import_manifest.get("summary") or {})
    imported_valid_count = import_summary.get("valid_count")
    analysis_mode = str(import_summary.get("analysis_mode") or "library")
    if imported_valid_count is not None and int(imported_valid_count) == 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="At least one chemically valid compound is required to start an analysis.",
        )
    if analysis_mode not in {"single_compound", "library"}:
        analysis_mode = "library"
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
        if docking_configuration_id.strip():
            try:
                saved_config = receptor_store.read_configuration(docking_configuration_id)
                saved_receptor_id = str(saved_config["receptor_id"])
                saved_receptor = receptor_store.read_receptor(saved_receptor_id)
                receptor = validate_prepared_receptor(
                    receptor_store.prepared_receptor_path(saved_receptor_id),
                    receptor_id=saved_receptor_id,
                    source=str(saved_receptor.get("receptor_source") or "user_supplied_pdbqt"),
                    source_filename=str(saved_receptor.get("original_filename") or "receptor.pdbqt"),
                )
                docking_config = VinaBoxConfig.from_mapping(saved_config)
            except (HTTPException, ReceptorValidationError) as exc:
                docking_setup_error = str(getattr(exc, "detail", exc))
        else:
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
        "valid_count": int(imported_valid_count) if imported_valid_count is not None else None,
        "invalid_count": int(import_summary.get("invalid_count")) if import_summary.get("invalid_count") is not None else None,
        "duplicate_count": int(import_summary.get("duplicate_count")) if import_summary.get("duplicate_count") is not None else None,
        "processed_count": 0,
        "total_count": submitted_count,
        "admet_success_count": 0,
        "admet_failure_count": 0,
        "admet_runtime_identities": [],
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
        "docking_configuration_id": docking_configuration_id,
        "receptor_upload_id": receptor_upload_id,
        "receptor_id": receptor.receptor_id if receptor else receptor_id,
        "prepared_receptor_sha256": receptor.prepared_receptor_sha256 if receptor else None,
        "docking_configuration": docking_config.as_dict() if docking_config else {},
        "docking_setup_error": docking_setup_error,
        "prioritization_method": prioritization_method,
        "prioritization_profile_sha256": profile_digest,
        "prioritization_profile": validated_profile,
        "receptor_source": receptor.source if receptor else None,
        "analysis_mode": analysis_mode,
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
        docking_configuration_id=docking_configuration_id,
        prioritization_method=prioritization_method,
        prioritization_profile=validated_profile,
        analysis_mode=analysis_mode,
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
            if "admet_runtime_identities" in values:
                values["admet_runtime_identities"] = portable_runtime_identities(
                    values["admet_runtime_identities"]
                )
            update_job_metadata(job_id, **values)

        def cancellation_requested() -> bool:
            metadata = read_job_metadata(job_id)
            return bool(metadata and metadata.get("cancellation_requested"))

        rows = call_prioritize_csv(
            input_path,
            output_path,
            progress_callback=progress_callback,
            cancellation_requested=cancellation_requested,
            **options,
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
    except DockingCancelled:
        update_job_metadata(
            job_id,
            status="cancelled",
            stage="completed",
            completed_at=utc_timestamp(),
            error_message="",
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
    restored["v2_score"] = _optional_csv_float(restored.get("v2_score"))
    restored["v2_rank"] = _optional_csv_int(restored.get("v2_rank"))
    for optional_field in (
        "v2_rank_eligible", "rank_eligible", "valid_molecule", "duplicate_structure", "input_has_3d",
    ):
        if optional_field in restored:
            restored[optional_field] = _optional_csv_bool(restored.get(optional_field))
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
    for field in ("bbb_result", "admet_regression", "admet_family_status", "docking_result", "prioritization", "prioritization_v2"):
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


def _optional_csv_bool(value: object) -> bool | None:
    if isinstance(value, bool):
        return value
    normalized = str(value or "").strip().casefold()
    if normalized in {"true", "1", "yes"}:
        return True
    if normalized in {"false", "0", "no"}:
        return False
    return None


def _optional_csv_float(value: object) -> float | None:
    if value in (None, ""):
        return None
    try:
        converted = float(value)
    except (TypeError, ValueError):
        return None
    return converted if math.isfinite(converted) else None


def _optional_csv_int(value: object) -> int | None:
    converted = _optional_csv_float(value)
    return int(converted) if converted is not None and converted.is_integer() else None


def get_results_package(job_id: str) -> dict[str, object]:
    """Build and describe the deterministic bundle for one completed job."""

    result = get_result(job_id)
    job_dir = (JOB_OUTPUT_DIR / job_id).resolve()
    try:
        return results_package.build_results_package(
            job_dir=job_dir,
            job=result,
            rows=list(result["results"]),
            molecule_manifest=read_molecule_collection_manifest(str(result.get("upload_id") or "")),
            receptor_root=receptor_store.RECEPTOR_ROOT,
        )
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Results package could not be generated: {exc}",
        ) from exc


def get_results_artifact(job_id: str, relative_path_value: str) -> Path:
    """Return one current-job package artifact without permitting path traversal."""

    get_results_package(job_id)
    root = (JOB_OUTPUT_DIR / job_id / "results").resolve()
    candidate = (root / relative_path_value).resolve()
    if candidate != root and root not in candidate.parents:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Result artifact not found.")
    if not candidate.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Result artifact not found.")
    return candidate


def get_results_zip(job_id: str) -> Path:
    get_results_package(job_id)
    path = (JOB_OUTPUT_DIR / job_id / "results_package.zip").resolve()
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Results package ZIP not found.")
    return path


def get_persisted_results_analysis(job_id: str, analysis_name: str) -> dict[str, object]:
    """Read one job-scoped persisted secondary analysis without recalculating it."""

    validate_existing_job_id(job_id)
    if analysis_name not in {"pareto", "sensitivity"}:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saved analysis not found.")
    path = JOB_OUTPUT_DIR / job_id / "analysis" / f"{analysis_name}.json"
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saved analysis not found.")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Saved analysis is invalid.") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Saved analysis is invalid.")
    return payload


def _persist_job_analysis(job_id: str, name: str, payload: dict[str, object]) -> None:
    validate_existing_job_id(job_id)
    directory = JOB_OUTPUT_DIR / job_id / "analysis"
    directory.mkdir(parents=True, exist_ok=True)
    temporary = directory / f"{name}.json.tmp"
    target = directory / f"{name}.json"
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True, allow_nan=False) + "\n", encoding="utf-8")
    temporary.replace(target)


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


def validate_molecule_csv(path: Path, *, enforce_batch_limit: bool = True) -> int:
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
        if enforce_batch_limit and row_count > MAX_BATCH_SIZE:
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
    normalized.setdefault("admet_runtime_identities", [])
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
    normalized.setdefault("analysis_mode", "library")
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


def read_molecule_collection_manifest(upload_id: str) -> dict[str, object]:
    manifest_path = UPLOAD_DIR / upload_id / "molecule_collection.json"
    if not manifest_path.is_file():
        return {}
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


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


def get_scientific_runtime_status(*, refresh: bool = False) -> dict[str, object]:
    """Return production runtime contract status without running inference."""

    return runtime_qualification.scientific_runtime_status(
        application_root=PROJECT_ROOT, refresh=refresh
    )


def refresh_public_source_status() -> dict[str, object]:
    """Refresh planned public data source status without external lookups."""

    return model_sources.refresh_source_status_payload()
