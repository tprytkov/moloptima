"""First-pass molecular prioritization scoring."""

from __future__ import annotations

from dataclasses import asdict

from biopharma_intelligence.identity import IdentityMatchResult
from biopharma_intelligence.public_lookup import (
    ChEMBLBioactivityResult,
    PatentContextResult,
    PublicIdentityResult,
    chembl_not_requested_result,
    not_requested_result,
    patent_not_requested_result,
)
from biopharma_intelligence.evidence_synthesis import synthesize_evidence
from biopharma_intelligence.similarity import SimilarityMatchResult
from molecular_prioritization.bbb_predictor import BBBPrediction
from molecular_prioritization.descriptors import MolecularDescriptors
from molecular_prioritization.docking import DockingResult
from molecular_prioritization.synthetic_accessibility import SyntheticAccessibilityResult


def calculate_priority_score(
    descriptors: MolecularDescriptors,
    is_valid: bool,
    bbb_prediction: BBBPrediction | None = None,
) -> float:
    """Calculate a transparent Phase 1 priority score between 0 and 1."""

    if not is_valid:
        return 0.0

    lipinski_component = 1.0 if descriptors.lipinski_pass else 0.4
    mw_component = _bounded_preference(descriptors.mw, lower=150, upper=500)
    tpsa_component = _bounded_preference(descriptors.tpsa, lower=20, upper=140)
    rotatable_component = max(0.0, 1.0 - max(0, descriptors.rotatable_bonds - 10) / 10)

    score = (
        descriptors.qed * 0.45
        + lipinski_component * 0.25
        + mw_component * 0.15
        + tpsa_component * 0.10
        + rotatable_component * 0.05
    )

    if bbb_prediction and bbb_prediction.bbb_probability is not None:
        if bbb_prediction.bbb_prediction == "high":
            score += 0.05 * bbb_prediction.bbb_probability
        elif bbb_prediction.bbb_prediction == "low":
            score -= 0.05 * bbb_prediction.bbb_probability

    return round(max(0.0, min(score, 1.0)), 3)


