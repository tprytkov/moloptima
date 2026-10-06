"""Real-runtime acceptance harness for packaged MolOptima scientific engines."""

from __future__ import annotations

import hashlib
import json
import math
import queue
import re
import subprocess
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock, Thread
from time import monotonic
from typing import Callable, Mapping, Sequence

from molecular_prioritization.admet_registry import (
    ADMETRegistry,
    CHEMBERTA_ARCHIVE_SHA256,
    CLASSIFICATION_ENDPOINTS,
    REGRESSION_ENDPOINTS,
    load_chemberta_predictor,
)
from molecular_prioritization.admet_release import PROJECT_ROOT, sha256_file
from molecular_prioritization.admet_runtime import RUNTIME_PROBE_TIMEOUT_SECONDS
from molecular_prioritization.chemprop_regression_predictor import (
    REPRESENTATIONS,
    ChempropRegressionPredictor,
)
from molecular_prioritization.gmc_bbb_predictor import GMCBBBPredictor, SEEDS
from molecular_prioritization.pipeline import prioritize_smiles
from molecular_prioritization.receptor import VinaBoxConfig, validate_prepared_receptor
from molecular_prioritization.receptor_preparation import (
    GEMMI_VERSION,
    MEEKO_VERSION,
    receptor_preparation_runtime_status,
)
from molecular_prioritization.standardize import standardize_smiles
from molecular_prioritization.vina_docking import (
    VinaDockingEngine,
    probe_native_runtime_identity,
    resolve_obabel_executable,
    resolve_vina_executable,
)


QUALIFICATION_SCHEMA_VERSION = "moloptima-packaged-scientific-runtime-qualification-v1"
PASS = "PASS"
FAIL = "FAIL"
NOT_RUN_RUNTIME_MISSING = "NOT_RUN_RUNTIME_MISSING"
NOT_RUN_ASSET_MISSING = "NOT_RUN_ASSET_MISSING"
MOCK_TESTED_ONLY = "MOCK_TESTED_ONLY"
DETERMINISM_ABSOLUTE_TOLERANCE = 0.0
DETERMINISM_RELATIVE_TOLERANCE = 0.0
_SCIENTIFIC_RUNTIME_STATUS_LOCK = RLock()
_SCIENTIFIC_RUNTIME_STATUS_CACHE: dict[Path, dict[str, object]] = {}
_SCIENTIFIC_RUNTIME_STATUS_OPERATIONS: dict[Path, dict[str, object]] = {}
SCIENTIFIC_RUNTIME_FAMILY_TIMEOUT_SECONDS = RUNTIME_PROBE_TIMEOUT_SECONDS


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _checking_component_snapshots() -> dict[str, dict[str, object]]:
    return {
        "chemberta": {
            "status": "checking", "runtime_source": "pending",
            "public_endpoint_count": len(CLASSIFICATION_ENDPOINTS),
        },
        "gmc_mpnn_bbb": {
            "status": "checking", "runtime_source": "pending",
            "ensemble_seed_count": len(SEEDS), "ensemble_mean": "raw_unweighted_mean",
            "standard_deviation": "population", "threshold": 0.5,
            "threshold_status": "provisional_raw", "calibration_status": "not_frozen",
        },
        "chemprop_regression": {
            "status": "checking", "runtime_source": "pending",
            "endpoint_count": len(REGRESSION_ENDPOINTS), "ensemble_seed_count": len(SEEDS),
            "standard_deviation": "sample",
        },
        "receptor_preparation": {
            "status": "checking", "runtime_source": "pending",
            "meeko": {"status": "checking", "version": None},
            "gemmi": {"status": "checking", "version": None},
            "pdbfixer": {"status": "checking", "version": None},
            "openmm": {"status": "checking", "version": None},
        },
        "docking": {
            "status": "checking",
            "vina": {"status": "checking", "runtime_source": "pending"},
            "openbabel": {"status": "checking", "runtime_source": "pending"},
        },
    }


def _runtime_status_checks(root: Path) -> dict[str, Callable[[], dict[str, object]]]:
    """Return the existing production contract probes, grouped by Settings card."""

    return {
        "chemberta": lambda: _chemberta_runtime_status(root),
        "gmc_mpnn_bbb": lambda: _gmc_runtime_status(root),
        "chemprop_regression": lambda: _chemprop_runtime_status(root),
        "receptor_preparation": _receptor_runtime_status,
        "docking": _docking_runtime_status,
    }


def _start_runtime_status_operation(root: Path, *, refresh: bool) -> None:
    previous = _SCIENTIFIC_RUNTIME_STATUS_CACHE.get(root)
    generation = int(previous.get("generation", 0)) + 1 if previous else 1
    if refresh and previous:
        components = deepcopy(previous["components"])
        for component in components.values():
            component["refreshing"] = True
    else:
        components = _checking_component_snapshots()
    payload = {
        "checked_at": _utc_now(),
        "status_source": "production_runtime_contract_probes",
        "inference_performed": False,
        "qualification_state": "checking",
        "refreshing": bool(refresh and previous),
        "generation": generation,
        "probe_timings_seconds": {},
        "components": components,
    }
    result_queue: queue.Queue[tuple[str, dict[str, object], float]] = queue.Queue()
    operation: dict[str, object] = {
        "generation": generation,
        "active_workers": 0,
        "result_queue": result_queue,
    }
    _SCIENTIFIC_RUNTIME_STATUS_CACHE[root] = payload
    _SCIENTIFIC_RUNTIME_STATUS_OPERATIONS[root] = operation
    checks = _runtime_status_checks(root)
    operation["active_workers"] = len(checks)
    for name, check in checks.items():
        Thread(
            target=_run_runtime_status_check,
            args=(root, generation, name, check, result_queue),
            name=f"scientific-runtime-{name}",
            daemon=True,
        ).start()
    Thread(
        target=_collect_runtime_status_checks,
        args=(root, generation, tuple(checks), result_queue),
        name="scientific-runtime-status-collector",
        daemon=True,
    ).start()


