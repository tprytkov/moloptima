import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let AdmetPropertyTable;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  AdmetPropertyTable = (await vite.ssrLoadModule('/src/AdmetPropertyTable.jsx')).default;
});

after(async () => vite?.close());

function row(index, overrides = {}) {
  return {
    molecule_id: `compound-${String(index).padStart(4, '0')}`,
    canonical_smiles: 'CCO',
    source_filename: `source-${index}.sdf`,
    admet_model_status: 'model_available',
    admet_family_status: { chemberta: 'available', gmc_bbb: 'success', chemprop_regression: 'success' },
    admet_predictions: {},
    bbb_result: { status: 'success', raw_classification: 'BBB+', ensemble_probability: 0.87 },
    admet_regression: { status: 'success', endpoints: {
      caco2_wang: { status: 'success', ensemble_mean_log10_papp_cm_per_s: -5.2, unit: 'log10(Papp [cm/s])' },
      lipophilicity_astrazeneca: { status: 'success', ensemble_mean_log_ratio: 2.1, unit: 'log ratio' },
      solubility_aqsoldb: { status: 'success', ensemble_mean_log_mol_per_l: -2.9, unit: 'log mol/L' },
      ppbr_az: { status: 'success', ensemble_mean_percent_bound: 82.4, unit: 'percent bound' },
      vdss_lombardo: { status: 'success', ensemble_mean_l_per_kg: 1.45, unit: 'L/kg' },
    } },
    ...overrides,
  };
}

function render(rows) {
  return renderToStaticMarkup(React.createElement(AdmetPropertyTable, { rows }));
}

test('property table renders molecules, endpoint columns, regression values, and BBB output', () => {
  const html = render([row(1)]);
  for (const label of ['Compound', 'Caco-2 permeability', 'Lipophilicity', 'Aqueous solubility', 'Plasma protein binding', 'Volume of distribution', 'BBB permeability']) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /compound-0001/);
  assert.match(html, /-5\.2/);
  assert.match(html, /BBB\+/);
  assert.match(html, /87% raw ensemble probability/);
});

test('unavailable and mixed model statuses remain explicit', () => {
  const mixed = row(1, {
    admet_family_status: { chemberta: 'available', gmc_bbb: 'failed', chemprop_regression: 'model_unavailable' },
    bbb_result: { status: 'failed' },
    admet_regression: { status: 'model_unavailable', endpoints: {} },
  });
  const html = render([mixed]);
  assert.match(html, /Model unavailable/);
  assert.match(html, /Failed/);
  assert.doesNotMatch(html, />null<|>undefined<|>NaN</);
});

test('a 1,000-row input renders only the default 50-row page', () => {
  const html = render(Array.from({ length: 1000 }, (_, index) => row(index + 1)));
  assert.equal((html.match(/data-testid="admet-property-row"/g) || []).length, 50);
  assert.match(html, /1,000 of 1,000 molecules/);
  assert.match(html, /Rows per page:/);
  assert.match(html, />50</);
});

test('empty and ADMET-not-run states are explicit', () => {
  assert.match(render([]), /No molecules are available for ADMET analysis/);
  const notRun = row(1, {
    admet_model_status: 'not_run',
    admet_family_status: {},
    admet_predictions: {},
    bbb_result: {},
    admet_regression: {},
  });
  const html = render([notRun]);
  assert.match(html, /ADMET has not produced available property values/);
  assert.match(html, /Not run/);
});

test('table exposes accessible sorting, search, pagination, and bounded horizontal scrolling', () => {
  const html = render([row(1), row(2)]);
  assert.match(html, /aria-label="ADMET property table"/);
  assert.match(html, /aria-label="Search ADMET compounds"/);
  assert.match(html, /aria-label="Sort by Compound"/);
  assert.match(html, /aria-label="Go to next page"/);
  assert.match(html, /overflow-x:auto/);
});
