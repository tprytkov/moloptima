"""RDKit descriptor calculations for prioritized molecules."""

from __future__ import annotations

from dataclasses import dataclass

from rdkit import Chem
from rdkit.Chem import Descriptors, Lipinski, QED, rdMolDescriptors


@dataclass(frozen=True)
class MolecularDescriptors:
    """Core Phase 1 RDKit descriptor set."""

    mw: float
    tpsa: float
    hba: int
    hbd: int
    rotatable_bonds: int
    qed: float
    lipinski_violations: int
    lipinski_pass: bool


def calculate_descriptors(canonical_smiles: str) -> MolecularDescriptors:
    """Calculate basic RDKit descriptors for a canonical SMILES string."""

    mol = Chem.MolFromSmiles(canonical_smiles)
    if mol is None:
        raise ValueError(f"Cannot calculate descriptors for invalid SMILES: {canonical_smiles}")

    mw = Descriptors.MolWt(mol)
    tpsa = rdMolDescriptors.CalcTPSA(mol)
    hba = Lipinski.NumHAcceptors(mol)
    hbd = Lipinski.NumHDonors(mol)
    rotatable_bonds = Lipinski.NumRotatableBonds(mol)
    qed = QED.qed(mol)
    lipinski_violations = count_lipinski_violations(
        mw=mw,
        hba=hba,
        hbd=hbd,
        logp=Descriptors.MolLogP(mol),
    )

    return MolecularDescriptors(
        mw=round(mw, 3),
        tpsa=round(tpsa, 3),
        hba=hba,
        hbd=hbd,
        rotatable_bonds=rotatable_bonds,
        qed=round(qed, 3),
        lipinski_violations=lipinski_violations,
        lipinski_pass=lipinski_violations <= 1,
    )


def count_lipinski_violations(mw: float, hba: int, hbd: int, logp: float) -> int:
    """Count simple Lipinski rule-of-five violations."""

    return sum(
        [
            mw > 500,
            hba > 10,
            hbd > 5,
            logp > 5,
        ]
    )
