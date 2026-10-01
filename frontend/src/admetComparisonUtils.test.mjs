import assert from 'node:assert/strict';
import test from 'node:test';
import { ADMET_ENDPOINT_REGISTRY } from './admetAnalysisData.js';
import {
  ADMET_COMPARISON_PICKER_LIMIT,
  MAX_ADMET_COMPARISON_MOLECULES,
  addAdmetComparisonId,
  buildAdmetComparisonRows,
  classificationsDiffer,
  clearAdmetComparison,
  comparisonVisibility,
  describeNumericComparison,
  removeAdmetComparisonId,
  resolveAdmetComparisonMolecules,
  searchAdmetComparisonCandidates,
} from './admetComparison.js';

function molecule(id, overrides = {}) {
  const properties = Object.fromEntries(ADMET_ENDPOINT_REGISTRY.map((endpoint, index) => [endpoint.key, {
    endpointKey: endpoint.key,
    value: endpoint.valueType === 'regression' ? index : index % 2,
    classification: endpoint.valueType === 'regression' ? null : index % 2 ? 'Positive' : 'Negative',
    probability: endpoint.valueType === 'regression' ? null : index / 20,
    unit: endpoint.unit,
    status: { code: 'available', label: 'Results available' },
  }]));
  for (const [key, value] of Object.entries(overrides.properties || {})) properties[key] = { ...properties[key], ...value };
  return { moleculeId: id, displayName: overrides.displayName || id, canonicalSmiles: overrides.smiles || 'CCO', sourceName: overrides.sourceName || `${id}.sdf`, sourceIndex: overrides.sourceIndex || 0, properties };
}

test('add preserves deterministic selection order', () => assert.deepEqual(addAdmetComparisonId(addAdmetComparisonId([], 'b'), 'a'), ['b', 'a']));
test('remove preserves every other selection', () => assert.deepEqual(removeAdmetComparisonId(['a', 'b', 'c'], 'b'), ['a', 'c']));
test('duplicate add is ignored', () => assert.deepEqual(addAdmetComparisonId(['a', 'b'], 'a'), ['a', 'b']));
test('maximum of five selections is enforced', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  assert.equal(MAX_ADMET_COMPARISON_MOLECULES, 5);
  assert.deepEqual(addAdmetComparisonId(ids, 'f'), ids);
});
test('clear comparison removes only comparison selections', () => assert.deepEqual(clearAdmetComparison(), []));

test('selection remains independent of filters, search, and pagination', () => {
  const ids = ['a', 'b'];
  assert.deepEqual(comparisonVisibility(ids, [molecule('a')]), { a: true, b: false });
  assert.deepEqual(ids, ['a', 'b']);
});

test('missing selected molecules resolve safely and in selection order', () => {
  const resolved = resolveAdmetComparisonMolecules([molecule('a')], ['missing', 'a']);
  assert.equal(resolved[0].molecule, null);
  assert.equal(resolved[1].molecule.moleculeId, 'a');
});

test('picker searches normalized identity fields and excludes selected molecules', () => {
  const rows = [molecule('alpha', { smiles: 'CCN' }), molecule('beta', { sourceName: 'screen.sdf' })];
  assert.deepEqual(searchAdmetComparisonCandidates(rows, 'CCN', []).map(({ moleculeId }) => moleculeId), ['alpha']);
  assert.deepEqual(searchAdmetComparisonCandidates(rows, 'screen', ['beta']), []);
});

test('picker requires typing and bounds results to thirty', () => {
  const rows = Array.from({ length: 100 }, (_, index) => molecule(`compound-${index}`));
  assert.deepEqual(searchAdmetComparisonCandidates(rows, '', []), []);
  assert.equal(searchAdmetComparisonCandidates(rows, 'compound', []).length, ADMET_COMPARISON_PICKER_LIMIT);
});

test('comparison preserves regression values, zero, and negatives', () => {
  const comparison = buildAdmetComparisonRows([
    molecule('a', { properties: { caco2_wang: { value: 0 } } }),
    molecule('b', { properties: { caco2_wang: { value: -2 } } }),
  ]).find(({ endpoint }) => endpoint.key === 'caco2_wang');
  assert.deepEqual(comparison.properties.map(({ value }) => value), [0, -2]);
});

test('classification and probability are preserved', () => {
  const property = buildAdmetComparisonRows([molecule('a', { properties: { hia_hou: { classification: 'Positive', probability: 0.87 } } })])
    .find(({ endpoint }) => endpoint.key === 'hia_hou').properties[0];
  assert.equal(property.classification, 'Positive');
  assert.equal(property.probability, 0.87);
});

test('unavailable canonical status is preserved', () => {
  const property = buildAdmetComparisonRows([molecule('a', { properties: { ppbr_az: { value: null, status: { code: 'model_unavailable', label: 'Model unavailable' } } } })])
    .find(({ endpoint }) => endpoint.key === 'ppbr_az').properties[0];
  assert.equal(property.status.code, 'model_unavailable');
});

test('all normalized registry endpoints are represented exactly once', () => {
  assert.deepEqual(buildAdmetComparisonRows([molecule('a')]).map(({ endpoint }) => endpoint.key), ADMET_ENDPOINT_REGISTRY.map(({ key }) => key));
});

test('lowest, highest, range, and equal values are descriptive only', () => {
  const varied = [molecule('a', { properties: { vdss_lombardo: { value: -1 } } }), molecule('b', { properties: { vdss_lombardo: { value: 3 } } })];
  const summary = describeNumericComparison(varied, 'vdss_lombardo');
  assert.deepEqual(summary, { count: 2, lowest: -1, highest: 3, range: 4, equal: false });
  assert.equal(Object.hasOwn(summary, 'winner'), false);
  const equal = varied.map((row) => molecule(row.moleculeId, { properties: { vdss_lombardo: { value: 2 } } }));
  assert.equal(describeNumericComparison(equal, 'vdss_lombardo').equal, true);
});

test('classification differences are detected without a preferred class', () => {
  const rows = [molecule('a', { properties: { gmc_mpnn_bbb: { classification: 'BBB+' } } }), molecule('b', { properties: { gmc_mpnn_bbb: { classification: 'BBB-' } } })];
  assert.equal(classificationsDiffer(rows, 'gmc_mpnn_bbb'), true);
  const comparison = buildAdmetComparisonRows(rows).find(({ endpoint }) => endpoint.key === 'gmc_mpnn_bbb');
  assert.equal(comparison.classificationDifferent, true);
  assert.equal(Object.hasOwn(comparison, 'winner'), false);
});

test('comparison utilities do not mutate source data', () => {
  const rows = [molecule('a'), molecule('b')];
  const ids = ['a', 'b'];
  const beforeRows = structuredClone(rows);
  buildAdmetComparisonRows(rows); resolveAdmetComparisonMolecules(rows, ids); searchAdmetComparisonCandidates(rows, 'a', ids);
  assert.deepEqual(rows, beforeRows);
  assert.deepEqual(ids, ['a', 'b']);
});

test('10,000-molecule picker filtering remains bounded and responsive', () => {
  const rows = Array.from({ length: 10000 }, (_, index) => molecule(`compound-${index}`, { sourceName: `batch-${index % 8}.sdf` }));
  const started = performance.now();
  const matches = searchAdmetComparisonCandidates(rows, 'compound-9', []);
  const elapsed = performance.now() - started;
  assert.equal(matches.length, ADMET_COMPARISON_PICKER_LIMIT);
  assert.ok(elapsed < 2000, `10,000-molecule picker search took ${elapsed.toFixed(1)} ms`);
});
