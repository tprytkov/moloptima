from molecular_prioritization.synthetic_accessibility import heuristic_synthetic_accessibility


def test_heuristic_synthetic_accessibility_scores_valid_molecule():
    result = heuristic_synthetic_accessibility("CCO", valid_molecule=True)

    assert result.sa_score is not None
    assert 1.0 <= result.sa_score <= 10.0
    assert result.synthetic_feasibility_category in {"easy", "moderate", "difficult"}
    assert result.synthetic_feasibility_status == "heuristic_synthetic_accessibility"


def test_heuristic_synthetic_accessibility_is_reproducible():
    first = heuristic_synthetic_accessibility("CC(=O)Oc1ccccc1C(=O)O", valid_molecule=True)
    second = heuristic_synthetic_accessibility("CC(=O)Oc1ccccc1C(=O)O", valid_molecule=True)

    assert first == second


def test_heuristic_synthetic_accessibility_skips_invalid_molecule():
    result = heuristic_synthetic_accessibility(None, valid_molecule=False)

    assert result.sa_score is None
    assert result.synthetic_feasibility_category == "not_available"
    assert result.synthetic_feasibility_status == "not_run_invalid_molecule"
