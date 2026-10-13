"""Contract tests that execute only inside the optional frozen ProLIF runtime."""

import importlib.util
from pathlib import Path

import pytest


pytest.importorskip("prolif")

RUNNER = Path(__file__).parents[1] / "resources" / "prolif" / "prolif_runner.py"
SPEC = importlib.util.spec_from_file_location("moloptima_prolif_runner", RUNNER)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def test_ligand_relative_direction_semantics():
    assert MODULE.DIRECTIONS == {
        "HBDonor": "ligand_donor",
        "HBAcceptor": "ligand_acceptor",
        "Anionic": "ligand_anion",
        "Cationic": "ligand_cation",
        "CationPi": "ligand_cation",
        "PiCation": "ligand_pi",
    }
    assert MODULE.DIRECTIONS.get("Hydrophobic") is None
    assert MODULE.DIRECTIONS.get("PiStacking") is None
    assert MODULE.DIRECTIONS.get("VdWContact") is None


def test_supported_interaction_configuration_is_frozen():
    assert MODULE.INTERACTIONS == (
        "Hydrophobic", "HBDonor", "HBAcceptor", "PiStacking", "Anionic",
        "Cationic", "CationPi", "PiCation", "VdWContact",
    )
