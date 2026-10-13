"""Immutable, downstream-only inputs for future protein-ligand interaction analysis.

This module deliberately has no ProLIF dependency and is never imported by the
docking or receptor-preparation paths.  It validates and packages authoritative
docking artifacts without calculating interactions.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import tempfile
from pathlib import Path
from typing import Mapping, Sequence

from rdkit import Chem, rdBase
from rdkit.Chem import rdDetermineBonds, rdMolAlign


INPUT_SCHEMA_VERSION = "moloptima-interaction-analysis-input-v1"
MAPPING_SCHEMA_VERSION = "moloptima-template-pose-atom-mapping-v1"
INPUT_SCHEMA_VERSION_V2 = "moloptima-interaction-analysis-input-v2"
MAPPING_SCHEMA_VERSION_V2 = "moloptima-template-pose-atom-mapping-v2"
PDBQT_PROVENANCE_SCHEMA_VERSION = "moloptima-ligand-input-pdbqt-provenance-v1"
RECEPTOR_POLICY_VERSION = "moloptima-complete-residue-pocket-v1"
LIGAND_TEMPLATE_SCHEMA_VERSION = "moloptima-ligand-template-v1"
POCKET_CUTOFF_ANGSTROM = 8.0
MAPPING_RMSD_AMBIGUITY_TOLERANCE_ANGSTROM = 0.001
PREPARATION_COORDINATE_TOLERANCE_ANGSTROM = 0.002

# ProLIF 2.2.3's supported default fingerprint reaches furthest for edge-to-face
# pi stacking (6.5 A centroid distance).  An 8 A atom-neighbour shell adds a
# 1.5 A guard band before whole-residue expansion.  This policy does not claim
# support for custom future interaction definitions with longer cutoffs.
POCKET_CUTOFF_BASIS = {
    "qualified_engine": "ProLIF 2.2.3",
    "supported_interaction_set": "ProLIF 2.2.3 default fingerprint interactions",
    "maximum_supported_geometric_cutoff_angstrom": 6.5,
    "limiting_definition": "EdgeToFace pi-stacking centroid distance",
    "safety_margin_angstrom": 1.5,
}

_ATOM_PREFIXES = ("ATOM  ", "HETATM")
_AUTODOCK_ELEMENTS = {
    "A": "C", "C": "C", "HD": "H", "H": "H", "N": "N", "NA": "N",
    "OA": "O", "OS": "O", "O": "O", "F": "F", "P": "P", "S": "S", "SA": "S",
    "NS": "N", "HS": "H",
    "CL": "Cl", "BR": "Br", "I": "I", "MG": "Mg", "MN": "Mn",
    "ZN": "Zn", "CA": "Ca", "FE": "Fe",
}
_STANDARD_PROTEIN_RESIDUES = frozenset({
    "ALA", "ARG", "ASN", "ASP", "CYS", "GLN", "GLU", "GLY", "HIS", "ILE",
    "LEU", "LYS", "MET", "PHE", "PRO", "SER", "THR", "TRP", "TYR", "VAL",
    "ASX", "GLX", "SEC", "PYL", "MSE",
})
_METAL_ELEMENTS = frozenset({
    "Li", "Na", "Mg", "Al", "K", "Ca", "Cr", "Mn", "Fe", "Co", "Ni",
    "Cu", "Zn", "Cd", "Hg", "Pb",
})


class InteractionAnalysisInputError(RuntimeError):
    """Typed, analysis-only failure that never changes docking validity."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def extract_vina_pose_model(
    pose_path: str | Path,
    mode_number: int,
    *,
    docking_job_id: str = "",
) -> dict[str, object]:
    """Extract one exact MODEL block while leaving the authoritative file untouched."""

    path = Path(pose_path)
    if not path.is_file():
        raise InteractionAnalysisInputError("pose_parse_failed", "Authoritative pose artifact is missing.")
    parent_bytes = path.read_bytes()
    parent_sha = hashlib.sha256(parent_bytes).hexdigest()
    try:
        text = parent_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise InteractionAnalysisInputError("pose_parse_failed", "Pose artifact is not UTF-8 text.") from exc
    if not isinstance(mode_number, int) or mode_number < 1:
        raise InteractionAnalysisInputError("pose_model_not_found", "Mode number must be a positive integer.")

    lines = text.splitlines(keepends=True)
    blocks: list[tuple[int, str]] = []
    current_model: int | None = None
    current_lines: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("MODEL "):
            if current_model is not None:
                raise InteractionAnalysisInputError("pose_parse_failed", "Nested or unterminated MODEL block.")
            try:
                current_model = int(stripped.split()[1])
            except (IndexError, ValueError) as exc:
                raise InteractionAnalysisInputError("pose_parse_failed", "Malformed MODEL record.") from exc
            current_lines = [line]
        elif current_model is not None:
            current_lines.append(line)
            if stripped == "ENDMDL":
                blocks.append((current_model, "".join(current_lines)))
                current_model = None
                current_lines = []
    if current_model is not None:
        raise InteractionAnalysisInputError("pose_parse_failed", "Unterminated MODEL block.")
    if not blocks:
        raise InteractionAnalysisInputError("pose_parse_failed", "Pose artifact contains no MODEL blocks.")
    if len({number for number, _ in blocks}) != len(blocks):
        raise InteractionAnalysisInputError("pose_parse_failed", "Pose artifact contains duplicate MODEL numbers.")

    selected = next((block for number, block in blocks if number == mode_number), None)
    if selected is None:
        raise InteractionAnalysisInputError(
            "pose_model_not_found", f"Pose artifact has no MODEL {mode_number}."
        )
    remarks = [line for line in selected.splitlines() if line.startswith("REMARK VINA RESULT:")]
    if len(remarks) != 1:
        raise InteractionAnalysisInputError(
            "pose_parse_failed", "Selected MODEL must contain exactly one Vina result remark."
        )
    fields = remarks[0][len("REMARK VINA RESULT:"):].split()
    try:
        affinity, rmsd_lb, rmsd_ub = (float(fields[index]) for index in range(3))
    except (IndexError, ValueError) as exc:
        raise InteractionAnalysisInputError("pose_parse_failed", "Vina result metadata is malformed.") from exc
    if not all(math.isfinite(value) for value in (affinity, rmsd_lb, rmsd_ub)):
        raise InteractionAnalysisInputError("pose_parse_failed", "Vina result metadata is non-finite.")
    atoms = _parse_pdbqt_atoms(selected, failure_code="pose_parse_failed")
    if hashlib.sha256(path.read_bytes()).hexdigest() != parent_sha:
        raise InteractionAnalysisInputError("pose_parse_failed", "Authoritative pose changed during extraction.")
    return {
        "schema_version": "moloptima-vina-pose-model-v1",
        "docking_job_id": docking_job_id,
        "parent_pose_sha256": parent_sha,
        "mode_number": mode_number,
        "model_number": mode_number,
        "vina_affinity_kcal_mol": affinity,
        "rmsd_lb": rmsd_lb,
        "rmsd_ub": rmsd_ub,
        "model_text": selected,
        "model_sha256": hashlib.sha256(selected.encode("utf-8")).hexdigest(),
        "atoms": atoms,
    }


