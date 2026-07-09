from pathlib import Path

from biopharma_intelligence.public_lookup import ChEMBLClient, PubChemClient


class FakePubChemClient(PubChemClient):
    def __init__(self, *, cache_dir: Path, result=None, error: Exception | None = None):
        super().__init__(cache_dir=cache_dir)
        self.result = result
        self.error = error
        self.fetch_count = 0

    def _fetch_pubchem_result(self, identity_key):
        self.fetch_count += 1
        if self.error:
            raise self.error
        return self.result


class FakeChEMBLClient(ChEMBLClient):
    def __init__(self, *, cache_dir: Path, result=None, error: Exception | None = None):
        super().__init__(cache_dir=cache_dir)
        self.result = result
        self.error = error
        self.fetch_count = 0

    def _fetch_chembl_result(self, identity_key):
        self.fetch_count += 1
        if self.error:
            raise self.error
        return self.result


def chembl_result(**overrides):
    payload = {
        "chembl_exact_match": True,
        "chembl_molecule_id": "CHEMBL25",
        "chembl_pref_name": "ASPIRIN",
        "chembl_lookup_status": "exact_match",
        "chembl_cache_status": "fresh_lookup",
        "chembl_warning": "",
        "chembl_activity_count": 42,
        "chembl_target_count": 5,
        "chembl_target_summary": "Target A; Target B",
        "chembl_similarity_match": False,
        "chembl_similarity_score": None,
        "chembl_similarity_molecule_id": None,
        "chembl_similarity_pref_name": None,
        "chembl_similarity_status": "not_run_exact_match_found",
    }
    payload.update(overrides)
    return ChEMBLClient(cache_dir=Path("."))._result_from_payload({"result": payload})


def test_pubchem_lookup_exact_match_writes_cache(tmp_path):
    client = FakePubChemClient(
        cache_dir=tmp_path / "pubchem",
        result=PubChemClient(cache_dir=tmp_path)._result_from_payload(
            {
                "result": {
                    "pubchem_exact_match": True,
                    "pubchem_cid": "2244",
                    "pubchem_preferred_name": "Aspirin",
                    "pubchem_lookup_status": "exact_match",
                    "pubchem_cache_status": "fresh_lookup",
                    "pubchem_warning": "",
                }
            }
        ),
    )

    result = client.lookup_exact_identity("CC(=O)Oc1ccccc1C(=O)O", True)

    assert result.pubchem_exact_match is True
    assert result.pubchem_cid == "2244"
    assert result.pubchem_lookup_status == "exact_match"
    assert result.pubchem_cache_status == "fresh_lookup"
    assert client.fetch_count == 1
    assert len(list((tmp_path / "pubchem").glob("*.json"))) == 1


def test_pubchem_lookup_no_match_is_cached(tmp_path):
    client = FakePubChemClient(
        cache_dir=tmp_path / "pubchem",
        result=PubChemClient(cache_dir=tmp_path)._result_from_payload(
            {
                "result": {
                    "pubchem_exact_match": False,
                    "pubchem_cid": None,
                    "pubchem_preferred_name": None,
                    "pubchem_lookup_status": "no_exact_match",
                    "pubchem_cache_status": "fresh_lookup",
                    "pubchem_warning": "",
                }
            }
        ),
    )

    result = client.lookup_exact_identity("CCCC", True)

    assert result.pubchem_exact_match is False
    assert result.pubchem_lookup_status == "no_exact_match"
    assert result.pubchem_cache_status == "fresh_lookup"
    assert client.fetch_count == 1


def test_pubchem_lookup_skips_invalid_molecule(tmp_path):
    client = FakePubChemClient(cache_dir=tmp_path / "pubchem")

    result = client.lookup_exact_identity(None, False)

    assert result.pubchem_lookup_status == "not_run_invalid_molecule"
    assert result.pubchem_cache_status == "not_used"
    assert client.fetch_count == 0


def test_pubchem_lookup_uses_cache_without_network(tmp_path):
    client = FakePubChemClient(
        cache_dir=tmp_path / "pubchem",
        result=PubChemClient(cache_dir=tmp_path)._result_from_payload(
            {
                "result": {
                    "pubchem_exact_match": True,
                    "pubchem_cid": "702",
                    "pubchem_preferred_name": "Ethanol",
                    "pubchem_lookup_status": "exact_match",
                    "pubchem_cache_status": "fresh_lookup",
                    "pubchem_warning": "",
                }
            }
        ),
    )

    first_result = client.lookup_exact_identity("CCO", True)
    cached_result = client.lookup_exact_identity("CCO", True)

    assert first_result.pubchem_cache_status == "fresh_lookup"
    assert cached_result.pubchem_cache_status == "cache_hit"
    assert cached_result.pubchem_cid == "702"
    assert client.fetch_count == 1


