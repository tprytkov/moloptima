"""SMILES validation and standardization helpers."""

from __future__ import annotations

from dataclasses import dataclass

from rdkit import Chem
from rdkit import RDLogger
from rdkit.Chem.MolStandardize import rdMolStandardize


@dataclass(frozen=True)
class StandardizedMolecule:
    """Result of an RDKit SMILES standardization step."""

    input_smiles: str
    canonical_smiles: str | None
    valid_molecule: bool
    error: str | None = None


def standardize_smiles(smiles: str | None) -> StandardizedMolecule:
    """Validate and canonicalize one SMILES string with RDKit."""

    raw_smiles = "" if smiles is None else str(smiles)
    normalized = raw_smiles.strip()

    if not normalized:
        return StandardizedMolecule(
            input_smiles=raw_smiles,
            canonical_smiles=None,
            valid_molecule=False,
            error="SMILES is empty.",
        )

    RDLogger.DisableLog("rdApp.error")
    try:
        mol = Chem.MolFromSmiles(normalized)
    finally:
        RDLogger.EnableLog("rdApp.error")

    if mol is None:
        return StandardizedMolecule(
            input_smiles=raw_smiles,
            canonical_smiles=None,
            valid_molecule=False,
            error="RDKit could not parse SMILES.",
        )

    try:
        mol = rdMolStandardize.FragmentParent(mol)
        mol = rdMolStandardize.Cleanup(mol)
        mol = rdMolStandardize.Uncharger().uncharge(mol)
        canonical_smiles = Chem.MolToSmiles(mol, canonical=True)
    except Exception as exc:  # pragma: no cover - defensive RDKit failure path
        return StandardizedMolecule(
            input_smiles=raw_smiles,
            canonical_smiles=None,
            valid_molecule=False,
            error=f"RDKit standardization failed: {exc}",
        )

    if not canonical_smiles:
        return StandardizedMolecule(
            input_smiles=raw_smiles,
            canonical_smiles=None,
            valid_molecule=False,
            error="RDKit returned an empty canonical SMILES.",
        )

    return StandardizedMolecule(
        input_smiles=raw_smiles,
        canonical_smiles=canonical_smiles,
        valid_molecule=True,
    )
