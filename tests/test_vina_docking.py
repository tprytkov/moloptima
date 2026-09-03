from __future__ import annotations

import hashlib
import json
import os
import subprocess
from pathlib import Path

import pytest

from molecular_prioritization.admet_multitask_predictor import unavailable_admet_prediction
from molecular_prioritization.bbb_predictor import UnavailableBBBPredictor
from molecular_prioritization.pipeline import prioritize_smiles
from molecular_prioritization.receptor import (
    ReceptorValidationError,
    VinaBoxConfig,
    validate_prepared_receptor,
)
from molecular_prioritization.vina_docking import (
    DockingRuntimeUnavailable,
    VinaDockingEngine,
    audit_ligand_pdbqt_hydrogens,
    resolve_obabel_executable,
    resolve_vina_executable,
)


def prepared_receptor(tmp_path: Path):
    path = tmp_path / "target.pdbqt"
    path.write_text(
        "ATOM      1  C   REC A   1       1.000   2.000   3.000  1.00  0.00     0.000 C\n",
        encoding="utf-8",
    )
    return validate_prepared_receptor(path, receptor_id="TARGET-1")


def write_receptor(tmp_path: Path, atom_record: str, name: str = "target.pdbqt") -> Path:
    path = tmp_path / name
    path.write_text(atom_record + "\n", encoding="utf-8")
    return path


def box_config(worker_count=4, energy_range=None):
    values = {
        "center_x": 1, "center_y": 2, "center_z": 3,
        "size_x": 20, "size_y": 21, "size_z": 22,
        "exhaustiveness": 8, "num_modes": 3, "seed": 12345,
        "worker_count": worker_count,
    }
    if energy_range is not None:
        values["energy_range"] = energy_range
    return VinaBoxConfig.from_mapping(values)


def origin_box_config():
    return VinaBoxConfig.from_mapping({
        "center_x": 0, "center_y": 0, "center_z": 0,
        "size_x": 20, "size_y": 20, "size_z": 20,
        "exhaustiveness": 8, "num_modes": 3, "seed": 12345,
    })


def write_runtime_manifest(runtime_root: Path, executable: str, files: list[str]) -> None:
    inventory = []
    for filename in files:
        path = runtime_root / filename
        inventory.append({
            "path": filename,
            "size_bytes": path.stat().st_size if path.exists() else 1,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else "0" * 64,
        })
    (runtime_root / "runtime_manifest.json").write_text(
        json.dumps({
            "schema_version": "moloptima-native-runtime-v1",
            "runtime": executable.removesuffix(".exe"),
            "executable": executable,
            "files": inventory,
        }),
        encoding="utf-8",
    )


class SuccessfulADMET:
    def predict(self, smiles):
        result = unavailable_admet_prediction(smiles, prediction_status="available", warning="")
        for endpoint in result["endpoints"].values():
            endpoint["calibrated_probability"] = 0.5
            endpoint["binary_prediction"] = 1
        return result


class FailedADMET:
    def predict(self, smiles):
        raise RuntimeError("ADMET unavailable for test")


class RecordingDockingEngine:
    def __init__(self, fail_id: str = ""):
        self.calls = []
        self.fail_id = fail_id

    def dock_batch(self, molecule_ids, smiles, *, progress_callback=None):
        self.calls.append((list(molecule_ids), list(smiles)))
        results = []
        successes = failures = 0
        for index, (molecule_id, canonical) in enumerate(zip(molecule_ids, smiles, strict=True), start=1):
            failed = molecule_id == self.fail_id
            successes += not failed
            failures += failed
            results.append({
                "molecule_id": molecule_id, "canonical_smiles": canonical,
                "status": "docking_failed" if failed else "success",
                "best_affinity_kcal_mol": None if failed else -7.5,
                "best_vina_affinity_kcal_mol": None if failed else -7.5,
                "best_mode": None if failed else 1,
                "modes": [] if failed else [
                    {"mode": 1, "affinity_kcal_mol": -7.5, "rmsd_lb": 0.0, "rmsd_ub": 0.0},
                    {"mode": 2, "affinity_kcal_mol": -7.0, "rmsd_lb": 1.0, "rmsd_ub": 1.5},
                ],
                "mode_affinities_kcal_mol": [] if failed else [-7.5, -7.0],
                "receptor_id": "TARGET-1", "prepared_receptor_sha256": "a" * 64,
                "vina_version": "AutoDock Vina 1.2.test",
                "docking_configuration": box_config().as_dict(),
                "warning": "mock failure" if failed else "",
            })
            if progress_callback:
                progress_callback(index, successes, failures)
        return results


