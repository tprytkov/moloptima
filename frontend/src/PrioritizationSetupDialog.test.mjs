import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import fs from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let module;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  module = await vite.ssrLoadModule('/src/PrioritizationSetupDialog.jsx');
});

after(async () => vite.close());

function configuration(overrides = {}) {
  return module.createPrioritizationSetupConfiguration({
    prioritizationSettings: { method: 'legacy_v1', profile: null, validation: null },
    pubchemLookupEnabled: false,
    chemblLookupEnabled: true,
    patentLookupEnabled: false,
    targetReferenceEnabled: true,
    targetContext: { enable_docking: false, target_name: 'CHRNA7' },
    ...overrides,
  });
}

test('setup configuration preserves the exact backend-backed settings and contexts', () => {
  const result = configuration();
  assert.equal(result.prioritizationSettings.method, 'legacy_v1');
  assert.equal(result.chemblLookupEnabled, true);
  assert.equal(result.targetReferenceEnabled, true);
  assert.equal(result.targetContext.target_name, 'CHRNA7');
  assert.equal(result.targetContext.enable_docking, false);
});

test('Multi-Parameter Prioritization Apply is blocked until profile validation is scoreable', () => {
  const invalid = configuration({
    prioritizationSettings: { method: 'v2', profile: { profile_id: 'draft' }, validation: null },
  });
  assert.deepEqual(module.validatePrioritizationSetup(invalid), [
    'Multi-Parameter Prioritization requires a complete profile that passes backend scoring validation.',
  ]);
  const valid = configuration({
    prioritizationSettings: { method: 'v2', profile: { profile_id: 'frozen' }, validation: { scoreable: true } },
  });
  assert.deepEqual(module.validatePrioritizationSetup(valid), []);
});

test('closed setup renders one accessible trigger without exposing modal-only controls', () => {
  const html = renderToStaticMarkup(React.createElement(module.default, {
    apiBaseUrl: 'http://localhost:8000',
    appliedConfiguration: configuration(),
    onApply: () => {},
  }));
  assert.match(html, /Prioritization Setup/);
  assert.doesNotMatch(html, /Apply &amp; Run/);
  assert.doesNotMatch(html, /Search candidates|Sort by|Comparison set/);
});

test('dialog source reuses shared draft state and keeps exploration controls out of setup', async () => {
  const source = await fs.readFile(new URL('./PrioritizationSetupDialog.jsx', import.meta.url), 'utf8');
  assert.match(source, /ScientificSetupDialog/);
  assert.match(source, /scientificSetupReducer/);
  assert.match(source, /PrioritizationSettings/);
  assert.match(source, /Evidence & Target/);
  assert.match(source, /Ranking Method/);
  assert.doesNotMatch(source, /ApplyAndRun|Search candidates|Sort by|comparisonIds/);
});
