import hashlib
import json
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from molecular_prioritization.interaction_fingerprints import (
    FINGERPRINT_SCHEMA,
    InteractionAnalysisError,
    _canonical_hash,
    _scientific_fingerprint_payload,
    analyze_docking_pose_interactions,
    compare_interaction_fingerprints,
    get_cached_docking_pose_interactions,
    resolve_prolif_runtime,
)


VERSIONS = {
    "python": "3.11.17", "prolif": "2.2.3", "MDAnalysis": "2.10.0",
    "gemmi": "0.7.5", "rdkit": "2026.09.1", "numpy": "2.4.6",
    "pandas": "3.0.6", "scipy": "1.17.1", "networkx": "3.6.1",
    "tqdm": "4.70.1", "multiprocess": "0.70.19", "dill": "0.4.1",
    "psutil": "7.2.2",
}


def make_runtime(tmp_path: Path):
    runner = tmp_path / "runner.py"
    python = tmp_path / "python.exe"
    runner.write_text("# fake\n", encoding="utf-8")
    python.write_text("fake", encoding="utf-8")
    manifest = tmp_path / "resources" / "prolif" / "runtime_manifest.json"
    manifest.parent.mkdir(parents=True)
    manifest.write_text(json.dumps({
        "schema_version": "moloptima-prolif-runtime-resources-v1",
        "runner_relative_path": "runner.py",
        "runner_sha256": hashlib.sha256(runner.read_bytes()).hexdigest(),
        "runner_version": "1.0.0",
        "python_relative_candidates": [],
        "expected_versions": VERSIONS,
        "supported_interactions": ["Hydrophobic", "HBDonor"],
    }), encoding="utf-8")
    return runner, python


def success_result(tokens=None):
    result = {
        "schema_version": FINGERPRINT_SCHEMA,
        "status": "success",
        "receptor": {"identity": "9IIR", "authoritative_sha256": "r", "policy_version": "policy"},
        "runtime_provenance": {"runner_version": "1", "versions": VERSIONS},
        "interaction_configuration": ["Hydrophobic", "HBDonor"],
        "mapping_schema_version": "mapping",
        "raw_interaction_records": [],
        "canonical_tokens": sorted(set(tokens or [])),
        "performance_seconds": {},
    }
    result["fingerprint_sha256"] = _canonical_hash(_scientific_fingerprint_payload(result))
    return result


def fake_command(result=None, *, malformed=False, returncode=0):
    calls = []

    def run(args, **kwargs):
        calls.append(args)
        output = Path(args[args.index("--output") + 1])
        if malformed:
            output.write_text("not-json", encoding="utf-8")
        elif "--probe" in args:
            output.write_text(json.dumps({"versions": VERSIONS}), encoding="utf-8")
        else:
            output.write_text(json.dumps(result or success_result()), encoding="utf-8")
        return SimpleNamespace(returncode=returncode, stdout="", stderr="warning")

    return run, calls


def contract():
    return {
        "schema_version": "moloptima-interaction-analysis-input-v1",
        "authoritative_receptor_sha256": "r",
        "ligand_template": {"sdf_sha256": "l"},
        "pose": {"parent_pose_sha256": "p", "model_sha256": "m", "model_number": 1},
        "receptor_analysis": {"policy_version": "policy"},
        "template_pose_atom_mapping": {"schema_version": "mapping"},
    }


def test_runtime_resolver_verifies_override_without_importing_prolif(tmp_path):
    runner, python = make_runtime(tmp_path)
    command, calls = fake_command()
    resolved = resolve_prolif_runtime(
        application_root=tmp_path, python_override=python, runner_override=runner,
        command_runner=command,
    )
    assert resolved.versions == VERSIONS
    assert calls[0][0] == str(python)


def test_missing_runtime_is_typed(tmp_path):
    runner, _ = make_runtime(tmp_path)
    with pytest.raises(InteractionAnalysisError) as error:
        resolve_prolif_runtime(application_root=tmp_path, runner_override=runner, environ={})
    assert error.value.code == "interaction_runtime_unavailable"


def test_timeout_is_typed(tmp_path):
    runner, python = make_runtime(tmp_path)
    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired("prolif", 1)
    with pytest.raises(InteractionAnalysisError) as error:
        resolve_prolif_runtime(
            application_root=tmp_path, python_override=python, runner_override=runner,
            command_runner=timeout,
        )
    assert error.value.code == "interaction_runtime_timeout"


def test_malformed_output_is_typed(tmp_path):
    runner, python = make_runtime(tmp_path)
    command, _ = fake_command(malformed=True)
    with pytest.raises(InteractionAnalysisError) as error:
        resolve_prolif_runtime(
            application_root=tmp_path, python_override=python, runner_override=runner,
            command_runner=command,
        )
    assert error.value.code == "interaction_output_malformed"


