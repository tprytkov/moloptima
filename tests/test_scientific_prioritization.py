from __future__ import annotations

import pytest

from backend.schemas import MoleculeAnalysisResult
from biopharma_intelligence.public_lookup import PatentContextResult
from molecular_prioritization.admet_registry import CLASSIFICATION_ENDPOINTS, REGRESSION_ENDPOINTS
from molecular_prioritization.bbb_predictor import UnavailableBBBPredictor
from molecular_prioritization.pipeline import prioritize_smiles
from molecular_prioritization.prioritization import PRIORITIZATION_RANKING_VERSION


class CompleteRegistry:
    def __init__(self, *, bbb_probability: float = 0.8, bbb_martins: float | None = None):
        self.bbb_probability = bbb_probability
        self.bbb_martins = bbb_martins

    def predict_batch(self, molecule_ids, canonical_smiles):
        return [
            complete_admet_result(
                molecule_id,
                smiles,
                bbb_probability=self.bbb_probability,
                bbb_martins=self.bbb_martins,
            )
            for molecule_id, smiles in zip(molecule_ids, canonical_smiles, strict=True)
        ]


class PatentClient:
    def lookup_patent_context(self, smiles, valid_molecule, **kwargs):
        return PatentContextResult(
            patent_lookup_status="match_found",
            patent_cache_status="fresh_lookup",
            patent_public_evidence_match=True,
            patent_source="SureChEMBL",
            patent_record_count=999,
            patent_top_record_id="WO-TEST",
            patent_top_record_title="Test record",
            patent_top_record_url="https://example.invalid/WO-TEST",
            patent_query_identifier="test",
            patent_warning="",
        )


class MixedDockingEngine:
    def __init__(self, results_by_id):
        self.results_by_id = results_by_id

    def dock_batch(self, molecule_ids, smiles, *, progress_callback=None):
        results = []
        successes = failures = 0
        for index, (molecule_id, canonical_smiles) in enumerate(zip(molecule_ids, smiles, strict=True), start=1):
            configured = self.results_by_id[molecule_id]
            status = configured["status"]
            successes += status == "success"
            failures += status != "success"
            results.append({
                "molecule_id": molecule_id,
                "canonical_smiles": canonical_smiles,
                "status": status,
                "best_affinity_kcal_mol": configured.get("affinity"),
                "warning": configured.get("warning", ""),
            })
            if progress_callback:
                progress_callback(index, successes, failures)
        return results


def complete_admet_result(molecule_id, smiles, *, bbb_probability=0.8, bbb_martins=None):
    classification_endpoints = {
        name: {
            "raw_logit": 0.1,
            "raw_probability": 0.4,
            "calibrated_probability": 0.6,
            "binary_prediction": 1,
            "display_name": name,
            "positive_class_meaning": "positive class",
            "evidence_status": "available",
            "warning": "",
        }
        for name in CLASSIFICATION_ENDPOINTS
    }
    if bbb_martins is not None:
        classification_endpoints["bbb_martins"] = {
            "calibrated_probability": bbb_martins,
            "binary_prediction": int(bbb_martins >= 0.5),
        }
    regression_endpoints = {
        name: {
            "status": "success",
            "ensemble_mean_value": float(index),
            "seed_standard_deviation_value": 0.1,
            "unit": "test-unit",
            "representation": "test-transform",
        }
        for index, name in enumerate(REGRESSION_ENDPOINTS, start=1)
    }
    return {
        "molecule_id": molecule_id,
        "canonical_smiles": smiles,
        "status": "success",
        "warning": "",
        "family_status": {
            "chemberta": "available",
            "gmc_bbb": "success",
            "chemprop_regression": "success",
        },
        "classification": {"status": "available", "endpoints": classification_endpoints},
        "bbb": {
            "status": "success",
            "seed_probabilities": {
                "13": 0.76, "37": 0.78, "73": 0.80, "101": 0.82, "137": 0.84,
            },
            "ensemble_probability": bbb_probability,
            "ensemble_standard_deviation": 0.028284,
            "threshold": 0.5,
            "threshold_status": "provisional_raw",
            "raw_classification": "BBB+" if bbb_probability >= 0.5 else "BBB-",
            "calibration_status": "not_frozen",
            "prediction": "BBB+" if bbb_probability >= 0.5 else "BBB-",
            "warning": "",
        },
        "regression": {"status": "success", "endpoints": regression_endpoints},
    }


