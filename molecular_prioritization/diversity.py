"""Chemical diversity analysis for prioritized molecule rows."""

from __future__ import annotations

import numpy as np
from rdkit import Chem, DataStructs
from rdkit.Chem import AllChem
from rdkit.ML.Cluster import Butina


DIVERSITY_COLUMNS = [
    "diversity_cluster_id",
    "diversity_cluster_size",
    "diversity_representative",
    "nearest_neighbor_molecule_id",
    "nearest_neighbor_similarity",
    "diversity_status",
]
CHEMICAL_SPACE_COLUMNS = [
    "chemical_space_x",
    "chemical_space_y",
    "chemical_space_status",
    "chemical_space_method",
    "chemical_space_warning",
]
CHEMICAL_SPACE_METHOD = "morgan_fingerprint_pca"


def add_diversity_analysis(
    rows: list[dict[str, object]],
    *,
    similarity_threshold: float = 0.7,
) -> list[dict[str, object]]:
    """Annotate prioritized rows with deterministic Morgan-fingerprint diversity fields."""

    annotated_rows = [{**row} for row in rows]
    valid_items = []

    for index, row in enumerate(annotated_rows):
        smiles = str(row.get("canonical_smiles") or row.get("input_smiles") or "").strip()
        if row.get("valid_molecule") is not True or not smiles:
            row.update(_invalid_diversity_fields())
            row.update(_invalid_chemical_space_fields())
            continue

        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            row.update(_invalid_diversity_fields())
            row.update(_invalid_chemical_space_fields())
            continue

        fingerprint = AllChem.GetMorganFingerprintAsBitVect(mol, radius=2, nBits=2048)
        valid_items.append((index, fingerprint))

    if not valid_items:
        return annotated_rows

    _add_chemical_space_coordinates(valid_items, annotated_rows)
    nearest_neighbors = _nearest_neighbors(valid_items, annotated_rows)
    clusters = _butina_clusters(valid_items, similarity_threshold=similarity_threshold)
    sorted_clusters = sorted(
        clusters,
        key=lambda cluster: _representative_sort_key(cluster, annotated_rows),
    )

    for cluster_id, cluster in enumerate(sorted_clusters, start=1):
        representative_index = _representative_index(cluster, annotated_rows)
        cluster_size = len(cluster)
        for row_index in cluster:
            nearest_id, nearest_similarity = nearest_neighbors.get(row_index, (None, None))
            annotated_rows[row_index].update(
                {
                    "diversity_cluster_id": cluster_id,
                    "diversity_cluster_size": cluster_size,
                    "diversity_representative": row_index == representative_index,
                    "nearest_neighbor_molecule_id": nearest_id,
                    "nearest_neighbor_similarity": nearest_similarity,
                    "diversity_status": "clustered",
                }
            )

    return annotated_rows


def _invalid_diversity_fields() -> dict[str, object]:
    return {
        "diversity_cluster_id": None,
        "diversity_cluster_size": None,
        "diversity_representative": False,
        "nearest_neighbor_molecule_id": None,
        "nearest_neighbor_similarity": None,
        "diversity_status": "not_run_invalid_molecule",
    }


def _invalid_chemical_space_fields() -> dict[str, object]:
    return {
        "chemical_space_x": None,
        "chemical_space_y": None,
        "chemical_space_status": "not_run_invalid_molecule",
        "chemical_space_method": CHEMICAL_SPACE_METHOD,
        "chemical_space_warning": "Chemical-space projection skipped for invalid molecule.",
    }