def test_valid_receptor_and_vina_path_returns_provenance_and_safe_commands(tmp_path):
    vina = tmp_path / "vina.exe"
    obabel = tmp_path / "obabel.exe"
    vina.touch(); obabel.touch()
    calls = []

    def runner(arguments, **kwargs):
        calls.append((arguments, kwargs))
        if "--version" in arguments:
            return subprocess.CompletedProcess(arguments, 0, "AutoDock Vina 1.2.7\n", "")
        if "-V" in arguments:
            return subprocess.CompletedProcess(arguments, 0, "Open Babel 3.1.1\n", "")
        if "-O" in arguments:
            Path(arguments[arguments.index("-O") + 1]).write_text("ROOT\nENDROOT\n", encoding="utf-8")
            return subprocess.CompletedProcess(arguments, 0, "", "")
        pose = Path(arguments[arguments.index("--out") + 1])
        pose.write_text(
            "MODEL 1\nREMARK VINA RESULT:    -7.0      0.000      0.000\nENDMDL\n"
            "MODEL 2\nREMARK VINA RESULT:    -8.3      1.000      1.500\nENDMDL\n"
            "MODEL 3\nREMARK VINA RESULT:    -7.8      2.000      2.500\nENDMDL\n",
            encoding="utf-8",
        )
        return subprocess.CompletedProcess(arguments, 0, "", "")

    engine = VinaDockingEngine(
        prepared_receptor(tmp_path), box_config(), output_root=tmp_path / "job",
        vina_executable=vina, obabel_executable=obabel, command_runner=runner,
        configuration_id="config-123",
    )
    result = engine.dock_batch(["ethanol"], ["CCO"])[0]

    assert result["status"] == "success"
    assert result["best_mode"] == 2
    assert result["best_vina_affinity_kcal_mol"] == -8.3
    assert result["best_affinity_kcal_mol"] == -8.3
    assert result["vina_affinity"] == -8.3
    assert result["mode_affinities_kcal_mol"] == [-7.0, -8.3, -7.8]
    assert result["modes"] == [
        {"mode": 1, "affinity_kcal_mol": -7.0, "rmsd_lb": 0.0, "rmsd_ub": 0.0, "pose_model": 1},
        {"mode": 2, "affinity_kcal_mol": -8.3, "rmsd_lb": 1.0, "rmsd_ub": 1.5, "pose_model": 2},
        {"mode": 3, "affinity_kcal_mol": -7.8, "rmsd_lb": 2.0, "rmsd_ub": 2.5, "pose_model": 3},
    ]
    assert result["requested_num_modes"] == 3
    assert result["returned_mode_count"] == 3
    assert result["mode_count"] == 3
    assert result["receptor_id"] == "TARGET-1"
    assert len(result["prepared_receptor_sha256"]) == 64
    assert result["vina_version"] == "AutoDock Vina 1.2.7"
    assert result["docking_configuration"] == box_config().as_dict()
    assert result["configuration_reference"] == "config-123"
    assert result["pose_sha256"]
    assert (tmp_path / "job" / result["pose_file"]).is_file()
    assert (tmp_path / "job" / "docking" / "docking_results.jsonl").read_text(encoding="utf-8").count("\n") == 1
    assert result["pose_available"] is True
    assert result["runtime_duration_seconds"] >= 0
    serialized = json.dumps(result)
    assert str(vina) not in serialized
    assert str(obabel) not in serialized
    for arguments, kwargs in calls:
        assert isinstance(arguments, list)
        assert kwargs["shell"] is False
        assert kwargs["capture_output"] is True
        assert kwargs["check"] is False


