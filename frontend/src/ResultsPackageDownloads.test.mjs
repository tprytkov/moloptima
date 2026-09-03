import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let module;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  module = await vite.ssrLoadModule('/src/ResultsPackageDownloads.jsx');
});

after(async () => vite?.close());

test('single result downloads contain assessment actions without library actions', () => {
  const html = renderToStaticMarkup(React.createElement(module.default, {
    apiBaseUrl: 'http://api', jobId: '', analysisMode: 'single_compound',
  }));
  assert.match(html, /Complete the calculation/);
  assert.doesNotMatch(html, /Prioritized Compounds/);
});

test('download definitions adapt without exposing inapplicable analyses', () => {
  const single = module.resultDownloadDefinitions('single_compound').map((item) => item[1]).join(' ');
  const library = module.resultDownloadDefinitions('library').map((item) => item[1]).join(' ');
  assert.match(single, /Compound Results CSV/);
  assert.doesNotMatch(single, /Prioritized|Pareto|Sensitivity/);
  assert.match(library, /Prioritized Compounds/);
  assert.match(library, /Pareto Results/);
  assert.match(library, /Sensitivity Results/);
});

test('package helper calls the job-scoped production endpoint', async () => {
  const original = global.fetch;
  global.fetch = async (url) => ({ ok: true, json: async () => ({ url, artifacts: [] }) });
  try {
    const value = await module.fetchResultsPackage('http://api', 'job-1');
    assert.equal(value.url, 'http://api/api/results/job-1/package');
  } finally {
    global.fetch = original;
  }
});
