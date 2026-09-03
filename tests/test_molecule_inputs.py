from __future__ import annotations

import io
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from rdkit import Chem
from rdkit.Chem import AllChem

from backend import services
from backend.main import app
from molecular_prioritization.admet_multitask_predictor import unavailable_admet_prediction
from molecular_prioritization.bbb_predictor import BBBPrediction
from molecular_prioritization.molecule_inputs import (
    PDB_PREFERENCE_WARNING,
    SDF_MULTI_RECORD_ERROR,
    SourceInput,
    import_molecule_collection,
)
from molecular_prioritization.pipeline import prioritize_smiles


def sdf_bytes(smiles: str, name: str, *, three_d: bool = True) -> bytes:
    molecule = Chem.AddHs(Chem.MolFromSmiles(smiles))
    if three_d:
        assert AllChem.EmbedMolecule(molecule, randomSeed=2025) == 0
    else:
        AllChem.Compute2DCoords(molecule)
    molecule.SetProp("_Name", name)
    molecule.SetProp("public_safe_property", "retained")
    return (
        Chem.MolToMolBlock(molecule)
        + "\n>  <public_safe_property>\nretained\n\n$$$$\n"
    ).encode()


def pdb_bytes(smiles: str = "CCO", name: str = "ethanol") -> bytes:
    molecule = Chem.AddHs(Chem.MolFromSmiles(smiles))
    assert AllChem.EmbedMolecule(molecule, randomSeed=2025) == 0
    block = f"COMPND    {name}\n" + Chem.MolToPDBBlock(molecule)
    assert "CONECT" in block
    return block.encode()


def collection(*, smiles_text="", files=(), selected_structure_column=""):
    return import_molecule_collection(
        smiles_text=smiles_text, files=list(files),
        selected_structure_column=selected_structure_column,
    )


@pytest.mark.parametrize(
    ("text", "valid", "mode"),
    [
        ("CCO", 1, "single_compound"),
        ("CCO\nCCN", 2, "library"),
        ("\n".join("C" * index for index in range(1, 11)), 10, "library"),
        ("CCO\nnot_smiles", 1, "single_compound"),
    ],
)
def test_valid_count_authoritatively_selects_analysis_mode(text, valid, mode):
    result = collection(smiles_text=text)
    assert result["summary"]["valid_count"] == valid
    assert result["summary"]["analysis_mode"] == mode


def test_smiles_list_ids_validation_duplicates_and_canonical_identity():
    result = collection(smiles_text="cmpd CCO\ncmpd OCC\nbad not_smiles\n\n")
    records = result["records"]
    assert [record["molecule_id"] for record in records] == ["cmpd", "cmpd__2", "bad"]
    assert records[0]["canonical_smiles"] == records[1]["canonical_smiles"] == "CCO"
    assert records[1]["duplicate_structure"] is True
    assert records[2]["structure_status"] == "invalid_smiles"
    assert result["summary"] == {
        **result["summary"], "valid_count": 2, "invalid_count": 1,
        "duplicate_count": 1, "analysis_mode": "library",
    }


@pytest.mark.parametrize(
    ("filename", "payload", "valid", "mode"),
    [
        ("one.csv", b"molecule_id,smiles\none,CCO\n", 1, "single_compound"),
        ("many.csv", b"id,SMILES\na,CCO\nb,CCN\n", 2, "library"),
        ("many.tsv", b"name\tcanonical_smiles\na\tCCO\nb\tCCN\n", 2, "library"),
    ],
)
def test_csv_tsv_aliases(filename, payload, valid, mode):
    result = collection(files=[SourceInput(filename, payload)])
    assert result["summary"]["valid_count"] == valid
    assert result["summary"]["analysis_mode"] == mode


def test_multiple_structure_columns_require_explicit_selection():
    source = SourceInput("ambiguous.csv", b"smiles,canonical_smiles\nCCO,CCN\n")
    rejected = collection(files=[source])
    assert rejected["summary"]["valid_count"] == 0
    assert "select" in rejected["records"][0]["failure_reason"].lower()
    accepted = collection(files=[source], selected_structure_column="canonical_smiles")
    assert accepted["records"][0]["canonical_smiles"] == "CCN"


def test_single_sdf_preserves_name_properties_coordinates_and_provenance():
    result = collection(files=[SourceInput("source.sdf", sdf_bytes("C[C@H](O)F", "stereo alcohol"))])
    record = result["records"][0]
    assert record["molecule_id"] == "stereo_alcohol"
    assert "@" in record["canonical_smiles"]
    assert record["sd_properties"] == {"public_safe_property": "retained"}
    assert record["input_has_3d"] is True
    assert len(record["original_structure_sha256"]) == 64
    assert record["source_filename"] == "source.sdf"
    assert result["summary"]["analysis_mode"] == "single_compound"


def test_multi_record_and_malformed_sdf_are_isolated_in_file_collection():
    multi = sdf_bytes("CCO", "one") + sdf_bytes("CCN", "two")
    result = collection(files=[
        SourceInput("multi.sdf", multi),
        SourceInput("broken.sdf", b"not an sdf\n$$$$\n"),
        SourceInput("valid.sdf", sdf_bytes("CCC", "valid")),
        SourceInput("notes.txt", b"ignored"),
    ])
    assert result["records"][0]["failure_reason"] == SDF_MULTI_RECORD_ERROR
    assert result["summary"]["multi_record_sdf_count"] == 1
    assert result["summary"]["valid_count"] == 1
    assert result["summary"]["invalid_count"] == 2
    assert result["summary"]["ignored_file_count"] == 1
    assert result["summary"]["analysis_mode"] == "single_compound"