def _run_runtime_status_check(
    root: Path,
    generation: int,
    name: str,
    check: Callable[[], dict[str, object]],
    result_queue: queue.Queue[tuple[str, dict[str, object], float]],
) -> None:
    started = monotonic()
    try:
        result = check()
    except Exception as exc:
        result = {
            "status": "error",
            "runtime_source": "unavailable",
            "reason": type(exc).__name__,
        }
    finally:
        elapsed = monotonic() - started
    result_queue.put((name, result, elapsed))
    with _SCIENTIFIC_RUNTIME_STATUS_LOCK:
        operation = _SCIENTIFIC_RUNTIME_STATUS_OPERATIONS.get(root)
        if operation and operation["generation"] == generation:
            operation["active_workers"] = int(operation["active_workers"]) - 1
            if operation["active_workers"] == 0:
                _SCIENTIFIC_RUNTIME_STATUS_OPERATIONS.pop(root, None)


def _collect_runtime_status_checks(
    root: Path,
    generation: int,
    names: tuple[str, ...],
    result_queue: queue.Queue[tuple[str, dict[str, object], float]],
) -> None:
    pending = set(names)
    deadline = monotonic() + SCIENTIFIC_RUNTIME_FAMILY_TIMEOUT_SECONDS
    while pending:
        remaining = deadline - monotonic()
        if remaining <= 0:
            break
        try:
            name, result, elapsed = result_queue.get(timeout=remaining)
        except queue.Empty:
            break
        if name not in pending:
            continue
        pending.remove(name)
        with _SCIENTIFIC_RUNTIME_STATUS_LOCK:
            payload = _SCIENTIFIC_RUNTIME_STATUS_CACHE.get(root)
            if not payload or payload.get("generation") != generation:
                return
            result = deepcopy(result)
            payload["components"][name] = result
            payload["probe_timings_seconds"][name] = round(elapsed, 3)
            payload["checked_at"] = _utc_now()
    with _SCIENTIFIC_RUNTIME_STATUS_LOCK:
        payload = _SCIENTIFIC_RUNTIME_STATUS_CACHE.get(root)
        if not payload or payload.get("generation") != generation:
            return
        for name in pending:
            payload["components"][name] = {
                "status": "error",
                "runtime_source": "unavailable",
                "reason": "runtime_probe_timeout",
            }
            payload["probe_timings_seconds"][name] = round(
                SCIENTIFIC_RUNTIME_FAMILY_TIMEOUT_SECONDS, 3
            )
        payload["qualification_state"] = "complete"
        payload["refreshing"] = False
        payload["checked_at"] = _utc_now()


def scientific_runtime_status(
    *, application_root: str | Path | None = None, refresh: bool = False
) -> dict[str, object]:
    """Return a prompt snapshot while production contract probes run in the background."""

    root = Path(application_root).resolve() if application_root is not None else PROJECT_ROOT
    with _SCIENTIFIC_RUNTIME_STATUS_LOCK:
        operation = _SCIENTIFIC_RUNTIME_STATUS_OPERATIONS.get(root)
        if root not in _SCIENTIFIC_RUNTIME_STATUS_CACHE:
            _start_runtime_status_operation(root, refresh=False)
        elif refresh and operation is None:
            _start_runtime_status_operation(root, refresh=True)
        return deepcopy(_SCIENTIFIC_RUNTIME_STATUS_CACHE[root])


def _chemberta_runtime_status(root: Path) -> dict[str, object]:
    try:
        load_chemberta_predictor(application_root=str(root))
    except Exception as exc:
        return _runtime_failure(exc)
    return {
        "status": "available",
        "runtime_source": "application_process",
        "public_endpoint_count": len(CLASSIFICATION_ENDPOINTS),
    }


def _gmc_runtime_status(root: Path) -> dict[str, object]:
    try:
        predictor = GMCBBBPredictor(application_root=root)
    except Exception as exc:
        return {
            **_runtime_failure(exc),
            "ensemble_seed_count": len(SEEDS),
            "ensemble_mean": "raw_unweighted_mean",
            "standard_deviation": "population",
            "threshold": 0.5,
            "threshold_status": "provisional_raw",
            "calibration_status": "not_frozen",
        }
    return {
        "status": "available",
        "runtime_source": _combined_runtime_source(predictor),
        "ensemble_seed_count": len(SEEDS),
        "ensemble_mean": "raw_unweighted_mean",
        "standard_deviation": "population",
        "threshold": 0.5,
        "threshold_status": "provisional_raw",
        "calibration_status": "not_frozen",
        "runtime_versions": dict(predictor.runtime_versions),
    }


def _chemprop_runtime_status(root: Path) -> dict[str, object]:
    try:
        predictor = ChempropRegressionPredictor(application_root=root)
    except Exception as exc:
        return {
            **_runtime_failure(exc),
            "endpoint_count": len(REGRESSION_ENDPOINTS),
            "ensemble_seed_count": len(SEEDS),
            "standard_deviation": "sample",
        }
    return {
        "status": "available",
        "runtime_source": _combined_runtime_source(predictor),
        "endpoint_count": len(REGRESSION_ENDPOINTS),
        "ensemble_seed_count": len(SEEDS),
        "standard_deviation": "sample",
        "runtime_versions": dict(predictor.runtime_versions),
    }


