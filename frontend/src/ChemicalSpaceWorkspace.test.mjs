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
  assert.match(html, /Default grouping/);
  assert.match(html, />Source</);
  assert.match(html, /Configure/);
  assert.match(html, /Distance in the PCA projection/);
  assert.match(html.match(/<button[^>]*disabled[^>]*>/)?.[0] || '', /disabled/);
});

test('active collection is ready but does not generate until the explicit action', () => {
  const html = renderToStaticMarkup(React.createElement(ChemicalSpaceWorkspace, { upload: { upload_id: 'upload-1' } }));
  assert.match(html, />Ready</);
  assert.match(html, /Generate Chemical Space/);
  assert.doesNotMatch(html, /Chemical Space workspace views/);
  const generateButton = html.match(/<button[^>]*>Generate Chemical Space<\/button>/)?.[0] || '';
  assert.ok(generateButton);
  assert.doesNotMatch(generateButton, /disabled/);
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
  assert.match(source, /async function generateChemicalSpace/);
  assert.match(source, /No scientific request runs when settings are opened, edited, cancelled, or applied/);
  const resetEffect = source.slice(
    source.indexOf('useEffect(() => {', source.indexOf('generationRef')),
    source.indexOf('async function generateChemicalSpace'),
  );
  assert.doesNotMatch(resetEffect, /requestJson/);
});

test('methodology guidance is informational and fixed methods are semantic read-only content', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('./ChemicalSpaceWorkspace.jsx', import.meta.url), 'utf8');
  assert.match(source, /<Alert severity="info" variant="outlined">PCA map distance is not Tanimoto similarity/);
  assert.match(source, /<Alert severity="info" variant="outlined">The projection visualizes Morgan fingerprint variation/);
  assert.match(source, /component="dl" aria-label="Implemented Chemical Space methods"/);
  assert.match(source, /component="dt"/);
  assert.match(source, /component="dd"/);
  assert.match(source, /Implemented · read only/);
  assert.doesNotMatch(source, /<TextField label="Molecular representation"/);
  assert.match(source, /<Select[\s\S]*value={setup\.draftConfiguration\.grouping}[\s\S]*onChange=/);
});
