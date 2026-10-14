import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let Comparison;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  ({ default: Comparison } = await vite.ssrLoadModule('/src/MultiLigandComparison.jsx'));
});
after(async () => vite?.close());

const fingerprint = { canonical_tokens: ['A:MET:301:Hydrophobic'], raw_interaction_records: [] };
const points = [
  { molecule_id: 'ref', canonical_smiles: 'Oc1ccccc1', mode: 1, vina_affinity_kcal_mol: -9, structural_similarity: 1, interaction_similarity: 1, fingerprint_status: 'available', fingerprint, scaffold: { exact_scaffold_id: 's1', generic_framework_id: 'g1' }, scaffold_relationship: { code: 'SAME_EXACT_MURCKO', label: 'Same scaffold' }, token_partition: { shared: ['A:MET:301:Hydrophobic'], reference_only: [], comparison_only: [] } },
  { molecule_id: 'cmp', canonical_smiles: 'n1ccccc1', mode: 2, vina_affinity_kcal_mol: -8, structural_similarity: 0.3, interaction_similarity: 0.5, fingerprint_status: 'available', fingerprint, scaffold: { exact_scaffold_id: 's2', generic_framework_id: 'g1' }, scaffold_relationship: { code: 'SAME_GENERIC_FRAMEWORK', label: 'Same framework topology' }, token_partition: { shared: ['A:MET:301:Hydrophobic'], reference_only: [], comparison_only: [] } },
];

test('compare view renders independent metrics, scaffold groups, frequency, and one 3D focus action per card', () => {
  const html = renderToStaticMarkup(React.createElement(Comparison, { points, referenceId: 'ref', baseUrl: 'http://localhost:8000', selectedToken: '', onSelectToken() {}, onFocus3d() {} }));
  for (const phrase of ['Selected-set scientific comparison', 'Morgan Tanimoto', 'Interaction Jaccard', 'Vina affinity', 'Exact scaffolds', 'Generic frameworks', 'Selected-set interaction frequency', 'Side-by-side 2D interaction maps', 'Same framework topology']) assert.match(html, new RegExp(phrase));
  assert.equal((html.match(/Focus in 3D/g) || []).length, 2);
  assert.doesNotMatch(html, /scaffold hop|pharmacophore|overall score|ADMET/i);
});
