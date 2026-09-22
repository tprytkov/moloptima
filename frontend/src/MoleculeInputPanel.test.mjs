import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let module;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  module = await vite.ssrLoadModule('/src/MoleculeInputPanel.jsx');
});

after(async () => vite?.close());

function render(upload = null) {
  return renderToStaticMarkup(React.createElement(module.default, {
    uploadState: { smilesText: '', selectedFiles: [], selectedStructureColumn: '', loading: false, error: '', upload },
    onChange: () => {}, onImport: () => {}, onContinue: () => {},
  }));
}

test('renders every supported compact input method and hard SDF/PDB warnings', () => {
  const html = render();
  for (const label of [
    'Enter / Paste SMILES', 'Upload CSV / TSV', 'Upload SDF', 'Upload Ligand PDB',
    'Select Structure Files', 'Select Folder',
  ]) assert.match(html, new RegExp(label.replace('/', '\\/')));
  assert.match(html, /Multi-record SDF files are not supported/);
  assert.match(html, /SDF is preferred for small-molecule structure files/);
  assert.match(html, /one molecule per line/i);
});

test('renders all six upload actions as named keyboard-operable buttons', () => {
  const html = render();
  for (const name of [
    'Upload CSV / TSV',
    'Upload SDF',
    'Upload Ligand PDB',
    'Select Structure Files',
    'Select Folder · SDF library',
    'Select Folder · PDB library',
  ]) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(html, new RegExp(`<button[^>]*aria-label="${escaped}"[^>]*>[\\s\\S]*?${escaped}[\\s\\S]*?<\\/button>`));
  }
  assert.equal((html.match(/<input[^>]*type="file"/g) ?? []).length, 6);
});

test('single-compound summary reports counts, preview provenance, and mode', () => {
  const html = render({
    filename: 'ethanol.sdf', submitted_count: 1, valid_count: 1, invalid_count: 0,
    unresolved_pdb_count: 0, duplicate_count: 0, ignored_file_count: 0,
    multi_record_sdf_count: 0, analysis_mode: 'single_compound',
    preview: [{ molecule_id: 'ethanol', source_type: 'sdf', source_filename: 'ethanol.sdf', canonical_smiles: 'CCO', structure_status: 'validated', coordinate_status: '3d', warnings: [] }],
  });
  assert.match(html, /Single Compound Analysis/);
  assert.match(html, /1 valid compound loaded/);
  assert.match(html, /canonical_smiles/);
  assert.match(html, /ethanol\.sdf/);
  assert.doesNotMatch(html, /[A-Za-z]:\\Users\\/);
});

test('library and multi-record rejection states are explicit', () => {
  const library = render({
    filename: 'mixed molecule collection', submitted_count: 3, valid_count: 2, invalid_count: 1,
    unresolved_pdb_count: 0, duplicate_count: 1, ignored_file_count: 0,
    multi_record_sdf_count: 1, analysis_mode: 'library', preview: [],
  });
  assert.match(library, /Library Prioritization/);
  assert.match(library, /2 valid compounds loaded/);
  assert.match(library, /MolOptima accepts one molecule per SDF file/);
});

test('analysis mode labels are authoritative', () => {
  assert.equal(module.analysisModeLabel('single_compound'), 'Single Compound Analysis');
  assert.equal(module.analysisModeLabel('library'), 'Library Prioritization');
  assert.equal(module.analysisModeLabel('unavailable'), 'Not available');
});
