import { extractSvgInner, resolveExportDimensions } from './interactionVisualization.js';

export const PHARMACOPHORE_MAP_WIDTH = 700;
export const PHARMACOPHORE_MAP_HEIGHT = 430;
export const PHARMACOPHORE_STYLES = Object.freeze({
  HBA: { color: '#2374a6', symbol: 'A', label: 'HBA', shape: 'circle' },
  HBD: { color: '#168070', symbol: 'D', label: 'HBD', shape: 'diamond' },
  AROMATIC: { color: '#7753a5', symbol: 'π', label: 'Aromatic', shape: 'hexagon' },
  HYDROPHOBIC: { color: '#9a6b22', symbol: 'H', label: 'Hydrophobic', shape: 'square' },
  POSITIVE_IONIZABLE: { color: '#9b4f82', symbol: '+', label: 'Positive ionizable', shape: 'double-circle' },
  NEGATIVE_IONIZABLE: { color: '#b14d4d', symbol: '−', label: 'Negative ionizable', shape: 'double-circle' },
});

function escapeXml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]);
}

export function featureStatusMaps(comparison = {}) {
  const reference = new Map();
  const candidate = new Map();
  for (const match of comparison.matches || []) {
    reference.set(match.reference_feature_id, { status: 'matched', match });
    candidate.set(match.comparison_feature_id, { status: 'matched', match });
  }
  for (const feature of comparison.reference_only_features || []) {
    reference.set(feature.feature_id, { status: 'reference_only', match: null });
  }
  for (const feature of comparison.comparison_only_features || []) {
    candidate.set(feature.feature_id, { status: 'comparison_only', match: null });
  }
  return { reference, comparison: candidate };
}

export function selectedFeatureIds(selectedFeatureId = '', comparison = {}) {
  const selected = new Set(selectedFeatureId ? [selectedFeatureId] : []);
  for (const match of comparison.matches || []) {
    if (match.reference_feature_id === selectedFeatureId || match.comparison_feature_id === selectedFeatureId) {
      selected.add(match.reference_feature_id); selected.add(match.comparison_feature_id);
    }
  }
  return selected;
}

function markerShape(style, x, y, selected, role) {
  const radius = selected ? 14 : 11;
  const fill = role === 'reference' ? '#ffffff' : style.color;
  const text = role === 'reference' ? style.color : '#ffffff';
  const common = `stroke="${style.color}" stroke-width="${selected ? 4 : role === 'reference' ? 3 : 2}" fill="${fill}"`;
  let shape;
  if (style.shape === 'diamond') shape = `<path d="M ${x} ${y - radius} L ${x + radius} ${y} L ${x} ${y + radius} L ${x - radius} ${y} Z" ${common}/>`;
  else if (style.shape === 'square') shape = `<rect x="${x - radius}" y="${y - radius}" width="${2 * radius}" height="${2 * radius}" rx="3" ${common}/>`;
  else if (style.shape === 'hexagon') shape = `<path d="M ${x - radius} ${y} L ${x - radius / 2} ${y - radius * 0.86} L ${x + radius / 2} ${y - radius * 0.86} L ${x + radius} ${y} L ${x + radius / 2} ${y + radius * 0.86} L ${x - radius / 2} ${y + radius * 0.86} Z" ${common}/>`;
  else shape = `<circle cx="${x}" cy="${y}" r="${radius}" ${common}/>${style.shape === 'double-circle' ? `<circle cx="${x}" cy="${y}" r="${radius - 4}" fill="none" stroke="${role === 'reference' ? style.color : '#fff'}" stroke-width="1.5"/>` : ''}`;
  return `${shape}<text x="${x}" y="${y + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="${text}">${escapeXml(style.symbol)}</text>`;
}

