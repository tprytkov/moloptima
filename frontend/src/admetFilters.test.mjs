import assert from 'node:assert/strict';
import test from 'node:test';
import { paginateAdmetMolecules, searchAdmetMolecules, sortAdmetMolecules } from './admetAnalysisData.js';
import {
  activeAdmetFilterSummaries,
  admetTableStateReducer,
  clearAdmetFilter,
  countActiveAdmetFilters,
  createEmptyAdmetFilters,
  filterAdmetMolecules,
  numericFilterValidity,
  setAdmetFilterSelections,
  setNumericAdmetFilter,
} from './admetFilters.js';

const ENDPOINTS = ['caco2_wang', 'lipophilicity_astrazeneca', 'solubility_aqsoldb', 'ppbr_az', 'vdss_lombardo', 'gmc_mpnn_bbb'];

function molecule(id, values = {}, classifications = {}, statuses = {}) {
  return {
    moleculeId: id,
    displayName: id,
    canonicalSmiles: values.smiles || 'CCO',
    sourceName: values.source || 'library.sdf',
    properties: Object.fromEntries(ENDPOINTS.map((key) => [key, {
      value: values[key] ?? (key === 'gmc_mpnn_bbb' ? null : 0),
      classification: classifications[key] ?? (key === 'gmc_mpnn_bbb' ? 'BBB+' : null),
      status: { code: statuses[key] || 'available' },
    }])),
  };
}

function numericFilter(key, min = '', max = '') {
  let filters = createEmptyAdmetFilters();
  filters = setNumericAdmetFilter(filters, key, 'min', min);
  return setNumericAdmetFilter(filters, key, 'max', max);
}

test('numeric filters support min only, max only, and inclusive min/max', () => {
  const rows = [molecule('low', { caco2_wang: -5 }), molecule('mid', { caco2_wang: 0 }), molecule('high', { caco2_wang: 5 })];
  assert.deepEqual(filterAdmetMolecules(rows, numericFilter('caco2_wang', 0)).map((row) => row.moleculeId), ['mid', 'high']);
  assert.deepEqual(filterAdmetMolecules(rows, numericFilter('caco2_wang', '', 0)).map((row) => row.moleculeId), ['low', 'mid']);
  assert.deepEqual(filterAdmetMolecules(rows, numericFilter('caco2_wang', -5, 0)).map((row) => row.moleculeId), ['low', 'mid']);
});

test('numeric filters preserve negative values and zero rather than treating them as blank', () => {
  const rows = [molecule('negative', { solubility_aqsoldb: -2 }), molecule('zero', { solubility_aqsoldb: 0 }), molecule('positive', { solubility_aqsoldb: 2 })];
  assert.deepEqual(filterAdmetMolecules(rows, numericFilter('solubility_aqsoldb', -2, -1)).map((row) => row.moleculeId), ['negative']);
  assert.deepEqual(filterAdmetMolecules(rows, numericFilter('solubility_aqsoldb', 0, 0)).map((row) => row.moleculeId), ['zero']);
});

test('invalid numeric text is marked invalid and is never coerced to zero', () => {
  const validity = numericFilterValidity({ min: 'not-a-number', max: '' });
  assert.equal(validity.valid, false);
  assert.equal(validity.min.value, null);
  assert.equal(filterAdmetMolecules([molecule('negative', { caco2_wang: -1 })], numericFilter('caco2_wang', 'not-a-number')).length, 1);
});

test('missing and unavailable results do not pass an active numeric constraint', () => {
  const missing = molecule('missing', { caco2_wang: null });
  missing.properties.caco2_wang.value = null;
  const unavailable = molecule('unavailable', { caco2_wang: 3 }, {}, { caco2_wang: 'model_unavailable' });
  assert.deepEqual(filterAdmetMolecules([missing, unavailable, molecule('valid', { caco2_wang: 3 })], numericFilter('caco2_wang', 1)).map((row) => row.moleculeId), ['valid']);
});

test('BBB filters use the normalized BBB+ and BBB- classifications', () => {
  const rows = [molecule('plus'), molecule('minus', {}, { gmc_mpnn_bbb: 'BBB-' }), molecule('missing', {}, { gmc_mpnn_bbb: null }, { gmc_mpnn_bbb: 'model_unavailable' })];
  const empty = createEmptyAdmetFilters();
  assert.deepEqual(filterAdmetMolecules(rows, setAdmetFilterSelections(empty, 'classifications', 'gmc_mpnn_bbb', ['BBB+'])).map((row) => row.moleculeId), ['plus']);
  assert.deepEqual(filterAdmetMolecules(rows, setAdmetFilterSelections(empty, 'classifications', 'gmc_mpnn_bbb', ['BBB-'])).map((row) => row.moleculeId), ['minus']);
});

