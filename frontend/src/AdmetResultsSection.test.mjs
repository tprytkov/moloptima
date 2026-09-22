import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let AdmetResultsSection;
let ADMET_GROUPS;
let deriveAdmetFamilyStatuses;
let aggregateAdmetFamilyStatus;

before(async () => {
  vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  });
  const module = await vite.ssrLoadModule('/src/AdmetResultsSection.jsx');
  AdmetResultsSection = module.default;
  ADMET_GROUPS = module.ADMET_GROUPS;
  deriveAdmetFamilyStatuses = module.deriveAdmetFamilyStatuses;
  aggregateAdmetFamilyStatus = module.aggregateAdmetFamilyStatus;
});

after(async () => {
  await vite?.close();
});

function endpoint(displayName, probability, evidenceStatus, warning = '') {
  return {
    calibrated_probability: probability,
    raw_probability: probability + 0.01,
    binary_prediction: probability >= 0.5 ? 1 : 0,
    display_name: displayName,
    positive_class_meaning: `positive meaning for ${displayName}`,
    evidence_status: evidenceStatus,
    warning,
  };
}

function completeCompound() {
  return {
    admet_model_status: 'model_available',
    admet_warning: '',
    admet_predictions: {
      hia_hou: endpoint('HIA', 0.938686, 'limited_support', 'Limited support for HIA.'),
      pgp_broccatelli: endpoint('P-gp inhibition', 0.029999, 'moderate'),
      cyp1a2_veith: endpoint('CYP1A2 inhibition', 0.048598, 'strong'),
      cyp2c19_veith: endpoint('CYP2C19 inhibition', 0.025956, 'strong'),
      cyp2c9_veith: endpoint('CYP2C9 inhibition', 0.022443, 'strong_ranking'),
      cyp2d6_veith: endpoint('CYP2D6 inhibition', 0.093259, 'strong_ranking'),
      cyp3a4_veith: endpoint('CYP3A4 inhibition', 0.012681, 'strong'),
      herg_karim: endpoint('hERG liability', 0.149816, 'moderate_good'),
      ames: endpoint('AMES mutagenicity', 0.218461, 'moderate'),
    },
    bbb_result: {
      status: 'success', ensemble_probability: 0.877144,
      ensemble_standard_deviation: 0.04, threshold: 0.5,
      threshold_status: 'provisional_raw', raw_classification: 'BBB+',
      calibration_status: 'not_frozen', prediction: 'BBB+',
    },
    admet_regression: {
      status: 'success',
      endpoints: Object.fromEntries([
        ['caco2_wang', 'log10_papp_cm_per_s'],
        ['lipophilicity_astrazeneca', 'log_ratio'],
        ['solubility_aqsoldb', 'log_mol_per_l'],
        ['ppbr_az', 'percent_bound'],
        ['vdss_lombardo', 'l_per_kg'],
      ].map(([name, suffix]) => [name, {
        [`ensemble_mean_${suffix}`]: 1.25,
        [`seed_standard_deviation_${suffix}`]: 0.1,
        unit: suffix,
        representation: suffix,
      }])),
    },
  };
}

function render(compound) {
  return renderToStaticMarkup(React.createElement(AdmetResultsSection, { compound }));
}

test('renders the final ADMET groups and all 15 production endpoints', () => {
  const html = render(completeCompound());

  for (const group of ADMET_GROUPS) {
    assert.match(html, new RegExp(`>${group.label}<`));
  }
  for (const endpointName of Object.keys(completeCompound().admet_predictions)) {
    assert.match(html, new RegExp(`data-testid="admet-endpoint-${endpointName}"`));
  }
  assert.match(html, /data-testid="admet-endpoint-gmc_mpnn_bbb"/);
  for (const endpointName of Object.keys(completeCompound().admet_regression.endpoints)) {
    assert.match(html, new RegExp(`data-testid="admet-endpoint-${endpointName}"`));
  }
  assert.doesNotMatch(html, /bbb_martins/);
});

test('renders calibrated probability as the primary percentage and omits raw probability', () => {
  const html = render(completeCompound());

  assert.match(html, />93\.9%</);
  assert.match(html, /Calibrated probability/);
  assert.doesNotMatch(html, /Raw probability/i);
  assert.doesNotMatch(html, /SAFE|UNSAFE/);
});

test('makes GMC BBB ensemble details and HIA limited support visible', () => {
  const html = render(completeCompound());

  assert.match(html, /GMC-MPNN/);
  assert.match(html, /Raw ensemble probability/);
  assert.match(html, /Raw classification at 0\.50: BBB\+/);
  assert.match(html, /Model disagreement \/ seed SD: 0\.04/);
  assert.match(html, /Threshold status: Provisional raw/);
  assert.match(html, /Calibration status: Not frozen/);
  assert.doesNotMatch(html, /production threshold|final threshold|optimized threshold/i);
  assert.match(html, /Limited support/);
  assert.match(html, /Limited support for HIA\./);
});

test('renders model unavailable consistently on endpoint cards', () => {
  const html = render({
    admet_model_status: 'model_unavailable',
    admet_warning: 'Frozen local bundle is unavailable.',
    admet_predictions: {},
  });

  assert.match(html, /Model unavailable/);
  assert.match(html, /Frozen local bundle is unavailable\./);
  assert.match(html, /admet-endpoint-hia_hou/);
});

test('derives available Chemprop results from the authoritative family result', () => {
  const statuses = deriveAdmetFamilyStatuses({
    admet_model_status: 'model_unavailable',
    admet_regression: { status: 'model_available', endpoints: { caco2_wang: { ensemble_mean: 1.2 } } },
  });
  assert.equal(statuses.chemberta.code, 'model_unavailable');
  assert.equal(statuses.chemprop_regression.code, 'available');
});

test('does not reinterpret a legacy flat BBB status as a GMC-MPNN result', () => {
  const statuses = deriveAdmetFamilyStatuses({
    bbb_model_status: 'model_available', bbb_probability: 0.8, bbb_prediction: 'high',
  });
  assert.equal(statuses.gmc_mpnn_bbb.code, 'not_run');
  assert.equal(statuses.gmc_mpnn_bbb.label, 'Not run');
});

test('preserves mixed availability across ADMET families', () => {
  const row = completeCompound();
  row.bbb_result = { status: 'model_unavailable' };
  row.admet_regression = { status: 'not_requested', endpoints: {} };
  const statuses = deriveAdmetFamilyStatuses(row);
  assert.deepEqual(
    Object.fromEntries(Object.entries(statuses).map(([key, value]) => [key, value.code])),
    { chemberta: 'available', gmc_mpnn_bbb: 'model_unavailable', chemprop_regression: 'not_requested' },
  );
  assert.equal(aggregateAdmetFamilyStatus([row], 'chemberta').label, 'Results available');
  assert.equal(aggregateAdmetFamilyStatus([row], 'gmc_mpnn_bbb').label, 'Model unavailable');
  assert.equal(aggregateAdmetFamilyStatus([row], 'chemprop_regression').label, 'Not requested');
});

test('renders missing ADMET data without page failure', () => {
  const html = render({ molecule_id: 'legacy-result' });

  assert.match(html, /ADMET data is not available for this result\./);
});

test('renders invalid-molecule not-run state', () => {
  const html = render({ admet_model_status: 'not_run_invalid_molecule' });

  assert.match(html, /not run because the molecule is invalid/);
});
