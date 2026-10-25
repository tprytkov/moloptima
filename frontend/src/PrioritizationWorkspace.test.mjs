import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let module;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  module = await vite.ssrLoadModule('/src/PrioritizationWorkspace.jsx');
});

after(async () => vite.close());

const rows = [
  {
    molecule_id: 'cmpd-b', canonical_smiles: 'CCO', valid_molecule: true,
    v2_rank: 2, v2_score: 0.61, v2_rank_eligible: true, prioritization_status: 'fully_scored',
    admet_model_status: 'model_available', docking_result: { status: 'success', best_vina_affinity_kcal_mol: -8.1 },
    chembl_lookup_status: 'exact_match', chembl_similarity_status: 'similarity_match', diversity_cluster_id: '2', nearest_neighbor_similarity: 0.64,
    prioritization_v2: { summary: { rank: 2, final_score: 0.61, rank_eligible: true }, missing_data: [], warnings: [], provenance: { profile_id: 'profile-a', profile_version: '1.0.0', target_mode: 'cns' } },
  },
  {
    molecule_id: 'cmpd-a', canonical_smiles: 'CCC', valid_molecule: true,
    v2_rank: null, v2_score: null, v2_rank_eligible: false, prioritization_status: 'unscorable',
    admet_model_status: 'model_unavailable', docking_result: { status: 'not_run', best_vina_affinity_kcal_mol: null },
    chembl_lookup_status: 'not_requested', chembl_similarity_status: 'not_requested',
    prioritization_v2: { summary: { rank: null, final_score: null, rank_eligible: false }, missing_data: [{ endpoint_id: 'hia_hou', configured_policy: 'unrankable', action_taken: 'excluded' }], warnings: [], provenance: { profile_id: 'profile-a', profile_version: '1.0.0', target_mode: 'cns' } },
  },
];

test('renders stored prioritization rows, inspector evidence, and explicit null states', () => {
  const html = renderToStaticMarkup(React.createElement(module.default, {
    rows,
    result: { prioritization_method: 'profile_v2', prioritization_profile_sha256: 'profile-sha', prioritization_profile: { profile_id: 'profile-a', name: 'Profile A', profile_version: '1.0.0', status: 'frozen', target_mode: 'cns' } },
    job: { job_id: 'job-a', completed_at: '2026-10-16T00:00:00Z' },
  }));
  for (const phrase of ['Candidate overview', 'Candidate rankings and evidence status from this calculation. Filtering and sorting only change the view.', 'cmpd-b', 'Priority Rank', 'Prioritization Score', 'Evidence Status', 'Evidence by domain', 'Prioritization Profile', 'Target Context', 'Exact experimental-compound context', 'Analog / neighbor context', 'Comparison set']) assert.match(html, new RegExp(phrase, 'i'));
  assert.match(html, /0\.61/);
  assert.match(html, /Not available/);
  assert.match(html, /Profile A/);
  assert.match(html, /Cns/);
  assert.doesNotMatch(html, />0<\/td>/);
  assert.doesNotMatch(html, /Legacy v[12]|Prioritization v2|v2 profile/i);
});

test('filtering and sorting preserve stored values and keep unavailable rank last', () => {
  const scored = module.filterAndSortPrioritizationRows(rows, { query: '', readiness: '', admet: '', docking: '', sort: 'score' });
  assert.deepEqual(scored.map((row) => row.molecule_id), ['cmpd-b', 'cmpd-a']);
  assert.equal(scored[0].v2_score, 0.61);
  const filtered = module.filterAndSortPrioritizationRows(rows, { query: 'cmpd-a', readiness: 'unscorable', admet: 'model_unavailable', docking: 'not_run', sort: 'contract' });
  assert.deepEqual(filtered.map((row) => row.molecule_id), ['cmpd-a']);
  assert.equal(filtered[0].v2_score, null);
});

test('authoritative score and rank are read from the persisted contract without recomputation', () => {
  assert.deepEqual(module.authoritativePriority(rows[0]), { rank: 2, score: 0.61 });
  assert.deepEqual(module.authoritativePriority(rows[1]), { rank: null, score: null });
  assert.deepEqual(module.authoritativePriority({ scientific_rank: 3, scientific_ranking_score: 0.55, priority_score: 0.9 }), { rank: 3, score: 0.55 });
});

test('empty docking values stay unavailable while a real zero remains visible', () => {
  assert.deepEqual(module.dockingEvidence({ docking_score: '' }), { status: 'not_available', affinity: null });
  assert.deepEqual(module.dockingEvidence({ docking_score: 0 }), { status: 'not_available', affinity: 0 });
});

test('comparison membership is explicit, removable, and bounded to five candidates', () => {
  assert.deepEqual(module.updateComparisonSelection([], 'a'), ['a']);
  assert.deepEqual(module.updateComparisonSelection(['a'], 'a'), []);
  assert.deepEqual(module.updateComparisonSelection(['a', 'b', 'c', 'd', 'e'], 'f'), ['a', 'b', 'c', 'd', 'e']);
});

test('dataset synchronization clears stale selection and comparison membership', () => {
  const current = { datasetKey: 'job-a', selectedId: 'cmpd-b', comparisonIds: ['cmpd-b'] };
  assert.deepEqual(module.workspaceSelectionReducer(current, { type: 'sync-dataset', datasetKey: 'job-b', firstId: 'new-1' }), { datasetKey: 'job-b', selectedId: 'new-1', comparisonIds: [] });
  assert.equal(module.workspaceSelectionReducer(current, { type: 'sync-dataset', datasetKey: 'job-a', firstId: 'other' }), current);
});

test('candidate table uses keyboard rows, labeled comparison controls, lazy thumbnails, and local overflow', () => {
  const html = renderToStaticMarkup(React.createElement(module.default, { rows, result: {}, job: { job_id: 'job-a' }, baseUrl: 'http://127.0.0.1:8123/' }));
  assert.match(html, /aria-label="Prioritization candidates"/);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /aria-label="Add cmpd-b to comparison set"/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /http:\/\/127\.0\.0\.1:8123\/api\/molecules\/structure/);
  assert.match(html, /width=160&amp;height=120/);
  assert.match(html, /overflow-x:auto/);
});

test('candidate toolbar keeps visible labels separate from accessible native control values', () => {
  const html = renderToStaticMarkup(React.createElement(module.default, { rows, result: {}, job: { job_id: 'job-a' } }));
  assert.match(html, /Search candidates[\s\S]*aria-label="Search candidates"/);
  for (const label of ['Evidence Status', 'ADMET status', 'Docking status', 'Sort by']) {
    assert.match(html, new RegExp(`${label}[\\s\\S]*?<select[^>]+aria-label="${label}"`));
  }
  assert.match(html, /<option value="" selected="">All<\/option>/);
  assert.match(html, /<option value="contract" selected="">Contract order<\/option>/);
});

test('workspace introduces no fabricated composite score or unsupported decision language', () => {
  const html = renderToStaticMarkup(React.createElement(module.default, { rows, result: {}, job: { job_id: 'job-a' } }));
  assert.doesNotMatch(html, /overall confidence|best molecule|winner|binding confidence|binding probability|better binder|successful scaffold hop|essential interaction/i);
  assert.doesNotMatch(html, /comparison score|composite score/i);
});