def resolve_template_pose_mapping(
    template_path: str | Path,
    extracted_pose: Mapping[str, object],
) -> dict[str, object]:
    """Resolve a heavy-atom graph isomorphism; reject invalid or ambiguous maps."""

    template_file = Path(template_path)
    if not template_file.is_file():
        raise InteractionAnalysisInputError("ligand_template_missing", "Ligand template SDF is missing.")
    supplier = Chem.SDMolSupplier(str(template_file), removeHs=False, sanitize=True)
    template_all = supplier[0] if len(supplier) else None
    if template_all is None:
        raise InteractionAnalysisInputError("template_pose_mapping_failed", "Ligand template SDF is invalid.")
    template = Chem.RemoveHs(template_all)
    pose_atoms = extracted_pose.get("atoms")
    if not isinstance(pose_atoms, list) or not pose_atoms:
        raise InteractionAnalysisInputError("template_pose_mapping_failed", "Selected pose has no atoms.")

    pose_all = _rdkit_connectivity_molecule(pose_atoms)
    pose = Chem.RemoveHs(pose_all, sanitize=False)
    if template.GetNumAtoms() != pose.GetNumAtoms():
        raise InteractionAnalysisInputError(
            "template_pose_mapping_failed", "Template and pose heavy-atom counts differ."
        )
    if sorted(atom.GetSymbol() for atom in template.GetAtoms()) != sorted(
        atom.GetSymbol() for atom in pose.GetAtoms()
    ):
        raise InteractionAnalysisInputError(
            "template_pose_mapping_failed", "Template and pose heavy-atom elements differ."
        )

    query = _connectivity_query(template)
    template_edges = {
        frozenset((bond.GetBeginAtomIdx(), bond.GetEndAtomIdx())) for bond in template.GetBonds()
    }
    pose_edges = {
        frozenset((bond.GetBeginAtomIdx(), bond.GetEndAtomIdx())) for bond in pose.GetBonds()
    }
    matches = []
    for match in pose.GetSubstructMatches(query, uniquify=False, maxMatches=10000):
        mapped_edges = {frozenset((match[min(edge)], match[max(edge)])) for edge in template_edges}
        if mapped_edges == pose_edges:
            matches.append(tuple(match))
    matches = sorted(set(matches))
    if not matches:
        raise InteractionAnalysisInputError(
            "template_pose_mapping_failed", "No element-and-connectivity graph isomorphism was found."
        )
    coordinate_tiebreaker: dict[str, object] = {"status": "not_required"}
    if len(matches) != 1:
        ranked_matches = sorted(
            (_alignment_rmsd(pose, template, candidate), candidate) for candidate in matches
        )
        best_rmsd, match = ranked_matches[0]
        next_rmsd = ranked_matches[1][0]
        if next_rmsd - best_rmsd <= MAPPING_RMSD_AMBIGUITY_TOLERANCE_ANGSTROM:
            raise InteractionAnalysisInputError(
                "template_pose_mapping_failed",
                f"Template-to-pose graph mapping remains ambiguous ({len(matches)} valid isomorphisms).",
            )
        coordinate_tiebreaker = {
            "status": "resolved_graph_automorphisms",
            "candidate_count": len(matches),
            "method": "minimum Kabsch-aligned heavy-atom RMSD after exact graph matching",
            "best_rmsd_angstrom": round(best_rmsd, 6),
            "next_best_rmsd_angstrom": round(next_rmsd, 6),
            "ambiguity_tolerance_angstrom": MAPPING_RMSD_AMBIGUITY_TOLERANCE_ANGSTROM,
        }
    else:
        match = matches[0]
    reconstructed = _reconstruct_pose_chemistry(template, pose, match)
    validation = _validate_reconstructed_chemistry(template, reconstructed, match)
    entries = []
    for template_index, pose_heavy_index in enumerate(match):
        pose_atom = pose.GetAtomWithIdx(pose_heavy_index)
        entries.append({
            "template_atom_index": template_index,
            "pose_pdbqt_atom_index": pose_atom.GetIntProp("pose_pdbqt_atom_index"),
            "pose_pdbqt_atom_serial": pose_atom.GetIntProp("pose_pdbqt_atom_serial"),
            "element": template.GetAtomWithIdx(template_index).GetSymbol(),
        })
    return {
        "schema_version": MAPPING_SCHEMA_VERSION,
        "mapping_method": (
            "RDKit distance-connectivity then exact heavy-atom graph isomorphism; "
            "coordinate RMSD is used only to resolve graph automorphisms"
        ),
        "rdkit_version": rdBase.rdkitVersion,
        "positional_identity_assumed": False,
        "hydrogen_mapping_policy": (
            "Heavy atoms only; PDBQT polar hydrogens retain pose indices and are associated "
            "through their mapped donor heavy atom in the future analysis runtime."
        ),
        "heavy_atom_count": template.GetNumAtoms(),
        "entries": entries,
        "coordinate_tiebreaker": coordinate_tiebreaker,
        "validation": validation,
    }


