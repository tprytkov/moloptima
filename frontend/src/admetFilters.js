import { ADMET_ENDPOINT_BY_KEY, ADMET_PROPERTY_TABLE_ENDPOINTS } from './admetAnalysisData.js';
import { ADMET_STATUS_PRESENTATION } from './admetStatus.js';

export const ADMET_NUMERIC_FILTER_ENDPOINTS = Object.freeze([
  'caco2_wang',
  'lipophilicity_astrazeneca',
  'solubility_aqsoldb',
  'ppbr_az',
  'vdss_lombardo',
]);

export const ADMET_CLASSIFICATION_FILTER_ENDPOINTS = Object.freeze(['gmc_mpnn_bbb']);
export const BBB_CLASSIFICATIONS = Object.freeze(['BBB+', 'BBB-']);

export const ADMET_FILTERABLE_STATUSES = Object.freeze([
  'available',
  'model_unavailable',
  'failed',
  'endpoint_not_returned',
  'not_run',
  'not_requested',
  'not_run_invalid_molecule',
]);

function emptyNumericFilters() {
  return Object.fromEntries(ADMET_NUMERIC_FILTER_ENDPOINTS.map((key) => [key, { min: '', max: '' }]));
}

function emptySelectionFilters(keys) {
  return Object.fromEntries(keys.map((key) => [key, []]));
}

export function createEmptyAdmetFilters() {
  return {
    numeric: emptyNumericFilters(),
    classifications: emptySelectionFilters(ADMET_CLASSIFICATION_FILTER_ENDPOINTS),
    statuses: emptySelectionFilters(ADMET_PROPERTY_TABLE_ENDPOINTS),
  };
}

export function parseNumericConstraint(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return { active: false, valid: true, value: null };
  }
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? { active: true, valid: true, value: parsed }
    : { active: false, valid: false, value: null };
}

export function numericFilterValidity(constraint = {}) {
  const min = parseNumericConstraint(constraint.min);
  const max = parseNumericConstraint(constraint.max);
  return {
    min,
    max,
    valid: min.valid && max.valid,
    rangeValid: !min.active || !max.active || min.value <= max.value,
  };
}

function matchesNumeric(property, constraint) {
  const { min, max, valid, rangeValid } = numericFilterValidity(constraint);
  if (!valid || !rangeValid) return true;
  if (!min.active && !max.active) return true;
  if (property?.status?.code !== 'available' || !Number.isFinite(property.value)) return false;
  if (min.active && property.value < min.value) return false;
  if (max.active && property.value > max.value) return false;
  return true;
}

function matchesSelected(value, selected) {
  return !selected?.length || selected.includes(value);
}

// Active constraints compose with AND semantics across endpoints and filter kinds.
// Multiple selections inside one classification/status constraint use OR semantics.
export function filterAdmetMolecules(molecules, filters) {
  const safeFilters = filters || createEmptyAdmetFilters();
  return molecules.filter((molecule) => {
    for (const key of ADMET_NUMERIC_FILTER_ENDPOINTS) {
      if (!matchesNumeric(molecule.properties?.[key], safeFilters.numeric?.[key])) return false;
    }
    for (const key of ADMET_CLASSIFICATION_FILTER_ENDPOINTS) {
      const selected = safeFilters.classifications?.[key] || [];
      const property = molecule.properties?.[key];
      if (selected.length && (property?.status?.code !== 'available' || !matchesSelected(property.classification, selected))) return false;
    }
    for (const key of ADMET_PROPERTY_TABLE_ENDPOINTS) {
      const selected = safeFilters.statuses?.[key] || [];
      if (!matchesSelected(molecule.properties?.[key]?.status?.code, selected)) return false;
    }
    return true;
  });
}

export function setNumericAdmetFilter(filters, endpointKey, bound, value) {
  return {
    ...filters,
    numeric: {
      ...filters.numeric,
      [endpointKey]: { ...filters.numeric[endpointKey], [bound]: value },
    },
  };
}

export function setAdmetFilterSelections(filters, kind, endpointKey, values) {
  const normalizedValues = Array.isArray(values) ? values : String(values || '').split(',').filter(Boolean);
  return {
    ...filters,
    [kind]: { ...filters[kind], [endpointKey]: [...normalizedValues] },
  };
}

export function clearAdmetFilter(filters, kind, endpointKey) {
  if (kind === 'numeric') {
    return {
      ...filters,
      numeric: { ...filters.numeric, [endpointKey]: { min: '', max: '' } },
    };
  }
  return setAdmetFilterSelections(filters, kind, endpointKey, []);
}

export function countActiveAdmetFilters(filters) {
  return activeAdmetFilterSummaries(filters).length;
}

function numericSummary(key, constraint) {
  const validity = numericFilterValidity(constraint);
  if (!validity.valid || !validity.rangeValid || (!validity.min.active && !validity.max.active)) return null;
  const label = ADMET_ENDPOINT_BY_KEY.get(key)?.label || key;
  if (validity.min.active && validity.max.active) return `${label}: ${validity.min.value}–${validity.max.value}`;
  if (validity.min.active) return `${label}: ≥ ${validity.min.value}`;
  return `${label}: ≤ ${validity.max.value}`;
}

export function activeAdmetFilterSummaries(filters) {
  const summaries = [];
  for (const key of ADMET_NUMERIC_FILTER_ENDPOINTS) {
    const label = numericSummary(key, filters?.numeric?.[key]);
    if (label) summaries.push({ id: `numeric:${key}`, kind: 'numeric', endpointKey: key, label });
  }
  for (const key of ADMET_CLASSIFICATION_FILTER_ENDPOINTS) {
    const selected = filters?.classifications?.[key] || [];
    if (selected.length) summaries.push({
      id: `classifications:${key}`,
      kind: 'classifications',
      endpointKey: key,
      label: `${ADMET_ENDPOINT_BY_KEY.get(key)?.label || key}: ${selected.join(' or ')}`,
    });
  }
  for (const key of ADMET_PROPERTY_TABLE_ENDPOINTS) {
    const selected = filters?.statuses?.[key] || [];
    if (selected.length) summaries.push({
      id: `statuses:${key}`,
      kind: 'statuses',
      endpointKey: key,
      label: `${ADMET_ENDPOINT_BY_KEY.get(key)?.label || key} status: ${selected.map((code) => ADMET_STATUS_PRESENTATION[code]?.label || code).join(' or ')}`,
    });
  }
  return summaries;
}

export function admetTableStateReducer(state, action) {
  if (action.type === 'set-query') return { ...state, query: action.query, page: 0 };
  if (action.type === 'set-filters') return { ...state, filters: action.filters, page: 0 };
  if (action.type === 'set-page-size') return { ...state, pageSize: action.pageSize, page: 0 };
  if (action.type === 'set-page') return { ...state, page: action.page };
  if (action.type === 'set-sort') {
    const direction = state.sortKey === action.sortKey && state.sortDirection === 'asc' ? 'desc' : 'asc';
    return { ...state, sortKey: action.sortKey, sortDirection: direction, page: 0 };
  }
  return state;
}