@pytest.mark.parametrize(
    ("pose_text", "expected_mode", "expected_affinity", "expected_count"),
    [
        (
            "REMARK VINA RESULT: nan 0.0 0.0\n"
            "REMARK VINA RESULT: -8.2 1.0 1.5\n"
            "REMARK VINA RESULT: inf 2.0 2.5\n",
            2,
            -8.2,
            3,
        ),
        ("REMARK VINA RESULT: nan 0.0 0.0\nREMARK VINA RESULT: inf 1.0 1.0\n", None, None, 2),
    ],
)
def test_nonfinite_modes_are_retained_but_excluded_from_best_selection(
    tmp_path, pose_text, expected_mode, expected_affinity, expected_count,
):
    vina = tmp_path / "vina.exe"
    obabel = tmp_path / "obabel.exe"
    vina.touch(); obabel.touch()

    def runner(arguments, **_kwargs):
        if "--version" in arguments:
            return subprocess.CompletedProcess(arguments, 0, "AutoDock Vina 1.2.7\n", "")
        if "-V" in arguments:
            return subprocess.CompletedProcess(arguments, 0, "Open Babel 3.1.1\n", "")
        if "-O" in arguments:
            Path(arguments[arguments.index("-O") + 1]).write_text("ROOT\nENDROOT\n", encoding="utf-8")
            return subprocess.CompletedProcess(arguments, 0, "", "")
        Path(arguments[arguments.index("--out") + 1]).write_text(pose_text, encoding="utf-8")
        return subprocess.CompletedProcess(arguments, 0, "", "")

    result = VinaDockingEngine(
        prepared_receptor(tmp_path), box_config(), output_root=tmp_path / "job",
        vina_executable=vina, obabel_executable=obabel, command_runner=runner,
    ).dock_batch(["ethanol"], ["CCO"])[0]

    assert result["best_mode"] == expected_mode
    assert result["best_vina_affinity_kcal_mol"] == expected_affinity
    assert result["returned_mode_count"] == expected_count
    assert result["modes"][0]["affinity_kcal_mol"] is None
    if expected_mode is None:
        assert result["status"] == "docking_failed"
        assert result["vina_affinity"] is None
    else:
        assert result["status"] == "success"


@pytest.mark.parametrize("energy_range", [4, 2.5])
def test_optional_energy_range_is_passed_exactly_and_recorded(tmp_path, energy_range):
    vina = tmp_path / "vina.exe"
    obabel = tmp_path / "obabel.exe"
    vina.touch(); obabel.touch()
    docking_commands = []

    def runner(arguments, **_kwargs):
        if "--version" in arguments:
            return subprocess.CompletedProcess(arguments, 0, "AutoDock Vina 1.2.7\n", "")
        if "-V" in arguments:
            return subprocess.CompletedProcess(arguments, 0, "Open Babel 3.1.1\n", "")
        if "-O" in arguments:
            Path(arguments[arguments.index("-O") + 1]).write_text("ROOT\nENDROOT\n", encoding="utf-8")
            return subprocess.CompletedProcess(arguments, 0, "", "")
        docking_commands.append(arguments)
        Path(arguments[arguments.index("--out") + 1]).write_text(
            "REMARK VINA RESULT: -7.0 0.0 0.0\n", encoding="utf-8",
        )
        return subprocess.CompletedProcess(arguments, 0, "", "")

    result = VinaDockingEngine(
        prepared_receptor(tmp_path), box_config(energy_range=energy_range),
        output_root=tmp_path / "job", vina_executable=vina,
        obabel_executable=obabel, command_runner=runner,
    ).dock_batch(["ethanol"], ["CCO"])[0]

    command = docking_commands[0]
    assert command[command.index("--energy_range") + 1] == str(float(energy_range))
    assert result["docking_configuration"]["energy_range"] == float(energy_range)


def test_omitted_energy_range_preserves_existing_command_and_provenance(tmp_path):
    vina = tmp_path / "vina.exe"
    obabel = tmp_path / "obabel.exe"
    vina.touch(); obabel.touch()
    docking_commands = []

    def runner(arguments, **_kwargs):
        if "--version" in arguments:
            return subprocess.CompletedProcess(arguments, 0, "AutoDock Vina 1.2.7\n", "")
        if "-V" in arguments:
            return subprocess.CompletedProcess(arguments, 0, "Open Babel 3.1.1\n", "")
        if "-O" in arguments:
            Path(arguments[arguments.index("-O") + 1]).write_text("ROOT\nENDROOT\n", encoding="utf-8")
            return subprocess.CompletedProcess(arguments, 0, "", "")
        docking_commands.append(arguments)
        Path(arguments[arguments.index("--out") + 1]).write_text(
            "REMARK VINA RESULT: -7.0 0.0 0.0\n", encoding="utf-8",
        )
        return subprocess.CompletedProcess(arguments, 0, "", "")

    result = VinaDockingEngine(
        prepared_receptor(tmp_path), box_config(), output_root=tmp_path / "job",
        vina_executable=vina, obabel_executable=obabel, command_runner=runner,
    ).dock_batch(["ethanol"], ["CCO"])[0]

    assert "--energy_range" not in docking_commands[0]
    assert "energy_range" not in result["docking_configuration"]


