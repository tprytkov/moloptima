"""Transparent synthetic feasibility heuristics for Phase 1 outputs."""

from __future__ import annotations

from dataclasses import dataclass

from rdkit import Chem
from rdkit.Chem import rdMolDescriptors


@dataclass(frozen=True)
class SyntheticAccessibilityResult:
    """Informational synthetic accessibility output fields."""

    sa_score: float | None
    synthetic_feasibility_category: str
    synthetic_feasibility_status: str


def heuristic_synthetic_accessibility(
    canonical_smiles: str | None,
    valid_molecule: bool,
) -> SyntheticAccessibilityResult:
    """Calculate a reproducible 1-10 heuristic score where lower is easier."""

    if not valid_molecule or not canonical_smiles:
        return SyntheticAccessibilityResult(
            sa_score=None,
            synthetic_feasibility_category="not_available",
            synthetic_feasibility_status="not_run_invalid_molecule",
        )

    mol = Chem.MolFromSmiles(canonical_smiles)
    if mol is None:
        return SyntheticAccessibilityResult(
            sa_score=None,
            synthetic_feasibility_category="not_available",
            synthetic_feasibility_status="not_run_invalid_molecule",
        )

    heavy_atoms = mol.GetNumHeavyAtoms()
    rings = rdMolDescriptors.CalcNumRings(mol)
    bridgeheads = rdMolDescriptors.CalcNumBridgeheadAtoms(mol)
    spiro_atoms = rdMolDescriptors.CalcNumSpiroAtoms(mol)
    chiral_centers = len(Chem.FindMolChiralCenters(mol, includeUnassigned=True))
    hetero_atoms = sum(1 for atom in mol.GetAtoms() if atom.GetAtomicNum() not in {1, 6})

    complexity_penalty = (
        heavy_atoms / 25
        + rings * 0.35
        + bridgeheads * 0.75
        + spiro_atoms * 0.75
        + chiral_centers * 0.5
        + hetero_atoms / 20
    )
    score = round(max(1.0, min(10.0, 1.0 + complexity_penalty)), 3)

    if score <= 3.0:
        category = "easy"
    elif score <= 6.0:
        category = "moderate"
    else:
        category = "difficult"

    return SyntheticAccessibilityResult(
        sa_score=score,
        synthetic_feasibility_category=category,
        synthetic_feasibility_status="heuristic_synthetic_accessibility",
    )
