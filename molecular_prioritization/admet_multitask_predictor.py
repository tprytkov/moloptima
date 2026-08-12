"""Offline inference adapter for the frozen MolOptima 10-head ADMET model."""

from __future__ import annotations

import argparse
import json
import math
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable, Mapping


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BUNDLE_DIR = (
    PROJECT_ROOT / "app_data" / "model_cache" / "moloptima_admet_classifier_v1"
)
MAX_SEQUENCE_LENGTH = 128
PREDICTION_THRESHOLD = 0.5

REQUIRED_BUNDLE_FILES = (
    Path("model/multitask_model_config.json"),
    Path("model/encoder_config/config.json"),
    Path("model/model_state.pt"),
    Path("tokenizer/tokenizer.json"),
    Path("tokenizer/tokenizer_config.json"),
    Path("calibration/calibration_parameters.json"),
    Path("endpoint_metadata.json"),
)

EVIDENCE_WARNINGS = {
    "hia_hou": "Limited support; identity calibration is used for this endpoint.",
    "bbb_martins": "Experimental, low-confidence evidence; interpret cautiously.",
}

FROZEN_ENDPOINT_DEFINITIONS = {
    "hia_hou": ("HIA", "favorable intestinal absorption", "limited_support"),
    "pgp_broccatelli": ("P-gp inhibition", "P-gp inhibition liability", "moderate"),
    "bbb_martins": ("BBB", "BBB-permeable class", "experimental_low_confidence"),
    "cyp1a2_veith": ("CYP1A2 inhibition", "inhibition liability", "strong"),
    "cyp2c19_veith": ("CYP2C19 inhibition", "inhibition liability", "strong"),
    "cyp2c9_veith": ("CYP2C9 inhibition", "inhibition liability", "strong_ranking"),
    "cyp2d6_veith": ("CYP2D6 inhibition", "inhibition liability", "strong_ranking"),
    "cyp3a4_veith": ("CYP3A4 inhibition", "inhibition liability", "strong"),
    "herg_karim": ("hERG liability", "hERG liability", "moderate_good"),
    "ames": ("AMES mutagenicity", "mutagenicity liability", "moderate"),
}


class ADMETBundleError(RuntimeError):
    """Raised when the frozen local model bundle cannot be validated or loaded."""


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ADMETBundleError(f"Could not read valid JSON from local bundle file: {path}") from exc
    if not isinstance(value, dict):
        raise ADMETBundleError(f"Expected a JSON object in local bundle file: {path}")
    return value


def validate_bundle(bundle_dir: str | Path) -> Path:
    """Validate all files needed for strictly offline inference before loading."""

    bundle = Path(bundle_dir).expanduser().resolve()
    missing = [str(path) for path in REQUIRED_BUNDLE_FILES if not (bundle / path).is_file()]
    if missing:
        raise ADMETBundleError(
            f"Incomplete ADMET model bundle at {bundle}; missing required files: "
            + ", ".join(missing)
        )
    return bundle


def _validate_configuration(
    model_config: Mapping[str, Any],
    encoder_config: Mapping[str, Any],
    calibration: Mapping[str, Any],
    metadata: Mapping[str, Any],
) -> tuple[str, ...]:
    tasks = tuple(model_config.get("tasks", ()))
    if len(tasks) != 10 or len(set(tasks)) != 10:
        raise ADMETBundleError("The multitask configuration must contain 10 unique tasks.")
    expected_architecture = {
        "pooling": "masked_mean",
        "dropout": 0.15,
        "head_type": "linear",
        "head_output_size": 1,
    }
    for key, expected in expected_architecture.items():
        if model_config.get(key) != expected:
            raise ADMETBundleError(
                f"Unsupported frozen architecture setting {key}={model_config.get(key)!r}; "
                f"expected {expected!r}."
            )
    if encoder_config.get("model_type") != "roberta":
        raise ADMETBundleError("The frozen encoder configuration must use model_type 'roberta'.")
    if not isinstance(encoder_config.get("hidden_size"), int):
        raise ADMETBundleError("The encoder configuration must define an integer hidden_size.")
    if tuple(calibration.get("endpoint_order", ())) != tasks:
        raise ADMETBundleError("Calibration endpoint order does not match the model task order.")
    if tuple(metadata.get("endpoint_order", ())) != tasks:
        raise ADMETBundleError("Endpoint metadata order does not match the model task order.")

    calibration_endpoints = calibration.get("endpoints", {})
    metadata_endpoints = metadata.get("endpoints", {})
    required_evidence = {
        "hia_hou": "limited_support",
        "bbb_martins": "experimental_low_confidence",
    }
    for task in tasks:
        if task not in calibration_endpoints or task not in metadata_endpoints:
            raise ADMETBundleError(f"Missing calibration or endpoint metadata for {task}.")
        endpoint_metadata = metadata_endpoints[task]
        if not all(
            endpoint_metadata.get(field)
            for field in ("display_name", "positive_class", "evidence_status", "calibration")
        ):
            raise ADMETBundleError(f"Incomplete endpoint metadata for {task}.")
        if task in required_evidence and endpoint_metadata["evidence_status"] != required_evidence[task]:
            raise ADMETBundleError(
                f"Frozen evidence annotation for {task} must be {required_evidence[task]!r}."
            )
        if task == "hia_hou":
            if endpoint_metadata["calibration"] != "identity":
                raise ADMETBundleError("HIA must use identity calibration.")
        else:
            parameters = calibration_endpoints[task]
            if endpoint_metadata["calibration"] != "platt":
                raise ADMETBundleError(f"{task} must use frozen Platt calibration.")
            if not all(
                isinstance(parameters.get(field), (int, float))
                for field in ("coefficient_a", "intercept_b")
            ):
                raise ADMETBundleError(f"Missing frozen Platt parameters for {task}.")
    return tasks