def _receptor_runtime_status() -> dict[str, object]:
    runtime = receptor_preparation_runtime_status()
    packages = runtime.get("packages", {})
    meeko = packages.get("meeko") if isinstance(packages, Mapping) else None
    gemmi = packages.get("gemmi") if isinstance(packages, Mapping) else None
    repair = runtime.get("repair_runtime", {})
    pdbfixer = repair.get("pdbfixer_version") if isinstance(repair, Mapping) else None
    openmm = repair.get("openmm_version") if isinstance(repair, Mapping) else None
    if runtime.get("available"):
        status = "available"
    elif meeko is not None or gemmi is not None:
        status = "incompatible"
    else:
        status = "unavailable"
    return {
        "status": status,
        "runtime_source": "application_process_and_isolated_repair_runtime",
        "meeko": {"status": "available" if meeko == MEEKO_VERSION else status, "version": meeko},
        "gemmi": {"status": "available" if gemmi == GEMMI_VERSION else status, "version": gemmi},
        "pdbfixer": {"status": "available" if repair.get("available") else status, "version": pdbfixer},
        "openmm": {"status": "available" if repair.get("available") else status, "version": openmm},
        "repair_runtime_source": repair.get("resolution_source"),
        "hydrogen_preparation": runtime.get("hydrogen_preparation", {}),
        "reason": runtime.get("reason", ""),
    }


def _docking_runtime_status() -> dict[str, object]:
    def probe(resolver, version_argument: str, label: str, expected: str | None = None):
        try:
            executable, source = resolver()
            identity = probe_native_runtime_identity(executable, version_argument, label)
            if expected and expected not in identity:
                raise RuntimeError(f"runtime_incompatible: {label} {expected} is required")
            return {"status": "available", "runtime_source": source, "identity": identity}
        except Exception as exc:
            return _runtime_failure(exc)

    vina = probe(resolve_vina_executable, "--version", "Vina", "1.1.2")
    openbabel = probe(resolve_obabel_executable, "-V", "Open Babel")
    status = "available" if vina["status"] == openbabel["status"] == "available" else (
        "incompatible" if "incompatible" in {vina["status"], openbabel["status"]} else "unavailable"
    )
    return {"status": status, "vina": vina, "openbabel": openbabel}


def _combined_runtime_source(predictor: object) -> str:
    sources = {
        str(getattr(predictor, "python_source", "")),
        str(getattr(predictor, "runner_source", "")),
    } - {""}
    return sources.pop() if len(sources) == 1 else "+".join(sorted(sources))


def _runtime_failure(exc: Exception) -> dict[str, object]:
    message = str(exc).lower()
    incompatible_markers = (
        "incompatible",
        "hash_mismatch",
        "sha-256",
        "invalid",
        "version check failed",
        "dependency is missing",
    )
    status = "incompatible" if any(marker in message for marker in incompatible_markers) else "unavailable"
    code = str(exc).split(":", 1)[0].strip()
    return {
        "status": status,
        "runtime_source": "unavailable",
        "reason": code if code and len(code) <= 80 else "runtime contract check failed",
    }
FIXED_MOLECULES = (
    {"molecule_id": "acceptance_ethanol", "smiles": "CCO"},
    {"molecule_id": "acceptance_benzene", "smiles": "c1ccccc1"},
    {
        "molecule_id": "acceptance_caffeine",
        "smiles": "Cn1c(=O)c2c(ncn2C)n(C)c1=O",
    },
    {"molecule_id": "acceptance_invalid", "smiles": "not-a-smiles"},
)
_PRIVATE_WINDOWS_PATH = re.compile(r"(?i)[A-Z]:[\\/]+Users[\\/]+[^\\/\s]+(?:[\\/][^\s|]+)*")


@dataclass(frozen=True)
class QualificationConfig:
    output_dir: Path
    application_root: Path = PROJECT_ROOT
    receptor: Path | None = None
    center_x: float | None = None
    center_y: float | None = None
    center_z: float | None = None
    size_x: float | None = None
    size_y: float | None = None
    size_z: float | None = None
    exhaustiveness: int | None = None
    num_modes: int | None = None
    energy_range: float | None = None
    seed: int | None = None
    vina_executable: Path | None = None
    obabel_executable: Path | None = None


@dataclass(frozen=True)
class QualificationDependencies:
    """Test-only dependency injection; supplying this forces MOCK_TESTED_ONLY."""

    chemberta_factory: Callable[[], object]
    gmc_factory: Callable[[], object]
    regression_factory: Callable[[], object]
    vina_factory: Callable[..., object] | None = None
    pipeline_runner: Callable[..., list[dict[str, object]]] | None = None


