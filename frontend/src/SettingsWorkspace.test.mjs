import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let module;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  module = await vite.ssrLoadModule('/src/SettingsWorkspace.jsx');
});

after(async () => vite?.close());

function runtimePayload(overrides = {}) {
  return {
    checked_at: '2026-10-26T12:00:00+00:00',
    qualification_state: 'complete',
    refreshing: false,
    probe_timings_seconds: { chemberta: 1.25, gmc_mpnn_bbb: 120 },
    components: {
      chemberta: { status: 'available', runtime_source: 'application_process', public_endpoint_count: 9 },
      gmc_mpnn_bbb: { status: 'error', runtime_source: 'unavailable', reason: 'runtime_probe_timeout' },
      chemprop_regression: { status: 'unavailable', runtime_source: 'unavailable', reason: 'packaged_runtime_missing' },
      receptor_preparation: {
        status: 'available', runtime_source: 'application_process_and_isolated_repair_runtime',
        meeko: { status: 'available', version: '0.7.1' }, gemmi: { status: 'available', version: '0.7.5' },
        pdbfixer: { status: 'available', version: '1.9' }, openmm: { status: 'available', version: '8.2' },
      },
      docking: {
        status: 'available', vina: { status: 'available', identity: 'AutoDock Vina 1.1.2' },
        openbabel: { status: 'available', identity: 'Open Babel 3.1.0' },
      },
      ...overrides,
    },
  };
}

test('runtime status language distinguishes timeout, probe error, unavailable, and available', () => {
  assert.deepEqual(module.runtimeStatusPresentation({ status: 'error', reason: 'runtime_probe_timeout' }), { label: 'Probe Timed Out', color: 'warning' });
  assert.deepEqual(module.runtimeStatusPresentation({ status: 'error', reason: 'ValueError' }), { label: 'Probe Error', color: 'error' });
  assert.deepEqual(module.runtimeStatusPresentation({ status: 'unavailable' }), { label: 'Unavailable', color: 'warning' });
  assert.deepEqual(module.runtimeStatusPresentation({ status: 'available' }), { label: 'Available', color: 'success' });
});

test('Scientific Runtime renders independent readable cards and secondary technical details', () => {
  const html = renderToStaticMarkup(React.createElement(module.ScientificRuntimePanel, {
    runtimeState: { payload: runtimePayload(), loading: false, error: '' }, onRefresh: () => {},
  }));
  for (const name of ['ChemBERTa Classification', 'GMC-MPNN BBB', 'Chemprop Regression', 'Meeko', 'Gemmi', 'PDBFixer', 'OpenMM', 'Vina', 'Open Babel']) {
    assert.match(html, new RegExp(name));
  }
  assert.match(html, /Probe Timed Out/);
  assert.match(html, /Availability was not determined/);
  assert.match(html, /Runtime Details/);
  assert.match(html, /threshold 0\.5 · provisional raw · calibration not frozen/);
  assert.match(html, /not experimental binding free energy/);
  assert.doesNotMatch(html, /Scientifically ready|Model validated|Healthy model/);
});

test('Settings owns diagnostics only and has no active-job or scientific execution controls', () => {
  const html = renderToStaticMarkup(React.createElement(module.default, {
    sourceStatusState: { payload: null, loading: false, error: '' },
    onCheckLocalModelCache: () => {}, onRefreshSourceStatus: () => {},
  }));
  assert.match(html, /Settings/);
  assert.match(html, /Scientific Runtime/);
  assert.match(html, /Diagnostics/);
  assert.match(html, /Scientific configuration and execution remain in their owning workspaces/);
  assert.doesNotMatch(html, /Run ADMET|Run Docking|Run Chemical Space|Run Prioritization|Run Pareto|Run Sensitivity|Run ChEMBL/);
  assert.doesNotMatch(html, /activeJob|Current job|Apply settings|Reset all/);
});

test('runtime API helper preserves GET status and explicit POST refresh contracts', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push([url, options]);
    return { ok: true, json: async () => ({ qualification_state: 'complete', components: {} }) };
  };
  try {
    await module.fetchScientificRuntimeStatus('http://api');
    await module.fetchScientificRuntimeStatus('http://api', { refresh: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(requests, [
    ['http://api/api/scientific-runtime/status', undefined],
    ['http://api/api/scientific-runtime/refresh', { method: 'POST' }],
  ]);
});