test('status selections filter canonical codes and use OR within an endpoint', () => {
  const rows = [
    molecule('available'),
    molecule('failed', {}, {}, { caco2_wang: 'failed' }),
    molecule('not-run', {}, {}, { caco2_wang: 'not_run' }),
  ];
  const filters = setAdmetFilterSelections(createEmptyAdmetFilters(), 'statuses', 'caco2_wang', ['failed', 'not_run']);
  assert.deepEqual(filterAdmetMolecules(rows, filters).map((row) => row.moleculeId), ['failed', 'not-run']);
});

test('active constraints use AND across endpoints while selections use OR within a field', () => {
  const rows = [
    molecule('match', { lipophilicity_astrazeneca: 2, solubility_aqsoldb: -3 }),
    molecule('too-lipophilic', { lipophilicity_astrazeneca: 5, solubility_aqsoldb: -3 }),
    molecule('poor-solubility', { lipophilicity_astrazeneca: 2, solubility_aqsoldb: -5 }),
  ];
  let filters = numericFilter('lipophilicity_astrazeneca', 1, 4);
  filters = setNumericAdmetFilter(filters, 'solubility_aqsoldb', 'min', -4);
  filters = setAdmetFilterSelections(filters, 'classifications', 'gmc_mpnn_bbb', ['BBB+', 'BBB-']);
  assert.deepEqual(filterAdmetMolecules(rows, filters).map((row) => row.moleculeId), ['match']);
});

test('one filter and all filters can be cleared without mutating other constraints', () => {
  let filters = numericFilter('lipophilicity_astrazeneca', 1, 4);
  filters = setAdmetFilterSelections(filters, 'classifications', 'gmc_mpnn_bbb', ['BBB+']);
  const clearedOne = clearAdmetFilter(filters, 'numeric', 'lipophilicity_astrazeneca');
  assert.equal(countActiveAdmetFilters(clearedOne), 1);
  assert.deepEqual(clearedOne.classifications.gmc_mpnn_bbb, ['BBB+']);
  assert.equal(countActiveAdmetFilters(createEmptyAdmetFilters()), 0);
});

test('active-filter count counts constraints, not selected values or numeric bounds', () => {
  let filters = numericFilter('lipophilicity_astrazeneca', 1, 4);
  filters = setAdmetFilterSelections(filters, 'statuses', 'gmc_mpnn_bbb', ['available', 'failed']);
  assert.equal(countActiveAdmetFilters(filters), 2);
  assert.deepEqual(activeAdmetFilterSummaries(filters).map((summary) => summary.label), [
    'Lipophilicity: 1–4',
    'BBB permeability status: Results available or Failed',
  ]);
});

test('filter and search changes reset pagination while preserving search and sort', () => {
  const state = { query: 'lead', filters: createEmptyAdmetFilters(), sortKey: 'caco2_wang', sortDirection: 'desc', page: 4, pageSize: 50 };
  const filters = numericFilter('caco2_wang', 0);
  const afterFilter = admetTableStateReducer(state, { type: 'set-filters', filters });
  assert.equal(afterFilter.page, 0);
  assert.equal(afterFilter.query, 'lead');
  assert.equal(afterFilter.sortKey, 'caco2_wang');
  assert.equal(afterFilter.sortDirection, 'desc');
  const afterSearch = admetTableStateReducer({ ...afterFilter, page: 3 }, { type: 'set-query', query: 'candidate' });
  assert.equal(afterSearch.page, 0);
  assert.equal(afterSearch.sortDirection, 'desc');
});

test('search, ADMET filters, sorting, and pagination compose in deterministic order', () => {
  const rows = [molecule('lead-b', { caco2_wang: 2 }), molecule('decoy', { caco2_wang: 3 }), molecule('lead-a', { caco2_wang: 1 }), molecule('lead-low', { caco2_wang: -1 })];
  const searched = searchAdmetMolecules(rows, 'lead');
  const filtered = filterAdmetMolecules(searched, numericFilter('caco2_wang', 0));
  const sorted = sortAdmetMolecules(filtered, 'caco2_wang', 'asc');
  const page = paginateAdmetMolecules(sorted, 0, 25);
  assert.deepEqual(page.rows.map((row) => row.moleculeId), ['lead-a', 'lead-b']);
});

test('filtering 5,000 normalized rows stays bounded and responsive', () => {
  const rows = Array.from({ length: 5000 }, (_, index) => molecule(`compound-${index}`, { lipophilicity_astrazeneca: index % 10, solubility_aqsoldb: -(index % 8) }));
  let filters = numericFilter('lipophilicity_astrazeneca', 2, 4);
  filters = setNumericAdmetFilter(filters, 'solubility_aqsoldb', 'min', -4);
  const started = performance.now();
  const filtered = filterAdmetMolecules(rows, filters);
  const elapsed = performance.now() - started;
  assert.ok(filtered.length > 0 && filtered.length < rows.length);
  assert.ok(elapsed < 2000, `5,000-row filtering took ${elapsed.toFixed(1)} ms`);
  assert.equal(paginateAdmetMolecules(filtered, 0, 50).rows.length, 50);
});