function deterministicOffset(featureId, ordinal) {
  let hash = 2166136261;
  for (const character of String(featureId)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  const angle = (((hash >>> 0) % 360) + ordinal * 29) * Math.PI / 180;
  return { x: Math.cos(angle) * 30, y: Math.sin(angle) * 30 };
}

export function mapFeatureAnnotations(features = [], atomPositions = [], role = 'reference', comparison = {}) {
  const atoms = new Map(atomPositions.map((atom) => [Number(atom.atom_index), atom]));
  const statuses = featureStatusMaps(comparison)[role];
  return features.map((feature, ordinal) => {
    const participating = (feature.template_atom_indices || []).map((index) => atoms.get(Number(index))).filter(Boolean);
    if (!participating.length) return { feature, status: statuses.get(feature.feature_id)?.status || `${role}_only`, unavailable: true };
    const anchor = participating.reduce((sum, atom) => ({ x: sum.x + atom.x, y: sum.y + atom.y }), { x: 0, y: 0 });
    anchor.x /= participating.length; anchor.y /= participating.length;
    const offset = deterministicOffset(feature.feature_id, ordinal);
    return {
      feature,
      status: statuses.get(feature.feature_id)?.status || `${role}_only`,
      match: statuses.get(feature.feature_id)?.match || null,
      anchor,
      marker: { x: anchor.x + offset.x, y: anchor.y + offset.y },
      unavailable: false,
    };
  });
}

export function buildPharmacophoreMapSvg({
  depiction, featureSet, role = 'reference', comparison = {}, selectedFeatureId = '',
  moleculeId = '', mode = 1, threshold = 1.5, includeTitle = true, includeLegend = true,
  transparent = false,
}) {
  if (!depiction) return '';
  const annotations = mapFeatureAnnotations(featureSet?.features || [], depiction.atom_positions || [], role, comparison);
  const selectedIds = selectedFeatureIds(selectedFeatureId, comparison);
  const ligandX = (PHARMACOPHORE_MAP_WIDTH - depiction.width) / 2;
  const ligandY = 72;
  const background = transparent ? '' : `<rect width="100%" height="100%" fill="#fff"/>`;
  const title = includeTitle ? `<text x="22" y="27" class="title">Pose-specific pharmacophore · ${escapeXml(role === 'reference' ? 'Reference' : 'Comparison')}</text><text x="22" y="47" class="subtitle">${escapeXml(moleculeId)} · Vina Mode ${escapeXml(mode)} · Comparison threshold: ${Number(threshold).toFixed(2)} Å</text>` : '';
  const markers = annotations.map((item) => {
    if (item.unavailable) return '';
    const style = PHARMACOPHORE_STYLES[item.feature.canonical_class] || PHARMACOPHORE_STYLES.HYDROPHOBIC;
    const anchorX = ligandX + item.anchor.x;
    const anchorY = ligandY + item.anchor.y;
    const markerX = ligandX + item.marker.x;
    const markerY = ligandY + item.marker.y;
    const selected = selectedIds.has(item.feature.feature_id);
    const dash = item.status === 'matched' ? '' : 'stroke-dasharray="3 3"';
    return `<g data-feature-id="${escapeXml(item.feature.feature_id)}" role="button" tabindex="0" aria-label="${escapeXml(style.label)}, ${escapeXml(item.status.replaceAll('_', ' '))}, feature ${escapeXml(item.feature.feature_id)}"><line x1="${anchorX.toFixed(2)}" y1="${anchorY.toFixed(2)}" x2="${markerX.toFixed(2)}" y2="${markerY.toFixed(2)}" stroke="${style.color}" stroke-width="${selected ? 3 : 1.5}" ${dash}/>${markerShape(style, markerX, markerY, selected, role)}<text x="${markerX.toFixed(2)}" y="${(markerY + 25).toFixed(2)}" text-anchor="middle" class="feature-label">${escapeXml(style.label)} · ${escapeXml(item.status === 'matched' ? 'Matched' : role === 'reference' ? 'Reference only' : 'Comparison only')}</text></g>`;
  }).join('');
  const legend = includeLegend ? Object.values(PHARMACOPHORE_STYLES).map((style, index) => `<g transform="translate(${20 + (index % 3) * 220} ${385 + Math.floor(index / 3) * 22})">${markerShape(style, 10, 0, false, 'comparison')}<text x="28" y="4" class="legend">${escapeXml(style.label)}</text></g>`).join('') : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PHARMACOPHORE_MAP_WIDTH}" height="${PHARMACOPHORE_MAP_HEIGHT}" viewBox="0 0 ${PHARMACOPHORE_MAP_WIDTH} ${PHARMACOPHORE_MAP_HEIGHT}" role="img" aria-label="2D pharmacophore feature map for ${escapeXml(moleculeId)}, Vina mode ${escapeXml(mode)}"><style>.title{font:700 16px Arial;fill:#20262e}.subtitle,.legend{font:11px Arial;fill:#52616c}.feature-label{font:10px Arial;fill:#384653}.ligand *{vector-effect:non-scaling-stroke}</style>${background}${title}<g class="ligand" transform="translate(${ligandX} ${ligandY})">${extractSvgInner(depiction.svg)}</g>${markers}${legend}</svg>`;
}

export function pharmacophoreExportDimensions(width = 3840) {
  return resolveExportDimensions(width, PHARMACOPHORE_MAP_WIDTH / PHARMACOPHORE_MAP_HEIGHT);
}
