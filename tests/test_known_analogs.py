import json
import urllib.error

import pytest

from biopharma_intelligence import known_analogs


class FixtureSource(known_analogs.KnownCompoundSource):
    source_name = "ChEMBL"
    source_query_threshold = 73

    def __init__(self):
        self.exact_calls = 0
        self.similarity_calls = 0
        self.compound_calls = 0
        self.record_calls = 0

    def exact_structure_search(self, canonical_smiles):
        self.exact_calls += 1
        return [compound("CHEMBL1", canonical_smiles, "Exact")]

    def similarity_candidates(self, canonical_smiles, limit):
        self.similarity_calls += 1
        return [
            compound("CHEMBL1", canonical_smiles, "Exact duplicate"),
            compound("CHEMBL2", "CCc1ccccc1", "Same scaffold analog"),
            compound("CHEMBL3", "CCO", "Acyclic analog"),
            {"source_compound_id": "CHEMBL4", "canonical_smiles": "not-smiles"},
        ]

    def fetch_compound(self, source_compound_id):
        self.compound_calls += 1
        return compound(source_compound_id, "CCc1ccccc1", "Known analog")

    def fetch_experimental_records(self, source_compound_id, limit):
        self.record_calls += 1
        rows = [
            activity("A1", "IC50", "10", "nM", "=", target="T1", assay="B1"),
            activity("A2", "IC50", "10", "uM", ">", target="T1", assay="B1"),
            activity("A3", "IC50", "25", "nM", "=", target="T1", assay="B2"),
            activity("A4", "EC50", "5", "nM", "=", target="T1", assay="B3"),
            activity("A5", "Ki", "2", "nM", "=", target="T2", assay="B4"),
            activity("A6", "Kd", "4", "nM", "=", target="T2", assay="B5"),
            activity("A7", "Inhibition", "42", "%", "=", target="T3", assay="B6"),
            activity("A8", "LogP", "3.2", "", "=", target="T4", assay="B7"),
            activity("A9", "IC50", "7", "nM", "=", target="", assay="B8"),
        ]
        return {"activities": rows[:limit], "total_count": len(rows)}


def compound(identifier, smiles, name=None):
    return {
        "source": "ChEMBL", "source_compound_id": identifier, "preferred_name": name,
        "canonical_smiles": smiles, "source_url": f"https://example.test/{identifier}",
    }


def activity(identifier, endpoint, value, unit, relation, *, target, assay):
    return {
        "activity_id": identifier, "standard_type": endpoint, "standard_value": value,
        "standard_units": unit, "standard_relation": relation,
        "target_chembl_id": target, "target_pref_name": f"Target {target}" if target else "",
        "target_organism": "Homo sapiens", "assay_chembl_id": assay,
        "assay_type": "B", "bao_label": "single protein format",
        "assay_description": "Public fixture assay", "document_chembl_id": "CHEMBL-DOC-1",
    }


def query():
    return {"molecule_id": "generated-1", "display_name": "Generated 1", "canonical_smiles": "Cc1ccccc1"}


def test_exact_and_neighbor_search_uses_local_tanimoto_and_deterministic_order(tmp_path):
    result = known_analogs.search_known_analogs(query(), max_analogs=10, adapter=FixtureSource(), cache_dir=tmp_path)
    assert result["exact_match"] is True
    assert result["exact_matches"][0]["moloptima_tanimoto"] == 1.0
    assert [item["source_compound_id"] for item in result["analogs"]] == ["CHEMBL2", "CHEMBL3"]
    assert all(item["moloptima_tanimoto"] < 1 for item in result["analogs"])
    assert result["analogs"][0]["same_murcko_scaffold"] == "Yes"
    assert result["analogs"][1]["same_murcko_scaffold"] == "No"
    assert result["excluded_malformed_structures"] == 1
    assert result["search_provenance"]["source_query_threshold"] == 73
    assert result["search_provenance"]["source_query_threshold_role"] == "retrieval_parameter_not_scientific_cutoff"
    assert "experimental" not in result["query_molecule"]


def test_no_exact_match_is_a_valid_search_state(tmp_path):
    source = FixtureSource()
    source.exact_structure_search = lambda smiles: []
    original_similarity = source.similarity_candidates
    source.similarity_candidates = lambda smiles, limit: [
        item for item in original_similarity(smiles, limit) if item.get("source_compound_id") != "CHEMBL1"
    ]
    result = known_analogs.search_known_analogs(query(), max_analogs=10, adapter=source, cache_dir=tmp_path)
    assert result["exact_match"] is False
    assert result["exact_matches"] == []
    assert result["analogs"]


def test_search_cache_hit_and_explicit_refresh(tmp_path):
    source = FixtureSource()
    first = known_analogs.search_known_analogs(query(), adapter=source, cache_dir=tmp_path)
    second = known_analogs.search_known_analogs(query(), adapter=source, cache_dir=tmp_path)
    assert first["search_provenance"]["cache_status"] == "fresh_lookup"
    assert second["search_provenance"]["cache_status"] == "cache_hit"
    assert (source.exact_calls, source.similarity_calls) == (1, 1)
    refreshed = known_analogs.search_known_analogs(query(), adapter=source, cache_dir=tmp_path, refresh=True)
    assert refreshed["search_provenance"]["cache_status"] == "refresh"
    assert (source.exact_calls, source.similarity_calls) == (2, 2)


