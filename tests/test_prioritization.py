import pytest

from molecular_prioritization import pipeline as pipeline_module
from molecular_prioritization.admet_multitask_predictor import (
    ADMETBundleError,
    FROZEN_ENDPOINT_DEFINITIONS,
    unavailable_admet_prediction,
)
from molecular_prioritization.bbb_predictor import BBBPrediction, UnavailableBBBPredictor
from molecular_prioritization.descriptors import calculate_descriptors
from molecular_prioritization.pipeline import prioritize_csv, prioritize_smiles
from molecular_prioritization.prioritization import calculate_priority_score
from biopharma_intelligence.public_lookup import (
    ChEMBLBioactivityResult,
    PatentContextResult,
    PublicIdentityResult,
)


class FakeBBBPredictor:
    def predict(self, smiles, valid_molecule):
        if not valid_molecule:
            return BBBPrediction(
                bbb_prediction="unavailable",
                bbb_probability=None,
                bbb_model_status="not_run_invalid_molecule",
                bbb_warning="BBB prediction skipped for invalid molecule.",
            )
        return BBBPrediction(
            bbb_prediction="high",
            bbb_probability=0.8,
            bbb_model_status="model_available",
            bbb_warning="",
        )


class FakeADMETPredictor:
    def __init__(self):
        self.calls = []

    def predict(self, smiles):
        self.calls.append(smiles)
        result = unavailable_admet_prediction(
            smiles,
            prediction_status="available",
            warning="",
        )
        for index, endpoint in enumerate(result["endpoints"].values()):
            endpoint.update(
                {
                    "raw_logit": float(index),
                    "raw_probability": 0.25,
                    "calibrated_probability": 0.75,
                    "binary_prediction": 1,
                }
            )
        return result


@pytest.fixture(autouse=True)
def use_synthetic_admet_predictor(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        pipeline_module,
        "load_admet_multitask_predictor",
        lambda: FakeADMETPredictor(),
    )


class FakePublicLookupClient:
    def __init__(self):
        self.calls = []

    def lookup_exact_identity(self, smiles, valid_molecule):
        self.calls.append((smiles, valid_molecule))
        if not valid_molecule:
            return PublicIdentityResult(
                pubchem_exact_match=False,
                pubchem_cid=None,
                pubchem_preferred_name=None,
                pubchem_lookup_status="not_run_invalid_molecule",
                pubchem_cache_status="not_used",
                pubchem_warning="Public lookup skipped for invalid molecule.",
            )
        return PublicIdentityResult(
            pubchem_exact_match=True,
            pubchem_cid="702",
            pubchem_preferred_name="Ethanol",
            pubchem_lookup_status="exact_match",
            pubchem_cache_status="fresh_lookup",
            pubchem_warning="",
        )


class FakeChEMBLLookupClient:
    def __init__(self):
        self.calls = []

    def lookup_bioactivity_context(self, smiles, valid_molecule):
        self.calls.append((smiles, valid_molecule))
        if not valid_molecule:
            return ChEMBLBioactivityResult(
                chembl_exact_match=False,
                chembl_molecule_id=None,
                chembl_pref_name=None,
                chembl_lookup_status="not_run_invalid_molecule",
                chembl_cache_status="not_used",
                chembl_warning="ChEMBL lookup skipped for invalid molecule.",
                chembl_activity_count=None,
                chembl_target_count=None,
                chembl_target_summary=None,
                chembl_similarity_match=False,
                chembl_similarity_score=None,
                chembl_similarity_molecule_id=None,
                chembl_similarity_pref_name=None,
                chembl_similarity_status="not_run_invalid_molecule",
            )
        return ChEMBLBioactivityResult(
            chembl_exact_match=True,
            chembl_molecule_id="CHEMBL545",
            chembl_pref_name="ETHANOL",
            chembl_lookup_status="exact_match",
            chembl_cache_status="fresh_lookup",
            chembl_warning="",
            chembl_activity_count=12,
            chembl_target_count=3,
            chembl_target_summary="Target A; Target B; Target C",
            chembl_similarity_match=False,
            chembl_similarity_score=None,
            chembl_similarity_molecule_id=None,
            chembl_similarity_pref_name=None,
            chembl_similarity_status="not_run_exact_match_found",
        )