@pytest.mark.parametrize("energy_range", [0, -1, float("nan"), float("inf")])
def test_energy_range_must_be_finite_and_positive(energy_range):
    with pytest.raises(ReceptorValidationError, match="energy_range"):
        VinaBoxConfig.from_mapping({
            "center_x": 1, "center_y": 2, "center_z": 3,
            "size_x": 20, "size_y": 21, "size_z": 22,
            "exhaustiveness": 8, "num_modes": 3, "seed": 12345,
            "energy_range": energy_range,
        })


def test_invalid_receptor_and_missing_vina_fail_closed(tmp_path):
    invalid = tmp_path / "invalid.pdbqt"
    invalid.write_text("REMARK no atoms\n", encoding="utf-8")
    with pytest.raises(ReceptorValidationError, match="no ATOM/HETATM"):
        validate_prepared_receptor(invalid)

    with pytest.raises(DockingRuntimeUnavailable, match="missing"):
        VinaDockingEngine(
            prepared_receptor(tmp_path), box_config(), output_root=tmp_path / "job",
            vina_executable=tmp_path / "missing-vina.exe",
            obabel_executable=tmp_path / "missing-obabel.exe",
        )


def test_vina_resolver_prefers_new_environment_contract(monkeypatch, tmp_path):
    executable = tmp_path / "vina.exe"
    executable.touch()
    monkeypatch.setenv("MOLOPTIMA_VINA_PATH", str(executable))
    monkeypatch.setenv("MOLOPTIMA_VINA_EXECUTABLE", str(tmp_path / "legacy.exe"))
    resolved, source = resolve_vina_executable()
    assert resolved == executable.resolve()
    assert source == "environment:MOLOPTIMA_VINA_PATH"


def test_vina_resolver_unavailable_fails_clearly(monkeypatch):
    monkeypatch.delenv("MOLOPTIMA_VINA_PATH", raising=False)
    monkeypatch.delenv("MOLOPTIMA_VINA_EXECUTABLE", raising=False)
    monkeypatch.setattr("molecular_prioritization.vina_docking.shutil.which", lambda _name: None)
    monkeypatch.setattr("molecular_prioritization.vina_docking.PROJECT_ROOT", Path("missing-root"))
    with pytest.raises(DockingRuntimeUnavailable, match="MOLOPTIMA_VINA_PATH"):
        resolve_vina_executable()


def test_packaged_openbabel_selected_when_override_absent(monkeypatch, tmp_path):
    runtime_root = tmp_path / "resources" / "openbabel"
    runtime_root.mkdir(parents=True)
    executable = runtime_root / "obabel.exe"
    executable.write_bytes(b"packaged-openbabel")
    write_runtime_manifest(runtime_root, executable.name, [executable.name])
    monkeypatch.delenv("MOLOPTIMA_OBABEL_PATH", raising=False)
    monkeypatch.delenv("MOLOPTIMA_OBABEL_EXECUTABLE", raising=False)
    monkeypatch.setattr("molecular_prioritization.vina_docking.PROJECT_ROOT", tmp_path)
    monkeypatch.setattr("molecular_prioritization.vina_docking.shutil.which", lambda _name: None)

    resolved, source = resolve_obabel_executable()

    assert resolved == executable.resolve()
    assert source == "packaged"


def test_explicit_openbabel_override_still_wins(monkeypatch, tmp_path):
    explicit = tmp_path / "private-runtime" / "obabel.exe"
    explicit.parent.mkdir()
    explicit.write_bytes(b"explicit-openbabel")
    packaged = tmp_path / "resources" / "openbabel" / "obabel.exe"
    packaged.parent.mkdir(parents=True)
    packaged.write_bytes(b"packaged-openbabel")
    monkeypatch.setattr("molecular_prioritization.vina_docking.PROJECT_ROOT", tmp_path)

    resolved, source = resolve_obabel_executable(explicit)

    assert resolved == explicit.resolve()
    assert source == "explicit"


