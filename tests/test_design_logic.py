from __future__ import annotations

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend import design_logic_service
from backend.main import app
from molecular_prioritization.interaction_fingerprints import InteractionAnalysisError
from molecular_prioritization.pharmacophore import PHARMACOPHORE_SCHEMA_VERSION


def _fingerprint(tokens, *, receptor_sha="receptor-a"):
    return {
        "schema_version": "moloptima-interaction-fingerprint-v1",
        "status": "success",
        "receptor": {
            "identity": "9IIR",
            "authoritative_sha256": receptor_sha,
            "policy_version": "moloptima-receptor-analysis-policy-v1",
        },
        "runtime_provenance": {"runner_version": "1.0.0", "versions": {"prolif": "2.2.3"}},
        "interaction_configuration": ["Hydrophobic", "HBDonor"],
        "mapping_schema_version": "moloptima-template-pose-atom-mapping-v2",
        "canonical_tokens": sorted(tokens),
        "raw_interaction_records": [],
        "unique_token_count": len(set(tokens)),
        "cache_status": "hit",
    }


def _records():
    return [
        {"molecule_id": "ref", "canonical_smiles": "c1ccccc1O", "validation_status": "valid"},
        {"molecule_id": "near", "canonical_smiles": "c1ccccc1N", "validation_status": "valid"},
        {"molecule_id": "far", "canonical_smiles": "CCCO", "validation_status": "valid"},
        {"molecule_id": "missing", "canonical_smiles": "CCCC", "validation_status": "valid"},
    ]


def _rows():
    return [
        {
            "molecule_id": record["molecule_id"], "original_molecule_id": record["molecule_id"].title(),
            "canonical_smiles": record["canonical_smiles"], "source_filename": "public-safe.smi",
            "docking_result": {
                "status": "success", "modes": [
                    {"mode": 1, "affinity_kcal_mol": -8.0},
                    {"mode": 2, "affinity_kcal_mol": -7.5},
                ],
            },
        }
        for record in _records()
    ]


def _configure_workspace(monkeypatch, fingerprints):
    monkeypatch.setattr(
        design_logic_service.services, "get_result",
        lambda job_id: {"job_id": job_id, "upload_id": "upload-1", "results": _rows()},
    )
    monkeypatch.setattr(
        design_logic_service.services, "_load_molecule_collection_records", lambda upload_id: _records(),
    )
    monkeypatch.setattr(
        design_logic_service, "_analysis_context",
        lambda job_id, row, mode: ({"molecule_id": row["molecule_id"], "mode": mode}, {}),
    )

    def cached_loader(contract):
        return fingerprints.get((contract["molecule_id"], contract["mode"]))

    return cached_loader


def test_workspace_keeps_structural_and_interaction_metrics_independent(monkeypatch):
    fingerprints = {
        ("ref", 1): _fingerprint(["A:MET:301:Hydrophobic", "B:ASN:236:HBDonor:ligand_donor"]),
        ("near", 2): _fingerprint(["A:MET:301:Hydrophobic"]),
        ("far", 2): _fingerprint(["B:ASN:236:HBDonor:ligand_donor"]),
    }
    payload = design_logic_service.workspace(
        "job-1", "ref", 1, 2, cached_loader=_configure_workspace(monkeypatch, fingerprints),
    )
    by_id = {point["molecule_id"]: point for point in payload["points"]}
    assert payload["schema_version"] == design_logic_service.WORKSPACE_SCHEMA
    assert by_id["near"]["mode"] == 2
    assert by_id["ref"]["structural_similarity"] == 1.0
    assert by_id["near"]["interaction_similarity"] == 0.5
    assert by_id["missing"]["interaction_similarity"] is None
    assert by_id["missing"]["fingerprint_status"] == "not_analyzed"
    assert payload["coverage"] == {
        "total": 4, "available": 3, "not_analyzed": 1,
        "incompatible": 0, "failed": 0, "missing_pose": 0,
    }
    assert payload["matrix"]["features"] == [
        "A:MET:301:Hydrophobic", "B:ASN:236:HBDonor:ligand_donor",
    ]
    assert payload["metadata"]["comparison_policy"] == "explicit_vina_mode_no_substitution"
    visualization = by_id["near"]["visualization"]
    assert visualization["schema_version"] == "moloptima-design-logic-visualization-v1"
    assert visualization["mode"] == 2
    assert visualization["coordinate_policy"] == "qualified_8_angstrom_complete_residue_pocket"
    assert visualization["atom_identity_policy"] == "authoritative_template_pdbqt_vina_and_receptor_serials"


