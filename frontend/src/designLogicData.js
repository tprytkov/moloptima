export const DESIGN_LOGIC_LIMIT = 50;
export const RAW_CONTACT_PAGE_SIZE = 20;

export function availablePoseModes(rows = []) {
  const modes = new Set();
  for (const row of rows) {
    for (const pose of row?.docking_result?.modes || []) {
      const mode = Number(pose.mode);
      if (Number.isInteger(mode) && mode > 0) modes.add(mode);
    }
  }
  return [...modes].sort((left, right) => left - right);
}

export function firstDockedMoleculeId(rows = []) {
  return String(rows.find((row) => row?.docking_result?.status === 'success')?.molecule_id || '');
}

export function interactionStatusLabel(status) {
  return ({
    available: 'Available', not_analyzed: 'Not analyzed', runtime_unavailable: 'Runtime unavailable',
    runtime_timeout: 'Runtime timeout', runtime_failed: 'Runtime failed', incompatible: 'Incompatible',
    malformed: 'Malformed output', missing_pose: 'Missing pose', missing_template: 'Missing template',
    both_empty: 'Both fingerprints empty', unavailable_reference: 'Reference unavailable', valid: 'Available',
  })[status] || String(status || 'Unavailable').replaceAll('_', ' ');
}

export function scatterCoordinates(points = [], width = 700, height = 360, padding = 44) {
  return points.filter((point) => Number.isFinite(point.structural_similarity)
    && Number.isFinite(point.interaction_similarity)).map((point) => ({
    ...point,
    screenX: padding + point.structural_similarity * (width - padding * 2),
    screenY: height - padding - point.interaction_similarity * (height - padding * 2),
  }));
}

export function filterMatrixFeatures(features = [], filters = {}) {
  const type = String(filters.interactionType || 'all');
  const chain = String(filters.chain || 'all');
  const query = String(filters.residueQuery || '').trim().toLocaleLowerCase();
  return features.filter((token) => {
    const [tokenChain, , , interactionType] = token.split(':');
    return (type === 'all' || interactionType === type)
      && (chain === 'all' || tokenChain === chain)
      && (!query || token.toLocaleLowerCase().includes(query));
  });
}

export function interactionTypes(features = []) {
  return [...new Set(features.map((token) => token.split(':')[3]).filter(Boolean))].sort();
}

export function interactionChains(features = []) {
  return [...new Set(features.map((token) => token.split(':')[0]).filter(Boolean))].sort();
}

export function interactionClassSummary(fingerprint) {
  const counts = new Map();
  for (const token of fingerprint?.canonical_tokens || []) {
    const type = token.split(':')[3] || 'Unknown';
    counts.set(type, (counts.get(type) || 0) + 1);
  }
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
}

export function contactsForSelection(fingerprint, selectedToken = '') {
  const records = fingerprint?.raw_interaction_records || [];
  if (!selectedToken) return records;
  const [chain, residueName, residueNumber, interactionType, direction] = selectedToken.split(':');
  return records.filter((record) => {
    const receptor = record.receptor || {};
    return receptor.chain === chain
      && receptor.residue_name === residueName
      && `${receptor.residue_number || ''}${receptor.insertion_code || ''}` === residueNumber
      && record.interaction_type === interactionType
      && (!direction || record.direction === direction);
  });
}

export function pointTooltip(point) {
  return [
    point.display_name || point.molecule_id,
    `Mode ${point.mode}`,
    `Morgan Tanimoto ${formatMetric(point.structural_similarity)}`,
    `Interaction similarity ${formatMetric(point.interaction_similarity)}`,
    `Vina affinity ${formatMetric(point.vina_affinity_kcal_mol)} kcal/mol`,
    `${point.fingerprint?.unique_token_count ?? 0} unique tokens`,
    `Scaffold ${point.scaffold_id || 'unavailable'}`,
  ].join(' · ');
}

export function formatMetric(value, digits = 3) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—';
}
