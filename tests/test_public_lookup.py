from pathlib import Path

from biopharma_intelligence.public_lookup import PubChemClient


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
