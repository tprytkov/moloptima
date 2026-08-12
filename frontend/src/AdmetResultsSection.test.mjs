import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let AdmetResultsSection;
let ADMET_GROUPS;

before(async () => {
  vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  });
  const module = await vite.ssrLoadModule('/src/AdmetResultsSection.jsx');
  AdmetResultsSection = module.default;
  ADMET_GROUPS = module.ADMET_GROUPS;
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
      bbb_martins: endpoint('BBB', 0.877144, 'experimental_low_confidence', 'Experimental BBB evidence.'),
      cyp1a2_veith: endpoint('CYP1A2 inhibition', 0.048598, 'strong'),
      cyp2c19_veith: endpoint('CYP2C19 inhibition', 0.025956, 'strong'),
      cyp2c9_veith: endpoint('CYP2C9 inhibition', 0.022443, 'strong_ranking'),
      cyp2d6_veith: endpoint('CYP2D6 inhibition', 0.093259, 'strong_ranking'),
      cyp3a4_veith: endpoint('CYP3A4 inhibition', 0.012681, 'strong'),
      herg_karim: endpoint('hERG liability', 0.149816, 'moderate_good'),
      ames: endpoint('AMES mutagenicity', 0.218461, 'moderate'),
    },
  };
}

function render(compound) {
  return renderToStaticMarkup(React.createElement(AdmetResultsSection, { compound }));
}

test('renders all four groups and all ten frozen endpoints', () => {
  const html = render(completeCompound());

  for (const group of ADMET_GROUPS) {
    assert.match(html, new RegExp(`>${group.label}<`));
  }
  for (const endpointName of Object.keys(completeCompound().admet_predictions)) {
    assert.match(html, new RegExp(`data-testid="admet-endpoint-${endpointName}"`));
  }
});

test('renders calibrated probability as the primary percentage and omits raw probability', () => {
  const html = render(completeCompound());

  assert.match(html, />93\.9%</);
  assert.match(html, /Calibrated probability/);
  assert.doesNotMatch(html, /Raw probability/i);
  assert.doesNotMatch(html, /SAFE|UNSAFE/);
});

test('makes BBB low confidence and HIA limited support visible', () => {
  const html = render(completeCompound());

  assert.match(html, /Experimental \/ Low confidence/);
  assert.match(html, /Experimental BBB evidence\./);
  assert.match(html, /Limited support/);
  assert.match(html, /Limited support for HIA\./);
});

test('renders model unavailable without attempting endpoint cards', () => {
  const html = render({
    admet_model_status: 'model_unavailable',
    admet_warning: 'Frozen local bundle is unavailable.',
    admet_predictions: {},
  });

  assert.match(html, /ADMET model unavailable/);
  assert.match(html, /Frozen local bundle is unavailable\./);
  assert.doesNotMatch(html, /admet-endpoint-hia_hou/);
});

test('renders missing ADMET data without page failure', () => {
  const html = render({ molecule_id: 'legacy-result' });

  assert.match(html, /ADMET data is not available for this result\./);
});

test('renders invalid-molecule not-run state', () => {
  const html = render({ admet_model_status: 'not_run_invalid_molecule' });

  assert.match(html, /not run because the molecule is invalid/);
});
