import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { ADMET_ENDPOINT_REGISTRY, normalizeAdmetAnalysis, paginateAdmetMolecules, searchAdmetMolecules } from './admetAnalysisData.js';
import { createEmptyAdmetFilters, filterAdmetMolecules, setAdmetFilterSelections, setNumericAdmetFilter } from './admetFilters.js';
import { extractAdmetNumericValues } from './admetPlotData.js';
import {
  buildAdmetReport,
  buildComparisonCsv,
  buildFilteredAdmetCsv,
  classificationCounts,
  csvEscape,
  numericStatistics,
} from './admetExport.js';

function rawRow(index, overrides = {}) {
  const admetPredictions = Object.fromEntries(
    ADMET_ENDPOINT_REGISTRY.filter(({ modelFamily }) => modelFamily === 'chemberta').map(({ key }, offset) => [key, {
      status: 'success', binary_prediction: (index + offset) % 2, calibrated_probability: 0.1 + (offset / 20),
    }]),
  );
  return {
    molecule_id: `compound-${index}`,
    original_molecule_id: `Compound ${index}`,
    canonical_smiles: index % 2 ? 'CCO' : 'C#N',
    source_filename: `source-${index}.sdf`, source_record: `record-${index}`,
    admet_model_status: 'model_available',
    admet_family_status: { chemberta: 'available', gmc_bbb: 'success', chemprop_regression: 'success' },
    admet_predictions: admetPredictions,
    bbb_result: { status: 'success', raw_classification: index % 2 ? 'BBB+' : 'BBB-', ensemble_probability: index % 2 ? 0.8 : 0.2 },
    admet_regression: { status: 'success', endpoints: {
      caco2_wang: { status: 'success', ensemble_mean_log10_papp_cm_per_s: -5 },
      lipophilicity_astrazeneca: { status: 'success', ensemble_mean_log_ratio: index },
      solubility_aqsoldb: { status: 'success', ensemble_mean_log_mol_per_l: -index },
      ppbr_az: { status: 'success', ensemble_mean_percent_bound: 0 },
      vdss_lombardo: { status: 'success', ensemble_mean_l_per_kg: 1.5 },
    } },
    ...overrides,
  };
}

function molecules(count = 3) {
  return normalizeAdmetAnalysis(Array.from({ length: count }, (_, index) => rawRow(index + 1))).molecules;
}

const context = (total, filters = createEmptyAdmetFilters(), query = '') => ({
  exportTimestamp: '2026-10-03T12:00:00.000Z', totalMolecules: total, filters, query,
});

test('filtered CSV contains every matching row rather than a display subset', () => {
  const csv = buildFilteredAdmetCsv(molecules(120), context(120));
  assert.equal(csv.split('\r\n').length, 121);
});

test('pagination does not limit filtered export', () => {
  const all = molecules(120);
  assert.equal(paginateAdmetMolecules(all, 0, 25).rows.length, 25);
  assert.equal(buildFilteredAdmetCsv(all, context(120)).split('\r\n').length - 1, 120);
});

test('one shared search and filter result drives table count plots and export row count', () => {
  const all = molecules(100);
  const searched = searchAdmetMolecules(all, 'compound-1');
  const filters = setNumericAdmetFilter(createEmptyAdmetFilters(), 'lipophilicity_astrazeneca', 'max', '19');
  const shared = filterAdmetMolecules(searched, filters);
  const table = paginateAdmetMolecules(shared, 0, 25);
  const plotted = extractAdmetNumericValues(shared, 'lipophilicity_astrazeneca');
  const exported = buildFilteredAdmetCsv(shared, context(all.length, filters, 'compound-1')).split('\r\n').length - 1;
  assert.equal(table.total, shared.length); assert.equal(plotted.values.length, shared.length); assert.equal(exported, shared.length);
});

test('search result is the export input', () => {
  const found = searchAdmetMolecules(molecules(20), 'compound-12');
  const csv = buildFilteredAdmetCsv(found, context(20, createEmptyAdmetFilters(), 'compound-12'));
  assert.match(csv, /compound-12/); assert.doesNotMatch(csv, /compound-11,/);
});

test('numeric-filter result is the export input', () => {
  const filters = setNumericAdmetFilter(createEmptyAdmetFilters(), 'lipophilicity_astrazeneca', 'max', '2');
  const found = filterAdmetMolecules(molecules(4), filters);
  assert.equal(found.length, 2); assert.equal(buildFilteredAdmetCsv(found, context(4, filters)).split('\r\n').length - 1, 2);
});

test('BBB-filter result is the export input', () => {
  const filters = setAdmetFilterSelections(createEmptyAdmetFilters(), 'classifications', 'gmc_mpnn_bbb', ['BBB-']);
  const found = filterAdmetMolecules(molecules(4), filters);
  assert.equal(found.length, 2); assert.doesNotMatch(buildFilteredAdmetCsv(found, context(4, filters)), /BBB\+/);
});

