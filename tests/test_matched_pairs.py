import json
from time import perf_counter

import pytest
from rdkit import Chem

from molecular_prioritization.matched_pairs import (
    POLICY_VERSION,
    analyze_matched_pair,
    analyze_matched_pair_batch,
    policy_contract,
)


def test_aromatic_substituent_replacement_has_mapped_shared_core_and_direction():
    result = analyze_matched_pair(
        "Cc1ccccc1", "Clc1ccccc1", query_id="selected-1",
        reference_id="CHEMBL1", reference_source="chembl",
    )
    assert result["matched_pair"] is True
    assert result["policy_version"] == POLICY_VERSION
    assert result["shared_core"] == {
        "canonical_smiles": "c1ccc([*:1])cc1", "heavy_atom_count": 6, "attachment_count": 1,
    }
    assert result["query_fragment"]["canonical_smiles"] == "C[*:1]"
    assert result["reference_fragment"]["canonical_smiles"] == "Cl[*:1]"
    assert result["transformation"]["query_to_reference"] == "C[*:1] >> Cl[*:1]"
    assert result["transformation"]["reference_to_query"] == "Cl[*:1] >> C[*:1]"
    assert result["relationship"]["tanimoto"] is not None
    assert result["relationship"]["same_murcko_scaffold"] is True
    assert "activity" not in json.dumps(result["transformation"]).lower()


@pytest.mark.parametrize(("query", "reference"), [
    ("Cc1ccncc1", "Clc1ccncc1"),
    ("COc1ccccc1", "CCOc1ccccc1"),
    ("CCc1ccccc1", "Cc1ccccc1"),
])
def test_common_medchem_single_cut_examples(query, reference):
    result = analyze_matched_pair(query, reference)
    assert result["matched_pair"] is True
    assert result["shared_core"]["attachment_count"] == 1


def test_atom_order_and_repeated_analysis_are_invariant():
    first = analyze_matched_pair("Cc1ccccc1", "Clc1ccccc1")
    reordered = analyze_matched_pair("c1(C)ccccc1", "c1ccc(Cl)cc1")
    repeated = analyze_matched_pair("Cc1ccccc1", "Clc1ccccc1")
    for key in ("shared_core", "query_fragment", "reference_fragment", "transformation"):
        assert first[key] == reordered[key] == repeated[key]


def test_symmetric_fragmentation_is_deduplicated_and_deterministic():
    results = [analyze_matched_pair("Cc1ccc(C)cc1", "Clc1ccc(C)cc1") for _ in range(5)]
    assert all(result["matched_pair"] for result in results)
    assert len({json.dumps(result["transformation"], sort_keys=True) for result in results}) == 1


def test_identical_stereo_invalid_disconnected_and_nonmatch_states_are_explicit():
    assert analyze_matched_pair("c1ccccc1C", "Cc1ccccc1")["reason"] == "identical_structure"
    assert analyze_matched_pair("F[C@H](Cl)Br", "F[C@@H](Cl)Br")["reason"] == "stereochemistry_only_unsupported"
    assert analyze_matched_pair("not-smiles", "Cc1ccccc1")["reason"] == "query_invalid_structure"
    assert analyze_matched_pair("CC.CC", "Cc1ccccc1")["reason"] == "query_unsupported_disconnected_structure"
    assert analyze_matched_pair("CCO", "CCN")["matched_pair"] is False
    assert analyze_matched_pair("CCO", "CCN")["reason"] == "unsupported_topology"


def test_multi_cut_only_relationship_is_not_forced_into_v1_policy():
    result = analyze_matched_pair("Cc1ccc(C)cc1", "Clc1ccc(Cl)cc1")
    assert result["matched_pair"] is False
    assert result["reason"] == "no_accepted_single_cut_common_core"


def test_policy_is_explicit_and_excludes_ring_cuts():
    policy = policy_contract()
    assert policy["cut_count"] == 1
    assert policy["ring_bond_cutting"] is False
    assert policy["attachment_label"] == "[*:1]"
    assert policy["variable_fragment_heavy_atom_range"] == [1, 10]


def test_batch_is_query_relative_bounded_ordered_and_contains_no_activity_inference():
    references = [
        {"id": "CHEMBL2", "source": "chembl", "smiles": "Clc1ccccc1"},
        {"id": "CHEMBL1", "source": "chembl", "smiles": "Cc1ccccc1"},
        {"id": "CHEMBL3", "source": "chembl", "smiles": "CCO"},
    ]
    result = analyze_matched_pair_batch({"id": "selected", "smiles": "Cc1ccccc1"}, references)
    assert [item["reference"]["id"] for item in result["results"]] == ["CHEMBL2", "CHEMBL1", "CHEMBL3"]
    assert result["candidate_count"] == 3
    assert result["matched_pair_count"] == 1
    encoded = json.dumps(result).lower()
    for prohibited in ("potency-enhancing", "favorable transformation", "expected ec50", "activity prediction"):
        assert prohibited not in encoded


def test_query_relative_batch_performance_scales_without_all_pairs(request):
    timings = {}
    pool = ["Clc1ccccc1", "CCc1ccccc1", "COc1ccccc1", "Fc1ccccc1"]
    for count in (10, 25, 50, 100):
        references = [{"id": f"ref-{index}", "source": "fixture", "smiles": pool[index % len(pool)]} for index in range(count)]
        started = perf_counter()
        result = analyze_matched_pair_batch({"id": "query", "smiles": "Cc1ccccc1"}, references)
        timings[count] = (perf_counter() - started) * 1000
        assert len(result["results"]) == count
    request.node.add_report_section("call", "Batch 13 MMP benchmark (ms)", json.dumps(timings, sort_keys=True))
    assert timings[100] < 5000


def test_canonical_fragments_round_trip_through_rdkit():
    result = analyze_matched_pair("Cc1ccccc1", "Clc1ccccc1")
    for section in ("shared_core", "query_fragment", "reference_fragment"):
        assert Chem.MolFromSmiles(result[section]["canonical_smiles"]) is not None
