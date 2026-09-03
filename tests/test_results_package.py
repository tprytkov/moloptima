from __future__ import annotations

import csv
import hashlib
import json
import zipfile
from pathlib import Path
from xml.etree import ElementTree

import pytest
from rdkit import Chem

from backend.results_package import ResultsPackageError, build_results_package
from backend.services import _deserialize_result_row
from molecular_prioritization.builtin_profiles import load_builtin_profile
from molecular_prioritization.prioritization_profiles import profile_sha256
from molecular_prioritization.prioritization_profiles import PrioritizationProfile


PROFILE = load_builtin_profile("moloptima_cns_literature_v2", "1.0.0")


def row(molecule_id: str, rank: int | None, *, valid=True, eligible=True):
    score = None if rank is None else 0.9 - rank / 10
    explanation = {
        "summary": {"base_score": score, "combined_liability_penalty_factor": 0.9, "final_score": score},
        "components": {
            "docking": {"score": 0.8}, "admet": {"score": 0.7},
            "molecular_quality": {"score": 0.6},
        },
        "liabilities": {"combined_penalty_factor": 0.9},
        "endpoint_scoring": {"QED": {"desirability": 0.75}},
        "provenance": {
            "profile_id": PROFILE.profile_id, "profile_version": PROFILE.profile_version,
            "profile_status": PROFILE.status, "profile_sha256": profile_sha256(PROFILE),
        },
    }
    return {
        "molecule_id": molecule_id, "source_type": "smiles", "source_filename": "",
        "source_record": "line:1", "input_smiles": "CCO" if valid else "bad",
        "canonical_smiles": "CCO" if valid else "", "valid_molecule": valid,
        "validation_status": "valid" if valid else "invalid", "failure_reason": "" if valid else "invalid_smiles",
        "original_structure_sha256": "a" * 64 if valid else "", "input_has_3d": False,
        "duplicate_structure": False, "mw": 46.07, "tpsa": 20.2, "hbd": 1, "hba": 1,
        "rotatable_bonds": 0, "qed": 0.4, "sa_score": 2.0,
        "admet_model_status": "model_available" if valid else "not_run_invalid_molecule",
        "admet_predictions": {"hia_hou": {"calibrated_probability": 0.91, "uncertainty": 0.03}},
        "bbb_result": {"probability": 0.62, "probability_standard_deviation": 0.04, "threshold_status": "provisional_raw"},
        "admet_regression": {"status": "available", "endpoints": {"logp": {"value": 1.2, "uncertainty": 0.2}}},
        "docking_result": {
            "status": "success" if valid else "not_run_invalid_molecule",
            "best_vina_affinity_kcal_mol": -6.5 if valid else None, "best_mode": 1 if valid else None,
            "requested_num_modes": 3, "returned_mode_count": 1 if valid else 0,
            "pose_file": f"docking/poses/{molecule_id}.pdbqt" if valid else None,
            "modes": [{"mode": 1, "rmsd_lb": 0.0, "rmsd_ub": 0.0}] if valid else [],
            "vina_version": "AutoDock Vina test", "warning": "",
        },
        "prioritization_method": "profile_v2", "prioritization_v2": explanation if valid else {},
        "scientific_ranking_score": score, "scientific_rank": rank,
        "v2_score": score, "v2_rank": rank, "rank_eligible": eligible and valid,
        "v2_rank_eligible": eligible and valid, "prioritization_status": "fully_scored" if eligible and valid else "unscorable",
        "docking_rank_within_run": rank, "docking_percentile_within_run": 100 if rank == 1 else 50,
    }


def job(mode: str, tmp_path: Path, *, method="v2"):
    profile = PROFILE.to_dict() if method == "v2" else None
    return {
        "job_id": "job-public-safe", "upload_id": "upload-public-safe", "analysis_mode": mode,
        "prioritization_method": method, "prioritization_profile": profile,
        "prioritization_profile_sha256": profile_sha256(PROFILE) if profile else None,
        "created_at": "2026-01-01T00:00:00+00:00", "started_at": "2026-01-01T00:00:01+00:00",
        "completed_at": "2026-01-01T00:00:02+00:00", "submitted_count": 1 if mode == "single_compound" else 3,
        "admet_success_count": 1 if mode == "single_compound" else 2, "docking_success_count": 1 if mode == "single_compound" else 2,
        "docking_requested": True, "receptor_id": "a" * 32, "receptor_source": "user_supplied_pdbqt",
        "prepared_receptor_sha256": "b" * 64,
    }


