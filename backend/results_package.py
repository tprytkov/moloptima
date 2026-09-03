"""Deterministic, job-scoped MolOptima result bundles built from persisted outputs."""

from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import shutil
import zipfile
from pathlib import Path
from typing import Mapping

from rdkit import Chem
from rdkit.Chem import rdDepictor

from molecular_prioritization.admet_runtime import portable_runtime_identities
from molecular_prioritization.prioritization_profiles import PrioritizationProfile, profile_sha256


class ResultsPackageError(ValueError):
    """Persisted results cannot be exported without inventing or mismatching data."""


IDENTITY = [
    "molecule_id", "source_type", "source_filename", "source_record", "input_smiles",
    "canonical_smiles", "original_structure_sha256", "coordinate_status", "input_has_3d",
]
VALIDATION = [
    "structure_valid", "validation_status", "failure_reason", "duplicate_status",
]
PROPERTIES = [
    "mw", "tpsa", "hbd", "hba", "rotatable_bonds", "qed", "sa_score",
    "synthetic_feasibility_category", "lipinski_violations", "lipinski_pass",
    "structural_alert_status", "structural_alert_count", "structural_alert_categories",
    "structural_alert_names", "pains_alert", "brenk_alert", "medchem_alert_summary",
]
DOCKING = [
    "docking_status", "best_vina_affinity_kcal_mol", "best_mode", "modes_requested",
    "modes_returned", "best_mode_rmsd_lb", "best_mode_rmsd_ub", "docking_rank", "docking_percentile",
    "delta_vina_vs_reference_kcal_mol", "pose_artifact", "docking_warning", "docking_error",
]
PROFILE = [
    "prioritization_method", "profile_id", "profile_version", "profile_status", "profile_sha256",
]
PRIORITIZATION = [
    "docking_component", "admet_component", "molecular_quality_component", "safety_component",
    "base_score", "combined_liability_factor", "final_score", "final_rank", "rank_eligible",
    "prioritization_status", "warnings", "pareto_front",
]


def build_results_package(
    *,
    job_dir: Path,
    job: Mapping[str, object],
    rows: list[dict[str, object]],
    molecule_manifest: Mapping[str, object] | None = None,
    receptor_root: Path | None = None,
) -> dict[str, object]:
    """Materialize a deterministic package under the existing job directory."""

    mode = str(job.get("analysis_mode") or "library")
    if mode not in {"single_compound", "library"}:
        raise ResultsPackageError("Unsupported analysis mode in persisted job metadata.")
    merged = _merge_source_records(rows, molecule_manifest or {})
    build_dir = (job_dir / ".results-building").resolve()
    result_dir = (job_dir / "results").resolve()
    if build_dir.parent != job_dir.resolve() or result_dir.parent != job_dir.resolve():
        raise ResultsPackageError("Unsafe results package destination.")
    shutil.rmtree(build_dir, ignore_errors=True)
    build_dir.mkdir(parents=True)

    v2_run = str(job.get("prioritization_method") or "legacy_v1") == "v2"
    pareto = _read_optional_json(job_dir / "analysis" / "pareto.json") if v2_run else None
    sensitivity = _read_optional_json(job_dir / "analysis" / "sensitivity.json") if v2_run else None
    profile = _validated_profile(job)
    if sensitivity is not None:
        expected = str(job.get("prioritization_profile_sha256") or "")
        actual = str((sensitivity.get("provenance") or {}).get("source_profile_sha256") or "")
        if not expected or actual != expected:
            raise ResultsPackageError("Sensitivity profile/result SHA mismatch; package generation failed closed.")

    export_rows = [_export_row(row, pareto, include_v2=v2_run) for row in merged]
    if mode == "single_compound":
        _build_single(build_dir, job, export_rows, profile)
    else:
        _build_library(build_dir, job, export_rows, profile, pareto, sensitivity)

    if _docking_ran(job, export_rows):
        _write_csv(build_dir / "docking_results.csv", [_docking_row(row, mode) for row in export_rows])
        _copy_docking(job_dir, build_dir / "docking")
    receptor_provenance = _copy_receptor(job, receptor_root, build_dir / "receptor")

    inventory = sorted(
        path.relative_to(build_dir).as_posix()
        for path in build_dir.rglob("*") if path.is_file()
    )
    summary = _run_summary(
        job, export_rows, mode, profile, pareto, sensitivity, inventory, receptor_provenance,
    )
    _write_json(build_dir / "run_summary.json", summary)
    _write_readme(build_dir / "README.md", mode, pareto is not None, sensitivity is not None)
    _write_manifest_and_hashes(build_dir)

    shutil.rmtree(result_dir, ignore_errors=True)
    build_dir.replace(result_dir)
    zip_path = job_dir / "results_package.zip"
    _write_deterministic_zip(result_dir, zip_path)
    manifest = json.loads((result_dir / "results_manifest.json").read_text(encoding="utf-8"))
    return {
        "job_id": job.get("job_id"), "analysis_mode": mode,
        "results_directory": "results", "zip_filename": zip_path.name,
        "artifacts": manifest["artifacts"],
        "pareto_status": "available" if pareto else "not_run",
        "sensitivity_status": "available" if sensitivity else "not_run",
    }


