"""Model-independent batch interface for MolOptima's frozen ADMET families."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from molecular_prioritization.admet_multitask_predictor import load_admet_multitask_predictor
from molecular_prioritization.admet_release import ADMETReleaseError, extracted_archive, only_child_directory, resolve_release_root, verify_bundle_inventory
from molecular_prioritization.chemprop_regression_predictor import ChempropRegressionPredictor
from molecular_prioritization.gmc_bbb_predictor import GMCBBBPredictor


CLASSIFICATION_ENDPOINTS = (
    "hia_hou", "pgp_broccatelli", "cyp1a2_veith", "cyp2c19_veith", "cyp2c9_veith",
    "cyp2d6_veith", "cyp3a4_veith", "herg_karim", "ames",
)
REGRESSION_ENDPOINTS = (
    "caco2_wang", "lipophilicity_astrazeneca", "solubility_aqsoldb", "ppbr_az", "vdss_lombardo",
)
CHEMBERTA_ARCHIVE_SHA256 = "81bab8b45a278ea5fa7735a9164efa7e9e5622a00bc19ae6b12104cba5ad60a0"


@dataclass(frozen=True)
class FamilyFailure:
    status: str
    warning: str


class ADMETRegistry:
    """Load each family independently and preserve partial scientific results."""

    def __init__(
        self,
        *,
        chemberta_factory: Callable[[], object] | None = None,
        gmc_factory: Callable[[], object] | None = None,
        regression_factory: Callable[[], object] | None = None,
    ) -> None:
        self.chemberta_factory = chemberta_factory or _load_chemberta
        self.gmc_factory = gmc_factory or GMCBBBPredictor
        self.regression_factory = regression_factory or ChempropRegressionPredictor

    def predict_batch(self, molecule_ids: list[str], canonical_smiles: list[str]) -> list[dict[str, object]]:
        if len(molecule_ids) != len(canonical_smiles):
            raise ValueError("molecule_ids and canonical_smiles must have equal lengths")
        family_outputs: dict[str, list[dict[str, object]] | FamilyFailure] = {}
        for family, factory, method in (
            ("chemberta", self.chemberta_factory, "chemberta"),
            ("gmc_bbb", self.gmc_factory, "external"),
            ("chemprop_regression", self.regression_factory, "external"),
        ):
            try:
                predictor = factory()
                if method == "chemberta":
                    raw = predictor.predict_batch(canonical_smiles)
                    family_outputs[family] = [_classification_result(item) for item in raw]
                else:
                    family_outputs[family] = predictor.predict_batch(molecule_ids, canonical_smiles)
            except Exception as exc:
                family_outputs[family] = FamilyFailure("model_unavailable", str(exc))

        results: list[dict[str, object]] = []
        for index, molecule_id in enumerate(molecule_ids):
            classification = _family_item(family_outputs["chemberta"], index, _classification_unavailable)
            bbb = _family_item(family_outputs["gmc_bbb"], index, _bbb_unavailable)
            regression = _family_item(family_outputs["chemprop_regression"], index, _regression_unavailable)
            statuses = {
                "chemberta": classification["status"],
                "gmc_bbb": bbb["status"],
                "chemprop_regression": regression["status"],
            }
            successful = sum(status == "success" or status == "available" for status in statuses.values())
            overall = "success" if successful == 3 else "partial_success" if successful else "model_unavailable"
            warnings = [
                str(item.get("warning") or item.get("error_message") or "")
                for item in (classification, bbb, regression)
                if item.get("status") not in {"success", "available"}
            ]
            results.append({
                "molecule_id": molecule_id, "canonical_smiles": canonical_smiles[index],
                "status": overall, "warning": " | ".join(filter(None, warnings)),
                "family_status": statuses, "classification": classification,
                "bbb": bbb, "regression": regression,
            })
        return results


def predict_batch(
    molecule_ids: list[str], canonical_smiles: list[str]
) -> list[dict[str, object]]:
    """Run the configured production registry once for an ordered valid batch."""

    return ADMETRegistry().predict_batch(molecule_ids, canonical_smiles)


def _family_item(value, index, unavailable_factory):
    if isinstance(value, FamilyFailure):
        return unavailable_factory(value.warning)
    if len(value) <= index:
        return unavailable_factory("Model family returned the wrong number of rows.")
    return value[index]


def load_chemberta_predictor(*, application_root: str | None = None):
    """Load the verified frozen ChemBERTa family from normal application resources."""

    root = resolve_release_root(application_root=application_root)
    if root is None:
        raise ADMETReleaseError("ADMET release root is not configured or packaged.")
    family = root / "ChemBERTa"
    archive = family / "moloptima_admet_classifier_v1.tar.gz"
    extracted = extracted_archive(
        archive,
        checksum_sidecar=family / "moloptima_admet_classifier_v1.tar.gz.sha256",
        expected_sha256=CHEMBERTA_ARCHIVE_SHA256,
    )
    bundle = only_child_directory(extracted)
    verify_bundle_inventory(bundle)
    return load_admet_multitask_predictor(bundle)


def _load_chemberta():
    return load_chemberta_predictor()


def _classification_result(raw: dict[str, object]) -> dict[str, object]:
    endpoints = raw.get("endpoints", {})
    if not isinstance(endpoints, dict) or not set(CLASSIFICATION_ENDPOINTS).issubset(endpoints):
        raise ValueError("ChemBERTa output omitted a required production endpoint.")
    return {
        "status": raw.get("prediction_status"),
        "endpoints": {name: endpoints[name] for name in CLASSIFICATION_ENDPOINTS},
    }


def _classification_unavailable(warning: str) -> dict[str, object]:
    return {
        "status": "model_unavailable", "warning": warning,
        "endpoints": {
            name: {
                "raw_logit": None, "raw_probability": None, "calibrated_probability": None,
                "binary_prediction": None, "display_name": name, "positive_class_meaning": "",
                "evidence_status": "unavailable", "warning": warning,
            }
            for name in CLASSIFICATION_ENDPOINTS
        },
    }


def _bbb_unavailable(warning: str) -> dict[str, object]:
    return {
        "status": "model_unavailable", "warning": warning, "error_code": "model_unavailable",
        "error_message": warning, "seed_probabilities": {}, "ensemble_probability": None,
        "ensemble_standard_deviation": None, "threshold": 0.5,
        "threshold_status": "provisional_raw", "raw_classification": None,
        "calibration_status": "not_frozen", "prediction": "unavailable",
        "model_family": "gmc_mpnn_bbb",
    }


def _regression_unavailable(warning: str) -> dict[str, object]:
    return {
        "status": "model_unavailable", "warning": warning, "error_code": "model_unavailable",
        "error_message": warning, "endpoint_order": list(REGRESSION_ENDPOINTS),
        "endpoints": {
            endpoint: {"status": "model_unavailable", "unit": None, "warning": warning}
            for endpoint in REGRESSION_ENDPOINTS
        },
    }


def invalid_admet_result(molecule_id: str, canonical_smiles: str | None) -> dict[str, object]:
    warning = "ADMET prediction skipped for invalid molecule."
    classification = _classification_unavailable(warning)
    classification["status"] = "not_run_invalid_molecule"
    bbb = _bbb_unavailable(warning)
    bbb["status"] = "not_run_invalid_molecule"
    regression = _regression_unavailable(warning)
    regression["status"] = "not_run_invalid_molecule"
    for endpoint in regression["endpoints"].values():
        endpoint["status"] = "not_run_invalid_molecule"
    return {
        "molecule_id": molecule_id, "canonical_smiles": canonical_smiles,
        "status": "not_run_invalid_molecule", "warning": warning,
        "family_status": {name: "not_run_invalid_molecule" for name in ("chemberta", "gmc_bbb", "chemprop_regression")},
        "classification": classification, "bbb": bbb, "regression": regression,
    }