def _add_chemical_space_coordinates(
    valid_items: list[tuple[int, object]],
    rows: list[dict[str, object]],
) -> None:
    if len(valid_items) == 1:
        row_index, _fingerprint = valid_items[0]
        rows[row_index].update(
            {
                "chemical_space_x": 0.0,
                "chemical_space_y": 0.0,
                "chemical_space_status": "projected",
                "chemical_space_method": CHEMICAL_SPACE_METHOD,
                "chemical_space_warning": "Only one valid molecule available; point placed at origin.",
            }
        )
        return

    matrix = np.vstack([_fingerprint_array(fingerprint) for _, fingerprint in valid_items])
    centered = matrix - matrix.mean(axis=0)
    _u, singular_values, vt = np.linalg.svd(centered, full_matrices=False)
    components = vt[:2]
    coordinates = centered @ components.T
    if coordinates.shape[1] == 1:
        coordinates = np.column_stack([coordinates[:, 0], np.zeros(coordinates.shape[0])])

    for coordinate_index, (row_index, _fingerprint) in enumerate(valid_items):
        x_value = float(coordinates[coordinate_index, 0])
        y_value = float(coordinates[coordinate_index, 1]) if coordinates.shape[1] > 1 else 0.0
        rows[row_index].update(
            {
                "chemical_space_x": round(x_value, 6),
                "chemical_space_y": round(y_value, 6),
                "chemical_space_status": "projected",
                "chemical_space_method": CHEMICAL_SPACE_METHOD,
                "chemical_space_warning": "",
            }
        )


def _fingerprint_array(fingerprint: object) -> np.ndarray:
    array = np.zeros((2048,), dtype=float)
    DataStructs.ConvertToNumpyArray(fingerprint, array)
    return array


def _nearest_neighbors(
    valid_items: list[tuple[int, object]],
    rows: list[dict[str, object]],
) -> dict[int, tuple[str | None, float | None]]:
    neighbors: dict[int, tuple[str | None, float | None]] = {}

    for row_index, fingerprint in valid_items:
        best_index = None
        best_similarity = -1.0
        for other_index, other_fingerprint in valid_items:
            if row_index == other_index:
                continue
            similarity = DataStructs.TanimotoSimilarity(fingerprint, other_fingerprint)
            is_better_similarity = similarity > best_similarity
            is_tie_with_lower_label = (
                similarity == best_similarity
                and best_index is not None
                and _row_label(rows[other_index]) < _row_label(rows[best_index])
            )
            if best_index is None or is_better_similarity or is_tie_with_lower_label:
                best_index = other_index
                best_similarity = similarity

        if best_index is None:
            neighbors[row_index] = (None, None)
        else:
            neighbors[row_index] = (
                str(rows[best_index].get("molecule_id") or ""),
                round(best_similarity, 3),
            )

    return neighbors


def _butina_clusters(
    valid_items: list[tuple[int, object]],
    *,
    similarity_threshold: float,
) -> list[tuple[int, ...]]:
    distances = []
    fingerprints = [fingerprint for _, fingerprint in valid_items]
    row_indices = [row_index for row_index, _ in valid_items]

    for i in range(1, len(fingerprints)):
        for j in range(i):
            distances.append(1.0 - DataStructs.TanimotoSimilarity(fingerprints[i], fingerprints[j]))

    clusters = Butina.ClusterData(
        distances,
        len(fingerprints),
        1.0 - similarity_threshold,
        isDistData=True,
    )
    return [tuple(row_indices[cluster_member] for cluster_member in cluster) for cluster in clusters]


def _representative_index(cluster: tuple[int, ...], rows: list[dict[str, object]]) -> int:
    return sorted(
        cluster,
        key=lambda row_index: (
            -float(rows[row_index].get("priority_score") or 0.0),
            _row_label(rows[row_index]),
            row_index,
        ),
    )[0]


def _representative_sort_key(cluster: tuple[int, ...], rows: list[dict[str, object]]) -> tuple[str, int]:
    representative = _representative_index(cluster, rows)
    return (_row_label(rows[representative]), representative)


def _row_label(row: dict[str, object] | None) -> str:
    if row is None:
        return ""
    return str(row.get("molecule_id") or row.get("canonical_smiles") or row.get("input_smiles") or "")