def source_manifest(rows):
    return {"records": [{key: value for key, value in item.items() if key in {
        "molecule_id", "source_type", "source_filename", "source_record", "input_smiles",
        "canonical_smiles", "original_structure_sha256", "input_has_3d", "validation_status", "failure_reason",
    }} for item in rows]}


def receptor_fixture(root: Path):
    resource = root / ("a" * 32); (resource / "prepared").mkdir(parents=True)
    (resource / "prepared" / "receptor.pdbqt").write_text(
        "ATOM      1  C   REC A   1       0.000   0.000   0.000  1.00  0.00     0.000 C\n", encoding="utf-8",
    )
    (resource / "metadata.json").write_text(json.dumps({
        "receptor_id": "a" * 32, "prepared_pdbqt": "prepared/receptor.pdbqt",
        "receptor_source": "user_supplied_pdbqt", "preparation_method": "user_supplied_pdbqt",
    }), encoding="utf-8")


def write_docking(job_dir: Path, molecule_ids):
    poses = job_dir / "docking" / "poses"; poses.mkdir(parents=True)
    for molecule_id in molecule_ids:
        (poses / f"{molecule_id}.pdbqt").write_text("MODEL 1\nENDMDL\n", encoding="utf-8")
    (job_dir / "docking" / "docking_results.jsonl").write_text("{}\n", encoding="utf-8")


def read_csv(path):
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def verify_hashes(root: Path):
    for line in (root / "SHA256SUMS").read_text(encoding="utf-8").splitlines():
        digest, relative = line.split("  ", 1)
        assert hashlib.sha256((root / relative).read_bytes()).hexdigest() == digest


def test_single_compound_bundle_has_assessment_outputs_without_library_artifacts(tmp_path):
    job_dir = tmp_path / "job"; job_dir.mkdir(); receptor_root = tmp_path / "receptors"
    receptor_fixture(receptor_root); write_docking(job_dir, ["one"])
    rows = [row("one", None, eligible=False)]
    package = build_results_package(job_dir=job_dir, job=job("single_compound", tmp_path), rows=rows, molecule_manifest=source_manifest(rows), receptor_root=receptor_root)
    root = job_dir / "results"
    assert package["analysis_mode"] == "single_compound"
    for name in ("compound_results.csv", "compound_report.json", "admet_results.csv", "docking_results.csv", "molecular_properties.csv", "selected_profile.json", "run_summary.json", "results_manifest.json", "SHA256SUMS", "README.md", "compound.sdf"):
        assert (root / name).is_file()
    for name in ("prioritized_compounds.csv", "pareto_results.csv", "sensitivity_results.csv"):
        assert not (root / name).exists()
    compound = read_csv(root / "compound_results.csv")[0]
    assert "final_rank" not in compound and "scientific_rank" not in compound and "docking_percentile" not in compound
    assert "final_score" not in compound and "docking_component" not in compound and "prioritization_v2" not in compound
    assert compound["admet.hia_hou.calibrated_probability"] == "0.91"
    assert compound["bbb.probability_standard_deviation"] == "0.04"
    docking = read_csv(root / "docking_results.csv")[0]
    assert docking["best_mode_rmsd_lb"] == "0.0"
    assert docking["best_mode_rmsd_ub"] == "0.0"
    assert json.loads((root / "selected_profile.json").read_text()) == PROFILE.to_dict()
    assert (root / "receptor" / "prepared_receptor.pdbqt").is_file()
    assert not (root / "receptor" / "meeko_receptor.json").exists()
    assert not (root / "receptor" / "selected_receptor_input.pdb").exists()
    assert (root / "docking" / "poses" / "one.pdbqt").is_file()
    summary = json.loads((root / "run_summary.json").read_text())
    assert summary["receptor_preparation_provenance"]["preparation_method"] == "user_supplied_pdbqt"
    assert summary["ligand_hydrogen_representation"] == "autodock_united_atom_polar_donor_hydrogens_explicit"
    verify_hashes(root)
    with zipfile.ZipFile(job_dir / "results_package.zip") as archive:
        names = archive.namelist()
        assert "results/compound_results.csv" in names
        assert all("prioritized_compounds" not in name for name in names)


