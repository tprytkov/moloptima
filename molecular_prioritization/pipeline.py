"""Small end-to-end prioritization pipeline."""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

from biopharma_intelligence.identity import check_known_compound_identity
from biopharma_intelligence.public_lookup import PubChemClient, not_requested_result
from biopharma_intelligence.similarity import find_closest_known_compound
from molecular_prioritization.bbb_predictor import load_bbb_predictor
from molecular_prioritization.descriptors import calculate_descriptors
from molecular_prioritization.docking import parse_precomputed_docking_score
from molecular_prioritization.prioritization import build_priority_record
from molecular_prioritization.standardize import standardize_smiles
from molecular_prioritization.synthetic_accessibility import heuristic_synthetic_accessibility


def prioritize_smiles(
    records: list[dict[str, str]],
    *,
    bbb_predictor: object | None = None,
    enable_public_lookup: bool = False,
    public_lookup_client: object | None = None,
) -> list[dict[str, object]]:
    """Prioritize molecule records with molecule_id and smiles fields."""

    active_bbb_predictor = bbb_predictor or load_bbb_predictor()
    active_public_lookup_client = public_lookup_client or PubChemClient()
    ranked_records: list[dict[str, object]] = []

    for index, record in enumerate(records, start=1):
        molecule_id = record.get("molecule_id") or f"mol_{index}"
        input_smiles = record.get("smiles", "")
        standardized = standardize_smiles(input_smiles)
        descriptors = (
            calculate_descriptors(standardized.canonical_smiles)
            if standardized.canonical_smiles
            else None
        )
        bbb_prediction = active_bbb_predictor.predict(
            standardized.canonical_smiles,
            standardized.valid_molecule,
        )
        synthetic_accessibility = heuristic_synthetic_accessibility(
            standardized.canonical_smiles,
            standardized.valid_molecule,
        )
        docking = parse_precomputed_docking_score(record)
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
            if enable_public_lookup
            else not_requested_result()
        )

        ranked_records.append(
            build_priority_record(
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
                error=standardized.error,
            )
        )

    return sorted(
        ranked_records,
        key=lambda row: float(row["priority_score"]),
        reverse=True,
    )


def prioritize_csv(
    input_path: str | Path,
    output_path: str | Path,
    *,
    enable_public_lookup: bool = False,
) -> list[dict[str, object]]:
    """Read molecule records from CSV, write ranked results, and return rows."""

    input_file = Path(input_path)
    output_file = Path(output_path)

    with input_file.open(newline="", encoding="utf-8") as handle:
        records = list(csv.DictReader(handle))

    ranked_records = prioritize_smiles(records, enable_public_lookup=enable_public_lookup)
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
            "docking_score",
            "docking_status",
            "sa_score",
            "synthetic_feasibility_category",
            "synthetic_feasibility_status",
            "bbb_prediction",
            "bbb_probability",
            "bbb_model_status",
            "bbb_warning",
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
        writer.writerows(ranked_records)

    return ranked_records


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run MolOptima Phase 1 prioritization.")
    parser.add_argument("--input", required=True, help="CSV with molecule_id and smiles columns.")
    parser.add_argument("--output", required=True, help="Output ranked CSV path.")
    parser.add_argument(
        "--enable-public-lookup",
        action="store_true",
        help="Opt in to PubChem exact identity lookup with local caching.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    ranked_records = prioritize_csv(
        args.input,
        args.output,
        enable_public_lookup=args.enable_public_lookup,
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
