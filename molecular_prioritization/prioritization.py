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
from molecular_prioritization.structural_alerts import StructuralAlertResult
from molecular_prioritization.synthetic_accessibility import SyntheticAccessibilityResult
from molecular_prioritization.prioritization_v2 import (
    PRIORITIZATION_METHOD_PROFILE_V2,
    score_candidates_v2,
)


PRIORITIZATION_RANKING_VERSION = "moloptima_scientific_priority_v1"
PRIORITIZATION_METHOD_LEGACY_V1 = "legacy_v1"


def calculate_priority_score(
    descriptors: MolecularDescriptors,
    is_valid: bool,
    bbb_prediction: BBBPrediction | None = None,
) -> float:
    """Calculate a transparent Phase 1 priority score between 0 and 1."""

    return _base_priority_calculation(descriptors, is_valid, bbb_prediction)[0]


def _base_priority_calculation(
    descriptors: MolecularDescriptors,
    is_valid: bool,
    bbb_prediction: BBBPrediction | None,
) -> tuple[float, dict[str, object]]:
    """Return the approved base score and its exact component-level explanation."""

    if not is_valid:
        return 0.0, {
            "status": "unscorable_invalid_molecule",
            "priority_score": None,
            "ranking_score": None,
            "ranking_position": None,
            "components": {},
            "warnings": ["Scientific prioritization was not run because the molecule is invalid."],
            "ranking_version": PRIORITIZATION_RANKING_VERSION,
        }

    lipinski_component = 1.0 if descriptors.lipinski_pass else 0.4
    mw_component = _bounded_preference(descriptors.mw, lower=150, upper=500)
    tpsa_component = _bounded_preference(descriptors.tpsa, lower=20, upper=140)
    rotatable_component = max(0.0, 1.0 - max(0, descriptors.rotatable_bonds - 10) / 10)
    components: dict[str, dict[str, object]] = {
        "qed": _weighted_component(
            descriptors.qed, descriptors.qed, 0.45,
            "QED multiplied by the approved 0.45 base-score weight.",
        ),
        "lipinski": _weighted_component(
            {"pass": descriptors.lipinski_pass, "violations": descriptors.lipinski_violations},
            lipinski_component, 0.25,
            "Lipinski pass maps to 1.0; non-pass maps to 0.4, then uses weight 0.25.",
        ),
        "molecular_weight": _weighted_component(
            descriptors.mw, mw_component, 0.15,
            "Full preference from 150 to 500 Da; linearly bounded outside that interval.",
        ),
        "tpsa": _weighted_component(
            descriptors.tpsa, tpsa_component, 0.10,
            "Full preference from 20 to 140 Å²; linearly bounded outside that interval.",
        ),
        "rotatable_bonds": _weighted_component(
            descriptors.rotatable_bonds, rotatable_component, 0.05,
            "Full preference through 10 rotatable bonds, then decreases linearly to zero at 20.",
        ),
    }
    warnings: list[str] = []
    bbb_probability = bbb_prediction.bbb_probability if bbb_prediction else None
    bbb_label = bbb_prediction.bbb_prediction if bbb_prediction else "unavailable"
    if bbb_probability is not None and bbb_label in {"high", "low"}:
        direction = 1.0 if bbb_label == "high" else -1.0
        components["gmc_bbb"] = {
            "raw_value": bbb_probability,
            "normalized_value": bbb_probability,
            "contribution": round(direction * 0.05 * bbb_probability, 6),
            "weight_or_rule": "+0.05 × probability for BBB+; -0.05 × probability for BBB-",
            "status": "available",
            "reason": (
                f"Existing generic BBB rule applied to the provisional raw classification ({bbb_label})."
            ),
            "score_scope": "priority_score",
        }
        warnings.append(
            "BBB desirability uses the existing generic penetration-favorable rule; no approved target-specific BBB profile is configured."
        )
        if bbb_label == "low":
            warnings.append(
                "The preserved legacy BBB- rule subtracts 0.05 × the BBB+ probability rather than its complement; this asymmetric rule has not been scientifically redesigned in Task 4."
            )
    else:
        components["gmc_bbb"] = {
            "raw_value": None,
            "normalized_value": None,
            "contribution": None,
            "weight_or_rule": "+0.05 × probability for BBB+; -0.05 × probability for BBB-",
            "status": _missing_bbb_status(bbb_prediction),
            "reason": "GMC BBB evidence is unavailable and is omitted, not replaced with a numeric zero.",
            "score_scope": "priority_score",
        }
        warnings.append("GMC BBB evidence was unavailable; the base score uses descriptor evidence only.")

    contribution_total = sum(
        float(component["contribution"])
        for component in components.values()
        if component.get("contribution") is not None
    )
    score = round(max(0.0, min(contribution_total, 1.0)), 3)
    status = "base_scored" if components["gmc_bbb"]["status"] == "available" else "partial_evidence"
    return score, {
        "status": status,
        "priority_score": score,
        "ranking_score": None,
        "ranking_position": None,
        "components": components,
        "warnings": warnings,
        "ranking_version": PRIORITIZATION_RANKING_VERSION,
    }


