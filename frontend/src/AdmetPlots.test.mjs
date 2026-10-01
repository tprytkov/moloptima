import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let AdmetPlots;
let admetPlotStateReducer;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  ({ default: AdmetPlots, admetPlotStateReducer } = await vite.ssrLoadModule('/src/AdmetPlots.jsx'));
});

after(async () => vite?.close());

const keys = ['caco2_wang', 'lipophilicity_astrazeneca', 'solubility_aqsoldb', 'ppbr_az', 'vdss_lombardo'];

function molecule(index, overrides = {}) {
  const values = { caco2_wang: -5 + index / 10, lipophilicity_astrazeneca: index / 10, solubility_aqsoldb: -3 + index / 20, ppbr_az: 70 + index / 10, vdss_lombardo: 1 + index / 100, ...overrides };
  return {
    moleculeId: `m-${index}`, displayName: `Molecule ${index}`, sourceName: 'library.sdf', sourceIndex: index,
    properties: Object.fromEntries(keys.map((key) => [key, { value: values[key], status: { code: values[key] === null ? 'endpoint_not_returned' : 'available' } }])),
  };
}

function render(molecules, initialState = {}) {
  return renderToStaticMarkup(React.createElement(AdmetPlots, { molecules, initialState }));
}

test('distribution renders with property selector, count, and unit-bearing axis label', () => {
  const html = render([molecule(1), molecule(2)]);
  assert.match(html, /data-testid="admet-distribution-view"/);
  assert.match(html, /Aqueous solubility/);
  assert.match(html, /log10\(mol\/L\)/);
  assert.match(html, /2 filtered compounds · 2 plotted · 0 unavailable/);
  assert.match(html, /Compound count/);
});

test('distribution property state changes the histogram endpoint', () => {
  let state = { plotType: 'distribution', distributionKey: 'solubility_aqsoldb', xKey: 'lipophilicity_astrazeneca', yKey: 'solubility_aqsoldb' };
  state = admetPlotStateReducer(state, { type: 'set-distribution-key', endpointKey: 'caco2_wang' });
  const html = render([molecule(1)], state);
  assert.equal(state.distributionKey, 'caco2_wang');
  assert.match(html, /Caco-2 permeability distribution histogram/);
  assert.match(html, /log10\(Papp \[cm\/s\]\)/);
});

test('scatter view renders one canvas and raw count summary', () => {
  const html = render([molecule(1), molecule(2)], { plotType: 'scatter' });
  assert.match(html, /data-testid="admet-scatter-view"/);
  assert.match(html, /data-testid="admet-scatter-canvas"/);
  assert.equal((html.match(/<canvas/g) || []).length, 1);
  assert.match(html, /2 filtered compounds · 2 plotted · 0 unavailable for one or both selected properties/);
});

test('X and Y selector actions prevent identical endpoints', () => {
  const initial = { plotType: 'scatter', distributionKey: 'solubility_aqsoldb', xKey: 'lipophilicity_astrazeneca', yKey: 'solubility_aqsoldb' };
  const changedX = admetPlotStateReducer(initial, { type: 'set-x-key', endpointKey: 'solubility_aqsoldb' });
  assert.equal(changedX.xKey, 'solubility_aqsoldb');
  assert.notEqual(changedX.yKey, changedX.xKey);
  const changedY = admetPlotStateReducer(initial, { type: 'set-y-key', endpointKey: 'lipophilicity_astrazeneca' });
  assert.equal(changedY.yKey, 'lipophilicity_astrazeneca');
  assert.notEqual(changedY.xKey, changedY.yKey);
});

test('missing prediction count is visible in distribution and scatter', () => {
  const rows = [molecule(1), molecule(2, { solubility_aqsoldb: null })];
  assert.match(render(rows), /2 filtered compounds · 1 plotted · 1 unavailable/);
  assert.match(render(rows, { plotType: 'scatter' }), /2 filtered compounds · 1 plotted · 1 unavailable for one or both selected properties/);
});

test('empty filtered and endpoint-unavailable states are distinct', () => {
  assert.match(render([]), /No compounds match current search and filters/);
  const html = render([molecule(1, { solubility_aqsoldb: null })]);
  assert.match(html, /No available predictions for this property/);
  assert.doesNotMatch(html, /No compounds match current search and filters/);
});

test('scatter with no joint values and one usable point is handled', () => {
  const none = render([molecule(1, { lipophilicity_astrazeneca: null }), molecule(2, { solubility_aqsoldb: null })], { plotType: 'scatter' });
  assert.match(none, /No molecules have available predictions for both selected properties/);
  const one = render([molecule(1)], { plotType: 'scatter' });
  assert.match(one, /1 filtered compounds · 1 plotted/);
});

test('5,000 scatter points remain one Canvas element rather than React point nodes', () => {
  const html = render(Array.from({ length: 5000 }, (_, index) => molecule(index)), { plotType: 'scatter' });
  assert.equal((html.match(/<canvas/g) || []).length, 1);
  assert.equal((html.match(/<circle/g) || []).length, 0);
  assert.match(html, /5,000 filtered compounds · 5,000 plotted/);
});

test('canvas accessibility uses one focus target with keyboard identification instructions', () => {
  const html = render([molecule(1)], { plotType: 'scatter' });
  assert.match(html, /tabindex="0"/);
  assert.match(html, /Use left and right arrow keys to identify points/);
  assert.match(html, /Hover, click, or focus the canvas and use arrow keys/);
});

test('scatter selection exposes an explicit comparison action without auto-adding on canvas click', async () => {
  const source = await readFile(new URL('./AdmetPlots.jsx', import.meta.url), 'utf8');
  assert.match(source, /Add to comparison/);
  assert.match(source, /onClick=\{\(event\) => setSelected\(pointAtEvent\(event\)\)\}/);
  assert.doesNotMatch(source, /onClick=\{\(event\) => onAddToComparison\(pointAtEvent/);
});
