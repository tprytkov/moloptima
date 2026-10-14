export const MAP_WIDTH = 760;
export const MAP_HEIGHT = 520;
export const LIGAND_OFFSET = { x: 170, y: 110 };

export const INTERACTION_STYLES = Object.freeze({
  Hydrophobic: { color: '#9a6b22', dash: '2 7', width: 3, marker: '●', label: 'Hydrophobic' },
  HBDonor: { color: '#236fa1', dash: '9 5', width: 3, marker: 'D', label: 'H-bond · ligand donor' },
  HBAcceptor: { color: '#236fa1', dash: '9 5', width: 3, marker: 'A', label: 'H-bond · ligand acceptor' },
  PiStacking: { color: '#7653a6', dash: '13 4 3 4', width: 3, marker: 'π', label: 'π stacking' },
  Anionic: { color: '#b14646', dash: '1 5', width: 4, marker: '−', label: 'Anionic' },
  Cationic: { color: '#2d6f9f', dash: '1 5', width: 4, marker: '+', label: 'Cationic' },
  CationPi: { color: '#8b4f91', dash: '10 3 2 3', width: 3, marker: '+π', label: 'Cation–π' },
  PiCation: { color: '#8b4f91', dash: '10 3 2 3', width: 3, marker: 'π+', label: 'π–cation' },
  VdWContact: { color: '#68757f', dash: '3 5', width: 1.5, marker: '·', label: 'van der Waals' },
});

export function canonicalInteractionToken(record = {}) {
  const receptor = record.receptor || {};
  const residue = `${receptor.residue_number ?? ''}${receptor.insertion_code || ''}`;
  return [receptor.chain || '_', receptor.residue_name || 'UNK', residue, record.interaction_type || 'Unknown']
    .concat(record.direction ? [record.direction] : []).join(':');
}

export function mapInteractionRecords(records = [], atomPositions = []) {
  const atomByIndex = new Map(atomPositions.map((atom) => [Number(atom.atom_index), atom]));
  const grouped = new Map();
  for (const record of records) {
    const token = canonicalInteractionToken(record);
    if (!grouped.has(token)) grouped.set(token, { token, records: [], ligandAtoms: [], receptorAtoms: [] });
    const entry = grouped.get(token);
    entry.records.push(record);
    for (const index of record.ligand?.template_atom_indices || []) {
      const atom = atomByIndex.get(Number(index));
      if (atom && !entry.ligandAtoms.some((item) => item.atom_index === atom.atom_index)) entry.ligandAtoms.push(atom);
    }
    for (const atom of record.receptor?.atoms || []) {
      if (!entry.receptorAtoms.some((item) => item.atom_serial === atom.atom_serial)) entry.receptorAtoms.push(atom);
    }
  }
  return [...grouped.values()].sort((left, right) => left.token.localeCompare(right.token));
}

function tokenAngle(token) {
  let hash = 2166136261;
  for (const character of token) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return ((hash >>> 0) % 360) * Math.PI / 180;
}

export function preferredResidueDirection(interaction, center = { x: 210, y: 150 }) {
  if (interaction.ligandAtoms?.length) {
    const mean = interaction.ligandAtoms.reduce((sum, atom) => ({ x: sum.x + atom.x, y: sum.y + atom.y }), { x: 0, y: 0 });
    mean.x /= interaction.ligandAtoms.length; mean.y /= interaction.ligandAtoms.length;
    const magnitude = Math.hypot(mean.x - center.x, mean.y - center.y);
    if (magnitude > 0.001) return { x: (mean.x - center.x) / magnitude, y: (mean.y - center.y) / magnitude };
  }
  const angle = tokenAngle(interaction.token);
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function overlaps(candidate, placed) {
  return placed.some((item) => Math.abs(candidate.x - item.x) < 146 && Math.abs(candidate.y - item.y) < 58);
}

export function layoutInteractionMap(interactions = [], depiction = { width: 420, height: 300 }, positionHints = {}) {
  const center = { x: depiction.width / 2, y: depiction.height / 2 };
  const placed = [];
  const radiusX = 315;
  const radiusY = 215;
  for (const interaction of interactions) {
    if (!interaction.ligandAtoms?.length) continue;
    const hinted = positionHints[interaction.token];
    const direction = preferredResidueDirection(interaction, center);
    const base = Math.atan2(direction.y, direction.x);
    let candidate;
    const offsets = [0, 0.22, -0.22, 0.44, -0.44, 0.66, -0.66, 0.88, -0.88, 1.1, -1.1];
    if (hinted) candidate = { ...interaction, x: hinted.x, y: hinted.y };
    for (const offset of hinted && !overlaps(candidate, placed) ? [] : offsets) {
      const angle = base + offset;
      candidate = {
        ...interaction,
        x: MAP_WIDTH / 2 + Math.cos(angle) * radiusX,
        y: MAP_HEIGHT / 2 + Math.sin(angle) * radiusY,
      };
      if (!overlaps(candidate, placed)) break;
    }
    const anchor = interaction.ligandAtoms.reduce((sum, atom) => ({ x: sum.x + atom.x, y: sum.y + atom.y }), { x: 0, y: 0 });
    candidate.anchor = {
      x: LIGAND_OFFSET.x + anchor.x / interaction.ligandAtoms.length,
      y: LIGAND_OFFSET.y + anchor.y / interaction.ligandAtoms.length,
    };
    candidate.x = Math.max(76, Math.min(MAP_WIDTH - 76, candidate.x));
    candidate.y = Math.max(54, Math.min(MAP_HEIGHT - 76, candidate.y));
    placed.push(candidate);
  }
  return placed;
}

export function extractSvgInner(svg = '') {
  const match = String(svg).match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
  return match ? match[1] : '';
}

function escapeXml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]);
}