def _weighted_component(
    raw_value: object,
    normalized_value: float,
    weight: float,
    reason: str,
) -> dict[str, object]:
    return {
        "raw_value": raw_value,
        "normalized_value": round(normalized_value, 6),
        "contribution": round(normalized_value * weight, 6),
        "weight_or_rule": weight,
        "status": "available",
        "reason": reason,
        "score_scope": "priority_score",
    }


def _missing_bbb_status(bbb_prediction: BBBPrediction | None) -> str:
    if bbb_prediction is None:
        return "unavailable_model_family"
    if bbb_prediction.bbb_model_status == "not_run_invalid_molecule":
        return "invalid_molecule"
    return str(bbb_prediction.bbb_model_status or "unavailable_model_family")


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
    structural_alerts: StructuralAlertResult | None = None,
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

    if descriptors:
        priority_score, prioritization = _base_priority_calculation(
            descriptors, valid_molecule, bbb_prediction,
        )
    else:
        priority_score = 0.0
        prioritization = {
            "status": "unscorable_invalid_molecule",
            "priority_score": None,
            "ranking_score": None,
            "ranking_position": None,
            "components": {},
            "warnings": ["Scientific prioritization was not run because descriptors are unavailable."],
            "ranking_version": PRIORITIZATION_RANKING_VERSION,
        }
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
    structural_alert_values = structural_alerts or StructuralAlertResult(
        structural_alert_status="not_run",
        structural_alert_count=None,
        structural_alert_categories="",
        structural_alert_names="",
        pains_alert=False,
        brenk_alert=False,
        medchem_alert_summary="Structural-alert screening was not run.",
    )

    record = {
        "molecule_id": molecule_id,
        "input_smiles": input_smiles,
        "canonical_smiles": canonical_smiles,
        "valid_molecule": valid_molecule,
        "priority_score": priority_score,
        "scientific_ranking_score": None,
        "scientific_rank": None,
        "prioritization_status": prioritization["status"],
        "ranking_version": PRIORITIZATION_RANKING_VERSION,
        "prioritization": prioritization,
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
        "structural_alert_status": structural_alert_values.structural_alert_status,
        "structural_alert_count": structural_alert_values.structural_alert_count,
        "structural_alert_categories": structural_alert_values.structural_alert_categories,
        "structural_alert_names": structural_alert_values.structural_alert_names,
        "pains_alert": structural_alert_values.pains_alert,
        "brenk_alert": structural_alert_values.brenk_alert,
        "medchem_alert_summary": structural_alert_values.medchem_alert_summary,
        "docking_score": docking_values.docking_score,
        "docking_status": docking_values.docking_status,
        "docking_score_normalized": None,
        "docking_priority_signal": "not_available",
        "docking_rank_within_run": None,
        "docking_percentile_within_run": None,
        "combined_candidate_score": None,
        "combined_score_explanation": "Docking-informed scoring is calculated after run-level docking scores are available.",
        "combined_score_status": "not_available",
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


def finalize_scientific_prioritization(
    rows: list[dict[str, object]],
) -> list[dict[str, object]]:
    """Attach docking/display-only context and deterministically rank valid rows."""

    finalized: list[tuple[int, dict[str, object]]] = []
    for input_index, source_row in enumerate(rows):
        row = dict(source_row)
        prioritization = dict(row.get("prioritization") or {})
        components = dict(prioritization.get("components") or {})
        warnings = list(prioritization.get("warnings") or [])
        components["vina_docking"] = _docking_component(row)
        if components["vina_docking"]["status"] == "available":
            components["base_priority_for_combined"] = {
                "raw_value": row.get("priority_score"),
                "normalized_value": row.get("priority_score"),
                "contribution": round(float(row.get("priority_score") or 0.0) * 0.70, 6),
                "weight_or_rule": 0.70,
                "status": "available",
                "reason": "The approved combined candidate score carries 70% of the unchanged base priority score.",
                "score_scope": "combined_candidate_score",
            }
        components.update(_display_only_components(row))

        valid = row.get("valid_molecule") is True
        base_score = _finite_number(row.get("priority_score")) if valid else None
        combined_score = _finite_number(row.get("combined_candidate_score")) if valid else None
        bbb_available = components.get("gmc_bbb", {}).get("status") == "available"
        docking_available = components["vina_docking"]["status"] == "available"
        rank_eligible = bool(valid and base_score is not None and docking_available and combined_score is not None)
        ranking_score = combined_score if rank_eligible else None
        if not valid:
            status = "unscorable_invalid_molecule"
        elif base_score is None:
            status = "unscorable"
        elif not docking_available:
            status = _missing_docking_prioritization_status(row.get("docking_status"))
            warnings.append("Final scientific ranking requires successful Vina docking.")
        elif bbb_available:
            status = "fully_scored"
        else:
            status = "partially_scored"
        prioritization.update({
            "status": status,
            "priority_score": base_score,
            "ranking_score": ranking_score,
            "ranking_position": None,
            "rank_eligible": rank_eligible,
            "ranking_basis": (
                "combined_candidate_score_70_percent_base_30_percent_vina"
                if rank_eligible
                else "requires_successful_vina_docking"
                if valid and base_score is not None and not docking_available
                else "not_ranked"
            ),
            "components": components,
            "warnings": _deduplicate(warnings),
            "ranking_version": PRIORITIZATION_RANKING_VERSION,
        })
        row.update({
            "scientific_ranking_score": ranking_score,
            "scientific_rank": None,
            "rank_eligible": rank_eligible,
            "prioritization_status": status,
            "ranking_version": PRIORITIZATION_RANKING_VERSION,
            "prioritization": prioritization,
        })
        finalized.append((input_index, row))

    rankable = [item for item in finalized if item[1]["scientific_ranking_score"] is not None]
    rankable.sort(key=lambda item: (
        -float(item[1]["scientific_ranking_score"]),
        str(item[1].get("molecule_id") or "").casefold(),
        str(item[1].get("canonical_smiles") or ""),
        item[0],
    ))
    for rank, (_input_index, row) in enumerate(rankable, start=1):
        row["scientific_rank"] = rank
        row["prioritization"]["ranking_position"] = rank
    unrankable = [item for item in finalized if item[1]["scientific_ranking_score"] is None]
    return [row for _index, row in (*rankable, *unrankable)]


def _missing_docking_prioritization_status(docking_status: object) -> str:
    status = str(docking_status or "docking_unavailable")
    if status in {"not_provided", "not_requested", "pending", "not_run"}:
        return "awaiting_docking"
    if status in {
        "runtime_unavailable", "receptor_unavailable", "configuration_invalid",
        "docking_unavailable",
    }:
        return "docking_unavailable"
    return "docking_failed"


def _docking_component(row: dict[str, object]) -> dict[str, object]:
    raw_value = _finite_number(row.get("docking_score"))
    normalized = _finite_number(row.get("docking_score_normalized"))
    available = row.get("docking_status") == "provided" and raw_value is not None and normalized is not None
    if available:
        return {
            "raw_value": raw_value,
            "normalized_value": normalized,
            "contribution": round(normalized * 0.30, 6),
            "weight_or_rule": "30% of combined_candidate_score; excluded from base priority_score",
            "status": "available",
            "reason": "More-negative Vina affinity ranks more favorably within this receptor/site/protocol batch; it is not binding free energy.",
            "score_scope": "combined_candidate_score",
        }
    docking_status = str(row.get("docking_status") or "docking_unavailable")
    return {
        "raw_value": raw_value,
        "normalized_value": None,
        "contribution": None,
        "weight_or_rule": "30% of combined_candidate_score when a valid batch docking signal exists",
        "status": "docking_unavailable" if docking_status in {"not_provided", "not_requested"} else docking_status,
        "reason": "No docking contribution was fabricated; Vina affinity is unavailable for this molecule.",
        "score_scope": "combined_candidate_score",
    }


def _display_only_components(row: dict[str, object]) -> dict[str, dict[str, object]]:
    return {
        "chemberta_classification": _display_only_component(
            row.get("admet_predictions"),
            str((row.get("admet_family_status") or {}).get("chemberta") or row.get("admet_model_status") or "unavailable_model_family"),
            "Nine approved ChemBERTa endpoints are retained as raw evidence but have no approved weight in this policy; legacy bbb_martins is excluded.",
        ),
        "chemprop_regression": _display_only_component(
            row.get("admet_regression"),
            str((row.get("admet_family_status") or {}).get("chemprop_regression") or "unavailable_model_family"),
            "Five Chemprop regression endpoints, units, transforms, and disagreement are retained but have no approved weight in this policy.",
        ),
        "synthetic_accessibility": _display_only_component(
            row.get("sa_score"), str(row.get("synthetic_feasibility_status") or "unsupported_value"),
            "Heuristic SA is displayed but has no approved contribution to this policy.",
        ),
        "structural_alerts": _display_only_component(
            {
                "count": row.get("structural_alert_count"),
                "pains_alert": row.get("pains_alert"),
                "brenk_alert": row.get("brenk_alert"),
            },
            str(row.get("structural_alert_status") or "unsupported_value"),
            "Structural alerts are displayed for review but have no approved contribution to this policy.",
        ),
    }


def _display_only_component(raw_value: object, status: str, reason: str) -> dict[str, object]:
    unavailable = status in {
        "model_unavailable", "not_run_invalid_molecule", "unavailable_model_family",
        "not_run", "unsupported_value",
    }
    return {
        "raw_value": raw_value,
        "normalized_value": None,
        "contribution": None,
        "weight_or_rule": "display_only_not_in_ranking_policy",
        "status": status if unavailable else "available_display_only",
        "reason": reason,
        "score_scope": "not_scored",
    }


def _finite_number(value: object) -> float | None:
    if not isinstance(value, int | float):
        return None
    number = float(value)
    return number if number == number and abs(number) != float("inf") else None


def _deduplicate(values: list[str]) -> list[str]:
    return list(dict.fromkeys(value for value in values if value))


def _bounded_preference(value: float, lower: float, upper: float) -> float:
    if lower <= value <= upper:
        return 1.0

    if value < lower:
        return max(0.0, value / lower)

    return max(0.0, 1.0 - (value - upper) / upper)
