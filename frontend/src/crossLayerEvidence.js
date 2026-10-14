const EXPORT_COLUMNS = [
  ['reference_molecule', (row) => row.identity.reference_molecule_id],
  ['reference_pose', (row) => row.identity.reference_mode],
  ['comparison_molecule', (row) => row.identity.comparison_molecule_id],
  ['comparison_pose', (row) => row.identity.comparison_mode],
  ['receptor_identity', (row) => row.identity.receptor_identity],
  ['structure_status', (row) => row.structure.status],
  ['morgan_tanimoto', (row) => row.structure.morgan_tanimoto],
  ['exact_scaffold_relationship', (row) => row.structure.exact_scaffold_relationship],
  ['generic_framework_relationship', (row) => row.structure.generic_framework_relationship],
  ['pharmacophore_status', (row) => row.pharmacophore.status],
  ['pharmacophore_threshold_angstrom', (row) => row.pharmacophore.distance_threshold_angstrom],
  ['pharmacophore_matched_count', (row) => row.pharmacophore.matched_feature_count],
  ['pharmacophore_reference_feature_count', (row) => row.pharmacophore.reference_feature_count],
  ['pharmacophore_comparison_feature_count', (row) => row.pharmacophore.comparison_feature_count],
  ['pharmacophore_reference_coverage', (row) => row.pharmacophore.reference_coverage],
  ['pharmacophore_comparison_coverage', (row) => row.pharmacophore.comparison_coverage],
  ['pharmacophore_overlap', (row) => row.pharmacophore.feature_overlap],
  ['pharmacophore_rmsd_angstrom', (row) => row.pharmacophore.matched_feature_center_rmsd_angstrom],
  ['interaction_status', (row) => row.interactions.status],
  ['interaction_jaccard', (row) => row.interactions.jaccard],
  ['shared_interaction_count', (row) => row.interactions.shared_count],
  ['reference_only_interaction_count', (row) => row.interactions.reference_only_count],
  ['comparison_only_interaction_count', (row) => row.interactions.comparison_only_count],
  ['reference_vina_affinity_kcal_mol', (row) => row.docking.reference_affinity_kcal_mol],
  ['comparison_vina_affinity_kcal_mol', (row) => row.docking.comparison_affinity_kcal_mol],
  ['affinity_difference_kcal_mol', (row) => row.docking.affinity_difference_kcal_mol],
];

function csvCell(value) {
  if (value == null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function evidenceCsv(payload) {
  const rows = payload?.comparisons || [];
  return [
    EXPORT_COLUMNS.map(([name]) => name).join(','),
    ...rows.map((row) => EXPORT_COLUMNS.map(([, read]) => csvCell(read(row))).join(',')),
  ].join('\r\n');
}

export function evidenceJson(payload) {
  return JSON.stringify(payload, null, 2);
}

export function evidenceMetric(value, suffix = '') {
  return Number.isFinite(value) ? `${Number(value).toFixed(3)}${suffix}` : 'Unavailable';
}

export function evidenceSummary(row) {
  if (!row) return 'Select a comparison molecule to inspect independent cross-layer evidence.';
  const phrases = [];
  const id = row.identity.comparison_molecule_id;
  const generic = row.structure.generic_framework_relationship;
  phrases.push(`${id} uses ${generic ? generic.toLowerCase() : 'an unavailable generic framework relationship'} relative to the reference.`);
  phrases.push(Number.isFinite(row.structure.morgan_tanimoto)
    ? `Morgan Tanimoto is ${Number(row.structure.morgan_tanimoto).toFixed(3)}.`
    : 'Morgan Tanimoto is unavailable.');
  const pharmacophore = row.pharmacophore;
  if (pharmacophore.status === 'available' || pharmacophore.status === 'one_empty' || pharmacophore.status === 'both_empty') {
    phrases.push(`At the ${Number(pharmacophore.distance_threshold_angstrom).toFixed(2)} Å pharmacophore matching threshold, ${pharmacophore.matched_feature_count ?? 0} of ${pharmacophore.reference_feature_count ?? 0} reference features are matched; feature overlap is ${evidenceMetric(pharmacophore.feature_overlap)} and feature-center RMSD is ${evidenceMetric(pharmacophore.matched_feature_center_rmsd_angstrom, ' Å')}.`);
  } else {
    phrases.push(`Pharmacophore comparison is unavailable (${pharmacophore.status}).`);
  }
  phrases.push(Number.isFinite(row.interactions.jaccard)
    ? `Predicted interaction fingerprint overlap is ${Number(row.interactions.jaccard).toFixed(3)}; ${row.interactions.reference_only_count ?? 0} reference interactions are not present in the selected comparison pose.`
    : `Predicted interaction comparison is unavailable (${row.interactions.status}).`);
  const docking = row.docking;
  phrases.push(Number.isFinite(docking.reference_affinity_kcal_mol) && Number.isFinite(docking.comparison_affinity_kcal_mol)
    ? `Vina affinities are ${Number(docking.reference_affinity_kcal_mol).toFixed(2)} and ${Number(docking.comparison_affinity_kcal_mol).toFixed(2)} kcal/mol; Δ is comparison minus reference.`
    : 'One or both Vina affinities are unavailable.');
  return phrases.join(' ');
}

export function filterEvidenceRows(rows = [], scaffold = 'all', availability = 'all') {
  return rows.filter((row) => {
    const scaffoldMatches = scaffold === 'all' || row.structure.relationship_code === scaffold;
    const availabilityMatches = availability === 'all'
      || (availability === 'pharmacophore' && ['available', 'one_empty', 'both_empty'].includes(row.pharmacophore.status))
      || (availability === 'interactions' && Number.isFinite(row.interactions.jaccard));
    return scaffoldMatches && availabilityMatches;
  });
}

export function sortEvidenceRows(rows = [], key = 'molecule', direction = 'asc') {
  const readers = {
    molecule: (row) => row.identity.comparison_molecule_id,
    pose: (row) => row.identity.comparison_mode,
    morgan: (row) => row.structure.morgan_tanimoto,
    pharmacophore: (row) => row.pharmacophore.feature_overlap,
    interaction: (row) => row.interactions.jaccard,
    affinity: (row) => row.docking.comparison_affinity_kcal_mol,
  };
  const read = readers[key] || readers.molecule;
  const factor = direction === 'desc' ? -1 : 1;
  return [...rows].sort((left, right) => {
    const a = read(left); const b = read(right);
    if (a == null && b == null) return left.identity.comparison_molecule_id.localeCompare(right.identity.comparison_molecule_id);
    if (a == null) return 1;
    if (b == null) return -1;
    const value = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
    return value === 0 ? left.identity.comparison_molecule_id.localeCompare(right.identity.comparison_molecule_id) : value * factor;
  });
}
