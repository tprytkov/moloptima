const SCIENTIFIC_VALUE_LABELS = {
  not_requested: 'Not requested',
  not_used: 'Not used',
  not_run: 'Not run',
  not_provided: 'Not provided',
  not_run_invalid_molecule: 'Not run — invalid molecule',
  unavailable: 'Unavailable',
  model_unavailable: 'Model unavailable',
  model_available: 'Model available',
  available: 'Available',
  checking: 'Checking',
  completed: 'Completed',
  failed: 'Failed',
  success: 'Successful',
  incompatible: 'Incompatible',
  error: 'Error',
  valid: 'Valid',
  invalid: 'Invalid',
  lookup_failed: 'Lookup failed',
  exact_match: 'Exact match',
  no_exact_match: 'No exact match',
  similarity_match: 'Similarity match',
  match_found: 'Match found',
  no_match: 'No match',
  closest_match_found: 'Closest match found',
  fresh_lookup: 'Fresh lookup',
  cache_hit: 'Cache hit',
  cache_miss: 'Cache miss',
  local_reference: 'Local reference',
  local_curated: 'Local curated reference',
  local: 'Local reference',
  user_supplied_pdbqt: 'User-supplied PDBQT',
  moloptima_prepared: 'Prepared by MolOptima',
  completed_with_warnings: 'Completed with warnings',
  heuristic_synthetic_accessibility: 'Heuristic synthetic accessibility',
};

const RUNTIME_SOURCE_LABELS = {
  application_process: 'Current application process',
  application_process_and_isolated_repair_runtime: 'Application process and isolated repair runtime',
  packaged: 'Packaged scientific runtime',
  explicit_override: 'Explicit runtime override',
  pending: 'Qualification pending',
  unavailable: 'Unavailable',
  test: 'Test runtime',
};

function humanizeIdentifier(value) {
  const text = String(value ?? '').trim();
  if (!text) return 'Not available';
  const words = text.replace(/[_-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function formatScientificPresentationValue(value) {
  if (value === null || value === undefined || value === '') return 'Not available';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return SCIENTIFIC_VALUE_LABELS[value] ?? String(value);
}

export function formatRuntimeSource(value) {
  if (value === null || value === undefined || value === '') return 'Not available';
  return RUNTIME_SOURCE_LABELS[value] ?? humanizeIdentifier(value);
}