def test_component_arithmetic_is_deterministic_and_reproduces_base_priority_score():
    first = prioritize_smiles(
        [{"molecule_id": "mol", "smiles": "CCO"}], admet_registry=CompleteRegistry(),
    )[0]
    second = prioritize_smiles(
        [{"molecule_id": "mol", "smiles": "CCO"}], admet_registry=CompleteRegistry(),
    )[0]

    assert first["prioritization"] == second["prioritization"]
    contributions = [
        component["contribution"]
        for component in first["prioritization"]["components"].values()
        if component["score_scope"] == "priority_score" and component["contribution"] is not None
    ]
    assert round(max(0.0, min(sum(contributions), 1.0)), 3) == first["priority_score"]
    assert first["prioritization"]["priority_score"] == first["priority_score"]
    assert first["ranking_version"] == PRIORITIZATION_RANKING_VERSION


def test_raw_admet_and_bbb_values_remain_unchanged():
    row = prioritize_smiles(
        [{"molecule_id": "mol", "smiles": "CCO"}], admet_registry=CompleteRegistry(),
    )[0]

    assert row["bbb_result"]["seed_probabilities"] == {
        "13": 0.76, "37": 0.78, "73": 0.80, "101": 0.82, "137": 0.84,
    }
    assert row["bbb_result"]["ensemble_probability"] == 0.8
    assert row["bbb_result"]["ensemble_standard_deviation"] == 0.028284
    assert row["bbb_result"]["threshold"] == 0.5
    assert row["bbb_result"]["threshold_status"] == "provisional_raw"
    assert row["bbb_result"]["raw_classification"] == "BBB+"
    assert row["bbb_result"]["calibration_status"] == "not_frozen"
    assert len(row["admet_predictions"]) == 9
    assert len(row["admet_regression"]["endpoints"]) == 5


def test_legacy_bbb_negative_rule_is_preserved_and_disclosed():
    row = prioritize_smiles(
        [{"molecule_id": "mol", "smiles": "CCO"}],
        admet_registry=CompleteRegistry(bbb_probability=0.2),
    )[0]

    assert row["prioritization"]["components"]["gmc_bbb"]["contribution"] == -0.01
    assert any("asymmetric rule" in warning for warning in row["prioritization"]["warnings"])


def test_missing_admet_and_docking_preserve_base_evidence_but_are_not_ranked():
    row = prioritize_smiles(
        [{"molecule_id": "mol", "smiles": "CCO"}],
        bbb_predictor=UnavailableBBBPredictor("GMC unavailable"),
    )[0]
    components = row["prioritization"]["components"]

    assert row["prioritization_status"] == "awaiting_docking"
    assert components["gmc_bbb"]["raw_value"] is None
    assert components["gmc_bbb"]["normalized_value"] is None
    assert components["gmc_bbb"]["contribution"] is None
    assert components["vina_docking"]["status"] == "docking_unavailable"
    assert components["vina_docking"]["contribution"] is None
    assert row["priority_score"] is not None
    assert row["combined_candidate_score"] is None
    assert row["scientific_ranking_score"] is None
    assert row["scientific_rank"] is None
    assert row["rank_eligible"] is False
    assert row["prioritization"]["ranking_basis"] == "requires_successful_vina_docking"


def test_invalid_molecule_is_retained_but_not_scientifically_ranked():
    rows = prioritize_smiles(
        [
            {"molecule_id": "valid", "smiles": "CCO"},
            {"molecule_id": "invalid", "smiles": "C1CC"},
        ],
        admet_registry=CompleteRegistry(),
    )
    invalid = next(row for row in rows if row["molecule_id"] == "invalid")

    assert len(rows) == 2
    assert invalid["priority_score"] == 0.0  # retained compatibility alias
    assert invalid["prioritization"]["priority_score"] is None
    assert invalid["scientific_ranking_score"] is None
    assert invalid["scientific_rank"] is None
    assert invalid["prioritization_status"] == "unscorable_invalid_molecule"


def test_deterministic_ties_use_molecule_id_and_docking_informs_rank():
    tied = prioritize_smiles(
        [
            {"molecule_id": "zeta", "smiles": "CCO", "docking_score": "-7"},
            {"molecule_id": "alpha", "smiles": "CCO", "docking_score": "-7"},
        ],
        admet_registry=CompleteRegistry(),
    )
    assert [row["molecule_id"] for row in tied] == ["alpha", "zeta"]
    assert [row["scientific_rank"] for row in tied] == [1, 2]

    docked = prioritize_smiles(
        [
            {"molecule_id": "weak", "smiles": "CCO", "docking_score": "-5"},
            {"molecule_id": "strong", "smiles": "CCO", "docking_score": "-10"},
        ],
        admet_registry=CompleteRegistry(),
    )
    assert [row["molecule_id"] for row in docked] == ["strong", "weak"]
    assert docked[0]["scientific_ranking_score"] == docked[0]["combined_candidate_score"]
    docking_component = docked[0]["prioritization"]["components"]["vina_docking"]
    assert docking_component["contribution"] == 0.3
    assert "not binding free energy" in docking_component["reason"]
    combined_contributions = [
        component["contribution"]
        for component in docked[0]["prioritization"]["components"].values()
        if component["score_scope"] == "combined_candidate_score"
        and component["contribution"] is not None
    ]
    assert round(sum(combined_contributions), 3) == docked[0]["combined_candidate_score"]


