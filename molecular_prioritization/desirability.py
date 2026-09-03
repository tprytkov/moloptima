"""Pure, endpoint-agnostic desirability transforms for Prioritization v2 profiles."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal, Mapping


TransformType = Literal[
    "increasing_sigmoid",
    "decreasing_sigmoid",
    "target_range",
    "minimum_plateau",
    "threshold",
    "categorical_map",
    "identity_01",
    "reverse_identity_01",
]
TRANSFORM_TYPES = frozenset({
    "increasing_sigmoid", "decreasing_sigmoid", "target_range",
    "minimum_plateau", "threshold", "categorical_map", "identity_01",
    "reverse_identity_01",
})
TRANSFORM_PARAMETER_SCHEMAS: dict[str, tuple[dict[str, object], ...]] = {
    "increasing_sigmoid": (
        {"name": "midpoint", "type": "number"},
        {"name": "slope", "type": "number", "exclusive_minimum": 0},
    ),
    "decreasing_sigmoid": (
        {"name": "midpoint", "type": "number"},
        {"name": "slope", "type": "number", "exclusive_minimum": 0},
    ),
    "target_range": (
        {"name": "lower", "type": "number"},
        {"name": "upper", "type": "number"},
        {"name": "lower_width", "type": "number", "exclusive_minimum": 0},
        {"name": "upper_width", "type": "number", "exclusive_minimum": 0},
    ),
    "minimum_plateau": (
        {"name": "minimum", "type": "number"},
        {"name": "width", "type": "number", "exclusive_minimum": 0},
    ),
    "threshold": (
        {"name": "threshold", "type": "number"},
        {"name": "operator", "type": "enum", "options": ("gte", "lte")},
    ),
    "categorical_map": (
        {"name": "mapping", "type": "json_mapping"},
    ),
    "identity_01": (),
    "reverse_identity_01": (),
}


@dataclass(frozen=True)
class TransformSpec:
    type: TransformType
    params: Mapping[str, object]

    def __post_init__(self) -> None:
        if self.type not in TRANSFORM_TYPES:
            raise ValueError(f"Unknown desirability transform: {self.type}")
        if not isinstance(self.params, Mapping):
            raise ValueError("Transform params must be a mapping.")
        _reject_nonfinite_parameters(self.params)

    def to_dict(self) -> dict[str, object]:
        return {"type": self.type, "params": _copy_json_value(self.params)}

    @classmethod
    def from_dict(cls, values: Mapping[str, object]) -> "TransformSpec":
        return cls(type=str(values.get("type", "")), params=dict(values.get("params") or {}))


def validate_transform_spec(spec: TransformSpec) -> None:
    """Fail closed unless every parameter required by the transform is explicit and valid."""

    params = dict(spec.params)
    if spec.type in {"increasing_sigmoid", "decreasing_sigmoid"}:
        _require_exact_keys(params, {"midpoint", "slope"}, spec.type)
        _finite_number(params["midpoint"], "midpoint")
        if _finite_number(params["slope"], "slope") <= 0:
            raise ValueError("Sigmoid slope must be greater than zero.")
    elif spec.type == "target_range":
        _require_exact_keys(params, {"lower", "upper", "lower_width", "upper_width"}, spec.type)
        lower = _finite_number(params["lower"], "lower")
        upper = _finite_number(params["upper"], "upper")
        lower_width = _finite_number(params["lower_width"], "lower_width")
        upper_width = _finite_number(params["upper_width"], "upper_width")
        if lower >= upper:
            raise ValueError("target_range lower must be less than upper.")
        if lower_width <= 0 or upper_width <= 0:
            raise ValueError("target_range widths must be greater than zero.")
    elif spec.type == "minimum_plateau":
        _require_exact_keys(params, {"minimum", "width"}, spec.type)
        _finite_number(params["minimum"], "minimum")
        if _finite_number(params["width"], "width") <= 0:
            raise ValueError("minimum_plateau width must be greater than zero.")
    elif spec.type == "threshold":
        _require_exact_keys(params, {"threshold", "operator"}, spec.type)
        _finite_number(params["threshold"], "threshold")
        if params["operator"] not in {"gte", "lte"}:
            raise ValueError("threshold operator must be 'gte' or 'lte'.")
    elif spec.type == "categorical_map":
        _require_exact_keys(params, {"mapping"}, spec.type)
        mapping = params["mapping"]
        if not isinstance(mapping, Mapping) or not mapping:
            raise ValueError("categorical_map requires a non-empty mapping.")
        for key, value in mapping.items():
            if not isinstance(key, str):
                raise ValueError("categorical_map keys must be strings.")
            _unit_interval(value, f"categorical_map[{key!r}]")
    elif spec.type in {"identity_01", "reverse_identity_01"}:
        _require_exact_keys(params, set(), spec.type)


def apply_desirability(value: object, spec: TransformSpec) -> float:
    validate_transform_spec(spec)
    params = spec.params
    if spec.type == "categorical_map":
        if not isinstance(value, str):
            raise ValueError("categorical_map input must be a string.")
        mapping = params["mapping"]
        if value not in mapping:
            raise ValueError(f"categorical_map has no entry for {value!r}.")
        result = _unit_interval(mapping[value], f"categorical_map[{value!r}]")
    else:
        numeric = _finite_number(value, "transform input")
        if spec.type == "increasing_sigmoid":
            result = _stable_logistic(float(params["slope"]) * (numeric - float(params["midpoint"])))
        elif spec.type == "decreasing_sigmoid":
            result = _stable_logistic(-float(params["slope"]) * (numeric - float(params["midpoint"])))
        elif spec.type == "target_range":
            lower, upper = float(params["lower"]), float(params["upper"])
            if numeric < lower:
                result = 1.0 - ((lower - numeric) / float(params["lower_width"]))
            elif numeric > upper:
                result = 1.0 - ((numeric - upper) / float(params["upper_width"]))
            else:
                result = 1.0
        elif spec.type == "minimum_plateau":
            minimum, width = float(params["minimum"]), float(params["width"])
            result = 1.0 if numeric >= minimum else 1.0 - ((minimum - numeric) / width)
        elif spec.type == "threshold":
            threshold = float(params["threshold"])
            result = float(numeric >= threshold) if params["operator"] == "gte" else float(numeric <= threshold)
        elif spec.type == "identity_01":
            result = _unit_interval(numeric, "identity_01 input")
        else:
            result = 1.0 - _unit_interval(numeric, "reverse_identity_01 input")
    return _bounded_result(result)


def _stable_logistic(value: float) -> float:
    if value >= 0:
        exponential = math.exp(-value)
        return 1.0 / (1.0 + exponential)
    exponential = math.exp(value)
    return exponential / (1.0 + exponential)


def _bounded_result(value: float) -> float:
    if not math.isfinite(value):
        raise ValueError("Desirability transform produced a non-finite result.")
    return min(1.0, max(0.0, value))


def _finite_number(value: object, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ValueError(f"{label} must be numeric.")
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"{label} must be finite.")
    return result


def _unit_interval(value: object, label: str) -> float:
    result = _finite_number(value, label)
    if not 0.0 <= result <= 1.0:
        raise ValueError(f"{label} must be in [0,1].")
    return result


def _require_exact_keys(params: Mapping[str, object], expected: set[str], transform: str) -> None:
    actual = set(params)
    if actual != expected:
        missing = sorted(expected - actual)
        unexpected = sorted(actual - expected)
        raise ValueError(
            f"{transform} parameters are invalid; missing={missing}, unexpected={unexpected}."
        )


def _reject_nonfinite_parameters(value: object) -> None:
    if isinstance(value, Mapping):
        for item in value.values():
            _reject_nonfinite_parameters(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            _reject_nonfinite_parameters(item)
    elif isinstance(value, float) and not math.isfinite(value):
        raise ValueError("Transform parameters must be finite.")


def _copy_json_value(value: object) -> object:
    if isinstance(value, Mapping):
        return {str(key): _copy_json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_copy_json_value(item) for item in value]
    if value is None or isinstance(value, (str, bool, int, float)):
        return value
    raise ValueError(f"Transform parameters are not JSON-compatible: {type(value).__name__}")
