import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let ExperimentalNeighborhood;
let filterExperimentalRecords;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  ({ default: ExperimentalNeighborhood, filterExperimentalRecords } = await vite.ssrLoadModule('/src/ExperimentalNeighborhood.jsx'));
});

after(async () => vite?.close());

const queryMolecule = { molecule_id: 'generated-1', display_name: 'Generated molecule G-127', canonical_smiles: 'Cc1ccccc1' };

test('entry state keeps selected query identity and scientific boundary explicit', () => {
  const html = renderToStaticMarkup(React.createElement(ExperimentalNeighborhood, {
    upload: { upload_id: 'a'.repeat(32) }, queryMolecule,
  }));
  assert.match(html, /Experimental Neighborhood/);
  assert.match(html, /Selected MolOptima compound/);
  assert.match(html, /Generated molecule G-127/);
  assert.match(html, /no experimental value is assigned by this search/);
  assert.match(html, /belong to known reference compounds, not to the selected MolOptima compound/);
  assert.match(html, /Find experimental analogs/);
  assert.doesNotMatch(html, /estimated activity|weighted neighbor potency|average neighbor/);
});

test('no-selection state guides the Chemical Space entry flow', () => {
  const html = renderToStaticMarkup(React.createElement(ExperimentalNeighborhood, { upload: { upload_id: 'a'.repeat(32) }, queryMolecule: null }));
  assert.match(html, /Select a molecule on the Chemical Space map/);
});

test('record filtering is target and endpoint specific without aggregation', () => {
  const records = [
    { source_record_id: '1', endpoint_name: 'IC50', assay_type: 'B', source: 'ChEMBL', target: { name: 'Target A', organism: 'Human' } },
    { source_record_id: '2', endpoint_name: 'EC50', assay_type: 'F', source: 'ChEMBL', target: { name: 'Target A', organism: 'Human' } },
    { source_record_id: '3', endpoint_name: 'IC50', assay_type: 'B', source: 'ChEMBL', target: { name: 'Target B', organism: 'Mouse' } },
  ];
  const result = filterExperimentalRecords(records, { query: '', target: 'Target A', endpoint: 'IC50', assayType: '', organism: '', source: '' });
  assert.deepEqual(result.map((record) => record.source_record_id), ['1']);
});

test('source contains bounded tables, exact/no-match, network states, provenance, censoring and explicit export', async () => {
  const source = await readFile(new URL('./ExperimentalNeighborhood.jsx', import.meta.url), 'utf8');
  for (const phrase of [
    'Searching ChEMBL by structure', 'No exact structure match found in the searched database',
    'Exact structure match found in ChEMBL', 'MolOptima Tanimoto', 'Same Murcko scaffold',
    'Compatibility', 'Censored', 'Retrieved', 'Prepare CSV for Experimental Data import',
    'ChEMBL is offline or unreachable', 'rate limited', 'maxHeight: 520', 'PAGE_SIZE = 25',
  ]) assert.match(source, new RegExp(phrase));
  assert.match(source, /target/);
  assert.match(source, /endpoint/);
  assert.match(source, /assayType/);
  assert.match(source, /organism/);
  assert.match(source, /source/);
  assert.doesNotMatch(source, /activity cliff|SALI|interpolated activity/i);
});