def _build_model(encoder_config_dir: Path, tasks: tuple[str, ...], dropout: float):
    """Build the exact shared-encoder, masked-mean, independent-head architecture."""

    try:
        import torch
        from torch import nn
        from transformers import AutoConfig, AutoModel
    except ImportError as exc:
        raise ADMETBundleError("ADMET inference requires installed torch and transformers.") from exc

    config = AutoConfig.from_pretrained(str(encoder_config_dir), local_files_only=True)

    class FrozenMultitaskClassifier(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.encoder = AutoModel.from_config(config)
            self.dropout = nn.Dropout(dropout)
            self.heads = nn.ModuleDict(
                {task: nn.Linear(config.hidden_size, 1) for task in tasks}
            )

        def forward(self, input_ids, attention_mask, **encoder_inputs):
            encoded = self.encoder(
                input_ids=input_ids,
                attention_mask=attention_mask,
                **encoder_inputs,
            ).last_hidden_state
            mask = attention_mask.unsqueeze(-1).to(dtype=encoded.dtype)
            pooled = (encoded * mask).sum(dim=1) / mask.sum(dim=1).clamp_min(1.0)
            pooled = self.dropout(pooled)
            return {task: head(pooled).squeeze(-1) for task, head in self.heads.items()}

    return FrozenMultitaskClassifier()


def _load_tokenizer(tokenizer_dir: Path):
    try:
        from transformers import AutoTokenizer
    except ImportError as exc:
        raise ADMETBundleError("ADMET inference requires installed transformers.") from exc
    return AutoTokenizer.from_pretrained(str(tokenizer_dir), local_files_only=True)


class OfflineADMETMultitaskPredictor:
    """CPU-only adapter for one validated, frozen local model bundle."""

    def __init__(self, bundle_dir: str | Path = DEFAULT_BUNDLE_DIR) -> None:
        self.bundle_dir = validate_bundle(bundle_dir)
        model_config_path = self.bundle_dir / "model" / "multitask_model_config.json"
        encoder_config_path = self.bundle_dir / "model" / "encoder_config" / "config.json"
        calibration_path = self.bundle_dir / "calibration" / "calibration_parameters.json"
        metadata_path = self.bundle_dir / "endpoint_metadata.json"

        self.model_config = _read_json(model_config_path)
        self.encoder_config = _read_json(encoder_config_path)
        self.calibration = _read_json(calibration_path)
        self.metadata = _read_json(metadata_path)
        self.tasks = _validate_configuration(
            self.model_config, self.encoder_config, self.calibration, self.metadata
        )

        try:
            import torch
        except ImportError as exc:
            raise ADMETBundleError("ADMET inference requires installed torch.") from exc

        self._torch = torch
        self.device = torch.device("cpu")
        self.tokenizer = _load_tokenizer(self.bundle_dir / "tokenizer")
        self.model = _build_model(
            encoder_config_path.parent,
            self.tasks,
            float(self.model_config["dropout"]),
        ).to(self.device)
        try:
            state = torch.load(
                self.bundle_dir / "model" / "model_state.pt",
                map_location=self.device,
                weights_only=True,
            )
            self.model.load_state_dict(state, strict=True)
        except Exception as exc:
            raise ADMETBundleError("Strict loading of the frozen model state failed.") from exc
        self.model.eval()

    def _unavailable_endpoint(self, task: str) -> dict[str, Any]:
        endpoint = self.metadata["endpoints"][task]
        return {
            "raw_logit": None,
            "raw_probability": None,
            "calibrated_probability": None,
            "binary_prediction": None,
            "display_name": endpoint["display_name"],
            "positive_class_meaning": endpoint["positive_class"],
            "evidence_status": endpoint["evidence_status"],
            "warning": "Prediction not run because the SMILES is invalid.",
        }

    def _endpoint_prediction(self, task: str, raw_logit: float) -> dict[str, Any]:
        endpoint = self.metadata["endpoints"][task]
        raw_probability = _sigmoid(raw_logit)
        if task == "hia_hou":
            calibrated_probability = raw_probability
        else:
            parameters = self.calibration["endpoints"][task]
            calibrated_probability = _sigmoid(
                float(parameters["coefficient_a"]) * raw_logit
                + float(parameters["intercept_b"])
            )
        return {
            "raw_logit": raw_logit,
            "raw_probability": raw_probability,
            "calibrated_probability": calibrated_probability,
            "binary_prediction": int(calibrated_probability >= PREDICTION_THRESHOLD),
            "display_name": endpoint["display_name"],
            "positive_class_meaning": endpoint["positive_class"],
            "evidence_status": endpoint["evidence_status"],
            "warning": EVIDENCE_WARNINGS.get(task, ""),
        }

    def predict(self, smiles: str | None) -> dict[str, Any]:
        """Predict all endpoints for one SMILES, returning a not-run record if invalid."""

        return self.predict_batch([smiles])[0]

    def predict_batch(self, smiles_values: Iterable[str | None]) -> list[dict[str, Any]]:
        """Predict a batch while isolating invalid SMILES from valid rows."""

        values = list(smiles_values)
        valid_positions: list[int] = []
        valid_smiles: list[str] = []
        results: list[dict[str, Any]] = []
        for index, smiles in enumerate(values):
            if _is_valid_smiles(smiles):
                valid_positions.append(index)
                valid_smiles.append(smiles.strip())
                results.append({})
            else:
                results.append(
                    {
                        "smiles": smiles,
                        "prediction_status": "not_run",
                        "endpoints": {
                            task: self._unavailable_endpoint(task) for task in self.tasks
                        },
                    }
                )

        if valid_smiles:
            encoded = self.tokenizer(
                valid_smiles,
                padding=True,
                truncation=True,
                max_length=MAX_SEQUENCE_LENGTH,
                return_tensors="pt",
            )
            encoded = {key: value.to(self.device) for key, value in encoded.items()}
            with self._torch.inference_mode():
                logits_by_task = self.model(**encoded)
            for batch_index, result_index in enumerate(valid_positions):
                results[result_index] = {
                    "smiles": values[result_index],
                    "prediction_status": "available",
                    "endpoints": {
                        task: self._endpoint_prediction(
                            task, float(logits_by_task[task][batch_index].item())
                        )
                        for task in self.tasks
                    },
                }
        return results


def _is_valid_smiles(smiles: str | None) -> bool:
    if not isinstance(smiles, str) or not smiles.strip():
        return False
    try:
        from rdkit import Chem
    except ImportError as exc:
        raise ADMETBundleError("SMILES validation requires installed RDKit.") from exc
    return Chem.MolFromSmiles(smiles.strip()) is not None


def _sigmoid(value: float) -> float:
    if value >= 0:
        return 1.0 / (1.0 + math.exp(-value))
    exponential = math.exp(value)
    return exponential / (1.0 + exponential)


def unavailable_admet_prediction(
    smiles: str | None,
    *,
    prediction_status: str,
    warning: str,
) -> dict[str, Any]:
    """Return the complete frozen endpoint schema when inference cannot run."""

    return {
        "smiles": smiles,
        "prediction_status": prediction_status,
        "endpoints": {
            task: {
                "raw_logit": None,
                "raw_probability": None,
                "calibrated_probability": None,
                "binary_prediction": None,
                "display_name": display_name,
                "positive_class_meaning": positive_class,
                "evidence_status": evidence_status,
                "warning": warning,
            }
            for task, (display_name, positive_class, evidence_status) in (
                FROZEN_ENDPOINT_DEFINITIONS.items()
            )
        },
    }


@lru_cache(maxsize=1)
def _cached_predictor(bundle_dir: str) -> OfflineADMETMultitaskPredictor:
    return OfflineADMETMultitaskPredictor(bundle_dir)


def load_admet_multitask_predictor(
    bundle_dir: str | Path = DEFAULT_BUNDLE_DIR,
) -> OfflineADMETMultitaskPredictor:
    """Return the process-cached offline predictor for the local bundle."""

    return _cached_predictor(str(Path(bundle_dir).expanduser().resolve()))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("smiles", help="SMILES string to classify")
    parser.add_argument(
        "--bundle",
        type=Path,
        default=DEFAULT_BUNDLE_DIR,
        help="Path to the complete local frozen model bundle",
    )
    args = parser.parse_args(argv)
    prediction = load_admet_multitask_predictor(args.bundle).predict(args.smiles)
    print(json.dumps(prediction, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