def build_ligand_input_pdbqt_provenance(
    template_path: str | Path,
    input_pdbqt_path: str | Path,
) -> dict[str, object]:
    """Map SDF atoms to the exact pre-docking PDBQT by preparation coordinates."""

    template_file = Path(template_path)
    pdbqt_file = Path(input_pdbqt_path)
    if not template_file.is_file() or not pdbqt_file.is_file():
        raise InteractionAnalysisInputError(
            "ligand_input_pdbqt_missing", "Ligand template or pre-docking PDBQT is missing."
        )
    supplier = Chem.SDMolSupplier(str(template_file), removeHs=False, sanitize=True)
    template = supplier[0] if len(supplier) else None
    if template is None or template.GetNumConformers() != 1:
        raise InteractionAnalysisInputError(
            "ligand_input_pdbqt_mapping_failed", "Ligand template SDF is invalid."
        )
    pdbqt_bytes = pdbqt_file.read_bytes()
    try:
        pdbqt_text = pdbqt_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise InteractionAnalysisInputError(
            "ligand_input_pdbqt_mapping_failed", "Pre-docking PDBQT is not UTF-8 text."
        ) from exc
    pdbqt_atoms = _parse_pdbqt_atoms(
        pdbqt_text, failure_code="ligand_input_pdbqt_mapping_failed"
    )
    conformer = template.GetConformer()
    unused = set(range(template.GetNumAtoms()))
    entries: list[dict[str, object]] = []
    for pdbqt_atom in pdbqt_atoms:
        candidates = []
        for template_index in unused:
            template_atom = template.GetAtomWithIdx(template_index)
            if template_atom.GetSymbol() != pdbqt_atom["element"]:
                continue
            position = conformer.GetAtomPosition(template_index)
            distance = math.sqrt(sum(
                (float(left) - float(right)) ** 2
                for left, right in zip(
                    pdbqt_atom["coordinates"], [position.x, position.y, position.z], strict=True
                )
            ))
            if distance <= PREPARATION_COORDINATE_TOLERANCE_ANGSTROM:
                candidates.append((distance, template_index))
        if len(candidates) != 1:
            raise InteractionAnalysisInputError(
                "ligand_input_pdbqt_mapping_failed",
                "SDF-to-input-PDBQT atom identity is missing or ambiguous.",
            )
        distance, template_index = candidates[0]
        unused.remove(template_index)
        entries.append({
            "template_atom_index": template_index,
            "input_pdbqt_atom_index": pdbqt_atom["pose_pdbqt_atom_index"],
            "input_pdbqt_atom_serial": pdbqt_atom["serial"],
            "atom_name": pdbqt_atom["atom_name"],
            "element": pdbqt_atom["element"],
            "autodock_atom_type": pdbqt_atom["atom_type"],
            "preparation_coordinate_distance_angstrom": round(distance, 6),
        })
    mapped_template = {int(entry["template_atom_index"]) for entry in entries}
    missing_heavy = [
        atom.GetIdx() for atom in template.GetAtoms()
        if atom.GetSymbol() != "H" and atom.GetIdx() not in mapped_template
    ]
    if missing_heavy:
        raise InteractionAnalysisInputError(
            "ligand_input_pdbqt_mapping_failed", "Pre-docking PDBQT omitted a template heavy atom."
        )
    template_to_pdbqt = {
        int(entry["template_atom_index"]): entry for entry in entries
    }
    polar_hydrogens = []
    for entry in entries:
        template_index = int(entry["template_atom_index"])
        atom = template.GetAtomWithIdx(template_index)
        if atom.GetSymbol() != "H":
            continue
        neighbors = list(atom.GetNeighbors())
        if len(neighbors) != 1 or neighbors[0].GetIdx() not in template_to_pdbqt:
            raise InteractionAnalysisInputError(
                "ligand_input_pdbqt_mapping_failed", "Polar-hydrogen parent identity is unavailable."
            )
        parent = template_to_pdbqt[neighbors[0].GetIdx()]
        polar_hydrogens.append({
            "template_hydrogen_atom_index": template_index,
            "template_parent_atom_index": neighbors[0].GetIdx(),
            "input_pdbqt_hydrogen_atom_index": entry["input_pdbqt_atom_index"],
            "input_pdbqt_hydrogen_atom_serial": entry["input_pdbqt_atom_serial"],
            "input_pdbqt_parent_atom_index": parent["input_pdbqt_atom_index"],
            "input_pdbqt_parent_atom_serial": parent["input_pdbqt_atom_serial"],
            "parent_element": parent["element"],
            "hydrogen_autodock_atom_type": entry["autodock_atom_type"],
        })
    return {
        "schema_version": PDBQT_PROVENANCE_SCHEMA_VERSION,
        "mapping_method": (
            "exact preparation-time SDF conformer to Open Babel PDBQT coordinate identity; "
            "polar-hydrogen parent taken from the explicit SDF bond"
        ),
        "coordinate_tolerance_angstrom": PREPARATION_COORDINATE_TOLERANCE_ANGSTROM,
        "input_pdbqt_sha256": hashlib.sha256(pdbqt_bytes).hexdigest(),
        "input_pdbqt_size_bytes": len(pdbqt_bytes),
        "atom_count": len(entries),
        "heavy_atom_count": sum(entry["element"] != "H" for entry in entries),
        "polar_hydrogen_count": len(polar_hydrogens),
        "entries": entries,
        "polar_hydrogens": polar_hydrogens,
    }


