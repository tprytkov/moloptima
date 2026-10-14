import { extractSvgInner, MAP_HEIGHT, MAP_WIDTH } from './interactionVisualization.js';

export const MAX_SELECTED_COMPARISONS = 5;

export function addComparison(ids = [], moleculeId, referenceId) {
  const id = String(moleculeId || '');
  if (!id || id === referenceId || ids.includes(id)) return ids;
  return ids.length >= MAX_SELECTED_COMPARISONS ? ids : [...ids, id];
}

export function removeComparison(ids = [], moleculeId) {
  return ids.filter((id) => id !== moleculeId);
}

export function selectedComparisonPoints(points = [], referenceId, comparisonIds = []) {
  const byId = new Map(points.map((point) => [point.molecule_id, point]));
  return [referenceId, ...comparisonIds].map((id) => byId.get(id)).filter(Boolean);
}

export function selectedSetMatrix(points = []) {
  const available = points.filter((point) => point.fingerprint_status === 'available');
  const features = [...new Set(available.flatMap((point) => point.fingerprint?.canonical_tokens || []))].sort();
  return {
    features,
    columns: available.map((point) => ({ molecule_id: point.molecule_id, mode: point.mode, present_tokens: point.fingerprint?.canonical_tokens || [] })),
    ordering: 'selected set only · binary canonical-token presence',
  };
}

export function selectedSetFrequency(points = []) {
  const available = points.filter((point) => point.fingerprint_status === 'available');
  const referenceTokens = new Set(available[0]?.fingerprint?.canonical_tokens || []);
  const counts = new Map();
  for (const point of available) {
    for (const token of new Set(point.fingerprint?.canonical_tokens || [])) counts.set(token, (counts.get(token) || 0) + 1);
  }
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([token, presentCount]) => {
    let category = 'Variable across selected set';
    if (presentCount === available.length) category = 'Present in all selected poses';
    else if (referenceTokens.has(token) && presentCount === 1) category = 'Reference only';
    else if (referenceTokens.has(token)) category = 'Reference + some comparisons';
    else if (presentCount === 1) category = 'Comparison-specific';
    return { token, presentCount, selectedPoseCount: available.length, category };
  });
}

export function scaffoldGroups(points = [], key, fallback) {
  const groups = new Map();
  for (const point of points) {
    const id = point.scaffold?.[key] || fallback;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(point.molecule_id);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([id, moleculeIds]) => ({ id, moleculeIds }));
}

export function scaffoldRelationshipLabel(point) {
  return point?.scaffold_relationship?.label || 'Unavailable';
}

export function sortComparisonPoints(points = [], key = 'molecule_id', direction = 'asc') {
  const factor = direction === 'desc' ? -1 : 1;
  return [...points].sort((left, right) => {
    const a = key === 'scaffold_relationship' ? scaffoldRelationshipLabel(left) : left[key];
    const b = key === 'scaffold_relationship' ? scaffoldRelationshipLabel(right) : right[key];
    if (a == null && b == null) return left.molecule_id.localeCompare(right.molecule_id);
    if (a == null) return 1;
    if (b == null) return -1;
    const comparison = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
    return comparison === 0 ? left.molecule_id.localeCompare(right.molecule_id) : comparison * factor;
  });
}

export function buildComparisonFigureSvg(panelSvgs = [], { transparent = false } = {}) {
  const columns = panelSvgs.length > 1 ? 2 : 1;
  const rows = Math.max(1, Math.ceil(panelSvgs.length / columns));
  const width = columns * MAP_WIDTH;
  const height = rows * MAP_HEIGHT;
  const background = transparent ? '' : `<rect width="${width}" height="${height}" fill="#ffffff"/>`;
  const panels = panelSvgs.map((svg, index) => {
    const x = (index % columns) * MAP_WIDTH;
    const y = Math.floor(index / columns) * MAP_HEIGHT;
    return `<g transform="translate(${x} ${y})">${extractSvgInner(svg)}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Selected-set protein–ligand interaction comparison">${background}${panels}</svg>`;
}
