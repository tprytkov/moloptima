"""Isolated ProLIF 2.2.3 runner for MolOptima pose fingerprints."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import platform
import sys
import time
from pathlib import Path

import prolif as plf
from prolif.io import MoleculeStandardizer
from rdkit import Chem
from rdkit.Geometry import Point3D


REQUEST_SCHEMA = "moloptima-prolif-runner-request-v1"
OUTPUT_SCHEMA = "moloptima-interaction-fingerprint-v1"
RAW_SCHEMA = "moloptima-raw-interaction-record-v1"
RUNNER_VERSION = "1.0.0"
SUPPORTED_INPUT = "moloptima-interaction-analysis-input-v1"
SUPPORTED_INPUT_V2 = "moloptima-interaction-analysis-input-v2"
SUPPORTED_POSE = "moloptima-vina-pose-model-v1"
SUPPORTED_MAPPING = "moloptima-template-pose-atom-mapping-v1"
SUPPORTED_MAPPING_V2 = "moloptima-template-pose-atom-mapping-v2"
SUPPORTED_POLICY = "moloptima-complete-residue-pocket-v1"
PROTONATION_STATUS = "not_scientifically_resolved"
INTERACTIONS = (
    "Hydrophobic", "HBDonor", "HBAcceptor", "PiStacking", "Anionic",
    "Cationic", "CationPi", "PiCation", "VdWContact",
)
DIRECTIONS = {
    "HBDonor": "ligand_donor",
    "HBAcceptor": "ligand_acceptor",
    "Anionic": "ligand_anion",
    "Cationic": "ligand_cation",
    "CationPi": "ligand_cation",
    "PiCation": "ligand_pi",
}
AUTODOCK_ELEMENTS = {
    "A": "C", "C": "C", "N": "N", "NA": "N", "O": "O", "OA": "O",
    "S": "S", "SA": "S", "P": "P", "F": "F", "Cl": "Cl", "Br": "Br",
    "I": "I", "H": "H", "HD": "H",
}


class RunnerError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _canonical_hash(value: object) -> str:
    return _sha256_bytes(json.dumps(value, sort_keys=True, separators=(",", ":")).encode())


def _versions() -> dict[str, str]:
    packages = (
        "prolif", "MDAnalysis", "gemmi", "rdkit", "numpy", "pandas", "scipy",
        "networkx", "tqdm", "multiprocess", "dill", "psutil",
    )
    versions = {"python": platform.python_version(), **{
        name: importlib.metadata.version(name) for name in packages
    }}
    # Conda metadata normalizes the zero-padded RDKit release component; the
    # toolkit's own version is the frozen scientific identity.
    from rdkit import rdBase
    versions["rdkit"] = rdBase.rdkitVersion
    return versions


def _parse_pose_atoms(model_text: str) -> list[dict[str, object]]:
    atoms = []
    for line in model_text.splitlines():
        if not line.startswith(("ATOM  ", "HETATM")):
            continue
        try:
            atom_type = line[77:].split()[0]
            element = AUTODOCK_ELEMENTS[atom_type]
            xyz = [float(line[30:38]), float(line[38:46]), float(line[46:54])]
            serial = int(line[6:11])
        except (IndexError, KeyError, ValueError) as exc:
            raise RunnerError("interaction_input_invalid", "pose contains an invalid PDBQT atom") from exc
        atoms.append({"element": element, "xyz": xyz, "serial": serial})
    if not atoms:
        raise RunnerError("interaction_input_invalid", "pose contains no PDBQT atoms")
    return atoms


def _load_template(path: Path, contract: dict[str, object]) -> tuple[Chem.Mol, dict[str, object]]:
    if not path.is_file() or _sha256_file(path) != contract["ligand_template"].get("sdf_sha256"):
        raise RunnerError("interaction_input_invalid", "ligand-template SHA-256 does not match")
    supplier = Chem.SDMolSupplier(str(path), removeHs=False)
    molecule = next((mol for mol in supplier if mol is not None), None)
    if molecule is None:
        raise RunnerError("interaction_input_invalid", "ligand template cannot be parsed")
    heavy = Chem.RemoveHs(molecule)
    actual_smiles = Chem.MolToSmiles(heavy, canonical=True, isomericSmiles=True)
    expected_smiles = contract["template_pose_atom_mapping"].get("validation", {}).get(
        "canonical_isomeric_smiles_value"
    ) or contract["ligand_template"].get("canonical_isomeric_smiles")
    if expected_smiles != actual_smiles:
        raise RunnerError("interaction_runtime_incompatible", "cross-RDKit canonical chemistry differs")
    mapping = contract["template_pose_atom_mapping"]
    if mapping.get("heavy_atom_count") != heavy.GetNumAtoms() or len(mapping.get("entries", [])) != heavy.GetNumAtoms():
        raise RunnerError("interaction_input_invalid", "template/pose mapping atom count differs")
    elements = [atom.GetSymbol() for atom in heavy.GetAtoms()]
    mapped = sorted(mapping["entries"], key=lambda item: item["template_atom_index"])
    if [item.get("element") for item in mapped] != elements:
        raise RunnerError("interaction_runtime_incompatible", "cross-RDKit element interpretation differs")
    return molecule, {
        "status": "passed",
        "heavy_atom_count": heavy.GetNumAtoms(),
        "elements": elements,
        "canonical_isomeric_smiles": actual_smiles,
        "bond_orders": sorted(str(bond.GetBondType()) for bond in heavy.GetBonds()),
        "aromatic_atom_indices": [atom.GetIdx() for atom in heavy.GetAtoms() if atom.GetIsAromatic()],
        "formal_charges": [atom.GetFormalCharge() for atom in heavy.GetAtoms()],
        "graph_isomorphism": "validated_by_frozen_mapping_and_canonical_chemistry",
    }


def _build_ligand(
    template: Chem.Mol,
    pose_atoms: list[dict[str, object]],
    mapping: dict[str, object],
) -> tuple[plf.Molecule, dict[int, dict[str, int | None]]]:
    heavy = Chem.RemoveHs(template)
    editable = Chem.RWMol(heavy)
    old_conf = heavy.GetConformer()
    conf = Chem.Conformer(heavy.GetNumAtoms())
    for index in range(heavy.GetNumAtoms()):
        conf.SetAtomPosition(index, old_conf.GetAtomPosition(index))
    pose_to_template = {
        int(item["pose_pdbqt_atom_index"]): int(item["template_atom_index"])
        for item in mapping["entries"]
    }
    atom_identity = {
        template_index: {
            "template_atom_index": template_index,
            "pose_atom_index": pose_index,
            "pose_atom_serial": int(pose_atoms[pose_index]["serial"]),
        }
        for pose_index, template_index in pose_to_template.items()
    }
    if set(pose_to_template) != {i for i, atom in enumerate(pose_atoms) if atom["element"] != "H"}:
        raise RunnerError("interaction_input_invalid", "pose heavy atoms do not match the frozen mapping")
    for pose_index, template_index in pose_to_template.items():
        conf.SetAtomPosition(template_index, Point3D(*pose_atoms[pose_index]["xyz"]))
    hydrogen_entries = mapping.get("polar_hydrogen_entries")
    if mapping.get("schema_version") == SUPPORTED_MAPPING_V2:
        if not isinstance(hydrogen_entries, list):
            raise RunnerError("interaction_input_invalid", "v2 polar-hydrogen provenance is missing")
        by_pose_index = {
            int(entry["pose_pdbqt_hydrogen_atom_index"]): entry for entry in hydrogen_entries
        }
        if set(by_pose_index) != {i for i, atom in enumerate(pose_atoms) if atom["element"] == "H"}:
            raise RunnerError("interaction_input_invalid", "v2 polar-hydrogen identity differs from pose")
    else:
        by_pose_index = {}
    for pose_index, atom in enumerate(pose_atoms):
        if atom["element"] != "H":
            continue
        if mapping.get("schema_version") == SUPPORTED_MAPPING_V2:
            hydrogen_entry = by_pose_index[pose_index]
            parent_pose_index = int(hydrogen_entry["pose_pdbqt_parent_atom_index"])
            parent_template_index = int(hydrogen_entry["template_parent_atom_index"])
            if pose_to_template.get(parent_pose_index) != parent_template_index:
                raise RunnerError("interaction_input_invalid", "v2 hydrogen-parent identity is inconsistent")
        else:
            candidates = sorted(
                (sum((atom["xyz"][axis] - other["xyz"][axis]) ** 2 for axis in range(3)), index)
                for index, other in enumerate(pose_atoms) if other["element"] != "H"
            )
            distance_squared, parent_pose_index = candidates[0]
            if distance_squared ** 0.5 > 1.30 or parent_pose_index not in pose_to_template:
                raise RunnerError("interaction_input_invalid", "polar-hydrogen parent mapping is ambiguous")
            parent_template_index = pose_to_template[parent_pose_index]
        hydrogen_index = editable.AddAtom(Chem.Atom(1))
        editable.AddBond(parent_template_index, hydrogen_index, Chem.BondType.SINGLE)
        enlarged = Chem.Conformer(editable.GetNumAtoms())
        for index in range(conf.GetNumAtoms()):
            enlarged.SetAtomPosition(index, conf.GetAtomPosition(index))
        enlarged.SetAtomPosition(hydrogen_index, Point3D(*atom["xyz"]))
        conf = enlarged
        atom_identity[hydrogen_index] = {
            "template_atom_index": (
                int(hydrogen_entry["template_hydrogen_atom_index"])
                if mapping.get("schema_version") == SUPPORTED_MAPPING_V2 else None
            ),
            "pose_atom_index": pose_index,
            "pose_atom_serial": int(atom["serial"]),
        }
    molecule = editable.GetMol()
    molecule.RemoveAllConformers()
    molecule.AddConformer(conf)
    try:
        Chem.SanitizeMol(molecule)
    except Exception as exc:
        raise RunnerError(
            "interaction_runtime_incompatible",
            f"pose ligand reconstruction failed: {type(exc).__name__}: {exc}",
        ) from exc
    return plf.Molecule.from_rdkit(molecule), atom_identity


def _pdb_line(record: dict[str, object]) -> str:
    original = str(record["original_record"])
    return (original[:66] + "          " + str(record["element"]).rjust(2))[:78]


def _build_receptor(records: list[dict[str, object]]) -> tuple[plf.Molecule, list[dict[str, object]]]:
    groups: dict[tuple[str, str, str, str], list[dict[str, object]]] = {}
    for record in records:
        key = (
            str(record["chain_id"]), str(record["residue_name"]),
            str(record["residue_number"]), str(record["insertion_code"]),
        )
        groups.setdefault(key, []).append(record)
    projected: dict[tuple[str, str, str], str] = {}
    for chain, name, number, insertion in groups:
        key = (chain, name, number)
        if key in projected and projected[key] != insertion:
            raise RunnerError(
                "interaction_input_invalid",
                "ProLIF residue identity cannot preserve colliding insertion codes",
            )
        projected[key] = insertion
    combined = None
    ordered_records = []
    for key, residue_records in groups.items():
        block = "\n".join(_pdb_line(record) for record in residue_records) + "\nEND\n"
        molecule = Chem.MolFromPDBBlock(block, sanitize=False, removeHs=False, proximityBonding=True)
        if molecule is None or molecule.GetNumAtoms() != len(residue_records) or len(Chem.GetMolFrags(molecule)) != 1:
            raise RunnerError("interaction_input_invalid", f"complete residue {key} cannot be reconstructed")
        try:
            Chem.SanitizeMol(molecule)
        except Exception as exc:
            raise RunnerError("interaction_input_invalid", f"complete residue {key} has invalid topology") from exc
        combined = molecule if combined is None else Chem.CombineMols(combined, molecule)
        ordered_records.extend(residue_records)
    if combined is None:
        raise RunnerError("interaction_input_invalid", "receptor pocket contains no residues")
    try:
        standardized = MoleculeStandardizer()(combined)
    except Exception as exc:
        raise RunnerError("interaction_input_invalid", "standard amino-acid template reconstruction failed") from exc
    return standardized, ordered_records


def _normalize(value: object) -> object:
    if isinstance(value, dict):
        return {str(key): _normalize(item) for key, item in sorted(value.items())}
    if isinstance(value, (list, tuple)):
        return [_normalize(item) for item in value]
    if isinstance(value, float):
        return round(value, 8)
    return value


def _validate_request(request: dict[str, object]) -> dict[str, object]:
    if request.get("schema_version") != REQUEST_SCHEMA or not isinstance(request.get("analysis_input"), dict):
        raise RunnerError("interaction_input_invalid", "unsupported runner request schema")
    contract = request["analysis_input"]
    if contract.get("schema_version") not in {SUPPORTED_INPUT, SUPPORTED_INPUT_V2}:
        raise RunnerError("interaction_input_invalid", "unsupported analysis-input schema")
    pose, mapping, receptor = contract.get("pose", {}), contract.get("template_pose_atom_mapping", {}), contract.get("receptor_analysis", {})
    if pose.get("schema_version") != SUPPORTED_POSE or mapping.get("schema_version") not in {
        SUPPORTED_MAPPING, SUPPORTED_MAPPING_V2,
    }:
        raise RunnerError("interaction_input_invalid", "unsupported pose or atom-mapping schema")
    if (
        contract.get("schema_version") == SUPPORTED_INPUT_V2
        and mapping.get("schema_version") != SUPPORTED_MAPPING_V2
    ):
        raise RunnerError("interaction_input_invalid", "v2 input requires v2 atom provenance")
    validation = mapping.get("validation", {})
    required_mapping_checks = (
        "heavy_atom_count", "atomic_elements", "graph_isomorphism", "bond_orders",
        "aromaticity", "formal_charges", "canonical_isomeric_smiles",
    )
    if (
        not isinstance(validation, dict)
        or any(validation.get(check) != "passed" for check in required_mapping_checks)
        or mapping.get("positional_identity_assumed") is not False
    ):
        raise RunnerError("interaction_input_invalid", "template/pose mapping is not validated")
    if mapping.get("schema_version") == SUPPORTED_MAPPING_V2 and any(
        validation.get(check) != "passed"
        for check in (
            "input_pdbqt_sha256", "vina_atom_order", "vina_atom_serials",
            "vina_atom_names", "vina_autodock_atom_types", "polar_hydrogen_identity",
        )
    ):
        raise RunnerError("interaction_input_invalid", "v2 preparation identity is not validated")
    if contract.get("schema_version") == SUPPORTED_INPUT_V2:
        input_provenance = contract.get("ligand_input_pdbqt", {})
        input_path = Path(str(request.get("ligand_input_pdbqt_path", "")))
        if (
            not isinstance(input_provenance, dict)
            or not input_path.is_file()
            or _sha256_file(input_path) != input_provenance.get("input_pdbqt_sha256")
        ):
            raise RunnerError("interaction_input_invalid", "persisted ligand input PDBQT SHA-256 does not match")
    if receptor.get("policy_version") != SUPPORTED_POLICY or receptor.get("distance_cutoff_angstrom") != 8.0:
        raise RunnerError("interaction_input_invalid", "unsupported receptor-analysis policy")
    if receptor.get("protonation_status") != PROTONATION_STATUS:
        raise RunnerError("interaction_input_invalid", "unsupported protonation provenance")
    model_text = str(pose.get("model_text", ""))
    if _sha256_bytes(model_text.encode()) != pose.get("model_sha256"):
        raise RunnerError("interaction_input_invalid", "selected pose model SHA-256 does not match")
    topology = Path(str(request.get("receptor_topology_path", "")))
    prepared = Path(str(request.get("prepared_receptor_path", "")))
    if not topology.is_file() or _sha256_file(topology) != receptor.get("topology_source_sha256"):
        raise RunnerError("interaction_input_invalid", "receptor topology SHA-256 does not match")
    if not prepared.is_file() or _sha256_file(prepared) != contract.get("authoritative_receptor_sha256"):
        raise RunnerError("interaction_input_invalid", "authoritative receptor SHA-256 does not match")
    return contract


def analyze(request: dict[str, object]) -> dict[str, object]:
    started = time.perf_counter()
    contract = _validate_request(request)
    pose = contract["pose"]
    reconstruction_started = time.perf_counter()
    template, chemistry = _load_template(Path(request["ligand_template_path"]), contract)
    pose_atoms = _parse_pose_atoms(pose["model_text"])
    ligand, ligand_atom_identity = _build_ligand(
        template, pose_atoms, contract["template_pose_atom_mapping"]
    )
    ligand_seconds = time.perf_counter() - reconstruction_started
    receptor_started = time.perf_counter()
    receptor, receptor_records = _build_receptor(contract["receptor_analysis"]["selected_atom_records"])
    receptor_seconds = time.perf_counter() - receptor_started
    extraction_started = time.perf_counter()
    native = plf.Fingerprint(interactions=list(INTERACTIONS), count=True).generate(
        ligand, receptor, metadata=True
    )
    extraction_seconds = time.perf_counter() - extraction_started
    normalization_started = time.perf_counter()
    raw = []
    tokens = set()
    for (_, protein_residue), interactions in native.items():
        chain = protein_residue.chain or "_"
        for interaction_type, occurrences in interactions.items():
            for metadata in occurrences:
                indices = metadata.get("indices", {})
                parent_indices = metadata.get("parent_indices", {})
                ligand_indices = [int(value) for value in indices.get("ligand", ())]
                ligand_identities = [
                    ligand_atom_identity[index] for index in ligand_indices
                    if index in ligand_atom_identity
                ]
                template_indices = sorted(
                    int(identity["template_atom_index"])
                    for identity in ligand_identities
                    if identity["template_atom_index"] is not None
                )
                protein_parent = [int(value) for value in parent_indices.get("protein", ())]
                protein_atoms = [
                    {
                        "record_index": index,
                        "atom_name": receptor_records[index]["atom_name"],
                        "atom_serial": receptor_records[index]["serial"],
                    }
                    for index in protein_parent if 0 <= index < len(receptor_records)
                ]
                insertion_values = {
                    str(receptor_records[index]["insertion_code"])
                    for index in protein_parent if 0 <= index < len(receptor_records)
                }
                if len(insertion_values) > 1:
                    raise RunnerError("interaction_output_malformed", "interaction spans insertion-code identities")
                insertion = next(iter(insertion_values), "")
                direction = DIRECTIONS.get(interaction_type)
                token = f"{chain}:{protein_residue.name}:{protein_residue.number}{insertion}:{interaction_type}"
                if direction:
                    token += f":{direction}"
                tokens.add(token)
                geometry = {
                    key: _normalize(value) for key, value in metadata.items()
                    if key not in {"indices", "parent_indices"}
                }
                raw.append({
                    "schema_version": RAW_SCHEMA,
                    "receptor": {
                        "chain": chain,
                        "residue_name": protein_residue.name,
                        "residue_number": str(protein_residue.number),
                        "insertion_code": insertion,
                        "atoms": protein_atoms,
                    },
                    "ligand": {
                        "template_atom_indices": template_indices,
                        "pose_atoms": [
                            {
                                "pose_atom_index": identity["pose_atom_index"],
                                "pose_atom_serial": identity["pose_atom_serial"],
                            }
                            for identity in ligand_identities
                        ],
                    },
                    "interaction_type": interaction_type,
                    "direction": direction,
                    "geometry": geometry,
                    "engine_native_metadata": _normalize(metadata),
                })
    raw.sort(key=lambda item: (
        item["receptor"]["chain"], item["receptor"]["residue_number"],
        item["receptor"]["insertion_code"], item["receptor"]["residue_name"],
        item["interaction_type"], item["direction"] or "",
        json.dumps(item["engine_native_metadata"], sort_keys=True),
    ))
    sorted_tokens = sorted(tokens)
    normalization_seconds = time.perf_counter() - normalization_started
    versions = _versions()
    result = {
        "schema_version": OUTPUT_SCHEMA,
        "status": "success",
        "receptor": {
            "identity": contract["receptor_identity"],
            "authoritative_sha256": contract["authoritative_receptor_sha256"],
            "policy_version": SUPPORTED_POLICY,
            "protonation_status": PROTONATION_STATUS,
        },
        "ligand": {
            "molecule_id": contract["ligand_template"]["molecule_id"],
            "template_sha256": contract["ligand_template"]["sdf_sha256"],
        },
        "pose": {
            "docking_job_id": contract["docking_job_id"],
            "parent_pose_sha256": pose["parent_pose_sha256"],
            "model_sha256": pose["model_sha256"],
            "model_number": pose["model_number"],
            "mode_number": pose["mode_number"],
            "vina_affinity_kcal_mol": pose["vina_affinity_kcal_mol"],
            "rmsd_lb": pose["rmsd_lb"],
            "rmsd_ub": pose["rmsd_ub"],
        },
        "runtime_provenance": {"runner_version": RUNNER_VERSION, "versions": versions},
        "interaction_configuration": list(INTERACTIONS),
        "mapping_schema_version": contract["template_pose_atom_mapping"]["schema_version"],
        "cross_rdkit_validation": chemistry,
        "raw_interaction_records": raw,
        "canonical_tokens": sorted_tokens,
        "raw_interaction_count": len(raw),
        "unique_token_count": len(sorted_tokens),
        "scientific_limitations": [
            "protonation_status=not_scientifically_resolved",
            "interactions_are_derived_from_computational_docking_poses_not_experimental_evidence",
            "interaction_absence_does_not_prove_physical_absence",
            "docking_pose_uncertainty_is_not_quantified_by_the_fingerprint",
            "metal_and_cofactor_interaction_typing_is_unsupported_in_v1",
        ],
    }
    result["fingerprint_sha256"] = _canonical_hash(result)
    result["performance_seconds"] = {
        "ligand_reconstruction": round(ligand_seconds, 8),
        "receptor_preparation_loading": round(receptor_seconds, 8),
        "interaction_extraction": round(extraction_seconds, 8),
        "normalization_tokenization": round(normalization_seconds, 8),
        "runner_total": round(time.perf_counter() - started, 8),
    }
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--request")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output = Path(args.output)
    try:
        if args.probe:
            payload = {"schema_version": "moloptima-prolif-runtime-probe-v1", "versions": _versions()}
        else:
            if not args.request:
                raise RunnerError("interaction_input_invalid", "request path is required")
            request = json.loads(Path(args.request).read_text(encoding="utf-8"))
            payload = analyze(request)
    except RunnerError as exc:
        payload = {"schema_version": OUTPUT_SCHEMA, "status": "failed", "error_code": exc.code, "message": str(exc)}
    except Exception as exc:
        payload = {"schema_version": OUTPUT_SCHEMA, "status": "failed", "error_code": "interaction_runtime_failed", "message": f"{type(exc).__name__}: {exc}"}
    output.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0 if payload.get("status") != "failed" else 2


if __name__ == "__main__":
    sys.exit(main())