class FakePatentLookupClient:
    def __init__(self):
        self.calls = []

    def lookup_patent_context(
        self,
        smiles,
        valid_molecule,
        *,
        pubchem_cid=None,
        chembl_molecule_id=None,
    ):
        self.calls.append((smiles, valid_molecule, pubchem_cid, chembl_molecule_id))
        if not valid_molecule:
            return PatentContextResult(
                patent_lookup_status="not_run_invalid_molecule",
                patent_cache_status="not_used",
                patent_public_evidence_match=False,
                patent_source="SureChEMBL",
                patent_record_count=None,
                patent_top_record_id=None,
                patent_top_record_title=None,
                patent_top_record_url=None,
                patent_query_identifier=None,
                patent_warning="Patent-context lookup skipped for invalid molecule.",
            )
        return PatentContextResult(
            patent_lookup_status="match_found",
            patent_cache_status="fresh_lookup",
            patent_public_evidence_match=True,
            patent_source="SureChEMBL",
            patent_record_count=7,
            patent_top_record_id="WO-000000001-A1",
            patent_top_record_title="Example public patent-associated record",
            patent_top_record_url="https://www.surechembl.org/document/WO-000000001-A1",
            patent_query_identifier="surechembl_chemical_id:1",
            patent_warning="",
        )


def test_calculate_priority_score_is_zero_for_invalid_molecule():
    descriptors = calculate_descriptors("CCO")

    assert calculate_priority_score(descriptors, is_valid=False) == 0.0


def test_calculate_priority_score_is_bounded_for_valid_molecule():
    descriptors = calculate_descriptors("CCO")

    assert 0 <= calculate_priority_score(descriptors, is_valid=True) <= 1


def test_prioritize_smiles_keeps_invalid_records_in_ranked_output():
    records = [
        {"molecule_id": "ethanol", "smiles": "CCO"},
        {"molecule_id": "aspirin", "smiles": "CC(=O)Oc1ccccc1C(=O)O"},
        {"molecule_id": "invalid", "smiles": "C1CC"},
    ]

    ranked = prioritize_smiles(records, bbb_predictor=UnavailableBBBPredictor("missing"))
    invalid = next(row for row in ranked if row["molecule_id"] == "invalid")

    assert len(ranked) == 3
    assert invalid["valid_molecule"] is False
    assert invalid["priority_score"] == 0.0
    assert invalid["canonical_smiles"] is None
    assert invalid["bbb_prediction"] == "unavailable"
    assert invalid["sa_score"] is None
    assert invalid["synthetic_feasibility_category"] == "not_available"
    assert invalid["synthetic_feasibility_status"] == "not_run_invalid_molecule"
    assert invalid["known_compound_match"] is False
    assert invalid["known_compound_name"] is None
    assert invalid["identity_check_status"] == "not_run_invalid_molecule"
    assert invalid["closest_known_compound_name"] is None
    assert invalid["closest_known_compound_similarity"] is None
    assert invalid["similarity_check_status"] == "not_run_invalid_molecule"
    assert invalid["pubchem_lookup_status"] == "not_requested"
    assert invalid["chembl_lookup_status"] == "not_requested"
    assert invalid["patent_lookup_status"] == "not_requested"
    assert invalid["structural_alert_status"] == "not_run_invalid_molecule"
    assert invalid["pains_alert"] is False
    assert invalid["brenk_alert"] is False
    assert invalid["evidence_summary_category"] == "invalid_molecule"
    assert invalid["biopharma_context_level"] == "invalid_molecule"
    assert ranked[0]["priority_score"] >= ranked[-1]["priority_score"]