def run_qualification(
    config: QualificationConfig,
    *,
    dependencies: QualificationDependencies | None = None,
) -> dict[str, object]:
    """Run real acceptance or explicitly non-qualifying test-double checks."""

    output_dir = config.output_dir.resolve()
    if output_dir.exists():
        raise FileExistsError("Qualification output directory already exists.")
    output_dir.mkdir(parents=True)
    test_mode = dependencies is not None
    factories = dependencies or QualificationDependencies(
        chemberta_factory=lambda: load_chemberta_predictor(
            application_root=str(config.application_root)
        ),
        gmc_factory=lambda: GMCBBBPredictor(application_root=config.application_root),
        regression_factory=lambda: ChempropRegressionPredictor(
            application_root=config.application_root
        ),
        vina_factory=VinaDockingEngine,
        pipeline_runner=prioritize_smiles,
    )

    prepared, valid_ids, valid_smiles = _prepare_fixed_molecules()
    predictions: dict[str, object] = {
        "schema_version": QUALIFICATION_SCHEMA_VERSION,
        "molecules": prepared,
        "families": {},
        "combined_pipeline": [],
    }
    provenance: dict[str, object] = {
        "schema_version": QUALIFICATION_SCHEMA_VERSION,
        "git_commit": _git_commit(config.application_root),
        "application_runtime_manifest_version": _runtime_manifest_version(
            config.application_root
        ),
        "families": {},
        "test_artifact_accessed": False,
        "qualification_mode": "mock_test" if test_mode else "real_runtime",
    }

    family_results: dict[str, dict[str, object]] = {}
    family_results["chemberta"], chemberta_predictions = _qualify_chemberta(
        factories.chemberta_factory, valid_ids, valid_smiles, test_mode=test_mode
    )
    predictions["families"]["chemberta"] = chemberta_predictions
    provenance["families"]["chemberta"] = family_results["chemberta"].pop(
        "provenance", {}
    )

    family_results["gmc_mpnn_bbb"], gmc_predictions = _qualify_gmc(
        factories.gmc_factory,
        valid_ids,
        valid_smiles,
        config.application_root,
        test_mode=test_mode,
    )
    predictions["families"]["gmc_mpnn_bbb"] = gmc_predictions
    provenance["families"]["gmc_mpnn_bbb"] = family_results["gmc_mpnn_bbb"].pop(
        "provenance", {}
    )

    family_results["chemprop_regression"], regression_predictions = _qualify_regression(
        factories.regression_factory,
        valid_ids,
        valid_smiles,
        config.application_root,
        test_mode=test_mode,
    )
    predictions["families"]["chemprop_regression"] = regression_predictions
    provenance["families"]["chemprop_regression"] = family_results[
        "chemprop_regression"
    ].pop("provenance", {})

    family_results["vina"], vina_predictions, vina_provenance = _qualify_vina(
        config,
        factories.vina_factory,
        output_dir,
        valid_ids,
        valid_smiles,
        test_mode=test_mode,
    )
    predictions["families"]["vina"] = vina_predictions
    provenance["families"]["vina"] = vina_provenance

    combined = _qualify_combined_pipeline(
        config,
        factories,
        output_dir,
        family_results,
        test_mode=test_mode,
    )
    predictions["combined_pipeline"] = combined.pop("predictions", [])
    family_results["combined_pipeline"] = combined

    summary = {
        "schema_version": QUALIFICATION_SCHEMA_VERSION,
        "overall_status": _overall_status(family_results, test_mode=test_mode),
        "family_status": {
            family: result["status"] for family, result in family_results.items()
        },
        "families": family_results,
        "fixed_molecule_count": len(FIXED_MOLECULES),
        "valid_molecule_count": len(valid_ids),
        "invalid_molecule_count": len(FIXED_MOLECULES) - len(valid_ids),
        "invalid_molecule_isolation": True,
        "test_artifact_accessed": False,
        "qualification_mode": "mock_test" if test_mode else "real_runtime",
    }

    safe_summary = sanitize_private_paths(summary)
    safe_predictions = sanitize_private_paths(predictions)
    safe_provenance = sanitize_private_paths(provenance)
    _write_json(output_dir / "qualification_summary.json", safe_summary)
    _write_json(output_dir / "qualification_predictions.json", safe_predictions)
    _write_json(output_dir / "runtime_provenance.json", safe_provenance)
    if vina_predictions and family_results["vina"]["status"] in {PASS, MOCK_TESTED_ONLY}:
        _write_json(
            output_dir / "vina_acceptance.json",
            sanitize_private_paths(
                {
                    "schema_version": QUALIFICATION_SCHEMA_VERSION,
                    "status": family_results["vina"]["status"],
                    "predictions": vina_predictions,
                }
            ),
        )
    _write_checksums(output_dir)
    return safe_summary


def _prepare_fixed_molecules() -> tuple[list[dict[str, object]], list[str], list[str]]:
    prepared: list[dict[str, object]] = []
    valid_ids: list[str] = []
    valid_smiles: list[str] = []
    for record in FIXED_MOLECULES:
        standardized = standardize_smiles(record["smiles"])
        status = "valid" if standardized.valid_molecule else "invalid"
        prepared.append(
            {
                **record,
                "canonical_smiles": standardized.canonical_smiles,
                "validation_status": status,
                "inference_attempted": standardized.valid_molecule,
            }
        )
        if standardized.valid_molecule and standardized.canonical_smiles:
            valid_ids.append(record["molecule_id"])
            valid_smiles.append(standardized.canonical_smiles)
    return prepared, valid_ids, valid_smiles


class _ChemBERTARawAudit:
    """Observe raw inference while leaving production filtering to ADMETRegistry."""

    def __init__(self, predictor: object) -> None:
        self.predictor = predictor
        self.rows: list[dict[str, object]] = []
        self.inference_call_count = 0

    def predict_batch(self, smiles: list[str]) -> list[dict[str, object]]:
        self.inference_call_count += 1
        rows = self.predictor.predict_batch(smiles)
        self.rows = rows
        return rows


def _qualification_family_not_requested():
    raise RuntimeError("family not requested by ChemBERTa qualification")


