"""Subprocess adapter for the frozen GMC-MPNN BBB production runner."""

from __future__ import annotations

import csv
import math
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from molecular_prioritization.admet_release import (
    ADMETReleaseError,
    extracted_archive,
    resolve_release_root,
    sha256_file,
)


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
    def __init__(self, *, python: str | None = None, runner: str | Path | None = None) -> None:
        root = resolve_release_root()
        if root is None:
            raise GMCBBBUnavailable("ADMET release root is not configured or packaged.")
        family = root / "GMC_MPNN_BBB"
        archive = family / "gmc_mpnn_bbb_production_release_v1.tar.gz"
        manifest = family / "production_manifest.json"
        try:
            if not manifest.is_file() or sha256_file(manifest) != MANIFEST_SHA256:
                raise ADMETReleaseError("SHA-256 mismatch for GMC production_manifest.json.")
            extracted = extracted_archive(archive, expected_sha256=ARCHIVE_SHA256)
        except ADMETReleaseError as exc:
            raise GMCBBBUnavailable(str(exc)) from exc
        self.artifact_root = extracted
        manifests = list(extracted.rglob("production_manifest.json"))
        if len(manifests) != 1:
            raise GMCBBBUnavailable("GMC runtime archive omitted production_manifest.json.")
        self.manifest = manifests[0]
        self.python = python or os.environ.get(PYTHON_ENV, "").strip() or sys.executable
        configured_runner = runner or os.environ.get(RUNNER_ENV, "").strip()
        if not configured_runner or not Path(configured_runner).is_file():
            raise GMCBBBUnavailable(
                f"Validated GMC production runner is unavailable; configure {RUNNER_ENV}."
            )
        self.runner = Path(configured_runner).resolve()

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
                message = (completed.stderr or completed.stdout).strip()[-1200:]
                raise GMCBBBUnavailable(f"GMC runner failed: {message or 'no diagnostic'}")
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
