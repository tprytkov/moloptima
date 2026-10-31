import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let AdmetHeatMap;
let AdmetSelectedProfile;
let ADMET_ENDPOINT_REGISTRY;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  ({ AdmetHeatMap, AdmetSelectedProfile } = await vite.ssrLoadModule('/src/AdmetVisualizations.jsx'));
  ({ ADMET_ENDPOINT_REGISTRY } = await vite.ssrLoadModule('/src/admetAnalysisData.js'));
});

after(async () => vite?.close());

function molecule(index, overrides = {}) {
  const properties = Object.fromEntries(ADMET_ENDPOINT_REGISTRY.map((endpoint, endpointIndex) => {
    const value = Object.hasOwn(overrides, endpoint.key)
      ? overrides[endpoint.key]
      : endpoint.valueType === 'regression' ? endpointIndex + index / 10 : Math.min(1, endpointIndex / 12 + index / 100);
    return [endpoint.key, {
      value: endpoint.valueType === 'regression' ? value : null,
      probability: endpoint.valueType === 'regression' ? null : value,
      classification: endpoint.valueType === 'regression' ? null : value >= 0.5 ? 'Positive' : 'Negative',
      unit: endpoint.unit,
      status: { code: value === null ? 'endpoint_not_returned' : 'available', label: value === null ? 'Not available' : 'Results available' },
      raw: endpoint.key === 'gmc_mpnn_bbb' ? { threshold: 0.5, threshold_status: 'provisional_raw', calibration_status: 'not_frozen' } : null,
    }];
  }));
  return { moleculeId: `compound-${index}`, displayName: `Compound ${index}`, sourceIndex: index, properties };
}

test('selected profile renders ten probability bars and five unit-bearing regression scales', () => {
  const molecules = [molecule(1), molecule(2)];
  const html = renderToStaticMarkup(React.createElement(AdmetSelectedProfile, { molecule: molecules[0], molecules }));
  assert.match(html, /Selected-compound visual profile/);
  assert.match(html, /Classification probabilities/);
  assert.match(html, /Chemprop regression properties/);
  assert.match(html, /log10\(Papp \[cm\/s\]\)/);
  assert.match(html, /log-ratio/);
  assert.match(html, /log mol\/L/);
  assert.match(html, /percent bound/);
  assert.match(html, /L\/kg/);
  assert.match(html, /aria-label="HIA:/);
  assert.match(html, /aria-label="Caco-2 permeability:/);
  assert.doesNotMatch(html, />confidence</i);
});

test('probability profile preserves zero, one, missing state, and BBB threshold only', () => {
  const row = molecule(1, { hia_hou: 0, pgp_broccatelli: 1, cyp1a2_veith: null, gmc_mpnn_bbb: 0.8 });
  const html = renderToStaticMarkup(React.createElement(AdmetSelectedProfile, { molecule: row, molecules: [row] }));
  assert.match(html, /0\.000 · 0\.0%/);
  assert.match(html, /1\.000 · 100\.0%/);
  assert.match(html, /Not available/);
  assert.match(html, /aria-label="BBB permeability: [^"]*threshold 0\.5/);
  assert.doesNotMatch(html, /aria-label="HIA: [^"]*threshold/);
  assert.match(html, /Threshold status: provisional_raw/);
  assert.match(html, /Calibration status: not_frozen/);
});

test('heat map renders exact endpoint headers, raw values, legend, and accessible cells', () => {
  const html = renderToStaticMarkup(React.createElement(AdmetHeatMap, { molecules: [molecule(1), molecule(2)], selectedMoleculeId: 'compound-2' }));
  for (const endpoint of ADMET_ENDPOINT_REGISTRY) assert.match(html, new RegExp(endpoint.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /data-testid="admet-heat-map-scroll"/);
  assert.match(html, /Classification: 0–1 predicted probability/);
  assert.match(html, /Regression: independently scaled within each endpoint/);
  assert.match(html, /Striped N\/A/);
  assert.match(html, /aria-label="Compound 1\. HIA:/);
  assert.match(html, /Amber outline: selected molecule/);
});

test('heat map windowing renders a bounded row set while retaining full scroll height', () => {
  const molecules = Array.from({ length: 5000 }, (_, index) => molecule(index));
  const html = renderToStaticMarkup(React.createElement(AdmetHeatMap, { molecules }));
  const renderedRows = (html.match(/data-testid="admet-heat-map-row"/g) || []).length;
  assert.ok(renderedRows > 10 && renderedRows < 40);
  assert.match(html, /5,000 compounds/);
  assert.match(html, /height:210000px/);
});

test('heat map cells and row labels use the shared molecule-selection callback', async () => {
  const source = await readFile(new URL('./AdmetVisualizations.jsx', import.meta.url), 'utf8');
  assert.match(source, /onClick=\{\(\) => onSelect\(row\.moleculeId\)\}/);
  assert.match(source, /onClick=\{\(\) => onSelectMolecule\(row\.moleculeId\)\}/);
});

test('visualization Help controls map to the ADMET Help topic', () => {
  const html = renderToStaticMarkup(React.createElement(AdmetSelectedProfile, { molecule: molecule(1), molecules: [molecule(1)] }));
  assert.match(html, /Help: Probability bars/);
  assert.match(html, /Help: Regression scales/);
});