def test_prioritize_smiles_adds_bbb_prediction_columns_when_model_available():
    ranked = prioritize_smiles(
        [{"molecule_id": "ethanol", "smiles": "CCO"}],
        bbb_predictor=FakeBBBPredictor(),
    )

    assert ranked[0]["bbb_prediction"] == "high"
    assert ranked[0]["bbb_probability"] == 0.8
    assert ranked[0]["bbb_model_status"] == "model_available"


def test_prioritize_smiles_adds_bbb_placeholder_when_model_unavailable():
    ranked = prioritize_smiles(
        [{"molecule_id": "ethanol", "smiles": "CCO"}],
        bbb_predictor=UnavailableBBBPredictor("model cache missing"),
    )

    assert ranked[0]["bbb_prediction"] == "unavailable"
    assert ranked[0]["bbb_probability"] is None
    assert ranked[0]["bbb_model_status"] == "model_unavailable"
    assert ranked[0]["bbb_warning"] == "model cache missing"


def test_prioritize_smiles_exposes_all_frozen_admet_endpoints():
    admet_predictor = FakeADMETPredictor()

    ranked = prioritize_smiles(
        [{"molecule_id": "ethanol", "smiles": "CCO"}],
        bbb_predictor=UnavailableBBBPredictor("model cache missing"),
        admet_predictor=admet_predictor,
    )

    row = ranked[0]
    assert admet_predictor.calls == ["CCO"]
    assert row["admet_model_status"] == "model_available"
    assert tuple(row["admet_predictions"]) == tuple(FROZEN_ENDPOINT_DEFINITIONS)
    for endpoint in row["admet_predictions"].values():
        assert endpoint["calibrated_probability"] == 0.75
        assert endpoint["raw_probability"] == 0.25
        assert endpoint["binary_prediction"] == 1
        assert "evidence_status" in endpoint
        assert "warning" in endpoint


def test_prioritize_smiles_does_not_call_admet_model_for_invalid_molecule():
    admet_predictor = FakeADMETPredictor()

    ranked = prioritize_smiles(
        [{"molecule_id": "invalid", "smiles": "C1CC"}],
        bbb_predictor=UnavailableBBBPredictor("model cache missing"),
        admet_predictor=admet_predictor,
    )

    assert admet_predictor.calls == []
    assert ranked[0]["admet_model_status"] == "not_run_invalid_molecule"
    assert len(ranked[0]["admet_predictions"]) == 10
    assert all(
        endpoint["calibrated_probability"] is None
        for endpoint in ranked[0]["admet_predictions"].values()
    )


def test_prioritize_smiles_degrades_when_admet_bundle_is_unavailable(monkeypatch):
    def unavailable_loader():
        raise ADMETBundleError("synthetic bundle failure")

    monkeypatch.setattr(
        pipeline_module,
        "load_admet_multitask_predictor",
        unavailable_loader,
    )

    ranked = prioritize_smiles(
        [{"molecule_id": "ethanol", "smiles": "CCO"}],
        bbb_predictor=UnavailableBBBPredictor("model cache missing"),
    )

    assert ranked[0]["admet_model_status"] == "model_unavailable"
    assert "synthetic bundle failure" in ranked[0]["admet_warning"]
    assert len(ranked[0]["admet_predictions"]) == 10
    assert all(
        endpoint["binary_prediction"] is None
        for endpoint in ranked[0]["admet_predictions"].values()
    )


def test_prioritize_smiles_adds_synthetic_accessibility_columns_for_valid_molecule():
    ranked = prioritize_smiles(
        [{"molecule_id": "ethanol", "smiles": "CCO"}],
        bbb_predictor=UnavailableBBBPredictor("model cache missing"),
    )

    assert ranked[0]["sa_score"] is not None
    assert ranked[0]["synthetic_feasibility_category"] in {"easy", "moderate", "difficult"}
    assert ranked[0]["synthetic_feasibility_status"] == "heuristic_synthetic_accessibility"


