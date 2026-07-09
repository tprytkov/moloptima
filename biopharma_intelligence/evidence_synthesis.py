"""Deterministic molecule-level evidence synthesis."""

from __future__ import annotations


HIGH_LOCAL_SIMILARITY_THRESHOLD = 0.7


def synthesize_evidence(row: dict[str, object]) -> dict[str, object]:
    """Summarize local and public evidence fields without changing scoring."""

    if row.get("valid_molecule") is False:
        return {
            "evidence_summary_category": "invalid_molecule",
            "evidence_summary_notes": "Invalid molecule: evidence synthesis was not run for this row.",
            "public_identity_signal": "invalid_molecule",
            "public_bioactivity_signal": "invalid_molecule",
            "patent_context_signal": "invalid_molecule",
            "local_similarity_signal": "invalid_molecule",
            "biopharma_context_level": "invalid_molecule",
            "recommended_review_focus": "Correct or remove the input structure before reviewing evidence signals.",
        }

    signals: list[str] = []
    notes: list[str] = []

    public_identity_signal = _public_identity_signal(row)
    public_bioactivity_signal = _public_bioactivity_signal(row)
    patent_context_signal = _patent_context_signal(row)
    local_similarity_signal = _local_similarity_signal(row)

    if public_identity_signal in {"local_identity_signal_present", "public_identity_signal_present"}:
        signals.append("identity")
    if public_bioactivity_signal == "public_bioactivity_signal_present":
        signals.append("bioactivity")
    if patent_context_signal == "patent_context_signal_present":
        signals.append("patent_context")
    if local_similarity_signal == "high_local_similarity_signal_present":
        signals.append("local_similarity")

    _append_signal_notes(
        notes,
        row,
        public_identity_signal,
        public_bioactivity_signal,
        patent_context_signal,
        local_similarity_signal,
    )

    category = _summary_category(
        public_identity_signal,
        public_bioactivity_signal,
        patent_context_signal,
        local_similarity_signal,
    )
    context_level = _context_level(signals)

    if not notes:
        notes.append("Limited public context: no configured evidence signals were detected.")

    return {
        "evidence_summary_category": category,
        "evidence_summary_notes": " ".join(notes),
        "public_identity_signal": public_identity_signal,
        "public_bioactivity_signal": public_bioactivity_signal,
        "patent_context_signal": patent_context_signal,
        "local_similarity_signal": local_similarity_signal,
        "biopharma_context_level": context_level,
        "recommended_review_focus": _recommended_review_focus(category),
    }


def _public_identity_signal(row: dict[str, object]) -> str:
    if row.get("pubchem_lookup_status") == "not_requested":
        if row.get("known_compound_match") is True:
            return "local_identity_signal_present"
        return "not_requested"
    if row.get("pubchem_exact_match") is True:
        return "public_identity_signal_present"
    if row.get("known_compound_match") is True:
        return "local_identity_signal_present"
    if row.get("pubchem_lookup_status") == "lookup_failed":
        return "lookup_failed"
    return "no_public_identity_signal"


def _public_bioactivity_signal(row: dict[str, object]) -> str:
    if row.get("chembl_lookup_status") == "not_requested":
        return "not_requested"
    activity_count = _numeric_value(row.get("chembl_activity_count"))
    if (
        row.get("chembl_exact_match") is True
        or row.get("chembl_similarity_match") is True
        or (activity_count is not None and activity_count > 0)
    ):
        return "public_bioactivity_signal_present"
    if row.get("chembl_lookup_status") == "lookup_failed":
        return "lookup_failed"
    return "no_public_bioactivity_signal"


def _patent_context_signal(row: dict[str, object]) -> str:
    if row.get("patent_lookup_status") == "not_requested":
        return "not_requested"
    record_count = _numeric_value(row.get("patent_record_count"))
    if row.get("patent_public_evidence_match") is True or (
        record_count is not None and record_count > 0
    ):
        return "patent_context_signal_present"
    if row.get("patent_lookup_status") == "lookup_failed":
        return "lookup_failed"
    return "no_patent_context_signal"


def _local_similarity_signal(row: dict[str, object]) -> str:
    if row.get("known_compound_match") is True:
        return "local_exact_identity_signal_present"
    similarity = _numeric_value(row.get("closest_known_compound_similarity"))
    if similarity is not None and similarity >= HIGH_LOCAL_SIMILARITY_THRESHOLD:
        return "high_local_similarity_signal_present"
    if row.get("similarity_check_status") in {"not_run", "not_run_invalid_molecule"}:
        return "not_run"
    return "no_high_local_similarity_signal"