def _qualify_chemberta(
    factory,
    molecule_ids: list[str],
    smiles: list[str],
    *,
    test_mode: bool,
):
    try:
        audit = _ChemBERTARawAudit(factory())
        registry = ADMETRegistry(
            chemberta_factory=lambda: audit,
            gmc_factory=_qualification_family_not_requested,
            regression_factory=_qualification_family_not_requested,
        )
        registry_rows = registry.predict_batch(molecule_ids, smiles)
        _require(audit.inference_call_count == 1, "ChemBERTa real inference did not run exactly once.")
        _require(len(audit.rows) == len(smiles), "ChemBERTa returned the wrong raw row count.")
        public_rows = [row.get("classification") for row in registry_rows]
        _verify_chemberta_public_rows(public_rows, len(smiles))

        raw_endpoint_counts = [
            len(row.get("endpoints", {}))
            for row in audit.rows
            if isinstance(row, dict) and isinstance(row.get("endpoints"), dict)
        ]
        raw_bbb_present = any(
            "bbb_martins" in row.get("endpoints", {})
            for row in audit.rows
            if isinstance(row, dict) and isinstance(row.get("endpoints"), dict)
        )
        provenance = {
            "runtime_source": "application_process",
            "raw_internal_endpoint_count": max(raw_endpoint_counts, default=0),
            "public_endpoint_count": len(CLASSIFICATION_ENDPOINTS),
            "internal_bbb_martins_present": raw_bbb_present,
            "public_bbb_martins_present": False,
            "model_family": "chemberta_multitask_classification",
            "release_inventory_verified": True,
            "release_archive_sha256": CHEMBERTA_ARCHIVE_SHA256,
            "test_artifact_accessed": False,
        }
        return _passed_result(
            test_mode,
            [
                "real_inference",
                "production_registry_adapter",
                "exactly_nine_public_endpoints",
                "public_bbb_excluded",
                "finite_public_outputs",
                "release_hash_verified",
            ],
            provenance,
        ), public_rows
    except Exception as exc:
        return _failed_result(exc), []


def _verify_chemberta_public_rows(rows: list[object], expected_count: int) -> None:
    _require(len(rows) == expected_count, "ChemBERTa public adapter returned the wrong row count.")
    for row in rows:
        _require(isinstance(row, dict), "ChemBERTa public result is invalid.")
        _require(row.get("status") == "available", "ChemBERTa public inference failed.")
        endpoints = row.get("endpoints")
        _require(isinstance(endpoints, dict), "ChemBERTa public endpoints are invalid.")
        _require(
            tuple(endpoints) == CLASSIFICATION_ENDPOINTS,
            "ChemBERTa public endpoint contract changed.",
        )
        _require("bbb_martins" not in endpoints, "ChemBERTa BBB leaked into the public result.")
        for endpoint in CLASSIFICATION_ENDPOINTS:
            item = endpoints[endpoint]
            _require(isinstance(item, dict), f"ChemBERTa public output for {endpoint} is invalid.")
            probability = item.get("calibrated_probability")
            _require(
                _finite(probability) and 0.0 <= float(probability) <= 1.0,
                f"ChemBERTa public output for {endpoint} is non-finite.",
            )


def _qualify_gmc(factory, molecule_ids, smiles, application_root, *, test_mode: bool):
    try:
        predictor = factory()
        first = predictor.predict_batch(molecule_ids, smiles)
        second = predictor.predict_batch(molecule_ids, smiles)
        _require(len(first) == len(smiles) == len(second), "GMC returned the wrong row count.")
        for left, right in zip(first, second, strict=True):
            _verify_gmc_row(left)
            _verify_gmc_row(right)
            _require(_gmc_signature(left) == _gmc_signature(right), "GMC repeat inference differed.")
        spec = _family_resource_spec(application_root, "gmc_mpnn_bbb")
        runner_hash = sha256_file(Path(predictor.runner))
        _require(runner_hash == spec["runner_sha256"], "GMC runner SHA-256 mismatch.")
        provenance = _external_family_provenance(predictor, spec, runner_hash, first)
        checks = [
            "real_inference",
            "five_seed_contract",
            "unweighted_mean",
            "population_standard_deviation",
            "provisional_raw_threshold",
            "deterministic_repeat",
            "runner_sha256",
            "model_release_verified",
            "runtime_contract",
        ]
        return _passed_result(test_mode, checks, provenance), first
    except Exception as exc:
        return _failed_result(exc), []


def _verify_gmc_row(row: Mapping[str, object]) -> None:
    _require(row.get("status") == "success", "GMC prediction was not successful.")
    probabilities = row.get("seed_probabilities")
    _require(isinstance(probabilities, dict), "GMC seed probabilities are missing.")
    _require(tuple(probabilities) == tuple(str(seed) for seed in SEEDS), "GMC seed order changed.")
    values = [float(probabilities[str(seed)]) for seed in SEEDS]
    _require(all(math.isfinite(value) and 0.0 <= value <= 1.0 for value in values), "GMC probability is invalid.")
    mean = sum(values) / len(values)
    population_sd = math.sqrt(sum((value - mean) ** 2 for value in values) / len(values))
    _require(_same_float(row.get("ensemble_probability"), mean), "GMC ensemble mean changed.")
    _require(_same_float(row.get("ensemble_standard_deviation"), population_sd), "GMC population SD changed.")
    _require(row.get("threshold") == 0.5, "GMC threshold changed.")
    _require(row.get("threshold_status") == "provisional_raw", "GMC threshold status changed.")
    _require(row.get("calibration_status") == "not_frozen", "GMC calibration status changed.")