def test_workspace_marks_incompatible_and_both_empty_without_inventing_scores(monkeypatch):
    incompatible = {
        ("ref", 1): _fingerprint([]),
        ("near", 1): _fingerprint([], receptor_sha="receptor-b"),
        ("far", 1): _fingerprint([]),
    }
    payload = design_logic_service.workspace(
        "job-1", "ref", 1, 1, cached_loader=_configure_workspace(monkeypatch, incompatible),
    )
    by_id = {point["molecule_id"]: point for point in payload["points"]}
    assert by_id["ref"]["interaction_similarity_status"] == "both_empty"
    assert by_id["ref"]["interaction_similarity"] is None
    assert by_id["near"]["interaction_similarity_status"] == "incompatible"
    assert by_id["near"]["interaction_similarity"] is None
    assert by_id["far"]["interaction_similarity_status"] == "both_empty"


def test_token_partitions_are_neutral_and_deterministic():
    result = design_logic_service.partition_interaction_tokens(
        {"canonical_tokens": ["shared", "ref-only"]},
        {"canonical_tokens": ["comparison-only", "shared"]},
    )
    assert result == {
        "shared": ["shared"],
        "reference_only": ["ref-only"],
        "comparison_only": ["comparison-only"],
    }


def test_explicit_missing_mode_does_not_substitute_best_mode(monkeypatch):
    row = _rows()[0]
    row["docking_result"]["modes"] = [{"mode": 1, "affinity_kcal_mol": -8.0}]
    state = design_logic_service._fingerprint_state("job-1", row, 2, cached_loader=lambda contract: None)
    assert state["status"] == "missing_pose"
    assert state["error_code"] == "pose_mode_missing"


def test_analysis_runtime_failure_is_typed_and_isolated(monkeypatch):
    monkeypatch.setattr(design_logic_service, "_analysis_context", lambda *args: ({}, {}))

    def fail(*args, **kwargs):
        raise InteractionAnalysisError("interaction_runtime_timeout", "timed out")

    monkeypatch.setattr(design_logic_service, "analyze_docking_pose_interactions", fail)
    state = design_logic_service._fingerprint_state("job-1", _rows()[0], 1, analyze=True)
    assert state == {
        "status": "runtime_timeout", "error_code": "interaction_runtime_timeout",
        "message": "interaction_runtime_timeout: timed out",
    }


def test_design_logic_routes_are_thin_and_return_typed_payloads(monkeypatch):
    monkeypatch.setattr(
        design_logic_service, "workspace",
        lambda job_id, *args: {"job_id": job_id, "schema_version": design_logic_service.WORKSPACE_SCHEMA},
    )
    monkeypatch.setattr(
        design_logic_service, "analyze_pose",
        lambda job_id, *args: {"job_id": job_id, "status": "not_analyzed"},
    )
    client = TestClient(app)
    response = client.post("/api/design-logic/workspace", json={
        "job_id": "job-1", "reference_molecule_id": "ref", "reference_mode": 1,
        "comparison_mode": 2, "limit": 20,
    })
    assert response.status_code == 200
    assert response.json()["schema_version"] == design_logic_service.WORKSPACE_SCHEMA
    response = client.post("/api/design-logic/analyze", json={
        "job_id": "job-1", "molecule_id": "ref", "mode": 1,
    })
    assert response.status_code == 200
    assert response.json()["status"] == "not_analyzed"


