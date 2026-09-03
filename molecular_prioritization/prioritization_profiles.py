"""P2.1 declarative schemas, validation, and provenance for Prioritization v2.

This module intentionally contains no molecule scoring or campaign normalization.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass
from typing import Literal, Mapping

from molecular_prioritization.desirability import TransformSpec, validate_transform_spec
from molecular_prioritization.scientific_endpoints import (
    SCIENTIFIC_ENDPOINTS,
    ScientificEndpointRegistry,
)


ProfileStatus = Literal["legacy", "draft", "frozen"]
TargetMode = Literal["CNS", "peripheral", "neutral", "custom"]
EndpointRole = Literal["objective", "penalty", "gate", "display_only"]
ScientificDomain = Literal[
    "absorption",
    "distribution_cns",
    "metabolism_transport",
    "developability",
    "molecular_quality",
    "safety",
    "docking",
]
MissingPolicy = Literal[
    "renormalize_with_warning", "penalty", "unrankable", "warning_only",
]
UncertaintyPolicy = Literal[
    "warning_only", "penalty", "unrankable_above_threshold",
]

PROFILE_STATUSES = frozenset({"legacy", "draft", "frozen"})
TARGET_MODES = frozenset({"CNS", "peripheral", "neutral", "custom"})
ENDPOINT_ROLES = frozenset({"objective", "penalty", "gate", "display_only"})
SCIENTIFIC_DOMAINS = frozenset({
    "absorption", "distribution_cns", "metabolism_transport",
    "developability", "molecular_quality", "safety", "docking",
})
SCORING_COMPONENTS = frozenset({"docking", "admet", "molecular_quality"})
ADMET_SCORING_DOMAINS = frozenset({
    "absorption", "distribution_cns", "metabolism_transport", "developability",
})
MISSING_POLICIES = frozenset({
    "renormalize_with_warning", "penalty", "unrankable", "warning_only",
})
UNCERTAINTY_POLICIES = frozenset({
    "warning_only", "penalty", "unrankable_above_threshold",
})
AGGREGATIONS = frozenset({"weighted_arithmetic"})
DOCKING_NORMALIZATIONS = frozenset({"within_library"})
LIABILITY_PENALTY_AGGREGATIONS = frozenset({"domain_weighted_arithmetic"})
GATE_FAILURE_BEHAVIORS = frozenset({"exclude"})
REFERENCE_DELTA_ROLES = frozenset({"explanatory_only"})

_WINDOWS_ABSOLUTE_PATH = re.compile(r"(?i)^[A-Z]:[\\/]")
_QED_CONSTITUENT_IDS = frozenset({
    "MW", "molecular_weight", "TPSA", "tpsa", "rotatable_bonds",
    "HBD", "hbd", "HBA", "hba", "Lipinski", "lipinski",
})


@dataclass(frozen=True)
class EndpointRule:
    enabled: bool
    role: EndpointRole
    domain: ScientificDomain
    transform: TransformSpec
    weight: float
    required: bool
    missing_policy: MissingPolicy
    uncertainty_policy: UncertaintyPolicy
    notes: str | None = None
    uncertainty_transform: TransformSpec | None = None

    def __post_init__(self) -> None:
        if self.role not in ENDPOINT_ROLES:
            raise ValueError(f"Unknown endpoint role: {self.role}")
        if self.domain not in SCIENTIFIC_DOMAINS:
            raise ValueError(f"Unknown scientific domain: {self.domain}")
        if self.missing_policy not in MISSING_POLICIES:
            raise ValueError(f"Unknown missing-data policy: {self.missing_policy}")
        if self.uncertainty_policy not in UNCERTAINTY_POLICIES:
            raise ValueError(f"Unknown uncertainty policy: {self.uncertainty_policy}")
        weight = _finite_nonnegative(self.weight, "Endpoint weight")
        object.__setattr__(self, "weight", weight)
        if not isinstance(self.transform, TransformSpec):
            raise ValueError("EndpointRule transform must be a TransformSpec.")
        if self.uncertainty_transform is not None and not isinstance(
            self.uncertainty_transform, TransformSpec
        ):
            raise ValueError("EndpointRule uncertainty_transform must be a TransformSpec or None.")

    def to_dict(self) -> dict[str, object]:
        values = {
            "enabled": self.enabled,
            "role": self.role,
            "domain": self.domain,
            "transform": self.transform.to_dict(),
            "weight": self.weight,
            "required": self.required,
            "missing_policy": self.missing_policy,
            "uncertainty_policy": self.uncertainty_policy,
            "notes": self.notes,
        }
        # Preserve canonical hashes for existing P2.1 profiles that have no
        # parameterized uncertainty policy.
        if self.uncertainty_transform is not None:
            values["uncertainty_transform"] = self.uncertainty_transform.to_dict()
        return values

    @classmethod
    def from_dict(cls, values: Mapping[str, object]) -> "EndpointRule":
        transform = values.get("transform")
        uncertainty_transform = values.get("uncertainty_transform")
        return cls(
            enabled=bool(values.get("enabled")),
            role=str(values.get("role", "")),
            domain=str(values.get("domain", "")),
            transform=(
                transform if isinstance(transform, TransformSpec)
                else TransformSpec.from_dict(dict(transform or {}))
            ),
            weight=values.get("weight"),
            required=bool(values.get("required")),
            missing_policy=str(values.get("missing_policy", "")),
            uncertainty_policy=str(values.get("uncertainty_policy", "")),
            notes=None if values.get("notes") is None else str(values.get("notes")),
            uncertainty_transform=(
                None if uncertainty_transform is None
                else uncertainty_transform
                if isinstance(uncertainty_transform, TransformSpec)
                else TransformSpec.from_dict(dict(uncertainty_transform))
            ),
        )


@dataclass(frozen=True)
class LiabilityPolicy:
    penalty_aggregation: str
    gate_failure_behavior: str

    def __post_init__(self) -> None:
        if self.penalty_aggregation not in LIABILITY_PENALTY_AGGREGATIONS:
            raise ValueError(f"Unknown liability penalty policy: {self.penalty_aggregation}")
        if self.gate_failure_behavior not in GATE_FAILURE_BEHAVIORS:
            raise ValueError(f"Unknown gate-failure policy: {self.gate_failure_behavior}")

    def to_dict(self) -> dict[str, object]:
        return {
            "penalty_aggregation": self.penalty_aggregation,
            "gate_failure_behavior": self.gate_failure_behavior,
        }

    @classmethod
    def from_dict(cls, values: Mapping[str, object]) -> "LiabilityPolicy":
        return cls(
            penalty_aggregation=str(values.get("penalty_aggregation", "")),
            gate_failure_behavior=str(values.get("gate_failure_behavior", "")),
        )


@dataclass(frozen=True)
class DockingPolicy:
    normalization: str
    docking_required: bool
    campaign_id: str | None = None
    reference_molecule_id: str | None = None
    reference_best_vina_affinity_kcal_mol: float | None = None
    reference_delta_role: str = "explanatory_only"

    def __post_init__(self) -> None:
        if self.normalization not in DOCKING_NORMALIZATIONS:
            raise ValueError(f"Unknown docking normalization: {self.normalization}")
        if self.reference_delta_role not in REFERENCE_DELTA_ROLES:
            raise ValueError(f"Unknown reference-delta role: {self.reference_delta_role}")
        if self.reference_best_vina_affinity_kcal_mol is not None:
            affinity = _finite_number(
                self.reference_best_vina_affinity_kcal_mol,
                "Reference best Vina affinity",
            )
            if not (self.reference_molecule_id or "").strip():
                raise ValueError("A reference affinity requires reference_molecule_id.")
            object.__setattr__(self, "reference_best_vina_affinity_kcal_mol", affinity)

    def to_dict(self) -> dict[str, object]:
        return {
            "normalization": self.normalization,
            "docking_required": self.docking_required,
            "campaign_id": self.campaign_id,
            "reference_molecule_id": self.reference_molecule_id,
            "reference_best_vina_affinity_kcal_mol": self.reference_best_vina_affinity_kcal_mol,
            "reference_delta_role": self.reference_delta_role,
        }

    @classmethod
    def from_dict(cls, values: Mapping[str, object]) -> "DockingPolicy":
        return cls(
            normalization=str(values.get("normalization", "")),
            docking_required=bool(values.get("docking_required")),
            campaign_id=None if values.get("campaign_id") is None else str(values.get("campaign_id")),
            reference_molecule_id=(
                None if values.get("reference_molecule_id") is None
                else str(values.get("reference_molecule_id"))
            ),
            reference_best_vina_affinity_kcal_mol=values.get(
                "reference_best_vina_affinity_kcal_mol"
            ),
            reference_delta_role=str(values.get("reference_delta_role", "explanatory_only")),
        )


@dataclass(frozen=True)
class PrioritizationProfile:
    schema_version: str
    profile_id: str
    profile_version: str
    status: ProfileStatus
    name: str
    target_mode: TargetMode
    aggregation: str
    domain_weights: Mapping[str, float]
    endpoint_rules: Mapping[str, EndpointRule]
    missing_data_policy: MissingPolicy
    uncertainty_policy: UncertaintyPolicy
    liability_policy: LiabilityPolicy
    docking_policy: DockingPolicy
    component_weights: Mapping[str, float] | None = None

    def __post_init__(self) -> None:
        for label, value in (
            ("schema_version", self.schema_version),
            ("profile_id", self.profile_id),
            ("profile_version", self.profile_version),
            ("name", self.name),
        ):
            if not value.strip():
                raise ValueError(f"PrioritizationProfile {label} is required.")
        if self.status not in PROFILE_STATUSES:
            raise ValueError(f"Unknown profile status: {self.status}")
        if self.target_mode not in TARGET_MODES:
            raise ValueError(f"Unknown target mode: {self.target_mode}")
        if self.aggregation not in AGGREGATIONS:
            raise ValueError(f"Unknown profile aggregation: {self.aggregation}")
        if self.missing_data_policy not in MISSING_POLICIES:
            raise ValueError(f"Unknown profile missing-data policy: {self.missing_data_policy}")
        if self.uncertainty_policy not in UNCERTAINTY_POLICIES:
            raise ValueError(f"Unknown profile uncertainty policy: {self.uncertainty_policy}")
        normalized_weights: dict[str, float] = {}
        for domain, weight in self.domain_weights.items():
            if domain not in SCIENTIFIC_DOMAINS:
                raise ValueError(f"Unknown scientific domain: {domain}")
            normalized_weights[str(domain)] = _finite_nonnegative(weight, f"Domain weight {domain}")
        normalized_component_weights: dict[str, float] = {}
        for component, weight in (self.component_weights or {}).items():
            if component not in SCORING_COMPONENTS:
                raise ValueError(f"Unknown scoring component: {component}")
            normalized_component_weights[str(component)] = _finite_nonnegative(
                weight, f"Component weight {component}"
            )
        normalized_rules: dict[str, EndpointRule] = {}
        for endpoint_id, rule in self.endpoint_rules.items():
            if not isinstance(rule, EndpointRule):
                raise ValueError(f"Endpoint rule for {endpoint_id} must be an EndpointRule.")
            normalized_rules[str(endpoint_id)] = rule
        object.__setattr__(self, "domain_weights", normalized_weights)
        object.__setattr__(self, "component_weights", normalized_component_weights)
        object.__setattr__(self, "endpoint_rules", normalized_rules)
        if not isinstance(self.liability_policy, LiabilityPolicy):
            raise ValueError("liability_policy must be a LiabilityPolicy.")
        if not isinstance(self.docking_policy, DockingPolicy):
            raise ValueError("docking_policy must be a DockingPolicy.")

    def to_dict(self) -> dict[str, object]:
        return {
            "schema_version": self.schema_version,
            "profile_id": self.profile_id,
            "profile_version": self.profile_version,
            "status": self.status,
            "name": self.name,
            "target_mode": self.target_mode,
            "aggregation": self.aggregation,
            "component_weights": dict(self.component_weights),
            "domain_weights": dict(self.domain_weights),
            "endpoint_rules": {
                endpoint_id: rule.to_dict()
                for endpoint_id, rule in self.endpoint_rules.items()
            },
            "missing_data_policy": self.missing_data_policy,
            "uncertainty_policy": self.uncertainty_policy,
            "liability_policy": self.liability_policy.to_dict(),
            "docking_policy": self.docking_policy.to_dict(),
        }

    @classmethod
    def from_dict(cls, values: Mapping[str, object]) -> "PrioritizationProfile":
        rules = values.get("endpoint_rules") or {}
        return cls(
            schema_version=str(values.get("schema_version", "")),
            profile_id=str(values.get("profile_id", "")),
            profile_version=str(values.get("profile_version", "")),
            status=str(values.get("status", "")),
            name=str(values.get("name", "")),
            target_mode=str(values.get("target_mode", "")),
            aggregation=str(values.get("aggregation", "")),
            component_weights=dict(values.get("component_weights") or {}),
            domain_weights=dict(values.get("domain_weights") or {}),
            endpoint_rules={
                str(endpoint_id): (
                    rule if isinstance(rule, EndpointRule)
                    else EndpointRule.from_dict(dict(rule))
                )
                for endpoint_id, rule in dict(rules).items()
            },
            missing_data_policy=str(values.get("missing_data_policy", "")),
            uncertainty_policy=str(values.get("uncertainty_policy", "")),
            liability_policy=(
                values["liability_policy"]
                if isinstance(values.get("liability_policy"), LiabilityPolicy)
                else LiabilityPolicy.from_dict(dict(values.get("liability_policy") or {}))
            ),
            docking_policy=(
                values["docking_policy"]
                if isinstance(values.get("docking_policy"), DockingPolicy)
                else DockingPolicy.from_dict(dict(values.get("docking_policy") or {}))
            ),
        )

    def validate_for_scoring(
        self,
        registry: ScientificEndpointRegistry = SCIENTIFIC_ENDPOINTS,
    ) -> tuple[str, ...]:
        """Reject scientifically incomplete profiles before any future scoring call."""

        missing_components = sorted(SCORING_COMPONENTS - set(self.component_weights))
        if missing_components:
            raise ValueError(
                "A scoreable profile requires explicit component weights for "
                f"{', '.join(missing_components)}."
            )
        if not any(weight > 0 for weight in self.component_weights.values()):
            raise ValueError("A scoreable profile requires at least one positive component weight.")

        enabled_objective_weight = 0.0
        scoreable_components: set[str] = set()
        for endpoint_id, rule in self.endpoint_rules.items():
            if not registry.contains(endpoint_id):
                raise ValueError(f"Unknown scientific endpoint ID: {endpoint_id}")
            if not rule.enabled:
                continue
            validate_transform_spec(rule.transform)
            if rule.uncertainty_transform is not None:
                validate_transform_spec(rule.uncertainty_transform)
            if (
                rule.uncertainty_policy in {"penalty", "unrankable_above_threshold"}
                and rule.uncertainty_transform is None
            ):
                raise ValueError(
                    f"Endpoint {endpoint_id} uncertainty policy {rule.uncertainty_policy} "
                    "requires an explicit uncertainty_transform."
                )
            if (
                rule.uncertainty_policy == "unrankable_above_threshold"
                and rule.uncertainty_transform is not None
                and rule.uncertainty_transform.type != "threshold"
            ):
                raise ValueError(
                    f"Endpoint {endpoint_id} unrankable uncertainty policy requires a "
                    "threshold uncertainty_transform."
                )
            if rule.role == "display_only" and rule.weight != 0:
                raise ValueError(f"Display-only endpoint {endpoint_id} must have weight 0.")
            if rule.role == "objective" and rule.weight > 0:
                domain_weight = self.domain_weights.get(rule.domain)
                if domain_weight is None:
                    raise ValueError(
                        f"Enabled objective {endpoint_id} has no configured domain weight for {rule.domain}."
                    )
                if domain_weight > 0:
                    enabled_objective_weight += rule.weight * domain_weight
                    if rule.domain in ADMET_SCORING_DOMAINS:
                        scoreable_components.add("admet")
                    elif rule.domain == "molecular_quality":
                        scoreable_components.add("molecular_quality")
                    elif rule.domain == "docking":
                        scoreable_components.add("docking")
            if rule.role == "penalty" and rule.weight > 0:
                domain_weight = self.domain_weights.get(rule.domain)
                if domain_weight is None or domain_weight <= 0:
                    raise ValueError(
                        f"Enabled penalty {endpoint_id} requires a positive configured "
                        f"domain weight for {rule.domain}."
                    )
        if enabled_objective_weight <= 0:
            raise ValueError("A scoreable profile requires at least one positive objective/domain weight.")
        unavailable_components = sorted(
            component
            for component, weight in self.component_weights.items()
            if weight > 0 and component not in scoreable_components
        )
        if unavailable_components:
            raise ValueError(
                "Positive component weights require enabled objectives in: "
                f"{', '.join(unavailable_components)}."
            )
        return self.validation_warnings(registry)

    def validation_warnings(
        self,
        registry: ScientificEndpointRegistry = SCIENTIFIC_ENDPOINTS,
    ) -> tuple[str, ...]:
        del registry  # Reserved for registry-aware warnings as endpoint coverage grows.
        enabled_objectives = {
            endpoint_id
            for endpoint_id, rule in self.endpoint_rules.items()
            if rule.enabled and rule.role == "objective" and rule.weight > 0
        }
        constituents = sorted(enabled_objectives & _QED_CONSTITUENT_IDS)
        if "QED" in enabled_objectives and len(constituents) >= 3:
            return (
                "Potential molecular-quality double counting: QED and several constituent "
                f"properties are independently weighted ({', '.join(constituents)}).",
            )
        return ()


def canonical_profile_json(profile: PrioritizationProfile) -> str:
    """Serialize profile science deterministically without mutating draft or frozen objects."""

    payload = _canonical_value(profile.to_dict())
    _reject_local_absolute_paths(payload)
    return json.dumps(
        payload,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def profile_sha256(profile: PrioritizationProfile) -> str:
    return hashlib.sha256(canonical_profile_json(profile).encode("utf-8")).hexdigest()


def _canonical_value(value: object) -> object:
    if isinstance(value, Mapping):
        return {str(key): _canonical_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_canonical_value(item) for item in value]
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return value
    if isinstance(value, int | float):
        number = _finite_number(value, "Canonical profile number")
        return float(number)
    raise ValueError(f"Profile value is not JSON-compatible: {type(value).__name__}")


def _reject_local_absolute_paths(value: object) -> None:
    if isinstance(value, Mapping):
        for item in value.values():
            _reject_local_absolute_paths(item)
    elif isinstance(value, list):
        for item in value:
            _reject_local_absolute_paths(item)
    elif isinstance(value, str) and (
        _WINDOWS_ABSOLUTE_PATH.match(value) or value.startswith("/")
    ):
        raise ValueError("Profiles must not contain local absolute paths.")


def _finite_number(value: object, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ValueError(f"{label} must be numeric.")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"{label} must be finite.")
    return number


def _finite_nonnegative(value: object, label: str) -> float:
    number = _finite_number(value, label)
    if number < 0:
        raise ValueError(f"{label} must be nonnegative.")
    return number
