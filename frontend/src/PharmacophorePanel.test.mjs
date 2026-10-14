import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let Panel;
let module;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  module = await vite.ssrLoadModule('/src/PharmacophorePanel.jsx');
  Panel = module.default;
});

after(async () => vite?.close());

const feature = (featureId, canonicalClass, x) => ({ feature_id: featureId, canonical_class: canonicalClass, template_atom_indices: [0], pose_atom_indices: [0], feature_center_xyz: [x, 0, 0], plane_normal: canonicalClass === 'AROMATIC' ? [0, 0, 1] : null });
const refFeatures = [feature('r1', 'HBA', 0), feature('r2', 'AROMATIC', 2)];
const cmpFeatures = [feature('c1', 'HBA', 0.5), feature('c2', 'HBD', 5)];
const pair = { status: 'available', matched_feature_count: 1, reference_feature_count: 2, comparison_feature_count: 2, reference_coverage: 0.5, comparison_coverage: 0.5, pharmacophore_feature_overlap: 0.5, matched_feature_center_rmsd_angstrom: null, single_match_distance_angstrom: 0.5, matched_features_by_class: { HBA: 1 }, matches: [{ reference_feature_id: 'r1', comparison_feature_id: 'c1', canonical_class: 'HBA', distance_angstrom: 0.5 }], reference_only_features: [refFeatures[1]], comparison_only_features: [cmpFeatures[1]] };
const payload = {
  schema_version: 'moloptima-design-logic-pharmacophore-v1', reference_mode: 1, comparison_mode: 2, distance_threshold_angstrom: 1.5,
  reference: { status: 'available', molecule_id: 'ref', mode: 1, feature_set: { schema_version: 'pharmacophore-v1', mapping_schema: 'mapping-v2', features: refFeatures }, visualization: {} },
  comparisons: [{ molecule_id: 'cmp', mode: 2, feature_state: { status: 'available', molecule_id: 'cmp', mode: 2, feature_set: { features: cmpFeatures }, visualization: {} }, comparison: pair, threshold_sensitivity: [0.75, 1, 1.5, 2].map((threshold, index) => ({ ...pair, distance_threshold_angstrom: threshold, matched_feature_count: index < 2 ? 0 : 1 })) }],
  reference_feature_matrix: { semantics: 'actual backend one-to-one matches', columns: [{ molecule_id: 'cmp', mode: 2 }], rows: [{ reference_feature_id: 'r1', canonical_class: 'HBA', matched_comparison_count: 1, selected_comparison_count: 1, cells: [{ molecule_id: 'cmp', status: 'matched', distance_angstrom: 0.5 }] }] },
  metadata: { matching_authority: 'backend', cache_status: 'not_cached', ligand_realignment_used: false, aromatic_orientation_filter_used: false },
};
const points = [{ molecule_id: 'ref', canonical_smiles: 'CCO' }, { molecule_id: 'cmp', canonical_smiles: 'CCN', structural_similarity: 0.4, interaction_similarity: 0.3, vina_affinity_kcal_mol: -8, same_scaffold_as_reference: false }];

test('pair metrics use single-match distance and never fabricate RMSD from one match', () => {
  const rows = module.pairMetricRows(pair);
  assert.deepEqual(rows.at(-1), ['Single-match distance', '0.500 Å']);
  assert.ok(!rows.some(([label]) => label === 'Matched-center RMSD'));
});

test('zero-match metrics keep RMSD unavailable and class counts remain descriptive', () => {
  const rows = module.pairMetricRows({ ...pair, matched_feature_count: 0, single_match_distance_angstrom: null, matched_feature_center_rmsd_angstrom: null });
  assert.deepEqual(rows.at(-1), ['Matched-center RMSD', 'Unavailable']);
  assert.deepEqual(module.featureClassRows(refFeatures, cmpFeatures, pair).find((row) => row.name === 'HBA'), {
    name: 'HBA', reference: 1, comparison: 1, matched: 1,
  });
});

test('3D pharmacophore export honors the qualified requested pixel dimensions exactly', () => {
  assert.deepEqual(module.pharmacophore3dExportDimensions({ width: 3840, height: 2160 }), {
    width: 3840, height: 2160,
  });
});

test('panel renders explicit poses, independent context, sensitivity, selected-set matrix, and limitations', () => {
  const html = renderToStaticMarkup(React.createElement(Panel, { baseUrl: '', jobId: 'job-1', payload, points, rows: [], focusedMoleculeId: 'cmp' }));
  for (const phrase of ['Pose-specific pharmacophore evidence', 'ref · Mode 1 vs cmp · Mode 2', 'Single-match distance', 'Morgan Tanimoto', 'not combined into a score', 'Threshold sensitivity', 'Selected-set pharmacophore comparison', 'Reference-feature match matrix', 'No ligand realignment was used', 'Pharmacophore feature class counts']) assert.match(html, new RegExp(phrase, 'i'));
  assert.match(html, /0\.75 Å/);
  assert.match(html, /1\.50 Å/);
});

test('panel source keeps one shared 3D viewer and does not implement scientific matching', async () => {
  const source = await readFile(new URL('./PharmacophorePanel.jsx', import.meta.url), 'utf8');
  assert.equal((source.match(/<ReceptorViewer\b/g) || []).length, 1);
  assert.doesNotMatch(source, /hungarian|linear_sum_assignment|tanimoto.*pharmacophore/i);
  assert.match(source, /H-bond features are center markers only; no direction arrows are inferred/);
  assert.match(source, /Aromatic planes are visual context and are not an orientation match filter/);
});