test('all public endpoints are included in CSV headers', () => {
  const header = buildFilteredAdmetCsv([], context(0)).split('\r\n')[0];
  for (const endpoint of ADMET_ENDPOINT_REGISTRY) assert.match(header, new RegExp(`${endpoint.key}_`));
});

test('regression raw value is preserved', () => assert.match(buildFilteredAdmetCsv(molecules(1), context(1)), /,-5,/));

test('zero regression value is preserved', () => assert.match(buildFilteredAdmetCsv(molecules(1), context(1)), /,0,percent bound,available,/));

test('negative regression value is preserved', () => assert.match(buildFilteredAdmetCsv(molecules(2), context(2)), /,-2,log10\(mol\/L\),available,/));

test('missing numeric value is empty while status remains explicit', () => {
  const row = rawRow(1); row.admet_regression.endpoints.vdss_lombardo = { status: 'failed' };
  const csv = buildFilteredAdmetCsv(normalizeAdmetAnalysis([row]).molecules, context(1));
  assert.match(csv, /,,L\/kg,failed,/);
});

test('classification is preserved', () => assert.match(buildFilteredAdmetCsv(molecules(1), context(1)), /,BBB\+,0\.8,/));

test('probability is preserved as a raw number', () => assert.match(buildFilteredAdmetCsv(molecules(1), context(1)), /,0\.8,Raw ensemble probability,/));

test('endpoint status is preserved', () => assert.match(buildFilteredAdmetCsv(molecules(1), context(1)), /,available,/));

test('CSV escaping handles commas, quotes, and newlines', () => assert.equal(csvEscape('A,"B"\nC'), '"A,""B""\nC"'));

test('canonical SMILES is preserved and CSV-safe', () => {
  const row = rawRow(1, { canonical_smiles: 'C/C=C\\C(=O)O' });
  assert.match(buildFilteredAdmetCsv(normalizeAdmetAnalysis([row]).molecules, context(1)), /C\/C=C\\C\(=O\)O/);
});

test('comparison export uses selected IDs only', () => {
  const csv = buildComparisonCsv(molecules(3), ['compound-1', 'compound-3']);
  assert.match(csv, /compound-1/); assert.match(csv, /compound-3/); assert.doesNotMatch(csv, /compound-2/);
});

test('comparison selection outside current filters remains exportable', () => {
  const all = molecules(3); const filtered = [all[0]];
  assert.equal(filtered.length, 1); assert.match(buildComparisonCsv(all, ['compound-1', 'compound-2']), /compound-2/);
});

test('comparison ordering follows selected IDs', () => {
  const csv = buildComparisonCsv(molecules(3), ['compound-3', 'compound-1']);
  assert.ok(csv.indexOf('compound-3') < csv.indexOf('compound-1'));
});

test('numeric report statistics calculate n min median mean and max', () => assert.deepEqual(numericStatistics([4, 0, -2, 2]), { n: 4, min: -2, median: 1, mean: 1, max: 4 }));

test('missing values are excluded from numeric statistics', () => assert.deepEqual(numericStatistics([null, undefined, Number.NaN, 0]), { n: 1, min: 0, median: 0, mean: 0, max: 0 }));

test('classification counts are deterministic', () => assert.deepEqual(classificationCounts(['Positive', 'Negative', 'Positive', null]), { Negative: 1, Positive: 2 }));

test('active filters and search are recorded accurately', () => {
  const filters = setNumericAdmetFilter(createEmptyAdmetFilters(), 'caco2_wang', 'min', '-6');
  const csv = buildFilteredAdmetCsv(molecules(1), context(4, filters, 'ethanol'));
  assert.match(csv, /ethanol/); assert.match(csv, /Caco-2 permeability: ≥ -6/); assert.match(csv, /,4,1,/);
});

test('generated report includes no applicability-domain labels', () => {
  const report = buildAdmetReport(molecules(2), context(2));
  assert.doesNotMatch(report, /in domain|out of domain/i); assert.match(report, /No applicability-domain classification is included/);
});

test('generated report calls probability probability rather than confidence', () => {
  const report = buildAdmetReport(molecules(2), context(2));
  assert.match(report, /Probabilities are probabilities, not confidence/); assert.doesNotMatch(report, /confidence score|model confidence/i);
});

test('generated exports contain no preference or ranking terminology', () => {
  const text = `${buildAdmetReport(molecules(2), context(2), molecules(2))}\n${buildComparisonCsv(molecules(2), ['compound-1', 'compound-2'])}`;
  assert.doesNotMatch(text, /\b(winner|best|preferred|recommendation)\b/i);
});

test('10,000-row export completes successfully with linear row count', () => {
  const all = molecules(10000); const start = performance.now(); const csv = buildFilteredAdmetCsv(all, context(all.length)); const elapsed = performance.now() - start;
  assert.equal(csv.split('\r\n').length - 1, 10000); assert.ok(elapsed < 10000);
});