def _append_signal_notes(
    notes: list[str],
    row: dict[str, object],
    public_identity_signal: str,
    public_bioactivity_signal: str,
    patent_context_signal: str,
    local_similarity_signal: str,
) -> None:
    if public_identity_signal == "public_identity_signal_present":
        label = row.get("pubchem_preferred_name") or row.get("pubchem_cid") or "PubChem"
        notes.append(f"Public identity signal: PubChem exact match found ({label}).")
    elif public_identity_signal == "local_identity_signal_present":
        label = row.get("known_compound_name") or "local reference"
        notes.append(f"Public identity signal: local exact known-compound match found ({label}).")
    elif public_identity_signal == "not_requested":
        notes.append("Public identity lookup was not requested.")
    elif public_identity_signal == "lookup_failed":
        notes.append("Public identity lookup failed; missing data is not interpreted as no signal.")
    if row.get("pubchem_lookup_status") == "not_requested" and public_identity_signal != "not_requested":
        notes.append("PubChem public identity lookup was not requested.")

    if public_bioactivity_signal == "public_bioactivity_signal_present":
        count = row.get("chembl_activity_count")
        target_summary = row.get("chembl_target_summary")
        if count not in {None, ""}:
            notes.append(f"Public bioactivity signal: ChEMBL returned {count} activity records.")
        else:
            notes.append("Public bioactivity signal: ChEMBL returned molecule context.")
        if target_summary:
            notes.append(f"ChEMBL target summary: {target_summary}.")
    elif public_bioactivity_signal == "not_requested":
        notes.append("ChEMBL public bioactivity lookup was not requested.")
    elif public_bioactivity_signal == "lookup_failed":
        notes.append("ChEMBL lookup failed; missing data is not interpreted as no signal.")

    if patent_context_signal == "patent_context_signal_present":
        count = row.get("patent_record_count")
        notes.append(
            "Patent-context signal: SureChEMBL returned "
            f"{count if count not in {None, ''} else 'public'} records for this structure/query."
        )
        notes.append("Record counts may include broad or indirect public document associations.")
    elif patent_context_signal == "not_requested":
        notes.append("SureChEMBL patent-context lookup was not requested.")
    elif patent_context_signal == "lookup_failed":
        notes.append("SureChEMBL lookup failed; missing data is not interpreted as no signal.")

    if local_similarity_signal == "local_exact_identity_signal_present":
        notes.append("Local similarity signal: local exact identity match is present.")
    elif local_similarity_signal == "high_local_similarity_signal_present":
        name = row.get("closest_known_compound_name") or "local reference"
        similarity = row.get("closest_known_compound_similarity")
        notes.append(f"Local similarity signal: closest local reference is {name} ({similarity}).")


def _summary_category(
    public_identity_signal: str,
    public_bioactivity_signal: str,
    patent_context_signal: str,
    local_similarity_signal: str,
) -> str:
    public_signal_count = sum(
        [
            public_identity_signal in {"local_identity_signal_present", "public_identity_signal_present"},
            public_bioactivity_signal == "public_bioactivity_signal_present",
            patent_context_signal == "patent_context_signal_present",
        ]
    )
    if public_signal_count >= 2:
        return "combined_public_context"
    if public_identity_signal in {"local_identity_signal_present", "public_identity_signal_present"}:
        return "identity_context"
    if public_bioactivity_signal == "public_bioactivity_signal_present":
        return "public_bioactivity_context"
    if patent_context_signal == "patent_context_signal_present":
        return "patent_context_signal"
    if local_similarity_signal == "high_local_similarity_signal_present":
        return "local_similarity_context"
    return "limited_public_context"


def _context_level(signals: list[str]) -> str:
    if len(signals) >= 3:
        return "high_evidence_context"
    if len(signals) >= 1:
        return "moderate_evidence_context"
    return "limited_public_context"


def _recommended_review_focus(category: str) -> str:
    return {
        "invalid_molecule": "Correct or remove the input structure before reviewing evidence signals.",
        "combined_public_context": "Review identity, public bioactivity, patent-context, and local analog evidence together.",
        "identity_context": "Review exact identity evidence and confirm whether the known reference is intended.",
        "public_bioactivity_context": "Review ChEMBL activity and target context for computational screening relevance.",
        "patent_context_signal": "Review SureChEMBL returned records as public patent-associated evidence only.",
        "local_similarity_context": "Review local closest-reference analog context before prioritization decisions.",
        "limited_public_context": "Review descriptors and local scoring; optional public lookups may add context.",
    }[category]


def _numeric_value(value: object) -> float | None:
    if value in {None, ""}:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