def _build_single(
    root: Path, job: Mapping[str, object], rows: list[dict[str, object]], profile: dict[str, object] | None,
) -> None:
    valid = next((row for row in rows if row["structure_valid"] is True), rows[0] if rows else {})
    forbidden = {
        "final_rank", "scientific_rank", "v2_rank", "docking_rank", "docking_rank_within_run",
        "docking_percentile", "docking_percentile_within_run", "pareto_front", "rank_eligible",
        "v2_rank_eligible", "priority_score", "scientific_ranking_score", "v2_score",
        "combined_candidate_score",
        "docking_component", "admet_component", "molecular_quality_component", "safety_component",
        "base_score", "combined_liability_factor", "final_score", "prioritization", "prioritization_v2",
    }
    compound = {key: value for key, value in valid.items() if key not in forbidden}
    _write_csv(root / "compound_results.csv", [compound])
    _write_json(root / "compound_report.json", _json_safe({
        "analysis_mode": "single_compound", "compound": compound,
        "limitations": [
            "No library ranking, Pareto front, sensitivity rank, or library-relative docking percentile is calculated."
        ],
    }))
    _write_csv(root / "admet_results.csv", [_select_prefixed(valid, ("admet.", "bbb.", "regression."), IDENTITY[:1])])
    _write_csv(root / "molecular_properties.csv", [{key: valid.get(key) for key in IDENTITY[:1] + PROPERTIES}])
    if profile is not None:
        _write_json(root / "selected_profile.json", profile)
    if valid.get("structure_valid") is True:
        _write_sdf(root / "compound.sdf", [valid])


def _build_library(
    root: Path,
    job: Mapping[str, object],
    rows: list[dict[str, object]],
    profile: dict[str, object] | None,
    pareto: dict[str, object] | None,
    sensitivity: dict[str, object] | None,
) -> None:
    _write_csv(root / "all_compounds_results.csv", rows)
    eligible = sorted(
        (row for row in rows if row.get("rank_eligible") is True and row.get("final_rank") is not None),
        key=lambda row: (int(row["final_rank"]), str(row.get("molecule_id") or "").casefold()),
    )
    _write_csv(root / "prioritized_compounds.csv", eligible)
    if profile is not None:
        _write_json(root / "prioritization_profile.json", profile)
    if eligible:
        _write_sdf(root / "prioritized_compounds.sdf", eligible)
        visual = root / "visualizations"
        visual.mkdir()
        _write_score_distribution(visual / "final_score_distribution.svg", eligible)
    if pareto is not None:
        pareto_rows = [_pareto_csv_row(item) for item in list(pareto.get("results") or [])]
        _write_csv(root / "pareto_results.csv", pareto_rows)
        visual = root / "visualizations"
        visual.mkdir(exist_ok=True)
        _write_pareto_svg(visual / "pareto_docking_vs_admet.svg", pareto_rows, "docking", "admet")
        _write_pareto_svg(visual / "pareto_admet_vs_safety.svg", pareto_rows, "admet", "safety")
    if sensitivity is not None:
        sensitivity_rows = [_sensitivity_csv_row(item, sensitivity) for item in list(sensitivity.get("results") or [])]
        _write_csv(root / "sensitivity_results.csv", sensitivity_rows)
        visual = root / "visualizations"
        visual.mkdir(exist_ok=True)
        _write_sensitivity_svg(visual / "sensitivity_top_candidates.svg", sensitivity_rows)


