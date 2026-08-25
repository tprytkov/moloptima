"""Subprocess adapter for the frozen five-endpoint Chemprop regression runner."""

from __future__ import annotations

import csv
import json
import subprocess
import tempfile
from pathlib import Path

from molecular_prioritization.admet_release import ADMETReleaseError, extracted_archive, resolve_release_root, verify_sidecar
from molecular_prioritization.admet_runtime import ADMETRuntimeError, resolve_admet_runtime


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
    def __init__(
        self,
        *,
        python: str | Path | None = None,
        runner: str | Path | None = None,
        application_root: str | Path | None = None,
        runtime_command_runner=subprocess.run,
    ) -> None:
        root = resolve_release_root(application_root=application_root)
        if root is None:
            raise ChempropRegressionUnavailable(
                "model_release_missing: regression model release is not configured or packaged"
            )
        family = root / "Chemprop_regression"
        archive = family / "chemprop_regression_release_v1.tar.gz"
        manifest = family / "production_manifest.json"
        try:
            verify_sidecar(manifest, family / "production_manifest.json.sha256")
            self.artifact_root = extracted_archive(archive, expected_sha256=ARCHIVE_SHA256)
        except ADMETReleaseError as exc:
            code = "model_release_hash_mismatch" if "SHA-256" in str(exc) else "model_release_invalid"
            raise ChempropRegressionUnavailable(
                f"{code}: regression frozen release failed verification"
            ) from exc
        manifests = list(self.artifact_root.rglob("production_manifest.json"))
        if len(manifests) != 1:
            raise ChempropRegressionUnavailable(
                "model_release_invalid: regression release manifest is missing"
            )
        self.manifest = manifests[0]
        try:
            runtime = resolve_admet_runtime(
                "chemprop_regression",
                model_manifest=self.manifest,
                application_root=application_root,
                python_override=python,
                runner_override=runner,
                command_runner=runtime_command_runner,
            )
        except ADMETRuntimeError as exc:
            raise ChempropRegressionUnavailable(str(exc)) from exc
        self.python = str(runtime.python)
        self.runner = runtime.runner
        self.python_source = runtime.python_source
        self.runner_source = runtime.runner_source
        self.runtime_versions = dict(runtime.versions)

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
                diagnostic = (completed.stderr or completed.stdout).lower()
                code = "runtime_incompatible" if "runtime" in diagnostic or "version" in diagnostic else "runner_failed"
                raise ChempropRegressionUnavailable(
                    f"{code}: Chemprop regression validated runner did not complete"
                )
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
