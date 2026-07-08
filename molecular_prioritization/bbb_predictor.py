"""Optional cached ChemBERTa BBB prediction wrapper."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
APP_MODEL_CACHE_DIR = PROJECT_ROOT / "app_data" / "model_cache" / "huggingface"
CHEMBERTA_BBB_MODEL_ID = "Yousuf7/ChemBERT-BBB-Permeability"
ALLOW_DOWNLOAD_ENV = "MOLOPTIMA_ALLOW_MODEL_DOWNLOAD"
MODEL_CACHE_ENV = "MOLOPTIMA_BBB_MODEL_CACHE"


@dataclass(frozen=True)
class BBBPrediction:
    """Compact BBB prediction fields for ranked output rows."""

    bbb_prediction: str
    bbb_probability: float | None
    bbb_model_status: str
    bbb_warning: str


class BBBPredictorUnavailable(RuntimeError):
    """Raised when the optional BBB model cannot be loaded."""


class CachedChembertaBBBPredictor:
    """Cached local ChemBERTa sequence classifier for BBB triage."""

    def __init__(
        self,
        *,
        model_id: str = CHEMBERTA_BBB_MODEL_ID,
        cache_dirs: list[Path] | None = None,
        allow_download: bool | None = None,
    ) -> None:
        self.model_id = model_id
        self.cache_dirs = cache_dirs or default_cache_dirs()
        self.allow_download = (
            env_flag_enabled(ALLOW_DOWNLOAD_ENV) if allow_download is None else allow_download
        )
        self.cache_dir = first_available_cache_dir(self.cache_dirs, model_id)

        if self.cache_dir is None and not self.allow_download:
            raise BBBPredictorUnavailable(
                "BBB model cache not found. Set MOLOPTIMA_BBB_MODEL_CACHE to a "
                "local Hugging Face cache root containing "
                f"{model_id}, or set {ALLOW_DOWNLOAD_ENV}=1 to allow an explicit download."
            )

        try:
            import torch
            from transformers import AutoModelForSequenceClassification, AutoTokenizer
        except ImportError as exc:
            raise BBBPredictorUnavailable(
                "BBB prediction requires installed transformers and torch packages."
            ) from exc

        active_cache_dir = self.cache_dir or self.cache_dirs[0]
        local_files_only = not self.allow_download

        try:
            self._torch = torch
            self.tokenizer = AutoTokenizer.from_pretrained(
                model_id,
                cache_dir=str(active_cache_dir),
                local_files_only=local_files_only,
            )
            self.model = AutoModelForSequenceClassification.from_pretrained(
                model_id,
                cache_dir=str(active_cache_dir),
                local_files_only=local_files_only,
            )
            self.model.eval()
        except Exception as exc:
            raise BBBPredictorUnavailable(
                f"Could not load BBB model '{model_id}' from local cache."
            ) from exc

    def predict(self, smiles: str | None, valid_molecule: bool) -> BBBPrediction:
        """Return a BBB prediction for one molecule or an invalid-row placeholder."""

        if not valid_molecule or not smiles:
            return BBBPrediction(
                bbb_prediction="unavailable",
                bbb_probability=None,
                bbb_model_status="not_run_invalid_molecule",
                bbb_warning="BBB prediction skipped for invalid molecule.",
            )

        encoded = self.tokenizer(
            [smiles],
            padding=True,
            truncation=True,
            max_length=256,
            return_tensors="pt",
        )
        with self._torch.no_grad():
            logits = self.model(**encoded).logits
            probabilities = self._torch.nn.functional.softmax(logits, dim=-1)[0]

        index = int(probabilities.argmax().item())
        probability = round(float(probabilities[index].item()), 3)
        raw_label = str(getattr(self.model.config, "id2label", {}).get(index, index)).lower()

        return BBBPrediction(
            bbb_prediction=normalize_bbb_label(raw_label),
            bbb_probability=probability,
            bbb_model_status="model_available",
            bbb_warning="",
        )


class UnavailableBBBPredictor:
    """Placeholder predictor used when the optional BBB model is unavailable."""

    def __init__(self, warning: str) -> None:
        self.warning = warning

    def predict(self, smiles: str | None, valid_molecule: bool) -> BBBPrediction:
        status = "not_run_invalid_molecule" if not valid_molecule else "model_unavailable"
        warning = (
            "BBB prediction skipped for invalid molecule."
            if not valid_molecule
            else self.warning
        )
        return BBBPrediction(
            bbb_prediction="unavailable",
            bbb_probability=None,
            bbb_model_status=status,
            bbb_warning=warning,
        )


def load_bbb_predictor() -> CachedChembertaBBBPredictor | UnavailableBBBPredictor:
    """Load the cached BBB predictor or return a placeholder wrapper."""

    try:
        return CachedChembertaBBBPredictor()
    except BBBPredictorUnavailable as exc:
        return UnavailableBBBPredictor(str(exc))


def default_cache_dirs() -> list[Path]:
    """Return local Hugging Face cache roots checked for the BBB model."""

    return [configured_cache_dir()]


def configured_cache_dir() -> Path:
    """Return the explicit or app-managed Hugging Face cache root."""

    env_cache = os.environ.get(MODEL_CACHE_ENV, "").strip()
    cache_dir = Path(env_cache).expanduser() if env_cache else APP_MODEL_CACHE_DIR
    return normalize_cache_root(cache_dir, CHEMBERTA_BBB_MODEL_ID)


def normalize_cache_root(path: Path, model_id: str) -> Path:
    """Return the Hugging Face cache root even when given a model cache folder."""

    safe_id = model_id.replace("/", "--")
    flat_id = model_id.replace("/", "_")
    if path.name in {f"models--{safe_id}", flat_id}:
        return path.parent
    return path


def first_available_cache_dir(cache_dirs: list[Path], model_id: str) -> Path | None:
    """Return the first cache root that appears to contain the model."""

    for cache_dir in cache_dirs:
        if any(path.exists() for path in cache_candidates(cache_dir, model_id)):
            return cache_dir
    return None


def cache_candidates(cache_dir: Path, model_id: str) -> list[Path]:
    safe_id = model_id.replace("/", "--")
    flat_id = model_id.replace("/", "_")
    return [
        cache_dir / f"models--{safe_id}",
        cache_dir / model_id,
        cache_dir / flat_id,
    ]


def env_flag_enabled(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "y"}


def normalize_bbb_label(raw_label: str) -> str:
    """Normalize model labels to compact output values."""

    if any(term in raw_label for term in ("non", "imperme", "negative", "false", "0")):
        return "low"
    if any(term in raw_label for term in ("perme", "positive", "true", "1")):
        return "high"
    return "uncertain"
