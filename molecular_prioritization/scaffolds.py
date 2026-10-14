"""Deterministic, descriptive Bemis--Murcko scaffold organization."""

from __future__ import annotations

import hashlib
from collections import defaultdict
from typing import Any, Mapping

import rdkit
from rdkit import Chem
from rdkit.Chem.Scaffolds import MurckoScaffold

from molecular_prioritization.chemical_space import _excluded_record, _record_identity


SCAFFOLD_ALGORITHM_VERSION = "bemis_murcko_v1"
GENERIC_FRAMEWORK_ALGORITHM_VERSION = "bemis_murcko_generic_v1"
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


def _generic_framework_id(generic_smiles: str) -> str:
    digest = hashlib.sha256(
        f"{GENERIC_FRAMEWORK_ALGORITHM_VERSION}:{generic_smiles}".encode("utf-8")
    ).hexdigest()[:16]
    return f"frm_{digest}"


def scaffold_identity(smiles: str) -> dict[str, Any]:
    """Return exact and generic RDKit Murcko identities for one valid structure."""

    molecule = Chem.MolFromSmiles(str(smiles or "").strip())
    if molecule is None:
        return {
            "status": "invalid",
            "exact_scaffold_id": None,
            "exact_scaffold_smiles": None,
            "generic_framework_id": None,
            "generic_framework_smiles": None,
            "scaffold_atom_count": 0,
            "ring_count": 0,
        }
    scaffold = MurckoScaffold.GetScaffoldForMol(molecule)
    if scaffold.GetNumAtoms() == 0:
        return {
            "status": "no_ring_scaffold",
            "exact_scaffold_id": NO_RING_SCAFFOLD_ID,
            "exact_scaffold_smiles": None,
            "generic_framework_id": None,
            "generic_framework_smiles": None,
            "scaffold_atom_count": 0,
            "ring_count": 0,
        }
    Chem.RemoveStereochemistry(scaffold)
    exact_smiles = Chem.MolToSmiles(scaffold, canonical=True, isomericSmiles=False)
    generic = MurckoScaffold.MakeScaffoldGeneric(Chem.Mol(scaffold))
    Chem.RemoveStereochemistry(generic)
    generic_smiles = Chem.MolToSmiles(generic, canonical=True, isomericSmiles=False)
    return {
        "status": "valid",
        "exact_scaffold_id": _scaffold_id(exact_smiles),
        "exact_scaffold_smiles": exact_smiles,
        "generic_framework_id": _generic_framework_id(generic_smiles),
        "generic_framework_smiles": generic_smiles,
        "scaffold_atom_count": scaffold.GetNumAtoms(),
        "ring_count": int(Chem.rdMolDescriptors.CalcNumRings(scaffold)),
    }


def classify_scaffold_relationship(
    reference: Mapping[str, Any], comparison: Mapping[str, Any]
) -> dict[str, Any]:
    """Classify a pair using Murcko identities only, without similarity metrics."""

    if reference.get("status") != "valid" or comparison.get("status") != "valid":
        return {
            "code": "ACYCLIC_OR_NO_MURCKO",
            "label": "No ring scaffold",
            "exact_match": False,
            "generic_framework_match": False,
        }
    exact_match = reference["exact_scaffold_smiles"] == comparison["exact_scaffold_smiles"]
    generic_match = reference["generic_framework_smiles"] == comparison["generic_framework_smiles"]
    if exact_match:
        code, label = "SAME_EXACT_MURCKO", "Same scaffold"
    elif generic_match:
        code, label = "SAME_GENERIC_FRAMEWORK", "Same framework topology"
    else:
        code, label = "DIFFERENT_FRAMEWORK", "Different scaffold framework"
    return {
        "code": code,
        "label": label,
        "exact_match": exact_match,
        "generic_framework_match": generic_match,
    }


def organize_scaffolds(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Group valid imported records by canonical, achiral Bemis--Murcko scaffold."""

    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    scaffold_smiles_by_id: dict[str, str | None] = {}
    generic_by_scaffold_id: dict[str, dict[str, Any]] = {}
    excluded: list[dict[str, Any]] = []
    valid_count = 0

    for index, source in enumerate(records):
        record = dict(source)
        smiles = str(record.get("canonical_smiles") or "").strip()
        if str(record.get("validation_status") or "").lower() != "valid" or not smiles:
            excluded.append(_excluded_record(record, index, "invalid_or_unresolved_structure"))
            continue
        identity = scaffold_identity(smiles)
        if identity["status"] == "invalid":
            excluded.append(_excluded_record(record, index, "scaffold_generation_failed"))
            continue
        scaffold_id = identity["exact_scaffold_id"]
        scaffold_smiles = identity["exact_scaffold_smiles"]
        valid_count += 1
        member = {
            **_record_identity(record, index),
            "canonical_smiles": smiles,
            "duplicate_structure": bool(record.get("duplicate_structure", False)),
        }
        groups[scaffold_id].append(member)
        scaffold_smiles_by_id[scaffold_id] = scaffold_smiles
        generic_by_scaffold_id[scaffold_id] = identity

    scaffolds = []
    for scaffold_id, members in groups.items():
        scaffold_smiles = scaffold_smiles_by_id[scaffold_id]
        identity = generic_by_scaffold_id[scaffold_id]
        scaffolds.append({
            "scaffold_id": scaffold_id,
            "scaffold_smiles": scaffold_smiles,
            "label": "No ring scaffold" if scaffold_id == NO_RING_SCAFFOLD_ID else scaffold_id,
            "category": "no_ring" if scaffold_id == NO_RING_SCAFFOLD_ID else "bemis_murcko",
            "generic_framework_id": identity["generic_framework_id"],
            "generic_framework_smiles": identity["generic_framework_smiles"],
            "scaffold_atom_count": identity["scaffold_atom_count"],
            "ring_count": identity["ring_count"],
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
            "generic_implementation": "rdkit.Chem.Scaffolds.MurckoScaffold.MakeScaffoldGeneric",
            "algorithm_version": SCAFFOLD_ALGORITHM_VERSION,
            "generic_algorithm_version": GENERIC_FRAMEWORK_ALGORITHM_VERSION,
            "rdkit_version": rdkit.__version__,
            "canonicalization": "canonical scaffold SMILES; stereochemistry removed from scaffold",
            "input_context": "Uses the imported canonical_smiles after the existing cleanup, fragment-parent, and uncharging workflow; salts and mixtures are not reprocessed here.",
            "acyclic_policy": "Valid structures with no ring scaffold are grouped as scf_no_ring.",
            "invalid_policy": "Invalid or unresolved structures are excluded and reported separately.",
            "duplicate_policy": "Duplicate imported records remain separate members; unique structures are also counted.",
            "caveat": SCAFFOLD_CAVEAT,
        },
    }
