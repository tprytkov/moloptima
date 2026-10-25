export const PRIORITIZATION_METHOD_LABELS = Object.freeze({
  legacy_v1: 'Standard Prioritization',
  v2: 'Multi-Parameter Prioritization',
  profile_v2: 'Multi-Parameter Prioritization',
});

export const PRIORITIZATION_METHOD_DESCRIPTIONS = Object.freeze({
  legacy_v1: 'Uses the established MolOptima ranking method without an additional multi-parameter prioritization profile.',
  v2: 'Uses a configurable prioritization profile to define how multiple scientific evidence domains contribute to compound ranking.',
  profile_v2: 'Uses a configurable prioritization profile to define how multiple scientific evidence domains contribute to compound ranking.',
});

export function prioritizationMethodLabel(method = 'legacy_v1') {
  return PRIORITIZATION_METHOD_LABELS[method] ?? 'Prioritization method unavailable';
}

export function prioritizationMethodDescription(method = 'legacy_v1') {
  return PRIORITIZATION_METHOD_DESCRIPTIONS[method]
    ?? 'The saved prioritization method is not recognized by this version of MolOptima.';
}
