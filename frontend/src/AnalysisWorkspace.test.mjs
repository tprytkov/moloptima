import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let module;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  module = await vite.ssrLoadModule('/src/AnalysisWorkspace.jsx');
});

after(async () => vite?.close());

test('analysis summary distinguishes the current calculation from explicitly opened history', () => {
  const current = module.analysisWorkspaceSummary({
    result: { prioritization_method: 'v2', results: [{}, {}] },
  });
  const historical = module.analysisWorkspaceSummary({
    openedHistorical: true,
    result: { prioritization_method: 'v2', results: [{}, {}] },
  });
  assert.equal(current.items[0].value, 'Current calculation');
  assert.equal(historical.items[0].value, 'Opened saved calculation');
  assert.equal(historical.items[1].value, '2 candidates in this calculation');
  assert.equal(historical.items[2].value, 'Multi-Parameter Prioritization');
  assert.equal(historical.items[3].value, 'Pareto · Sensitivity');
});

test('analysis workspace keeps result exploration in the main surface', () => {
  const html = renderToStaticMarkup(React.createElement(module.default, {
    openedHistorical: true,
    result: { prioritization_method: 'v2', results: [{ molecule_id: 'a' }] },
    children: React.createElement('div', null, 'Scientific result exploration'),
  }));
  assert.match(html, /Analysis scientific workspace/);
  assert.match(html, /Opened saved calculation/);
  assert.match(html, /Scientific result exploration/);
  assert.doesNotMatch(html, /Overall Analysis Score|Recommended compound|Winner/);
});

test('standard prioritization does not fabricate Pareto or sensitivity availability', () => {
  const summary = module.analysisWorkspaceSummary({
    result: { prioritization_method: 'legacy_v1', results: [{}] },
  });
  assert.equal(summary.items[2].value, 'Standard Prioritization');
  assert.equal(summary.items[3].value, 'Requires Multi-Parameter Prioritization');
});

test('historical sensitivity uses the persisted result profile identity and SHA before job fallback', () => {
  const resultProfile = { profile_id: 'historical-profile', profile_version: '1.0' };
  const context = module.persistedAnalysisProfileContext({
    prioritization_method: 'v2',
    prioritization_profile: resultProfile,
    prioritization_profile_sha256: 'historical-sha',
  }, {
    prioritization_method: 'v2',
    prioritization_profile: { profile_id: 'job-fallback' },
    prioritization_profile_sha256: 'job-sha',
  });
  assert.equal(context.profile, resultProfile);
  assert.equal(context.profileSha256, 'historical-sha');
  assert.equal(context.scoreable, true);
});
