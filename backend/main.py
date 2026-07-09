"""FastAPI application for MolOptima Phase 1 molecular prioritization."""

from __future__ import annotations

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from backend import services
from backend.schemas import (
    HealthResponse,
    JobResponse,
    LatestJobResponse,
    PrioritizationRequest,
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
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()


@app.post("/api/molecules/upload", response_model=UploadResponse)
def upload_molecules(file: UploadFile = File(...)) -> UploadResponse:
    return UploadResponse(**services.save_upload(file))


@app.post("/api/jobs/prioritization", response_model=JobResponse)
def create_prioritization_job(request: PrioritizationRequest) -> JobResponse:
    return JobResponse(
        **services.run_prioritization_job(
            request.upload_id,
            enable_public_lookup=request.enable_public_lookup,
            enable_pubchem_lookup=request.enable_pubchem_lookup or request.enable_public_lookup,
            enable_chembl_lookup=request.enable_chembl_lookup,
            enable_patent_lookup=request.enable_patent_lookup,
        )
    )


@app.get("/api/jobs/latest", response_model=LatestJobResponse)
def get_latest_job() -> LatestJobResponse:
    return LatestJobResponse(**services.get_latest_completed_job())


@app.get("/api/results/{job_id}", response_model=ResultResponse)
def get_results(job_id: str) -> ResultResponse:
    return ResultResponse(**services.get_result(job_id))


@app.get("/api/model-sources/status", response_model=SourceStatusResponse)
def get_model_source_status() -> SourceStatusResponse:
    return SourceStatusResponse(**services.check_model_and_source_status())


@app.post("/api/model-sources/refresh", response_model=SourceStatusResponse)
def refresh_model_source_status() -> SourceStatusResponse:
    return SourceStatusResponse(**services.refresh_public_source_status())
