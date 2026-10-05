"""FastAPI application for MolOptima Phase 1 molecular prioritization."""

from __future__ import annotations

import json
from typing import Literal

from fastapi import FastAPI, File, Form, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from backend import services
from backend.schemas import (
    CandidateSdfExportRequest,
    ChemicalSpaceNeighborRequest,
    ChemicalSpaceNeighborResponse,
    ChemicalSpaceProjectRequest,
    ChemicalSpaceProjectResponse,
    ChemicalSpaceScaffoldResponse,
    DockingConfigurationRequest,
    DockingConfigurationResponse,
    DockingReceptorResponse,
    ExperimentalDataResponse,
    ExperimentalMeasurementListResponse,
    ExperimentalNeighborhoodRecordsRequest,
    ExperimentalNeighborhoodResponse,
    ExperimentalNeighborhoodSearchRequest,
    HealthResponse,
    ImportBatchResponse,
    ImportJobCreateRequest,
    ImportJobResponse,
    JobAnnotationsRequest,
    JobAnnotationsResponse,
    JobHistoryResponse,
    JobResponse,
    LatestJobResponse,
    ParetoAnalysisRequest,
    ParetoAnalysisResponse,
    PrioritizationRequest,
    PrioritizationMetadataResponse,
    PrioritizationProfileValidationRequest,
    PrioritizationProfileValidationResponse,
    ReceptorUploadResponse,
    ReceptorPreparationRequest,
    ReceptorPreparationRuntimeResponse,
    ResultResponse,
    SensitivityAnalysisRequest,
    SensitivityAnalysisResponse,
    ScientificRuntimeStatusResponse,
    SourceStatusResponse,
    UploadResponse,
)


app = FastAPI(title="MolOptima API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
    expose_headers=[
        "X-MolOptima-Structure-Format",
        "X-MolOptima-Structure-Representation",
        "X-MolOptima-Receptor-ID",
        "X-MolOptima-Preparation-ID",
        "X-MolOptima-Artifact-SHA256",
        "X-MolOptima-Docking-Receptor-SHA256",
    ],
)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()


@app.post("/api/molecules/upload", response_model=UploadResponse)
def upload_molecules(file: UploadFile = File(...)) -> UploadResponse:
    return UploadResponse(**services.save_upload(file))


@app.post("/api/molecules/import", response_model=UploadResponse)
def import_molecules(
    files: list[UploadFile] = File(default=[]),
    smiles_text: str = Form(default=""),
    selected_structure_column: str = Form(default=""),
) -> UploadResponse:
    return UploadResponse(**services.save_molecule_import(
        files=files,
        smiles_text=smiles_text,
        selected_structure_column=selected_structure_column,
    ))


@app.post("/api/molecules/import-jobs", response_model=ImportJobResponse)
def create_molecule_import_job(request: ImportJobCreateRequest) -> ImportJobResponse:
    return ImportJobResponse(**services.create_molecule_import_job(
        expected_file_count=request.expected_file_count,
        smiles_text=request.smiles_text,
        selected_structure_column=request.selected_structure_column,
    ))


@app.post("/api/molecules/import-jobs/{import_job_id}/batches", response_model=ImportBatchResponse)
def append_molecule_import_batch(
    import_job_id: str,
    files: list[UploadFile] = File(default=[]),
    batch_index: int = Form(...),
) -> ImportBatchResponse:
    return ImportBatchResponse(**services.append_molecule_import_batch(
        import_job_id, batch_index=batch_index, files=files,
    ))


@app.post("/api/molecules/import-jobs/{import_job_id}/finalize", response_model=UploadResponse)
def finalize_molecule_import_job(import_job_id: str) -> UploadResponse:
    return UploadResponse(**services.finalize_molecule_import_job(import_job_id))


