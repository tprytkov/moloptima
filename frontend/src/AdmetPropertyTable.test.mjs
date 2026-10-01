import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let AdmetPropertyTable;
let createEmptyAdmetFilters;
let setNumericAdmetFilter;
let setAdmetFilterSelections;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  AdmetPropertyTable = (await vite.ssrLoadModule('/src/AdmetPropertyTable.jsx')).default;
  ({ createEmptyAdmetFilters, setNumericAdmetFilter, setAdmetFilterSelections } = await vite.ssrLoadModule('/src/admetFilters.js'));
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

function render(rows, initialFilters = null) {
  return renderToStaticMarkup(React.createElement(AdmetPropertyTable, { rows, initialFilters }));
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

test('a 5,000-row input renders only the default 50-row page', () => {
  const html = render(Array.from({ length: 5000 }, (_, index) => row(index + 1)));
  assert.equal((html.match(/data-testid="admet-property-row"/g) || []).length, 50);
  assert.match(html, /5,000 of 5,000 compounds/);
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

test('compact filter panel exposes numeric, BBB, status, summary, and clear controls', () => {
  let filters = createEmptyAdmetFilters();
  filters = setNumericAdmetFilter(filters, 'lipophilicity_astrazeneca', 'min', '1');
  filters = setNumericAdmetFilter(filters, 'lipophilicity_astrazeneca', 'max', '4');
  filters = setAdmetFilterSelections(filters, 'classifications', 'gmc_mpnn_bbb', ['BBB+']);
  const html = render([row(1)], filters);
  assert.match(html, /aria-label="ADMET property filters"/);
  assert.match(html, /Lipophilicity: 1–4/);
  assert.match(html, /BBB permeability: BBB\+/);
  assert.match(html, /Clear all filters/);
  assert.match(html, /More filters · Caco-2, binding, distribution, and endpoint status/);
  assert.match(html, /aria-label="Remove Lipophilicity: 1–4 filter"/);
});

test('numeric and BBB filters compose and update the rendered count and rows', () => {
  const plus = row(1);
  const tooHigh = row(2, { admet_regression: { status: 'success', endpoints: {
    ...row(2).admet_regression.endpoints,
    lipophilicity_astrazeneca: { status: 'success', ensemble_mean_log_ratio: 5.5 },
  } } });
  const minus = row(3, { bbb_result: { status: 'success', raw_classification: 'BBB-', ensemble_probability: 0.2 } });
  let filters = createEmptyAdmetFilters();
  filters = setNumericAdmetFilter(filters, 'lipophilicity_astrazeneca', 'max', '4');
  filters = setAdmetFilterSelections(filters, 'classifications', 'gmc_mpnn_bbb', ['BBB+']);
  const html = render([plus, tooHigh, minus], filters);
  assert.match(html, /1 of 3 compounds/);
  assert.match(html, /compound-0001/);
  assert.doesNotMatch(html, /compound-0002|compound-0003/);
});

test('zero filter results render a useful state and clear action rather than an error', () => {
  const filters = setNumericAdmetFilter(createEmptyAdmetFilters(), 'caco2_wang', 'min', '100');
  const html = render([row(1), row(2)], filters);
  assert.match(html, /0 of 2 compounds/);
  assert.match(html, /No compounds match the current filters/);
  assert.match(html, />Clear filters</);
  assert.doesNotMatch(html, /error occurred|application error/i);
});
