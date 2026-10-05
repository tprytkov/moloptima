import csv
import io

import pytest

from molecular_prioritization.experimental_measurements import (
    normalize_concentration,
    parse_experimental_delimited,
)


MOLECULES = [
    {
        "molecule_id": "stereo_r",
        "input_smiles": "N[C@@H](C)C(=O)O",
        "canonical_smiles": "C[C@H](N)C(=O)O",
        "validation_status": "valid",
    },
    {
        "molecule_id": "ethanol_a",
        "input_smiles": "CCO",
        "canonical_smiles": "CCO",
        "validation_status": "valid",
    },
    {
        "molecule_id": "ethanol_b",
        "input_smiles": "CCO",
        "canonical_smiles": "CCO",
        "validation_status": "valid",
    },
]


def assay_csv(rows):
    fields = [
        "molecule_id", "smiles", "endpoint", "value", "unit", "relation",
        "target", "organism", "assay_id", "assay_type", "assay_system",
        "biological_mode", "source", "source_record_id", "replicate_id",
        "replicate_type", "replicate_count", "uncertainty_type", "uncertainty_value",
    ]
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    return buffer.getvalue().encode()


def base_row(**overrides):
    row = {
        "molecule_id": "stereo_r", "smiles": "N[C@@H](C)C(=O)O",
        "endpoint": "IC50", "value": "10", "unit": "nM", "relation": "=",
        "target": "Example kinase", "organism": "Homo sapiens", "assay_id": "A-1",
        "assay_type": "binding", "assay_system": "biochemical", "biological_mode": "inhibition",
        "source": "synthetic-demo", "source_record_id": "row-1", "replicate_id": "tech-1",
        "replicate_type": "technical", "replicate_count": "2", "uncertainty_type": "SD",
        "uncertainty_value": "0.2",
    }
    row.update(overrides)
    return row


@pytest.mark.parametrize(
    ("value", "unit", "relation", "molar", "transformed", "transformed_relation"),
    [
        ("10", "nM", "=", 1e-8, 8.0, "="),
        ("10", "uM", "=", 1e-5, 5.0, "="),
        ("10", "uM", ">", 1e-5, 5.0, "<"),
        ("10", "nM", "<", 1e-8, 8.0, ">"),
        ("10", "uM", ">=", 1e-5, 5.0, "<="),
    ],
)
def test_concentration_normalization_and_censoring(
    value, unit, relation, molar, transformed, transformed_relation,
):
    result = normalize_concentration("IC50", value, unit, relation)
    assert result["status"] == "normalized"
    assert result["normalized_value_molar"] == pytest.approx(molar)
    assert result["transformed_value"] == pytest.approx(transformed)
    assert result["transformed_endpoint"] == "pIC50"
    assert result["transformed_relation"] == transformed_relation


def test_nonpositive_and_unsupported_units_are_rejected():
    assert normalize_concentration("IC50", 0, "nM", "=")["reason"] == "concentration_must_be_positive"
    assert normalize_concentration("IC50", -2, "nM", "=")["reason"] == "concentration_must_be_positive"
    assert normalize_concentration("IC50", 2, "mg/mL", "=")["reason"] == "unsupported_unit_conversion"


def test_endpoint_types_remain_distinct():
    assert normalize_concentration("IC50", 10, "nM", "=")["transformed_endpoint"] == "pIC50"
    assert normalize_concentration("EC50", 10, "nM", "=")["transformed_endpoint"] == "pEC50"
    assert normalize_concentration("Ki", 10, "nM", "=")["transformed_endpoint"] == "pKi"
    assert normalize_concentration("Kd", 10, "nM", "=")["transformed_endpoint"] == "pKd"


def test_percentage_is_preserved_without_pactivity():
    parsed = parse_experimental_delimited(
        assay_csv([base_row(endpoint="percent inhibition", unit="%", value="42")]),
        "assays.csv", MOLECULES,
    )
    record = parsed["measurements"][0]
    assert record["endpoint_kind"] == "percentage"
    assert record["normalization"]["status"] == "not_applicable"
    assert "transformed_value" not in record["normalization"]
    assert record["original_value"] == 42.0


def test_source_uncertainty_replicate_and_stereo_identity_are_preserved():
    parsed = parse_experimental_delimited(assay_csv([base_row()]), "assays.csv", MOLECULES)
    record = parsed["measurements"][0]
    assert record["source"] == "synthetic-demo"
    assert record["source_record_id"] == "row-1"
    assert record["optional_metadata"]["replicate_id"] == "tech-1"
    assert record["optional_metadata"]["replicate_type"] == "technical"
    assert record["replicate_count"] == 2
    assert record["uncertainty"] == {
        "type": "sd", "value": 0.2, "lower": None, "upper": None,
        "confidence_level": None, "scale": "unknown", "replicate_count": 2,
    }
    assert "@" in record["structure_identity"]["canonical_isomeric_smiles"]
    assert record["linkage"]["status"] == "linked"


def test_linkage_is_deterministic_and_ambiguous_structure_is_not_resolved():
    exact = parse_experimental_delimited(assay_csv([base_row()]), "assays.csv", MOLECULES)
    again = parse_experimental_delimited(assay_csv([base_row()]), "assays.csv", MOLECULES)
    assert exact["measurements"][0]["measurement_id"] == again["measurements"][0]["measurement_id"]

    ambiguous = parse_experimental_delimited(
        assay_csv([base_row(molecule_id="", smiles="CCO")]), "assays.csv", MOLECULES,
    )["measurements"][0]
    assert ambiguous["linkage"]["status"] == "ambiguous"
    assert ambiguous["validation_status"] == "invalid"
    assert sorted(ambiguous["linkage"]["candidate_molecule_ids"]) == ["ethanol_a", "ethanol_b"]


def test_unmatched_and_unsupported_endpoint_remain_explicit():
    rows = [
        base_row(molecule_id="missing", source_record_id="missing"),
        base_row(endpoint="GI50", source_record_id="unsupported"),
    ]
    parsed = parse_experimental_delimited(assay_csv(rows), "assays.csv", MOLECULES)
    assert parsed["summary"]["unmatched_molecules"] == 1
    assert parsed["summary"]["unsupported_endpoint_types"] == ["GI50"]
    assert parsed["measurements"][1]["normalization"]["status"] == "not_applicable"


def test_duplicate_source_records_are_flagged_without_collapsing_rows():
    rows = [base_row(value="10"), base_row(value="20")]
    parsed = parse_experimental_delimited(assay_csv(rows), "assays.csv", MOLECULES)
    assert len(parsed["measurements"]) == 2
    for record in parsed["measurements"]:
        assert "potential_repeat_citation" in record["quality_flags"]
        assert "duplicate_conflicting_measurements" in record["quality_flags"]