def test_packaged_runtime_missing_required_dll_fails_clearly(monkeypatch, tmp_path):
    runtime_root = tmp_path / "resources" / "openbabel"
    runtime_root.mkdir(parents=True)
    executable = runtime_root / "obabel.exe"
    executable.write_bytes(b"packaged-openbabel")
    write_runtime_manifest(
        runtime_root, executable.name, [executable.name, "openbabel-3.dll"],
    )
    monkeypatch.delenv("MOLOPTIMA_OBABEL_PATH", raising=False)
    monkeypatch.delenv("MOLOPTIMA_OBABEL_EXECUTABLE", raising=False)
    monkeypatch.setattr("molecular_prioritization.vina_docking.PROJECT_ROOT", tmp_path)

    with pytest.raises(DockingRuntimeUnavailable, match="dependency is missing: openbabel-3.dll"):
        resolve_obabel_executable()


def test_packaged_vina_selected_without_changing_resolver_order(monkeypatch, tmp_path):
    runtime_root = tmp_path / "resources" / "vina"
    runtime_root.mkdir(parents=True)
    executable = runtime_root / "vina.exe"
    executable.write_bytes(b"packaged-vina")
    write_runtime_manifest(runtime_root, executable.name, [executable.name])
    monkeypatch.delenv("MOLOPTIMA_VINA_PATH", raising=False)
    monkeypatch.delenv("MOLOPTIMA_VINA_EXECUTABLE", raising=False)
    monkeypatch.setattr("molecular_prioritization.vina_docking.PROJECT_ROOT", tmp_path)
    monkeypatch.setattr("molecular_prioritization.vina_docking.shutil.which", lambda _name: None)

    resolved, source = resolve_vina_executable()

    assert resolved == executable.resolve()
    assert source == "packaged"


@pytest.mark.skipif(os.name != "nt", reason="Packaged executable is Windows-only")
def test_real_packaged_openbabel_launches_and_inventory_hashes_match(monkeypatch):
    project_root = Path(__file__).resolve().parents[1]
    runtime_root = project_root / "resources" / "openbabel"
    monkeypatch.delenv("MOLOPTIMA_OBABEL_PATH", raising=False)
    monkeypatch.delenv("MOLOPTIMA_OBABEL_EXECUTABLE", raising=False)
    resolved, source = resolve_obabel_executable()

    completed = subprocess.run(
        [str(resolved), "-V"], shell=False, capture_output=True, text=True,
        timeout=30, check=False,
    )
    manifest = json.loads((runtime_root / "runtime_manifest.json").read_text(encoding="utf-8"))

    assert source == "packaged"
    assert completed.returncode == 0
    assert "Open Babel 3.1.0" in (completed.stdout or completed.stderr)
    for item in manifest["files"]:
        path = runtime_root / item["path"]
        assert path.stat().st_size == item["size_bytes"]
        assert hashlib.sha256(path.read_bytes()).hexdigest() == item["sha256"]


@pytest.fixture(scope="module")
def qualified_ligand_hydrogen_outputs(tmp_path_factory):
    if os.name != "nt":
        pytest.skip("Packaged Vina and Open Babel executables are Windows-only")
    root = tmp_path_factory.mktemp("qualified-ligand-hydrogens")
    receptor = validate_prepared_receptor(
        Path(__file__).parent / "fixtures" / "receptor_setup" / "representative_prepared_receptor.pdbqt",
        receptor_id="SYNTHETIC-LIGAND-INTEROP",
    )
    config = VinaBoxConfig.from_mapping({
        "center_x": 1, "center_y": 2, "center_z": 3,
        "size_x": 20, "size_y": 20, "size_z": 20,
        "exhaustiveness": 1, "num_modes": 1, "seed": 20240517, "worker_count": 1,
    })
    engine = VinaDockingEngine(receptor, config, output_root=root / "job")
    molecules = {
        "ethanol_oh": "CCO",
        "ethylamine_nh": "CCN",
        "aminoethanol_oh_nh": "NCCO",
        "triethylamine_donor_free": "CCN(CC)CC",
        "pyrrole_heteroaromatic_nh": "c1cc[nH]c1",
    }
    outputs = {}
    for identity, smiles in molecules.items():
        molecule_root = root / identity
        molecule_root.mkdir()
        pdbqt = engine._prepare_ligand_pdbqt(smiles, molecule_root)
        outputs[identity] = {
            "smiles": smiles,
            "path": pdbqt,
            "audit": audit_ligand_pdbqt_hydrogens(pdbqt),
        }
    return {"engine": engine, "outputs": outputs}


