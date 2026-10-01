import { ADMET_ENDPOINT_REGISTRY } from './admetAnalysisData.js';

export const MAX_ADMET_COMPARISON_MOLECULES = 5;
export const ADMET_COMPARISON_PICKER_LIMIT = 30;

export function addAdmetComparisonId(ids = [], moleculeId, maximum = MAX_ADMET_COMPARISON_MOLECULES) {
  const normalizedId = String(moleculeId || '');
  if (!normalizedId || ids.includes(normalizedId) || ids.length >= maximum) return [...ids];
  return [...ids, normalizedId];
}

export function removeAdmetComparisonId(ids = [], moleculeId) {
  return ids.filter((id) => id !== moleculeId);
}

export function clearAdmetComparison() {
  return [];
}

export function resolveAdmetComparisonMolecules(molecules = [], ids = []) {
  const byId = new Map(molecules.map((molecule) => [molecule.moleculeId, molecule]));
  return ids.map((id) => ({ moleculeId: id, molecule: byId.get(id) || null }));
}

export function searchAdmetComparisonCandidates(molecules = [], query = '', selectedIds = [], limit = ADMET_COMPARISON_PICKER_LIMIT) {
  const normalizedQuery = String(query || '').trim().toLocaleLowerCase();
  const selected = new Set(selectedIds);
  const matches = [];
  if (!normalizedQuery) return matches;
  for (const molecule of molecules) {
    if (selected.has(molecule.moleculeId)) continue;
    const isMatch = [molecule.displayName, molecule.moleculeId, molecule.canonicalSmiles, molecule.sourceName]
      .some((value) => String(value || '').toLocaleLowerCase().includes(normalizedQuery));
    if (isMatch) matches.push(molecule);
    if (matches.length >= limit) break;
  }
  return matches;
}

export function describeNumericComparison(molecules = [], endpointKey) {
  const values = [];
  for (const molecule of molecules) {
    const property = molecule?.properties?.[endpointKey];
    if (property?.status?.code === 'available' && Number.isFinite(property.value)) values.push(property.value);
  }
  if (!values.length) return { count: 0, lowest: null, highest: null, range: null, equal: false };
  let lowest = values[0];
  let highest = values[0];
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] < lowest) lowest = values[index];
    if (values[index] > highest) highest = values[index];
  }
  return { count: values.length, lowest, highest, range: highest - lowest, equal: values.length > 1 && lowest === highest };
}

export function classificationsDiffer(molecules = [], endpointKey) {
  const classifications = new Set();
  for (const molecule of molecules) {
    const property = molecule?.properties?.[endpointKey];
    if (property?.status?.code === 'available' && property.classification) classifications.add(property.classification);
  }
  return classifications.size > 1;
}

export function buildAdmetComparisonRows(molecules = []) {
  return ADMET_ENDPOINT_REGISTRY.map((endpoint) => {
    const numericSummary = endpoint.valueType === 'regression'
      ? describeNumericComparison(molecules, endpoint.key)
      : null;
    return {
      endpoint,
      properties: molecules.map((molecule) => molecule.properties?.[endpoint.key] || null),
      numericSummary,
      classificationDifferent: endpoint.valueType !== 'regression' && classificationsDiffer(molecules, endpoint.key),
    };
  });
}

export function comparisonVisibility(ids = [], filteredMolecules = []) {
  const visible = new Set(filteredMolecules.map((molecule) => molecule.moleculeId));
  return Object.fromEntries(ids.map((id) => [id, visible.has(id)]));
}
