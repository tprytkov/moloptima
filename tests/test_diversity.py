from molecular_prioritization.diversity import add_diversity_analysis


def base_row(molecule_id, smiles, priority_score=0.5, valid_molecule=True):
    return {
        "molecule_id": molecule_id,
        "input_smiles": smiles,
        "canonical_smiles": smiles if valid_molecule else None,
        "valid_molecule": valid_molecule,
        "priority_score": priority_score,
    }


def test_diversity_analysis_adds_clusters_and_nearest_neighbors_for_valid_molecules():
    rows = [
        base_row("ethanol", "CCO", 0.7),
        base_row("propanol", "CCCO", 0.6),
        base_row("benzene", "c1ccccc1", 0.8),
    ]

    analyzed = add_diversity_analysis(rows, similarity_threshold=0.2)

    assert all(row["diversity_status"] == "clustered" for row in analyzed)
    assert all(row["diversity_cluster_id"] is not None for row in analyzed)
    assert all(row["nearest_neighbor_molecule_id"] for row in analyzed)
    assert all(row["nearest_neighbor_similarity"] is not None for row in analyzed)


def test_identical_molecules_group_together_with_one_representative():
    rows = [
        base_row("duplicate_low", "CCO", 0.4),
        base_row("duplicate_high", "CCO", 0.9),
        base_row("benzene", "c1ccccc1", 0.6),
    ]

    analyzed = add_diversity_analysis(rows)
    duplicate_rows = [row for row in analyzed if row["canonical_smiles"] == "CCO"]

    assert duplicate_rows[0]["diversity_cluster_id"] == duplicate_rows[1]["diversity_cluster_id"]
    assert duplicate_rows[0]["diversity_cluster_size"] == 2
    assert sum(row["diversity_representative"] for row in duplicate_rows) == 1
    assert next(row for row in duplicate_rows if row["diversity_representative"])["molecule_id"] == "duplicate_high"


def test_invalid_molecule_receives_not_run_status():
    analyzed = add_diversity_analysis([base_row("invalid", "C1CC", valid_molecule=False)])

    assert analyzed[0]["diversity_status"] == "not_run_invalid_molecule"
    assert analyzed[0]["diversity_cluster_id"] is None
    assert analyzed[0]["diversity_representative"] is False
    assert analyzed[0]["nearest_neighbor_similarity"] is None


def test_diversity_cluster_assignment_is_deterministic():
    rows = [
        base_row("ethanol", "CCO", 0.7),
        base_row("propanol", "CCCO", 0.6),
        base_row("benzene", "c1ccccc1", 0.8),
    ]

    first = add_diversity_analysis(rows)
    second = add_diversity_analysis(rows)

    assert [
        (
            row["molecule_id"],
            row["diversity_cluster_id"],
            row["diversity_representative"],
            row["nearest_neighbor_molecule_id"],
            row["nearest_neighbor_similarity"],
        )
        for row in first
    ] == [
        (
            row["molecule_id"],
            row["diversity_cluster_id"],
            row["diversity_representative"],
            row["nearest_neighbor_molecule_id"],
            row["nearest_neighbor_similarity"],
        )
        for row in second
    ]