def _merge_source_records(
    rows: list[dict[str, object]], manifest: Mapping[str, object],
) -> list[dict[str, object]]:
    source_records = list(manifest.get("records") or [])
    if not source_records:
        return [dict(row) for row in rows]
    by_id = {str(row.get("molecule_id") or ""): row for row in rows}
    return [{**record, **dict(by_id.get(str(record.get("molecule_id") or ""), {}))} for record in source_records]


def _export_row(
    row: Mapping[str, object], pareto: dict[str, object] | None, *, include_v2: bool,
) -> dict[str, object]:
    result = dict(row)
    docking = row.get("docking_result") if isinstance(row.get("docking_result"), Mapping) else {}
    admet = row.get("admet_predictions") if isinstance(row.get("admet_predictions"), Mapping) else {}
    bbb = row.get("bbb_result") if isinstance(row.get("bbb_result"), Mapping) else {}
    regression = row.get("admet_regression") if isinstance(row.get("admet_regression"), Mapping) else {}
    explanation = row.get("prioritization_v2") if include_v2 and isinstance(row.get("prioritization_v2"), Mapping) else {}
    summary = explanation.get("summary") if isinstance(explanation.get("summary"), Mapping) else {}
    components = explanation.get("components") if isinstance(explanation.get("components"), Mapping) else {}
    liabilities = explanation.get("liabilities") if isinstance(explanation.get("liabilities"), Mapping) else {}
    provenance = explanation.get("provenance") if isinstance(explanation.get("provenance"), Mapping) else {}
    best_mode = docking.get("best_mode")
    modes = docking.get("modes") if isinstance(docking.get("modes"), list) else []
    best_mode_record = next(
        (mode for mode in modes if isinstance(mode, Mapping) and mode.get("mode") == best_mode), {},
    )
    result.update({
        "structure_valid": _true(row.get("valid_molecule")) or row.get("validation_status") == "valid",
        "duplicate_status": "duplicate" if _true(row.get("duplicate_structure")) else "unique",
        "docking_status": docking.get("status") or row.get("docking_status"),
        "best_vina_affinity_kcal_mol": docking.get("best_vina_affinity_kcal_mol") or row.get("best_vina_affinity_kcal_mol"),
        "best_mode": docking.get("best_mode"),
        "modes_requested": docking.get("requested_num_modes"), "modes_returned": docking.get("returned_mode_count"),
        "best_mode_rmsd_lb": best_mode_record.get("rmsd_lb"),
        "best_mode_rmsd_ub": best_mode_record.get("rmsd_ub"),
        "docking_rank": row.get("docking_rank_within_run"), "docking_percentile": row.get("docking_percentile_within_run"),
        "delta_vina_vs_reference_kcal_mol": row.get("delta_vina_vs_reference_kcal_mol"),
        "pose_artifact": docking.get("pose_file"), "docking_warning": docking.get("warning"),
        "docking_error": docking.get("error_message"),
        "final_score": row.get("scientific_ranking_score") if row.get("scientific_ranking_score") is not None else row.get("v2_score"),
        "final_rank": row.get("scientific_rank") if row.get("scientific_rank") is not None else row.get("v2_rank"),
        "rank_eligible": _true(row.get("rank_eligible")) or _true(row.get("v2_rank_eligible")),
        "base_score": summary.get("base_score"),
        "combined_liability_factor": summary.get("combined_liability_penalty_factor"),
        "docking_component": _component_score(components, "docking"),
        "admet_component": _component_score(components, "admet"),
        "molecular_quality_component": _component_score(components, "molecular_quality"),
        "safety_component": liabilities.get("combined_penalty_factor"),
        "profile_id": provenance.get("profile_id"), "profile_version": provenance.get("profile_version"),
        "profile_status": provenance.get("profile_status"), "profile_sha256": provenance.get("profile_sha256"),
    })
    result.update(_flatten(admet, "admet"))
    result.update(_flatten(bbb, "bbb"))
    result.update(_flatten(regression, "regression"))
    result.update(_flatten(explanation.get("endpoint_scoring") or {}, "profile_endpoint"))
    result.update(_flatten(liabilities, "profile_liability"))
    if explanation.get("warnings"):
        result["profile_warnings"] = _csv_value(explanation.get("warnings"))
    if not include_v2:
        for key in (
            "prioritization_v2", "v2_score", "v2_rank", "v2_rank_eligible",
            "docking_component", "admet_component", "molecular_quality_component", "safety_component",
            "base_score", "combined_liability_factor", "profile_id", "profile_version",
            "profile_status", "profile_sha256", "profile_warnings",
        ):
            result.pop(key, None)
        for key in [name for name in result if name.startswith(("profile_endpoint.", "profile_liability."))]:
            result.pop(key, None)
    if pareto:
        found = next((item for item in pareto.get("results", []) if item.get("molecule_id") == row.get("molecule_id")), None)
        result["pareto_front"] = found.get("pareto_front") if found else None
    return _json_safe(result)