def test_record_normalization_censoring_percentage_provenance_and_compatibility(tmp_path):
    result = known_analogs.retrieve_experimental_records("CHEMBL2", adapter=FixtureSource(), cache_dir=tmp_path)
    by_id = {record["source_record_id"]: record for record in result["records"]}
    assert by_id["A1"]["normalization"]["transformed_value"] == pytest.approx(8.0)
    assert by_id["A2"]["relation"] == ">"
    assert by_id["A2"]["normalization"]["transformed_relation"] == "<"
    assert by_id["A2"]["normalization"]["transformed_value"] == pytest.approx(5.0)
    assert by_id["A4"]["normalization"]["transformed_endpoint"] == "pEC50"
    assert by_id["A5"]["normalization"]["transformed_endpoint"] == "pKi"
    assert by_id["A6"]["normalization"]["transformed_endpoint"] == "pKd"
    assert by_id["A7"]["normalization"]["reason"] == "percentage_endpoint_preserved"
    assert by_id["A8"]["normalization"]["reason"] == "unsupported_endpoint"
    assert by_id["A1"]["target"]["identifier"] == "T1"
    assert by_id["A1"]["assay_id"] == "B1"
    assert by_id["A1"]["target"]["organism"] == "Homo sapiens"
    assert by_id["A1"]["publication_reference"] == "CHEMBL-DOC-1"
    assert by_id["A1"]["compatibility"]["label"] == "Directly comparable metadata"
    assert by_id["A3"]["compatibility"]["label"] == "Different assay context"
    assert by_id["A4"]["compatibility"]["label"] == "Different endpoint"
    assert by_id["A9"]["compatibility"]["label"] == "Compatibility unclear"
    assert result["source_total_count"] == 9
    assert result["normalization_summary"] == {"normalized": 7, "not_converted": 2, "censored": 1}


def test_record_cache_is_deterministic(tmp_path):
    source = FixtureSource()
    first = known_analogs.retrieve_experimental_records("CHEMBL2", adapter=source, cache_dir=tmp_path)
    second = known_analogs.retrieve_experimental_records("CHEMBL2", adapter=source, cache_dir=tmp_path)
    assert first["records"] == second["records"]
    assert second["provenance"]["cache_status"] == "cache_hit"
    assert (source.compound_calls, source.record_calls) == (1, 1)


@pytest.mark.parametrize(("status_code", "expected"), [(429, "rate_limited"), (503, "source_unavailable"), (500, "source_error")])
def test_http_failures_are_distinct(monkeypatch, status_code, expected):
    def fail(*args, **kwargs):
        raise urllib.error.HTTPError("https://example.test", status_code, "failure", {}, None)
    monkeypatch.setattr(known_analogs.urllib.request, "urlopen", fail)
    with pytest.raises(known_analogs.KnownSourceError) as caught:
        known_analogs.ChEMBLKnownCompoundSource()._get_json("https://example.test")
    assert caught.value.code == expected


def test_timeout_offline_and_malformed_response_are_distinct(monkeypatch):
    client = known_analogs.ChEMBLKnownCompoundSource()
    monkeypatch.setattr(known_analogs.urllib.request, "urlopen", lambda *args, **kwargs: (_ for _ in ()).throw(TimeoutError()))
    with pytest.raises(known_analogs.KnownSourceError, match="timeout") as timeout:
        client._get_json("https://example.test")
    assert timeout.value.code == "timeout"
    monkeypatch.setattr(known_analogs.urllib.request, "urlopen", lambda *args, **kwargs: (_ for _ in ()).throw(urllib.error.URLError("network unreachable")))
    with pytest.raises(known_analogs.KnownSourceError) as offline:
        client._get_json("https://example.test")
    assert offline.value.code == "offline"

    class Response:
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def read(self): return b"not-json"
    monkeypatch.setattr(known_analogs.urllib.request, "urlopen", lambda *args, **kwargs: Response())
    with pytest.raises(known_analogs.KnownSourceError) as malformed:
        client._get_json("https://example.test")
    assert malformed.value.code == "malformed_source_response"


def test_scaffold_edge_states():
    assert known_analogs.compare_murcko_scaffolds("CCO", "CCN") == "No ring scaffold"
    assert known_analogs.compare_murcko_scaffolds("CCO", "c1ccccc1") == "No"
    assert known_analogs.compare_murcko_scaffolds("bad", "CCO") == "unavailable"


def test_cache_payload_contains_only_public_query_identity(tmp_path):
    known_analogs.search_known_analogs(query(), adapter=FixtureSource(), cache_dir=tmp_path)
    payload = json.loads(next(tmp_path.rglob("*.json")).read_text(encoding="utf-8"))
    encoded = json.dumps(payload)
    assert "generated-1" in encoded
    assert "filename" not in encoded.lower()
    assert "C:\\" not in encoded
