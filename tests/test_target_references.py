import csv
from pathlib import Path

from biopharma_intelligence.target_references import (
    TargetContext,
    TargetReference,
    TargetReferenceClient,
    TargetReferenceSet,
    add_target_reference_analysis,
    load_local_target_references,
)
from molecular_prioritization.pipeline import prioritize_smiles


def reference(
    *,
    reference_id="REF1",
    compound_name="Active Ref",
    smiles="CCO",
    activity_class="active",
    mechanism_class="PAM",
):
    return TargetReference(
        reference_id=reference_id,
        target_name="alpha7 nicotinic acetylcholine receptor",
        target_gene_symbol="CHRNA7",
        target_chembl_id="CHEMBL123",
        compound_name=compound_name,
        smiles=smiles,
        canonical_smiles=smiles,
        activity_class=activity_class,
        activity_type="IC50",
        activity_value="7.1",
        activity_units="pChEMBL",
        mechanism_class=mechanism_class,
        reference_source="local_curated",
    )


class FakeTargetReferenceClient:
    def __init__(self, reference_set):
        self.reference_set = reference_set
        self.calls = []

    def discover_references(self, context):
        self.calls.append(context)
        return self.reference_set


def reference_set(*references, lookup_status="references_found", source="local_curated"):
    return TargetReferenceSet(
        enabled=True,
        lookup_status=lookup_status,
        cache_status="fresh_lookup",
        source=source,
        resolved_target_chembl_id="CHEMBL123",
        resolved_target_name="alpha7 nicotinic acetylcholine receptor",
        warning="",
        references=list(references),
    )


def write_local_reference_file(path: Path):
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "reference_id",
                "target_name",
                "target_gene_symbol",
                "target_chembl_id",
                "compound_name",
                "smiles",
                "activity_class",
                "activity_type",
                "activity_value",
                "activity_units",
                "mechanism_class",
                "reference_source",
                "notes",
            ],
        )
        writer.writeheader()
        writer.writerow(
            {
                "reference_id": "LOCAL1",
                "target_name": "alpha7 nicotinic acetylcholine receptor",
                "target_gene_symbol": "CHRNA7",
                "target_chembl_id": "CHEMBL123",
                "compound_name": "Local Active",
                "smiles": "CCO",
                "activity_class": "active",
                "activity_type": "IC50",
                "activity_value": "12",
                "activity_units": "nM",
                "mechanism_class": "PAM",
                "reference_source": "local_curated",
                "notes": "fixture",
            }
        )


def test_local_curated_reference_file_loading(tmp_path):
    reference_file = tmp_path / "target_active_references.csv"
    write_local_reference_file(reference_file)

    references = load_local_target_references(
        TargetContext(target_gene_symbol="CHRNA7"),
        reference_file,
    )

    assert len(references) == 1
    assert references[0].reference_id == "LOCAL1"
    assert references[0].compound_name == "Local Active"


def test_target_reference_cache_hit(tmp_path):
    client = TargetReferenceClient(cache_dir=tmp_path, local_reference_file=tmp_path / "empty.csv")
    context = TargetContext(target_gene_symbol="CHRNA7")
    expected = reference_set(reference())

    client._write_cache('{"target_gene_symbol":"CHRNA7"}', expected)
    cached = client._read_cache('{"target_gene_symbol":"CHRNA7"}')

    assert cached is not None


def test_generated_molecule_near_known_active():
    rows = [{"molecule_id": "mol1", "canonical_smiles": "CCO", "valid_molecule": True}]

    analyzed, reference_points = add_target_reference_analysis(rows, reference_set(reference()))

    assert analyzed[0]["active_neighborhood_signal"] == "near_known_active_space"
    assert analyzed[0]["nearest_active_compound_name"] == "Active Ref"
    assert reference_points[0]["point_type"] == "target_reference"


def test_generated_molecule_far_from_known_active():
    rows = [{"molecule_id": "mol1", "canonical_smiles": "c1ccccc1", "valid_molecule": True}]

    analyzed, _reference_points = add_target_reference_analysis(rows, reference_set(reference(smiles="CCCCCCCC")))

    assert analyzed[0]["active_neighborhood_signal"] == "distant_from_known_actives"


def test_no_references_available():
    rows = [{"molecule_id": "mol1", "canonical_smiles": "CCO", "valid_molecule": True}]

    analyzed, reference_points = add_target_reference_analysis(rows, reference_set())

    assert analyzed[0]["active_neighborhood_signal"] == "no_reference_actives_available"
    assert reference_points == []


def test_invalid_molecule_skipped():
    rows = [{"molecule_id": "bad", "canonical_smiles": None, "valid_molecule": False}]

    analyzed, _reference_points = add_target_reference_analysis(rows, reference_set(reference()))

    assert analyzed[0]["target_reference_status"] == "not_run_invalid_molecule"
    assert analyzed[0]["active_neighborhood_signal"] == "not_run_invalid_molecule"


def test_chembl_failure_handled_gracefully():
    rows = [{"molecule_id": "mol1", "canonical_smiles": "CCO", "valid_molecule": True}]
    failed_set = reference_set(lookup_status="lookup_failed", source="none")

    analyzed, _reference_points = add_target_reference_analysis(rows, failed_set)

    assert analyzed[0]["active_neighborhood_signal"] == "target_reference_lookup_failed"


def test_pipeline_output_includes_target_reference_columns():
    target_client = FakeTargetReferenceClient(reference_set(reference()))

    rows = prioritize_smiles(
        [{"molecule_id": "mol1", "smiles": "CCO"}],
        enable_target_reference_discovery=True,
        target_context={"target_gene_symbol": "CHRNA7"},
        target_reference_client=target_client,
    )

    assert target_client.calls[0].target_gene_symbol == "CHRNA7"
    assert rows[0]["nearest_active_reference_id"] == "REF1"
    assert rows[0]["active_neighborhood_signal"] == "near_known_active_space"
    assert rows[0]["chemical_space_status"] == "projected_with_target_references"
    assert "Target-reference signal" in rows[0]["evidence_summary_notes"]


def test_pipeline_default_target_reference_not_requested():
    rows = prioritize_smiles([{"molecule_id": "mol1", "smiles": "CCO"}])

    assert rows[0]["target_reference_status"] == "not_requested"
    assert rows[0]["active_neighborhood_signal"] == "not_requested"
