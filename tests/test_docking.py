from molecular_prioritization.docking import (
    add_docking_informed_scores,
    parse_precomputed_docking_score,
)


def test_parse_precomputed_docking_score_returns_provided_for_valid_score():
    result = parse_precomputed_docking_score({"docking_score": "-8.4"})

    assert result.docking_score == -8.4
    assert result.docking_status == "provided"


def test_parse_precomputed_docking_score_returns_not_provided_when_column_missing():
    result = parse_precomputed_docking_score({})

    assert result.docking_score is None
    assert result.docking_status == "not_provided"


def test_parse_precomputed_docking_score_returns_invalid_for_unparseable_value():
    result = parse_precomputed_docking_score({"docking_score": "high affinity"})

    assert result.docking_score is None
    assert result.docking_status == "invalid_docking_score"


def test_add_docking_informed_scores_reports_not_provided_when_no_scores():
    rows = [
        {
            "molecule_id": "mol_1",
            "valid_molecule": True,
            "priority_score": 0.8,
            "docking_score": None,
            "docking_status": "not_provided",
        }
    ]

    scored = add_docking_informed_scores(rows)

    assert scored[0]["combined_score_status"] == "docking_not_provided"
    assert scored[0]["combined_candidate_score"] is None
    assert scored[0]["docking_priority_signal"] == "no_docking_signal"


def test_add_docking_informed_scores_normalizes_more_negative_scores_as_stronger():
    rows = [
        {
            "molecule_id": "strong",
            "valid_molecule": True,
            "priority_score": 0.7,
            "docking_score": -10.0,
            "docking_status": "provided",
        },
        {
            "molecule_id": "weak",
            "valid_molecule": True,
            "priority_score": 0.7,
            "docking_score": -5.0,
            "docking_status": "provided",
        },
    ]

    scored = add_docking_informed_scores(rows)
    strong = next(row for row in scored if row["molecule_id"] == "strong")
    weak = next(row for row in scored if row["molecule_id"] == "weak")

    assert strong["docking_score_normalized"] == 1.0
    assert weak["docking_score_normalized"] == 0.0
    assert strong["docking_rank_within_run"] == 1
    assert weak["docking_rank_within_run"] == 2
    assert strong["docking_percentile_within_run"] == 100.0
    assert weak["docking_percentile_within_run"] == 0.0
    assert strong["docking_priority_signal"] == "strong_docking_signal"
    assert weak["docking_priority_signal"] == "limited_docking_signal"
    assert strong["combined_candidate_score"] > weak["combined_candidate_score"]


def test_add_docking_informed_scores_handles_invalid_missing_and_invalid_molecule():
    rows = [
        {
            "molecule_id": "valid",
            "valid_molecule": True,
            "priority_score": 0.8,
            "docking_score": -8.0,
            "docking_status": "provided",
        },
        {
            "molecule_id": "missing",
            "valid_molecule": True,
            "priority_score": 0.6,
            "docking_score": None,
            "docking_status": "not_provided",
        },
        {
            "molecule_id": "invalid_score",
            "valid_molecule": True,
            "priority_score": 0.6,
            "docking_score": None,
            "docking_status": "invalid_docking_score",
        },
        {
            "molecule_id": "invalid_molecule",
            "valid_molecule": False,
            "priority_score": 0.0,
            "docking_score": -12.0,
            "docking_status": "provided",
        },
    ]

    scored = add_docking_informed_scores(rows)
    by_id = {row["molecule_id"]: row for row in scored}

    assert by_id["valid"]["combined_score_status"] == "calculated"
    assert by_id["missing"]["combined_score_status"] == "docking_missing_for_molecule"
    assert by_id["invalid_score"]["combined_score_status"] == "invalid_docking_score"
    assert by_id["invalid_molecule"]["combined_score_status"] == "not_run_invalid_molecule"
