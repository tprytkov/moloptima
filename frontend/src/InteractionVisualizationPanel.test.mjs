import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let Panel;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  ({ default: Panel } = await vite.ssrLoadModule('/src/InteractionVisualizationPanel.jsx'));
});
after(async () => vite?.close());

const point = { molecule_id: 'gen_3389', canonical_smiles: 'CCN', mode: 1, fingerprint_status: 'available', visualization: { receptor_id: '9IIR' }, fingerprint: { raw_interaction_records: [{ interaction_type: 'Hydrophobic' }] } };

test('integrated panel identifies the explicit molecule, mode, receptor, and synchronized tabs', async () => {
  const html = renderToStaticMarkup(React.createElement(Panel, { baseUrl: 'http://localhost:8000', jobId: 'job', point, resultRow: {}, selectedToken: '', onSelectToken() {} }));
  assert.match(html, /Selected pose interaction visualization/);
  assert.match(html, /gen_3389 · Vina Mode 1 · Receptor 9IIR/);
  assert.match(html, /3D Interactions/);
  assert.match(html, /2D Interaction Map/);
  assert.match(await readFile(new URL('./InteractionVisualizationPanel.jsx', import.meta.url), 'utf8'), /Pocket · qualified 8 Å/);
});

test('visualization source uses validated cached artifacts and exports without scientific recomputation', async () => {
  const source = await readFile(new URL('./InteractionVisualizationPanel.jsx', import.meta.url), 'utf8');
  assert.match(source, /fetchDockingPoseArtifact/);
  assert.match(source, /selectVinaPoseMode/);
  assert.match(source, /fetchReceptorStructure/);
  assert.match(source, /Export SVG/);
  assert.match(source, /3840/);
  assert.doesNotMatch(source, /api\/design-logic\/analyze|postJson|Vina\(|Open Babel/);
});
