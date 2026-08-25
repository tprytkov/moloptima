"""Subprocess adapter for the frozen GMC-MPNN BBB production runner."""

from __future__ import annotations

import csv
import math
import subprocess
import tempfile
from pathlib import Path

from molecular_prioritization.admet_release import (
    ADMETReleaseError,
    extracted_archive,
    resolve_release_root,
    sha256_file,
)
from molecular_prioritization.admet_runtime import ADMETRuntimeError, resolve_admet_runtime


SEEDS = (13, 37, 73, 101, 137)
RAW_EVALUATION_THRESHOLD = 0.5
THRESHOLD_STATUS = "provisional_raw"
CALIBRATION_STATUS = "not_frozen"
PYTHON_ENV = "MOLOPTIMA_GMC_PYTHON"
RUNNER_ENV = "MOLOPTIMA_GMC_RUNNER"
ARCHIVE_SHA256 = "44eb3868f8890dbdc4a84e2ea6bee8e5c51319191df073189c2359b4c3708913"
MANIFEST_SHA256 = "5ccf14a6e0d6a587f4e8a4018cb19ce1f26dc178c84d55afc130069c2e59e39b"


class GMCBBBUnavailable(RuntimeError):
    pass


class GMCBBBPredictor:
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
            raise GMCBBBUnavailable("model_release_missing: GMC model release is not configured or packaged")
        family = root / "GMC_MPNN_BBB"
        archive = family / "gmc_mpnn_bbb_production_release_v1.tar.gz"
        manifest = family / "production_manifest.json"
        try:
            if not manifest.is_file() or sha256_file(manifest) != MANIFEST_SHA256:
                raise ADMETReleaseError("SHA-256 mismatch for GMC production_manifest.json.")
            extracted = extracted_archive(archive, expected_sha256=ARCHIVE_SHA256)
        except ADMETReleaseError as exc:
            code = "model_release_hash_mismatch" if "SHA-256" in str(exc) else "model_release_invalid"
            raise GMCBBBUnavailable(f"{code}: GMC frozen release failed verification") from exc
        self.artifact_root = extracted
        manifests = list(extracted.rglob("production_manifest.json"))
        if len(manifests) != 1:
            raise GMCBBBUnavailable("model_release_invalid: GMC release manifest is missing")
        self.manifest = manifests[0]
        try:
            runtime = resolve_admet_runtime(
                "gmc_mpnn_bbb",
                model_manifest=self.manifest,
                application_root=application_root,
                python_override=python,
                runner_override=runner,
                command_runner=runtime_command_runner,
            )
        except ADMETRuntimeError as exc:
            raise GMCBBBUnavailable(str(exc)) from exc
        self.python = str(runtime.python)
        self.runner = runtime.runner
        self.python_source = runtime.python_source
        self.runner_source = runtime.runner_source
        self.runtime_versions = dict(runtime.versions)

    def predict_batch(self, molecule_ids: list[str], canonical_smiles: list[str]) -> list[dict[str, object]]:
        if len(molecule_ids) != len(canonical_smiles):
            raise ValueError("molecule_ids and canonical_smiles must have equal lengths")
        with tempfile.TemporaryDirectory(prefix="moloptima-gmc-") as temp:
            input_path = Path(temp) / "input.csv"
            output_path = Path(temp) / "output.csv"
            with input_path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=["molecule_id", "source_smiles"])
                writer.writeheader()
                writer.writerows(
                    {"molecule_id": molecule_id, "source_smiles": smiles}
                    for molecule_id, smiles in zip(molecule_ids, canonical_smiles, strict=True)
                )
            command = [
                self.python, str(self.runner), "--manifest", str(self.manifest),
                "--artifact-root", str(self.artifact_root), "--input-csv", str(input_path),
                "--output-csv", str(output_path), "--num-workers", "0",
            ]
            completed = subprocess.run(command, capture_output=True, text=True, shell=False)
            if completed.returncode != 0:
                diagnostic = (completed.stderr or completed.stdout).lower()
                code = "runtime_incompatible" if "runtime" in diagnostic or "version" in diagnostic else "runner_failed"
                raise GMCBBBUnavailable(f"{code}: GMC validated runner did not complete")
            with output_path.open(encoding="utf-8-sig", newline="") as handle:
                rows = list(csv.DictReader(handle))
        if len(rows) != len(molecule_ids):
            raise GMCBBBUnavailable("GMC runner returned the wrong number of rows.")
        results = []
        for expected_id, row in zip(molecule_ids, rows, strict=True):
            if row.get("molecule_id") != expected_id:
                raise GMCBBBUnavailable("GMC runner changed molecule order or identifiers.")
            probabilities = [float(row[f"seed{seed}_probability"]) for seed in SEEDS]
            mean = sum(probabilities) / len(probabilities)
            standard_deviation = math.sqrt(
                sum((probability - mean) ** 2 for probability in probabilities)
                / len(probabilities)
            )
            reported = float(row["ensemble_probability"])
            reported_standard_deviation = float(row["ensemble_standard_deviation"])
            threshold = float(row["threshold"])
            if (
                abs(mean - reported) > 1e-10
                or abs(standard_deviation - reported_standard_deviation) > 1e-10
                or threshold != RAW_EVALUATION_THRESHOLD
            ):
                raise GMCBBBUnavailable(
                    "GMC ensemble statistics or raw evaluation threshold violated the release contract."
                )
            raw_classification = row.get("prediction")
            results.append({
                "status": row.get("status"), "error_code": row.get("error_code") or None,
                "error_message": row.get("error_message") or None,
                "seed_probabilities": {str(seed): value for seed, value in zip(SEEDS, probabilities)},
                "ensemble_probability": reported,
                "ensemble_standard_deviation": reported_standard_deviation,
                "threshold": threshold,
                "threshold_status": THRESHOLD_STATUS,
                "raw_classification": raw_classification,
                "calibration_status": CALIBRATION_STATUS,
                "prediction": raw_classification,
                "model_family": row.get("model_family"),
                "manifest_version": row.get("manifest_version"),
                "model_interface_version": row.get("model_interface_version"),
            })
        return results
