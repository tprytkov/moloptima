"""API response and request schemas for the MolOptima backend."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


ADMET_ENDPOINT_NAMES = {
    "hia_hou",
    "pgp_broccatelli",
    "cyp1a2_veith",
    "cyp2c19_veith",
    "cyp2c9_veith",
    "cyp2d6_veith",
    "cyp3a4_veith",
    "herg_karim",
    "ames",
}
ADMET_REGRESSION_ENDPOINT_NAMES = {
    "caco2_wang", "lipophilicity_astrazeneca", "solubility_aqsoldb", "ppbr_az", "vdss_lombardo",
}

JobStatus = Literal[
    "queued",
    "running",
    "completed",
    "completed_with_warnings",
    "failed",
    "cancelled",
]
JobStage = Literal[
    "queued",
    "structure_processing",
    "admet",
    "docking",
    "prioritization",
    "evidence",
    "packaging",
    "completed",
]


class ADMETEndpointPrediction(BaseModel):
    raw_logit: float | None = None
    raw_probability: float | None
    calibrated_probability: float | None
    binary_prediction: int | None
    display_name: str
    positive_class_meaning: str
    evidence_status: str
    warning: str


class GMCBBBResult(BaseModel):
    model_config = ConfigDict(extra="allow")

    status: str = "model_unavailable"
    seed_probabilities: dict[str, float] = Field(default_factory=dict)
    ensemble_probability: float | None = None
    ensemble_standard_deviation: float | None = None
    threshold: Literal[0.5] = 0.5
    threshold_status: Literal["provisional_raw"] = "provisional_raw"
    raw_classification: Literal["BBB+", "BBB-"] | None = None
    calibration_status: Literal["not_frozen"] = "not_frozen"
    prediction: Literal["BBB+", "BBB-", "unavailable"] | None = None
    warning: str = ""


class ADMETRegressionResult(BaseModel):
    model_config = ConfigDict(extra="allow")

    status: str = "model_unavailable"
    endpoints: dict[str, dict[str, Any]] = Field(default_factory=dict)

    @field_validator("endpoints")
    @classmethod
    def validate_regression_endpoint_set(cls, value: dict[str, dict[str, Any]]):
        if value and set(value) != ADMET_REGRESSION_ENDPOINT_NAMES:
            raise ValueError("ADMET regression must contain the frozen 5-endpoint set")
        return value


class MoleculeAnalysisResult(BaseModel):
    model_config = ConfigDict(extra="allow")

    admet_model_status: str
    admet_warning: str
    admet_predictions: dict[str, ADMETEndpointPrediction]
    bbb_result: GMCBBBResult = Field(default_factory=GMCBBBResult)
    admet_regression: ADMETRegressionResult = Field(default_factory=ADMETRegressionResult)
    admet_family_status: dict[str, str] = Field(default_factory=dict)

    @field_validator("admet_predictions")
    @classmethod
    def validate_frozen_endpoint_set(
        cls, value: dict[str, ADMETEndpointPrediction]
    ) -> dict[str, ADMETEndpointPrediction]:
        if set(value) != ADMET_ENDPOINT_NAMES:
            raise ValueError("ADMET classification must contain the frozen 9-endpoint set")
        return value


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
    enable_target_reference_discovery: bool = False
    target_name: str = ""
    target_gene_symbol: str = ""
    target_uniprot_id: str = ""
    target_chembl_id: str = ""
    pdb_id: str = ""
    organism: str = ""
    disease_context: str = ""
    mechanism_context: str = ""
    docking_protocol_notes: str = ""
    binding_site_notes: str = ""


class JobResponse(BaseModel):
    job_id: str
    upload_id: str
    status: JobStatus
    stage: JobStage = "queued"
    input_file: str
    output_file: str
    created_at: str
    started_at: str | None = None
    completed_at: str | None = None
    error_message: str = ""
    row_count: int = 0
    submitted_count: int = 0
    valid_count: int | None = None
    invalid_count: int | None = None
    duplicate_count: int | None = None
    processed_count: int = 0
    total_count: int = 0
    admet_success_count: int = 0
    admet_failure_count: int = 0
    docking_success_count: int = 0
    docking_failure_count: int = 0
    warning_count: int = 0
    cancellation_requested: bool = False


class ResultResponse(BaseModel):
    job_id: str
    status: JobStatus
    stage: JobStage = "completed"
    input_file: str
    output_file: str
    created_at: str
    started_at: str | None = None
    completed_at: str | None = None
    error_message: str = ""
    row_count: int
    submitted_count: int = 0
    valid_count: int | None = None
    invalid_count: int | None = None
    duplicate_count: int | None = None
    processed_count: int = 0
    total_count: int = 0
    admet_success_count: int = 0
    admet_failure_count: int = 0
    docking_success_count: int = 0
    docking_failure_count: int = 0
    warning_count: int = 0
    cancellation_requested: bool = False
    results: list[MoleculeAnalysisResult]
    target_references: dict[str, Any] | None = None


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


class CandidateSdfExportRequest(BaseModel):
    candidates: list[dict[str, Any]]


class SourceStatusResponse(BaseModel):
    model_manifest: dict[str, Any]
    public_data_manifest: dict[str, Any]
    run_manifest: dict[str, Any]
