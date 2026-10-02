import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let AdmetComparison;
let ADMET_ENDPOINT_REGISTRY;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  AdmetComparison = (await vite.ssrLoadModule('/src/AdmetComparison.jsx')).default;
  ({ ADMET_ENDPOINT_REGISTRY } = await vite.ssrLoadModule('/src/admetAnalysisData.js'));
});

after(async () => vite?.close());

function molecule(index, overrides = {}) {
  const properties = Object.fromEntries(ADMET_ENDPOINT_REGISTRY.map((endpoint, endpointIndex) => [endpoint.key, {
    value: endpoint.valueType === 'regression' ? endpointIndex + index : endpointIndex % 2,
    classification: endpoint.valueType === 'regression' ? null : endpoint.key === 'gmc_mpnn_bbb' ? (index % 2 ? 'BBB+' : 'BBB-') : (index % 2 ? 'Positive' : 'Negative'),
    probability: endpoint.valueType === 'regression' ? null : 0.25 + index / 10,
    unit: endpoint.unit,
    status: { code: 'available', label: 'Results available' },
  }]));
  for (const [key, value] of Object.entries(overrides.properties || {})) properties[key] = { ...properties[key], ...value };
  return {
    moleculeId: overrides.moleculeId || `compound-${index}`,
    displayName: overrides.displayName || `Compound ${index}`,
    sourceName: overrides.sourceName || `source-${index}.sdf`, canonicalSmiles: overrides.canonicalSmiles || 'CCO',
    sourceIndex: index, properties,
  };
}

function render({ molecules, filteredMolecules = molecules, selectedIds = [], initialPickerQuery = '' }) {
  return renderToStaticMarkup(React.createElement(AdmetComparison, {
    molecules, filteredMolecules, selectedIds, initialPickerQuery,
    onAdd: () => {}, onRemove: () => {}, onClear: () => {},
  }));
}

test('empty comparison prompts for 2–5 compounds', () => {
  assert.match(render({ molecules: [] }), /Select 2–5 compounds to compare/);
});

test('one-molecule state preserves identity and prompts for another', () => {
  const html = render({ molecules: [molecule(1)], selectedIds: ['compound-1'] });
  assert.match(html, /One compound selected/);
  assert.match(html, /1 of 5 compounds selected/);
});

test('two molecules render a semantic matrix with every normalized endpoint', () => {
  const molecules = [molecule(1), molecule(2)];
  const html = render({ molecules, selectedIds: molecules.map(({ moleculeId }) => moleculeId) });
  assert.match(html, /aria-label="ADMET compound comparison"/);
  for (const endpoint of ADMET_ENDPOINT_REGISTRY) assert.match(html, new RegExp(endpoint.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /probability/);
  assert.match(html, /Probability is not confidence, uncertainty, or applicability domain/);
});

test('five-molecule comparison renders five removable compound headers and limit feedback', () => {
  const molecules = Array.from({ length: 5 }, (_, index) => molecule(index));
  const html = render({ molecules, selectedIds: molecules.map(({ moleculeId }) => moleculeId) });
  assert.equal((html.match(/from comparison/g) || []).length, 5);
  assert.match(html, /Comparison limit reached/);
  assert.match(html, /5 of 5 compounds selected/);
});

test('picker searches all molecules but renders at most 30 results', () => {
  const molecules = Array.from({ length: 100 }, (_, index) => molecule(index));
  const html = render({ molecules, initialPickerQuery: 'compound' });
  assert.match(html, /aria-label="Comparison molecule search results"/);
  assert.equal((html.match(/to comparison/g) || []).length, 30);
});

test('selected molecules outside the current filtered result remain visible', () => {
  const molecules = [molecule(1), molecule(2)];
  const html = render({ molecules, filteredMolecules: [molecules[0]], selectedIds: molecules.map(({ moleculeId }) => moleculeId) });
  assert.match(html, /Outside current filters/);
  assert.match(html, /Compound 2/);
});

test('mixed statuses render canonical labels without nullish strings', () => {
  const unavailable = molecule(2, { properties: { caco2_wang: { value: null, status: { code: 'model_unavailable', label: 'Model unavailable' } } } });
  const html = render({ molecules: [molecule(1), unavailable], selectedIds: ['compound-1', 'compound-2'] });
  assert.match(html, /Model unavailable/);
  assert.doesNotMatch(html, />null<|>undefined<|>NaN/);
});

test('numeric and classification differences use neutral non-preference labels', () => {
  const molecules = [molecule(1), molecule(2)];
  const html = render({ molecules, selectedIds: molecules.map(({ moleculeId }) => moleculeId) });
  assert.match(html, /Lowest/);
  assert.match(html, /Highest/);
  assert.match(html, /Range/);
  assert.match(html, /Different classification/);
  assert.doesNotMatch(html, /winner|worst|best compound/i);
});

test('comparison matrix is horizontally contained for responsive layouts', () => {
  const molecules = Array.from({ length: 5 }, (_, index) => molecule(index));
  const html = render({ molecules, selectedIds: molecules.map(({ moleculeId }) => moleculeId) });
  assert.match(html, /overflow-x:auto/);
  assert.match(html, /min-width:1360px/);
});

test('clear and remove controls expose accessible names', () => {
  const molecules = [molecule(1), molecule(2)];
  const html = render({ molecules, selectedIds: molecules.map(({ moleculeId }) => moleculeId) });
  assert.match(html, />Clear comparison</);
  assert.match(html, /aria-label="Remove Compound 1 from comparison"/);
});

test('comparison reuses endpoint model metadata including BBB threshold and calibration status', () => {
  const first = molecule(1, { properties: { gmc_mpnn_bbb: { modelMetadata: {
    endpointKey: 'gmc_mpnn_bbb', modelFamilyLabel: 'GMC-MPNN BBB', modelName: 'GMC-MPNN',
    predictionType: 'binary_classification', threshold: 0.7464, thresholdStatus: 'frozen',
    calibrationMethod: 'platt_scaling', calibrationStatus: 'frozen', status: { label: 'Results available' },
  } } } });
  const html = render({ molecules: [first, molecule(2)], selectedIds: ['compound-1', 'compound-2'] });
  assert.match(html, /Model info for gmc_mpnn_bbb/);
  assert.match(html, /Decision threshold/);
  assert.match(html, /0\.7464/);
  assert.match(html, /Platt Scaling/);
});