def _component_score(components: Mapping[str, object], name: str) -> object:
    component = components.get(name)
    return component.get("score") if isinstance(component, Mapping) else None


def _flatten(value: Mapping[str, object], prefix: str) -> dict[str, object]:
    result: dict[str, object] = {}
    for key in sorted(value):
        item = value[key]
        name = f"{prefix}.{key}"
        if isinstance(item, Mapping):
            result.update(_flatten(item, name))
        else:
            result[name] = json.dumps(item, sort_keys=True, separators=(",", ":")) if isinstance(item, list) else item
    return result


def _select_prefixed(row: Mapping[str, object], prefixes: tuple[str, ...], leading: list[str]) -> dict[str, object]:
    return {key: row.get(key) for key in leading + sorted(key for key in row if key.startswith(prefixes))}


def _docking_row(row: Mapping[str, object], mode: str) -> dict[str, object]:
    keys = IDENTITY[:1] + DOCKING
    if mode == "single_compound":
        keys = [key for key in keys if key not in {"docking_rank", "docking_percentile", "delta_vina_vs_reference_kcal_mol"}]
    return {key: row.get(key) for key in keys}


def _docking_ran(job: Mapping[str, object], rows: list[dict[str, object]]) -> bool:
    return bool(job.get("docking_requested")) and any(row.get("docking_status") not in {None, "", "not_requested"} for row in rows)


def _validated_profile(job: Mapping[str, object]) -> dict[str, object] | None:
    payload = job.get("prioritization_profile")
    if not isinstance(payload, Mapping):
        return None
    profile = PrioritizationProfile.from_dict(dict(payload))
    actual = profile_sha256(profile)
    expected = str(job.get("prioritization_profile_sha256") or "")
    if not expected or actual != expected:
        raise ResultsPackageError("Persisted prioritization profile SHA mismatch; package generation failed closed.")
    return profile.to_dict()