def test_pubchem_lookup_failure_is_graceful_and_cached(tmp_path):
    client = FakePubChemClient(
        cache_dir=tmp_path / "pubchem",
        error=RuntimeError("network unavailable"),
    )

    result = client.lookup_exact_identity("CCO", True)
    cached_result = client.lookup_exact_identity("CCO", True)

    assert result.pubchem_exact_match is False
    assert result.pubchem_lookup_status == "lookup_failed"
    assert result.pubchem_cache_status == "cache_miss"
    assert "network unavailable" in result.pubchem_warning
    assert cached_result.pubchem_lookup_status == "lookup_failed"
    assert cached_result.pubchem_cache_status == "cache_hit"
    assert client.fetch_count == 1


def test_chembl_lookup_exact_match_writes_cache(tmp_path):
    client = FakeChEMBLClient(
        cache_dir=tmp_path / "chembl",
        result=chembl_result(),
    )

    result = client.lookup_bioactivity_context("CC(=O)Oc1ccccc1C(=O)O", True)

    assert result.chembl_exact_match is True
    assert result.chembl_molecule_id == "CHEMBL25"
    assert result.chembl_lookup_status == "exact_match"
    assert result.chembl_cache_status == "fresh_lookup"
    assert result.chembl_activity_count == 42
    assert result.chembl_target_count == 5
    assert client.fetch_count == 1
    assert len(list((tmp_path / "chembl").glob("*.json"))) == 1


def test_chembl_lookup_no_match_is_cached(tmp_path):
    client = FakeChEMBLClient(
        cache_dir=tmp_path / "chembl",
        result=chembl_result(
            chembl_exact_match=False,
            chembl_molecule_id=None,
            chembl_pref_name=None,
            chembl_lookup_status="no_match",
            chembl_activity_count=0,
            chembl_target_count=0,
            chembl_target_summary=None,
            chembl_similarity_status="no_match",
        ),
    )

    result = client.lookup_bioactivity_context("CCCC", True)

    assert result.chembl_exact_match is False
    assert result.chembl_lookup_status == "no_match"
    assert result.chembl_cache_status == "fresh_lookup"
    assert client.fetch_count == 1


def test_chembl_lookup_skips_invalid_molecule(tmp_path):
    client = FakeChEMBLClient(cache_dir=tmp_path / "chembl")

    result = client.lookup_bioactivity_context(None, False)

    assert result.chembl_lookup_status == "not_run_invalid_molecule"
    assert result.chembl_cache_status == "not_used"
    assert client.fetch_count == 0


def test_chembl_lookup_uses_cache_without_network(tmp_path):
    client = FakeChEMBLClient(
        cache_dir=tmp_path / "chembl",
        result=chembl_result(
            chembl_exact_match=False,
            chembl_molecule_id=None,
            chembl_pref_name=None,
            chembl_lookup_status="similarity_match",
            chembl_similarity_match=True,
            chembl_similarity_score=91.2,
            chembl_similarity_molecule_id="CHEMBL545",
            chembl_similarity_pref_name="ETHANOL",
            chembl_similarity_status="similarity_match",
        ),
    )

    first_result = client.lookup_bioactivity_context("CCO", True)
    cached_result = client.lookup_bioactivity_context("CCO", True)

    assert first_result.chembl_cache_status == "fresh_lookup"
    assert cached_result.chembl_cache_status == "cache_hit"
    assert cached_result.chembl_similarity_molecule_id == "CHEMBL545"
    assert client.fetch_count == 1


def test_chembl_lookup_failure_is_graceful_and_cached(tmp_path):
    client = FakeChEMBLClient(
        cache_dir=tmp_path / "chembl",
        error=RuntimeError("chembl unavailable"),
    )

    result = client.lookup_bioactivity_context("CCO", True)
    cached_result = client.lookup_bioactivity_context("CCO", True)

    assert result.chembl_exact_match is False
    assert result.chembl_lookup_status == "lookup_failed"
    assert result.chembl_cache_status == "cache_miss"
    assert "chembl unavailable" in result.chembl_warning
    assert cached_result.chembl_lookup_status == "lookup_failed"
    assert cached_result.chembl_cache_status == "cache_hit"
    assert client.fetch_count == 1
