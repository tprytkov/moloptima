import json
from pathlib import Path

from molecular_prioritization.admet_release import sha256_file
from molecular_prioritization.interaction_fingerprints import resolve_prolif_runtime
from scripts.build_prolif_runtime_windows import (
    ALLOWED_RELOCATION_METADATA,
    find_private_prefix_leaks,
    validate_layout,
)


PROJECT_ROOT = Path(__file__).parents[1]
MANIFEST_PATH = PROJECT_ROOT / "resources" / "prolif" / "runtime_manifest.json"


def _installed_tree(tmp_path):
    app_root = tmp_path / "resources" / "moloptima-app"
    resource = app_root / "resources" / "prolif"
    resource.mkdir(parents=True)
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    runner = resource / "prolif_runner.py"
    runner.write_bytes((PROJECT_ROOT / "resources" / "prolif" / "prolif_runner.py").read_bytes())
    (resource / "runtime_manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    python = tmp_path / "resources" / "runtime" / "prolif" / "python" / "python.exe"
    python.parent.mkdir(parents=True)
    python.touch()
    return app_root, python, runner, manifest


def _probe(versions):
    def command(args, **kwargs):
        output = Path(args[args.index("--output") + 1])
        output.write_text(json.dumps({"versions": versions}), encoding="utf-8")
        return type("Completed", (), {"returncode": 0})()

    return command


def test_manifest_declares_development_then_installed_runtime_candidates():
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    assert manifest["qualification_status"] == "qualified_packaged_windows"
    assert manifest["python_relative_candidates"] == [
        "desktop/runtime/prolif/python/python.exe",
        "../runtime/prolif/python/python.exe",
    ]
    assert sha256_file(PROJECT_ROOT / manifest["runner_relative_path"]) == manifest["runner_sha256"]


def test_installed_candidate_resolves_without_environment_override(tmp_path):
    app_root, python, runner, manifest = _installed_tree(tmp_path)
    resolved = resolve_prolif_runtime(
        application_root=app_root,
        environ={},
        command_runner=_probe(manifest["expected_versions"]),
    )
    assert resolved.python == python.resolve()
    assert resolved.runner == runner.resolve()
    assert resolved.python_source == "packaged"
    assert resolved.runner_source == "packaged"


def test_packaging_allowlist_contains_prolif_resources():
    package = json.loads((PROJECT_ROOT / "desktop" / "package.json").read_text(encoding="utf-8"))
    resource = next(entry for entry in package["build"]["extraResources"] if entry["from"] == "../resources")
    assert {
        "prolif/runtime_manifest.json",
        "prolif/prolif_runner.py",
        "prolif/environment-win-64.yml",
        "prolif/THIRD_PARTY_NOTICES.md",
    }.issubset(resource["filter"])


def test_frozen_environment_spec_matches_manifest_material_versions():
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    specification = (PROJECT_ROOT / "resources" / "prolif" / "environment-win-64.yml").read_text(
        encoding="utf-8"
    ).lower()
    package_names = {
        "python": "python", "prolif": "prolif", "rdkit": "rdkit",
        "MDAnalysis": "mdanalysis", "numpy": "numpy", "scipy": "scipy",
        "pandas": "pandas", "networkx": "networkx", "psutil": "psutil",
        "dill": "dill", "gemmi": "gemmi", "multiprocess": "multiprocess", "tqdm": "tqdm",
    }
    for manifest_name, package_name in package_names.items():
        assert f"{package_name}=={manifest['expected_versions'][manifest_name]}" in specification or (
            f"{package_name}={manifest['expected_versions'][manifest_name]}" in specification
        )
    assert "prefix:" not in specification


def test_packaged_layout_requires_runtime_and_license_evidence(tmp_path):
    for relative in (
        "python.exe", "Lib/site-packages/prolif/__init__.py",
        "Lib/site-packages/rdkit/__init__.py", "Lib/site-packages/MDAnalysis/__init__.py",
        "THIRD_PARTY_NOTICES.md", "THIRD_PARTY_LICENSES.json",
    ):
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch()
    validate_layout(tmp_path)


def test_private_prefix_scan_finds_text_and_binary_leaks(tmp_path):
    safe = tmp_path / "safe.txt"
    safe.write_text("portable runtime", encoding="utf-8")
    assert find_private_prefix_leaks(tmp_path, [b"private-user"]) == []
    leak = tmp_path / "native.bin"
    leak.write_bytes(b"prefix=C:\\Users\\private-user\\runtime")
    assert find_private_prefix_leaks(tmp_path, [b"C:\\Users\\private-user"]) == ["native.bin"]


def test_private_prefix_scan_allows_only_documented_conda_relocation_metadata(tmp_path):
    helper = tmp_path / "Scripts" / "conda-unpack-script.py"
    helper.parent.mkdir(parents=True)
    helper.write_text("prefix=C:\\Users\\private-user\\runtime", encoding="utf-8")
    assert find_private_prefix_leaks(
        tmp_path,
        [b"C:\\Users\\private-user"],
        allowed_paths=ALLOWED_RELOCATION_METADATA,
    ) == []
    other = tmp_path / "Lib" / "settings.py"
    other.parent.mkdir(parents=True)
    other.write_text("prefix=C:\\Users\\private-user\\runtime", encoding="utf-8")
    assert find_private_prefix_leaks(
        tmp_path,
        [b"C:\\Users\\private-user"],
        allowed_paths=ALLOWED_RELOCATION_METADATA,
    ) == ["Lib/settings.py"]