def test_real_production_ligand_pdbqt_uses_autodock_polar_hydrogen_representation(
    qualified_ligand_hydrogen_outputs,
):
    outputs = qualified_ligand_hydrogen_outputs["outputs"]
    expected = {
        "ethanol_oh": (4, ["O"], [0.9721]),
        "ethylamine_nh": (5, ["N", "N"], [1.0186, 1.0188]),
        "aminoethanol_oh_nh": (7, ["N", "N", "O"], [1.0241, 1.0206, 0.9732]),
        "triethylamine_donor_free": (7, [], []),
        "pyrrole_heteroaromatic_nh": (6, ["N"], [1.0120]),
    }
    for identity, (atom_count, parent_elements, distances) in expected.items():
        audit = outputs[identity]["audit"]
        hydrogens = audit["explicit_hydrogens"]
        assert audit["total_atom_records"] == atom_count
        assert audit["explicit_hydrogen_count"] == len(parent_elements)
        assert audit["explicit_hydrogen_atom_types"] == ([] if not parent_elements else ["HD"])
        assert [item["parent_element"] for item in hydrogens] == parent_elements
        assert [item["parent_distance_angstrom"] for item in hydrogens] == pytest.approx(
            distances, abs=0.002,
        )
        assert audit["carbon_bound_hydrogen_present"] is False
        assert audit["autodock_torsion_tree_present"] is True


def test_real_qualified_ligand_pdbqt_is_accepted_by_packaged_vina(
    qualified_ligand_hydrogen_outputs,
):
    engine = qualified_ligand_hydrogen_outputs["engine"]
    result = engine.dock_batch(["ethanol-interop"], ["CCO"])[0]

    assert result["status"] == "success"
    assert result["ligand_preparation_status"] == "success"
    assert result["ligand_hydrogen_representation"] == (
        "autodock_united_atom_polar_donor_hydrogens_explicit"
    )
    assert result["returned_mode_count"] >= 1
    assert result["best_mode"] == 1
    assert result["best_vina_affinity_kcal_mol"] is not None
    assert result["vina_runtime_source"] == "packaged"
    assert result["obabel_runtime_source"] == "packaged"


def test_cancellation_stops_scheduling_and_preserves_incremental_rows(tmp_path):
    vina = tmp_path / "vina.exe"
    obabel = tmp_path / "obabel.exe"
    vina.touch(); obabel.touch()
    cancellation = {"requested": False}
    vina_calls = []
    observed_row_counts = []

    def runner(arguments, **_kwargs):
        if "--version" in arguments:
            return subprocess.CompletedProcess(arguments, 0, "AutoDock Vina 1.2.7\n", "")
        if "-V" in arguments:
            return subprocess.CompletedProcess(arguments, 0, "Open Babel 3.1.1\n", "")
        if "-O" in arguments:
            Path(arguments[arguments.index("-O") + 1]).write_text("ROOT\nENDROOT\n", encoding="utf-8")
            return subprocess.CompletedProcess(arguments, 0, "", "")
        vina_calls.append(arguments)
        Path(arguments[arguments.index("--out") + 1]).write_text(
            "REMARK VINA RESULT: -7.0 0.0 0.0\n", encoding="utf-8",
        )
        return subprocess.CompletedProcess(arguments, 0, "", "")

    engine = VinaDockingEngine(
        prepared_receptor(tmp_path), box_config(worker_count=1), output_root=tmp_path / "job",
        vina_executable=vina, obabel_executable=obabel, command_runner=runner,
        cancellation_requested=lambda: cancellation["requested"],
    )

    def progress(*_values):
        result_path = tmp_path / "job" / "docking" / "docking_results.jsonl"
        observed_row_counts.append(result_path.read_text(encoding="utf-8").count("\n"))
        cancellation["requested"] = True

    results = engine.dock_batch(["a", "b", "c"], ["CCO", "CCC", "CCCC"], progress_callback=progress)
    assert len(vina_calls) == 1
    assert observed_row_counts == [1]
    assert [result["status"] for result in results] == ["success", "cancelled", "cancelled"]
    assert (tmp_path / "job" / "docking" / "docking_results.jsonl").read_text(encoding="utf-8").count("\n") == 3


def test_receptor_validation_rejects_malformed_pseudo_pdbqt(tmp_path):
    path = write_receptor(
        tmp_path,
        "ATOM  not-a-structurally-valid-pdbqt-record",
        "pseudo.pdbqt",
    )
    with pytest.raises(ReceptorValidationError, match="too short"):
        validate_prepared_receptor(path)


