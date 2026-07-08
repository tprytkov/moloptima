from molecular_prioritization.docking import parse_precomputed_docking_score


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