def test_library_bundle_retains_failures_orders_eligible_and_uses_saved_pareto(tmp_path):
    job_dir = tmp_path / "job"; job_dir.mkdir(); write_docking(job_dir, ["first", "second"])
    rows = [row("second", 2), row("invalid", None, valid=False, eligible=False), row("first", 1)]
    analysis = job_dir / "analysis"; analysis.mkdir()
    ranks_before = [item["scientific_rank"] for item in rows]
    pareto = {"results": [
        {"molecule_id": "first", "scalar_rank": 1, "pareto_front": 1, "objective_values": {"docking": .8, "admet": .7, "molecular_quality": .6, "safety": .9}},
        {"molecule_id": "second", "scalar_rank": 2, "pareto_front": 2, "objective_values": {"docking": .6, "admet": .5, "molecular_quality": .5, "safety": .8}},
    ]}
    (analysis / "pareto.json").write_text(json.dumps(pareto), encoding="utf-8")
    package = build_results_package(job_dir=job_dir, job=job("library", tmp_path), rows=rows, molecule_manifest=source_manifest(rows))
    root = job_dir / "results"
    assert len(read_csv(root / "all_compounds_results.csv")) == 3
    prioritized = read_csv(root / "prioritized_compounds.csv")
    assert [item["molecule_id"] for item in prioritized] == ["first", "second"]
    assert prioritized[0]["regression.endpoints.logp.uncertainty"] == "0.2"
    assert [item["scientific_rank"] for item in rows] == ranks_before
    assert len(read_csv(root / "pareto_results.csv")) == 2
    assert not (root / "sensitivity_results.csv").exists()
    assert package["sensitivity_status"] == "not_run"
    for name in ("pareto_docking_vs_admet.svg", "pareto_admet_vs_safety.svg", "final_score_distribution.svg"):
        ElementTree.parse(root / "visualizations" / name)
    supplier = Chem.SDMolSupplier(str(root / "prioritized_compounds.sdf"), removeHs=False)
    molecules = [molecule for molecule in supplier if molecule is not None]
    assert len(molecules) == 2
    assert molecules[0].GetProp("final_rank") == prioritized[0]["final_rank"]
    assert molecules[0].GetProp("final_score") == prioritized[0]["final_score"]
    assert molecules[0].GetProp("best_vina_affinity_kcal_mol") == prioritized[0]["best_vina_affinity_kcal_mol"]
    assert molecules[0].GetProp("profile_id") == PROFILE.profile_id
    verify_hashes(root)


def test_matching_sensitivity_is_exported_and_sha_mismatch_fails_closed(tmp_path):
    job_dir = tmp_path / "job"; job_dir.mkdir(); rows = [row("one", 1), row("two", 2)]
    analysis = job_dir / "analysis"; analysis.mkdir()
    payload = {
        "provenance": {"source_profile_sha256": profile_sha256(PROFILE), "perturbation_magnitude": .1, "number_of_samples": 10, "analysis_seed": 7},
        "results": [{"molecule_id": "one", "baseline_rank": 1, "minimum_rank": 1, "maximum_rank": 2, "median_rank": 1.0, "top_1_frequency": .8}],
    }
    (analysis / "sensitivity.json").write_text(json.dumps(payload), encoding="utf-8")
    build_results_package(job_dir=job_dir, job=job("library", tmp_path), rows=rows)
    assert (job_dir / "results" / "sensitivity_results.csv").is_file()
    ElementTree.parse(job_dir / "results" / "visualizations" / "sensitivity_top_candidates.svg")
    payload["provenance"]["source_profile_sha256"] = "0" * 64
    (analysis / "sensitivity.json").write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ResultsPackageError, match="SHA mismatch"):
        build_results_package(job_dir=job_dir, job=job("library", tmp_path), rows=rows)


