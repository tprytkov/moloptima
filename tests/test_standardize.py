from molecular_prioritization.standardize import standardize_smiles


def test_standardize_smiles_trims_valid_input():
    result = standardize_smiles(" CCO ")

    assert result.valid_molecule is True
    assert result.canonical_smiles == "CCO"
    assert result.error is None


def test_standardize_smiles_rejects_empty_input():
    result = standardize_smiles(" ")

    assert result.valid_molecule is False
    assert result.canonical_smiles is None
    assert result.error == "SMILES is empty."


def test_standardize_smiles_rejects_invalid_rdkit_input():
    result = standardize_smiles("C1CC")

    assert result.valid_molecule is False
    assert result.canonical_smiles is None
    assert result.error == "RDKit could not parse SMILES."