def _gmc_signature(row: Mapping[str, object]) -> tuple[object, ...]:
    probabilities = row["seed_probabilities"]
    return (
        *(probabilities[str(seed)] for seed in SEEDS),
        row.get("ensemble_probability"),
        row.get("ensemble_standard_deviation"),
        row.get("raw_classification"),
    )


def _qualify_regression(factory, molecule_ids, smiles, application_root, *, test_mode: bool):
    try:
        predictor = factory()
        first = predictor.predict_batch(molecule_ids, smiles)
        second = predictor.predict_batch(molecule_ids, smiles)
        _require(len(first) == len(smiles) == len(second), "Regression returned the wrong row count.")
        manifest = json.loads(Path(predictor.manifest).read_text(encoding="utf-8-sig"))
        for left, right in zip(first, second, strict=True):
            _verify_regression_row(left, manifest)
            _verify_regression_row(right, manifest)
            _require(
                _regression_signature(left) == _regression_signature(right),
                "Regression repeat inference differed.",
            )
        spec = _family_resource_spec(application_root, "chemprop_regression")
        runner_hash = sha256_file(Path(predictor.runner))
        _require(runner_hash == spec["runner_sha256"], "Regression runner SHA-256 mismatch.")
        provenance = _external_family_provenance(predictor, spec, runner_hash, first)
        provenance["production_manifest"] = {
            "schema_version": manifest.get("schema_version"),
            "release_status": manifest.get("release_status"),
            "model_family": manifest.get("model", {}).get("family"),
        }
        checks = [
            "real_inference",
            "exactly_five_endpoints",
            "finite_predictions",
            "units_and_transforms",
            "ensemble_disagreement",
            "deterministic_repeat",
            "runner_sha256",
            "model_release_verified",
            "runtime_contract",
        ]
        return _passed_result(test_mode, checks, provenance), first
    except Exception as exc:
        return _failed_result(exc), []


def _verify_regression_row(row: Mapping[str, object], manifest: Mapping[str, object]) -> None:
    _require(row.get("status") == "success", "Regression prediction was not successful.")
    _require(tuple(row.get("endpoint_order", ())) == REGRESSION_ENDPOINTS, "Regression endpoint order changed.")
    endpoints = row.get("endpoints")
    _require(isinstance(endpoints, dict) and tuple(endpoints) == REGRESSION_ENDPOINTS, "Regression endpoints changed.")
    manifest_endpoints = manifest["endpoints"]
    for endpoint in REGRESSION_ENDPOINTS:
        item = endpoints[endpoint]
        expected = manifest_endpoints[endpoint]
        suffix = REPRESENTATIONS[endpoint]
        mean_key = f"ensemble_mean_{suffix}"
        sd_key = f"seed_standard_deviation_{suffix}"
        _require(_finite(item.get(mean_key)), f"{endpoint} prediction is non-finite.")
        _require(_finite(item.get(sd_key)), f"{endpoint} disagreement is non-finite.")
        for seed in SEEDS:
            _require(_finite(item.get(f"seed{seed}_{suffix}")), f"{endpoint} seed output is non-finite.")
        expected_unit = (
            expected["internal_model_output_unit"]
            if endpoint == "caco2_wang"
            else expected["user_facing_unit"]
        )
        _require(item.get("unit") == expected_unit, f"{endpoint} unit changed.")
        _require(isinstance(item.get("representation"), str) and item.get("representation"), f"{endpoint} representation is missing.")
        _require(expected.get("scientific_transform") in {"identity", "log10"}, f"{endpoint} transform metadata is invalid.")
        _require(isinstance(expected.get("inverse_transform_for_user_output"), str), f"{endpoint} inverse transform metadata is missing.")


def _regression_signature(row: Mapping[str, object]) -> tuple[object, ...]:
    endpoints = row["endpoints"]
    values: list[object] = []
    for endpoint in REGRESSION_ENDPOINTS:
        suffix = REPRESENTATIONS[endpoint]
        item = endpoints[endpoint]
        values.extend(item.get(f"seed{seed}_{suffix}") for seed in SEEDS)
        values.extend(
            [
                item.get(f"ensemble_mean_{suffix}"),
                item.get(f"seed_standard_deviation_{suffix}"),
            ]
        )
    return tuple(values)