def test_bundle_and_zip_are_deterministic_and_legacy_does_not_fabricate_v2(tmp_path):
    job_dir = tmp_path / "job"; job_dir.mkdir(); rows = [row("one", 1)]
    legacy = job("library", tmp_path, method="legacy_v1")
    build_results_package(job_dir=job_dir, job=legacy, rows=rows)
    first = (job_dir / "results_package.zip").read_bytes()
    build_results_package(job_dir=job_dir, job=legacy, rows=rows)
    assert (job_dir / "results_package.zip").read_bytes() == first
    root = job_dir / "results"
    assert not (root / "prioritization_profile.json").exists()
    assert not (root / "pareto_results.csv").exists()
    legacy_columns = set(read_csv(root / "all_compounds_results.csv")[0])
    assert not legacy_columns.intersection({
        "v2_score", "v2_rank", "v2_rank_eligible", "prioritization_v2",
        "docking_component", "admet_component", "molecular_quality_component", "profile_sha256",
    })
    manifest = json.loads((root / "results_manifest.json").read_text())
    assert all(set(item) == {"relative_path", "artifact_type", "sha256", "description"} for item in manifest["artifacts"])


def test_bundle_uses_persisted_job_admet_runtime_provenance_without_reprobing(tmp_path, monkeypatch):
    current_job = job("library", tmp_path)
    current_job["admet_runtime_identities"] = [
        {
            "family": "gmc_mpnn_bbb", "status": "success", "runtime_source": "packaged",
            "runner_sha256": "gmc-runner-sha", "private_path": r"C:\Users\private\runner.py",
        },
        {
            "family": "chemberta", "status": "success", "runtime_source": "application_process",
            "model_source": "packaged", "release_archive_sha256": "chemberta-release-sha",
        },
        {
            "family": "chemprop_regression", "status": "success", "runtime_source": "packaged",
            "runner_sha256": "chemprop-runner-sha",
            "production_manifest_identity": {"manifest_sha256": "chemprop-manifest-sha"},
        },
    ]
    monkeypatch.setattr(
        "molecular_prioritization.runtime_qualification.scientific_runtime_status",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("export re-probed runtime")),
    )
    monkeypatch.setattr(
        "molecular_prioritization.admet_runtime.resolve_admet_runtime",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("export resolved runtime")),
    )
    monkeypatch.setattr(
        "molecular_prioritization.admet_registry.ADMETRegistry.predict_batch",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("export reran inference")),
    )
    job_dir = tmp_path / "job"; job_dir.mkdir()
    build_results_package(job_dir=job_dir, job=current_job, rows=[row("one", 1)])
    first = (job_dir / "results_package.zip").read_bytes()
    summary = json.loads((job_dir / "results" / "run_summary.json").read_text())
    identities = summary["admet_runtime_identities"]
    assert [identity["family"] for identity in identities] == [
        "chemberta", "chemprop_regression", "gmc_mpnn_bbb",
    ]
    assert identities[0]["release_archive_sha256"] == "chemberta-release-sha"
    assert identities[1]["production_manifest_identity"]["manifest_sha256"] == "chemprop-manifest-sha"
    assert identities[2]["runner_sha256"] == "gmc-runner-sha"
    assert "C:\\Users" not in json.dumps(summary)
    verify_hashes(job_dir / "results")
    build_results_package(job_dir=job_dir, job=current_job, rows=[row("one", 1)])
    assert (job_dir / "results_package.zip").read_bytes() == first

    without_execution = job("library", tmp_path)
    build_results_package(job_dir=job_dir, job=without_execution, rows=[row("one", 1)])
    no_identity_summary = json.loads((job_dir / "results" / "run_summary.json").read_text())
    assert no_identity_summary["admet_runtime_identities"] == []


