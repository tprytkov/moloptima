export const RESTORABLE_JOB_STATUSES = new Set(['queued', 'running']);

export function isRestorableJob(job) {
  return RESTORABLE_JOB_STATUSES.has(String(job?.status || '').toLowerCase());
}

export function startupActiveRun(job) {
  if (!isRestorableJob(job)) return null;
  return { job, result: null, loading: true, error: '' };
}

export function openedActiveRun(job, result) {
  return { job, result, loading: false, error: '' };
}

export function newCalculationState(historyJobs) {
  return {
    activeRun: { job: null, result: null, loading: false, error: '' },
    upload: null,
    annotations: { jobId: '', annotations: {}, loading: false, saving: false, error: '', updatedAt: null },
    selectedHistoryJobId: '',
    historyJobs,
  };
}

export function activeCalculationKey(activeRun, upload) {
  return activeRun?.job?.job_id || upload?.upload_id || 'no-active-calculation';
}

export function activeUploadContext(existingUpload, activeRun) {
  const uploadId = activeRun?.job?.upload_id || activeRun?.result?.upload_id || '';
  if (!uploadId) return existingUpload || null;
  if (existingUpload?.upload_id === uploadId) return existingUpload;

  const rows = activeRun?.result?.results || [];
  const rowCount = Number(activeRun?.result?.row_count ?? activeRun?.job?.row_count ?? rows.length);
  const validCount = rows.length
    ? rows.filter((row) => row?.valid_molecule === true || String(row?.valid_molecule).toLowerCase() === 'true').length
    : rowCount;
  return {
    upload_id: uploadId,
    analysis_mode: activeRun?.result?.analysis_mode || activeRun?.job?.analysis_mode || 'library',
    submitted_count: rowCount,
    valid_count: validCount,
    row_count: rowCount,
    restored_from_job: true,
  };
}

export function isCurrentActiveRequest(requestId, currentRequestId) {
  return requestId === currentRequestId;
}
