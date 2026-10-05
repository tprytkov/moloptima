"""Deterministic single-cut matched molecular pair analysis."""

from __future__ import annotations

from functools import lru_cache
from typing import Any

import rdkit
from rdkit import Chem, DataStructs
from rdkit.Chem import rdMMPA

from biopharma_intelligence.known_analogs import compare_murcko_scaffolds
from biopharma_intelligence.similarity import MORGAN_FP_SIZE, MORGAN_RADIUS, morgan_fingerprint


POLICY_VERSION = "moloptima-mmp-policy-v1"
ALGORITHM = "rdkit-rdMMPA-single-cut-common-core"
ATTACHMENT_LABEL = "[*:1]"
# Explicitly select acyclic, non-aromatic single bonds attached to neutral carbon.
FRAGMENTATION_PATTERN = "[#6+0;!$(*=,#[!#6])]!@!=!#[*]"
MIN_CORE_HEAVY_ATOMS = 5
MIN_CORE_FRACTION = 0.5
MAX_VARIABLE_HEAVY_ATOMS = 10
MAX_CUTTABLE_BONDS = 100
MAX_PARENT_HEAVY_ATOMS = 200


def policy_contract() -> dict[str, Any]:
    """Return the documented policy independently of any pair result."""

    return {
        "policy_version": POLICY_VERSION,
        "cut_count": 1,
        "attachment_count": 1,
        "fragmentation_method": "RDKit rdMMPA.FragmentMol",
        "fragmentation_pattern": FRAGMENTATION_PATTERN,
        "allowed_bonds": "acyclic non-aromatic single bonds selected by fragmentation_pattern",
        "ring_bond_cutting": False,
        "minimum_shared_core_heavy_atoms": MIN_CORE_HEAVY_ATOMS,
        "minimum_shared_core_fraction_each_parent": MIN_CORE_FRACTION,
        "variable_fragment_heavy_atom_range": [1, MAX_VARIABLE_HEAVY_ATOMS],
        "attachment_label": ATTACHMENT_LABEL,
        "canonicalization": "canonical isomeric RDKit SMILES with normalized atom map 1",
        "stereochemistry": "preserved; stereo-only differences are not represented as an MMP",
        "symmetry_handling": "equivalent canonical decompositions deduplicated",
        "primary_selection": "largest core, then smallest variable region, then lexical canonical SMILES",
    }


def _canonical_parent(smiles: str) -> tuple[Chem.Mol | None, str | None, str | None]:
    molecule = Chem.MolFromSmiles((smiles or "").strip())
    if molecule is None:
        return None, None, "invalid_structure"
    if len(Chem.GetMolFrags(molecule)) != 1:
        return None, None, "unsupported_disconnected_structure"
    if any(atom.GetAtomicNum() == 0 for atom in molecule.GetAtoms()):
        return None, None, "unsupported_attachment_atom_in_parent"
    if molecule.GetNumHeavyAtoms() > MAX_PARENT_HEAVY_ATOMS:
        return None, None, "structure_exceeds_policy_size"
    return molecule, Chem.MolToSmiles(molecule, canonical=True, isomericSmiles=True), None


def _canonical_fragment(fragment: Chem.Mol) -> str:
    editable = Chem.RWMol(fragment)
    for atom in editable.GetAtoms():
        if atom.GetAtomicNum() == 0:
            atom.SetIsotope(0)
            atom.SetAtomMapNum(1)
    canonical = editable.GetMol()
    Chem.SanitizeMol(canonical)
    return Chem.MolToSmiles(canonical, canonical=True, isomericSmiles=True)


def _heavy_atom_count(molecule: Chem.Mol) -> int:
    return sum(atom.GetAtomicNum() > 1 for atom in molecule.GetAtoms())


def _attachment_count(molecule: Chem.Mol) -> int:
    return sum(atom.GetAtomicNum() == 0 for atom in molecule.GetAtoms())


@lru_cache(maxsize=2048)
def _single_cut_decompositions(
    canonical_smiles: str, policy_version: str, rdkit_version: str,
) -> tuple[tuple[str, int, str, int], ...]:
    # Version arguments are intentionally part of the bounded in-memory cache key.
    _ = policy_version, rdkit_version
    molecule = Chem.MolFromSmiles(canonical_smiles)
    if molecule is None:
        return ()
    parent_heavy = molecule.GetNumHeavyAtoms()
    raw = rdMMPA.FragmentMol(
        molecule, minCuts=1, maxCuts=1, maxCutBonds=MAX_CUTTABLE_BONDS,
        pattern=FRAGMENTATION_PATTERN, resultsAsMols=True,
    )
    accepted: set[tuple[str, int, str, int]] = set()
    for _, disconnected in raw:
        if disconnected is None:
            continue
        fragments = Chem.GetMolFrags(disconnected, asMols=True, sanitizeFrags=True)
        if len(fragments) != 2:
            continue
        for core_index in (0, 1):
            core = fragments[core_index]
            variable = fragments[1 - core_index]
            core_heavy = _heavy_atom_count(core)
            variable_heavy = _heavy_atom_count(variable)
            if _attachment_count(core) != 1 or _attachment_count(variable) != 1:
                continue
            if core_heavy < MIN_CORE_HEAVY_ATOMS or core_heavy / parent_heavy < MIN_CORE_FRACTION:
                continue
            if not 1 <= variable_heavy <= MAX_VARIABLE_HEAVY_ATOMS:
                continue
            accepted.add((_canonical_fragment(core), core_heavy, _canonical_fragment(variable), variable_heavy))
    return tuple(sorted(accepted, key=lambda item: (-item[1], item[3], item[0], item[2])))


