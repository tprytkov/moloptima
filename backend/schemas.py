"""API response and request schemas for the MolOptima backend."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str = "ok"
    service: str = "moloptima-backend"


class UploadResponse(BaseModel):
    upload_id: str
    status: str = "uploaded"
    filename: str
    rows: int
    path: str


class PrioritizationRequest(BaseModel):
    upload_id: str = Field(..., min_length=1)
    enable_public_lookup: bool = False
    enable_pubchem_lookup: bool = False
    enable_chembl_lookup: bool = False
    enable_patent_lookup: bool = False


class JobResponse(BaseModel):
    job_id: str
    upload_id: str
    status: str
    input_file: str
    output_file: str
    created_at: str
    completed_at: str | None = None
    error_message: str = ""
    row_count: int


class ResultResponse(BaseModel):
    job_id: str
    status: str
    input_file: str
    output_file: str
    created_at: str
    completed_at: str | None = None
    error_message: str = ""
    row_count: int
    results: list[dict[str, Any]]


class LatestJobResponse(BaseModel):
    job: ResultResponse | None = None


class JobHistoryResponse(BaseModel):
    jobs: list[dict[str, Any]]


class JobAnnotationsResponse(BaseModel):
    job_id: str
    annotations: dict[str, dict[str, str]]
    updated_at: str | None = None


class JobAnnotationsRequest(BaseModel):
    annotations: dict[str, dict[str, str]]


class SourceStatusResponse(BaseModel):
    model_manifest: dict[str, Any]
    public_data_manifest: dict[str, Any]
    run_manifest: dict[str, Any]
