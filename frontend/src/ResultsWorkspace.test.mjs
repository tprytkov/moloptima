import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let module;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  module = await vite.ssrLoadModule('/src/ResultsWorkspace.jsx');
});

after(async () => vite?.close());

test('result domain availability distinguishes available, partial, not-run, and unavailable states', () => {
  const domains = module.deriveResultDomains({
    analysisMode: 'library',
    job: { status: 'completed', docking_requested: true, ranked_count: 1 },
    rows: [
      {
        valid_molecule: true,
        admet_model_status: 'model_available',
        docking_result: { status: 'success' },
        scientific_rank: 1,
        chemical_space_x: 0,
        chemical_space_y: -1,
        chemical_space_status: 'available',
      },
      {
        valid_molecule: true,
        admet_model_status: 'runtime_unavailable',
        docking_result: { status: 'failed' },
        scientific_rank: null,
        chemical_space_status: 'not_run',
      },
    ],
  });
  assert.deepEqual(domains, [
    { label: 'Molecule Results', status: 'Available' },
    { label: 'ADMET Results', status: 'Partial · 1 of 2' },
    { label: 'Docking Results', status: 'Partial · 1 of 2' },
    { label: 'Prioritization Results', status: 'Available' },
    { label: 'Chemical Space Results', status: 'Partial · 1 of 2' },
  ]);
});

test('single-compound domains do not fabricate library prioritization or absent science', () => {
  const domains = module.deriveResultDomains({
    analysisMode: 'single_compound',
    job: { status: 'completed', docking_requested: false },
    rows: [{ valid_molecule: true, admet_model_status: 'not_run', docking_result: { status: 'not_requested' } }],
  });
  assert.deepEqual(Object.fromEntries(domains.map(({ label, status }) => [label, status])), {
    'Molecule Results': 'Available',
    'ADMET Results': 'Not run',
    'Docking Results': 'Not run',
    'Prioritization Results': 'Not used',
    'Chemical Space Results': 'Not run',
  });
});

test('explicit not-run Chemical Space status remains distinct from unavailable', () => {
  const domains = module.deriveResultDomains({
    analysisMode: 'library',
    job: { status: 'completed' },
    rows: [{ valid_molecule: true, chemical_space_status: 'not_run' }],
  });
  assert.equal(domains.find(({ label }) => label === 'Chemical Space Results').status, 'Not run');
});

test('Results workspace keeps review content visible and export as one focused action', () => {
  const html = renderToStaticMarkup(React.createElement(module.default, {
    title: 'Library Prioritization Results',
    description: 'Inspect persisted results.',
    status: 'Completed with warnings',
    summaryItems: [
      { label: 'Calculation', value: 'Opened saved calculation' },
      { label: 'Result scope', value: '10 candidates in this calculation' },
    ],
    domains: [{ label: 'Molecule Results', status: 'Available' }],
    provenanceRows: [['Job ID', 'job-a']],
    exportContent: React.createElement('div', null, 'Existing export actions'),
  }, React.createElement('div', null, 'Scientific result inspection')));
  assert.match(html, /Library Prioritization Results/);
  assert.match(html, /Completed with warnings/);
  assert.match(html, /Opened saved calculation/);
  assert.match(html, /10 candidates in this calculation/);
  assert.match(html, /Molecule Results: Available/);
  assert.match(html, /Scientific provenance and identifiers/);
  assert.match(html, /Scientific result inspection/);
  assert.match(html, /Export Results/);
  assert.doesNotMatch(html, /Existing export actions/);
});
