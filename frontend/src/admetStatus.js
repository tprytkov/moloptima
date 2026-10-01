const AVAILABLE_STATUSES = new Set(['available', 'completed', 'model_available', 'success']);
const UNAVAILABLE_STATUSES = new Set(['incompatible', 'model_unavailable', 'unavailable']);
const NOT_REQUESTED_STATUSES = new Set(['not_requested']);
const FAILED_STATUSES = new Set(['error', 'failed', 'inference_failed']);
const RUNNING_STATUSES = new Set(['checking', 'pending', 'queued', 'running']);

export const ADMET_STATUS_PRESENTATION = {
  available: { code: 'available', label: 'Results available', color: 'success' },
  partial: { code: 'partial', label: 'Partial results', color: 'warning' },
  model_unavailable: { code: 'model_unavailable', label: 'Model unavailable', color: 'warning' },
  not_requested: { code: 'not_requested', label: 'Not requested', color: 'default' },
  not_run_invalid_molecule: { code: 'not_run_invalid_molecule', label: 'Not run — invalid molecule', color: 'default' },
  failed: { code: 'failed', label: 'Failed', color: 'error' },
  running: { code: 'running', label: 'Running', color: 'info' },
  not_run: { code: 'not_run', label: 'Not run', color: 'default' },
  endpoint_not_returned: { code: 'endpoint_not_returned', label: 'Endpoint not returned', color: 'default' },
};

function hasObjectValues(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
}

export function normalizeAdmetStatus(value, hasResult = false) {
  const normalized = String(value || '').trim().toLowerCase();
  if (AVAILABLE_STATUSES.has(normalized)) return ADMET_STATUS_PRESENTATION.available;
  if (UNAVAILABLE_STATUSES.has(normalized)) return ADMET_STATUS_PRESENTATION.model_unavailable;
  if (NOT_REQUESTED_STATUSES.has(normalized)) return ADMET_STATUS_PRESENTATION.not_requested;
  if (normalized === 'not_run_invalid_molecule') return ADMET_STATUS_PRESENTATION.not_run_invalid_molecule;
  if (FAILED_STATUSES.has(normalized)) return ADMET_STATUS_PRESENTATION.failed;
  if (RUNNING_STATUSES.has(normalized)) return ADMET_STATUS_PRESENTATION.running;
  return hasResult ? ADMET_STATUS_PRESENTATION.available : ADMET_STATUS_PRESENTATION.not_run;
}

export function deriveAdmetFamilyStatuses(compound) {
  const row = compound ?? {};
  const familyStatus = hasObjectValues(row.admet_family_status) ? row.admet_family_status : {};
  const predictions = hasObjectValues(row.admet_predictions) ? row.admet_predictions : {};
  const bbbResult = hasObjectValues(row.bbb_result) ? row.bbb_result : {};
  const regression = hasObjectValues(row.admet_regression) ? row.admet_regression : {};
  return {
    chemberta: normalizeAdmetStatus(
      familyStatus.chemberta ?? familyStatus.chemberta_classification ?? row.admet_model_status,
      Object.keys(predictions).length > 0,
    ),
    gmc_mpnn_bbb: normalizeAdmetStatus(
      familyStatus.gmc_mpnn_bbb ?? familyStatus.gmc_bbb ?? bbbResult.status,
      bbbResult.ensemble_probability !== undefined || bbbResult.raw_classification !== undefined,
    ),
    chemprop_regression: normalizeAdmetStatus(
      familyStatus.chemprop_regression ?? regression.status,
      hasObjectValues(regression.endpoints),
    ),
  };
}

export function aggregateAdmetFamilyStatus(rows, family, loading = false) {
  if (!rows?.length) return loading ? ADMET_STATUS_PRESENTATION.running : ADMET_STATUS_PRESENTATION.not_run;
  const codes = rows.map((row) => deriveAdmetFamilyStatuses(row)[family].code);
  if (codes.every((code) => code === 'available')) return ADMET_STATUS_PRESENTATION.available;
  if (codes.includes('available')) return ADMET_STATUS_PRESENTATION.partial;
  if (codes.includes('running')) return ADMET_STATUS_PRESENTATION.running;
  if (codes.includes('failed')) return ADMET_STATUS_PRESENTATION.failed;
  if (codes.every((code) => code === 'model_unavailable')) return ADMET_STATUS_PRESENTATION.model_unavailable;
  if (codes.every((code) => code === 'not_requested')) return ADMET_STATUS_PRESENTATION.not_requested;
  if (codes.every((code) => ['not_requested', 'not_run_invalid_molecule', 'not_run'].includes(code))) {
    return ADMET_STATUS_PRESENTATION.not_run;
  }
  return ADMET_STATUS_PRESENTATION.model_unavailable;
}