def build_priority_record(
    molecule_id: str,
    input_smiles: str,
    canonical_smiles: str | None,
    valid_molecule: bool,
    descriptors: MolecularDescriptors | None,
    bbb_prediction: BBBPrediction | None = None,
    synthetic_accessibility: SyntheticAccessibilityResult | None = None,
    docking: DockingResult | None = None,
    identity_match: IdentityMatchResult | None = None,
    similarity_match: SimilarityMatchResult | None = None,
    public_identity_match: PublicIdentityResult | None = None,
    chembl_bioactivity_match: ChEMBLBioactivityResult | None = None,
    patent_context_match: PatentContextResult | None = None,
    error: str | None = None,
) -> dict[str, object]:
    """Build one row for a ranked molecular prioritization result."""

    descriptor_values = asdict(descriptors) if descriptors else {
        "mw": None,
        "tpsa": None,
        "hba": None,
        "hbd": None,
        "rotatable_bonds": None,
        "qed": None,
        "lipinski_violations": None,
        "lipinski_pass": False,
    }

    priority_score = (
        calculate_priority_score(descriptors, valid_molecule, bbb_prediction)
        if descriptors
        else 0.0
    )
    bbb_values = bbb_prediction or BBBPrediction(
        bbb_prediction="unavailable",
        bbb_probability=None,
        bbb_model_status="not_run",
        bbb_warning="BBB prediction was not run.",
    )
    synthetic_accessibility_values = synthetic_accessibility or SyntheticAccessibilityResult(
        sa_score=None,
        synthetic_feasibility_category="not_available",
        synthetic_feasibility_status="not_run",
    )
    docking_values = docking or DockingResult(
        docking_score=None,
        docking_status="not_provided",
    )
    identity_values = identity_match or IdentityMatchResult(
        known_compound_match=False,
        known_compound_name=None,
        known_compound_source=None,
        known_compound_id=None,
        identity_check_status="not_run",
    )
    similarity_values = similarity_match or SimilarityMatchResult(
        closest_known_compound_name=None,
        closest_known_compound_id=None,
        closest_known_compound_similarity=None,
        closest_known_compound_source=None,
        similarity_check_status="not_run",
    )
    public_identity_values = public_identity_match or not_requested_result()
    chembl_bioactivity_values = chembl_bioactivity_match or chembl_not_requested_result()
    patent_context_values = patent_context_match or patent_not_requested_result()

    record = {
        "molecule_id": molecule_id,
        "input_smiles": input_smiles,
        "canonical_smiles": canonical_smiles,
        "valid_molecule": valid_molecule,
        "priority_score": priority_score,
        "error": error,
        "known_compound_match": identity_values.known_compound_match,
        "known_compound_name": identity_values.known_compound_name,
        "known_compound_source": identity_values.known_compound_source,
        "known_compound_id": identity_values.known_compound_id,
        "identity_check_status": identity_values.identity_check_status,
        "closest_known_compound_name": similarity_values.closest_known_compound_name,
        "closest_known_compound_id": similarity_values.closest_known_compound_id,
        "closest_known_compound_similarity": (
            similarity_values.closest_known_compound_similarity
        ),
        "closest_known_compound_source": similarity_values.closest_known_compound_source,
        "similarity_check_status": similarity_values.similarity_check_status,
        "pubchem_exact_match": public_identity_values.pubchem_exact_match,
        "pubchem_cid": public_identity_values.pubchem_cid,
        "pubchem_preferred_name": public_identity_values.pubchem_preferred_name,
        "pubchem_lookup_status": public_identity_values.pubchem_lookup_status,
        "pubchem_cache_status": public_identity_values.pubchem_cache_status,
        "pubchem_warning": public_identity_values.pubchem_warning,
        "chembl_exact_match": chembl_bioactivity_values.chembl_exact_match,
        "chembl_molecule_id": chembl_bioactivity_values.chembl_molecule_id,
        "chembl_pref_name": chembl_bioactivity_values.chembl_pref_name,
        "chembl_lookup_status": chembl_bioactivity_values.chembl_lookup_status,
        "chembl_cache_status": chembl_bioactivity_values.chembl_cache_status,
        "chembl_warning": chembl_bioactivity_values.chembl_warning,
        "chembl_activity_count": chembl_bioactivity_values.chembl_activity_count,
        "chembl_target_count": chembl_bioactivity_values.chembl_target_count,
        "chembl_target_summary": chembl_bioactivity_values.chembl_target_summary,
        "chembl_similarity_match": chembl_bioactivity_values.chembl_similarity_match,
        "chembl_similarity_score": chembl_bioactivity_values.chembl_similarity_score,
        "chembl_similarity_molecule_id": (
            chembl_bioactivity_values.chembl_similarity_molecule_id
        ),
        "chembl_similarity_pref_name": chembl_bioactivity_values.chembl_similarity_pref_name,
        "chembl_similarity_status": chembl_bioactivity_values.chembl_similarity_status,
        "patent_lookup_status": patent_context_values.patent_lookup_status,
        "patent_cache_status": patent_context_values.patent_cache_status,
        "patent_public_evidence_match": (
            patent_context_values.patent_public_evidence_match
        ),
        "patent_source": patent_context_values.patent_source,
        "patent_record_count": patent_context_values.patent_record_count,
        "patent_top_record_id": patent_context_values.patent_top_record_id,
        "patent_top_record_title": patent_context_values.patent_top_record_title,
        "patent_top_record_url": patent_context_values.patent_top_record_url,
        "patent_query_identifier": patent_context_values.patent_query_identifier,
        "patent_warning": patent_context_values.patent_warning,
        "docking_score": docking_values.docking_score,
        "docking_status": docking_values.docking_status,
        "sa_score": synthetic_accessibility_values.sa_score,
        "synthetic_feasibility_category": (
            synthetic_accessibility_values.synthetic_feasibility_category
        ),
        "synthetic_feasibility_status": synthetic_accessibility_values.synthetic_feasibility_status,
        "bbb_prediction": bbb_values.bbb_prediction,
        "bbb_probability": bbb_values.bbb_probability,
        "bbb_model_status": bbb_values.bbb_model_status,
        "bbb_warning": bbb_values.bbb_warning,
        **descriptor_values,
    }
    evidence_synthesis = synthesize_evidence(record)
    ordered_record: dict[str, object] = {}
    for key, value in record.items():
        ordered_record[key] = value
        if key == "patent_warning":
            ordered_record.update(evidence_synthesis)
    return ordered_record


def _bounded_preference(value: float, lower: float, upper: float) -> float:
    if lower <= value <= upper:
        return 1.0

    if value < lower:
        return max(0.0, value / lower)

    return max(0.0, 1.0 - (value - upper) / upper)
