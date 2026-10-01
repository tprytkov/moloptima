import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IMPORT_CHUNK_SIZE,
  importFailureState,
  runMoleculeImport,
} from './moleculeImportWorkflow.js';
import {
  filesForMoleculeValidation,
  mergePendingMoleculeFiles,
} from './moleculeSelection.js';


function moleculeFiles(count, extension = 'sdf') {
  return Array.from({ length: count }, (_, index) => new File(
    [`molecule ${index}`], `molecule_${String(index + 1).padStart(4, '0')}.${extension}`,
    { type: 'chemical/x-mdl-sdfile', lastModified: index },
  ));
}


function successfulRequestRecorder(overrides = {}) {
  const calls = [];
  const request = async (path, options) => {
    calls.push({ path, options, inFlight: calls.filter((call) => !call.done).length + 1 });
    const call = calls.at(-1);
    try {
      if (overrides.request) return await overrides.request(path, options, calls);
      if (path === '/api/molecules/import-jobs') return { import_job_id: 'job-1', status: 'pending' };
      if (path.endsWith('/batches')) {
        const batchIndex = Number(options.body.get('batch_index'));
        const processed = Math.min(batchIndex * IMPORT_CHUNK_SIZE, overrides.totalFiles ?? 501);
        return { processed_file_count: processed, parsed_record_count: processed };
      }
      return { upload_id: 'one-final-upload', submitted_count: overrides.totalFiles ?? 1 };
    } finally {
      call.done = true;
    }
  };
  return { calls, request };
}


test('250 supported files use the existing single-request path', async () => {
  const recorder = successfulRequestRecorder({ totalFiles: 250 });
  await runMoleculeImport({ files: moleculeFiles(250), request: recorder.request });
  assert.deepEqual(recorder.calls.map((call) => call.path), ['/api/molecules/import']);
  assert.equal(recorder.calls[0].options.body.getAll('files').length, 250);
});


test('more than 250 files use the import-job path', async () => {
  const recorder = successfulRequestRecorder({ totalFiles: 251 });
  await runMoleculeImport({ files: moleculeFiles(251), request: recorder.request });
  assert.equal(recorder.calls[0].path, '/api/molecules/import-jobs');
  assert.equal(recorder.calls.at(-1).path, '/api/molecules/import-jobs/job-1/finalize');
});


test('501 files send three sequential chunks of 250, 250, and 1', async () => {
  const recorder = successfulRequestRecorder({ totalFiles: 501 });
  await runMoleculeImport({ files: moleculeFiles(501), request: recorder.request });
  const batches = recorder.calls.filter((call) => call.path.endsWith('/batches'));
  assert.deepEqual(batches.map((call) => call.options.body.getAll('files').length), [250, 250, 1]);
  assert.ok(recorder.calls.every((call) => call.inFlight === 1));
});


test('acknowledged batches emit cumulative progress', async () => {
  const recorder = successfulRequestRecorder({ totalFiles: 501 });
  const progress = [];
  await runMoleculeImport({ files: moleculeFiles(501), request: recorder.request, onProgress: (value) => progress.push(value) });
  assert.deepEqual(progress.slice(0, 3).map((value) => [value.processedFiles, value.batchNumber, value.totalBatches]), [
    [250, 1, 3], [500, 2, 3], [501, 3, 3],
  ]);
  assert.equal(progress.at(-1).status, 'finalizing');
});


test('chunked workflow resolves to one finalized upload result', async () => {
  const recorder = successfulRequestRecorder({ totalFiles: 251 });
  const payload = await runMoleculeImport({ files: moleculeFiles(251), request: recorder.request });
  assert.equal(payload.upload_id, 'one-final-upload');
});


test('batch failure stops every later batch and finalize request', async () => {
  const recorder = successfulRequestRecorder({
    totalFiles: 501,
    request: async (path, options, calls) => {
      if (path === '/api/molecules/import-jobs') return { import_job_id: 'job-1' };
      if (path.endsWith('/batches') && Number(options.body.get('batch_index')) === 2) throw new Error('batch failed');
      if (path.endsWith('/batches')) return { processed_file_count: 250, parsed_record_count: 250 };
      return { upload_id: 'unexpected' };
    },
  });
  await assert.rejects(runMoleculeImport({ files: moleculeFiles(501), request: recorder.request }), /batch failed/);
  assert.deepEqual(recorder.calls.map((call) => call.path), [
    '/api/molecules/import-jobs',
    '/api/molecules/import-jobs/job-1/batches',
    '/api/molecules/import-jobs/job-1/batches',
  ]);
});


test('Offline transition stops the sequence before the next request', async () => {
  let online = true;
  const recorder = successfulRequestRecorder({ totalFiles: 501 });
  await assert.rejects(runMoleculeImport({
    files: moleculeFiles(501), request: recorder.request, isOnline: () => online,
    onProgress: () => { online = false; },
  }), /went Offline/);
  assert.equal(recorder.calls.filter((call) => call.path.endsWith('/batches')).length, 1);
});


test('failed new import preserves the previous finalized upload and pending files', () => {
  const previousUpload = { upload_id: 'previous' };
  const pending = moleculeFiles(2);
  const state = importFailureState({ upload: previousUpload, selectedFiles: pending, loading: true }, 'failed', null);
  assert.equal(state.upload, previousUpload);
  assert.equal(state.selectedFiles, pending);
  assert.equal(state.loading, false);
});


test('Cancel aborts before subsequent batches', async () => {
  const controller = new AbortController();
  const recorder = successfulRequestRecorder({ totalFiles: 501 });
  await assert.rejects(runMoleculeImport({
    files: moleculeFiles(501), request: recorder.request, signal: controller.signal,
    onProgress: () => controller.abort(),
  }), /Import cancelled/);
  assert.equal(recorder.calls.filter((call) => call.path.endsWith('/batches')).length, 1);
});


test('unsupported files are excluded before chunking', () => {
  const supported = moleculeFiles(251);
  const unsupported = new File(['x'], 'model.pkl');
  assert.equal(filesForMoleculeValidation([...supported, unsupported]).length, 251);
});


test('pending duplicate files remain deduplicated before chunking', () => {
  const file = moleculeFiles(1)[0];
  assert.equal(mergePendingMoleculeFiles([file], [file]).length, 1);
});


test('pasted SMILES is sent once at job creation and never in batch forms', async () => {
  const recorder = successfulRequestRecorder({ totalFiles: 251 });
  await runMoleculeImport({ files: moleculeFiles(251), smilesText: 'typed CCO', request: recorder.request });
  const createBody = JSON.parse(recorder.calls[0].options.body);
  assert.equal(createBody.smiles_text, 'typed CCO');
  for (const call of recorder.calls.filter((item) => item.path.endsWith('/batches'))) {
    assert.equal(call.options.body.has('smiles_text'), false);
  }
});
