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

function render(upload = null, overrides = {}, backendHealth = { status: 'online', label: 'Online' }) {
  return renderToStaticMarkup(React.createElement(module.default, {
    uploadState: { smilesText: '', selectedFiles: [], selectedStructureColumn: '', loading: false, error: '', upload, ...overrides },
    backendHealth,
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
    upload_id: 'upload-ethanol',
    preview: [{ molecule_id: 'ethanol', source_type: 'sdf', source_filename: 'ethanol.sdf', canonical_smiles: 'CCO', structure_status: 'validated', coordinate_status: '3d', validation_status: 'valid', warnings: [] }],
  });
  assert.match(html, /Single Compound Analysis/);
  assert.match(html, /1 imported \/ 1 valid/);
  assert.match(html, /Canonical SMILES/);
  assert.match(html, />Structure</);
  assert.match(html, /aria-label="3D structure preview for ethanol"/);
  assert.match(html, /aria-label="Inspect ethanol"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, />Valid</);
  assert.match(html, /Upload ID/);
  assert.match(html, /upload-ethanol/);
  assert.doesNotMatch(html, />warnings</i);
  assert.match(html, /ethanol\.sdf/);
  assert.doesNotMatch(html, /[A-Za-z]:\\Users\\/);
});

test('preview replaces warning text with a keyboard-reachable warning tooltip control', () => {
  const warning = 'Original coordinates are preserved as provenance.';
  const html = render({
    filename: 'ethanol.sdf', submitted_count: 1, valid_count: 1, invalid_count: 0,
    unresolved_pdb_count: 0, duplicate_count: 0, ignored_file_count: 0,
    multi_record_sdf_count: 0, analysis_mode: 'single_compound',
    preview: [{
      molecule_id: 'ethanol', source_type: 'sdf', source_filename: 'ethanol.sdf',
      canonical_smiles: 'CCO', structure_status: 'validated', coordinate_status: '3d', validation_status: 'valid',
      warnings: [warning], failure_reason: '',
    }],
  });

  assert.match(html, new RegExp(`aria-label="Import warning for ethanol: ${warning}`));
  assert.match(html, /<button[^>]*aria-label="Import warning for ethanol:/);
  assert.doesNotMatch(html, /<th[^>]*>warnings<\/th>/i);
  assert.equal((html.match(new RegExp(warning, 'g')) ?? []).length, 2);
  assert.match(html, /VALIDATION \/ PROVENANCE/);
});

test('preview omits the warning control when no warning or failure exists', () => {
  const html = render({
    filename: 'ethanol.sdf', submitted_count: 1, valid_count: 1, invalid_count: 0,
    analysis_mode: 'single_compound', preview: [{
      molecule_id: 'ethanol', source_type: 'sdf', canonical_smiles: 'CCO',
      structure_status: 'validated', coordinate_status: 'none', validation_status: 'valid', warnings: [], failure_reason: '',
    }],
  });
  assert.doesNotMatch(html, /Import warning for ethanol/);
});

test('preview distinguishes focused inspection from pending-file batch selection', () => {
  const html = render({
    upload_id: 'focused-upload', filename: 'mixed.csv', submitted_count: 2, valid_count: 1, invalid_count: 1,
    analysis_mode: 'single_compound', preview: [
      { molecule_id: 'valid-1', source_type: 'smiles', canonical_smiles: 'CCO', structure_status: 'validated', coordinate_status: 'none', validation_status: 'valid', warnings: [] },
      { molecule_id: 'invalid-1', source_type: 'smiles', input_smiles: 'not-smiles', structure_status: 'invalid_smiles', coordinate_status: 'none', validation_status: 'invalid', failure_reason: 'Invalid SMILES' },
    ],
  });
  assert.match(html, /aria-label="Inspect valid-1"/);
  assert.match(html, /aria-label="Inspect invalid-1"/);
  assert.match(html, /Selected compound: valid-1/);
  assert.match(html, />Invalid</);
  assert.doesNotMatch(html, /type="checkbox"/);
});

test('library and multi-record rejection states are explicit', () => {
  const library = render({
    filename: 'mixed molecule collection', submitted_count: 3, valid_count: 2, invalid_count: 1,
    unresolved_pdb_count: 0, duplicate_count: 1, ignored_file_count: 0,
    multi_record_sdf_count: 1, analysis_mode: 'library', preview: [],
  });
  assert.match(library, /Library Prioritization/);
  assert.match(library, /3 imported \/ 2 valid/);
  assert.match(library, /MolOptima accepts one molecule per SDF file/);
});

test('analysis mode labels are authoritative', () => {
  assert.equal(module.analysisModeLabel('single_compound'), 'Single Compound Analysis');
  assert.equal(module.analysisModeLabel('library'), 'Library Prioritization');
  assert.equal(module.analysisModeLabel('unavailable'), 'Not available');
});

test('supported files create an additive, deduplicated pending selection', async () => {
  const selection = await vite.ssrLoadModule('/src/moleculeSelection.js');
  const sdf = { name: 'one.sdf', size: 12, lastModified: 10, webkitRelativePath: 'library/one.sdf' };
  const current = { selectedFiles: [], upload: { upload_id: 'already-loaded' }, error: 'old error', fileInputResetKey: 0 };
  const first = selection.applyMoleculeSelectionUpdate(current, { addFiles: [sdf] });
  const second = selection.applyMoleculeSelectionUpdate(first, { addFiles: [sdf] });
  assert.equal(second.selectedFiles.length, 1);
  assert.equal(second.selectedFiles[0], sdf);
  assert.equal(second.upload.upload_id, 'already-loaded');
  assert.equal(second.error, '');
});

test('same basename remains distinct when browser path metadata differs', async () => {
  const selection = await vite.ssrLoadModule('/src/moleculeSelection.js');
  const left = { name: 'molecule.sdf', size: 12, lastModified: 10, webkitRelativePath: 'left/molecule.sdf' };
  const right = { name: 'molecule.sdf', size: 12, lastModified: 10, webkitRelativePath: 'right/molecule.sdf' };
  assert.deepEqual(selection.mergePendingMoleculeFiles([left], [right]), [left, right]);
});

test('clear removes pending files and errors, resets inputs, and preserves loaded molecules', async () => {
  const selection = await vite.ssrLoadModule('/src/moleculeSelection.js');
  const upload = { upload_id: 'loaded', valid_count: 3 };
  const cleared = selection.applyMoleculeSelectionUpdate({
    selectedFiles: [{ name: 'one.sdf' }], upload, error: 'selection failed', fileInputResetKey: 4,
  }, { clearSelectedFiles: true });
  assert.deepEqual(cleared.selectedFiles, []);
  assert.equal(cleared.error, '');
  assert.equal(cleared.fileInputResetKey, 5);
  assert.equal(cleared.upload, upload);
});

test('unsupported files are classified and excluded from validation upload', async () => {
  const selection = await vite.ssrLoadModule('/src/moleculeSelection.js');
  const sdf = { name: 'one.SDF' };
  const pickle = { name: 'model.pkl' };
  const classified = selection.classifyPendingMoleculeFiles([sdf, pickle]);
  assert.deepEqual(classified.supported, [sdf]);
  assert.deepEqual(classified.unsupported, [pickle]);
  assert.deepEqual(selection.filesForMoleculeValidation([sdf, pickle]), [sdf]);
  const html = render(null, { selectedFiles: [sdf, pickle] });
  assert.match(html, /Selected files: 2 · Supported: 1 · Unsupported: 1/);
  assert.match(html, /1 unsupported file will be ignored/);
});

test('large selections render a bounded preview and compact remainder count', () => {
  const selectedFiles = Array.from({ length: 428 }, (_, index) => ({
    name: `molecule-${index}.sdf`, size: index + 1, lastModified: 10,
  }));
  const html = render(null, { selectedFiles });
  assert.match(html, /Selected files: 428 · Supported: 428 · Unsupported: 0/);
  assert.match(html, /\+ 423 more/);
  assert.equal((html.match(/molecule-\d+\.sdf/g) ?? []).length, 5);
  assert.doesNotMatch(html, /molecule-427\.sdf/);
});

test('backend connectivity gates validation without removing pending files', () => {
  const selectedFiles = [{ name: 'one.sdf', size: 12, lastModified: 10 }];
  const offline = render(null, { selectedFiles }, { status: 'offline', label: 'Offline' });
  const online = render(null, { selectedFiles }, { status: 'online', label: 'Online' });
  assert.match(offline, /Your selected files are preserved/);
  assert.match(offline.match(/<button[^>]*>Validate and load molecules<\/button>/)?.[0] ?? '', /disabled/);
  assert.match(offline, /one\.sdf/);
  assert.doesNotMatch(online.match(/<button[^>]*>Validate and load molecules<\/button>/)?.[0] ?? '', /disabled/);
  assert.match(online, /one\.sdf/);
});

test('no supported pending file disables validation and large file selections use chunking', async () => {
  const selection = await vite.ssrLoadModule('/src/moleculeSelection.js');
  const html = render(null, { selectedFiles: [{ name: 'model.pkl' }] });
  assert.match(html.match(/<button[^>]*>Validate and load molecules<\/button>/)?.[0] ?? '', /disabled/);
  const tooMany = Array.from({ length: 1001 }, (_, index) => ({ name: `${index}.sdf`, size: 1, lastModified: index }));
  assert.equal(selection.pendingSelectionLimitError(tooMany), '');
  assert.equal(selection.pendingSelectionLimitError(tooMany.slice(0, 1000)), '');
  assert.match(selection.pendingSelectionLimitError([], Array(1001).fill('CCO').join('\n')), /Maximum batch size is 1,000/);
  const tooManyCsvFiles = tooMany.map((file, index) => ({ ...file, name: `${index}.csv` }));
  assert.equal(selection.pendingSelectionLimitError(tooManyCsvFiles), '');
});

test('renders acknowledged chunk progress and cancel action without replacing loaded upload', () => {
  const html = render({ upload_id: 'previous', valid_count: 1 }, {
    loading: true,
    importProgress: {
      status: 'running', processedFiles: 250, totalFiles: 501,
      parsedRecords: 250, batchNumber: 1, totalBatches: 3,
    },
  });
  assert.match(html, /250 \/ 501 files processed/);
  assert.match(html, /Batch 1 of 3/);
  assert.match(html, /250 molecule records parsed/);
  assert.match(html, /Cancel import/);
  assert.match(html, /Validated collection/);
});

test('renders stopped chunk progress honestly after a failure', () => {
  const html = render({ upload_id: 'previous', valid_count: 1 }, {
    error: 'Import stopped after 250 / 501 files. Batch failed.',
    importProgress: {
      status: 'failed', processedFiles: 250, totalFiles: 501,
      parsedRecords: 250, batchNumber: 1, totalBatches: 3,
    },
  });
  assert.match(html, /Import stopped/);
  assert.doesNotMatch(html, />Importing molecules</);
  assert.match(html, /Validated collection/);
});

test('finalization is visibly non-cancellable', () => {
  const html = render(null, {
    loading: true,
    importProgress: {
      status: 'finalizing', processedFiles: 501, totalFiles: 501,
      parsedRecords: 501, batchNumber: 3, totalBatches: 3,
    },
  });
  assert.match(html, /Finalizing molecule import/);
  assert.match(html, /Finalizing import/);
  assert.doesNotMatch(html, /Cancel import/);
});
