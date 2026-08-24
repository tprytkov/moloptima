"""Subprocess adapter for the frozen five-endpoint Chemprop regression runner."""

from __future__ import annotations

import csv
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from molecular_prioritization.admet_release import ADMETReleaseError, extracted_archive, resolve_release_root, verify_sidecar


ENDPOINTS = (
    "caco2_wang", "lipophilicity_astrazeneca", "solubility_aqsoldb", "ppbr_az", "vdss_lombardo",
)
REPRESENTATIONS = {
    "caco2_wang": "log10_papp_cm_per_s", "lipophilicity_astrazeneca": "log_ratio",
    "solubility_aqsoldb": "log_mol_per_l", "ppbr_az": "percent_bound", "vdss_lombardo": "l_per_kg",
}
PYTHON_ENV = "MOLOPTIMA_CHEMPROP_PYTHON"
RUNNER_ENV = "MOLOPTIMA_CHEMPROP_RUNNER"
ARCHIVE_SHA256 = "d6d9b69295abada2f35213983c83d18e1c6c161db1d4f6675ceb77364cc804cb"


class ChempropRegressionUnavailable(RuntimeError):
    pass


class ChempropRegressionPredictor:
    def __init__(self, *, python: str | None = None, runner: str | Path | None = None) -> None:
        root = resolve_release_root()
        if root is None:
            raise ChempropRegressionUnavailable("ADMET release root is not configured or packaged.")
        family = root / "Chemprop_regression"
        archive = family / "chemprop_regression_release_v1.tar.gz"
        manifest = family / "production_manifest.json"
        try:
            verify_sidecar(manifest, family / "production_manifest.json.sha256")
            self.artifact_root = extracted_archive(archive, expected_sha256=ARCHIVE_SHA256)
        except ADMETReleaseError as exc:
            raise ChempropRegressionUnavailable(str(exc)) from exc
        manifests = list(self.artifact_root.rglob("production_manifest.json"))
        if len(manifests) != 1:
            raise ChempropRegressionUnavailable("Regression runtime archive omitted production_manifest.json.")
        self.manifest = manifests[0]
        self.python = python or os.environ.get(PYTHON_ENV, "").strip() or sys.executable
        configured_runner = runner or os.environ.get(RUNNER_ENV, "").strip()
        if not configured_runner or not Path(configured_runner).is_file():
            raise ChempropRegressionUnavailable(
                f"Validated Chemprop regression runner is unavailable; configure {RUNNER_ENV}."
            )
        self.runner = Path(configured_runner).resolve()

    def predict_batch(self, molecule_ids: list[str], canonical_smiles: list[str]) -> list[dict[str, object]]:
        if len(molecule_ids) != len(canonical_smiles):
            raise ValueError("molecule_ids and canonical_smiles must have equal lengths")
        with tempfile.TemporaryDirectory(prefix="moloptima-regression-") as temp:
            input_path, output_path = Path(temp) / "input.csv", Path(temp) / "output.csv"
            with input_path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=["molecule_id", "source_smiles"])
                writer.writeheader()
                writer.writerows({"molecule_id": i, "source_smiles": s} for i, s in zip(molecule_ids, canonical_smiles, strict=True))
            command = [self.python, str(self.runner), "--manifest", str(self.manifest), "--artifact-root", str(self.artifact_root), "--input-csv", str(input_path), "--output-csv", str(output_path), "--num-workers", "0"]
            completed = subprocess.run(command, capture_output=True, text=True, shell=False)
            if completed.returncode != 0:
                message = (completed.stderr or completed.stdout).strip()[-1200:]
                raise ChempropRegressionUnavailable(f"Chemprop regression runner failed: {message or 'no diagnostic'}")
            with output_path.open(encoding="utf-8-sig", newline="") as handle:
                rows = list(csv.DictReader(handle))
        if len(rows) != len(molecule_ids):
            raise ChempropRegressionUnavailable("Regression runner returned the wrong number of rows.")
        results = []
        for expected_id, row in zip(molecule_ids, rows, strict=True):
            if row.get("molecule_id") != expected_id:
                raise ChempropRegressionUnavailable("Regression runner changed molecule order or identifiers.")
            order = tuple(json.loads(row["endpoint_order_json"]))
            if order != ENDPOINTS:
                raise ChempropRegressionUnavailable("Regression endpoint order violated the frozen contract.")
            endpoint_results = {}
            for endpoint in ENDPOINTS:
                suffix = REPRESENTATIONS[endpoint]
                prefix = f"{endpoint}_"
                endpoint_results[endpoint] = {
                    key[len(prefix):]: _number_or_text(value)
                    for key, value in row.items() if key.startswith(prefix) and value != ""
                }
                endpoint_results[endpoint]["unit"] = row.get(f"{endpoint}_unit")
                endpoint_results[endpoint]["representation"] = row.get(f"{endpoint}_representation")
                endpoint_results[endpoint]["display_suffix"] = suffix
                endpoint_results[endpoint]["status"] = row.get("status")
            results.append({
                "status": row.get("status"), "error_code": row.get("error_code") or None,
                "error_message": row.get("error_message") or None, "model_family": row.get("model_family"),
                "manifest_schema_version": row.get("manifest_schema_version"),
                "manifest_sha256": row.get("manifest_sha256"), "release_status": row.get("release_status"),
                "endpoint_order": list(order), "endpoints": endpoint_results,
            })
        return results


def _number_or_text(value: str) -> object:
    try:
        return float(value)
    except (TypeError, ValueError):
        return value
