import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let CompoundProfileIntegration;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  CompoundProfileIntegration = (await vite.ssrLoadModule('/src/CompoundProfileIntegration.jsx')).default;
});

after(async () => vite?.close());

test('integrated profile renders one selected compound with separated evidence categories and availability states', () => {
  const html = renderToStaticMarkup(React.createElement(CompoundProfileIntegration, {
    compound: { molecule_id: 'generated-long-identifier-123456789', canonical_smiles: 'CCO', mw: 46.07 },
    upload: { upload_id: 'a'.repeat(32) },
  }, React.createElement('div', null, 'Existing ADMET, docking, and prioritization sections')));
  for (const phrase of ['Compound profile overview', 'Calculated', 'Predicted', 'Docking', 'Prioritization', 'Structural Context', 'Experimental Analog Context', 'Experimental Neighborhood', 'Search not run', 'Find experimental analogs', 'Evidence ownership and provenance']) assert.match(html, new RegExp(phrase, 'i'));
  assert.match(html, /Predictions not available/);
  assert.match(html, /No docking result available/);
  assert.match(html, /Download Profile Markdown/);
  assert.match(html, /Probability is not confidence/);
  assert.match(html, /belong to external reference compounds/);
});