def test_receptor_validation_rejects_plain_pdb_renamed_pdbqt(tmp_path):
    path = write_receptor(
        tmp_path,
        "ATOM      1  CA  ALA A   1      11.104  13.207  14.099  1.00 20.00           C  ",
        "plain-pdb.pdbqt",
    )
    with pytest.raises(ReceptorValidationError, match="partial charge"):
        validate_prepared_receptor(path)


@pytest.mark.parametrize("coordinate", ["     nan", "     inf", "not-a-float"])
def test_receptor_validation_rejects_malformed_or_nonfinite_coordinates(tmp_path, coordinate):
    record = (
        "ATOM      1  C   REC A   1     "
        f"{coordinate}   2.000   3.000  1.00  0.00     0.000 C"
    )
    path = write_receptor(tmp_path, record, "bad-coordinate.pdbqt")
    with pytest.raises(ReceptorValidationError, match="coordinates"):
        validate_prepared_receptor(path)


def test_representative_prepared_receptor_pdbqt_passes(tmp_path):
    artifact = prepared_receptor(tmp_path)
    assert artifact.receptor_id == "TARGET-1"
    assert artifact.size_bytes > 0
    assert len(artifact.prepared_receptor_sha256) == 64


def test_origin_box_requires_explicit_configuration():
    with pytest.raises(ReceptorValidationError, match="explicit numeric"):
        VinaBoxConfig.from_mapping({})

    config = origin_box_config()
    assert (config.center_x, config.center_y, config.center_z) == (0.0, 0.0, 0.0)
    assert (config.size_x, config.size_y, config.size_z) == (20.0, 20.0, 20.0)


def test_missing_configuration_never_invokes_vina_and_preserves_admet(monkeypatch, tmp_path):
    invocations = []

    def forbidden_vina(*args, **kwargs):
        invocations.append((args, kwargs))
        raise AssertionError("Vina must not be constructed without explicit configuration")

    monkeypatch.setattr("molecular_prioritization.pipeline.VinaDockingEngine", forbidden_vina)
    injected_engine = RecordingDockingEngine()
    row = prioritize_smiles(
        [{"molecule_id": "ethanol", "smiles": "CCO"}],
        bbb_predictor=UnavailableBBBPredictor("not used"),
        admet_predictor=SuccessfulADMET(),
        enable_docking=True,
        receptor=prepared_receptor(tmp_path),
        docking_config=None,
        docking_engine=injected_engine,
    )[0]

    assert invocations == []
    assert injected_engine.calls == []
    assert row["docking_result"]["status"] == "configuration_invalid"
    assert row["admet_model_status"] == "model_available"


def test_invalid_receptor_state_never_invokes_vina_and_preserves_admet():
    injected_engine = RecordingDockingEngine()
    row = prioritize_smiles(
        [{"molecule_id": "ethanol", "smiles": "CCO"}],
        bbb_predictor=UnavailableBBBPredictor("not used"),
        admet_predictor=SuccessfulADMET(),
        enable_docking=True,
        receptor=None,
        docking_config=box_config(),
        docking_engine=injected_engine,
        docking_setup_error="Prepared receptor PDBQT failed validation.",
    )[0]

    assert injected_engine.calls == []
    assert row["docking_result"]["status"] == "receptor_unavailable"
    assert "failed validation" in row["docking_result"]["warning"]
    assert row["admet_model_status"] == "model_available"


def test_pipeline_docks_only_valid_molecules_and_preserves_per_molecule_failures(tmp_path):
    docking = RecordingDockingEngine(fail_id="benzene")
    progress = []
    rows = prioritize_smiles(
        [
            {"molecule_id": "ethanol", "smiles": "CCO"},
            {"molecule_id": "invalid", "smiles": "not_smiles"},
            {"molecule_id": "benzene", "smiles": "c1ccccc1"},
        ],
        bbb_predictor=UnavailableBBBPredictor("not used"),
        admet_predictor=SuccessfulADMET(),
        enable_docking=True,
        receptor=prepared_receptor(tmp_path),
        docking_config=box_config(),
        docking_engine=docking,
        progress_callback=lambda **values: progress.append(values),
    )
    by_id = {row["molecule_id"]: row for row in rows}
    assert docking.calls == [(["ethanol", "benzene"], ["CCO", "c1ccccc1"])]
    assert by_id["ethanol"]["docking_status"] == "provided"
    assert by_id["benzene"]["docking_result"]["status"] == "docking_failed"
    assert by_id["benzene"]["admet_model_status"] == "model_available"
    assert by_id["ethanol"]["scientific_rank"] is not None
    assert by_id["benzene"]["scientific_rank"] is None
    assert by_id["benzene"]["scientific_ranking_score"] is None
    assert by_id["benzene"]["rank_eligible"] is False
    assert by_id["invalid"]["docking_result"]["status"] == "not_run_invalid_molecule"
    assert by_id["invalid"]["scientific_rank"] is None
    docking_updates = [item for item in progress if item.get("stage") == "docking"]
    assert docking_updates[-1]["processed_count"] == 3
    assert docking_updates[-1]["docking_success_count"] == 1
    assert docking_updates[-1]["docking_failure_count"] == 1