def test_prioritize_smiles_adds_diversity_columns():
    ranked = prioritize_smiles(
        [
            {"molecule_id": "ethanol", "smiles": "CCO"},
            {"molecule_id": "ethanol_duplicate", "smiles": "CCO"},
            {"molecule_id": "invalid", "smiles": "C1CC"},
        ],
        bbb_predictor=UnavailableBBBPredictor("model cache missing"),
    )

    ethanol = next(row for row in ranked if row["molecule_id"] == "ethanol")
    duplicate = next(row for row in ranked if row["molecule_id"] == "ethanol_duplicate")
    invalid = next(row for row in ranked if row["molecule_id"] == "invalid")

    assert ethanol["diversity_cluster_id"] == duplicate["diversity_cluster_id"]
    assert ethanol["diversity_cluster_size"] == 2
    assert duplicate["nearest_neighbor_similarity"] == 1.0
    assert invalid["diversity_status"] == "not_run_invalid_molecule"
    assert ethanol["chemical_space_status"] == "projected"
    assert ethanol["chemical_space_method"] == "morgan_fingerprint_pca"
    assert ethanol["chemical_space_x"] is not None
    assert ethanol["chemical_space_y"] is not None
    assert invalid["chemical_space_status"] == "not_run_invalid_molecule"


def test_prioritize_smiles_adds_structural_alert_columns():
    ranked = prioritize_smiles(
        [{"molecule_id": "ethanol", "smiles": "CCO"}],
        bbb_predictor=UnavailableBBBPredictor("model cache missing"),
    )
    row = ranked[0]

    assert row["structural_alert_status"] in {
        "no_alerts",
        "alerts_detected",
        "alert_catalog_unavailable",
    }
    assert "structural_alert_count" in row
    assert "structural_alert_categories" in row
    assert "structural_alert_names" in row
    assert row["pains_alert"] in {True, False}
    assert row["brenk_alert"] in {True, False}
    assert row["medchem_alert_summary"]


def test_prioritize_smiles_adds_exact_known_compound_identity_match():
    ranked = prioritize_smiles(
        [{"molecule_id": "aspirin", "smiles": "CC(=O)Oc1ccccc1C(=O)O"}],
        bbb_predictor=UnavailableBBBPredictor("model cache missing"),
    )

    assert ranked[0]["known_compound_match"] is True
    assert ranked[0]["known_compound_name"] == "Aspirin"
    assert ranked[0]["known_compound_source"] == "local_reference"
    assert ranked[0]["known_compound_id"] == "LOCAL_REF_0001"
    assert ranked[0]["identity_check_status"] == "exact_match"
    assert ranked[0]["evidence_summary_category"] == "identity_context"
    assert ranked[0]["public_identity_signal"] == "local_identity_signal_present"


def test_prioritize_smiles_marks_no_known_compound_identity_match():
    ranked = prioritize_smiles(
        [{"molecule_id": "butane", "smiles": "CCCC"}],
        bbb_predictor=UnavailableBBBPredictor("model cache missing"),
    )

    assert ranked[0]["known_compound_match"] is False
    assert ranked[0]["known_compound_name"] is None
    assert ranked[0]["identity_check_status"] == "no_exact_match"


def test_prioritize_smiles_default_public_lookup_is_not_requested():
    client = FakePublicLookupClient()
    chembl_client = FakeChEMBLLookupClient()
    patent_client = FakePatentLookupClient()

    ranked = prioritize_smiles(
        [{"molecule_id": "ethanol", "smiles": "CCO"}],
        bbb_predictor=UnavailableBBBPredictor("model cache missing"),
        public_lookup_client=client,
        chembl_lookup_client=chembl_client,
        patent_lookup_client=patent_client,
    )

    assert ranked[0]["pubchem_exact_match"] is False
    assert ranked[0]["pubchem_lookup_status"] == "not_requested"
    assert ranked[0]["pubchem_cache_status"] == "not_used"
    assert ranked[0]["chembl_exact_match"] is False
    assert ranked[0]["chembl_lookup_status"] == "not_requested"
    assert ranked[0]["chembl_cache_status"] == "not_used"
    assert ranked[0]["patent_public_evidence_match"] is False
    assert ranked[0]["patent_lookup_status"] == "not_requested"
    assert ranked[0]["patent_cache_status"] == "not_used"
    assert client.calls == []
    assert chembl_client.calls == []
    assert patent_client.calls == []
    assert ranked[0]["public_identity_signal"] == "local_identity_signal_present"
    assert "ChEMBL public bioactivity lookup was not requested" in ranked[0]["evidence_summary_notes"]
    assert "SureChEMBL patent-context lookup was not requested" in ranked[0]["evidence_summary_notes"]


