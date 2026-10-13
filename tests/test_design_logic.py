from __future__ import annotations

from fastapi.testclient import TestClient

from backend import design_logic_service
from backend.main import app
from molecular_prioritization.interaction_fingerprints import InteractionAnalysisError


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