@app.delete("/api/molecules/import-jobs/{import_job_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel_molecule_import_job(import_job_id: str) -> Response:
    services.cancel_molecule_import_job(import_job_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/api/experimental-data/previews", response_model=ExperimentalDataResponse)
def preview_experimental_data(
    file: UploadFile = File(...),
    upload_id: str = Form(...),
    column_mapping: str = Form(default="{}"),
) -> ExperimentalDataResponse:
    try:
        mapping = json.loads(column_mapping)
        if not isinstance(mapping, dict) or any(not isinstance(key, str) or not isinstance(value, str) for key, value in mapping.items()):
            raise ValueError
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="Column mapping must be a JSON object of column names.") from exc
    return ExperimentalDataResponse(**services.preview_experimental_measurements(
        file, upload_id=upload_id, column_mapping=mapping,
    ))


@app.post(
    "/api/experimental-data/previews/{preview_id}/finalize",
    response_model=ExperimentalDataResponse,
)
def finalize_experimental_data(preview_id: str) -> ExperimentalDataResponse:
    return ExperimentalDataResponse(**services.finalize_experimental_preview(preview_id))


@app.get("/api/experimental-data/{dataset_id}", response_model=ExperimentalDataResponse)
def get_experimental_data(dataset_id: str) -> ExperimentalDataResponse:
    return ExperimentalDataResponse(**services.get_experimental_dataset(dataset_id))


@app.get(
    "/api/experimental-data/{dataset_id}/measurements",
    response_model=ExperimentalMeasurementListResponse,
)
def get_experimental_measurements(
    dataset_id: str,
    query: str = Query(default="", max_length=200),
    endpoint: str = Query(default="", max_length=100),
    linkage_status: str = Query(default="", max_length=30),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
) -> ExperimentalMeasurementListResponse:
    return ExperimentalMeasurementListResponse(**services.list_experimental_measurements(
        dataset_id, query=query, endpoint=endpoint, linkage_status=linkage_status,
        offset=offset, limit=limit,
    ))


@app.get("/api/experimental-data/{dataset_id}/export.csv")
def export_experimental_data(dataset_id: str) -> Response:
    payload = services.export_experimental_measurements_csv(dataset_id)
    return Response(
        content=payload,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="experimental-{dataset_id}.csv"'},
    )


@app.post("/api/receptors/upload", response_model=ReceptorUploadResponse)
def upload_receptor(
    file: UploadFile = File(...),
    receptor_id: str = Query("", max_length=200),
) -> ReceptorUploadResponse:
    return ReceptorUploadResponse(**services.save_receptor(file, receptor_id=receptor_id))


@app.post("/api/docking/receptors", response_model=DockingReceptorResponse)
def upload_docking_receptor(
    file: UploadFile = File(...),
    receptor_id: str = Query("", max_length=32),
    display_name: str = Query("", max_length=200),
) -> DockingReceptorResponse:
    return DockingReceptorResponse(**services.save_docking_receptor(
        file, receptor_id=receptor_id, display_name=display_name,
    ))


@app.get("/api/docking/receptors/{receptor_id}", response_model=DockingReceptorResponse)
def get_docking_receptor(receptor_id: str) -> DockingReceptorResponse:
    return DockingReceptorResponse(**services.get_docking_receptor(receptor_id))


@app.get(
    "/api/docking/receptor-preparation/runtime",
    response_model=ReceptorPreparationRuntimeResponse,
)
def get_receptor_preparation_runtime() -> ReceptorPreparationRuntimeResponse:
    return ReceptorPreparationRuntimeResponse(**services.get_receptor_preparation_runtime())


@app.post(
    "/api/docking/receptors/{receptor_id}/prepare",
    response_model=DockingReceptorResponse,
)
def prepare_docking_receptor(
    receptor_id: str,
    request: ReceptorPreparationRequest,
) -> DockingReceptorResponse:
    return DockingReceptorResponse(**services.prepare_docking_receptor(receptor_id, request.model_dump()))


@app.get("/api/docking/receptors/{receptor_id}/structure")
def get_docking_receptor_structure(
    receptor_id: str,
    representation: Literal["source", "docking"] = Query(default="source"),
) -> Response:
    payload, structure_format, identity = services.get_docking_receptor_structure(
        receptor_id,
        representation=representation,
    )
    headers = {
        "X-MolOptima-Structure-Format": structure_format,
        "X-MolOptima-Structure-Representation": representation,
        "X-MolOptima-Receptor-ID": identity["receptor_id"],
        "X-MolOptima-Artifact-SHA256": identity["artifact_sha256"],
    }
    if identity["preparation_id"]:
        headers["X-MolOptima-Preparation-ID"] = identity["preparation_id"]
    if identity["docking_receptor_sha256"]:
        headers["X-MolOptima-Docking-Receptor-SHA256"] = identity["docking_receptor_sha256"]
    return Response(
        content=payload,
        media_type="chemical/x-pdb" if structure_format == "pdb" else "chemical/x-pdbqt",
        headers=headers,
    )


@app.post("/api/docking/configurations", response_model=DockingConfigurationResponse)
def create_docking_configuration(
    request: DockingConfigurationRequest,
) -> DockingConfigurationResponse:
    return DockingConfigurationResponse(**services.save_docking_configuration(request.model_dump()))


@app.get("/api/molecules/structure")
def get_molecule_structure(
    smiles: str = Query(..., min_length=1),
    width: int = Query(280, ge=120, le=800),
    height: int = Query(220, ge=120, le=800),
) -> Response:
    svg = services.render_molecule_structure_svg(smiles, width=width, height=height)
    return Response(content=svg, media_type="image/svg+xml")


@app.post("/api/chemical-space/project", response_model=ChemicalSpaceProjectResponse)
def project_chemical_space(request: ChemicalSpaceProjectRequest) -> ChemicalSpaceProjectResponse:
    return ChemicalSpaceProjectResponse(**services.project_chemical_space(request.upload_id))


@app.post("/api/chemical-space/neighbors", response_model=ChemicalSpaceNeighborResponse)
def get_chemical_space_neighbors(request: ChemicalSpaceNeighborRequest) -> ChemicalSpaceNeighborResponse:
    return ChemicalSpaceNeighborResponse(**services.chemical_space_neighbors(
        request.upload_id, request.query_molecule_id, request.top_k,
    ))


@app.post("/api/chemical-space/scaffolds", response_model=ChemicalSpaceScaffoldResponse)
def get_chemical_space_scaffolds(request: ChemicalSpaceProjectRequest) -> ChemicalSpaceScaffoldResponse:
    return ChemicalSpaceScaffoldResponse(**services.chemical_space_scaffolds(request.upload_id))


@app.post("/api/experimental-neighborhood/search", response_model=ExperimentalNeighborhoodResponse)
def search_experimental_neighborhood(
    request: ExperimentalNeighborhoodSearchRequest,
) -> ExperimentalNeighborhoodResponse:
    return ExperimentalNeighborhoodResponse(**services.experimental_neighborhood_search(
        request.upload_id, request.molecule_id, request.source, request.max_analogs, request.refresh,
    ))


@app.post("/api/experimental-neighborhood/records", response_model=ExperimentalNeighborhoodResponse)
def get_experimental_neighborhood_records(
    request: ExperimentalNeighborhoodRecordsRequest,
) -> ExperimentalNeighborhoodResponse:
    return ExperimentalNeighborhoodResponse(**services.experimental_neighborhood_records(
        request.source, request.source_compound_id, request.limit, request.refresh,
    ))


@app.get("/api/experimental-neighborhood/records/export.csv")
def export_experimental_neighborhood_records(
    source: Literal["chembl"] = Query("chembl"),
    source_compound_id: str = Query(..., pattern=r"^CHEMBL\d+$"),
) -> Response:
    content = services.export_experimental_neighborhood_csv(source, source_compound_id)
    return Response(
        content=content,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{source_compound_id}-experimental-records.csv"'},
    )


@app.post("/api/candidates/export-sdf")
def export_candidates_sdf(request: CandidateSdfExportRequest) -> Response:
    payload = services.export_candidates_sdf(request.candidates)
    return Response(
        content=str(payload["sdf"]),
        media_type="chemical/x-mdl-sdfile",
        headers={
            "Content-Disposition": 'attachment; filename="moloptima-candidates.sdf"',
            "X-MolOptima-SDF-Exported": str(payload["exported"]),
            "X-MolOptima-SDF-Skipped": str(payload["skipped"]),
        },
    )


@app.get("/api/prioritization/metadata", response_model=PrioritizationMetadataResponse)
def get_prioritization_metadata() -> PrioritizationMetadataResponse:
    return PrioritizationMetadataResponse(**services.prioritization_metadata())


@app.post(
    "/api/prioritization/profiles/validate",
    response_model=PrioritizationProfileValidationResponse,
)
def validate_prioritization_profile(
    request: PrioritizationProfileValidationRequest,
) -> PrioritizationProfileValidationResponse:
    return PrioritizationProfileValidationResponse(
        **services.validate_prioritization_profile(request.profile)
    )


@app.post(
    "/api/prioritization/analysis/pareto",
    response_model=ParetoAnalysisResponse,
)
def run_pareto_analysis(request: ParetoAnalysisRequest) -> ParetoAnalysisResponse:
    return ParetoAnalysisResponse(
        **services.run_pareto_analysis(
            request.results, request.dimensions, job_id=request.job_id or "",
        )
    )


@app.post(
    "/api/prioritization/analysis/sensitivity",
    response_model=SensitivityAnalysisResponse,
)
def run_sensitivity_analysis(
    request: SensitivityAnalysisRequest,
) -> SensitivityAnalysisResponse:
    return SensitivityAnalysisResponse(**services.run_weight_sensitivity_analysis(
        request.candidates,
        request.profile,
        perturbation_magnitude=request.perturbation_magnitude,
        number_of_samples=request.number_of_samples,
        analysis_seed=request.analysis_seed,
        job_id=request.job_id or "",
    ))


@app.post("/api/jobs/prioritization", response_model=JobResponse)
def create_prioritization_job(request: PrioritizationRequest) -> JobResponse:
    return JobResponse(
        **services.run_prioritization_job(
            request.upload_id,
            prioritization_method=request.prioritization_method,
            prioritization_profile=request.prioritization_profile,
            enable_public_lookup=request.enable_public_lookup,
            enable_pubchem_lookup=request.enable_pubchem_lookup or request.enable_public_lookup,
            enable_chembl_lookup=request.enable_chembl_lookup,
            enable_patent_lookup=request.enable_patent_lookup,
            enable_target_reference_discovery=request.enable_target_reference_discovery,
            target_context={
                "target_name": request.target_name,
                "target_gene_symbol": request.target_gene_symbol,
                "target_uniprot_id": request.target_uniprot_id,
                "target_chembl_id": request.target_chembl_id,
                "pdb_id": request.pdb_id,
                "organism": request.organism,
                "disease_context": request.disease_context,
                "mechanism_context": request.mechanism_context,
                "docking_protocol_notes": request.docking_protocol_notes,
                "binding_site_notes": request.binding_site_notes,
            },
            enable_docking=request.enable_docking,
            receptor_upload_id=request.receptor_upload_id,
            receptor_id=request.receptor_id or request.pdb_id,
            docking_configuration_id=request.docking_configuration_id,
            docking_configuration={
                "center_x": request.docking_center_x,
                "center_y": request.docking_center_y,
                "center_z": request.docking_center_z,
                "size_x": request.docking_size_x,
                "size_y": request.docking_size_y,
                "size_z": request.docking_size_z,
                "exhaustiveness": request.docking_exhaustiveness,
                "num_modes": request.docking_num_modes,
                "energy_range": request.docking_energy_range,
                "seed": request.docking_seed,
                "worker_count": request.docking_worker_count,
            },
        )
    )


@app.get("/api/jobs/latest", response_model=LatestJobResponse)
def get_latest_job() -> LatestJobResponse:
    return LatestJobResponse(**services.get_latest_completed_job())


@app.get("/api/jobs/history", response_model=JobHistoryResponse)
def get_job_history() -> JobHistoryResponse:
    return JobHistoryResponse(**services.get_job_history())


@app.get("/api/jobs/{job_id}", response_model=JobResponse)
def get_job_status(job_id: str) -> JobResponse:
    return JobResponse(**services.get_job_status(job_id))


@app.post("/api/jobs/{job_id}/cancel", response_model=JobResponse)
def cancel_job(job_id: str) -> JobResponse:
    return JobResponse(**services.request_job_cancellation(job_id))


@app.get("/api/results/{job_id}", response_model=ResultResponse)
def get_results(job_id: str) -> ResultResponse:
    return ResultResponse(**services.get_result(job_id))


@app.get("/api/results/{job_id}/package")
def get_results_package(job_id: str) -> dict[str, object]:
    return services.get_results_package(job_id)


@app.get("/api/results/{job_id}/package.zip")
def download_results_package(job_id: str) -> FileResponse:
    path = services.get_results_zip(job_id)
    return FileResponse(path, media_type="application/zip", filename=f"moloptima-{job_id}-results.zip")


@app.get("/api/results/{job_id}/analysis/pareto")
def get_saved_pareto_analysis(job_id: str) -> dict[str, object]:
    return services.get_persisted_results_analysis(job_id, "pareto")


@app.get("/api/results/{job_id}/analysis/sensitivity")
def get_saved_sensitivity_analysis(job_id: str) -> dict[str, object]:
    return services.get_persisted_results_analysis(job_id, "sensitivity")


@app.get("/api/results/{job_id}/artifacts/{artifact_path:path}")
def download_results_artifact(job_id: str, artifact_path: str) -> FileResponse:
    path = services.get_results_artifact(job_id, artifact_path)
    return FileResponse(path, filename=path.name)


@app.get("/api/jobs/{job_id}/annotations", response_model=JobAnnotationsResponse)
def get_job_annotations(job_id: str) -> JobAnnotationsResponse:
    return JobAnnotationsResponse(**services.get_job_annotations(job_id))


@app.put("/api/jobs/{job_id}/annotations", response_model=JobAnnotationsResponse)
def put_job_annotations(job_id: str, request: JobAnnotationsRequest) -> JobAnnotationsResponse:
    return JobAnnotationsResponse(
        **services.save_job_annotations(job_id, request.annotations)
    )


@app.get("/api/model-sources/status", response_model=SourceStatusResponse)
def get_model_source_status() -> SourceStatusResponse:
    return SourceStatusResponse(**services.check_model_and_source_status())


@app.get("/api/scientific-runtime/status", response_model=ScientificRuntimeStatusResponse)
def get_scientific_runtime_status() -> ScientificRuntimeStatusResponse:
    return ScientificRuntimeStatusResponse(**services.get_scientific_runtime_status())


@app.post("/api/scientific-runtime/refresh", response_model=ScientificRuntimeStatusResponse)
def refresh_scientific_runtime_status() -> ScientificRuntimeStatusResponse:
    return ScientificRuntimeStatusResponse(**services.get_scientific_runtime_status(refresh=True))


@app.post("/api/model-sources/refresh", response_model=SourceStatusResponse)
def refresh_model_source_status() -> SourceStatusResponse:
    return SourceStatusResponse(**services.refresh_public_source_status())