def test_prioritize_smiles_runs_public_lookup_when_requested():
    client = FakePublicLookupClient()

    ranked = prioritize_smiles(
        [{"molecule_id": "ethanol", "smiles": "CCO"}],
        bbb_predictor=UnavailableBBBPredictor("model cache missing"),
        enable_public_lookup=True,
        public_lookup_client=client,
    )

    assert ranked[0]["pubchem_exact_match"] is True
    assert ranked[0]["pubchem_cid"] == "702"
    assert ranked[0]["pubchem_preferred_name"] == "Ethanol"
    assert ranked[0]["pubchem_lookup_status"] == "exact_match"
    assert ranked[0]["pubchem_cache_status"] == "fresh_lookup"
    assert client.calls == [("CCO", True)]
    assert ranked[0]["public_identity_signal"] == "public_identity_signal_present"


def test_prioritize_smiles_runs_chembl_lookup_when_requested():
    client = FakeChEMBLLookupClient()

    ranked = prioritize_smiles(
        [{"molecule_id": "ethanol", "smiles": "CCO"}],
        bbb_predictor=UnavailableBBBPredictor("model cache missing"),
        enable_chembl_lookup=True,
        chembl_lookup_client=client,
    )

    assert ranked[0]["pubchem_lookup_status"] == "not_requested"
    assert ranked[0]["chembl_exact_match"] is True
    assert ranked[0]["chembl_molecule_id"] == "CHEMBL545"
    assert ranked[0]["chembl_pref_name"] == "ETHANOL"
    assert ranked[0]["chembl_lookup_status"] == "exact_match"
    assert ranked[0]["chembl_cache_status"] == "fresh_lookup"
    assert ranked[0]["chembl_activity_count"] == 12
    assert ranked[0]["chembl_target_count"] == 3
    assert client.calls == [("CCO", True)]
    assert ranked[0]["public_bioactivity_signal"] == "public_bioactivity_signal_present"


def test_prioritize_smiles_pubchem_and_chembl_can_run_together():
    pubchem_client = FakePublicLookupClient()
    chembl_client = FakeChEMBLLookupClient()

    ranked = prioritize_smiles(
        [{"molecule_id": "ethanol", "smiles": "CCO"}],
        bbb_predictor=UnavailableBBBPredictor("model cache missing"),
        enable_pubchem_lookup=True,
        enable_chembl_lookup=True,
        public_lookup_client=pubchem_client,
        chembl_lookup_client=chembl_client,
    )

    assert ranked[0]["pubchem_lookup_status"] == "exact_match"
    assert ranked[0]["chembl_lookup_status"] == "exact_match"
    assert pubchem_client.calls == [("CCO", True)]
    assert chembl_client.calls == [("CCO", True)]


def test_prioritize_smiles_runs_patent_lookup_when_requested():
    client = FakePatentLookupClient()

    ranked = prioritize_smiles(
        [{"molecule_id": "ethanol", "smiles": "CCO"}],
        bbb_predictor=UnavailableBBBPredictor("model cache missing"),
        enable_patent_lookup=True,
        patent_lookup_client=client,
    )

    assert ranked[0]["pubchem_lookup_status"] == "not_requested"
    assert ranked[0]["chembl_lookup_status"] == "not_requested"
    assert ranked[0]["patent_public_evidence_match"] is True
    assert ranked[0]["patent_lookup_status"] == "match_found"
    assert ranked[0]["patent_cache_status"] == "fresh_lookup"
    assert ranked[0]["patent_record_count"] == 7
    assert client.calls == [("CCO", True, None, None)]
    assert ranked[0]["patent_context_signal"] == "patent_context_signal_present"