def _relationship(query_smiles: str, reference_smiles: str) -> dict[str, Any]:
    query_fp = morgan_fingerprint(query_smiles)
    reference_fp = morgan_fingerprint(reference_smiles)
    tanimoto = None if query_fp is None or reference_fp is None else round(float(DataStructs.TanimotoSimilarity(query_fp, reference_fp)), 6)
    scaffold_label = compare_murcko_scaffolds(query_smiles, reference_smiles)
    return {
        "tanimoto": tanimoto,
        "fingerprint": f"Morgan radius {MORGAN_RADIUS}, {MORGAN_FP_SIZE} bits",
        "same_murcko_scaffold": scaffold_label in {"Yes", "No ring scaffold"},
        "murcko_scaffold_relationship": scaffold_label,
    }


def analyze_matched_pair(
    query_smiles: str, reference_smiles: str, *, query_id: str = "query",
    reference_id: str = "reference", reference_source: str = "external",
) -> dict[str, Any]:
    """Analyze one directed query/reference relationship under the v1 policy."""

    query_mol, query_canonical, query_error = _canonical_parent(query_smiles)
    reference_mol, reference_canonical, reference_error = _canonical_parent(reference_smiles)
    base = {
        "policy_version": POLICY_VERSION,
        "query": {"id": query_id, "canonical_smiles": query_canonical},
        "reference": {"id": reference_id, "source": reference_source, "canonical_smiles": reference_canonical},
        "matched_pair": False,
        "shared_core": None,
        "query_fragment": None,
        "reference_fragment": None,
        "transformation": None,
        "relationship": _relationship(query_canonical, reference_canonical) if query_canonical and reference_canonical else None,
        "provenance": {"rdkit_version": rdkit.__version__, "policy_version": POLICY_VERSION, "algorithm": ALGORITHM},
    }
    if query_error or reference_error:
        side = "query" if query_error else "reference"
        return {**base, "reason": f"{side}_{query_error or reference_error}"}
    assert query_mol is not None and reference_mol is not None and query_canonical and reference_canonical
    if query_canonical == reference_canonical:
        return {**base, "reason": "identical_structure"}
    query_achiral = Chem.MolToSmiles(query_mol, canonical=True, isomericSmiles=False)
    reference_achiral = Chem.MolToSmiles(reference_mol, canonical=True, isomericSmiles=False)
    if query_achiral == reference_achiral:
        return {**base, "reason": "stereochemistry_only_unsupported"}

    query_parts = _single_cut_decompositions(query_canonical, POLICY_VERSION, rdkit.__version__)
    reference_parts = _single_cut_decompositions(reference_canonical, POLICY_VERSION, rdkit.__version__)
    candidates = [
        (q_core, q_core_heavy, q_fragment, q_fragment_heavy, r_fragment, r_fragment_heavy)
        for q_core, q_core_heavy, q_fragment, q_fragment_heavy in query_parts
        for r_core, _, r_fragment, r_fragment_heavy in reference_parts
        if q_core == r_core and q_fragment != r_fragment
    ]
    if not candidates:
        reason = "unsupported_topology" if not query_parts or not reference_parts else "no_accepted_single_cut_common_core"
        return {**base, "reason": reason}
    core, core_heavy, query_fragment, query_heavy, reference_fragment, reference_heavy = sorted(
        candidates, key=lambda item: (-item[1], item[3] + item[5], item[0], item[2], item[4]),
    )[0]
    forward = f"{query_fragment} >> {reference_fragment}"
    reverse = f"{reference_fragment} >> {query_fragment}"
    return {
        **base,
        "matched_pair": True,
        "reason": "matched_pair",
        "shared_core": {"canonical_smiles": core, "heavy_atom_count": core_heavy, "attachment_count": 1},
        "query_fragment": {"canonical_smiles": query_fragment, "heavy_atom_count": query_heavy, "attachment_count": 1},
        "reference_fragment": {"canonical_smiles": reference_fragment, "heavy_atom_count": reference_heavy, "attachment_count": 1},
        "transformation": {
            "query_to_reference": forward,
            "reference_to_query": reverse,
            "display": f"{query_fragment.replace(ATTACHMENT_LABEL, '[attachment]')} → {reference_fragment.replace(ATTACHMENT_LABEL, '[attachment]')}",
            "direction": "selected MolOptima compound to known reference analog",
            "attachment_label": ATTACHMENT_LABEL,
            "interpretation": "structural substituent replacement; not a reaction",
        },
    }


def analyze_matched_pair_batch(query: dict[str, Any], references: list[dict[str, Any]]) -> dict[str, Any]:
    """Analyze a bounded query-relative reference list with deterministic ordering."""

    results = [analyze_matched_pair(
        str(query.get("smiles") or ""), str(reference.get("smiles") or ""),
        query_id=str(query.get("id") or "query"),
        reference_id=str(reference.get("id") or "reference"),
        reference_source=str(reference.get("source") or "external"),
    ) for reference in references]
    return {
        "policy_version": POLICY_VERSION,
        "query_id": str(query.get("id") or "query"),
        "candidate_count": len(references),
        "matched_pair_count": sum(result["matched_pair"] for result in results),
        "results": results,
        "policy": policy_contract(),
        "provenance": {"rdkit_version": rdkit.__version__, "policy_version": POLICY_VERSION, "algorithm": ALGORITHM},
        "scientific_note": "Matched-pair membership is structural context only and does not establish an activity or property effect.",
    }
