from biopharma_intelligence.identity import (
    check_known_compound_identity,
    reference_compounds_by_identity,
)


def test_reference_compounds_include_required_known_compounds():
    names = {reference.name for reference in reference_compounds_by_identity().values()}

    assert {
        "Aspirin",
        "Caffeine",
        "Benzene",
        "Ethanol",
        "Ibuprofen",
        "Donepezil",
        "Memantine",
        "Galantamine",
    }.issubset(names)


def test_check_known_compound_identity_finds_exact_aspirin_match():
    result = check_known_compound_identity("CC(=O)Oc1ccccc1C(=O)O", valid_molecule=True)

    assert result.known_compound_match is True
    assert result.known_compound_name == "Aspirin"
    assert result.known_compound_source == "local_reference"
    assert result.known_compound_id == "LOCAL_REF_0001"
    assert result.identity_check_status == "exact_match"


def test_check_known_compound_identity_marks_no_exact_match():
    result = check_known_compound_identity("CCCC", valid_molecule=True)

    assert result.known_compound_match is False
    assert result.known_compound_name is None
    assert result.identity_check_status == "no_exact_match"


def test_check_known_compound_identity_skips_invalid_molecule():
    result = check_known_compound_identity(None, valid_molecule=False)

    assert result.known_compound_match is False
    assert result.known_compound_name is None
    assert result.identity_check_status == "not_run_invalid_molecule"
