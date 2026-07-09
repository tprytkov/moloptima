"""Offline exact chemical identity matching against local references."""

from __future__ import annotations

import csv
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from rdkit import Chem


PROJECT_ROOT = Path(__file__).resolve().parents[1]
REFERENCE_COMPOUND_PATH = PROJECT_ROOT / "data" / "reference_compounds" / "known_compounds.csv"


@dataclass(frozen=True)
class IdentityMatchResult:
    """Known-compound identity check output fields."""

    known_compound_match: bool
    known_compound_name: str | None
    known_compound_source: str | None
    known_compound_id: str | None
    identity_check_status: str


@dataclass(frozen=True)
class ReferenceCompound:
    name: str
    source: str
    compound_id: str
    canonical_smiles: str


def check_known_compound_identity(
    canonical_smiles: str | None,
    valid_molecule: bool,
) -> IdentityMatchResult:
    """Return an exact local known-compound match for a canonical SMILES string."""

    if not valid_molecule or not canonical_smiles:
        return IdentityMatchResult(
            known_compound_match=False,
            known_compound_name=None,
            known_compound_source=None,
            known_compound_id=None,
            identity_check_status="not_run_invalid_molecule",
        )

    query_key = canonical_identity_key(canonical_smiles)
    if query_key is None:
        return IdentityMatchResult(
            known_compound_match=False,
            known_compound_name=None,
            known_compound_source=None,
            known_compound_id=None,
            identity_check_status="not_run_invalid_molecule",
        )

    reference = reference_compounds_by_identity().get(query_key)
    if reference is None:
        return IdentityMatchResult(
            known_compound_match=False,
            known_compound_name=None,
            known_compound_source=None,
            known_compound_id=None,
            identity_check_status="no_exact_match",
        )

    return IdentityMatchResult(
        known_compound_match=True,
        known_compound_name=reference.name,
        known_compound_source=reference.source,
        known_compound_id=reference.compound_id,
        identity_check_status="exact_match",
    )


@lru_cache(maxsize=1)
def reference_compounds_by_identity() -> dict[str, ReferenceCompound]:
    """Load local reference compounds keyed by RDKit canonical SMILES."""

    references: dict[str, ReferenceCompound] = {}
    with REFERENCE_COMPOUND_PATH.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            key = canonical_identity_key(row.get("smiles", ""))
            if key is None:
                continue
            references[key] = ReferenceCompound(
                name=row["name"],
                source=row["source"],
                compound_id=row["compound_id"],
                canonical_smiles=key,
            )
    return references


def canonical_identity_key(smiles: str) -> str | None:
    """Normalize a SMILES string to an exact-match RDKit canonical key."""

    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    return Chem.MolToSmiles(mol, canonical=True, isomericSmiles=True)
