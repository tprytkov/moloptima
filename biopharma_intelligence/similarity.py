"""Offline chemical similarity matching against local references."""

from __future__ import annotations

from dataclasses import dataclass

from rdkit import Chem, DataStructs
from rdkit.Chem import rdFingerprintGenerator

from biopharma_intelligence.identity import ReferenceCompound, reference_compounds_by_identity


MORGAN_RADIUS = 2
MORGAN_FP_SIZE = 2048
MORGAN_GENERATOR = rdFingerprintGenerator.GetMorganGenerator(
    radius=MORGAN_RADIUS,
    fpSize=MORGAN_FP_SIZE,
)


@dataclass(frozen=True)
class SimilarityMatchResult:
    """Closest known-compound similarity output fields."""

    closest_known_compound_name: str | None
    closest_known_compound_id: str | None
    closest_known_compound_similarity: float | None
    closest_known_compound_source: str | None
    similarity_check_status: str


def find_closest_known_compound(
    canonical_smiles: str | None,
    valid_molecule: bool,
) -> SimilarityMatchResult:
    """Find the closest local reference by Morgan fingerprint Tanimoto similarity."""

    if not valid_molecule or not canonical_smiles:
        return SimilarityMatchResult(
            closest_known_compound_name=None,
            closest_known_compound_id=None,
            closest_known_compound_similarity=None,
            closest_known_compound_source=None,
            similarity_check_status="not_run_invalid_molecule",
        )

    query_fp = morgan_fingerprint(canonical_smiles)
    if query_fp is None:
        return SimilarityMatchResult(
            closest_known_compound_name=None,
            closest_known_compound_id=None,
            closest_known_compound_similarity=None,
            closest_known_compound_source=None,
            similarity_check_status="not_run_invalid_molecule",
        )

    best_reference: ReferenceCompound | None = None
    best_similarity = -1.0
    for reference in reference_compounds_by_identity().values():
        reference_fp = morgan_fingerprint(reference.canonical_smiles)
        if reference_fp is None:
            continue
        similarity = DataStructs.TanimotoSimilarity(query_fp, reference_fp)
        if similarity > best_similarity:
            best_reference = reference
            best_similarity = similarity

    if best_reference is None:
        return SimilarityMatchResult(
            closest_known_compound_name=None,
            closest_known_compound_id=None,
            closest_known_compound_similarity=None,
            closest_known_compound_source=None,
            similarity_check_status="no_reference_compounds",
        )

    return SimilarityMatchResult(
        closest_known_compound_name=best_reference.name,
        closest_known_compound_id=best_reference.compound_id,
        closest_known_compound_similarity=round(best_similarity, 3),
        closest_known_compound_source=best_reference.source,
        similarity_check_status="closest_match_found",
    )


def morgan_fingerprint(smiles: str):
    """Build a Morgan radius 2, 2048-bit fingerprint for one SMILES string."""

    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    return MORGAN_GENERATOR.GetFingerprint(mol)
