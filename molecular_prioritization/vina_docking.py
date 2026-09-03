"""Fail-closed local AutoDock Vina batch execution with per-molecule isolation."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from pathlib import Path
from typing import Callable, Iterable

from rdkit import Chem, rdBase
from rdkit.Chem import AllChem

from molecular_prioritization.receptor import ReceptorArtifact, VinaBoxConfig


PROJECT_ROOT = Path(__file__).resolve().parents[1]
VINA_ENV = "MOLOPTIMA_VINA_PATH"
VINA_LEGACY_ENV = "MOLOPTIMA_VINA_EXECUTABLE"
OBABEL_ENV = "MOLOPTIMA_OBABEL_PATH"
OBABEL_LEGACY_ENV = "MOLOPTIMA_OBABEL_EXECUTABLE"
VINA_TIMEOUT_ENV = "MOLOPTIMA_VINA_TIMEOUT_SECONDS"
VINA_RESULT_PREFIX = "REMARK VINA RESULT:"
MODEL_PATTERN = re.compile(r"^MODEL\s+(\d+)\s*$")


class DockingRuntimeUnavailable(RuntimeError):
    """A required local docking executable cannot be validated."""


class DockingCancelled(RuntimeError):
    """The user requested cancellation during the docking stage."""


class VinaDockingEngine:
    def __init__(
        self,
        receptor: ReceptorArtifact,
        config: VinaBoxConfig,
        *,
        output_root: str | Path,
        vina_executable: str | Path | None = None,
        obabel_executable: str | Path | None = None,
        command_runner: Callable[..., subprocess.CompletedProcess[str]] | None = None,
        cancellation_requested: Callable[[], bool] | None = None,
        configuration_id: str = "",
    ) -> None:
        self.receptor = receptor
        self.config = config
        self.output_root = Path(output_root).resolve()
        self.output_root.mkdir(parents=True, exist_ok=True)
        self.docking_root = self.output_root / "docking"
        self.pose_root = self.docking_root / "poses"
        self.pose_root.mkdir(parents=True, exist_ok=True)
        self.work_root = self.docking_root / "work"
        self.work_root.mkdir(parents=True, exist_ok=True)
        self.result_path = self.docking_root / "docking_results.jsonl"
        self._run = command_runner
        self._cancellation_requested = cancellation_requested or (lambda: False)
        self.configuration_id = configuration_id.strip()
        self._active_processes: set[subprocess.Popen[str]] = set()
        self._process_lock = threading.Lock()
        self._result_lock = threading.Lock()
        self.vina_executable, self.vina_runtime_source = resolve_vina_executable(vina_executable)
        self.obabel_executable, self.obabel_runtime_source = resolve_obabel_executable(obabel_executable)
        try:
            self.timeout_seconds = max(1, int(os.environ.get(VINA_TIMEOUT_ENV, "1800")))
        except ValueError as exc:
            raise DockingRuntimeUnavailable(f"{VINA_TIMEOUT_ENV} must be a positive integer.") from exc
        self.vina_version = probe_native_runtime_identity(
            self.vina_executable, "--version", "Vina", command_runner=self._execute
        )
        self.obabel_version = probe_native_runtime_identity(
            self.obabel_executable, "-V", "Open Babel", command_runner=self._execute
        )

    def dock_batch(
        self,
        molecule_ids: list[str],
        canonical_smiles: list[str],
        *,
        progress_callback: Callable[[int, int, int], None] | None = None,
    ) -> list[dict[str, object]]:
        if len(molecule_ids) != len(canonical_smiles):
            raise ValueError("molecule_ids and canonical_smiles must have equal lengths")
        results: list[dict[str, object] | None] = [None] * len(molecule_ids)
        successes = 0
        failures = 0
        processed = 0
        worker_count = self.config.effective_worker_count
        pending: dict[Future[dict[str, object]], int] = {}
        next_index = 0
        with ThreadPoolExecutor(max_workers=worker_count, thread_name_prefix="moloptima-vina") as pool:
            while next_index < len(molecule_ids) and len(pending) < worker_count:
                if self._cancellation_requested():
                    break
                pending[pool.submit(
                    self._dock_one,
                    next_index + 1,
                    molecule_ids[next_index],
                    canonical_smiles[next_index],
                )] = next_index
                next_index += 1
            while pending:
                completed, _ = wait(pending, return_when=FIRST_COMPLETED)
                for future in completed:
                    result_index = pending.pop(future)
                    molecule_id = molecule_ids[result_index]
                    smiles = canonical_smiles[result_index]
                    try:
                        result = future.result()
                    except Exception as exc:
                        if self._cancellation_requested():
                            result = self._cancelled_result(molecule_id, smiles)
                        else:
                            result = self._failed_result(molecule_id, smiles, str(exc))
                    results[result_index] = result
                    processed += 1
                    if result["status"] == "success":
                        successes += 1
                    elif result["status"] != "cancelled":
                        failures += 1
                    self._append_result(result)
                    if progress_callback:
                        progress_callback(processed, successes, failures)
                if self._cancellation_requested():
                    self.cancel_active_processes()
                    continue
                while next_index < len(molecule_ids) and len(pending) < worker_count:
                    pending[pool.submit(
                        self._dock_one,
                        next_index + 1,
                        molecule_ids[next_index],
                        canonical_smiles[next_index],
                    )] = next_index
                    next_index += 1
        for result_index in range(next_index, len(molecule_ids)):
            result = self._cancelled_result(molecule_ids[result_index], canonical_smiles[result_index])
            results[result_index] = result
            self._append_result(result)
        return [result for result in results if result is not None]

    def _dock_one(
        self, index: int, molecule_id: str, smiles: str
    ) -> dict[str, object]:
        started = time.perf_counter()
        if self._cancellation_requested():
            return self._cancelled_result(molecule_id, smiles)
        safe_key = hashlib.sha256(f"{index}:{molecule_id}".encode("utf-8")).hexdigest()[:16]
        pose_name = f"{index:04d}_{safe_key}.pdbqt"
        pose_path = self.pose_root / pose_name
        with tempfile.TemporaryDirectory(prefix=f"{safe_key}-", dir=self.work_root) as temp:
            molecule_root = Path(temp)
            pdbqt_path = self._prepare_ligand_pdbqt(smiles, molecule_root)
            if self._cancellation_requested():
                return self._cancelled_result(molecule_id, smiles)
            command = [
                str(self.vina_executable), "--receptor", str(self.receptor.path),
                "--ligand", str(pdbqt_path), "--center_x", str(self.config.center_x),
                "--center_y", str(self.config.center_y), "--center_z", str(self.config.center_z),
                "--size_x", str(self.config.size_x), "--size_y", str(self.config.size_y),
                "--size_z", str(self.config.size_z), "--exhaustiveness", str(self.config.exhaustiveness),
                "--num_modes", str(self.config.num_modes), "--seed", str(self.config.seed),
            ]
            if self.config.energy_range is not None:
                command.extend(["--energy_range", str(self.config.energy_range)])
            command.extend(["--cpu", "1", "--out", str(pose_path)])
            completed = self._execute(command, timeout=self.timeout_seconds)
            if completed.returncode != 0 or not pose_path.is_file():
                raise RuntimeError(f"Vina docking failed: {_diagnostic(completed)}")
        pose_text = pose_path.read_text(encoding="utf-8", errors="replace")
        modes = _parse_vina_modes(pose_text)
        finite_modes = [
            mode for mode in modes if mode["affinity_kcal_mol"] is not None
        ]
        if not finite_modes:
            return self._failed_result(
                molecule_id,
                smiles,
                "Vina pose output contains no finite parseable affinity modes.",
                modes=modes,
            )
        best = min(
            finite_modes,
            key=lambda mode: (float(mode["affinity_kcal_mol"]), int(mode["mode"])),
        )
        best_affinity = float(best["affinity_kcal_mol"])
        affinities = [float(mode["affinity_kcal_mol"]) for mode in finite_modes]
        returned_mode_count = len(modes)
        return {
            **self._common_result(molecule_id, smiles),
            "status": "success", "docking_status": "success",
            "error_code": None, "error_message": None, "warning": "",
            "best_mode": best["mode"],
            "best_vina_affinity_kcal_mol": best_affinity,
            # Backward-compatible aliases: both always mean the best (most negative) finite mode.
            "best_affinity_kcal_mol": best_affinity, "vina_affinity": best_affinity,
            "modes": modes,
            "mode_affinities_kcal_mol": affinities,
            "requested_num_modes": self.config.num_modes,
            "returned_mode_count": returned_mode_count,
            "mode_count": returned_mode_count,
            "pose_count": returned_mode_count, "pose_file": f"docking/poses/{pose_name}",
            "pose_path": f"docking/poses/{pose_name}",
            "pose_available": True,
            "pose_sha256": hashlib.sha256(pose_path.read_bytes()).hexdigest(),
            "runtime_duration_seconds": round(time.perf_counter() - started, 6),
            "stdout_summary": (completed.stdout or "")[-1200:],
            "stderr_summary": (completed.stderr or "")[-1200:],
            "ligand_preparation_status": "success",
        }

    def _prepare_ligand_pdbqt(self, smiles: str, molecule_root: Path) -> Path:
        """Run the production RDKit-to-Open-Babel ligand preparation path."""
        sdf_path = molecule_root / "ligand.sdf"
        pdbqt_path = molecule_root / "ligand.pdbqt"
        _prepare_rdkit_ligand(smiles, sdf_path, self.config.seed)
        conversion = self._execute(
            [str(self.obabel_executable), str(sdf_path), "-O", str(pdbqt_path)], timeout=120
        )
        if conversion.returncode != 0 or not pdbqt_path.is_file():
            raise RuntimeError(f"Ligand PDBQT preparation failed: {_diagnostic(conversion)}")
        return pdbqt_path

    def _common_result(self, molecule_id: str, smiles: str) -> dict[str, object]:
        return {
            "molecule_id": molecule_id, "canonical_smiles": smiles,
            "receptor_id": self.receptor.receptor_id, "receptor_source": self.receptor.source,
            "receptor_source_filename": self.receptor.source_filename,
            "prepared_receptor_sha256": self.receptor.prepared_receptor_sha256,
            "vina_version": self.vina_version, "vina_runtime_source": self.vina_runtime_source,
            "vina_executable": self.vina_executable.name,
            "ligand_preparation": "rdkit_3d_then_openbabel_pdbqt",
            "ligand_hydrogen_representation": "autodock_united_atom_polar_donor_hydrogens_explicit",
            "rdkit_version": rdBase.rdkitVersion,
            "obabel_runtime_source": self.obabel_runtime_source,
            "obabel_version": self.obabel_version,
            "docking_configuration": self.config.as_dict(),
            "configuration_reference": self.configuration_id or hashlib.sha256(
                json.dumps(self.config.as_dict(), sort_keys=True, separators=(",", ":")).encode()
            ).hexdigest(),
        }

    def _failed_result(
        self,
        molecule_id: str,
        smiles: str,
        message: str,
        *,
        modes: list[dict[str, object]] | None = None,
    ) -> dict[str, object]:
        returned_modes = modes or []
        return {
            **self._common_result(molecule_id, smiles), "status": "docking_failed",
            "docking_status": "docking_failed",
            "error_code": "docking_failed", "error_message": message[:1200], "warning": message[:1200],
            "best_mode": None, "best_vina_affinity_kcal_mol": None,
            "best_affinity_kcal_mol": None, "vina_affinity": None,
            "modes": returned_modes,
            "mode_affinities_kcal_mol": [
                mode["affinity_kcal_mol"]
                for mode in returned_modes
                if mode.get("affinity_kcal_mol") is not None
            ],
            "requested_num_modes": self.config.num_modes,
            "returned_mode_count": len(returned_modes), "mode_count": len(returned_modes),
            "pose_count": len(returned_modes), "pose_file": None, "pose_path": None,
            "pose_available": False, "pose_sha256": None,
            "runtime_duration_seconds": None, "stdout_summary": "", "stderr_summary": "",
            "ligand_preparation_status": "failed",
        }

    def _cancelled_result(self, molecule_id: str, smiles: str) -> dict[str, object]:
        return {
            **self._common_result(molecule_id, smiles), "status": "cancelled",
            "docking_status": "cancelled",
            "error_code": "cancelled", "error_message": "Docking cancelled by user request.",
            "warning": "Docking cancelled by user request.", "best_mode": None,
            "best_vina_affinity_kcal_mol": None, "best_affinity_kcal_mol": None,
            "vina_affinity": None, "modes": [], "mode_affinities_kcal_mol": [],
            "requested_num_modes": self.config.num_modes,
            "returned_mode_count": 0, "mode_count": 0, "pose_count": 0,
            "pose_file": None, "pose_path": None,
            "pose_available": False, "pose_sha256": None, "runtime_duration_seconds": None,
            "stdout_summary": "", "stderr_summary": "", "ligand_preparation_status": "cancelled",
        }

    def _execute(self, arguments: list[str], *, timeout: int) -> subprocess.CompletedProcess[str]:
        if self._run is not None:
            return self._run(
                arguments, shell=False, capture_output=True, text=True,
                timeout=timeout, check=False,
            )
        process = subprocess.Popen(
            arguments, shell=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        with self._process_lock:
            self._active_processes.add(process)
        try:
            stdout, stderr = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            stdout, stderr = process.communicate()
            return subprocess.CompletedProcess(arguments, -9, stdout, f"{stderr}\nProcess timed out.")
        finally:
            with self._process_lock:
                self._active_processes.discard(process)
        return subprocess.CompletedProcess(arguments, process.returncode, stdout, stderr)

    def cancel_active_processes(self) -> None:
        with self._process_lock:
            processes = list(self._active_processes)
        for process in processes:
            if process.poll() is None:
                process.terminate()

    def _append_result(self, result: dict[str, object]) -> None:
        with self._result_lock:
            with self.result_path.open("a", encoding="utf-8") as handle:
                json.dump(result, handle, separators=(",", ":"), sort_keys=True)
                handle.write("\n")


def unavailable_docking_result(
    molecule_id: str,
    canonical_smiles: str | None,
    *,
    status: str,
    warning: str,
    receptor: ReceptorArtifact | None = None,
    config: VinaBoxConfig | None = None,
) -> dict[str, object]:
    return {
        "molecule_id": molecule_id, "canonical_smiles": canonical_smiles,
        "status": status, "docking_status": status,
        "error_code": status, "error_message": warning, "warning": warning,
        "best_mode": None, "best_vina_affinity_kcal_mol": None,
        "best_affinity_kcal_mol": None, "vina_affinity": None,
        "modes": [], "mode_affinities_kcal_mol": [],
        "requested_num_modes": config.num_modes if config else None,
        "returned_mode_count": 0, "mode_count": 0, "pose_count": 0,
        "pose_file": None, "pose_path": None, "pose_available": False, "pose_sha256": None,
        "receptor_id": receptor.receptor_id if receptor else None,
        "receptor_source": receptor.source if receptor else None,
        "receptor_source_filename": receptor.source_filename if receptor else None,
        "prepared_receptor_sha256": receptor.prepared_receptor_sha256 if receptor else None,
        "vina_version": None, "vina_runtime_source": None, "vina_executable": None,
        "ligand_preparation": "rdkit_3d_then_openbabel_pdbqt",
        "rdkit_version": rdBase.rdkitVersion,
        "ligand_preparation_status": "not_run", "obabel_runtime_source": None,
        "obabel_version": None, "runtime_duration_seconds": None,
        "stdout_summary": "", "stderr_summary": "",
        "docking_configuration": config.as_dict() if config else {},
        "configuration_reference": (
            hashlib.sha256(
                json.dumps(config.as_dict(), sort_keys=True, separators=(",", ":")).encode()
            ).hexdigest() if config else None
        ),
    }


def _parse_vina_modes(pose_text: str) -> list[dict[str, object]]:
    """Parse all Vina result remarks while retaining their PDBQT MODEL association."""

    modes: list[dict[str, object]] = []
    pose_model: int | None = None
    for line in pose_text.splitlines():
        model_match = MODEL_PATTERN.match(line.strip())
        if model_match:
            pose_model = int(model_match.group(1))
            continue
        if not line.startswith(VINA_RESULT_PREFIX):
            continue
        fields = line[len(VINA_RESULT_PREFIX):].split()
        mode: dict[str, object] = {
            "mode": len(modes) + 1,
            "affinity_kcal_mol": _finite_float(fields[0]) if fields else None,
            "rmsd_lb": _finite_float(fields[1]) if len(fields) > 1 else None,
            "rmsd_ub": _finite_float(fields[2]) if len(fields) > 2 else None,
        }
        if pose_model is not None:
            mode["pose_model"] = pose_model
        modes.append(mode)
    return modes


def _finite_float(value: str) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _prepare_rdkit_ligand(smiles: str, output_path: Path, seed: int) -> None:
    molecule = Chem.MolFromSmiles(smiles)
    if molecule is None:
        raise RuntimeError("Canonical SMILES could not be parsed during ligand preparation.")
    molecule = Chem.AddHs(molecule)
    parameters = AllChem.ETKDGv3()
    parameters.randomSeed = int(seed)
    if AllChem.EmbedMolecule(molecule, parameters) != 0:
        raise RuntimeError("RDKit 3D conformer generation failed.")
    if AllChem.MMFFHasAllMoleculeParams(molecule):
        AllChem.MMFFOptimizeMolecule(molecule)
    elif AllChem.UFFHasAllMoleculeParams(molecule):
        AllChem.UFFOptimizeMolecule(molecule)
    writer = Chem.SDWriter(str(output_path))
    writer.write(molecule)
    writer.close()
    if not output_path.is_file() or output_path.stat().st_size == 0:
        raise RuntimeError("RDKit ligand preparation produced no SDF artifact.")


def audit_ligand_pdbqt_hydrogens(path: str | Path) -> dict[str, object]:
    """Audit the final AutoDock united-atom hydrogen representation of a ligand PDBQT."""
    pdbqt_path = Path(path)
    lines = pdbqt_path.read_text(encoding="utf-8").splitlines()
    stripped = {line.strip() for line in lines}
    if "ROOT" not in stripped or "ENDROOT" not in stripped or not any(
        line.startswith("TORSDOF ") for line in lines
    ):
        raise RuntimeError("Ligand PDBQT is missing the AutoDock torsion-tree structure.")

    atoms: list[dict[str, object]] = []
    for line_number, line in enumerate(lines, start=1):
        if not line.startswith(("ATOM  ", "HETATM")):
            continue
        try:
            coordinates = tuple(float(line[start:end]) for start, end in ((30, 38), (38, 46), (46, 54)))
            charge = float(line[70:76])
            serial = int(line[6:11])
        except (ValueError, IndexError) as exc:
            raise RuntimeError(f"Ligand PDBQT atom record on line {line_number} is malformed.") from exc
        atom_type = line[77:].strip()
        if not atom_type or not all(math.isfinite(value) for value in (*coordinates, charge)):
            raise RuntimeError(f"Ligand PDBQT atom record on line {line_number} is incomplete or non-finite.")
        atoms.append({
            "serial": serial,
            "atom_type": atom_type,
            "element": _autodock_element(atom_type),
            "coordinates": coordinates,
        })
    if not atoms:
        raise RuntimeError("Ligand PDBQT contains no ATOM/HETATM records.")

    heavy_atoms = [atom for atom in atoms if atom["element"] != "H"]
    hydrogens: list[dict[str, object]] = []
    for hydrogen in (atom for atom in atoms if atom["element"] == "H"):
        if not heavy_atoms:
            raise RuntimeError("Ligand PDBQT explicit hydrogen has no possible heavy-atom parent.")
        parent = min(
            heavy_atoms,
            key=lambda atom: math.dist(hydrogen["coordinates"], atom["coordinates"]),
        )
        distance = math.dist(hydrogen["coordinates"], parent["coordinates"])
        if not 0.6 <= distance <= 1.35:
            raise RuntimeError(
                f"Ligand PDBQT explicit hydrogen atom {hydrogen['serial']} has no plausible covalent parent."
            )
        hydrogens.append({
            "serial": hydrogen["serial"],
            "atom_type": hydrogen["atom_type"],
            "parent_serial": parent["serial"],
            "parent_atom_type": parent["atom_type"],
            "parent_element": parent["element"],
            "parent_distance_angstrom": round(distance, 4),
        })
    return {
        "total_atom_records": len(atoms),
        "explicit_hydrogen_count": len(hydrogens),
        "explicit_hydrogens": hydrogens,
        "explicit_hydrogen_atom_types": sorted({str(item["atom_type"]) for item in hydrogens}),
        "carbon_bound_hydrogen_present": any(item["parent_element"] == "C" for item in hydrogens),
        "autodock_torsion_tree_present": True,
    }


def _autodock_element(atom_type: str) -> str:
    normalized = atom_type.strip().upper()
    if normalized.startswith("H"):
        return "H"
    if normalized in {"C", "A"}:
        return "C"
    if normalized.startswith("CL"):
        return "Cl"
    if normalized.startswith("BR"):
        return "Br"
    for prefix, element in (("N", "N"), ("O", "O"), ("S", "S"), ("P", "P"), ("F", "F"), ("I", "I")):
        if normalized.startswith(prefix):
            return element
    return normalized


def resolve_vina_executable(explicit: str | Path | None = None) -> tuple[Path, str]:
    return _resolve_executable(
        explicit,
        (VINA_ENV, VINA_LEGACY_ENV),
        (
            PROJECT_ROOT / "resources" / "vina" / "vina.exe",
            PROJECT_ROOT / "resources" / "runtime" / "vina" / "vina.exe",
            PROJECT_ROOT / "desktop" / "runtime" / "vina" / "vina.exe",
        ),
        "vina",
    )


def resolve_obabel_executable(explicit: str | Path | None = None) -> tuple[Path, str]:
    return _resolve_executable(
        explicit,
        (OBABEL_ENV, OBABEL_LEGACY_ENV),
        (
            PROJECT_ROOT / "resources" / "openbabel" / "obabel.exe",
            PROJECT_ROOT / "resources" / "runtime" / "openbabel" / "obabel.exe",
        ),
        "obabel",
    )


def probe_native_runtime_identity(
    executable: str | Path,
    version_argument: str,
    runtime_label: str,
    *,
    command_runner: Callable[..., subprocess.CompletedProcess[str]] | None = None,
) -> str:
    """Run the production native-runtime version check without docking a ligand."""

    arguments = [str(Path(executable)), version_argument]
    if command_runner is None:
        completed = subprocess.run(
            arguments,
            shell=False,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    else:
        completed = command_runner(arguments, timeout=30)
    if completed.returncode != 0:
        raise DockingRuntimeUnavailable(
            f"{runtime_label} version check failed: {_diagnostic(completed)}"
        )
    output = (completed.stdout or completed.stderr).strip().splitlines()
    if not output:
        raise DockingRuntimeUnavailable(f"{runtime_label} version check returned no identity.")
    return output[0][:200]


def _resolve_executable(
    explicit: str | Path | None,
    environment_names: tuple[str, ...],
    packaged_candidates: Iterable[Path],
    command_name: str,
) -> tuple[Path, str]:
    configured_value = explicit
    configured_environment = ""
    if configured_value is None:
        for environment_name in environment_names:
            if os.environ.get(environment_name, "").strip():
                configured_value = os.environ[environment_name]
                configured_environment = environment_name
                break
    configured = str(configured_value or "").strip()
    if configured:
        path = Path(configured).expanduser().resolve()
        if path.is_file():
            return path, f"environment:{configured_environment}" if explicit is None else "explicit"
        raise DockingRuntimeUnavailable(f"Configured {command_name} executable is missing.")
    for candidate in packaged_candidates:
        if candidate.is_file():
            _validate_packaged_runtime(candidate, command_name)
            return candidate.resolve(), "packaged"
    discovered = shutil.which(command_name)
    if discovered:
        return Path(discovered).resolve(), "PATH"
    raise DockingRuntimeUnavailable(
        f"{command_name} runtime is unavailable; configure {environment_names[0]}."
    )


def _validate_packaged_runtime(executable: Path, command_name: str) -> None:
    runtime_root = executable.parent.resolve()
    manifest_path = runtime_root / "runtime_manifest.json"
    if not manifest_path.is_file():
        raise DockingRuntimeUnavailable(
            f"Packaged {command_name} runtime manifest is missing."
        )
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise DockingRuntimeUnavailable(
            f"Packaged {command_name} runtime manifest is invalid."
        ) from exc
    if manifest.get("schema_version") != "moloptima-native-runtime-v1":
        raise DockingRuntimeUnavailable(
            f"Packaged {command_name} runtime manifest schema is invalid."
        )
    if manifest.get("executable") != executable.name:
        raise DockingRuntimeUnavailable(
            f"Packaged {command_name} executable does not match its runtime manifest."
        )
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise DockingRuntimeUnavailable(
            f"Packaged {command_name} runtime inventory is empty."
        )
    for item in files:
        if not isinstance(item, dict):
            raise DockingRuntimeUnavailable(
                f"Packaged {command_name} runtime inventory is invalid."
            )
        relative = Path(str(item.get("path", "")))
        if relative.is_absolute() or not relative.parts or ".." in relative.parts:
            raise DockingRuntimeUnavailable(
                f"Packaged {command_name} runtime inventory contains an unsafe path."
            )
        runtime_file = (runtime_root / relative).resolve()
        if runtime_root not in runtime_file.parents or not runtime_file.is_file():
            raise DockingRuntimeUnavailable(
                f"Packaged {command_name} runtime dependency is missing: {relative.as_posix()}."
            )
        try:
            expected_size = int(item["size_bytes"])
            expected_sha = str(item["sha256"]).lower()
        except (KeyError, TypeError, ValueError) as exc:
            raise DockingRuntimeUnavailable(
                f"Packaged {command_name} runtime inventory is invalid."
            ) from exc
        if runtime_file.stat().st_size != expected_size:
            raise DockingRuntimeUnavailable(
                f"Packaged {command_name} runtime size verification failed: {relative.as_posix()}."
            )
        actual_sha = hashlib.sha256(runtime_file.read_bytes()).hexdigest()
        if actual_sha != expected_sha:
            raise DockingRuntimeUnavailable(
                f"Packaged {command_name} runtime hash verification failed: {relative.as_posix()}."
            )


def _diagnostic(completed: subprocess.CompletedProcess[str]) -> str:
    return (completed.stderr or completed.stdout or "no diagnostic").strip()[-1200:]
