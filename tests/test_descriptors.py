from molecular_prioritization.descriptors import calculate_descriptors


def test_calculate_descriptors_returns_rdkit_properties():
    descriptors = calculate_descriptors("CCO")

    assert descriptors.mw == 46.069
    assert descriptors.tpsa == 20.23
    assert descriptors.hba == 1
    assert descriptors.hbd == 1
    assert descriptors.rotatable_bonds == 0
    assert 0 <= descriptors.qed <= 1
    assert descriptors.lipinski_violations == 0
    assert descriptors.lipinski_pass is True


def test_calculate_descriptors_marks_lipinski_failure():
    descriptors = calculate_descriptors("CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC")

    assert descriptors.mw > 500
    assert descriptors.lipinski_violations >= 1
    assert descriptors.lipinski_pass is False