def resolve_template_pose_mapping_v2(
    template_path: str | Path,
    input_pdbqt_path: str | Path,
    extracted_pose: Mapping[str, object],
) -> tuple[dict[str, object], dict[str, object]]:
    """Propagate preparation-time atom identity through a verified Vina MODEL."""

    provenance = build_ligand_input_pdbqt_provenance(template_path, input_pdbqt_path)
    input_atoms = _parse_pdbqt_atoms(
        Path(input_pdbqt_path).read_text(encoding="utf-8"),
        failure_code="ligand_input_pdbqt_mapping_failed",
    )
    pose_atoms = extracted_pose.get("atoms")
    if not isinstance(pose_atoms, list) or len(pose_atoms) != len(input_atoms):
        raise InteractionAnalysisInputError(
            "template_pose_mapping_failed", "Vina MODEL atom count differs from its input PDBQT."
        )
    identity_fields = ("serial", "atom_name", "atom_type", "element")
    for index, (input_atom, pose_atom) in enumerate(zip(input_atoms, pose_atoms, strict=True)):
        if any(input_atom[field] != pose_atom[field] for field in identity_fields):
            raise InteractionAnalysisInputError(
                "template_pose_mapping_failed",
                f"Vina MODEL atom identity differs from input PDBQT at index {index}.",
            )
    entries = []
    for entry in provenance["entries"]:
        if entry["element"] == "H":
            continue
        pose_index = int(entry["input_pdbqt_atom_index"])
        entries.append({
            "template_atom_index": entry["template_atom_index"],
            "input_pdbqt_atom_index": pose_index,
            "input_pdbqt_atom_serial": entry["input_pdbqt_atom_serial"],
            "pose_pdbqt_atom_index": pose_index,
            "pose_pdbqt_atom_serial": pose_atoms[pose_index]["serial"],
            "element": entry["element"],
            "autodock_atom_type": entry["autodock_atom_type"],
        })
    polar_hydrogens = []
    for hydrogen in provenance["polar_hydrogens"]:
        pose_index = int(hydrogen["input_pdbqt_hydrogen_atom_index"])
        polar_hydrogens.append({
            **hydrogen,
            "pose_pdbqt_hydrogen_atom_index": pose_index,
            "pose_pdbqt_hydrogen_atom_serial": pose_atoms[pose_index]["serial"],
            "pose_pdbqt_parent_atom_index": hydrogen["input_pdbqt_parent_atom_index"],
            "pose_pdbqt_parent_atom_serial": hydrogen["input_pdbqt_parent_atom_serial"],
        })
    validation = resolve_template_pose_mapping(template_path, extracted_pose)["validation"]
    validation.update({
        "input_pdbqt_sha256": "passed",
        "vina_atom_order": "passed",
        "vina_atom_serials": "passed",
        "vina_atom_names": "passed",
        "vina_autodock_atom_types": "passed",
        "polar_hydrogen_identity": "passed",
    })
    return ({
        "schema_version": MAPPING_SCHEMA_VERSION_V2,
        "mapping_method": (
            "direct SDF-to-input-PDBQT preparation provenance followed by verified Vina "
            "serial/order/name/AutoDock-type preservation"
        ),
        "rdkit_version": rdBase.rdkitVersion,
        "positional_identity_assumed": False,
        "hydrogen_mapping_policy": "explicit SDF hydrogen parent propagated through PDBQT/Vina identity",
        "heavy_atom_count": len(entries),
        "polar_hydrogen_count": len(polar_hydrogens),
        "entries": sorted(entries, key=lambda item: int(item["template_atom_index"])),
        "polar_hydrogen_entries": polar_hydrogens,
        "coordinate_tiebreaker": {
            "status": "not_used",
            "reason": "direct preparation identity has priority over graph automorphism geometry",
        },
        "validation": validation,
    }, provenance)


