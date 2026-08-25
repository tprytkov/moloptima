"""FastAPI application for MolOptima Phase 1 molecular prioritization."""

from __future__ import annotations

from fastapi import FastAPI, File, Query, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from backend import services
from backend.schemas import (
    CandidateSdfExportRequest,
    HealthResponse,
    JobAnnotationsRequest,
    JobAnnotationsResponse,
    JobHistoryResponse,
    JobResponse,
    LatestJobResponse,
    PrioritizationRequest,
    ReceptorUploadResponse,
    ResultResponse,
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
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()


@app.post("/api/molecules/upload", response_model=UploadResponse)
def upload_molecules(file: UploadFile = File(...)) -> UploadResponse:
    return UploadResponse(**services.save_upload(file))


@app.post("/api/receptors/upload", response_model=ReceptorUploadResponse)
def upload_receptor(
    file: UploadFile = File(...),
    receptor_id: str = Query("", max_length=200),
) -> ReceptorUploadResponse:
    return ReceptorUploadResponse(**services.save_receptor(file, receptor_id=receptor_id))


@app.get("/api/molecules/structure")
def get_molecule_structure(
    smiles: str = Query(..., min_length=1),
    width: int = Query(280, ge=120, le=800),
    height: int = Query(220, ge=120, le=800),
) -> Response:
    svg = services.render_molecule_structure_svg(smiles, width=width, height=height)
    return Response(content=svg, media_type="image/svg+xml")


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


@app.post("/api/jobs/prioritization", response_model=JobResponse)
def create_prioritization_job(request: PrioritizationRequest) -> JobResponse:
    return JobResponse(
        **services.run_prioritization_job(
            request.upload_id,
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
            docking_configuration={
                "center_x": request.docking_center_x,
                "center_y": request.docking_center_y,
                "center_z": request.docking_center_z,
                "size_x": request.docking_size_x,
                "size_y": request.docking_size_y,
                "size_z": request.docking_size_z,
                "exhaustiveness": request.docking_exhaustiveness,
                "num_modes": request.docking_num_modes,
                "seed": request.docking_seed,
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


@app.post("/api/model-sources/refresh", response_model=SourceStatusResponse)
def refresh_model_source_status() -> SourceStatusResponse:
    return SourceStatusResponse(**services.refresh_public_source_status())
