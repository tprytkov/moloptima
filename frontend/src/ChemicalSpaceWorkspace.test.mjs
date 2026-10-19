import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let ChemicalSpaceWorkspace;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  ({ default: ChemicalSpaceWorkspace } = await vite.ssrLoadModule('/src/ChemicalSpaceWorkspace.jsx'));
});

after(async () => vite?.close());

test('workspace exposes supported scientific configuration before a collection is active', () => {
  const html = renderToStaticMarkup(React.createElement(ChemicalSpaceWorkspace, { upload: null }));
  assert.match(html, /No active molecule collection/);
  assert.match(html, /Morgan fingerprint/);
  assert.match(html, /PCA/);
  assert.match(html, /Tanimoto/);
  assert.match(html, /Source \/ scaffold/);
  assert.match(html, /Distance in the PCA projection/);
  assert.match(html.match(/<button[^>]*disabled[^>]*>/)?.[0] || '', /disabled/);
});

test('workspace establishes descriptive Map, Neighbors, Scaffolds, and Experimental Neighborhood controls', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('./ChemicalSpaceWorkspace.jsx', import.meta.url), 'utf8');
  assert.match(source, /label="Map"/);
  assert.match(source, /label="Neighbors"/);
  assert.match(source, /label="Scaffolds"/);
  assert.match(source, /label="Experimental Neighborhood"/);
  assert.match(source, /Find experimental analogs/);
  assert.match(source, /setTab\(3\)/);
  assert.match(source, /\/api\/chemical-space\/scaffolds/);
  assert.match(source, /Scaffold group/);
  assert.match(source, /CHEMICAL_SPACE_TOP_K_OPTIONS/);
  assert.match(source, /activity, potency, applicability domain, confidence, preference, and rank are not inferred/);
  assert.match(source, /chemical-space-canvas/);
  assert.match(source, /chemical-space-workstation/);
  assert.match(source, /Randomized PCA projection/);
  assert.match(source, /Map distance is not Tanimoto similarity/);
  assert.match(source, /aria-label="Chemical Space query and display controls"/);
  assert.match(source, /aria-label="Query-relative structural neighbors"/);
  assert.match(source, /loading="lazy"/);
  assert.match(source, /Method and provenance/);
  assert.match(source, /Select a molecule on the Map to calculate query-relative neighbors/);
  assert.match(source, /rdkit_version/);
});