def build_interaction_analysis_input(
    *,
    docking_result: Mapping[str, object],
    ligand_template_path: str | Path,
    ligand_template_metadata_path: str | Path,
    pose_path: str | Path,
    mode_number: int,
    prepared_receptor_pdbqt_path: str | Path,
    meeko_input_pdb_path: str | Path,
    receptor_preparation_provenance_path: str | Path,
    ligand_input_pdbqt_path: str | Path | None = None,
) -> dict[str, object]:
    """Build a v1 historical or direct-provenance v2 immutable input contract."""

    template_path = Path(ligand_template_path)
    metadata_path = Path(ligand_template_metadata_path)
    if not template_path.is_file() or not metadata_path.is_file():
        raise InteractionAnalysisInputError("ligand_template_missing", "Ligand template artifacts are missing.")
    try:
        template_metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise InteractionAnalysisInputError("ligand_template_hash_mismatch", "Template metadata is invalid.") from exc
    if template_metadata.get("artifact_schema_version") != LIGAND_TEMPLATE_SCHEMA_VERSION:
        raise InteractionAnalysisInputError("ligand_template_hash_mismatch", "Template schema is unsupported.")
    template_sha = hashlib.sha256(template_path.read_bytes()).hexdigest()
    if template_metadata.get("sdf_sha256") != template_sha:
        raise InteractionAnalysisInputError("ligand_template_hash_mismatch", "Ligand template SHA-256 mismatch.")

    docking_job_id = str(template_metadata.get("docking_job_id") or "")
    extracted = extract_vina_pose_model(pose_path, mode_number, docking_job_id=docking_job_id)
    expected_pose_sha = docking_result.get("pose_sha256")
    if expected_pose_sha and extracted["parent_pose_sha256"] != expected_pose_sha:
        raise InteractionAnalysisInputError("pose_parse_failed", "Authoritative pose SHA-256 mismatch.")
    if ligand_input_pdbqt_path is None:
        mapping = resolve_template_pose_mapping(template_path, extracted)
        input_pdbqt_provenance = None
        schema_version = INPUT_SCHEMA_VERSION
    else:
        mapping, input_pdbqt_provenance = resolve_template_pose_mapping_v2(
            template_path, ligand_input_pdbqt_path, extracted
        )
        expected_pdbqt_sha = template_metadata.get("input_pdbqt_sha256")
        if expected_pdbqt_sha and expected_pdbqt_sha != input_pdbqt_provenance["input_pdbqt_sha256"]:
            raise InteractionAnalysisInputError(
                "ligand_input_pdbqt_hash_mismatch", "Pre-docking PDBQT SHA-256 mismatch."
            )
        schema_version = INPUT_SCHEMA_VERSION_V2
    receptor = _build_receptor_analysis_region(
        prepared_receptor_pdbqt_path,
        meeko_input_pdb_path,
        receptor_preparation_provenance_path,
        extracted["atoms"],
    )
    payload = {
        "schema_version": schema_version,
        "docking_job_id": docking_job_id,
        "receptor_identity": docking_result.get("receptor_id"),
        "authoritative_receptor_sha256": receptor["authoritative_receptor_sha256"],
        "receptor_analysis": receptor,
        "ligand_template": template_metadata,
        "pose": {key: value for key, value in extracted.items() if key != "atoms"},
        "template_pose_atom_mapping": mapping,
        "ligand_preparation_provenance": {
            "rdkit_version": template_metadata.get("rdkit_version"),
            "conformer_generation_method": template_metadata.get("conformer_generation_method"),
            "conformer_seed": template_metadata.get("conformer_seed"),
            "optimization_method": template_metadata.get("optimization_method"),
            "explicit_hydrogen_policy": template_metadata.get("explicit_hydrogen_policy"),
            "openbabel_version": docking_result.get("obabel_version"),
        },
        "receptor_preparation_provenance": receptor["preparation_provenance"],
        "tool_versions": {
            "rdkit_template_producer": template_metadata.get("rdkit_version"),
            "rdkit_contract_builder": rdBase.rdkitVersion,
            "openbabel": docking_result.get("obabel_version"),
            "vina": docking_result.get("vina_version"),
        },
        "scientific_limitations": [
            "protonation_status=not_scientifically_resolved",
            "No interactions or fingerprints are calculated by this contract builder.",
            "Metal/cofactor interaction typing is unsupported in v1.",
            "The 8 A pocket policy is qualified only for ProLIF 2.2.3 default interactions.",
        ],
    }
    if input_pdbqt_provenance is not None:
        payload["ligand_input_pdbqt"] = input_pdbqt_provenance
    return payload


