import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let Workspace;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  ({ default: Workspace } = await vite.ssrLoadModule('/src/DesignLogicWorkspace.jsx'));
});

after(async () => vite?.close());

const fingerprint = {
  schema_version: 'moloptima-interaction-fingerprint-v1', status: 'success', unique_token_count: 2,
  canonical_tokens: ['A:MET:301:Hydrophobic', 'B:ASN:236:HBDonor:ligand_donor'],
  raw_interaction_records: [{
    receptor: { chain: 'B', residue_name: 'ASN', residue_number: '236', insertion_code: '', atoms: [{ atom_name: 'OD1', atom_serial: 20 }] },
    ligand: { pose_atoms: [{ pose_atom_serial: 7 }] }, interaction_type: 'HBDonor', direction: 'ligand_donor', geometry: { distance: 2.9 },
  }],
  receptor: { identity: '9IIR', authoritative_sha256: 'abc123456789def', protonation_status: 'not_scientifically_resolved' },
  mapping_schema_version: 'moloptima-template-pose-atom-mapping-v2', runtime_provenance: { versions: { prolif: '2.2.3' } }, cache_status: 'hit',
};
const points = [
  { molecule_id: 'ref', display_name: 'Reference', canonical_smiles: 'CCO', source: 'Imported', scaffold_id: 'scf_a', same_scaffold_as_reference: true, mode: 1, vina_affinity_kcal_mol: -9, structural_similarity: 1, interaction_similarity: 1, interaction_similarity_status: 'valid', fingerprint_status: 'available', fingerprint, token_partition: { shared: fingerprint.canonical_tokens, reference_only: [], comparison_only: [] } },
  { molecule_id: 'cmp', display_name: 'Comparison', canonical_smiles: 'CCN', source: 'GenMol', scaffold_id: 'scf_b', same_scaffold_as_reference: false, mode: 1, vina_affinity_kcal_mol: -8, structural_similarity: 0.31, interaction_similarity: 0.76, interaction_similarity_status: 'valid', fingerprint_status: 'available', fingerprint, token_partition: { shared: ['A:MET:301:Hydrophobic'], reference_only: ['B:ASN:236:HBDonor:ligand_donor'], comparison_only: ['B:PRO:240:Hydrophobic'] } },
  { molecule_id: 'missing', display_name: 'Missing', canonical_smiles: 'CCC', source: 'Imported', scaffold_id: null, mode: 1, structural_similarity: 0.2, interaction_similarity: null, interaction_similarity_status: 'not_analyzed', fingerprint_status: 'not_analyzed', fingerprint_message: 'This explicit pose has not been analyzed.' },
  { molecule_id: 'bad', display_name: 'Bad context', canonical_smiles: 'CCCC', source: 'Imported', mode: 1, structural_similarity: 0.4, interaction_similarity: null, interaction_similarity_status: 'incompatible', fingerprint_status: 'available', fingerprint },
];
const workspace = {
  coverage: { total: 4, available: 3, not_analyzed: 1, incompatible: 1, missing_pose: 0 }, points,
  matrix: { features: fingerprint.canonical_tokens, columns: points.slice(0, 2).map((point) => ({ molecule_id: point.molecule_id, mode: 1, present_tokens: fingerprint.canonical_tokens })), ordering: 'deterministic ordering' },
};
const result = { job_id: 'job-1', results: points.map((point) => ({ molecule_id: point.molecule_id, docking_result: { status: 'success', modes: [{ mode: 1 }] } })) };

function render(selected = 'cmp') {
  return renderToStaticMarkup(React.createElement(Workspace, { result, initialWorkspace: workspace, initialReferenceId: 'ref', initialSelectedId: selected, initialReferenceMode: 1, initialComparisonMode: 1 }));
}

function renderCompare() {
  return renderToStaticMarkup(React.createElement(Workspace, { result, initialWorkspace: workspace, initialReferenceId: 'ref', initialSelectedId: 'cmp', initialReferenceMode: 1, initialComparisonMode: 1, initialComparisonIds: ['cmp'], initialViewMode: 'compare' }));
}

test('workspace renders explicit reference and pose semantics with independent metrics', () => {
  const html = render();
  assert.match(html, /Design Logic/);
  assert.match(html, /Reference molecule/);
  assert.match(html, /Reference Vina mode/);
  assert.match(html, /Comparison Vina mode/);
  assert.match(html, /Morgan fingerprint Tanimoto/);
  assert.match(html, /Interaction fingerprint similarity/);
  assert.doesNotMatch(html, /overall similarity|combined score|binding-preservation score/i);
});

test('scatter, matrix, unavailable states, and keyboard points are accessible', () => {
  const html = render();
  assert.match(html, /Morgan structural Tanimoto by interaction fingerprint similarity scatter plot/);
  assert.match(html, /role="button" tabindex="0"/);
  assert.match(html, /Binary residue by molecule interaction matrix/);
  assert.match(html, /present/);
  assert.match(html, /Not analyzed/);
  assert.match(html, /Incompatible/);
});

test('inspector distinguishes token partitions, raw contacts, and provenance', () => {
  const html = render();
  for (const phrase of ['Shared', 'Reference-only', 'Comparison-only', 'Raw contacts', 'Fingerprint provenance', 'ProLIF', 'Different scaffold']) {
    assert.match(html, new RegExp(phrase));
  }
  assert.match(render('ref'), /Same scaffold/);
  assert.match(html, /They are not experimental binding evidence/);
  assert.doesNotMatch(html, /confirmed scaffold hop|true binding mode/i);
});

test('source confirms analysis is explicit and hover or selection never calls the backend', async () => {
  const source = await readFile(new URL('./DesignLogicWorkspace.jsx', import.meta.url), 'utf8');
  assert.match(source, /Analyze selected pose/);
  assert.match(source, /onClick=\{\(\) => onSelect\(point\.molecule_id\)\}/);
  assert.doesNotMatch(source, /onMouse(Enter|Move).*postJson/);
  assert.match(source, /explicit Vina poses/);
  assert.doesNotMatch(source, /scaffold hop/i);
});

test('compare mode keeps persistent selection separate from current point and retains one 3D surface', async () => {
  const html = renderCompare();
  assert.match(html, /Comparison set/);
  assert.match(html, /Clear comparisons/);
  assert.match(html, /Selected-set scientific comparison/);
  assert.match(html, /Remove cmp from comparison set/);
  assert.match(html, /Add to comparison|In comparison set/);
  const source = await readFile(new URL('./DesignLogicWorkspace.jsx', import.meta.url), 'utf8');
  assert.equal((source.match(/<InteractionVisualizationPanel/g) || []).length, 1);
  assert.match(source, /setSelectedId\(moleculeId\)/);
  assert.match(source, /addComparison\(current, moleculeId, referenceId\)/);
});