def test_admet_failure_does_not_prevent_successful_docking(tmp_path):
    docking = RecordingDockingEngine()
    row = prioritize_smiles(
        [{"molecule_id": "ethanol", "smiles": "CCO"}],
        bbb_predictor=UnavailableBBBPredictor("not used"),
        admet_predictor=FailedADMET(),
        enable_docking=True,
        receptor=prepared_receptor(tmp_path),
        docking_config=box_config(),
        docking_engine=docking,
    )[0]
    assert row["admet_model_status"] == "model_unavailable"
    assert row["docking_result"]["status"] == "success"
    assert row["docking_score"] == -7.5


def test_pipeline_uses_only_explicit_best_mode_affinity_for_prioritization(tmp_path):
    class AlternativeModeEngine(RecordingDockingEngine):
        def dock_batch(self, molecule_ids, smiles, *, progress_callback=None):
            rows = super().dock_batch(molecule_ids, smiles, progress_callback=progress_callback)
            rows[0].update({
                "best_mode": 2,
                "best_vina_affinity_kcal_mol": -8.3,
                "best_affinity_kcal_mol": -8.3,
                "vina_affinity": -8.3,
                "modes": [
                    {"mode": 1, "affinity_kcal_mol": -7.0, "rmsd_lb": 0.0, "rmsd_ub": 0.0},
                    {"mode": 2, "affinity_kcal_mol": -8.3, "rmsd_lb": 1.0, "rmsd_ub": 1.5},
                    {"mode": 3, "affinity_kcal_mol": -7.8, "rmsd_lb": 2.0, "rmsd_ub": 2.5},
                ],
            })
            return rows

    row = prioritize_smiles(
        [{"molecule_id": "ethanol", "smiles": "CCO"}],
        bbb_predictor=UnavailableBBBPredictor("not used"),
        admet_predictor=SuccessfulADMET(),
        enable_docking=True,
        receptor=prepared_receptor(tmp_path),
        docking_config=box_config(),
        docking_engine=AlternativeModeEngine(),
    )[0]

    assert row["docking_score"] == -8.3
    assert row["docking_result"]["modes"][0]["affinity_kcal_mol"] == -7.0
    assert row["docking_score_normalized"] == 1.0
    assert row["combined_candidate_score"] == round(row["priority_score"] * 0.70 + 0.30, 3)


def test_missing_receptor_returns_family_error_without_erasing_admet():
    row = prioritize_smiles(
        [{"molecule_id": "ethanol", "smiles": "CCO"}],
        bbb_predictor=UnavailableBBBPredictor("not used"),
        admet_predictor=SuccessfulADMET(),
        enable_docking=True,
        docking_config=box_config(),
        docking_setup_error="Prepared receptor upload is required for docking.",
    )[0]
    assert row["admet_model_status"] == "model_available"
    assert row["docking_result"]["status"] == "receptor_unavailable"
    assert row["docking_score"] is None


def test_pipeline_missing_vina_runtime_returns_runtime_unavailable(monkeypatch, tmp_path):
    def unavailable(*args, **kwargs):
        raise DockingRuntimeUnavailable("Vina runtime missing")

    monkeypatch.setattr("molecular_prioritization.pipeline.VinaDockingEngine", unavailable)
    row = prioritize_smiles(
        [{"molecule_id": "ethanol", "smiles": "CCO"}],
        bbb_predictor=UnavailableBBBPredictor("not used"),
        admet_predictor=SuccessfulADMET(),
        enable_docking=True,
        receptor=prepared_receptor(tmp_path),
        docking_config=box_config(),
        docking_output_root=tmp_path / "job",
    )[0]
    assert row["admet_model_status"] == "model_available"
    assert row["docking_result"]["status"] == "runtime_unavailable"
    assert row["scientific_rank"] is None
    assert row["prioritization_status"] == "docking_unavailable"
    assert "Vina runtime missing" in row["docking_result"]["warning"]