def write_interaction_analysis_input(path: str | Path, payload: Mapping[str, object]) -> None:
    """Atomically create, but never replace, a versioned analysis-input artifact."""

    destination = Path(path)
    content = (json.dumps(payload, indent=2, sort_keys=True) + "\n").encode("utf-8")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if destination.read_bytes() != content:
            raise InteractionAnalysisInputError(
                "receptor_analysis_input_failed", "Immutable analysis input already has different content."
            )
        return
    handle, temporary_name = tempfile.mkstemp(prefix=f".{destination.name}.", dir=destination.parent)
    try:
        with os.fdopen(handle, "wb") as temporary:
            temporary.write(content)
            temporary.flush()
            os.fsync(temporary.fileno())
        try:
            os.link(temporary_name, destination)
        except FileExistsError:
            if destination.read_bytes() != content:
                raise InteractionAnalysisInputError(
                    "receptor_analysis_input_failed",
                    "Immutable analysis input already has different content.",
                )
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)


def _build_receptor_analysis_region(
    prepared_path: str | Path,
    meeko_input_path: str | Path,
    provenance_path: str | Path,
    pose_atoms: object,
) -> dict[str, object]:
    prepared = Path(prepared_path)
    meeko_input = Path(meeko_input_path)
    provenance_file = Path(provenance_path)
    if not all(path.is_file() for path in (prepared, meeko_input, provenance_file)):
        raise InteractionAnalysisInputError(
            "unsupported_receptor_artifact", "Qualified prepared PDBQT, meeko_input.pdb, and provenance are required."
        )
    try:
        provenance = json.loads(provenance_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise InteractionAnalysisInputError(
            "unsupported_receptor_artifact", "Receptor preparation provenance is invalid."
        ) from exc
    receptor_sha = hashlib.sha256(prepared.read_bytes()).hexdigest()
    if provenance.get("prepared_pdbqt_sha256") != receptor_sha:
        raise InteractionAnalysisInputError(
            "unsupported_receptor_artifact", "Prepared receptor SHA-256 does not match provenance."
        )
    if provenance.get("protonation_status") != "not_scientifically_resolved":
        raise InteractionAnalysisInputError(
            "unsupported_receptor_artifact", "Receptor protonation limitation is missing or changed."
        )
    prepared_atoms = _parse_pdbqt_atoms(prepared.read_text(encoding="utf-8"), failure_code="unsupported_receptor_artifact")
    pdb_atoms = _parse_pdb_atoms(meeko_input.read_text(encoding="utf-8"))
    _validate_receptor_coordinate_identity(pdb_atoms, prepared_atoms)
    if not isinstance(pose_atoms, list):
        raise InteractionAnalysisInputError("receptor_analysis_input_failed", "Pose atom records are invalid.")
    ligand_heavy = [atom for atom in pose_atoms if atom["element"] != "H"]
    receptor_heavy = [atom for atom in prepared_atoms if atom["element"] != "H"]
    selected_residues = {
        _residue_key(atom)
        for atom in receptor_heavy
        if any(_distance(atom["coordinates"], ligand["coordinates"]) <= POCKET_CUTOFF_ANGSTROM for ligand in ligand_heavy)
    }
    if not selected_residues:
        raise InteractionAnalysisInputError(
            "receptor_analysis_input_failed", "No receptor residues fall within the qualified pocket cutoff."
        )
    selected_atoms = [atom for atom in prepared_atoms if _residue_key(atom) in selected_residues]
    residue_records = []
    for key in sorted(selected_residues):
        atoms = [atom for atom in selected_atoms if _residue_key(atom) == key]
        elements = {str(atom["element"]) for atom in atoms}
        residue_name = key[1]
        kind = "protein" if residue_name in _STANDARD_PROTEIN_RESIDUES else "heterogroup"
        residue_records.append({
            "chain_id": key[0], "residue_name": residue_name,
            "residue_number": key[2], "insertion_code": key[3],
            "classification": kind,
            "metal_or_cofactor_interaction_typing": (
                "unsupported" if kind == "heterogroup" or elements & _METAL_ELEMENTS else "not_applicable"
            ),
            "atom_count": len(atoms),
        })
    return {
        "policy_version": RECEPTOR_POLICY_VERSION,
        "authoritative_receptor_sha256": receptor_sha,
        "topology_source_sha256": hashlib.sha256(meeko_input.read_bytes()).hexdigest(),
        "selection_method": "minimum heavy-atom distance from selected docked pose",
        "distance_cutoff_angstrom": POCKET_CUTOFF_ANGSTROM,
        "cutoff_basis": POCKET_CUTOFF_BASIS,
        "complete_residue_inclusion": True,
        "residue_identity_fields": ["chain_id", "residue_name", "residue_number", "insertion_code"],
        "heterogroup_policy": "preserve only groups retained in authoritative prepared PDBQT; never reintroduce removed groups",
        "metal_cofactor_policy": "preserve trustworthy retained records; interaction typing unsupported",
        "hydrogen_source": "Meeko prepared receptor PDBQT polar hydrogens",
        "element_normalization": "AutoDock atom type to periodic-table element mapping v1",
        "protonation_status": "not_scientifically_resolved",
        "selected_residues": residue_records,
        "selected_atom_records": selected_atoms,
        "preparation_provenance": _scientific_receptor_provenance(provenance),
    }


def _parse_pdbqt_atoms(text: str, *, failure_code: str) -> list[dict[str, object]]:
    atoms = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        if not line.startswith(_ATOM_PREFIXES):
            continue
        try:
            serial = int(line[6:11])
            coordinates = [float(line[start:end]) for start, end in ((30, 38), (38, 46), (46, 54))]
            atom_type = line[77:].strip().upper()
        except (ValueError, IndexError) as exc:
            raise InteractionAnalysisInputError(failure_code, f"Malformed PDBQT atom record at line {line_number}.") from exc
        element = _AUTODOCK_ELEMENTS.get(atom_type)
        if element is None or not all(math.isfinite(value) for value in coordinates):
            raise InteractionAnalysisInputError(failure_code, f"Unsupported PDBQT atom type or coordinates at line {line_number}.")
        atoms.append({
            "pose_pdbqt_atom_index": len(atoms), "serial": serial,
            "atom_name": line[12:16].strip(), "residue_name": line[17:20].strip(),
            "chain_id": line[21:22].strip(), "residue_number": line[22:26].strip(),
            "insertion_code": line[26:27].strip(), "record_type": line[0:6].strip(),
            "atom_type": atom_type, "element": element, "coordinates": coordinates,
            "original_record": line,
        })
    if not atoms:
        raise InteractionAnalysisInputError(failure_code, "PDBQT contains no atom records.")
    return atoms


def _parse_pdb_atoms(text: str) -> list[dict[str, object]]:
    atoms = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        if not line.startswith(_ATOM_PREFIXES):
            continue
        try:
            coordinates = [float(line[start:end]) for start, end in ((30, 38), (38, 46), (46, 54))]
        except (ValueError, IndexError) as exc:
            raise InteractionAnalysisInputError("unsupported_receptor_artifact", f"Malformed meeko_input atom at line {line_number}.") from exc
        element = line[76:78].strip().title() if len(line) >= 78 else ""
        if not element:
            element = "".join(character for character in line[12:16] if character.isalpha())[:1].title()
        atoms.append({
            "atom_name": line[12:16].strip(), "residue_name": line[17:20].strip(),
            "chain_id": line[21:22].strip(), "residue_number": line[22:26].strip(),
            "insertion_code": line[26:27].strip(), "element": element,
            "coordinates": coordinates,
        })
    if not atoms:
        raise InteractionAnalysisInputError("unsupported_receptor_artifact", "meeko_input.pdb has no atoms.")
    return atoms


def _validate_receptor_coordinate_identity(
    pdb_atoms: Sequence[Mapping[str, object]], pdbqt_atoms: Sequence[Mapping[str, object]]
) -> None:
    def identity(atom: Mapping[str, object]) -> tuple[object, ...]:
        return (
            atom["chain_id"], atom["residue_name"], atom["residue_number"],
            atom["insertion_code"], atom["atom_name"],
        )
    pdb_heavy = {identity(atom): atom for atom in pdb_atoms if atom["element"] != "H"}
    pdbqt_heavy = {identity(atom): atom for atom in pdbqt_atoms if atom["element"] != "H"}
    if len(pdb_heavy) != len([atom for atom in pdb_atoms if atom["element"] != "H"]) or len(pdbqt_heavy) != len([atom for atom in pdbqt_atoms if atom["element"] != "H"]):
        raise InteractionAnalysisInputError("unsupported_receptor_artifact", "Receptor atom identities are not unique.")
    if pdb_heavy.keys() != pdbqt_heavy.keys():
        raise InteractionAnalysisInputError("unsupported_receptor_artifact", "Meeko input and prepared receptor heavy-atom identities differ.")
    for key in pdb_heavy:
        left, right = pdb_heavy[key], pdbqt_heavy[key]
        if left["element"] != right["element"] or any(
            abs(float(a) - float(b)) > 0.001
            for a, b in zip(left["coordinates"], right["coordinates"], strict=True)
        ):
            raise InteractionAnalysisInputError("unsupported_receptor_artifact", "Meeko input and prepared receptor heavy-atom coordinates differ.")


def _scientific_receptor_provenance(provenance: Mapping[str, object]) -> dict[str, object]:
    """Retain scientific identity while excluding invocation paths and diagnostics."""

    fields = (
        "schema_version", "receptor_id", "original_filename", "original_pdb_sha256",
        "preparation_input", "selected_chains", "water_policy", "removed_waters",
        "retained_waters", "excluded_hetero_groups", "retained_hetero_groups",
        "bound_ligand_selection", "bound_ligand_excluded", "alternate_location_policy",
        "alternate_location_choices", "pocket_definition_method", "pocket",
        "reference_ligand_id", "ligand_removal_ids", "repair_policy", "repair_validation",
        "input_explicit_hydrogen_atom_count", "hydrogen_handling_method",
        "hydrogen_handling_status", "final_pdbqt_hydrogen_representation",
        "final_pdbqt_hydrogen_policy", "hydrogen_optimization", "protonation_status",
        "receptor_preparation_tool", "meeko_version", "gemmi_version",
        "selected_receptor_atom_count", "prepared_receptor_atom_count",
        "prepared_pdbqt_filename", "prepared_pdbqt_sha256", "prepared_pdbqt_size_bytes",
        "validation_status", "validation_result", "warnings",
    )
    return {field: provenance[field] for field in fields if field in provenance}


def _rdkit_connectivity_molecule(atoms: Sequence[Mapping[str, object]]) -> Chem.Mol:
    editable = Chem.RWMol()
    conformer = Chem.Conformer(len(atoms))
    for index, atom_record in enumerate(atoms):
        atom = Chem.Atom(str(atom_record["element"]))
        atom.SetNoImplicit(True)
        atom.SetIntProp("pose_pdbqt_atom_index", int(atom_record["pose_pdbqt_atom_index"]))
        atom.SetIntProp("pose_pdbqt_atom_serial", int(atom_record["serial"]))
        editable.AddAtom(atom)
        x, y, z = (float(value) for value in atom_record["coordinates"])
        conformer.SetAtomPosition(index, (x, y, z))
    molecule = editable.GetMol()
    molecule.AddConformer(conformer)
    try:
        rdDetermineBonds.DetermineConnectivity(molecule)
    except Exception as exc:
        raise InteractionAnalysisInputError(
            "template_pose_mapping_failed", "RDKit could not reconstruct pose connectivity."
        ) from exc
    return molecule


def _connectivity_query(template: Chem.Mol) -> Chem.Mol:
    query = Chem.RWMol()
    for atom in template.GetAtoms():
        query_atom = Chem.Atom(atom.GetSymbol())
        query_atom.SetNoImplicit(True)
        query.AddAtom(query_atom)
    for bond in template.GetBonds():
        query.AddBond(bond.GetBeginAtomIdx(), bond.GetEndAtomIdx(), Chem.BondType.UNSPECIFIED)
    return query.GetMol()


def _reconstruct_pose_chemistry(template: Chem.Mol, pose: Chem.Mol, match: Sequence[int]) -> Chem.Mol:
    reverse = {pose_index: template_index for template_index, pose_index in enumerate(match)}
    editable = Chem.RWMol()
    for pose_index in range(pose.GetNumAtoms()):
        editable.AddAtom(Chem.Atom(template.GetAtomWithIdx(reverse[pose_index])))
    for bond in template.GetBonds():
        begin = match[bond.GetBeginAtomIdx()]
        end = match[bond.GetEndAtomIdx()]
        editable.AddBond(begin, end, bond.GetBondType())
        new_bond = editable.GetBondBetweenAtoms(begin, end)
        new_bond.SetIsAromatic(bond.GetIsAromatic())
    reconstructed = editable.GetMol()
    reconstructed.AddConformer(Chem.Conformer(pose.GetConformer()), assignId=True)
    try:
        Chem.SanitizeMol(reconstructed)
    except Exception as exc:
        raise InteractionAnalysisInputError(
            "template_pose_mapping_failed", "Template chemistry could not be applied to the pose graph."
        ) from exc
    return reconstructed


def _alignment_rmsd(pose: Chem.Mol, template: Chem.Mol, match: Sequence[int]) -> float:
    """Compare graph-valid maps; coordinates never create a graph candidate."""

    probe = Chem.Mol(pose)
    try:
        return float(rdMolAlign.AlignMol(
            probe,
            template,
            atomMap=[(pose_index, template_index) for template_index, pose_index in enumerate(match)],
        ))
    except Exception as exc:
        raise InteractionAnalysisInputError(
            "template_pose_mapping_failed", "Graph automorphisms could not be geometrically disambiguated."
        ) from exc


def _validate_reconstructed_chemistry(
    template: Chem.Mol, reconstructed: Chem.Mol, match: Sequence[int]
) -> dict[str, object]:
    reverse = {pose_index: template_index for template_index, pose_index in enumerate(match)}
    for pose_index, template_index in reverse.items():
        left = template.GetAtomWithIdx(template_index)
        right = reconstructed.GetAtomWithIdx(pose_index)
        if (left.GetSymbol(), left.GetFormalCharge(), left.GetIsAromatic()) != (
            right.GetSymbol(), right.GetFormalCharge(), right.GetIsAromatic()
        ):
            raise InteractionAnalysisInputError("template_pose_mapping_failed", "Mapped atom chemistry differs.")
    for bond in reconstructed.GetBonds():
        left = template.GetBondBetweenAtoms(
            reverse[bond.GetBeginAtomIdx()], reverse[bond.GetEndAtomIdx()]
        )
        if left is None or (left.GetBondType(), left.GetIsAromatic()) != (
            bond.GetBondType(), bond.GetIsAromatic()
        ):
            raise InteractionAnalysisInputError("template_pose_mapping_failed", "Mapped bond chemistry differs.")
    template_smiles = Chem.MolToSmiles(template, canonical=True, isomericSmiles=True)
    reconstructed_smiles = Chem.MolToSmiles(reconstructed, canonical=True, isomericSmiles=True)
    if template_smiles != reconstructed_smiles:
        raise InteractionAnalysisInputError("template_pose_mapping_failed", "Mapped stereochemical graph identity differs.")
    return {
        "heavy_atom_count": "passed", "atomic_elements": "passed",
        "graph_isomorphism": "passed", "bond_orders": "passed",
        "aromaticity": "passed", "formal_charges": "passed",
        "canonical_isomeric_smiles": "passed",
        "canonical_isomeric_smiles_value": template_smiles,
    }


def _residue_key(atom: Mapping[str, object]) -> tuple[str, str, str, str]:
    return (
        str(atom["chain_id"]), str(atom["residue_name"]),
        str(atom["residue_number"]), str(atom["insertion_code"]),
    )


def _distance(left: object, right: object) -> float:
    if not isinstance(left, list) or not isinstance(right, list):
        return math.inf
    return math.sqrt(sum((float(a) - float(b)) ** 2 for a, b in zip(left, right, strict=True)))