def test_prioritize_smiles_all_public_sources_can_run_together():
    pubchem_client = FakePublicLookupClient()
    chembl_client = FakeChEMBLLookupClient()
    patent_client = FakePatentLookupClient()

    ranked = prioritize_smiles(
        [{"molecule_id": "ethanol", "smiles": "CCO"}],
        bbb_predictor=UnavailableBBBPredictor("model cache missing"),
        enable_pubchem_lookup=True,
        enable_chembl_lookup=True,
        enable_patent_lookup=True,
        public_lookup_client=pubchem_client,
        chembl_lookup_client=chembl_client,
        patent_lookup_client=patent_client,
    )

    assert ranked[0]["pubchem_lookup_status"] == "exact_match"
    assert ranked[0]["chembl_lookup_status"] == "exact_match"
    assert ranked[0]["patent_lookup_status"] == "match_found"
    assert patent_client.calls == [("CCO", True, "702", "CHEMBL545")]
    assert ranked[0]["evidence_summary_category"] == "combined_public_context"
    assert ranked[0]["biopharma_context_level"] == "high_evidence_context"


def test_prioritize_smiles_public_lookup_skips_invalid_molecule_when_requested():
    client = FakePublicLookupClient()

    ranked = prioritize_smiles(
        [{"molecule_id": "invalid", "smiles": "C1CC"}],
        bbb_predictor=UnavailableBBBPredictor("model cache missing"),
        enable_public_lookup=True,
        public_lookup_client=client,
    )

    assert ranked[0]["pubchem_exact_match"] is False
    assert ranked[0]["pubchem_lookup_status"] == "not_run_invalid_molecule"
    assert client.calls == [(None, False)]


def test_prioritize_smiles_chembl_lookup_skips_invalid_molecule_when_requested():
    client = FakeChEMBLLookupClient()

    ranked = prioritize_smiles(
        [{"molecule_id": "invalid", "smiles": "C1CC"}],
        bbb_predictor=UnavailableBBBPredictor("model cache missing"),
        enable_chembl_lookup=True,
        chembl_lookup_client=client,
    )

    assert ranked[0]["chembl_exact_match"] is False
    assert ranked[0]["chembl_lookup_status"] == "not_run_invalid_molecule"
    assert client.calls == [(None, False)]


def test_prioritize_smiles_patent_lookup_skips_invalid_molecule_when_requested():
    client = FakePatentLookupClient()

    ranked = prioritize_smiles(
        [{"molecule_id": "invalid", "smiles": "C1CC"}],
        bbb_predictor=UnavailableBBBPredictor("model cache missing"),
        enable_patent_lookup=True,
        patent_lookup_client=client,
    )

    assert ranked[0]["patent_public_evidence_match"] is False
    assert ranked[0]["patent_lookup_status"] == "not_run_invalid_molecule"
    assert client.calls == [(None, False, None, None)]


def test_prioritize_smiles_adds_closest_known_compound_similarity():
    ranked = prioritize_smiles(
        [{"molecule_id": "ethanol", "smiles": "CCO"}],
        bbb_predictor=UnavailableBBBPredictor("model cache missing"),
    )

    assert ranked[0]["closest_known_compound_name"] == "Ethanol"
    assert ranked[0]["closest_known_compound_id"] == "LOCAL_REF_0004"
    assert ranked[0]["closest_known_compound_similarity"] == 1.0
    assert ranked[0]["closest_known_compound_source"] == "local_reference"
    assert ranked[0]["similarity_check_status"] == "closest_match_found"
    assert ranked[0]["local_similarity_signal"] == "local_exact_identity_signal_present"


