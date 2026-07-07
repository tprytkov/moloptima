"""FastAPI application for MolOptima Phase 1 molecular prioritization."""

from __future__ import annotations

from fastapi import FastAPI, File, UploadFile

from backend import services
from backend.schemas import (
    HealthResponse,
    JobResponse,
    PrioritizationRequest,
    ResultResponse,
    UploadResponse,
)


app = FastAPI(title="MolOptima API", version="0.1.0")


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()


@app.post("/api/molecules/upload", response_model=UploadResponse)
def upload_molecules(file: UploadFile = File(...)) -> UploadResponse:
    return UploadResponse(**services.save_upload(file))


@app.post("/api/jobs/prioritization", response_model=JobResponse)
def create_prioritization_job(request: PrioritizationRequest) -> JobResponse:
    return JobResponse(**services.run_prioritization_job(request.upload_id))


@app.get("/api/results/{job_id}", response_model=ResultResponse)
def get_results(job_id: str) -> ResultResponse:
    return ResultResponse(**services.get_result(job_id))
