"""Deterministic, descriptive Bemis--Murcko scaffold organization."""

from __future__ import annotations

import hashlib
from collections import defaultdict
from typing import Any

import rdkit
from rdkit import Chem
from rdkit.Chem.Scaffolds import MurckoScaffold

from molecular_prioritization.chemical_space import _excluded_record, _record_identity


SCAFFOLD_ALGORITHM_VERSION = "bemis_murcko_v1"
NO_RING_SCAFFOLD_ID = "scf_no_ring"
SCAFFOLD_CAVEAT = (
    "Scaffold groups are descriptive structural organization only. They do not imply "
    "activity, potency, preference, confidence, applicability domain, or a causal SAR relationship."
)


def _scaffold_id(scaffold_smiles: str) -> str:
    digest = hashlib.sha256(
        f"{SCAFFOLD_ALGORITHM_VERSION}:{scaffold_smiles}".encode("utf-8")
    ).hexdigest()[:16]
    return f"scf_{digest}"


def organize_scaffolds(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Group valid imported records by canonical, achiral Bemis--Murcko scaffold."""

    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    scaffold_smiles_by_id: dict[str, str | None] = {}
    excluded: list[dict[str, Any]] = []
    valid_count = 0

    for index, source in enumerate(records):
        record = dict(source)
        smiles = str(record.get("canonical_smiles") or "").strip()
        if str(record.get("validation_status") or "").lower() != "valid" or not smiles:
            excluded.append(_excluded_record(record, index, "invalid_or_unresolved_structure"))
            continue
        molecule = Chem.MolFromSmiles(smiles)
        if molecule is None:
            excluded.append(_excluded_record(record, index, "scaffold_generation_failed"))
            continue
        scaffold = MurckoScaffold.GetScaffoldForMol(molecule)
        if scaffold.GetNumAtoms() == 0:
            scaffold_id = NO_RING_SCAFFOLD_ID
            scaffold_smiles = None
        else:
            Chem.RemoveStereochemistry(scaffold)
            scaffold_smiles = Chem.MolToSmiles(scaffold, canonical=True, isomericSmiles=False)
            scaffold_id = _scaffold_id(scaffold_smiles)
        valid_count += 1
        member = {
            **_record_identity(record, index),
            "canonical_smiles": smiles,
            "duplicate_structure": bool(record.get("duplicate_structure", False)),
        }
        groups[scaffold_id].append(member)
        scaffold_smiles_by_id[scaffold_id] = scaffold_smiles

    scaffolds = []
    for scaffold_id, members in groups.items():
        scaffold_smiles = scaffold_smiles_by_id[scaffold_id]
        scaffolds.append({
            "scaffold_id": scaffold_id,
            "scaffold_smiles": scaffold_smiles,
            "label": "No ring scaffold" if scaffold_id == NO_RING_SCAFFOLD_ID else scaffold_id,
            "category": "no_ring" if scaffold_id == NO_RING_SCAFFOLD_ID else "bemis_murcko",
            "member_count": len(members),
            "unique_structure_count": len({member["canonical_smiles"] for member in members}),
            "molecule_ids": [member["molecule_id"] for member in members],
            "members": members,
        })
    scaffolds.sort(key=lambda group: (-group["member_count"], group["scaffold_id"]))
    ring_scaffold_count = sum(group["category"] == "bemis_murcko" for group in scaffolds)
    acyclic_count = len(groups.get(NO_RING_SCAFFOLD_ID, []))
    return {
        "summary": {
            "total_record_count": len(records),
            "molecule_count": valid_count,
            "scaffold_count": ring_scaffold_count,
            "group_count": len(scaffolds),
            "acyclic_count": acyclic_count,
            "excluded_count": len(excluded),
        },
        "scaffolds": scaffolds,
        "excluded": excluded,
        "metadata": {
            "method": "Bemis-Murcko scaffold",
            "implementation": "rdkit.Chem.Scaffolds.MurckoScaffold.GetScaffoldForMol",
            "algorithm_version": SCAFFOLD_ALGORITHM_VERSION,
            "rdkit_version": rdkit.__version__,
            "canonicalization": "canonical scaffold SMILES; stereochemistry removed from scaffold",
            "input_context": "Uses the imported canonical_smiles after the existing cleanup, fragment-parent, and uncharging workflow; salts and mixtures are not reprocessed here.",
            "acyclic_policy": "Valid structures with no ring scaffold are grouped as scf_no_ring.",
            "invalid_policy": "Invalid or unresolved structures are excluded and reported separately.",
            "duplicate_policy": "Duplicate imported records remain separate members; unique structures are also counted.",
            "caveat": SCAFFOLD_CAVEAT,
        },
    }
