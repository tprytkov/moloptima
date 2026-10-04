import math

import pytest
import rdkit
from rdkit import DataStructs

from biopharma_intelligence.similarity import morgan_fingerprint
from molecular_prioritization.chemical_space import nearest_neighbors, project_records


def record(molecule_id, smiles, *, status="valid", source_record="row:1", duplicate=False):
    return {
        "molecule_id": molecule_id,
        "original_molecule_id": molecule_id,
        "canonical_smiles": smiles if status == "valid" else None,
        "input_smiles": smiles,
        "validation_status": status,
        "source_type": "csv",
        "source_filename": "library.csv",
        "source_record": source_record,
        "duplicate_structure": duplicate,
    }


def test_projection_is_deterministic_and_preserves_duplicate_records():
    records = [
        record("ethanol-a", "CCO", source_record="row:1"),
        record("ethanol-b", "CCO", source_record="row:2", duplicate=True),
        record("benzene", "c1ccccc1", source_record="row:3"),
        record("invalid", "C1CC", status="invalid", source_record="row:4"),
    ]

    first = project_records(records)
    second = project_records(records)

    assert first == second
    assert first["total_count"] == 4
    assert first["projected_count"] == 3
    assert first["excluded_count"] == 1
    assert [point["molecule_id"] for point in first["points"]] == ["ethanol-a", "ethanol-b", "benzene"]
    assert first["points"][0]["x"] == first["points"][1]["x"]
    assert first["points"][0]["y"] == first["points"][1]["y"]
    assert first["excluded"][0]["molecule_id"] == "invalid"
    assert first["metadata"]["fingerprint_radius"] == 2
    assert first["metadata"]["fingerprint_bits"] == 2048
    assert first["metadata"]["similarity_metric"] == "Tanimoto"
    assert first["metadata"]["rdkit_version"] == rdkit.__version__


def test_neighbor_similarity_matches_rdkit_tanimoto_and_orders_descending():
    records = [record("ethanol", "CCO"), record("propanol", "CCCO"), record("benzene", "c1ccccc1")]

    payload = nearest_neighbors(records, "ethanol", 5)

    expected = DataStructs.TanimotoSimilarity(morgan_fingerprint("CCO"), morgan_fingerprint("CCCO"))
    assert payload["neighbors"][0]["molecule_id"] == "propanol"
    assert payload["neighbors"][0]["similarity"] == pytest.approx(expected, abs=1e-7)
    similarities = [row["similarity"] for row in payload["neighbors"]]
    assert similarities == sorted(similarities, reverse=True)
    assert all(math.isfinite(value) and 0 <= value <= 1 for value in similarities)


def test_duplicate_structure_is_a_distinct_neighbor_with_similarity_one():
    records = [record("copy-a", "CCO"), record("copy-b", "CCO", duplicate=True)]
    payload = nearest_neighbors(records, "copy-a", 5)
    assert payload["neighbors"] == [pytest.approx({
        **payload["neighbors"][0], "similarity": 1.0,
    })]
    assert payload["neighbors"][0]["molecule_id"] == "copy-b"


def test_invalid_query_is_rejected():
    with pytest.raises(ValueError, match="not a valid member"):
        nearest_neighbors([record("bad", "C1CC", status="invalid")], "bad", 10)