def test_prioritize_smiles_preserves_valid_precomputed_docking_score():
    ranked = prioritize_smiles(
        [{"molecule_id": "ethanol", "smiles": "CCO", "docking_score": "-7.25"}],
        bbb_predictor=UnavailableBBBPredictor("model cache missing"),
    )

    assert ranked[0]["docking_score"] == -7.25
    assert ranked[0]["docking_status"] == "provided"
    assert ranked[0]["docking_score_normalized"] == 1.0
    assert ranked[0]["docking_priority_signal"] == "strong_docking_signal"
    assert ranked[0]["docking_rank_within_run"] == 1
    assert ranked[0]["docking_percentile_within_run"] == 100.0
    assert ranked[0]["combined_score_status"] == "calculated"
    assert ranked[0]["combined_candidate_score"] != ranked[0]["priority_score"]
    assert "70% priority_score" in ranked[0]["combined_score_explanation"]


def test_prioritize_smiles_marks_missing_docking_score_as_not_provided():
    ranked = prioritize_smiles(
        [{"molecule_id": "ethanol", "smiles": "CCO"}],
        bbb_predictor=UnavailableBBBPredictor("model cache missing"),
    )

    assert ranked[0]["docking_score"] is None
    assert ranked[0]["docking_status"] == "not_provided"
    assert ranked[0]["docking_score_normalized"] is None
    assert ranked[0]["combined_candidate_score"] is None
    assert ranked[0]["combined_score_status"] == "docking_not_provided"


def test_prioritize_smiles_marks_invalid_docking_score():
    ranked = prioritize_smiles(
        [{"molecule_id": "ethanol", "smiles": "CCO", "docking_score": "not-a-number"}],
        bbb_predictor=UnavailableBBBPredictor("model cache missing"),
    )

    assert ranked[0]["docking_score"] is None
    assert ranked[0]["docking_status"] == "invalid_docking_score"
    assert ranked[0]["combined_candidate_score"] is None
    assert ranked[0]["combined_score_status"] == "invalid_docking_score"


def test_prioritize_smiles_adds_docking_informed_scores_without_changing_priority_score():
    baseline = prioritize_smiles(
        [
            {"molecule_id": "ethanol", "smiles": "CCO"},
            {"molecule_id": "aspirin", "smiles": "CC(=O)Oc1ccccc1C(=O)O"},
        ],
        bbb_predictor=UnavailableBBBPredictor("model cache missing"),
    )
    ranked = prioritize_smiles(
        [
            {"molecule_id": "ethanol", "smiles": "CCO", "docking_score": "-5.0"},
            {"molecule_id": "aspirin", "smiles": "CC(=O)Oc1ccccc1C(=O)O", "docking_score": "-10.0"},
        ],
        bbb_predictor=UnavailableBBBPredictor("model cache missing"),
    )
    baseline_scores = {row["molecule_id"]: row["priority_score"] for row in baseline}
    ranked_by_id = {row["molecule_id"]: row for row in ranked}

    assert ranked_by_id["ethanol"]["priority_score"] == baseline_scores["ethanol"]
    assert ranked_by_id["aspirin"]["priority_score"] == baseline_scores["aspirin"]
    assert ranked_by_id["aspirin"]["docking_score_normalized"] == 1.0
    assert ranked_by_id["ethanol"]["docking_score_normalized"] == 0.0
    assert ranked_by_id["aspirin"]["combined_candidate_score"] > ranked_by_id["ethanol"]["combined_candidate_score"]
    assert ranked[0]["priority_score"] >= ranked[-1]["priority_score"]


