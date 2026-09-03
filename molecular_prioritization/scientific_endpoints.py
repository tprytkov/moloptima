"""Typed scientific endpoint metadata for future profile-driven prioritization.

This registry describes identities and output conventions only.  It does not load
models, run inference, transform predictions, or alter the public ADMET contract.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Iterable, Literal, Mapping


ValueType = Literal["probability", "continuous", "boolean", "categorical"]
SemanticDirection = Literal[
    "higher_favorable",
    "lower_favorable",
    "target_range",
    "context_dependent",
    "liability",
    "neutral",
]
PublicStatus = Literal["public", "internal", "deprecated"]

VALUE_TYPES = frozenset({"probability", "continuous", "boolean", "categorical"})
SEMANTIC_DIRECTIONS = frozenset({
    "higher_favorable", "lower_favorable", "target_range",
    "context_dependent", "liability", "neutral",
})
PUBLIC_STATUSES = frozenset({"public", "internal", "deprecated"})


@dataclass(frozen=True)
class EndpointDefinition:
    endpoint_id: str
    model_family: str
    value_type: ValueType
    units: str | None
    semantic_direction: SemanticDirection
    uncertainty_field: str | None
    public_status: PublicStatus
    description: str

    def __post_init__(self) -> None:
        if not self.endpoint_id.strip() or not self.model_family.strip():
            raise ValueError("Endpoint definitions require endpoint_id and model_family.")
        if self.value_type not in VALUE_TYPES:
            raise ValueError(f"Unknown endpoint value_type: {self.value_type}")
        if self.semantic_direction not in SEMANTIC_DIRECTIONS:
            raise ValueError(f"Unknown endpoint semantic_direction: {self.semantic_direction}")
        if self.public_status not in PUBLIC_STATUSES:
            raise ValueError(f"Unknown endpoint public_status: {self.public_status}")
        if not self.description.strip():
            raise ValueError("Endpoint definitions require a description.")

    def to_dict(self) -> dict[str, object]:
        return asdict(self)

    @classmethod
    def from_dict(cls, values: Mapping[str, object]) -> "EndpointDefinition":
        return cls(**dict(values))


class ScientificEndpointRegistry:
    """Immutable-by-convention identity lookup, separate from ADMET inference orchestration."""

    def __init__(self, definitions: Iterable[EndpointDefinition]) -> None:
        items = tuple(definitions)
        by_id = {item.endpoint_id: item for item in items}
        if len(by_id) != len(items):
            raise ValueError("Scientific endpoint IDs must be unique.")
        self._definitions = by_id

    def get(self, endpoint_id: str) -> EndpointDefinition:
        try:
            return self._definitions[endpoint_id]
        except KeyError as exc:
            raise ValueError(f"Unknown scientific endpoint ID: {endpoint_id}") from exc

    def contains(self, endpoint_id: str) -> bool:
        return endpoint_id in self._definitions

    def endpoint_ids(self, *, public_only: bool = False) -> tuple[str, ...]:
        return tuple(sorted(
            endpoint_id
            for endpoint_id, definition in self._definitions.items()
            if not public_only or definition.public_status == "public"
        ))

    def definitions(self, *, public_only: bool = False) -> tuple[EndpointDefinition, ...]:
        return tuple(self.get(endpoint_id) for endpoint_id in self.endpoint_ids(public_only=public_only))


def _classification(endpoint_id: str, direction: SemanticDirection, description: str) -> EndpointDefinition:
    return EndpointDefinition(
        endpoint_id=endpoint_id,
        model_family="chemberta",
        value_type="probability",
        units="probability",
        semantic_direction=direction,
        uncertainty_field=None,
        public_status="public",
        description=description,
    )


PRODUCTION_ENDPOINT_DEFINITIONS = (
    _classification("hia_hou", "higher_favorable", "Human intestinal absorption classifier probability."),
    _classification("pgp_broccatelli", "context_dependent", "P-glycoprotein classifier probability; scoring direction is profile-dependent."),
    _classification("cyp1a2_veith", "liability", "CYP1A2 inhibition classifier probability."),
    _classification("cyp2c19_veith", "liability", "CYP2C19 inhibition classifier probability."),
    _classification("cyp2c9_veith", "liability", "CYP2C9 inhibition classifier probability."),
    _classification("cyp2d6_veith", "liability", "CYP2D6 inhibition classifier probability."),
    _classification("cyp3a4_veith", "liability", "CYP3A4 inhibition classifier probability."),
    _classification("herg_karim", "liability", "hERG liability classifier probability."),
    _classification("ames", "liability", "AMES mutagenicity classifier probability."),
    EndpointDefinition(
        endpoint_id="gmc_mpnn_bbb", model_family="gmc_mpnn_bbb",
        value_type="probability", units="raw ensemble probability",
        semantic_direction="context_dependent",
        uncertainty_field="ensemble_standard_deviation", public_status="public",
        description=(
            "Five-seed unweighted GMC-MPNN BBB ensemble probability. The threshold is "
            "provisional_raw and calibration is not_frozen."
        ),
    ),
    EndpointDefinition(
        endpoint_id="Caco2_Wang", model_family="chemprop_regression",
        value_type="continuous", units="log10(Papp [cm/s])",
        semantic_direction="context_dependent",
        uncertainty_field="seed_standard_deviation_log10_papp_cm_per_s",
        public_status="public",
        description="Caco-2 permeability ensemble output in the stored log10 Papp cm/s representation.",
    ),
    EndpointDefinition(
        endpoint_id="Lipophilicity_AstraZeneca", model_family="chemprop_regression",
        value_type="continuous", units="log ratio",
        semantic_direction="target_range",
        uncertainty_field="seed_standard_deviation_log_ratio", public_status="public",
        description="AstraZeneca lipophilicity ensemble output in the frozen log-ratio representation.",
    ),
    EndpointDefinition(
        endpoint_id="Solubility_AqSolDB", model_family="chemprop_regression",
        value_type="continuous", units="log10(mol/L)",
        semantic_direction="context_dependent",
        uncertainty_field="seed_standard_deviation_log_mol_per_l", public_status="public",
        description="AqSolDB solubility ensemble output in the frozen log mol/L representation.",
    ),
    EndpointDefinition(
        endpoint_id="PPBR_AZ", model_family="chemprop_regression",
        value_type="continuous", units="percent bound",
        semantic_direction="context_dependent",
        uncertainty_field="seed_standard_deviation_percent_bound", public_status="public",
        description="AstraZeneca plasma-protein binding percentage; public values are not clipped.",
    ),
    EndpointDefinition(
        endpoint_id="Vdss_Lombardo", model_family="chemprop_regression",
        value_type="continuous", units="L/kg",
        semantic_direction="context_dependent",
        uncertainty_field="seed_standard_deviation_l_per_kg", public_status="public",
        description="Lombardo volume of distribution public value after the frozen inverse transform.",
    ),
    EndpointDefinition(
        endpoint_id="QED", model_family="rdkit_descriptor", value_type="continuous",
        units="unitless [0,1]", semantic_direction="higher_favorable",
        uncertainty_field=None, public_status="public",
        description="RDKit quantitative estimate of drug-likeness available in the descriptor contract.",
    ),
    EndpointDefinition(
        endpoint_id="SA", model_family="heuristic_synthetic_accessibility",
        value_type="continuous", units="heuristic score [1,10]",
        semantic_direction="lower_favorable", uncertainty_field=None,
        public_status="public",
        description="Current heuristic synthetic-accessibility score exposed as sa_score.",
    ),
    EndpointDefinition(
        endpoint_id="structural_alerts", model_family="rdkit_filter_catalog",
        value_type="continuous", units="alert count",
        semantic_direction="liability", uncertainty_field=None,
        public_status="public",
        description="Count and context of current PAINS/Brenk structural-alert screening results.",
    ),
    EndpointDefinition(
        endpoint_id="best_vina_affinity_kcal_mol", model_family="vina",
        value_type="continuous", units="kcal/mol",
        semantic_direction="lower_favorable", uncertainty_field=None,
        public_status="public",
        description=(
            "Minimum finite affinity across returned Vina modes; a protocol-dependent "
            "screening score, not binding free energy."
        ),
    ),
)

SCIENTIFIC_ENDPOINTS = ScientificEndpointRegistry(PRODUCTION_ENDPOINT_DEFINITIONS)
PUBLIC_SCIENTIFIC_ENDPOINT_IDS = SCIENTIFIC_ENDPOINTS.endpoint_ids(public_only=True)