def _qualify_vina(config, factory, output_dir, molecule_ids, smiles, *, test_mode: bool):
    requested = any(
        value is not None
        for value in (
            config.receptor,
            config.center_x,
            config.center_y,
            config.center_z,
            config.size_x,
            config.size_y,
            config.size_z,
            config.exhaustiveness,
            config.num_modes,
            config.energy_range,
            config.seed,
        )
    )
    if not requested:
        return (
            {"status": NOT_RUN_ASSET_MISSING, "checks": [], "reason": "approved receptor and explicit docking configuration were not supplied"},
            [],
            {},
        )
    required = (
        config.receptor,
        config.center_x,
        config.center_y,
        config.center_z,
        config.size_x,
        config.size_y,
        config.size_z,
        config.exhaustiveness,
        config.num_modes,
        config.seed,
    )
    if any(value is None for value in required):
        return {"status": FAIL, "checks": [], "reason": "explicit docking configuration is incomplete"}, [], {}
    try:
        receptor = validate_prepared_receptor(config.receptor)
        box = VinaBoxConfig.from_mapping(
            {
                "center_x": config.center_x,
                "center_y": config.center_y,
                "center_z": config.center_z,
                "size_x": config.size_x,
                "size_y": config.size_y,
                "size_z": config.size_z,
                "exhaustiveness": config.exhaustiveness,
                "num_modes": config.num_modes,
                "energy_range": config.energy_range,
                "seed": config.seed,
            }
        )
        _require(factory is not None, "Vina factory is unavailable.")
        first_root, second_root = output_dir / "vina_run_1", output_dir / "vina_run_2"
        first_engine = factory(
            receptor,
            box,
            output_root=first_root,
            vina_executable=config.vina_executable,
            obabel_executable=config.obabel_executable,
        )
        second_engine = factory(
            receptor,
            box,
            output_root=second_root,
            vina_executable=config.vina_executable,
            obabel_executable=config.obabel_executable,
        )
        first = first_engine.dock_batch(molecule_ids, smiles)
        second = second_engine.dock_batch(molecule_ids, smiles)
        _require(len(first) == len(smiles) == len(second), "Vina returned the wrong row count.")
        for left, right in zip(first, second, strict=True):
            _verify_vina_row(left, first_root, receptor.prepared_receptor_sha256)
            _verify_vina_row(right, second_root, receptor.prepared_receptor_sha256)
            _require(left.get("best_affinity_kcal_mol") == right.get("best_affinity_kcal_mol"), "Vina repeat affinity differed.")
            _require(left.get("pose_sha256") == right.get("pose_sha256"), "Vina repeat pose hash differed.")
        provenance = {
            "prepared_receptor_sha256": receptor.prepared_receptor_sha256,
            "vina_version": first_engine.vina_version,
            "vina_runtime_source": first_engine.vina_runtime_source,
            "obabel_runtime_source": first_engine.obabel_runtime_source,
            "docking_configuration": box.as_dict(),
            "pose_hashes": [row["pose_sha256"] for row in first],
        }
        return _passed_result(
            test_mode,
            ["real_docking", "receptor_sha256", "ligand_preparation", "finite_affinity", "pose_sha256", "deterministic_repeat"],
            {},
        ), first, provenance
    except Exception as exc:
        return _failed_result(exc), [], {}


def _verify_vina_row(row, output_root: Path, receptor_sha: str) -> None:
    _require(row.get("status") == "success", "Vina docking did not succeed.")
    _require(_finite(row.get("best_affinity_kcal_mol")), "Vina affinity is non-finite.")
    _require(row.get("prepared_receptor_sha256") == receptor_sha, "Vina receptor SHA changed.")
    pose_relative = row.get("pose_file")
    _require(isinstance(pose_relative, str) and pose_relative, "Vina pose path is missing.")
    pose = output_root / pose_relative
    _require(pose.is_file(), "Vina pose file is missing.")
    _require(sha256_file(pose) == row.get("pose_sha256"), "Vina pose SHA mismatch.")


def _qualify_combined_pipeline(config, factories, output_dir, family_results, *, test_mode: bool):
    required = ("chemberta", "gmc_mpnn_bbb", "chemprop_regression", "vina")
    expected_success = MOCK_TESTED_ONLY if test_mode else PASS
    if any(family_results[name]["status"] != expected_success for name in required):
        return {"status": NOT_RUN_ASSET_MISSING, "checks": [], "reason": "all real scientific families must pass first", "predictions": []}
    if factories.pipeline_runner is None or factories.vina_factory is None:
        return {"status": NOT_RUN_ASSET_MISSING, "checks": [], "reason": "combined pipeline dependency unavailable", "predictions": []}
    try:
        receptor = validate_prepared_receptor(config.receptor)
        box = VinaBoxConfig.from_mapping(config.__dict__)
        docking_engine = factories.vina_factory(
            receptor,
            box,
            output_root=output_dir / "combined_vina",
            vina_executable=config.vina_executable,
            obabel_executable=config.obabel_executable,
        )
        registry = ADMETRegistry(
            chemberta_factory=factories.chemberta_factory,
            gmc_factory=factories.gmc_factory,
            regression_factory=factories.regression_factory,
        )
        rows = factories.pipeline_runner(
            [dict(record) for record in FIXED_MOLECULES],
            admet_registry=registry,
            enable_docking=True,
            receptor=receptor,
            docking_config=box,
            docking_engine=docking_engine,
            docking_output_root=output_dir / "combined_vina",
        )
        _verify_combined_rows(rows)
        return {
            "status": MOCK_TESTED_ONLY if test_mode else PASS,
            "checks": ["actual_pipeline", "family_isolation", "docking_required_for_rank", "task4_arithmetic", "private_paths_absent"],
            "predictions": rows,
        }
    except Exception as exc:
        result = _failed_result(exc)
        result["predictions"] = []
        return result


def _verify_combined_rows(rows: Sequence[Mapping[str, object]]) -> None:
    _require(len(rows) == len(FIXED_MOLECULES), "Combined pipeline row count changed.")
    by_id = {row.get("molecule_id"): row for row in rows}
    invalid = by_id["acceptance_invalid"]
    _require(invalid.get("admet_model_status") == "not_run_invalid_molecule", "Invalid molecule entered ADMET.")
    _require(invalid.get("docking_status") == "not_run_invalid_molecule", "Invalid molecule entered docking.")
    _require(invalid.get("scientific_rank") is None, "Invalid molecule received a scientific rank.")
    for molecule_id, row in by_id.items():
        if molecule_id == "acceptance_invalid":
            continue
        docking_status = row.get("docking_status")
        if docking_status == "success":
            _require(row.get("scientific_rank") is not None, "Docked molecule has no scientific rank.")
            priority = float(row["priority_score"])
            normalized = float(row["normalized_docking_score"])
            expected = round(priority * 0.70 + normalized * 0.30, 3)
            _require(row.get("scientific_ranking_score") == expected, "Task 4 combined arithmetic changed.")
        else:
            _require(row.get("scientific_rank") is None, "Undocked molecule received a scientific rank.")
        _require(row.get("admet_predictions") is not None, "Docking erased ADMET results.")
    _require(not _contains_private_path(rows), "Combined results expose a private path.")


