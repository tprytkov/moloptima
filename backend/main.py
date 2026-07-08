"""FastAPI application for MolOptima Phase 1 molecular prioritization."""

from __future__ import annotations

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from backend import services
from backend.schemas import (
    HealthResponse,
    JobResponse,
    PrioritizationRequest,
    ResultResponse,
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
    return JobResponse(**services.run_prioritization_job(request.upload_id))


@app.get("/api/results/{job_id}", response_model=ResultResponse)
def get_results(job_id: str) -> ResultResponse:
    return ResultResponse(**services.get_result(job_id))