def test_prioritize_csv_empty_input_keeps_synthetic_accessibility_schema(tmp_path):
    input_path = tmp_path / "empty.csv"
    output_path = tmp_path / "ranked.csv"
    input_path.write_text("molecule_id,smiles\n", encoding="utf-8")

    ranked = prioritize_csv(input_path, output_path)
    header = output_path.read_text(encoding="utf-8").splitlines()[0].split(",")

    assert ranked == []
    assert "sa_score" in header
    assert "synthetic_feasibility_category" in header
    assert "synthetic_feasibility_status" in header
    assert "docking_score" in header
    assert "docking_status" in header
    assert "docking_score_normalized" in header
    assert "docking_priority_signal" in header
    assert "docking_rank_within_run" in header
    assert "docking_percentile_within_run" in header
    assert "combined_candidate_score" in header
    assert "combined_score_explanation" in header
    assert "combined_score_status" in header
    assert "known_compound_match" in header
    assert "known_compound_name" in header
    assert "known_compound_source" in header
    assert "known_compound_id" in header
    assert "identity_check_status" in header
    assert "closest_known_compound_name" in header
    assert "closest_known_compound_id" in header
    assert "closest_known_compound_similarity" in header
    assert "closest_known_compound_source" in header
    assert "similarity_check_status" in header
    assert "pubchem_exact_match" in header
    assert "pubchem_cid" in header
    assert "pubchem_preferred_name" in header
    assert "pubchem_lookup_status" in header
    assert "pubchem_cache_status" in header
    assert "pubchem_warning" in header
    assert "chembl_exact_match" in header
    assert "chembl_molecule_id" in header
    assert "chembl_pref_name" in header
    assert "chembl_lookup_status" in header
    assert "chembl_cache_status" in header
    assert "chembl_warning" in header
    assert "chembl_activity_count" in header
    assert "chembl_target_count" in header
    assert "chembl_target_summary" in header
    assert "chembl_similarity_match" in header
    assert "chembl_similarity_score" in header
    assert "chembl_similarity_molecule_id" in header
    assert "chembl_similarity_pref_name" in header
    assert "chembl_similarity_status" in header
    assert "patent_lookup_status" in header
    assert "patent_cache_status" in header
    assert "patent_public_evidence_match" in header
    assert "patent_source" in header
    assert "patent_record_count" in header
    assert "patent_top_record_id" in header
    assert "patent_top_record_title" in header
    assert "patent_top_record_url" in header
    assert "patent_query_identifier" in header
    assert "patent_warning" in header
    assert "structural_alert_status" in header
    assert "structural_alert_count" in header
    assert "structural_alert_categories" in header
    assert "structural_alert_names" in header
    assert "pains_alert" in header
    assert "brenk_alert" in header
    assert "medchem_alert_summary" in header
    assert "evidence_summary_category" in header
    assert "evidence_summary_notes" in header
    assert "public_identity_signal" in header
    assert "public_bioactivity_signal" in header
    assert "patent_context_signal" in header
    assert "local_similarity_signal" in header
    assert "biopharma_context_level" in header
    assert "recommended_review_focus" in header
    assert "diversity_cluster_id" in header
    assert "diversity_cluster_size" in header
    assert "diversity_representative" in header
    assert "nearest_neighbor_molecule_id" in header
    assert "nearest_neighbor_similarity" in header
    assert "diversity_status" in header
    assert "chemical_space_x" in header
    assert "chemical_space_y" in header
    assert "chemical_space_status" in header
    assert "chemical_space_method" in header
    assert "chemical_space_warning" in header


def test_prioritize_csv_writes_precomputed_docking_columns(tmp_path):
    input_path = tmp_path / "molecules.csv"
    output_path = tmp_path / "ranked.csv"
    input_path.write_text("molecule_id,smiles,docking_score\nethanol,CCO,-6.5\n", encoding="utf-8")

    ranked = prioritize_csv(input_path, output_path)
    output_text = output_path.read_text(encoding="utf-8")

    assert ranked[0]["docking_score"] == -6.5
    assert ranked[0]["docking_status"] == "provided"
    assert ranked[0]["combined_score_status"] == "calculated"
    assert "docking_score" in output_text
    assert "docking_status" in output_text
    assert "combined_candidate_score" in output_text