def _copy_receptor(
    job: Mapping[str, object], receptor_root: Path | None, destination: Path,
) -> dict[str, object] | None:
    receptor_id = str(job.get("receptor_id") or "")
    if receptor_root is None or not receptor_id or Path(receptor_id).name != receptor_id:
        return None
    resource = (receptor_root / receptor_id).resolve()
    if resource.parent != receptor_root.resolve() or not resource.is_dir():
        return None
    metadata_path = resource / "metadata.json"
    if not metadata_path.is_file():
        return None
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    candidates: dict[str, Path] = {}
    for field, export_name in (
        ("original_pdb", "original_receptor.pdb"),
        ("prepared_pdbqt", "prepared_receptor.pdbqt"),
        ("preparation_provenance", "receptor_preparation.json"),
        ("preparation_sha256sums", "receptor_SHA256SUMS"),
    ):
        relative = metadata.get(field)
        if relative:
            source = (resource / str(relative)).resolve()
            if resource in source.parents and source.is_file():
                candidates[export_name] = source
    prepared = candidates.get("prepared_receptor.pdbqt")
    if prepared:
        for name in ("selected_receptor_input.pdb", "meeko_receptor.json"):
            source = prepared.parent / name
            if source.is_file():
                candidates[name] = source
    if candidates:
        destination.mkdir()
        for name, source in sorted(candidates.items()):
            shutil.copyfile(source, destination / name)
    summary = {
        key: metadata.get(key) for key in (
            "preparation_method", "preparation_tool", "preparation_tool_version",
            "preparation_warnings", "source_receptor_sha256", "docking_receptor_sha256",
        ) if metadata.get(key) is not None
    }
    preparation = candidates.get("receptor_preparation.json")
    if preparation is not None:
        try:
            detail = json.loads(preparation.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            detail = {}
        if isinstance(detail, Mapping):
            summary["qualified_preparation"] = {
                key: detail.get(key) for key in (
                    "schema_version", "meeko_version", "gemmi_version", "validation_status",
                    "validation_result", "prepared_pdbqt_sha256", "original_pdb_sha256",
                    "hydrogen_handling_method", "hydrogen_handling_status", "hydrogen_optimization",
                ) if detail.get(key) is not None
            }
    return _json_safe(summary)


def _copy_docking(job_dir: Path, destination: Path) -> None:
    source = job_dir / "docking"
    files = []
    for relative in ("docking_results.jsonl",):
        if (source / relative).is_file():
            files.append((source / relative, Path(relative)))
    poses = source / "poses"
    if poses.is_dir():
        files.extend((path, Path("poses") / path.name) for path in sorted(poses.glob("*.pdbqt")))
    for source_path, relative in files:
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_path, target)


def _run_summary(job, rows, mode, profile, pareto, sensitivity, inventory, receptor_provenance):
    return _json_safe({
        "analysis_mode": mode, "job_id": job.get("job_id"), "created_at": job.get("created_at"),
        "started_at": job.get("started_at"), "completed_at": job.get("completed_at"),
        "submitted_count": job.get("submitted_count", len(rows)),
        "valid_count": sum(row.get("structure_valid") is True for row in rows),
        "invalid_count": sum(row.get("structure_valid") is not True for row in rows),
        "admet_success_count": job.get("admet_success_count"), "docking_success_count": job.get("docking_success_count"),
        "prioritization_eligibility_count": sum(row.get("rank_eligible") is True for row in rows),
        "receptor_source": job.get("receptor_source"), "receptor_id": job.get("receptor_id"),
        "prepared_receptor_sha256": job.get("prepared_receptor_sha256"),
        "receptor_preparation_provenance": receptor_provenance,
        "receptor_hydrogen_representation_policy": "autodock_polar_hydrogen_united_atom",
        "ligand_hydrogen_representation": "autodock_united_atom_polar_donor_hydrogens_explicit",
        "vina_runtime_identity": next((row.get("docking_result", {}).get("vina_version") for row in rows if isinstance(row.get("docking_result"), Mapping)), None),
        "admet_runtime_identities": portable_runtime_identities(job.get("admet_runtime_identities")),
        "selected_profile": {"profile_id": profile.get("profile_id"), "profile_version": profile.get("profile_version"), "profile_sha256": job.get("prioritization_profile_sha256")} if profile else None,
        "pareto_status": "available" if pareto else "not_run",
        "sensitivity_status": "available" if sensitivity else "not_run",
        "exported_artifact_inventory": sorted(set(inventory + ["run_summary.json", "README.md", "results_manifest.json", "SHA256SUMS"])),
    })


def _pareto_csv_row(item: Mapping[str, object]) -> dict[str, object]:
    objectives = item.get("objective_values") if isinstance(item.get("objective_values"), Mapping) else {}
    return {
        "molecule_id": item.get("molecule_id"), "scalar_rank": item.get("scalar_rank"),
        "pareto_front": item.get("pareto_front"), "docking": objectives.get("docking"),
        "admet": objectives.get("admet"), "molecular_quality": objectives.get("molecular_quality"),
        "safety": objectives.get("safety"),
    }