def test_persisted_partial_failure_blanks_and_boolean_strings_export_correctly(tmp_path):
    failed = _deserialize_result_row({
        "molecule_id": "failed", "canonical_smiles": "", "admet_model_status": "not_run_invalid_molecule",
        "v2_score": "", "v2_rank": "", "v2_rank_eligible": "", "valid_molecule": "False",
        "rank_eligible": "False", "validation_status": "invalid",
    })
    assert failed["v2_score"] is None and failed["v2_rank"] is None
    assert failed["v2_rank_eligible"] is None and failed["rank_eligible"] is False
    eligible_source = row("eligible", 1)
    eligible_source.update({
        "v2_score": "0.8", "v2_rank": "1", "v2_rank_eligible": "yes",
        "valid_molecule": "True", "rank_eligible": "1", "duplicate_structure": "0",
    })
    eligible = _deserialize_result_row({key: "" if value is None else str(value) for key, value in eligible_source.items()})
    assert eligible["v2_score"] == 0.8 and eligible["v2_rank"] == 1
    assert eligible["v2_rank_eligible"] is True and eligible["rank_eligible"] is True
    assert eligible["valid_molecule"] is True and eligible["duplicate_structure"] is False
    ambiguous = _deserialize_result_row({
        "admet_model_status": "unavailable", "v2_score": "not-a-number", "v2_rank": "1.5",
        "rank_eligible": "maybe", "valid_molecule": "unknown",
    })
    assert ambiguous["v2_score"] is None and ambiguous["v2_rank"] is None
    assert ambiguous["rank_eligible"] is None and ambiguous["valid_molecule"] is None
    job_dir = tmp_path / "job"; job_dir.mkdir()
    build_results_package(job_dir=job_dir, job=job("library", tmp_path), rows=[failed, eligible])
    exported = read_csv(job_dir / "results" / "all_compounds_results.csv")
    assert exported[0]["structure_valid"] == "False"
    assert exported[1]["structure_valid"] == "True"
    assert [item["molecule_id"] for item in read_csv(job_dir / "results" / "prioritized_compounds.csv")] == ["eligible"]


def test_custom_profile_is_exact_and_moloptima_receptor_provenance_is_preserved(tmp_path):
    custom_payload = PROFILE.to_dict()
    custom_payload.update({"profile_id": "custom-public-safe", "name": "Custom public-safe", "status": "draft"})
    custom = PrioritizationProfile.from_dict(custom_payload)
    current_job = job("library", tmp_path)
    current_job.update({
        "prioritization_profile": custom.to_dict(),
        "prioritization_profile_sha256": profile_sha256(custom),
        "receptor_id": "c" * 32, "receptor_source": "moloptima_prepared",
    })
    receptor_root = tmp_path / "receptors"; resource = receptor_root / ("c" * 32)
    preparation = resource / "preparations" / "qualified" / "receptor"
    (resource / "source").mkdir(parents=True); preparation.mkdir(parents=True)
    (resource / "source" / "original.pdb").write_text("ATOM\n", encoding="utf-8")
    for name, content in {
        "selected_receptor_input.pdb": "ATOM\n", "prepared_receptor.pdbqt": "ATOM\n",
        "meeko_receptor.json": "{}\n", "SHA256SUMS": "fixture\n",
    }.items():
        (preparation / name).write_text(content, encoding="utf-8")
    provenance = {
        "schema_version": "moloptima-receptor-preparation-v1", "meeko_version": "0.7.1",
        "gemmi_version": "0.7.5", "validation_status": "valid",
        "prepared_pdbqt_sha256": "d" * 64,
    }
    (preparation / "receptor_preparation.json").write_text(json.dumps(provenance), encoding="utf-8")
    (resource / "metadata.json").write_text(json.dumps({
        "receptor_id": "c" * 32, "original_pdb": "source/original.pdb",
        "prepared_pdbqt": "preparations/qualified/receptor/prepared_receptor.pdbqt",
        "preparation_provenance": "preparations/qualified/receptor/receptor_preparation.json",
        "preparation_sha256sums": "preparations/qualified/receptor/SHA256SUMS",
        "preparation_method": "moloptima_meeko_rigid", "preparation_tool": "Meeko",
        "preparation_tool_version": "0.7.1",
    }), encoding="utf-8")
    job_dir = tmp_path / "job"; job_dir.mkdir()
    build_results_package(job_dir=job_dir, job=current_job, rows=[row("one", 1)], receptor_root=receptor_root)
    root = job_dir / "results"
    assert json.loads((root / "prioritization_profile.json").read_text()) == custom.to_dict()
    assert (root / "receptor" / "original_receptor.pdb").is_file()
    assert (root / "receptor" / "selected_receptor_input.pdb").is_file()
    assert (root / "receptor" / "prepared_receptor.pdbqt").is_file()
    assert (root / "receptor" / "receptor_preparation.json").is_file()
    assert (root / "receptor" / "meeko_receptor.json").is_file()
    summary = json.loads((root / "run_summary.json").read_text())
    qualified = summary["receptor_preparation_provenance"]["qualified_preparation"]
    assert qualified["meeko_version"] == "0.7.1" and qualified["gemmi_version"] == "0.7.5"