def test_cache_hit_does_not_invoke_analysis_again(tmp_path):
    runner, python = make_runtime(tmp_path)
    command, calls = fake_command(success_result(["A:MET:301:Hydrophobic", "A:MET:301:Hydrophobic"]))
    kwargs = dict(
        ligand_template_path=tmp_path / "lig.sdf", receptor_topology_path=tmp_path / "rec.pdb",
        prepared_receptor_path=tmp_path / "rec.pdbqt", cache_root=tmp_path / "cache",
        application_root=tmp_path, python_override=python, runner_override=runner,
        command_runner=command,
    )
    first = analyze_docking_pose_interactions(contract(), **kwargs)
    second = analyze_docking_pose_interactions(contract(), **kwargs)
    assert first["cache_status"] == "miss"
    assert second["cache_status"] == "hit"
    assert len([call for call in calls if "--request" in call]) == 1
    assert len([call for call in calls if "--probe" in call]) == 1


def test_cached_lookup_never_starts_the_isolated_runtime(tmp_path):
    runner, python = make_runtime(tmp_path)
    command, calls = fake_command(success_result(["A:MET:301:Hydrophobic"]))
    kwargs = dict(
        ligand_template_path=tmp_path / "lig.sdf", receptor_topology_path=tmp_path / "rec.pdb",
        prepared_receptor_path=tmp_path / "rec.pdbqt", cache_root=tmp_path / "cache",
        application_root=tmp_path, python_override=python, runner_override=runner,
        command_runner=command,
    )
    analyze_docking_pose_interactions(contract(), **kwargs)
    calls.clear()
    cached = get_cached_docking_pose_interactions(
        contract(), cache_root=tmp_path / "cache", application_root=tmp_path,
        python_override=python, runner_override=runner,
    )
    assert cached is not None
    assert cached["cache_status"] == "hit"
    assert cached["canonical_tokens"] == ["A:MET:301:Hydrophobic"]
    assert calls == []


def test_corrupt_cache_recomputes(tmp_path):
    runner, python = make_runtime(tmp_path)
    command, calls = fake_command(success_result(["A:MET:301:Hydrophobic"]))
    kwargs = dict(
        ligand_template_path="lig", receptor_topology_path="rec", prepared_receptor_path="pdbqt",
        cache_root=tmp_path / "cache", application_root=tmp_path, python_override=python,
        runner_override=runner, command_runner=command,
    )
    first = analyze_docking_pose_interactions(contract(), **kwargs)
    cache_file = next((tmp_path / "cache").rglob("*.json"))
    cache_file.write_text("corrupt", encoding="utf-8")
    second = analyze_docking_pose_interactions(contract(), **kwargs)
    assert first["cache_key"] == second["cache_key"]
    assert len([call for call in calls if "--request" in call]) == 2


def test_cache_with_wrong_scientific_hash_recomputes(tmp_path):
    runner, python = make_runtime(tmp_path)
    command, calls = fake_command(success_result(["A:MET:301:Hydrophobic"]))
    kwargs = dict(
        ligand_template_path="lig", receptor_topology_path="rec", prepared_receptor_path="pdbqt",
        cache_root=tmp_path / "cache", application_root=tmp_path, python_override=python,
        runner_override=runner, command_runner=command,
    )
    analyze_docking_pose_interactions(contract(), **kwargs)
    cache_file = next((tmp_path / "cache").rglob("*.json"))
    cached = json.loads(cache_file.read_text(encoding="utf-8"))
    cached["canonical_tokens"] = ["A:MET:301:HBDonor:ligand_donor"]
    cache_file.write_text(json.dumps(cached), encoding="utf-8")
    analyze_docking_pose_interactions(contract(), **kwargs)
    assert len([call for call in calls if "--request" in call]) == 2


def test_cache_identity_change_invalidates(tmp_path):
    runner, python = make_runtime(tmp_path)
    command, calls = fake_command(success_result())
    kwargs = dict(
        ligand_template_path="lig", receptor_topology_path="rec", prepared_receptor_path="pdbqt",
        cache_root=tmp_path / "cache", application_root=tmp_path, python_override=python,
        runner_override=runner, command_runner=command,
    )
    analyze_docking_pose_interactions(contract(), **kwargs)
    changed = contract(); changed["pose"] = dict(changed["pose"], model_sha256="changed")
    analyze_docking_pose_interactions(changed, **kwargs)
    assert len([call for call in calls if "--request" in call]) == 2


