import json
import shutil
from pathlib import Path

import pytest

from molecular_prioritization.admet_release import resolve_release_root, sha256_file
from molecular_prioritization.admet_runtime import (
    ADMETRuntimeError,
    RUNTIME_PROBE,
    RUNTIME_PROBE_TIMEOUT_SECONDS,
    isolated_runtime_environment,
    resolve_admet_runtime,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
RESOURCE_MANIFEST = PROJECT_ROOT / "resources" / "admet" / "runtime_manifest.json"


def _model_manifest(path: Path, family: str) -> Path:
    versions = {
        "python": "3.11.15",
        "chemprop": "2.1.0" if family == "gmc_mpnn_bbb" else "2.3.1",
        "lightning": "2.1.4" if family == "gmc_mpnn_bbb" else "2.6.5",
        "numpy": "1.26.4" if family == "gmc_mpnn_bbb" else "2.4.6",
        "rdkit": "2026.3.5",
        "torch": "2.1.2+cu121" if family == "gmc_mpnn_bbb" else "2.6.0+cu124",
    }
    payload = (
        {
            "manifest_version": "gmc-mpnn-bbb-production-v1",
            "environment": {"packages": versions},
        }
        if family == "gmc_mpnn_bbb"
        else {
            "schema_version": "1.0.0",
            "environment": {"expected_pinned": {"package_versions": versions}},
        }
    )
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def _probe(versions: dict[str, str], calls: list[list[str]] | None = None):
    def run(command, **kwargs):
        if calls is not None:
            calls.append(command)
        return type(
            "Completed",
            (),
            {
                "returncode": 0,
                "stdout": "MOLOPTIMA_RUNTIME=" + json.dumps(versions) + "\n",
                "stderr": "",
            },
        )()

    return run


def _install_resources(root: Path, family: str, *, include_runner: bool = True) -> dict:
    manifest = json.loads(RESOURCE_MANIFEST.read_text(encoding="utf-8"))
    destination = root / "resources" / "admet" / "runtime_manifest.json"
    destination.parent.mkdir(parents=True)
    shutil.copyfile(RESOURCE_MANIFEST, destination)
    spec = manifest["families"][family]
    if include_runner:
        source = PROJECT_ROOT / spec["runner_relative_path"]
        target = root / spec["runner_relative_path"]
        target.parent.mkdir(parents=True)
        shutil.copyfile(source, target)
    return spec


@pytest.mark.parametrize("family", ["gmc_mpnn_bbb", "chemprop_regression"])
def test_packaged_family_python_and_validated_runner_are_selected(tmp_path, family):
    spec = _install_resources(tmp_path, family)
    python = tmp_path / spec["python_relative_candidates"][0]
    python.parent.mkdir(parents=True)
    python.touch()
    model = _model_manifest(tmp_path / "model_manifest.json", family)
    expected = json.loads(model.read_text())["environment"]
    versions = expected.get("packages") or expected["expected_pinned"]["package_versions"]

    resolved = resolve_admet_runtime(
        family,
        model_manifest=model,
        application_root=tmp_path,
        environ={},
        command_runner=_probe(versions),
    )

    assert resolved.python == python.resolve()
    assert resolved.runner == (tmp_path / spec["runner_relative_path"]).resolve()
    assert resolved.python_source == "packaged"
    assert resolved.runner_source == "packaged"
    assert resolved.identity == {
        "family": family,
        "runtime_source": "packaged",
        "runner_identity": spec["runner_identity"],
        "runner_sha256": spec["runner_sha256"],
        "runner_resolution_source": "packaged",
        "python_resolution_source": "packaged",
        "runtime_manifest_schema_version": "moloptima-admet-runtime-resources-v1",
        "runtime_versions": versions,
    }


@pytest.mark.parametrize("family", ["gmc_mpnn_bbb", "chemprop_regression"])
def test_explicit_overrides_win(tmp_path, family):
    _install_resources(tmp_path, family, include_runner=False)
    python, runner = tmp_path / "override-python.exe", tmp_path / "override-runner.py"
    python.touch()
    runner.touch()
    model = _model_manifest(tmp_path / "model_manifest.json", family)
    expected = json.loads(model.read_text())["environment"]
    versions = expected.get("packages") or expected["expected_pinned"]["package_versions"]

    resolved = resolve_admet_runtime(
        family,
        model_manifest=model,
        application_root=tmp_path,
        python_override=python,
        runner_override=runner,
        environ={},
        command_runner=_probe(versions),
    )

    assert resolved.python == python.resolve()
    assert resolved.runner == runner.resolve()
    assert resolved.python_source == "explicit_override"
    assert resolved.runner_source == "explicit_override"
    assert resolved.identity["runner_sha256"] == sha256_file(runner)
    assert resolved.identity["runtime_source"] == "explicit_override"
    assert "runner_identity" not in resolved.identity
    assert str(tmp_path) not in str(resolved.identity)


def test_environment_overrides_are_preserved(tmp_path):
    _install_resources(tmp_path, "gmc_mpnn_bbb", include_runner=False)
    python, runner = tmp_path / "env-python.exe", tmp_path / "env-runner.py"
    python.touch()
    runner.touch()
    model = _model_manifest(tmp_path / "model_manifest.json", "gmc_mpnn_bbb")
    versions = json.loads(model.read_text())["environment"]["packages"]
    resolved = resolve_admet_runtime(
        "gmc_mpnn_bbb",
        model_manifest=model,
        application_root=tmp_path,
        environ={"MOLOPTIMA_GMC_PYTHON": str(python), "MOLOPTIMA_GMC_RUNNER": str(runner)},
        command_runner=_probe(versions),
    )
    assert resolved.python_source == "environment_override"
    assert resolved.runner_source == "environment_override"


def test_missing_packaged_runtime_fails_without_current_python_fallback(tmp_path):
    _install_resources(tmp_path, "gmc_mpnn_bbb")
    model = _model_manifest(tmp_path / "model_manifest.json", "gmc_mpnn_bbb")
    calls = []
    with pytest.raises(ADMETRuntimeError, match="packaged_runtime_missing"):
        resolve_admet_runtime(
            "gmc_mpnn_bbb",
            model_manifest=model,
            application_root=tmp_path,
            environ={},
            command_runner=_probe({}, calls),
        )
    assert calls == []


def test_missing_and_tampered_packaged_runner_fail_closed(tmp_path):
    spec = _install_resources(tmp_path, "chemprop_regression", include_runner=False)
    model = _model_manifest(tmp_path / "model_manifest.json", "chemprop_regression")
    with pytest.raises(ADMETRuntimeError, match="packaged_runner_missing"):
        resolve_admet_runtime(
            "chemprop_regression", model_manifest=model, application_root=tmp_path, environ={}
        )
    runner = tmp_path / spec["runner_relative_path"]
    runner.parent.mkdir(parents=True)
    runner.write_text("tampered", encoding="utf-8")
    with pytest.raises(ADMETRuntimeError, match="packaged_runner_hash_mismatch"):
        resolve_admet_runtime(
            "chemprop_regression", model_manifest=model, application_root=tmp_path, environ={}
        )


def test_incompatible_runtime_fails_closed(tmp_path):
    spec = _install_resources(tmp_path, "gmc_mpnn_bbb")
    python = tmp_path / spec["python_relative_candidates"][0]
    python.parent.mkdir(parents=True)
    python.touch()
    model = _model_manifest(tmp_path / "model_manifest.json", "gmc_mpnn_bbb")
    observed = json.loads(model.read_text())["environment"]["packages"]
    observed["chemprop"] = "incompatible"
    with pytest.raises(ADMETRuntimeError, match="runtime_incompatible"):
        resolve_admet_runtime(
            "gmc_mpnn_bbb",
            model_manifest=model,
            application_root=tmp_path,
            environ={},
            command_runner=_probe(observed),
        )


def test_runtime_probe_imports_modules_and_compares_distribution_versions():
    assert "importlib.import_module(name)" in RUNTIME_PROBE
    assert "importlib.metadata.version(name)" in RUNTIME_PROBE
    assert "module.__version__" not in RUNTIME_PROBE


def test_runtime_probe_allows_cold_packaged_torch_imports(tmp_path):
    spec = _install_resources(tmp_path, "gmc_mpnn_bbb")
    python = tmp_path / spec["python_relative_candidates"][0]
    python.parent.mkdir(parents=True)
    python.touch()
    model = _model_manifest(tmp_path / "model_manifest.json", "gmc_mpnn_bbb")
    versions = json.loads(model.read_text())["environment"]["packages"]
    observed = {}

    def probe(command, **kwargs):
        observed.update(kwargs)
        return _probe(versions)(command, **kwargs)

    resolve_admet_runtime(
        "gmc_mpnn_bbb",
        model_manifest=model,
        application_root=tmp_path,
        environ={},
        command_runner=probe,
    )

    assert observed["timeout"] == RUNTIME_PROBE_TIMEOUT_SECONDS == 300


def test_isolated_runtime_environment_removes_only_inherited_rdkit_root():
    environment = isolated_runtime_environment(
        {"PATH": "packaged-runtime-path", "RDBASE": "backend-rdkit-data", "MOLOPTIMA_TEST": "kept"}
    )

    assert environment == {"PATH": "packaged-runtime-path", "MOLOPTIMA_TEST": "kept"}


def test_runtime_probe_does_not_inherit_backend_rdkit_root(tmp_path, monkeypatch):
    spec = _install_resources(tmp_path, "gmc_mpnn_bbb")
    python = tmp_path / spec["python_relative_candidates"][0]
    python.parent.mkdir(parents=True)
    python.touch()
    model = _model_manifest(tmp_path / "model_manifest.json", "gmc_mpnn_bbb")
    versions = json.loads(model.read_text())["environment"]["packages"]
    observed = {}
    monkeypatch.setenv("RDBASE", "backend-rdkit-data")
    monkeypatch.setenv("MOLOPTIMA_TEST", "kept")

    def probe(command, **kwargs):
        observed.update(kwargs)
        return _probe(versions)(command, **kwargs)

    resolve_admet_runtime(
        "gmc_mpnn_bbb",
        model_manifest=model,
        application_root=tmp_path,
        environ={},
        command_runner=probe,
    )

    assert "RDBASE" not in observed["env"]
    assert observed["env"]["MOLOPTIMA_TEST"] == "kept"


def test_resource_resolution_from_simulated_installed_app(tmp_path):
    app_root = tmp_path / "resources" / "moloptima-app"
    spec = _install_resources(app_root, "chemprop_regression")
    python = app_root / spec["python_relative_candidates"][1]
    python.parent.mkdir(parents=True)
    python.touch()
    model = _model_manifest(tmp_path / "model_manifest.json", "chemprop_regression")
    versions = json.loads(model.read_text())["environment"]["expected_pinned"]["package_versions"]
    resolved = resolve_admet_runtime(
        "chemprop_regression",
        model_manifest=model,
        application_root=app_root,
        environ={},
        command_runner=_probe(versions),
    )
    assert resolved.python == python.resolve()


def test_packaged_runner_hashes_and_release_references_are_recorded():
    manifest = json.loads(RESOURCE_MANIFEST.read_text(encoding="utf-8"))
    assert manifest["schema_version"] == "moloptima-admet-runtime-resources-v1"
    for spec in manifest["families"].values():
        runner = PROJECT_ROOT / spec["runner_relative_path"]
        assert sha256_file(runner) == spec["runner_sha256"]
        assert "production_manifest.json#/environment/" in spec["runtime_contract_reference"]
        assert spec["runtime_contract_manifest_version"]


def test_desktop_packaging_uses_explicit_scientific_runtime_resource_allowlist():
    package = json.loads((PROJECT_ROOT / "desktop" / "package.json").read_text(encoding="utf-8"))
    model_resources = next(
        entry for entry in package["build"]["extraResources"] if entry["from"] == "../app_data"
    )
    assert model_resources["to"] == "moloptima-app/app_data"
    assert model_resources["filter"] == ["**/.gitkeep", "model_resources/admet/**/*"]

    resource = next(
        entry for entry in package["build"]["extraResources"] if entry["from"] == "../resources"
    )
    assert resource["to"] == "moloptima-app/resources"
    assert resource["filter"] == [
        "admet/runtime_manifest.json",
        "admet/runners/**/*",
        "vina/**/*",
        "openbabel/**/*",
        "prioritization_profiles/**/*",
        "receptor_preparation/runtime_manifest.json",
        "runtime/vina/**/*",
        "runtime/openbabel/**/*",
        "!**/__pycache__/**",
        "!**/*.pyc",
    ]


def test_release_resolution_ignores_runner_only_resource_directory(tmp_path, monkeypatch):
    _install_resources(tmp_path, "gmc_mpnn_bbb")
    monkeypatch.delenv("MOLOPTIMA_ADMET_RELEASE_ROOT", raising=False)
    assert resolve_release_root(application_root=tmp_path) is None
    release = tmp_path / "resources" / "admet" / "GMC_MPNN_BBB"
    release.mkdir()
    assert resolve_release_root(application_root=tmp_path) == release.parent.resolve()
