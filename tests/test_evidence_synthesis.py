from biopharma_intelligence.evidence_synthesis import synthesize_evidence


def base_row(**overrides):
    row = {
        "valid_molecule": True,
        "known_compound_match": False,
        "known_compound_name": None,
        "identity_check_status": "no_exact_match",
        "closest_known_compound_name": None,
        "closest_known_compound_similarity": 0.2,
        "similarity_check_status": "closest_match_found",
        "pubchem_exact_match": False,
        "pubchem_cid": None,
        "pubchem_preferred_name": None,
        "pubchem_lookup_status": "not_requested",
        "chembl_exact_match": False,
        "chembl_lookup_status": "not_requested",
        "chembl_activity_count": None,
        "chembl_target_summary": None,
        "chembl_similarity_match": False,
        "patent_public_evidence_match": False,
        "patent_lookup_status": "not_requested",
        "patent_record_count": None,
    }
    row.update(overrides)
    return row


def test_invalid_molecule_synthesis():
    synthesis = synthesize_evidence(base_row(valid_molecule=False))

    assert synthesis["evidence_summary_category"] == "invalid_molecule"
    assert synthesis["public_identity_signal"] == "invalid_molecule"
    assert synthesis["biopharma_context_level"] == "invalid_molecule"


def test_local_exact_identity_synthesis():
    synthesis = synthesize_evidence(
        base_row(
            known_compound_match=True,
            known_compound_name="Aspirin",
            identity_check_status="exact_match",
        )
    )

    assert synthesis["evidence_summary_category"] == "identity_context"
    assert synthesis["public_identity_signal"] == "local_identity_signal_present"
    assert "local exact known-compound match" in synthesis["evidence_summary_notes"]


def test_pubchem_exact_match_synthesis():
    synthesis = synthesize_evidence(
        base_row(
            pubchem_exact_match=True,
            pubchem_cid="2244",
            pubchem_preferred_name="Aspirin",
            pubchem_lookup_status="exact_match",
        )
    )

    assert synthesis["evidence_summary_category"] == "identity_context"
    assert synthesis["public_identity_signal"] == "public_identity_signal_present"
    assert "PubChem exact match" in synthesis["evidence_summary_notes"]


def test_chembl_bioactivity_signal_synthesis():
    synthesis = synthesize_evidence(
        base_row(
            chembl_exact_match=True,
            chembl_lookup_status="exact_match",
            chembl_activity_count=42,
            chembl_target_summary="Target A; Target B",
        )
    )

    assert synthesis["evidence_summary_category"] == "public_bioactivity_context"
    assert synthesis["public_bioactivity_signal"] == "public_bioactivity_signal_present"
    assert "ChEMBL returned 42 activity records" in synthesis["evidence_summary_notes"]


def test_surechembl_patent_context_signal_synthesis():
    synthesis = synthesize_evidence(
        base_row(
            patent_public_evidence_match=True,
            patent_lookup_status="match_found",
            patent_record_count=7,
        )
    )

    assert synthesis["evidence_summary_category"] == "patent_context_signal"
    assert synthesis["patent_context_signal"] == "patent_context_signal_present"
    assert "SureChEMBL returned 7 records" in synthesis["evidence_summary_notes"]


def test_high_local_similarity_without_exact_match_synthesis():
    synthesis = synthesize_evidence(
        base_row(
            known_compound_match=False,
            closest_known_compound_name="Ibuprofen",
            closest_known_compound_similarity=0.82,
        )
    )

    assert synthesis["evidence_summary_category"] == "local_similarity_context"
    assert synthesis["local_similarity_signal"] == "high_local_similarity_signal_present"
    assert "closest local reference is Ibuprofen" in synthesis["evidence_summary_notes"]


def test_no_public_lookup_requested_synthesis():
    synthesis = synthesize_evidence(base_row())

    assert synthesis["evidence_summary_category"] == "limited_public_context"
    assert synthesis["public_identity_signal"] == "not_requested"
    assert synthesis["public_bioactivity_signal"] == "not_requested"
    assert synthesis["patent_context_signal"] == "not_requested"
    assert "Public identity lookup was not requested" in synthesis["evidence_summary_notes"]
    assert "ChEMBL public bioactivity lookup was not requested" in synthesis["evidence_summary_notes"]
    assert "SureChEMBL patent-context lookup was not requested" in synthesis["evidence_summary_notes"]


def test_combined_pubchem_chembl_and_patent_lookup_synthesis():
    synthesis = synthesize_evidence(
        base_row(
            pubchem_exact_match=True,
            pubchem_cid="702",
            pubchem_preferred_name="Ethanol",
            pubchem_lookup_status="exact_match",
            chembl_exact_match=True,
            chembl_lookup_status="exact_match",
            chembl_activity_count=12,
            patent_public_evidence_match=True,
            patent_lookup_status="match_found",
            patent_record_count=3,
        )
    )

    assert synthesis["evidence_summary_category"] == "combined_public_context"
    assert synthesis["biopharma_context_level"] == "high_evidence_context"
    assert synthesis["public_identity_signal"] == "public_identity_signal_present"
    assert synthesis["public_bioactivity_signal"] == "public_bioactivity_signal_present"
    assert synthesis["patent_context_signal"] == "patent_context_signal_present"