def _sensitivity_csv_row(item: Mapping[str, object], analysis: Mapping[str, object]) -> dict[str, object]:
    provenance = analysis.get("provenance") if isinstance(analysis.get("provenance"), Mapping) else {}
    return {
        "molecule_id": item.get("molecule_id"), "baseline_rank": item.get("baseline_rank"),
        "min_rank": item.get("minimum_rank"), "max_rank": item.get("maximum_rank"),
        "median_rank": item.get("median_rank"), "perturbation_magnitude": provenance.get("perturbation_magnitude"),
        "sample_count": provenance.get("number_of_samples"), "seed": provenance.get("analysis_seed"),
        "top_1_frequency": item.get("top_1_frequency"), "top_5_frequency": item.get("top_5_frequency"),
        "top_10_frequency": item.get("top_10_frequency"),
    }


def _write_csv(path: Path, rows: list[Mapping[str, object]], excluded: set[str] | None = None) -> None:
    if not rows:
        return
    excluded = excluded or set()
    leading = IDENTITY + VALIDATION + PROPERTIES + DOCKING + PRIORITIZATION + PROFILE
    keys = {key for row in rows for key in row if key not in excluded}
    fieldnames = [key for key in leading if key in keys and key not in excluded] + sorted(keys - set(leading) - excluded)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({key: _csv_value(row.get(key)) for key in fieldnames})


def _write_sdf(path: Path, rows: list[Mapping[str, object]]) -> None:
    writer = Chem.SDWriter(str(path))
    written = 0
    for row in rows:
        molecule = Chem.MolFromSmiles(str(row.get("canonical_smiles") or ""))
        if molecule is None:
            continue
        rdDepictor.Compute2DCoords(molecule)
        molecule.SetProp("_Name", str(row.get("molecule_id") or f"compound_{written + 1}"))
        for key in ("final_rank", "final_score", "best_vina_affinity_kcal_mol", "profile_id", "profile_version", "profile_sha256", "admet.hia_hou.calibrated_probability", "bbb.probability"):
            value = row.get(key)
            if value not in (None, ""):
                molecule.SetProp(key, str(value))
        writer.write(molecule); written += 1
    writer.close()
    if written == 0:
        path.unlink(missing_ok=True)


def _write_pareto_svg(path: Path, rows: list[Mapping[str, object]], x: str, y: str) -> None:
    points = [row for row in rows if _finite(row.get(x)) is not None and _finite(row.get(y)) is not None]
    body = []
    for row in points:
        px = 70 + 500 * float(row[x]); py = 350 - 280 * float(row[y])
        color = "#0b7285" if row.get("pareto_front") == 1 else "#94a3b8"
        body.append(f'<circle cx="{px:.2f}" cy="{py:.2f}" r="5" fill="{color}"/>')
        if int(row.get("scalar_rank") or 999999) <= 10:
            body.append(f'<text x="{px + 7:.2f}" y="{py - 5:.2f}" font-size="10">{_xml(row.get("molecule_id"))}</text>')
    _write_svg(path, f"Pareto: {x} vs {y}", x, y, "".join(body))


def _write_score_distribution(path: Path, rows: list[Mapping[str, object]]) -> None:
    values = [float(value) for row in rows if (value := _finite(row.get("final_score"))) is not None]
    bins = [0] * 10
    for value in values:
        bins[min(9, max(0, int(value * 10)))] += 1
    maximum = max(bins) if bins else 1
    body = "".join(f'<rect x="{70+i*50}" y="{350-(260*count/max(1,maximum)):.2f}" width="42" height="{260*count/max(1,maximum):.2f}" fill="#0b7285"/>' for i, count in enumerate(bins))
    _write_svg(path, "Computational prioritization score distribution", "Computational prioritization score", "Count", body)


def _write_sensitivity_svg(path: Path, rows: list[Mapping[str, object]]) -> None:
    top = sorted(rows, key=lambda row: (int(row.get("baseline_rank") or 999999), str(row.get("molecule_id") or "")))[:10]
    body = "".join(f'<line x1="{90}" x2="{90+30*float(row.get("max_rank") or 0)}" y1="{80+i*25}" y2="{80+i*25}" stroke="#0b7285" stroke-width="5"/><text x="10" y="{84+i*25}" font-size="10">{_xml(row.get("molecule_id"))}</text>' for i, row in enumerate(top))
    _write_svg(path, "Sensitivity rank ranges", "Rank range", "Candidate", body)