def test_ligand_depiction_is_vector_deterministic_and_atom_indexed():
    first = design_logic_service.ligand_depiction("CCO", 420, 300)
    second = design_logic_service.ligand_depiction("CCO", 420, 300)
    assert first == second
    assert first["schema_version"] == "moloptima-design-logic-depiction-v1"
    assert "<svg" in first["svg"] and "<path" in first["svg"]
    assert [atom["atom_index"] for atom in first["atom_positions"]] == [0, 1, 2]
    assert all(0 <= atom["x"] <= 420 and 0 <= atom["y"] <= 300 for atom in first["atom_positions"])


def test_selected_set_is_bounded_and_summarizes_binary_features_and_scaffolds(monkeypatch):
    fingerprints = {
        ("ref", 1): _fingerprint(["A:MET:301:Hydrophobic", "B:ASN:236:HBDonor:ligand_donor"]),
        ("near", 1): _fingerprint(["A:MET:301:Hydrophobic"]),
        ("far", 1): _fingerprint(["C:LEU:10:VdWContact"]),
    }
    payload = design_logic_service.workspace(
        "job-1", "ref", 1, 1, 50, ["near", "near", "far", "ref"],
        cached_loader=_configure_workspace(monkeypatch, fingerprints),
    )
    selected = payload["selected_set"]
    assert selected["molecule_ids"] == ["ref", "near", "far"]
    assert selected["comparison_count"] == 2
    frequency = {row["token"]: row for row in selected["interaction_frequency"]}
    assert frequency["A:MET:301:Hydrophobic"]["present_count"] == 2
    assert frequency["B:ASN:236:HBDonor:ligand_donor"]["category"] == "reference_only"
    assert frequency["C:LEU:10:VdWContact"]["category"] == "comparison_specific"
    assert len(selected["matrix"]["columns"]) == 3


def test_selected_set_fails_closed_when_reference_fingerprint_is_not_analyzed(monkeypatch):
    payload = design_logic_service.workspace(
        "job-1", "ref", 1, 1, 50, ["near"],
        cached_loader=_configure_workspace(monkeypatch, {}),
    )
    assert payload["selected_set"]["interaction_frequency"] == []
    assert payload["selected_set"]["matrix"]["columns"] == []


def test_exact_scaffold_depiction_alignment_is_explicit_and_different_framework_falls_back():
    aligned = design_logic_service.ligand_depiction("Nc1ccccc1", reference_smiles="Oc1ccccc1")
    independent = design_logic_service.ligand_depiction("C1CC1", reference_smiles="Oc1ccccc1")
    assert aligned["orientation"] == "exact_murcko_reference_aligned"
    assert independent["orientation"] == "deterministic_rdkit_2d_depiction"


def test_pose_change_preserves_structure_and_scaffold_but_may_change_interactions(monkeypatch):
    fingerprints = {
        ("ref", 1): _fingerprint(["A:MET:301:Hydrophobic", "B:ASN:236:HBDonor:ligand_donor"]),
        ("near", 1): _fingerprint(["A:MET:301:Hydrophobic"]),
        ("near", 2): _fingerprint(["B:ASN:236:HBDonor:ligand_donor"]),
    }
    loader = _configure_workspace(monkeypatch, fingerprints)
    mode_one = design_logic_service.workspace("job-1", "ref", 1, 1, cached_loader=loader)
    mode_two = design_logic_service.workspace("job-1", "ref", 1, 2, cached_loader=loader)
    first = next(point for point in mode_one["points"] if point["molecule_id"] == "near")
    second = next(point for point in mode_two["points"] if point["molecule_id"] == "near")
    assert first["structural_similarity"] == second["structural_similarity"]
    assert first["scaffold_relationship"] == second["scaffold_relationship"]
    assert first["fingerprint"]["canonical_tokens"] != second["fingerprint"]["canonical_tokens"]
    assert first["mode"] == 1 and second["mode"] == 2