def test_mapping_version_and_input_schema_do_not_share_cache(tmp_path):
    runner, python = make_runtime(tmp_path)
    command, calls = fake_command(success_result())
    kwargs = dict(
        ligand_template_path="lig", receptor_topology_path="rec", prepared_receptor_path="pdbqt",
        cache_root=tmp_path / "cache", application_root=tmp_path, python_override=python,
        runner_override=runner, command_runner=command,
    )
    analyze_docking_pose_interactions(contract(), **kwargs)
    changed_mapping = contract()
    changed_mapping["template_pose_atom_mapping"] = {"schema_version": "mapping-v2"}
    analyze_docking_pose_interactions(changed_mapping, **kwargs)
    v2 = contract()
    v2["schema_version"] = "moloptima-interaction-analysis-input-v2"
    analyze_docking_pose_interactions(v2, ligand_input_pdbqt_path="input.pdbqt", **kwargs)
    assert len([call for call in calls if "--request" in call]) == 3


def test_wrong_cached_runtime_identity_recomputes(tmp_path):
    runner, python = make_runtime(tmp_path)
    command, calls = fake_command(success_result())
    kwargs = dict(
        ligand_template_path="lig", receptor_topology_path="rec", prepared_receptor_path="pdbqt",
        cache_root=tmp_path / "cache", application_root=tmp_path, python_override=python,
        runner_override=runner, command_runner=command,
    )
    analyze_docking_pose_interactions(contract(), **kwargs)
    cache_file = next((tmp_path / "cache").rglob("*.json"))
    cached = json.loads(cache_file.read_text(encoding="utf-8"))
    cached["cache_identity"]["runtime_versions"]["prolif"] = "wrong"
    cache_file.write_text(json.dumps(cached), encoding="utf-8")
    analyze_docking_pose_interactions(contract(), **kwargs)
    assert len([call for call in calls if "--request" in call]) == 2


def test_similarity_normal_one_empty_and_both_empty():
    assert compare_interaction_fingerprints(success_result(["a", "b"]), success_result(["b", "c"]))[
        "interaction_fingerprint_similarity"
    ] == pytest.approx(1 / 3)
    assert compare_interaction_fingerprints(success_result([]), success_result(["b"]))[
        "interaction_fingerprint_similarity"
    ] == 0.0
    both = compare_interaction_fingerprints(success_result([]), success_result([]))
    assert both == {"interaction_fingerprint_similarity": None, "status": "both_empty"}


def test_failed_fingerprint_is_not_numerical_zero():
    result = compare_interaction_fingerprints(None, success_result(["a"]))
    assert result == {"interaction_fingerprint_similarity": None, "status": "fingerprint_unavailable"}


def test_incompatible_receptor_is_rejected():
    first = success_result(["a"])
    second = success_result(["a"])
    second["receptor"] = dict(second["receptor"], authoritative_sha256="other")
    assert compare_interaction_fingerprints(first, second)["status"] == "incompatible_receptor_context"


def test_output_rejects_unsorted_or_duplicate_tokens(tmp_path):
    runner, python = make_runtime(tmp_path)
    bad = success_result(); bad["canonical_tokens"] = ["b", "a", "a"]
    command, _ = fake_command(bad)
    with pytest.raises(InteractionAnalysisError) as error:
        analyze_docking_pose_interactions(
            contract(), ligand_template_path="lig", receptor_topology_path="rec",
            prepared_receptor_path="pdbqt", cache_root=tmp_path / "cache",
            application_root=tmp_path, python_override=python, runner_override=runner,
            command_runner=command,
        )
    assert error.value.code == "interaction_output_malformed"


def test_output_hash_covers_runtime_scientific_provenance(tmp_path):
    runner, python = make_runtime(tmp_path)
    bad = success_result()
    bad["runtime_provenance"]["runner_version"] = "tampered"
    command, _ = fake_command(bad)
    with pytest.raises(InteractionAnalysisError) as error:
        analyze_docking_pose_interactions(
            contract(), ligand_template_path="lig", receptor_topology_path="rec",
            prepared_receptor_path="pdbqt", cache_root=tmp_path / "cache",
            application_root=tmp_path, python_override=python, runner_override=runner,
            command_runner=command,
        )
    assert error.value.code == "interaction_output_malformed"


def test_analysis_failure_does_not_mutate_docking_result(tmp_path):
    docking = {"status": "success", "affinity": -8.2}
    with pytest.raises(InteractionAnalysisError):
        analyze_docking_pose_interactions(contract(), ligand_template_path="missing", receptor_topology_path="missing", prepared_receptor_path="missing", application_root=tmp_path)
    assert docking == {"status": "success", "affinity": -8.2}


def test_v2_analysis_requires_persisted_input_pdbqt(tmp_path):
    v2 = contract()
    v2["schema_version"] = "moloptima-interaction-analysis-input-v2"
    with pytest.raises(InteractionAnalysisError) as error:
        analyze_docking_pose_interactions(
            v2, ligand_template_path="lig", receptor_topology_path="rec",
            prepared_receptor_path="pdbqt", application_root=tmp_path,
        )
    assert error.value.code == "interaction_input_invalid"
