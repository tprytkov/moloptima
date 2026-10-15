from pathlib import Path

from scripts.audit_runtime_sizes import audit
from scripts.profile_scientific_runtime import _summary


def test_profile_summary_reports_minimum_median_and_maximum():
    assert _summary([3.0, 1.0, 2.0]) == {
        "minimum": 1.0,
        "median": 2.0,
        "maximum": 3.0,
    }


def test_runtime_size_audit_is_read_only_and_separates_runtime_families(tmp_path):
    chemprop = tmp_path / "admet" / "chemprop_regression" / "python"
    gmc = tmp_path / "admet" / "gmc_mpnn_bbb" / "python"
    prolif = tmp_path / "prolif" / "python"
    for directory in (chemprop, gmc, prolif):
        directory.mkdir(parents=True)
    (chemprop / "model.pt").write_bytes(b"model")
    (gmc / "python311.dll").write_bytes(b"same-binary")
    (prolif / "python311.dll").write_bytes(b"same-binary")
    bytecode = prolif / "Lib" / "__pycache__"
    bytecode.mkdir(parents=True)
    (bytecode / "module.pyc").write_bytes(b"cache")

    before = sorted(path.relative_to(tmp_path) for path in tmp_path.rglob("*") if path.is_file())
    result = audit(tmp_path, hash_duplicates=True)
    after = sorted(path.relative_to(tmp_path) for path in tmp_path.rglob("*") if path.is_file())

    assert before == after
    totals = {item["runtime"]: item for item in result["runtimes"]}
    assert totals["admet/chemprop_regression"]["bytes"] == 5
    assert totals["admet/gmc_mpnn_bbb"]["file_count"] == 1
    assert totals["prolif"]["file_count"] == 2
    assert result["model_weights"] == {"bytes": 5, "file_count": 1}
    assert result["theoretical_duplicate_bytes"] == len(b"same-binary")
    assert result["safe_trimming_audit"] == [
        {"category": "bytecode", "bytes": 5, "file_count": 1}
    ]


def test_prolif_resolution_source_contains_no_recursive_runtime_scan():
    source = (
        Path(__file__).resolve().parents[1]
        / "molecular_prioritization"
        / "interaction_fingerprints.py"
    ).read_text(encoding="utf-8")
    assert ".rglob(" not in source
    assert "os.walk(" not in source
    assert 'glob("**/*")' not in source