def test_folder_equivalent_multiple_single_record_sdfs_use_valid_count():
    one = collection(files=[SourceInput("one.sdf", sdf_bytes("CCO", "one"))])
    two = collection(files=[
        SourceInput("one.sdf", sdf_bytes("CCO", "one")),
        SourceInput("two.sdf", sdf_bytes("CCN", "two")),
    ])
    assert one["summary"]["analysis_mode"] == "single_compound"
    assert two["summary"]["analysis_mode"] == "library"


def test_single_and_folder_equivalent_pdb_import_are_conservative():
    one = collection(files=[SourceInput("ethanol.pdb", pdb_bytes())])
    assert one["summary"]["analysis_mode"] == "single_compound"
    assert one["records"][0]["canonical_smiles"] == "CCO"
    assert PDB_PREFERENCE_WARNING in one["records"][0]["warnings"]
    two = collection(files=[
        SourceInput("ethanol.pdb", pdb_bytes()),
        SourceInput("ethane.pdb", pdb_bytes("CC", "ethane")),
    ])
    assert two["summary"]["analysis_mode"] == "library"


def test_malformed_and_chemically_ambiguous_pdb_fail_closed_independently():
    malformed = collection(files=[SourceInput("broken.pdb", b"HEADER no atoms\n")])
    assert malformed["summary"]["valid_count"] == 0
    ambiguous = collection(files=[SourceInput(
        "ambiguous.pdb",
        b"HETATM    1  C1  LIG A   1       0.000   0.000   0.000  1.00  0.00           C\n"
        b"HETATM    2  O1  LIG A   1       1.200   0.000   0.000  1.00  0.00           O\n"
        b"CONECT    1    2\nCONECT    2    1\nEND\n",
    )])
    record = ambiguous["records"][0]
    assert record["structure_status"] == "unresolved_pdb_chemistry"
    assert record["validation_status"] == "invalid"
    assert PDB_PREFERENCE_WARNING in record["warnings"]


def test_public_provenance_never_contains_absolute_private_paths():
    result = collection(files=[SourceInput(r"C:\\Users\\private\\ligand.sdf", sdf_bytes("CCO", ""))])
    serialized = str(result)
    assert "Users" not in serialized
    assert result["records"][0]["source_filename"] == "ligand.sdf"


def test_import_api_persists_canonical_csv_and_manifest_without_private_paths(tmp_path, monkeypatch):
    monkeypatch.setattr(services, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(services, "UPLOAD_DIR", tmp_path / "backend" / "uploads")
    client = TestClient(app)
    response = client.post(
        "/api/molecules/import",
        data={"smiles_text": "typed CCO\ninvalid not_smiles"},
        files=[("files", ("ligand.sdf", sdf_bytes("CCN", "sdf ligand"), "chemical/x-mdl-sdfile"))],
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["valid_count"] == 2
    assert payload["invalid_count"] == 1
    assert payload["analysis_mode"] == "library"
    upload_dir = services.UPLOAD_DIR / payload["upload_id"]
    assert (upload_dir / "canonical_molecules.csv").is_file()
    assert (upload_dir / "molecule_collection.json").is_file()
    assert str(tmp_path) not in response.text


class StaticBBB:
    def predict(self, canonical_smiles, valid_molecule):
        return BBBPrediction("low", 0.2, "model_available", "")


class StaticADMET:
    def predict(self, canonical_smiles):
        return unavailable_admet_prediction(canonical_smiles, prediction_status="supported", warning="")


def test_single_compound_uses_descriptors_and_admet_without_library_analyses():
    row = prioritize_smiles(
        [{"molecule_id": "ethanol", "smiles": "CCO"}],
        bbb_predictor=StaticBBB(), admet_predictor=StaticADMET(),
        analysis_mode="single_compound",
    )[0]
    assert row["analysis_mode"] == "single_compound"
    assert row["mw"] == pytest.approx(46.069)
    assert "hia_hou" in row["admet_predictions"]
    assert row["scientific_rank"] is None
    assert row["docking_percentile_within_run"] is None
    assert row["docking_score_normalized"] is None
    assert row["prioritization_status"] == "not_applicable_single_compound"
    assert "pareto_front" not in row
    assert "diversity_cluster_id" not in row


def test_two_valid_compounds_continue_existing_library_ranking_path():
    rows = prioritize_smiles(
        [
            {"molecule_id": "one", "smiles": "CCO", "docking_score": "-8.0"},
            {"molecule_id": "two", "smiles": "CCN", "docking_score": "-7.0"},
        ],
        bbb_predictor=StaticBBB(), admet_predictor=StaticADMET(),
    )
    assert all(row["analysis_mode"] == "library" for row in rows)
    assert sorted(row["scientific_rank"] for row in rows) == [1, 2]


def test_pareto_and_sensitivity_fail_closed_for_one_valid_compound():
    with pytest.raises(Exception, match="not applicable"):
        services.run_pareto_analysis([{"valid_molecule": True, "analysis_mode": "single_compound"}], ["v2_score", "qed"])
    with pytest.raises(Exception, match="not applicable"):
        services.run_weight_sensitivity_analysis(
            [{"valid_molecule": True, "analysis_mode": "single_compound"}], {}, perturbation_magnitude=0.1,
            number_of_samples=10, analysis_seed=1,
        )
