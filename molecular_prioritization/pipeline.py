"""Small end-to-end prioritization pipeline."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Callable

from biopharma_intelligence.identity import check_known_compound_identity
from biopharma_intelligence.public_lookup import (
    ChEMBLClient,
    PubChemClient,
    SureChEMBLPatentClient,
    chembl_not_requested_result,
    not_requested_result,
    patent_not_requested_result,
)
from biopharma_intelligence.evidence_synthesis import synthesize_evidence
from biopharma_intelligence.target_references import (
    TARGET_REFERENCE_COLUMNS,
    TargetReferenceClient,
    add_target_reference_analysis,
    empty_target_reference_fields,
    target_context_from_mapping,
    target_reference_metadata,
)
from biopharma_intelligence.similarity import find_closest_known_compound
from molecular_prioritization.bbb_predictor import BBBPrediction, load_bbb_predictor
from molecular_prioritization.admet_registry import ADMETRegistry, invalid_admet_result
from molecular_prioritization.admet_multitask_predictor import (
    load_admet_multitask_predictor,
    unavailable_admet_prediction,
)
from molecular_prioritization.descriptors import calculate_descriptors
from molecular_prioritization.diversity import (
    CHEMICAL_SPACE_COLUMNS,
    DIVERSITY_COLUMNS,
    add_diversity_analysis,
)
from molecular_prioritization.docking import (
    DockingResult,
    DOCKING_INFORMED_COLUMNS,
    add_docking_informed_scores,
    parse_precomputed_docking_score,
)
from molecular_prioritization.receptor import ReceptorArtifact, VinaBoxConfig
from molecular_prioritization.vina_docking import (
    DockingRuntimeUnavailable,
    VinaDockingEngine,
    unavailable_docking_result,
)
from molecular_prioritization.prioritization import (
    build_priority_record,
    finalize_scientific_prioritization,
)
from molecular_prioritization.standardize import standardize_smiles
from molecular_prioritization.structural_alerts import (
    STRUCTURAL_ALERT_COLUMNS,
    screen_structural_alerts,
)
from molecular_prioritization.synthetic_accessibility import heuristic_synthetic_accessibility


def prioritize_smiles(
    records: list[dict[str, str]],
    *,
    bbb_predictor: object | None = None,
    admet_predictor: object | None = None,
    enable_public_lookup: bool = False,
    enable_pubchem_lookup: bool | None = None,
    enable_chembl_lookup: bool = False,
    enable_patent_lookup: bool = False,
    enable_target_reference_discovery: bool = False,
    target_context: dict[str, object] | None = None,
    public_lookup_client: object | None = None,
    chembl_lookup_client: object | None = None,
    patent_lookup_client: object | None = None,
    target_reference_client: object | None = None,
    admet_registry: object | None = None,
    progress_callback: Callable[..., None] | None = None,
    enable_docking: bool = False,
    receptor: ReceptorArtifact | None = None,
    docking_config: VinaBoxConfig | None = None,
    docking_engine: object | None = None,
    docking_output_root: str | Path | None = None,
    docking_setup_error: str = "",
) -> list[dict[str, object]]:
    """Prioritize molecule records with molecule_id and smiles fields."""

    use_legacy_adapters = bbb_predictor is not None or admet_predictor is not None
    active_bbb_predictor = (bbb_predictor or load_bbb_predictor()) if use_legacy_adapters else None
    admet_load_warning = ""
    if admet_predictor is not None:
        active_admet_predictor = admet_predictor
    elif use_legacy_adapters:
        try:
            active_admet_predictor = load_admet_multitask_predictor()
        except Exception as exc:
            active_admet_predictor = None
            admet_load_warning = f"Frozen ADMET model unavailable: {exc}"
    else:
        active_admet_predictor = None
    pubchem_lookup_enabled = enable_public_lookup if enable_pubchem_lookup is None else enable_pubchem_lookup
    active_public_lookup_client = public_lookup_client or PubChemClient()
    active_chembl_lookup_client = chembl_lookup_client or ChEMBLClient()
    active_patent_lookup_client = patent_lookup_client or SureChEMBLPatentClient()
    active_target_reference_client = target_reference_client or TargetReferenceClient()
    ranked_records: list[dict[str, object]] = []

    prepared_records = []
    for index, record in enumerate(records, start=1):
        molecule_id = record.get("molecule_id") or f"mol_{index}"
        standardized = standardize_smiles(record.get("smiles", ""))
        prepared_records.append((record, molecule_id, standardized))

    valid_prepared = [
        item for item in prepared_records if item[2].valid_molecule and item[2].canonical_smiles
    ]
    valid_count = len(valid_prepared)
    invalid_count = len(prepared_records) - valid_count
    if progress_callback:
        progress_callback(
            stage="admet", valid_count=valid_count, invalid_count=invalid_count,
            processed_count=invalid_count, admet_success_count=0, admet_failure_count=0,
        )

    common_by_index: dict[int, dict[str, object]] = {}
    admet_successes = 0
    admet_failures = 0
    if not use_legacy_adapters and valid_prepared:
        engine = admet_registry or ADMETRegistry()
        valid_results = engine.predict_batch(
            [str(item[1]) for item in valid_prepared],
            [str(item[2].canonical_smiles) for item in valid_prepared],
        )
        valid_positions = [
            index for index, item in enumerate(prepared_records)
            if item[2].valid_molecule and item[2].canonical_smiles
        ]
        common_by_index = dict(zip(valid_positions, valid_results, strict=True))
        successes = sum(item.get("status") == "success" for item in valid_results)
        admet_successes = successes
        admet_failures = valid_count - successes
        if progress_callback:
            progress_callback(
                stage="admet", valid_count=valid_count, invalid_count=invalid_count,
                processed_count=len(prepared_records), admet_success_count=successes,
                admet_failure_count=admet_failures,
            )

    docking_by_index: dict[int, dict[str, object]] = {}
    if enable_docking:
        if progress_callback:
            progress_callback(
                stage="docking", valid_count=valid_count, invalid_count=invalid_count,
                processed_count=invalid_count, docking_success_count=0,
                docking_failure_count=0,
            )
        valid_positions = [
            index for index, item in enumerate(prepared_records)
            if item[2].valid_molecule and item[2].canonical_smiles
        ]
        active_docking_engine = (
            docking_engine
            if receptor is not None and docking_config is not None
            else None
        )
        family_status = (
            "configuration_invalid" if docking_config is None
            else "receptor_unavailable"
        )
        family_warning = docking_setup_error or "A validated prepared receptor and explicit docking configuration are required."
        if active_docking_engine is None and receptor is not None and docking_config is not None:
            try:
                active_docking_engine = VinaDockingEngine(
                    receptor,
                    docking_config,
                    output_root=(
                        docking_output_root
                        or Path(__file__).resolve().parents[1] / "app_data" / "docking_work"
                    ),
                )
            except DockingRuntimeUnavailable as exc:
                family_status = "runtime_unavailable"
                family_warning = str(exc)
            except Exception as exc:
                family_status = "docking_unavailable"
                family_warning = str(exc)
        if active_docking_engine is None:
            valid_docking_results = [
                unavailable_docking_result(
                    str(item[1]), item[2].canonical_smiles, status=family_status,
                    warning=family_warning, receptor=receptor, config=docking_config,
                )
                for item in valid_prepared
            ]
            if progress_callback:
                progress_callback(
                    stage="docking", valid_count=valid_count, invalid_count=invalid_count,
                    processed_count=len(prepared_records), docking_success_count=0,
                    docking_failure_count=valid_count,
                )
        else:
            def docking_progress(processed: int, successes: int, failures: int) -> None:
                if progress_callback:
                    progress_callback(
                        stage="docking", valid_count=valid_count, invalid_count=invalid_count,
                        processed_count=invalid_count + processed,
                        docking_success_count=successes, docking_failure_count=failures,
                    )

            valid_docking_results = active_docking_engine.dock_batch(
                [str(item[1]) for item in valid_prepared],
                [str(item[2].canonical_smiles) for item in valid_prepared],
                progress_callback=docking_progress,
            )
        docking_by_index = dict(zip(valid_positions, valid_docking_results, strict=True))

    for prepared_index, (record, molecule_id, standardized) in enumerate(prepared_records):
        input_smiles = record.get("smiles", "")
        descriptors = (
            calculate_descriptors(standardized.canonical_smiles)
            if standardized.canonical_smiles
            else None
        )
        common_admet = None
        if use_legacy_adapters:
            bbb_prediction = active_bbb_predictor.predict(
                standardized.canonical_smiles, standardized.valid_molecule,
            )
        else:
            common_admet = (
                common_by_index.get(prepared_index)
                if standardized.valid_molecule and standardized.canonical_smiles
                else invalid_admet_result(str(molecule_id), standardized.canonical_smiles)
            )
            bbb_result = common_admet["bbb"]
            bbb_label = bbb_result.get("raw_classification") or bbb_result.get("prediction")
            bbb_prediction = BBBPrediction(
                bbb_prediction="high" if bbb_label == "BBB+" else "low" if bbb_label == "BBB-" else "unavailable",
                bbb_probability=bbb_result.get("ensemble_probability"),
                bbb_model_status="model_available" if bbb_result.get("status") == "success" else str(bbb_result.get("status")),
                bbb_warning=str(bbb_result.get("warning") or bbb_result.get("error_message") or ""),
            )
        if not standardized.valid_molecule or not standardized.canonical_smiles:
            admet_prediction = (
                common_admet["classification"]
                if common_admet
                else unavailable_admet_prediction(
                    standardized.canonical_smiles,
                    prediction_status="not_run_invalid_molecule",
                    warning="ADMET prediction skipped for invalid molecule.",
                )
            )
            admet_model_status = "not_run_invalid_molecule"
            admet_warning = "ADMET prediction skipped for invalid molecule."
        elif not use_legacy_adapters:
            admet_prediction = common_admet["classification"]
            admet_model_status = "model_available" if common_admet["status"] == "success" else str(common_admet["status"])
            admet_warning = str(common_admet.get("warning") or "")
        elif active_admet_predictor is None:
            admet_prediction = unavailable_admet_prediction(
                standardized.canonical_smiles,
                prediction_status="model_unavailable",
                warning=admet_load_warning,
            )
            admet_model_status = "model_unavailable"
            admet_warning = admet_load_warning
        else:
            try:
                admet_prediction = active_admet_predictor.predict(
                    standardized.canonical_smiles
                )
                admet_model_status = "model_available"
                admet_warning = ""
            except Exception as exc:
                admet_warning = f"Frozen ADMET prediction unavailable: {exc}"
                admet_prediction = unavailable_admet_prediction(
                    standardized.canonical_smiles,
                    prediction_status="model_unavailable",
                    warning=admet_warning,
                )
                admet_model_status = "model_unavailable"
        synthetic_accessibility = heuristic_synthetic_accessibility(
            standardized.canonical_smiles,
            standardized.valid_molecule,
        )
        if enable_docking:
            if standardized.valid_molecule and standardized.canonical_smiles:
                docking_execution = docking_by_index[prepared_index]
            else:
                docking_execution = unavailable_docking_result(
                    str(molecule_id), standardized.canonical_smiles,
                    status="not_run_invalid_molecule",
                    warning="Docking skipped for invalid molecule.",
                    receptor=receptor, config=docking_config,
                )
            docking = DockingResult(
                docking_score=docking_execution.get("best_affinity_kcal_mol"),
                docking_status=(
                    "provided" if docking_execution.get("status") == "success"
                    else str(docking_execution.get("status"))
                ),
            )
        else:
            docking = parse_precomputed_docking_score(record)
            docking_execution = {
                "molecule_id": str(molecule_id),
                "canonical_smiles": standardized.canonical_smiles,
                "status": "precomputed" if docking.docking_status == "provided" else "not_requested",
                "best_affinity_kcal_mol": docking.docking_score,
                "warning": "",
            }
        identity_match = check_known_compound_identity(
            standardized.canonical_smiles,
            standardized.valid_molecule,
        )
        similarity_match = find_closest_known_compound(
            standardized.canonical_smiles,
            standardized.valid_molecule,
        )
        public_identity_match = (
            active_public_lookup_client.lookup_exact_identity(
                standardized.canonical_smiles,
                standardized.valid_molecule,
            )
            if pubchem_lookup_enabled
            else not_requested_result()
        )
        chembl_bioactivity_match = (
            active_chembl_lookup_client.lookup_bioactivity_context(
                standardized.canonical_smiles,
                standardized.valid_molecule,
            )
            if enable_chembl_lookup
            else chembl_not_requested_result()
        )
        patent_context_match = (
            active_patent_lookup_client.lookup_patent_context(
                standardized.canonical_smiles,
                standardized.valid_molecule,
                pubchem_cid=public_identity_match.pubchem_cid,
                chembl_molecule_id=(
                    chembl_bioactivity_match.chembl_molecule_id
                    or chembl_bioactivity_match.chembl_similarity_molecule_id
                ),
            )
            if enable_patent_lookup
            else patent_not_requested_result()
        )
        structural_alerts = screen_structural_alerts(
            standardized.canonical_smiles,
            standardized.valid_molecule,
        )

        priority_record = build_priority_record(
            molecule_id=molecule_id,
            input_smiles=input_smiles,
            canonical_smiles=standardized.canonical_smiles,
            valid_molecule=standardized.valid_molecule,
            descriptors=descriptors,
            bbb_prediction=bbb_prediction,
            synthetic_accessibility=synthetic_accessibility,
            docking=docking,
            identity_match=identity_match,
            similarity_match=similarity_match,
            public_identity_match=public_identity_match,
            chembl_bioactivity_match=chembl_bioactivity_match,
            patent_context_match=patent_context_match,
            structural_alerts=structural_alerts,
            error=standardized.error,
        )
        priority_record.update(
            {
                "admet_model_status": admet_model_status,
                "admet_warning": admet_warning,
                "admet_predictions": admet_prediction["endpoints"],
                "bbb_result": common_admet["bbb"] if common_admet else {},
                "admet_regression": common_admet["regression"] if common_admet else {},
                "admet_family_status": common_admet["family_status"] if common_admet else {},
                "docking_result": docking_execution,
            }
        )
        ranked_records.append(priority_record)

    docking_scored_records = add_docking_informed_scores(ranked_records)
    scientifically_ranked_records = finalize_scientific_prioritization(docking_scored_records)
    if progress_callback:
        progress_callback(
            stage="prioritization",
            processed_count=len(prepared_records),
            valid_count=valid_count,
            invalid_count=invalid_count,
            admet_success_count=admet_successes,
            admet_failure_count=admet_failures,
            eligible_count=sum(row.get("valid_molecule") is True for row in scientifically_ranked_records),
            fully_scored_count=sum(row.get("prioritization_status") == "fully_scored" for row in scientifically_ranked_records),
            partially_scored_count=sum(row.get("prioritization_status") == "partially_scored" for row in scientifically_ranked_records),
            unscorable_count=sum(row.get("prioritization_status") == "unscorable" for row in scientifically_ranked_records),
            ranked_count=sum(row.get("scientific_rank") is not None for row in scientifically_ranked_records),
            eligible_for_ranking_count=sum(row.get("rank_eligible") is True for row in scientifically_ranked_records),
            awaiting_or_missing_docking_count=sum(row.get("prioritization_status") == "awaiting_docking" for row in scientifically_ranked_records),
            docking_failed_or_unavailable_count=sum(row.get("prioritization_status") in {"docking_failed", "docking_unavailable"} for row in scientifically_ranked_records),
        )
    diversity_records = add_diversity_analysis(scientifically_ranked_records)

    if enable_target_reference_discovery:
        reference_set = active_target_reference_client.discover_references(
            target_context_from_mapping(target_context)
        )
        target_records, reference_points = add_target_reference_analysis(diversity_records, reference_set)
        resynthesized_records = [_resynthesize_evidence(row) for row in target_records]
        setattr(
            prioritize_smiles,
            "latest_target_reference_metadata",
            target_reference_metadata(reference_set, reference_points),
        )
        return resynthesized_records

    for row in diversity_records:
        row.update(empty_target_reference_fields())
    setattr(prioritize_smiles, "latest_target_reference_metadata", target_reference_metadata(None))
    return diversity_records


def prioritize_csv(
    input_path: str | Path,
    output_path: str | Path,
    *,
    enable_public_lookup: bool = False,
    enable_pubchem_lookup: bool | None = None,
    enable_chembl_lookup: bool = False,
    enable_patent_lookup: bool = False,
    enable_target_reference_discovery: bool = False,
    target_context: dict[str, object] | None = None,
    target_reference_output_path: str | Path | None = None,
    progress_callback: Callable[..., None] | None = None,
    enable_docking: bool = False,
    receptor: ReceptorArtifact | None = None,
    docking_config: VinaBoxConfig | None = None,
    docking_engine: object | None = None,
    docking_output_root: str | Path | None = None,
    docking_setup_error: str = "",
) -> list[dict[str, object]]:
    """Read molecule records from CSV, write ranked results, and return rows."""

    input_file = Path(input_path)
    output_file = Path(output_path)

    with input_file.open(newline="", encoding="utf-8") as handle:
        records = list(csv.DictReader(handle))

    ranked_records = prioritize_smiles(
        records,
        enable_public_lookup=enable_public_lookup,
        enable_pubchem_lookup=enable_pubchem_lookup,
        enable_chembl_lookup=enable_chembl_lookup,
        enable_patent_lookup=enable_patent_lookup,
        enable_target_reference_discovery=enable_target_reference_discovery,
        target_context=target_context,
        progress_callback=progress_callback,
        enable_docking=enable_docking,
        receptor=receptor,
        docking_config=docking_config,
        docking_engine=docking_engine,
        docking_output_root=docking_output_root,
        docking_setup_error=docking_setup_error,
    )
    reference_metadata = getattr(
        prioritize_smiles,
        "latest_target_reference_metadata",
        target_reference_metadata(None),
    )
    output_file.parent.mkdir(parents=True, exist_ok=True)

    if ranked_records:
        fieldnames = list(ranked_records[0].keys())
    else:
        fieldnames = [
            "molecule_id",
            "input_smiles",
            "canonical_smiles",
            "valid_molecule",
            "priority_score",
            "scientific_ranking_score",
            "scientific_rank",
            "rank_eligible",
            "prioritization_status",
            "ranking_version",
            "prioritization",
            "error",
            "known_compound_match",
            "known_compound_name",
            "known_compound_source",
            "known_compound_id",
            "identity_check_status",
            "closest_known_compound_name",
            "closest_known_compound_id",
            "closest_known_compound_similarity",
            "closest_known_compound_source",
            "similarity_check_status",
            "pubchem_exact_match",
            "pubchem_cid",
            "pubchem_preferred_name",
            "pubchem_lookup_status",
            "pubchem_cache_status",
            "pubchem_warning",
            "chembl_exact_match",
            "chembl_molecule_id",
            "chembl_pref_name",
            "chembl_lookup_status",
            "chembl_cache_status",
            "chembl_warning",
            "chembl_activity_count",
            "chembl_target_count",
            "chembl_target_summary",
            "chembl_similarity_match",
            "chembl_similarity_score",
            "chembl_similarity_molecule_id",
            "chembl_similarity_pref_name",
            "chembl_similarity_status",
            "patent_lookup_status",
            "patent_cache_status",
            "patent_public_evidence_match",
            "patent_source",
            "patent_record_count",
            "patent_top_record_id",
            "patent_top_record_title",
            "patent_top_record_url",
            "patent_query_identifier",
            "patent_warning",
            "evidence_summary_category",
            "evidence_summary_notes",
            "public_identity_signal",
            "public_bioactivity_signal",
            "patent_context_signal",
            "local_similarity_signal",
            "biopharma_context_level",
            "recommended_review_focus",
            *STRUCTURAL_ALERT_COLUMNS,
            *TARGET_REFERENCE_COLUMNS,
            *DIVERSITY_COLUMNS,
            *CHEMICAL_SPACE_COLUMNS,
            "docking_score",
            "docking_status",
            "docking_result",
            *DOCKING_INFORMED_COLUMNS,
            "sa_score",
            "synthetic_feasibility_category",
            "synthetic_feasibility_status",
            "bbb_prediction",
            "bbb_probability",
            "bbb_model_status",
            "bbb_warning",
            "admet_model_status",
            "admet_warning",
            "admet_predictions",
            "mw",
            "tpsa",
            "hba",
            "hbd",
            "rotatable_bonds",
            "qed",
            "lipinski_violations",
            "lipinski_pass",
        ]

    with output_file.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(
            {
                key: json.dumps(value, separators=(",", ":"))
                if isinstance(value, (dict, list))
                else value
                for key, value in row.items()
            }
            for row in ranked_records
        )

    if target_reference_output_path is not None:
        reference_output = Path(target_reference_output_path)
        reference_output.parent.mkdir(parents=True, exist_ok=True)
        with reference_output.open("w", encoding="utf-8") as handle:
            json.dump(reference_metadata, handle, indent=2, sort_keys=True)
            handle.write("\n")

    return ranked_records


def _resynthesize_evidence(row: dict[str, object]) -> dict[str, object]:
    synthesis = synthesize_evidence(row)
    updated = {**row}
    updated.update(synthesis)
    return updated


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run MolOptima Phase 1 prioritization.")
    parser.add_argument("--input", required=True, help="CSV with molecule_id and smiles columns.")
    parser.add_argument("--output", required=True, help="Output ranked CSV path.")
    parser.add_argument(
        "--enable-public-lookup",
        action="store_true",
        help="Opt in to PubChem exact identity lookup with local caching.",
    )
    parser.add_argument(
        "--enable-pubchem-lookup",
        action="store_true",
        help="Opt in to PubChem exact identity lookup with local caching.",
    )
    parser.add_argument(
        "--enable-chembl-lookup",
        action="store_true",
        help="Opt in to ChEMBL public bioactivity lookup with local caching.",
    )
    parser.add_argument(
        "--enable-patent-lookup",
        action="store_true",
        help="Opt in to SureChEMBL public patent-context lookup with local caching.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    ranked_records = prioritize_csv(
        args.input,
        args.output,
        enable_public_lookup=args.enable_public_lookup,
        enable_pubchem_lookup=args.enable_pubchem_lookup or args.enable_public_lookup,
        enable_chembl_lookup=args.enable_chembl_lookup,
        enable_patent_lookup=args.enable_patent_lookup,
    )
    warnings = sorted(
        {
            str(row["bbb_warning"])
            for row in ranked_records
            if str(row.get("bbb_warning", "")).strip()
            and row.get("bbb_model_status") == "model_unavailable"
        }
    )
    for warning in warnings:
        print(f"Warning: {warning}")
    print(f"Wrote {len(ranked_records)} ranked molecules to {args.output}")


if __name__ == "__main__":
    main()
