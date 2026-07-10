"""Offline medicinal chemistry structural-alert screening."""

from __future__ import annotations

from dataclasses import dataclass

from rdkit import Chem
from rdkit.Chem import FilterCatalog


STRUCTURAL_ALERT_COLUMNS = [
    "structural_alert_status",
    "structural_alert_count",
    "structural_alert_categories",
    "structural_alert_names",
    "pains_alert",
    "brenk_alert",
    "medchem_alert_summary",
]


@dataclass(frozen=True)
class StructuralAlertResult:
    structural_alert_status: str
    structural_alert_count: int | None
    structural_alert_categories: str
    structural_alert_names: str
    pains_alert: bool
    brenk_alert: bool
    medchem_alert_summary: str


def screen_structural_alerts(canonical_smiles: str | None, valid_molecule: bool) -> StructuralAlertResult:
    """Screen a molecule against local RDKit PAINS and Brenk alert catalogs."""

    if not valid_molecule or not canonical_smiles:
        return StructuralAlertResult(
            structural_alert_status="not_run_invalid_molecule",
            structural_alert_count=None,
            structural_alert_categories="",
            structural_alert_names="",
            pains_alert=False,
            brenk_alert=False,
            medchem_alert_summary="Structural-alert screening skipped for invalid molecule.",
        )

    mol = Chem.MolFromSmiles(canonical_smiles)
    if mol is None:
        return StructuralAlertResult(
            structural_alert_status="not_run_invalid_molecule",
            structural_alert_count=None,
            structural_alert_categories="",
            structural_alert_names="",
            pains_alert=False,
            brenk_alert=False,
            medchem_alert_summary="Structural-alert screening skipped for invalid molecule.",
        )

    try:
        category_matches = {
            "PAINS": _catalog_matches(mol, FilterCatalog.FilterCatalogParams.FilterCatalogs.PAINS),
            "Brenk": _catalog_matches(mol, FilterCatalog.FilterCatalogParams.FilterCatalogs.BRENK),
        }
    except Exception as exc:
        return StructuralAlertResult(
            structural_alert_status="alert_catalog_unavailable",
            structural_alert_count=None,
            structural_alert_categories="",
            structural_alert_names="",
            pains_alert=False,
            brenk_alert=False,
            medchem_alert_summary=f"Structural-alert catalog unavailable: {exc}",
        )

    alert_names_by_category = {
        category: names for category, names in category_matches.items() if names
    }
    alert_names = sorted(
        {
            alert_name
            for names in alert_names_by_category.values()
            for alert_name in names
        }
    )
    alert_categories = sorted(alert_names_by_category)
    alert_count = len(alert_names)
    if alert_count == 0:
        return StructuralAlertResult(
            structural_alert_status="no_alerts",
            structural_alert_count=0,
            structural_alert_categories="",
            structural_alert_names="",
            pains_alert=False,
            brenk_alert=False,
            medchem_alert_summary="No PAINS or Brenk structural alerts detected by RDKit filters.",
        )

    category_text = "; ".join(alert_categories)
    names_text = "; ".join(alert_names)
    return StructuralAlertResult(
        structural_alert_status="alerts_detected",
        structural_alert_count=alert_count,
        structural_alert_categories=category_text,
        structural_alert_names=names_text,
        pains_alert=bool(category_matches["PAINS"]),
        brenk_alert=bool(category_matches["Brenk"]),
        medchem_alert_summary=(
            f"{alert_count} structural alert(s) detected in {category_text}. "
            "Screening signal only; alerts do not prove toxicity, assay interference, or unsuitability."
        ),
    )


def _catalog_matches(mol: Chem.Mol, catalog_flag: object) -> list[str]:
    params = FilterCatalog.FilterCatalogParams()
    params.AddCatalog(catalog_flag)
    catalog = FilterCatalog.FilterCatalog(params)
    return sorted({match.GetDescription() for match in catalog.GetMatches(mol)})
