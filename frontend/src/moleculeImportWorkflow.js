export const IMPORT_CHUNK_SIZE = 250;
export const SMALL_IMPORT_FILE_THRESHOLD = 250;

export function chunkMoleculeFiles(files, chunkSize = IMPORT_CHUNK_SIZE) {
  const chunks = [];
  for (let index = 0; index < files.length; index += chunkSize) {
    chunks.push(files.slice(index, index + chunkSize));
  }
  return chunks;
}

function assertImportCanContinue({ signal, isOnline }) {
  if (signal?.aborted) throw new DOMException('Import cancelled.', 'AbortError');
  if (!isOnline()) {
    throw new Error('The MolOptima backend went Offline during import. Retry from the beginning when it is Online.');
  }
}

export async function runMoleculeImport({
  files,
  smilesText = '',
  selectedStructureColumn = '',
  request,
  isOnline = () => true,
  signal,
  onJobCreated = () => {},
  onProgress = () => {},
}) {
  if (files.length <= SMALL_IMPORT_FILE_THRESHOLD) {
    assertImportCanContinue({ signal, isOnline });
    const formData = new FormData();
    formData.append('smiles_text', smilesText);
    formData.append('selected_structure_column', selectedStructureColumn);
    files.forEach((file) => formData.append('files', file));
    return request('/api/molecules/import', { method: 'POST', body: formData, signal });
  }

  assertImportCanContinue({ signal, isOnline });
  const job = await request('/api/molecules/import-jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      expected_file_count: files.length,
      smiles_text: smilesText,
      selected_structure_column: selectedStructureColumn,
    }),
    signal,
  });
  onJobCreated(job.import_job_id);

  const chunks = chunkMoleculeFiles(files);
  let parsedRecords = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    assertImportCanContinue({ signal, isOnline });
    const formData = new FormData();
    formData.append('batch_index', String(index + 1));
    chunks[index].forEach((file) => formData.append('files', file));
    const progress = await request(`/api/molecules/import-jobs/${job.import_job_id}/batches`, {
      method: 'POST', body: formData, signal,
    });
    parsedRecords = progress.parsed_record_count;
    onProgress({
      mode: 'chunked',
      status: 'running',
      processedFiles: progress.processed_file_count,
      totalFiles: files.length,
      parsedRecords,
      batchNumber: index + 1,
      totalBatches: chunks.length,
    });
  }

  assertImportCanContinue({ signal, isOnline });
  onProgress({
    mode: 'chunked', status: 'finalizing', processedFiles: files.length,
    totalFiles: files.length, parsedRecords, batchNumber: chunks.length,
    totalBatches: chunks.length,
  });
  return request(`/api/molecules/import-jobs/${job.import_job_id}/finalize`, {
    method: 'POST', signal,
  });
}

export async function cleanupMoleculeImportJob(importJobId, request) {
  if (!importJobId) return;
  try {
    await request(`/api/molecules/import-jobs/${importJobId}`, { method: 'DELETE' });
  } catch {
    // A backend outage can prevent immediate cleanup; persistent resume is not part of v1.
  }
}

export function importFailureState(current, message, progress) {
  return {
    ...current,
    loading: false,
    error: message,
    importProgress: progress ? { ...progress, status: 'failed' } : null,
  };
}
