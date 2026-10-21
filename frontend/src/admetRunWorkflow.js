export const ADMET_PANEL_ID = 'full_frozen_panel';

export const ADMET_TERMINAL_STATUSES = new Set([
  'completed',
  'completed_with_warnings',
  'failed',
  'cancelled',
]);

export const EMPTY_INDEPENDENT_ADMET_STATE = Object.freeze({
  uploadId: '',
  run: null,
  result: null,
  loading: false,
  error: '',
  errorPhase: '',
});

const STATUS_LABELS = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  completed_with_warnings: 'Completed with warnings',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export class AdmetRunWorkflowError extends Error {
  constructor(phase, cause) {
    super(cause instanceof Error ? cause.message : String(cause || 'Request failed.'));
    this.name = 'AdmetRunWorkflowError';
    this.phase = phase;
    this.cause = cause;
  }
}

export function admetRunStatusLabel(status) {
  return STATUS_LABELS[String(status || '').toLowerCase()] || 'Not run';
}

export function canRunIndependentAdmet(upload) {
  return Boolean(upload?.upload_id) && Number(upload?.valid_count || 0) > 0;
}

function matchingIdentity(payload, run, uploadId) {
  if (!payload || !run || !uploadId) return false;
  return payload.run_id === run.run_id
    && payload.upload_id === uploadId
    && run.upload_id === uploadId
    && Boolean(payload.molecule_collection_sha256)
    && payload.molecule_collection_sha256 === run.molecule_collection_sha256;
}

export function selectAdmetResultSource({ independentState, upload, prioritizationState }) {
  const uploadId = upload?.upload_id || '';
  const independentRun = independentState?.run;
  const independentIsCurrent = Boolean(uploadId)
    && independentState?.uploadId === uploadId
    && (!independentRun || independentRun.upload_id === uploadId)
    && (independentState?.loading || independentRun);

  if (independentIsCurrent) {
    const result = independentState?.result;
    const usableResult = matchingIdentity(result, independentRun, uploadId);
    return {
      kind: usableResult ? 'independent' : 'independent_current',
      label: 'Independent ADMET run',
      rows: usableResult ? result.results || [] : [],
      runtimeIdentities: usableResult
        ? result.admet_runtime_identities || []
        : independentRun?.admet_runtime_identities || [],
      run: independentRun,
      result: usableResult ? result : null,
    };
  }

  const historicalJob = prioritizationState?.job;
  const historicalResult = prioritizationState?.result;
  const historicalUploadId = historicalResult?.upload_id || historicalJob?.upload_id || '';
  if (historicalJob?.job_id && historicalResult && uploadId && historicalUploadId === uploadId) {
    return {
      kind: 'prioritization',
      label: 'Prioritization job ADMET result',
      rows: historicalResult.results || [],
      runtimeIdentities: historicalJob.admet_runtime_identities
        || historicalResult.admet_runtime_identities
        || [],
      run: historicalJob,
      result: historicalResult,
    };
  }

  return {
    kind: 'none', label: 'No ADMET result', rows: [], runtimeIdentities: [], run: null, result: null,
  };
}

function assertRunIdentity(payload, run, uploadId, phase) {
  if (!matchingIdentity(payload, run, uploadId)) {
    throw new AdmetRunWorkflowError(phase, new Error('ADMET run identity does not match the active molecule collection.'));
  }
}

function defaultWait(milliseconds) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

export async function executeIndependentAdmetRun({
  uploadId,
  request,
  onStatus = () => {},
  isCurrent = () => true,
  intervalMs = 1000,
  wait = defaultWait,
}) {
  let run;
  try {
    run = await request('/api/admet/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ upload_id: uploadId, panel: ADMET_PANEL_ID }),
    });
  } catch (error) {
    throw new AdmetRunWorkflowError('submission', error);
  }
  if (!isCurrent()) return { stale: true, run: null, result: null };
  if (run?.upload_id !== uploadId || !run?.run_id || !run?.molecule_collection_sha256) {
    throw new AdmetRunWorkflowError('submission', new Error('ADMET submission returned an invalid run identity.'));
  }
  onStatus(run);

  while (!ADMET_TERMINAL_STATUSES.has(run.status)) {
    await wait(intervalMs);
    if (!isCurrent()) return { stale: true, run: null, result: null };
    try {
      const next = await request(`/api/admet/runs/${run.run_id}`);
      if (!isCurrent()) return { stale: true, run: null, result: null };
      assertRunIdentity(next, run, uploadId, 'polling');
      run = next;
      onStatus(run);
    } catch (error) {
      if (error instanceof AdmetRunWorkflowError) throw error;
      throw new AdmetRunWorkflowError('polling', error);
    }
  }

  if (!['completed', 'completed_with_warnings'].includes(run.status)) {
    return { stale: false, run, result: null };
  }

  let result;
  try {
    result = await request(`/api/admet/runs/${run.run_id}/result`);
  } catch (error) {
    throw new AdmetRunWorkflowError('result_retrieval', error);
  }
  if (!isCurrent()) return { stale: true, run: null, result: null };
  assertRunIdentity(result, run, uploadId, 'result_retrieval');
  return { stale: false, run, result };
}

export async function cancelQueuedAdmetRun({ run, request }) {
  if (!run?.run_id || run.status !== 'queued') {
    return { restricted: run?.status === 'running', run };
  }
  const cancelled = await request(`/api/admet/runs/${run.run_id}/cancel`, { method: 'POST' });
  assertRunIdentity(cancelled, run, run.upload_id, 'cancellation');
  return { restricted: false, run: cancelled };
}
