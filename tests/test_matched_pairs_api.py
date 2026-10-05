from fastapi.testclient import TestClient
import pytest

from backend.main import app


client = TestClient(app)


def test_bounded_batch_endpoint_returns_structural_contract():
    response = client.post("/api/matched-pairs/analyze-batch", json={
        "query": {"id": "selected-1", "source": "moloptima", "smiles": "Cc1ccccc1"},
        "references": [
            {"id": "CHEMBL1", "source": "chembl", "smiles": "Clc1ccccc1"},
            {"id": "CHEMBL2", "source": "chembl", "smiles": "Cc1ccccc1"},
        ],
    })
    assert response.status_code == 200
    payload = response.json()
    assert payload["policy_version"] == "moloptima-mmp-policy-v1"
    assert payload["candidate_count"] == 2
    assert payload["results"][0]["matched_pair"] is True
    assert payload["results"][1]["reason"] == "identical_structure"


def test_batch_endpoint_rejects_empty_and_unbounded_requests():
    query = {"id": "q", "source": "moloptima", "smiles": "Cc1ccccc1"}
    assert client.post("/api/matched-pairs/analyze-batch", json={"query": query, "references": []}).status_code == 422
    references = [{"id": f"r-{index}", "source": "fixture", "smiles": "Clc1ccccc1"} for index in range(101)]
    assert client.post("/api/matched-pairs/analyze-batch", json={"query": query, "references": references}).status_code == 422


@pytest.mark.parametrize("count", [1, 10, 25, 50])
def test_batch_endpoint_preserves_query_relative_count_and_order(count):
    references = [
        {"id": f"CHEMBL{index}", "source": "chembl", "smiles": "Clc1ccccc1" if index % 2 else "CCO"}
        for index in range(1, count + 1)
    ]
    response = client.post("/api/matched-pairs/analyze-batch", json={
        "query": {"id": "selected-query", "source": "moloptima", "smiles": "Cc1ccccc1"},
        "references": references,
    })
    assert response.status_code == 200
    payload = response.json()
    assert payload["query_id"] == "selected-query"
    assert payload["candidate_count"] == count
    assert [item["reference"]["id"] for item in payload["results"]] == [item["id"] for item in references]


def test_batch_endpoint_retains_duplicate_and_invalid_candidates_as_distinct_results():
    response = client.post("/api/matched-pairs/analyze-batch", json={
        "query": {"id": "q", "source": "moloptima", "smiles": "Cc1ccccc1"},
        "references": [
            {"id": "duplicate-a", "source": "fixture", "smiles": "Clc1ccccc1"},
            {"id": "duplicate-b", "source": "fixture", "smiles": "Clc1ccccc1"},
            {"id": "invalid", "source": "fixture", "smiles": "not-smiles"},
        ],
    })
    assert response.status_code == 200
    payload = response.json()
    assert [item["reference"]["id"] for item in payload["results"]] == ["duplicate-a", "duplicate-b", "invalid"]
    assert payload["results"][0]["transformation"] == payload["results"][1]["transformation"]
    assert payload["results"][2]["reason"] == "reference_invalid_structure"
