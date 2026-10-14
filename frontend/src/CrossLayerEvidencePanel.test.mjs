import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let Panel;
let helpers;

const row = {
  identity: { reference_molecule_id: 'ref', reference_mode: 1, comparison_molecule_id: 'cmp', comparison_mode: 2, receptor_identity: '9IIR' },
  structure: { status: 'available', morgan_tanimoto: 0.093, exact_scaffold_relationship: 'Different exact Murcko', generic_framework_relationship: 'Different generic framework', relationship_code: 'DIFFERENT_FRAMEWORK' },
  pharmacophore: { status: 'available', distance_threshold_angstrom: 1.5, reference_feature_count: 5, comparison_feature_count: 6, matched_feature_count: 4, reference_coverage: 0.8, comparison_coverage: 0.667, feature_overlap: 0.571, matched_feature_center_rmsd_angstrom: 0.807 },
  interactions: { status: 'valid', jaccard: 0.42, shared_count: 3, reference_only_count: 2, comparison_only_count: 1, reference_token_count: 5 },
  docking: { status: 'available', reference_affinity_kcal_mol: -10.1, comparison_affinity_kcal_mol: -9, affinity_difference_kcal_mol: 1.1, affinity_difference_definition: 'comparison affinity - reference affinity' },
  atom_cross_references: [{ template_atom_index: 11, pharmacophore_features: [{ feature_id: 'HBA-11', canonical_class: 'HBA' }], predicted_interactions: [{ canonical_token: 'B:ASN:236:HBAcceptor' }] }],
};
const payload = {
  schema_version: 'moloptima-design-logic-cross-layer-evidence-v1', job_id: 'job-1', reference_molecule_id: 'ref', reference_mode: 1, comparison_mode: 2, distance_threshold_angstrom: 1.5,
  comparisons: [row, { ...row, identity: { ...row.identity, comparison_molecule_id: 'cmp-2' }, structure: { ...row.structure, relationship_code: 'SAME_GENERIC_FRAMEWORK', generic_framework_relationship: 'Same generic framework' }, interactions: { ...row.interactions, status: 'missing_template', jaccard: null, shared_count: null, reference_only_count: null, comparison_only_count: null } }],
  selected_set_frequencies: { generic_framework_relationships: [{ label: 'Different generic framework', count: 1, selected_comparison_count: 2 }], reference_pharmacophore_features: [{ reference_feature_id: 'HBA-02', canonical_class: 'HBA', matched_comparison_count: 1, selected_comparison_count: 2 }], shared_predicted_interactions: [{ token: 'B:ASN:236:HBAcceptor', count: 1, selected_comparison_count: 2 }] },
  provenance: { workspace_schema: 'workspace-v1', pharmacophore_workspace_schema: 'pharmacophore-v1', interaction_method: 'Jaccard', vina_result_source: 'stored explicit docking result mode' },
};

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  ({ default: Panel } = await vite.ssrLoadModule('/src/CrossLayerEvidencePanel.jsx'));
  helpers = await vite.ssrLoadModule('/src/crossLayerEvidence.js');
});
after(async () => vite?.close());

test('cross-layer panel renders exact independent evidence, threshold, summary, matrix, and provenance drilldown', () => {
  const html = renderToStaticMarkup(React.createElement(Panel, { payload, focusedMoleculeId: 'cmp', threshold: 1.5, onThresholdChange() {}, onFocusComparison() {} }));
  for (const phrase of ['Cross-Layer Evidence', 'Morgan Tanimoto', '0.093', 'Different exact Murcko', 'Different generic framework', '4 / 5', '0.571', '0.807 Å', '1.50 Å', 'Interaction Jaccard', '0.420', 'Reference affinity', '-10.100 kcal/mol', 'Δ affinity', 'Structural divergence / recognition preservation', 'Reference-centered design-pattern table', 'Atom-provenance cross-layer inspection', 'B:ASN:236:HBAcceptor', 'Export CSV', 'Export JSON']) assert.match(html, new RegExp(phrase));
  assert.match(html, /Reference-centered cross-layer evidence matrix/);
  assert.match(html, /tabindex="0"/);
  assert.doesNotMatch(html, /winner|best candidate|successful scaffold hop|binding confidence/i);
});

test('unavailable interaction remains textual and never becomes numeric zero', () => {
  const html = renderToStaticMarkup(React.createElement(Panel, { payload, focusedMoleculeId: 'cmp-2', threshold: 1.5, onThresholdChange() {}, onFocusComparison() {} }));
  assert.match(html, /Predicted interaction comparison is unavailable \(missing_template\)/);
  assert.match(html, /Interaction Jaccard<\/span><span[^>]*>Unavailable/);
  assert.match(html, /Pharmacophore.*available/is);
});

test('deterministic summary preserves poses, active threshold, and independent model language', () => {
  const summary = helpers.evidenceSummary(row);
  assert.match(summary, /Morgan Tanimoto is 0\.093/);
  assert.match(summary, /1\.50 Å pharmacophore matching threshold/);
  assert.match(summary, /Predicted interaction fingerprint overlap is 0\.420/);
  assert.match(summary, /Vina affinities are -10\.10 and -9\.00/);
  assert.doesNotMatch(summary, /better|stronger|optimized|success/i);
});

test('CSV and JSON export loaded values with explicit statuses and no aggregate ranking field', () => {
  const csv = helpers.evidenceCsv(payload);
  assert.equal(csv.split('\r\n').length, 3);
  for (const heading of ['reference_molecule', 'comparison_pose', 'morgan_tanimoto', 'pharmacophore_threshold_angstrom', 'interaction_status', 'affinity_difference_kcal_mol']) assert.match(csv, new RegExp(heading));
  assert.match(csv, /ref,1,cmp,2,9IIR/);
  assert.doesNotMatch(csv, /overall|rank|winner/i);
  assert.deepEqual(JSON.parse(helpers.evidenceJson(payload)), payload);
});

test('categorical filters and independent sorting do not mutate the selected set', () => {
  const original = [...payload.comparisons];
  assert.deepEqual(helpers.filterEvidenceRows(payload.comparisons, 'SAME_GENERIC_FRAMEWORK', 'all').map((item) => item.identity.comparison_molecule_id), ['cmp-2']);
  assert.deepEqual(helpers.filterEvidenceRows(payload.comparisons, 'all', 'interactions').map((item) => item.identity.comparison_molecule_id), ['cmp']);
  assert.deepEqual(helpers.sortEvidenceRows(payload.comparisons, 'interaction', 'desc').map((item) => item.identity.comparison_molecule_id), ['cmp', 'cmp-2']);
  assert.deepEqual(payload.comparisons, original);
});
