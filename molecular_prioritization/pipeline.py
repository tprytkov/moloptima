"""Small end-to-end prioritization pipeline."""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

from molecular_prioritization.bbb_predictor import load_bbb_predictor
from molecular_prioritization.descriptors import calculate_descriptors
from molecular_prioritization.prioritization import build_priority_record
from molecular_prioritization.standardize import standardize_smiles
from molecular_prioritization.synthetic_accessibility import heuristic_synthetic_accessibility


def prioritize_smiles(
    records: list[dict[str, str]],
    *,
    bbb_predictor: object | None = None,
) -> list[dict[str, object]]:
    """Prioritize molecule records with molecule_id and smiles fields."""

    active_bbb_predictor = bbb_predictor or load_bbb_predictor()
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

        ranked_records.append(
            build_priority_record(
                molecule_id=molecule_id,
                input_smiles=input_smiles,
                canonical_smiles=standardized.canonical_smiles,
                valid_molecule=standardized.valid_molecule,
                descriptors=descriptors,
                bbb_prediction=bbb_prediction,
                synthetic_accessibility=synthetic_accessibility,
                error=standardized.error,
            )
        )

    return sorted(
        ranked_records,
        key=lambda row: float(row["priority_score"]),
        reverse=True,
    )


def prioritize_csv(input_path: str | Path, output_path: str | Path) -> list[dict[str, object]]:
    """Read molecule records from CSV, write ranked results, and return rows."""

    input_file = Path(input_path)
    output_file = Path(output_path)

    with input_file.open(newline="", encoding="utf-8") as handle:
        records = list(csv.DictReader(handle))

    ranked_records = prioritize_smiles(records)
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
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    ranked_records = prioritize_csv(args.input, args.output)
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