export function interactionDisplayLabel(interaction) {
  const record = interaction.records[0] || {};
  const receptor = record.receptor || {};
  return `${receptor.chain || '_'}:${receptor.residue_name || 'UNK'}${receptor.residue_number ?? ''}${receptor.insertion_code || ''}`;
}

export function buildInteractionMapSvg({
  depiction, interactions, selectedToken = '', moleculeId = '', mode = 1, receptorId = '',
  contextLabel = '',
  includeTitle = true, includeLegend = true, includeDistances = true, transparent = false,
  residuePositionHints = {},
}) {
  const placed = layoutInteractionMap(interactions, depiction, residuePositionHints);
  const background = transparent ? '' : `<rect width="${MAP_WIDTH}" height="${MAP_HEIGHT}" fill="#ffffff"/>`;
  const title = includeTitle ? `<text x="24" y="30" class="map-title">Predicted protein–ligand interactions</text><text x="24" y="50" class="map-subtitle">${escapeXml(moleculeId)} · Vina Mode ${escapeXml(mode)}${contextLabel ? ` · ${escapeXml(contextLabel)}` : ''}${receptorId ? ` · Receptor: ${escapeXml(receptorId)}` : ''}</text>` : '';
  const connectors = placed.map((item) => {
    const style = INTERACTION_STYLES[item.records[0]?.interaction_type] || INTERACTION_STYLES.VdWContact;
    const selected = item.token === selectedToken;
    const distance = item.records.map((record) => record.geometry?.distance).find(Number.isFinite);
    const midX = (item.anchor.x + item.x) / 2;
    const midY = (item.anchor.y + item.y) / 2;
    return `<g data-token="${escapeXml(item.token)}" class="interaction${selected ? ' selected' : ''}" tabindex="0" role="button"><line x1="${item.anchor.x.toFixed(2)}" y1="${item.anchor.y.toFixed(2)}" x2="${item.x.toFixed(2)}" y2="${item.y.toFixed(2)}" stroke="${style.color}" stroke-width="${selected ? style.width + 2 : style.width}" stroke-dasharray="${style.dash}"/><circle cx="${item.anchor.x.toFixed(2)}" cy="${item.anchor.y.toFixed(2)}" r="${selected ? 6 : 4}" fill="${style.color}"/><text x="${midX.toFixed(2)}" y="${(midY - 6).toFixed(2)}" text-anchor="middle" class="distance">${includeDistances && Number.isFinite(distance) ? `${Number(distance).toFixed(2)} Å` : ''}</text><rect x="${(item.x - 68).toFixed(2)}" y="${(item.y - 22).toFixed(2)}" width="136" height="44" rx="6" fill="${selected ? '#e3f3ef' : '#f7f9fb'}" stroke="${style.color}" stroke-width="${selected ? 3 : 1.5}"/><text x="${item.x.toFixed(2)}" y="${(item.y - 3).toFixed(2)}" text-anchor="middle" class="residue">${escapeXml(interactionDisplayLabel(item))}</text><text x="${item.x.toFixed(2)}" y="${(item.y + 14).toFixed(2)}" text-anchor="middle" class="interaction-label">${escapeXml(style.marker)} ${escapeXml(style.label)}</text></g>`;
  }).join('');
  const legendItems = includeLegend ? Object.entries(INTERACTION_STYLES).map(([type, style], index) => `<g transform="translate(${24 + (index % 3) * 238} ${MAP_HEIGHT - 54 + Math.floor(index / 3) * 15})"><line x1="0" y1="0" x2="28" y2="0" stroke="${style.color}" stroke-width="${style.width}" stroke-dasharray="${style.dash}"/><text x="35" y="4" class="legend">${escapeXml(style.marker)} ${escapeXml(style.label)}</text></g>`).join('') : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${MAP_WIDTH}" height="${MAP_HEIGHT}" viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}" role="img" aria-label="2D interaction map for ${escapeXml(moleculeId)}, Vina mode ${escapeXml(mode)}"><style>.map-title{font:700 17px Arial;fill:#20262e}.map-subtitle,.distance,.legend{font:11px Arial;fill:#52616c}.residue{font:700 12px Arial;fill:#20262e}.interaction-label{font:10px Arial;fill:#52616c}.ligand *{vector-effect:non-scaling-stroke}.selected{filter:drop-shadow(0 0 3px rgba(18,109,91,.45))}</style>${background}${title}<g class="ligand" transform="translate(${LIGAND_OFFSET.x} ${LIGAND_OFFSET.y})">${extractSvgInner(depiction.svg)}</g>${connectors}${legendItems}</svg>`;
}

export function interactionPositionHints(interactions = [], depiction = { width: 420, height: 300 }) {
  return Object.fromEntries(layoutInteractionMap(interactions, depiction).map((item) => [item.token, { x: item.x, y: item.y }]));
}

export function resolveExportDimensions(width = 3840, aspectRatio = MAP_WIDTH / MAP_HEIGHT) {
  const safeWidth = Math.max(320, Math.min(8192, Math.round(Number(width) || 3840)));
  const safeAspect = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : MAP_WIDTH / MAP_HEIGHT;
  return { width: safeWidth, height: Math.round(safeWidth / safeAspect) };
}
