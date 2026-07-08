"""First-pass molecular prioritization scoring."""

from __future__ import annotations

from dataclasses import asdict

from molecular_prioritization.bbb_predictor import BBBPrediction
from molecular_prioritization.descriptors import MolecularDescriptors
from molecular_prioritization.docking import DockingResult
from molecular_prioritization.synthetic_accessibility import SyntheticAccessibilityResult


def calculate_priority_score(
    descriptors: MolecularDescriptors,
    is_valid: bool,
    bbb_prediction: BBBPrediction | None = None,
) -> float:
    """Calculate a transparent Phase 1 priority score between 0 and 1."""

    if not is_valid:
        return 0.0

    lipinski_component = 1.0 if descriptors.lipinski_pass else 0.4
    mw_component = _bounded_preference(descriptors.mw, lower=150, upper=500)
    tpsa_component = _bounded_preference(descriptors.tpsa, lower=20, upper=140)
    rotatable_component = max(0.0, 1.0 - max(0, descriptors.rotatable_bonds - 10) / 10)

    score = (
        descriptors.qed * 0.45
        + lipinski_component * 0.25
        + mw_component * 0.15
        + tpsa_component * 0.10
        + rotatable_component * 0.05
    )

    if bbb_prediction and bbb_prediction.bbb_probability is not None:
        if bbb_prediction.bbb_prediction == "high":
            score += 0.05 * bbb_prediction.bbb_probability
        elif bbb_prediction.bbb_prediction == "low":
            score -= 0.05 * bbb_prediction.bbb_probability

    return round(max(0.0, min(score, 1.0)), 3)


def build_priority_record(
    molecule_id: str,
    input_smiles: str,
    canonical_smiles: str | None,
    valid_molecule: bool,
    descriptors: MolecularDescriptors | None,
    bbb_prediction: BBBPrediction | None = None,
    synthetic_accessibility: SyntheticAccessibilityResult | None = None,
    docking: DockingResult | None = None,
    error: str | None = None,
) -> dict[str, object]:
    """Build one row for a ranked molecular prioritization result."""

    descriptor_values = asdict(descriptors) if descriptors else {
        "mw": None,
        "tpsa": None,
        "hba": None,
        "hbd": None,
        "rotatable_bonds": None,
        "qed": None,
        "lipinski_violations": None,
        "lipinski_pass": False,
    }

    priority_score = (
        calculate_priority_score(descriptors, valid_molecule, bbb_prediction)
        if descriptors
        else 0.0
    )
    bbb_values = bbb_prediction or BBBPrediction(
        bbb_prediction="unavailable",
        bbb_probability=None,
        bbb_model_status="not_run",
        bbb_warning="BBB prediction was not run.",
    )
    synthetic_accessibility_values = synthetic_accessibility or SyntheticAccessibilityResult(
        sa_score=None,
        synthetic_feasibility_category="not_available",
        synthetic_feasibility_status="not_run",
    )
    docking_values = docking or DockingResult(
        docking_score=None,
        docking_status="not_provided",
    )

    return {
        "molecule_id": molecule_id,
        "input_smiles": input_smiles,
        "canonical_smiles": canonical_smiles,
        "valid_molecule": valid_molecule,
        "priority_score": priority_score,
        "error": error,
        "docking_score": docking_values.docking_score,
        "docking_status": docking_values.docking_status,
        "sa_score": synthetic_accessibility_values.sa_score,
        "synthetic_feasibility_category": (
            synthetic_accessibility_values.synthetic_feasibility_category
        ),
        "synthetic_feasibility_status": synthetic_accessibility_values.synthetic_feasibility_status,
        "bbb_prediction": bbb_values.bbb_prediction,
        "bbb_probability": bbb_values.bbb_probability,
        "bbb_model_status": bbb_values.bbb_model_status,
        "bbb_warning": bbb_values.bbb_warning,
        **descriptor_values,
    }


def _bounded_preference(value: float, lower: float, upper: float) -> float:
    if lower <= value <= upper:
        return 1.0

    if value < lower:
        return max(0.0, value / lower)

    return max(0.0, 1.0 - (value - upper) / upper)