def test_design_logic_depiction_endpoint_returns_vector_contract():
    response = TestClient(app).get(
        "/api/design-logic/depiction", params={"smiles": "c1ccccc1O", "width": 480, "height": 320},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["width"] == 480 and payload["height"] == 320
    assert payload["orientation"] == "deterministic_rdkit_2d_depiction"
    assert len(payload["atom_positions"]) == 7


def test_design_logic_depiction_endpoint_rejects_invalid_structure():
    response = TestClient(app).get("/api/design-logic/depiction", params={"smiles": "not-a-smiles"})
    assert response.status_code == 422


def _pharmacophore_feature_set(molecule_id, features, *, receptor_sha="receptor-a"):
    return {
        "status": "available" if features else "no_supported_features",
        "molecule_id": molecule_id,
        "mode": 1,
        "feature_set": {
            "schema_version": PHARMACOPHORE_SCHEMA_VERSION,
            "status": "available" if features else "no_supported_features",
            "receptor_identity": "receptor-1",
            "receptor_sha256": receptor_sha,
            "mapping_schema": "moloptima-template-pose-atom-mapping-v2",
            "feature_definition": {
                "feature_definition_sha256": "fdef",
                "canonical_feature_mapping_sha256": "mapping",
            },
            "features": features,
        },
        "visualization": {"receptor_id": "receptor-1", "mode": 1},
    }


def _pharmacophore_feature(feature_id, class_name, x):
    return {
        "feature_id": feature_id, "canonical_class": class_name,
        "template_atom_indices": [int(feature_id[-1])], "pose_atom_indices": [int(feature_id[-1])],
        "feature_center_xyz": [x, 0.0, 0.0], "plane_normal": None,
    }


def _configure_pharmacophore(monkeypatch, states):
    monkeypatch.setattr(
        design_logic_service.services, "get_result",
        lambda job_id: {"job_id": job_id, "results": _rows()},
    )
    return lambda job_id, row, mode: {
        **states[str(row["molecule_id"])], "mode": mode,
    }


def test_pharmacophore_workspace_preserves_explicit_modes_threshold_and_matches(monkeypatch):
    states = {
        "ref": _pharmacophore_feature_set("ref", [
            _pharmacophore_feature("ref0", "HBA", 0.0),
            _pharmacophore_feature("ref1", "HBD", 2.0),
        ]),
        "near": _pharmacophore_feature_set("near", [
            _pharmacophore_feature("cmp0", "HBA", 0.5),
            _pharmacophore_feature("cmp1", "HBD", 4.0),
        ]),
    }
    payload = design_logic_service.pharmacophore_workspace(
        "job-1", "ref", 1, ["near"], 2, 1.5,
        state_loader=_configure_pharmacophore(monkeypatch, states),
    )
    pair = payload["comparisons"][0]["comparison"]
    assert payload["schema_version"] == design_logic_service.PHARMACOPHORE_WORKSPACE_SCHEMA
    assert payload["reference_mode"] == 1 and payload["comparison_mode"] == 2
    assert payload["distance_threshold_angstrom"] == 1.5
    assert pair["matched_feature_count"] == 1
    assert pair["single_match_distance_angstrom"] == 0.5
    assert pair["matched_feature_center_rmsd_angstrom"] is None
    assert payload["metadata"]["ligand_realignment_used"] is False
    assert payload["metadata"]["aromatic_orientation_filter_used"] is False


def test_pharmacophore_threshold_sensitivity_and_reference_matrix_are_backend_derived(monkeypatch):
    states = {
        "ref": _pharmacophore_feature_set("ref", [_pharmacophore_feature("ref0", "HBA", 0.0)]),
        "near": _pharmacophore_feature_set("near", [_pharmacophore_feature("cmp0", "HBA", 1.2)]),
    }
    payload = design_logic_service.pharmacophore_workspace(
        "job-1", "ref", 1, ["near"], 1, 1.5,
        state_loader=_configure_pharmacophore(monkeypatch, states),
    )
    sensitivity = payload["comparisons"][0]["threshold_sensitivity"]
    assert [row["matched_feature_count"] for row in sensitivity] == [0, 0, 1, 1]
    matrix = payload["reference_feature_matrix"]
    assert matrix["rows"][0]["matched_comparison_count"] == 1
    assert matrix["rows"][0]["cells"][0]["distance_angstrom"] == 1.2
    assert "backend one-to-one" in matrix["semantics"]


def test_pharmacophore_workspace_preserves_typed_unavailable_and_incompatible_states(monkeypatch):
    states = {
        "ref": _pharmacophore_feature_set("ref", [_pharmacophore_feature("ref0", "HBA", 0.0)]),
        "near": {"status": "template_missing", "molecule_id": "near", "mode": 1, "message": "Template missing."},
        "far": _pharmacophore_feature_set("far", [_pharmacophore_feature("cmp0", "HBA", 0.0)], receptor_sha="other"),
    }
    payload = design_logic_service.pharmacophore_workspace(
        "job-1", "ref", 1, ["near", "far"], 1, 1.5,
        state_loader=_configure_pharmacophore(monkeypatch, states),
    )
    assert payload["comparisons"][0]["comparison"]["status"] == "template_missing"
    assert payload["comparisons"][1]["comparison"]["status"] == "incompatible"
    assert payload["reference_feature_matrix"]["rows"][0]["cells"][0]["status"] == "unavailable"


def test_pharmacophore_workspace_is_bounded_and_rejects_unqualified_threshold(monkeypatch):
    monkeypatch.setattr(
        design_logic_service.services, "get_result",
        lambda job_id: {"job_id": job_id, "results": _rows()},
    )
    with pytest.raises(HTTPException) as error:
        design_logic_service.pharmacophore_workspace("job-1", "ref", 1, ["near"], 1, 1.25)
    assert error.value.status_code == 422


def test_pharmacophore_route_is_thin_and_typed(monkeypatch):
    monkeypatch.setattr(
        design_logic_service, "pharmacophore_workspace",
        lambda job_id, *args: {
            "job_id": job_id, "schema_version": design_logic_service.PHARMACOPHORE_WORKSPACE_SCHEMA,
        },
    )
    response = TestClient(app).post("/api/design-logic/pharmacophore", json={
        "job_id": "job-1", "reference_molecule_id": "ref", "reference_mode": 1,
        "comparison_molecule_ids": ["near"], "comparison_mode": 2,
        "distance_threshold_angstrom": 1.5,
    })
    assert response.status_code == 200
    assert response.json()["schema_version"] == design_logic_service.PHARMACOPHORE_WORKSPACE_SCHEMA


def test_pose_artifact_is_job_scoped_and_limited_to_result_manifest(tmp_path, monkeypatch):
    job = tmp_path / "job-1"
    pose = job / "docking" / "poses" / "ligand.pdbqt"
    pose.parent.mkdir(parents=True)
    pose.write_text("MODEL 1\nENDMDL\n", encoding="utf-8")
    monkeypatch.setattr(design_logic_service.services, "JOB_OUTPUT_DIR", tmp_path)
    monkeypatch.setattr(design_logic_service.services, "get_result", lambda _job_id: {
        "results": [{"docking_result": {"pose_path": "docking/poses/ligand.pdbqt"}}],
    })
    assert design_logic_service.pose_artifact("job-1", "docking/poses/ligand.pdbqt") == pose
    with pytest.raises(HTTPException) as error:
        design_logic_service.pose_artifact("job-1", "docking/poses/other.pdbqt")
    assert error.value.status_code == 404


def test_pose_artifact_route_serves_manifest_pose(tmp_path, monkeypatch):
    pose = tmp_path / "pose.pdbqt"
    pose.write_text("MODEL 1\nENDMDL\n", encoding="utf-8")
    monkeypatch.setattr(design_logic_service, "pose_artifact", lambda job_id, artifact_path: pose)
    response = TestClient(app).get("/api/design-logic/pose-artifact", params={
        "job_id": "job-1", "artifact_path": "docking/poses/ligand.pdbqt",
    })
    assert response.status_code == 200
    assert response.content.startswith(b"MODEL 1")
