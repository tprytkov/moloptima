import copy

import rdkit

from molecular_prioritization.scaffolds import NO_RING_SCAFFOLD_ID, organize_scaffolds


def record(molecule_id, smiles, *, status="valid", duplicate=False):
    return {
        "molecule_id": molecule_id,
        "original_molecule_id": molecule_id,
        "canonical_smiles": smiles if status == "valid" else None,
        "validation_status": status,
        "source_type": "csv",
        "source_filename": "library.csv",
        "source_record": molecule_id,
        "duplicate_structure": duplicate,
    }


def test_scaffolds_are_deterministic_and_keep_duplicate_members():
    records = [
        record("phenol", "Oc1ccccc1"),
        record("aniline", "Nc1ccccc1"),
        record("phenol-copy", "Oc1ccccc1", duplicate=True),
        record("ethanol", "CCO"),
        record("bad", "C1CC", status="invalid"),
    ]
    first = organize_scaffolds(records)
    assert first == organize_scaffolds(records)
    assert first["summary"] == {
        "total_record_count": 5, "molecule_count": 4, "scaffold_count": 1,
        "group_count": 2, "acyclic_count": 1, "excluded_count": 1,
    }
    benzene = next(group for group in first["scaffolds"] if group["category"] == "bemis_murcko")
    assert benzene["scaffold_smiles"] == "c1ccccc1"
    assert benzene["member_count"] == 3
    assert benzene["unique_structure_count"] == 2
    assert [member["molecule_id"] for member in benzene["members"]] == ["phenol", "aniline", "phenol-copy"]
    assert benzene["molecule_ids"] == ["phenol", "aniline", "phenol-copy"]
    assert next(group for group in first["scaffolds"] if group["scaffold_id"] == NO_RING_SCAFFOLD_ID)["members"][0]["molecule_id"] == "ethanol"
    assert first["excluded"][0]["molecule_id"] == "bad"
    assert first["metadata"]["rdkit_version"] == rdkit.__version__


def test_empty_collection_and_tie_order_are_stable():
    assert organize_scaffolds([])["summary"]["group_count"] == 0
    groups = organize_scaffolds([
        record("benzene", "c1ccccc1"), record("cyclohexane", "C1CCCCC1"),
    ])["scaffolds"]
    assert [group["scaffold_id"] for group in groups] == sorted(group["scaffold_id"] for group in groups)


def test_different_cores_have_different_stable_ids_and_input_is_not_mutated():
    records = [record("benzene", "c1ccccc1"), record("cyclohexane", "C1CCCCC1")]
    original = copy.deepcopy(records)
    first = organize_scaffolds(records)
    second = organize_scaffolds(copy.deepcopy(records))
    assert records == original
    identities = {(group["scaffold_smiles"], group["scaffold_id"]) for group in first["scaffolds"]}
    assert len(identities) == 2
    assert identities == {(group["scaffold_smiles"], group["scaffold_id"]) for group in second["scaffolds"]}


def test_metadata_completely_describes_scaffold_science_and_import_context():
    metadata = organize_scaffolds([record("benzene", "c1ccccc1")])["metadata"]
    assert metadata["method"] == "Bemis-Murcko scaffold"
    assert metadata["implementation"].endswith("GetScaffoldForMol")
    assert metadata["algorithm_version"] == "bemis_murcko_v1"
    assert metadata["rdkit_version"] == rdkit.__version__
    assert "stereochemistry removed" in metadata["canonicalization"]
    assert "fragment-parent" in metadata["input_context"]
    assert "descriptive" in metadata["caveat"]
