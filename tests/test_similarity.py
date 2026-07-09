from biopharma_intelligence.similarity import find_closest_known_compound


def test_find_closest_known_compound_returns_exact_reference_similarity():
    result = find_closest_known_compound("CCO", valid_molecule=True)

    assert result.closest_known_compound_name == "Ethanol"
    assert result.closest_known_compound_id == "LOCAL_REF_0004"
    assert result.closest_known_compound_similarity == 1.0
    assert result.closest_known_compound_source == "local_reference"
    assert result.similarity_check_status == "closest_match_found"


def test_find_closest_known_compound_returns_best_available_reference_for_valid_molecule():
    result = find_closest_known_compound("CCCC", valid_molecule=True)

    assert result.closest_known_compound_name is not None
    assert result.closest_known_compound_id is not None
    assert result.closest_known_compound_similarity is not None
    assert 0.0 <= result.closest_known_compound_similarity <= 1.0
    assert result.similarity_check_status == "closest_match_found"


def test_find_closest_known_compound_skips_invalid_molecule():
    result = find_closest_known_compound(None, valid_molecule=False)

    assert result.closest_known_compound_name is None
    assert result.closest_known_compound_similarity is None
    assert result.similarity_check_status == "not_run_invalid_molecule"