def _write_svg(path: Path, title: str, x_label: str, y_label: str, body: str) -> None:
    content = f'''<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420"><rect width="640" height="420" fill="white"/><text x="320" y="28" text-anchor="middle" font-family="sans-serif" font-size="16">{_xml(title)}</text><line x1="70" y1="350" x2="580" y2="350" stroke="#334155"/><line x1="70" y1="350" x2="70" y2="60" stroke="#334155"/><text x="325" y="400" text-anchor="middle" font-family="sans-serif" font-size="12">{_xml(x_label)}</text><text x="18" y="205" transform="rotate(-90 18 205)" text-anchor="middle" font-family="sans-serif" font-size="12">{_xml(y_label)}</text>{body}</svg>'''
    path.write_text(content + "\n", encoding="utf-8")


def _write_readme(path: Path, mode: str, pareto: bool, sensitivity: bool) -> None:
    mode_text = (
        "This is a compound-level computational assessment. No library ranking is performed; Pareto and sensitivity are not applicable."
        if mode == "single_compound" else
        f"prioritized_compounds.csv is rank-sorted. Pareto is explanatory ({'available' if pareto else 'not run'}); sensitivity is optional ({'available' if sensitivity else 'not run'})."
    )
    path.write_text(
        "# MolOptima Results\n\n" + mode_text + "\n\n"
        "Vina score is not experimental binding free energy. Classifier outputs are model outputs, not measured percentages. "
        "GMC BBB output is raw/provisional, not a calibrated probability. Receptor preparation does not determine the "
        "biologically correct protonation state. Prioritization is computational decision support.\n",
        encoding="utf-8",
    )


def _write_manifest_and_hashes(root: Path) -> None:
    artifacts = []
    for path in sorted(item for item in root.rglob("*") if item.is_file() and item.name not in {"results_manifest.json", "SHA256SUMS"}):
        relative = path.relative_to(root).as_posix()
        artifacts.append({"relative_path": relative, "artifact_type": _artifact_type(path), "sha256": _sha(path), "description": _description(relative)})
    _write_json(root / "results_manifest.json", {"schema_version": "moloptima-results-package-v1", "artifacts": artifacts})
    hash_files = sorted(item for item in root.rglob("*") if item.is_file() and item.name != "SHA256SUMS")
    (root / "SHA256SUMS").write_text("".join(f"{_sha(path)}  {path.relative_to(root).as_posix()}\n" for path in hash_files), encoding="utf-8")


def _write_deterministic_zip(root: Path, target: Path) -> None:
    temporary = target.with_suffix(".zip.tmp")
    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(item for item in root.rglob("*") if item.is_file()):
            info = zipfile.ZipInfo(f"results/{path.relative_to(root).as_posix()}", date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED; info.external_attr = 0o644 << 16
            archive.writestr(info, path.read_bytes())
    temporary.replace(target)


def _read_optional_json(path: Path) -> dict[str, object] | None:
    if not path.is_file(): return None
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict): raise ResultsPackageError(f"Stored analysis is invalid: {path.name}")
    return value


def _write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(_json_safe(value), indent=2, sort_keys=True, allow_nan=False) + "\n", encoding="utf-8")


def _json_safe(value):
    if isinstance(value, Mapping): return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, list): return [_json_safe(item) for item in value]
    if isinstance(value, tuple): return [_json_safe(item) for item in value]
    if isinstance(value, float) and not math.isfinite(value): return None
    return value


def _csv_value(value):
    if isinstance(value, (dict, list, tuple)): return json.dumps(_json_safe(value), sort_keys=True, separators=(",", ":"))
    return "" if value is None else value


def _finite(value):
    try: number = float(value)
    except (TypeError, ValueError): return None
    return number if math.isfinite(number) else None


def _true(value: object) -> bool:
    return value is True or str(value).strip().casefold() in {"true", "1", "yes"}


def _artifact_type(path: Path) -> str: return path.suffix.lower().lstrip(".") or "text"
def _description(relative: str) -> str: return relative.replace("_", " ").replace("/", " / ")
def _sha(path: Path) -> str: return hashlib.sha256(path.read_bytes()).hexdigest()
def _xml(value) -> str: return str(value or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