def test_legacy_chemberta_bbb_and_patent_fields_do_not_affect_priority_score():
    low_legacy = prioritize_smiles(
        [{"molecule_id": "mol", "smiles": "CCO", "docking_score": "-7"}],
        admet_registry=CompleteRegistry(bbb_martins=0.01),
    )[0]
    high_legacy = prioritize_smiles(
        [{"molecule_id": "mol", "smiles": "CCO", "docking_score": "-7"}],
        admet_registry=CompleteRegistry(bbb_martins=0.99),
        enable_patent_lookup=True,
        patent_lookup_client=PatentClient(),
    )[0]

    assert low_legacy["priority_score"] == high_legacy["priority_score"]
    assert low_legacy["scientific_ranking_score"] == high_legacy["scientific_ranking_score"]
    assert low_legacy["scientific_rank"] == high_legacy["scientific_rank"] == 1
    assert high_legacy["patent_record_count"] == 999
    assert "bbb_martins" not in high_legacy["prioritization"]["components"]


def test_backend_schema_accepts_new_contract_and_legacy_aliases():
    row = prioritize_smiles(
        [{"molecule_id": "mol", "smiles": "CCO"}], admet_registry=CompleteRegistry(),
    )[0]
    validated = MoleculeAnalysisResult.model_validate(row)

    assert validated.prioritization.ranking_version == PRIORITIZATION_RANKING_VERSION
    assert validated.prioritization.components["qed"].contribution is not None


def test_prioritization_progress_reports_honest_batch_counts():
    progress = []
    rows = prioritize_smiles(
        [
            {"molecule_id": "valid", "smiles": "CCO"},
            {"molecule_id": "invalid", "smiles": "C1CC"},
        ],
        admet_registry=CompleteRegistry(),
        progress_callback=lambda **values: progress.append(values),
    )
    update = next(item for item in reversed(progress) if item.get("stage") == "prioritization")

    assert len(rows) == 2
    assert update["eligible_count"] == 1
    assert update["fully_scored_count"] == 0
    assert update["partially_scored_count"] == 0
    assert update["unscorable_count"] == 0
    assert update["invalid_count"] == 1
    assert update["ranked_count"] == 0
    assert update["eligible_for_ranking_count"] == 0
    assert update["awaiting_or_missing_docking_count"] == 1


@pytest.mark.parametrize(
    ("docking_status", "expected_status"),
    [
        ("docking_failed", "docking_failed"),
        ("runtime_unavailable", "docking_unavailable"),
    ],
)
def test_failed_or_unavailable_docking_never_receives_final_rank(docking_status, expected_status):
    engine = MixedDockingEngine({
        "mol": {"status": docking_status, "warning": "synthetic docking failure"},
    })
    row = prioritize_smiles(
        [{"molecule_id": "mol", "smiles": "CCO"}],
        admet_registry=CompleteRegistry(),
        enable_docking=True,
        receptor=object(),
        docking_config=object(),
        docking_engine=engine,
    )[0]

    assert row["priority_score"] is not None
    assert row["docking_score"] is None
    assert row["docking_score_normalized"] is None
    assert row["combined_candidate_score"] is None
    assert row["prioritization_status"] == expected_status
    assert row["rank_eligible"] is False
    assert row["scientific_ranking_score"] is None
    assert row["scientific_rank"] is None


def test_failed_docking_does_not_affect_normalization_or_successful_ranking():
    engine = MixedDockingEngine({
        "weak": {"status": "success", "affinity": -5.0},
        "failed": {"status": "docking_failed", "affinity": -100.0},
        "strong": {"status": "success", "affinity": -10.0},
    })
    rows = prioritize_smiles(
        [
            {"molecule_id": "weak", "smiles": "CCO"},
            {"molecule_id": "failed", "smiles": "CCC"},
            {"molecule_id": "strong", "smiles": "CCN"},
        ],
        admet_registry=CompleteRegistry(),
        enable_docking=True,
        receptor=object(),
        docking_config=object(),
        docking_engine=engine,
    )
    by_id = {row["molecule_id"]: row for row in rows}

    assert by_id["strong"]["docking_score_normalized"] == 1.0
    assert by_id["weak"]["docking_score_normalized"] == 0.0
    assert by_id["strong"]["scientific_rank"] == 1
    assert by_id["weak"]["scientific_rank"] == 2
    assert by_id["failed"]["docking_score_normalized"] is None
    assert by_id["failed"]["scientific_rank"] is None
