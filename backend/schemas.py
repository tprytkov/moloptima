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


class PrioritizationComponent(BaseModel):
    model_config = ConfigDict(extra="allow")

    raw_value: Any = None
    normalized_value: float | None = None
    contribution: float | None = None
    weight_or_rule: Any = None
    status: str
    reason: str
    score_scope: str = "priority_score"


class ScientificPrioritizationResult(BaseModel):
    model_config = ConfigDict(extra="allow")

    status: str = "not_available_legacy_result"
    priority_score: float | None = None
    ranking_score: float | None = None
    ranking_position: int | None = None
    rank_eligible: bool = False
    ranking_basis: str | None = None
    components: dict[str, PrioritizationComponent] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    ranking_version: str = "unversioned_legacy_result"


class MoleculeAnalysisResult(BaseModel):
    model_config = ConfigDict(extra="allow")

    admet_model_status: str
    admet_warning: str
    admet_predictions: dict[str, ADMETEndpointPrediction]
    bbb_result: GMCBBBResult = Field(default_factory=GMCBBBResult)
    admet_regression: ADMETRegressionResult = Field(default_factory=ADMETRegressionResult)
    admet_family_status: dict[str, str] = Field(default_factory=dict)
    docking_result: dict[str, Any] = Field(default_factory=dict)
    prioritization: ScientificPrioritizationResult = Field(default_factory=ScientificPrioritizationResult)
    prioritization_method: Literal["legacy_v1", "profile_v2"] = "legacy_v1"
    v2_score: float | None = None
    v2_rank_eligible: bool | None = None
    v2_rank: int | None = None
    prioritization_v2: dict[str, Any] | None = None

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
    model_config = ConfigDict(extra="allow")

    upload_id: str
    status: str = "uploaded"
    filename: str
    rows: int
    path: str
    submitted_count: int = 0
    valid_count: int = 0
    invalid_count: int = 0
    unresolved_pdb_count: int = 0
    duplicate_count: int = 0
    files_found: int = 0
    invalid_file_count: int = 0
    multi_record_sdf_count: int = 0
    ignored_file_count: int = 0
    ignored_files: list[str] = Field(default_factory=list)
    analysis_mode: Literal["single_compound", "library", "unavailable"] = "unavailable"
    analysis_mode_label: str = "Not available"
    preview: list[dict[str, Any]] = Field(default_factory=list)


class ImportJobCreateRequest(BaseModel):
    expected_file_count: int = Field(ge=0)
    smiles_text: str = ""
    selected_structure_column: str = ""


class ImportJobResponse(BaseModel):
    import_job_id: str
    status: Literal["pending"] = "pending"
    expected_file_count: int = 0
    processed_file_count: int = 0
    parsed_record_count: int = 0
    batch_count: int = 0


class ImportBatchResponse(ImportJobResponse):
    batch_index: int
    batch_file_count: int
    batch_submitted_count: int
    batch_valid_count: int
    batch_invalid_count: int


class ReceptorUploadResponse(BaseModel):
    receptor_upload_id: str
    status: str = "uploaded"
    filename: str
    receptor_id: str
    prepared_receptor_sha256: str
    size_bytes: int


class DockingReceptorResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    receptor_id: str
    display_name: str
    original_filename: str
    created_at: str
    source_receptor_sha256: str | None = None
    docking_receptor_sha256: str | None = None
    preparation_method: str
    preparation_tool: str | None = None
    preparation_tool_version: str | None = None
    preparation_warnings: list[str] = Field(default_factory=list)
    bound_ligands: list[dict[str, Any]] = Field(default_factory=list)
    docking_ready: bool = False
    visualization_available: bool = True


class ReceptorPreparationRequest(BaseModel):
    selected_chains: list[str] = Field(..., min_length=1)
    water_policy: Literal["remove_all"]
    hetero_choices: dict[str, bool] = Field(default_factory=dict)
    altloc_choices: dict[str, str] = Field(default_factory=dict)
    bound_ligand_id: str = Field(default="", max_length=200)


class ReceptorPreparationRuntimeResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    status: Literal["available", "unavailable"]
    available: bool
    tool: str
    version: str | None = None
    interface: str
    reason: str = ""


class DockingConfigurationRequest(BaseModel):
    receptor_id: str = Field(..., min_length=32, max_length=32)
    center_method: Literal["bound_ligand", "atom_or_residue", "manual"]
    selected_ligand_id: str = ""
    center_x: float | None = None
    center_y: float | None = None
    center_z: float | None = None
    size_x: float
    size_y: float
    size_z: float
    exhaustiveness: int = Field(default=8, gt=0)
    num_modes: int = Field(default=9, gt=0)
    energy_range: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    seed: int = 2025
    worker_count: int = Field(default=4, gt=0)


class DockingConfigurationResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    configuration_id: str
    receptor_id: str
    center_method: str
    center_x: float
    center_y: float
    center_z: float
    size_x: float
    size_y: float
    size_z: float
    exhaustiveness: int
    num_modes: int
    energy_range: float | None = None
    seed: int
    worker_count: int
    cpu: Literal[1] = 1
    approved: bool
    created_at: str


class PrioritizationRequest(BaseModel):
    upload_id: str = Field(..., min_length=1)
    prioritization_method: Literal["legacy_v1", "v2"] = "legacy_v1"
    prioritization_profile: dict[str, Any] | None = None
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
    enable_docking: bool = True
    receptor_upload_id: str = Field(default="", max_length=64)
    receptor_id: str = Field(default="", max_length=200)
    docking_configuration_id: str = Field(default="", max_length=32)
    docking_center_x: float | None = None
    docking_center_y: float | None = None
    docking_center_z: float | None = None
    docking_size_x: float | None = None
    docking_size_y: float | None = None
    docking_size_z: float | None = None
    docking_exhaustiveness: int | None = None
    docking_num_modes: int | None = None
    docking_energy_range: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    docking_seed: int | None = None
    docking_worker_count: int | None = None


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
    admet_runtime_identities: list[dict[str, Any]] = Field(default_factory=list)
    docking_success_count: int = 0
    docking_failure_count: int = 0
    eligible_count: int = 0
    fully_scored_count: int = 0
    partially_scored_count: int = 0
    unscorable_count: int = 0
    ranked_count: int = 0
    eligible_for_ranking_count: int = 0
    awaiting_or_missing_docking_count: int = 0
    docking_failed_or_unavailable_count: int = 0
    warning_count: int = 0
    cancellation_requested: bool = False
    prioritization_method: Literal["legacy_v1", "v2"] = "legacy_v1"
    prioritization_profile_sha256: str | None = None
    prioritization_profile: dict[str, Any] | None = None
    receptor_source: str | None = None
    prepared_receptor_sha256: str | None = None
    analysis_mode: Literal["single_compound", "library"] = "library"


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
    admet_runtime_identities: list[dict[str, Any]] = Field(default_factory=list)
    docking_success_count: int = 0
    docking_failure_count: int = 0
    eligible_count: int = 0
    fully_scored_count: int = 0
    partially_scored_count: int = 0
    unscorable_count: int = 0
    ranked_count: int = 0
    eligible_for_ranking_count: int = 0
    awaiting_or_missing_docking_count: int = 0
    docking_failed_or_unavailable_count: int = 0
    warning_count: int = 0
    cancellation_requested: bool = False
    prioritization_method: Literal["legacy_v1", "v2"] = "legacy_v1"
    prioritization_profile_sha256: str | None = None
    prioritization_profile: dict[str, Any] | None = None
    receptor_source: str | None = None
    prepared_receptor_sha256: str | None = None
    analysis_mode: Literal["single_compound", "library"] = "library"
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


class ScientificRuntimeStatusResponse(BaseModel):
    checked_at: str
    status_source: str
    inference_performed: bool
    qualification_state: Literal["checking", "complete"] = "complete"
    refreshing: bool = False
    generation: int = 0
    probe_timings_seconds: dict[str, float] = Field(default_factory=dict)
    components: dict[str, dict[str, Any]]


class PrioritizationProfileValidationRequest(BaseModel):
    profile: dict[str, Any]


class PrioritizationProfileValidationResponse(BaseModel):
    structurally_valid: bool
    scoreable: bool
    profile_sha256: str | None = None
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    profile: dict[str, Any] | None = None


class PrioritizationMetadataResponse(BaseModel):
    endpoints: list[dict[str, Any]]
    builtin_profiles: list[dict[str, Any]] = Field(default_factory=list)
    profile_options: dict[str, Any]


class ParetoAnalysisRequest(BaseModel):
    job_id: str | None = None
    results: list[dict[str, Any]] = Field(..., min_length=1, max_length=1000)
    dimensions: list[Literal["docking", "admet", "molecular_quality", "safety"]] = Field(
        ..., min_length=1, max_length=4
    )


class ParetoAnalysisResponse(BaseModel):
    analysis_version: str
    explanatory_only: bool
    dimensions_used: list[str]
    rank_eligible_molecule_count: int
    excluded_unrankable_count: int
    results: list[dict[str, Any]]


class SensitivityAnalysisRequest(BaseModel):
    job_id: str | None = None
    candidates: list[dict[str, Any]] = Field(..., min_length=1, max_length=1000)
    profile: dict[str, Any]
    perturbation_magnitude: float = Field(..., ge=0, le=1, allow_inf_nan=False)
    number_of_samples: int = Field(..., ge=1, le=1000)
    analysis_seed: int


class SensitivityAnalysisResponse(BaseModel):
    analysis_version: str
    explanatory_only: bool
    provenance: dict[str, Any]
    rank_eligible_molecule_count: int
    results: list[dict[str, Any]]
    excluded_unrankable: list[dict[str, Any]]
    perturbed_configurations: list[dict[str, Any]]
