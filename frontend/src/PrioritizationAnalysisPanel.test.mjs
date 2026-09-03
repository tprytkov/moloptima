import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let module;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  module = await vite.ssrLoadModule('/src/PrioritizationAnalysisPanel.jsx');
});

after(async () => vite?.close());

test('renders opt-in Pareto and sensitivity controls with non-scoring wording', () => {
  const html = renderToStaticMarkup(React.createElement(module.default, {
    apiBaseUrl: 'http://localhost:8000',
    results: [{ molecule_id: 'mol' }],
    profile: null,
    profileScoreable: false,
  }));
  assert.match(html, /Secondary v2 Analyses/);
  assert.match(html, /do not alter the Prioritization v2 score, scalar rank, profile, penalties, or gates/);
  assert.match(html, /Pareto trade-off analysis/);
  assert.match(html, /Safety uses the existing combined liability-penalty factor/);
  assert.match(html, /Run Pareto analysis/);
  assert.match(html, /Top-level weight sensitivity/);
  assert.match(html, /Endpoint rules and thresholds are unchanged/);
  assert.match(html, /Analysis default: 0\.10/);
  assert.match(html, /valid scoreable v2 profile associated with this analysis session/);
});

test('renders Pareto fronts, dimensions, and dominance counts', () => {
  const html = renderToStaticMarkup(React.createElement(module.ParetoResults, {
    analysis: {
      dimensions_used: ['docking', 'admet', 'safety'],
      rank_eligible_molecule_count: 2,
      results: [{
        source_index: 0,
        molecule_id: 'mol-a',
        scalar_rank: 1,
        pareto_front: 1,
        pareto_non_dominated: true,
        pareto_dominated_by_count: 0,
        pareto_dominates_count: 1,
      }],
    },
  }));
  assert.match(html, /Dimensions: docking, admet, safety/);
  assert.match(html, /Pareto front/);
  assert.match(html, /Scalar rank/);
  assert.match(html, /Non-dominated/);
  assert.match(html, /mol-a/);
});

test('renders sensitivity rank range, top-k stability, provenance, and exclusions', () => {
  const html = renderToStaticMarkup(React.createElement(module.SensitivityResults, {
    analysis: {
      provenance: { source_profile_sha256: 'sha-test', number_of_samples: 50, analysis_seed: 17 },
      results: [{
        source_index: 0,
        molecule_id: 'mol-a',
        baseline_rank: 2,
        minimum_rank: 1,
        maximum_rank: 4,
        median_rank: 2.5,
        rank_standard_deviation: 0.75,
        top_1_frequency: 0.2,
        top_5_frequency: 1,
        top_10_frequency: null,
      }],
      excluded_unrankable: [{ molecule_id: 'gated' }],
    },
  }));
  assert.match(html, /sha-test/);
  assert.match(html, /Rank range/);
  assert.match(html, /1–4/);
  assert.match(html, /20\.0%/);
  assert.match(html, /N\/A for population/);
  assert.match(html, /hard-gated or otherwise unrankable molecules remained excluded/);
});

test('analysis request helpers call the two opt-in backend routes', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ explanatory_only: true }) };
  };
  try {
    await module.requestParetoAnalysis('http://api', [{ molecule_id: 'm' }], ['admet']);
    await module.requestSensitivityAnalysis(
      'http://api', [{ molecule_id: 'm' }], { profile_id: 'p' },
      { perturbationMagnitude: 0.2, numberOfSamples: 25, analysisSeed: 9 },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls[0].url, 'http://api/api/prioritization/analysis/pareto');
  assert.deepEqual(JSON.parse(calls[0].options.body).dimensions, ['admet']);
  assert.equal(calls[1].url, 'http://api/api/prioritization/analysis/sensitivity');
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    job_id: null,
    candidates: [{ molecule_id: 'm' }],
    profile: { profile_id: 'p' },
    perturbation_magnitude: 0.2,
    number_of_samples: 25,
    analysis_seed: 9,
  });
});

test('saved analysis helper uses the persisted job-scoped endpoint', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({ ok: true, json: async () => ({ url }) });
  try {
    const saved = await module.fetchSavedAnalysis('http://api', 'job-1', 'pareto');
    assert.equal(saved.url, 'http://api/api/results/job-1/analysis/pareto');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