def _external_family_provenance(predictor, spec, runner_hash, rows):
    return {
        "runner_identity": spec.get("runner_identity"),
        "runner_sha256": runner_hash,
        "runner_resolution_source": getattr(predictor, "runner_source", "test_double"),
        "python_resolution_source": getattr(predictor, "python_source", "test_double"),
        "runtime_versions": dict(getattr(predictor, "runtime_versions", {})),
        "production_manifest_identity": {
            key: rows[0].get(key)
            for key in (
                "manifest_version",
                "model_interface_version",
                "manifest_schema_version",
                "manifest_sha256",
                "release_status",
                "model_family",
            )
            if rows and rows[0].get(key) is not None
        },
        "test_artifact_accessed": False,
    }


def _family_resource_spec(application_root: Path, family: str) -> Mapping[str, object]:
    path = Path(application_root) / "resources" / "admet" / "runtime_manifest.json"
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    _require(payload.get("schema_version") == "moloptima-admet-runtime-resources-v1", "Runtime resource manifest is unsupported.")
    return payload["families"][family]


def _runtime_manifest_version(application_root: Path) -> str | None:
    try:
        payload = json.loads(
            (Path(application_root) / "resources" / "admet" / "runtime_manifest.json").read_text(
                encoding="utf-8-sig"
            )
        )
        return payload.get("schema_version")
    except (OSError, json.JSONDecodeError):
        return None


def _passed_result(test_mode: bool, checks: list[str], provenance: dict[str, object]):
    return {
        "status": MOCK_TESTED_ONLY if test_mode else PASS,
        "checks": checks,
        "reason": "test doubles exercised; not real-runtime qualification" if test_mode else "real execution and contract checks passed",
        "provenance": provenance,
    }


def _failed_result(exc: Exception) -> dict[str, object]:
    message = str(exc)
    lowered = message.lower()
    if any(code in lowered for code in ("packaged_runtime_missing", "runtime_override_invalid", "runtime is unavailable")):
        status, code = NOT_RUN_RUNTIME_MISSING, "runtime_missing"
    elif any(
        code in lowered
        for code in (
            "model_release_missing",
            "packaged_runner_missing",
            "not configured or packaged",
            "asset missing",
            "incomplete admet model bundle",
            "frozen runtime archive is missing",
            "prepared receptor file is missing",
        )
    ):
        status, code = NOT_RUN_ASSET_MISSING, "asset_missing"
    elif "runtime_incompatible" in lowered:
        status, code = FAIL, "runtime_incompatible"
    elif "hash" in lowered or "sha-256" in lowered:
        status, code = FAIL, "hash_mismatch"
    else:
        status, code = FAIL, "qualification_check_failed"
    return {"status": status, "checks": [], "error_code": code, "reason": _safe_error(message)}


def _overall_status(families: Mapping[str, Mapping[str, object]], *, test_mode: bool) -> str:
    statuses = [value["status"] for value in families.values()]
    if test_mode:
        return MOCK_TESTED_ONLY
    if statuses and all(status == PASS for status in statuses):
        return PASS
    if any(status == FAIL for status in statuses):
        return FAIL
    if any(status == NOT_RUN_RUNTIME_MISSING for status in statuses):
        return NOT_RUN_RUNTIME_MISSING
    return NOT_RUN_ASSET_MISSING


def _same_float(actual: object, expected: float) -> bool:
    try:
        return math.isclose(
            float(actual),
            expected,
            rel_tol=DETERMINISM_RELATIVE_TOLERANCE,
            abs_tol=1e-10,
        )
    except (TypeError, ValueError):
        return False


def _finite(value: object) -> bool:
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def _git_commit(root: Path) -> str | None:
    try:
        completed = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=root,
            capture_output=True,
            text=True,
            shell=False,
            check=False,
            timeout=10,
        )
        value = completed.stdout.strip()
        return value if completed.returncode == 0 and re.fullmatch(r"[0-9a-f]{40}", value) else None
    except (OSError, subprocess.SubprocessError):
        return None


def sanitize_private_paths(value: object) -> object:
    if isinstance(value, dict):
        return {str(key): sanitize_private_paths(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [sanitize_private_paths(item) for item in value]
    if isinstance(value, Path):
        return value.name
    if isinstance(value, str):
        return _safe_error(value)
    return value


def _safe_error(message: str) -> str:
    safe = _PRIVATE_WINDOWS_PATH.sub("<redacted-path>", message)
    home = str(Path.home())
    if home:
        safe = safe.replace(home, "<redacted-path>")
    return safe[:1200]


def _contains_private_path(value: object) -> bool:
    serialized = json.dumps(value, default=str)
    return bool(_PRIVATE_WINDOWS_PATH.search(serialized) or str(Path.home()) in serialized)


def _write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _write_checksums(output_dir: Path) -> None:
    lines = []
    for path in sorted(item for item in output_dir.rglob("*") if item.is_file() and item.name != "SHA256SUMS"):
        lines.append(f"{sha256_file(path)}  {path.relative_to(output_dir).as_posix()}")
    (output_dir / "SHA256SUMS").write_text("\n".join(lines) + "\n", encoding="ascii")
