from molecular_prioritization.bbb_predictor import BBBPrediction, UnavailableBBBPredictor
from molecular_prioritization.descriptors import calculate_descriptors
from molecular_prioritization.pipeline import prioritize_csv, prioritize_smiles
from molecular_prioritization.prioritization import calculate_priority_score


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


def test_prioritize_smiles_adds_synthetic_accessibility_columns_for_valid_molecule():
    ranked = prioritize_smiles(
        [{"molecule_id": "ethanol", "smiles": "CCO"}],
        bbb_predictor=UnavailableBBBPredictor("model cache missing"),
    )

    assert ranked[0]["sa_score"] is not None
    assert ranked[0]["synthetic_feasibility_category"] in {"easy", "moderate", "difficult"}
    assert ranked[0]["synthetic_feasibility_status"] == "heuristic_synthetic_accessibility"


def test_prioritize_smiles_preserves_valid_precomputed_docking_score():
    ranked = prioritize_smiles(
        [{"molecule_id": "ethanol", "smiles": "CCO", "docking_score": "-7.25"}],
        bbb_predictor=UnavailableBBBPredictor("model cache missing"),
    )

    assert ranked[0]["docking_score"] == -7.25
    assert ranked[0]["docking_status"] == "provided"


def test_prioritize_smiles_marks_missing_docking_score_as_not_provided():
    ranked = prioritize_smiles(
        [{"molecule_id": "ethanol", "smiles": "CCO"}],
        bbb_predictor=UnavailableBBBPredictor("model cache missing"),
    )

    assert ranked[0]["docking_score"] is None
    assert ranked[0]["docking_status"] == "not_provided"


def test_prioritize_smiles_marks_invalid_docking_score():
    ranked = prioritize_smiles(
        [{"molecule_id": "ethanol", "smiles": "CCO", "docking_score": "not-a-number"}],
        bbb_predictor=UnavailableBBBPredictor("model cache missing"),
    )

    assert ranked[0]["docking_score"] is None
    assert ranked[0]["docking_status"] == "invalid_docking_score"


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


def test_prioritize_csv_writes_precomputed_docking_columns(tmp_path):
    input_path = tmp_path / "molecules.csv"
    output_path = tmp_path / "ranked.csv"
    input_path.write_text("molecule_id,smiles,docking_score\nethanol,CCO,-6.5\n", encoding="utf-8")

    ranked = prioritize_csv(input_path, output_path)
    output_text = output_path.read_text(encoding="utf-8")

    assert ranked[0]["docking_score"] == -6.5
    assert ranked[0]["docking_status"] == "provided"
    assert "docking_score" in output_text
    assert "docking_status" in output_text
