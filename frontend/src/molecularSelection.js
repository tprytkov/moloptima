const COLOR_VALUES = Object.freeze({
  green: '#2e7d32', red: '#c62828', blue: '#1565c0', yellow: '#f9a825',
  orange: '#ef6c00', cyan: '#00838f', magenta: '#ad1457',
});

const ELEMENT_NAMES = Object.freeze({
  C: 'Carbon', N: 'Nitrogen', O: 'Oxygen', S: 'Sulfur', P: 'Phosphorus',
  H: 'Hydrogen', F: 'Fluorine', CL: 'Chlorine', BR: 'Bromine', I: 'Iodine',
  FE: 'Iron', ZN: 'Zinc', MG: 'Magnesium', CA: 'Calcium', NA: 'Sodium', K: 'Potassium',
});

const WATER_NAMES = new Set(['HOH', 'WAT', 'H2O']);

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

export function atomIdentity(atom = {}) {
  const element = text(atom.elem || atom.element).toUpperCase();
  const residueName = text(atom.resn || atom.residueName).toUpperCase();
  const residueNumber = atom.resi ?? atom.residueNumber ?? '';
  const chain = text(atom.chain);
  return {
    atomName: text(atom.atom || atom.atomName || atom.elem),
    element,
    elementName: ELEMENT_NAMES[element] || element || 'Unavailable',
    residueName,
    residueNumber,
    chain,
    serial: atom.serial ?? atom.atom_serial ?? null,
    index: atom.index ?? atom.atom_index ?? null,
    x: Number.isFinite(Number(atom.x)) ? Number(atom.x) : null,
    y: Number.isFinite(Number(atom.y)) ? Number(atom.y) : null,
    z: Number.isFinite(Number(atom.z)) ? Number(atom.z) : null,
    category: WATER_NAMES.has(residueName)
      ? 'Water'
      : atom.hetflag ? 'Non-protein residue' : 'Protein residue',
    hetflag: Boolean(atom.hetflag),
  };
}

export function atomKey(atom = {}) {
  const identity = atomIdentity(atom);
  if (identity.serial !== null) return `serial:${identity.serial}`;
  if (identity.index !== null) return `index:${identity.index}`;
  return [
    identity.chain, identity.residueName, identity.residueNumber, identity.atomName,
    identity.x, identity.y, identity.z,
  ].join(':');
}

export function residueKey(atom = {}) {
  const identity = atomIdentity(atom);
  return `${identity.chain}:${identity.residueName}:${identity.residueNumber}`;
}

export function residueIdentity(atom = {}) {
  const identity = atomIdentity(atom);
  return {
    key: residueKey(atom),
    chain: identity.chain,
    residueName: identity.residueName,
    residueNumber: identity.residueNumber,
    category: identity.category,
  };
}

export function uniqueResidues(atoms = []) {
  const residues = new Map();
  atoms.forEach((atom) => {
    const residue = residueIdentity(atom);
    if (!residues.has(residue.key)) residues.set(residue.key, residue);
  });
  return [...residues.values()];
}

export function applyAtomSelection(current = [], candidates = [], action = 'replace') {
  const currentMap = new Map(current.map((atom) => [atomKey(atom), atom]));
  if (action === 'replace') return [...new Map(candidates.map((atom) => [atomKey(atom), atom])).values()];
  if (action === 'add') {
    candidates.forEach((atom) => currentMap.set(atomKey(atom), atom));
    return [...currentMap.values()];
  }
  if (action === 'remove') {
    candidates.forEach((atom) => currentMap.delete(atomKey(atom)));
    return [...currentMap.values()];
  }
  return current;
}

export function atomsForPick(allAtoms = [], clickedAtom, mode = 'residue') {
  if (!clickedAtom) return [];
  if (mode === 'atom') {
    const key = atomKey(clickedAtom);
    return allAtoms.filter((atom) => atomKey(atom) === key);
  }
  const key = residueKey(clickedAtom);
  return allAtoms.filter((atom) => residueKey(atom) === key);
}

export function selectionSummary(atoms = []) {
  const residues = uniqueResidues(atoms);
  return { atomCount: atoms.length, residueCount: residues.length, residues };
}

function parseResidueToken(token) {
  const compact = token.trim().toUpperCase();
  let match = compact.match(/^([A-Z]{1,4})(-?\d+[A-Z]?):([A-Z0-9_]*)$/);
  if (match) return { residueName: match[1], residueNumber: match[2], chain: match[3] === '_' ? '' : match[3] };
  match = compact.match(/^([A-Z0-9_]*):(-?\d+[A-Z]?)$/);
  if (match) return { residueNumber: match[2], chain: match[1] === '_' ? '' : match[1] };
  match = compact.match(/^([A-Z]{1,4})(-?\d+[A-Z]?)$/);
  return match ? { residueName: match[1], residueNumber: match[2] } : null;
}

export function parseMolecularCommand(input = '') {
  const raw = input.trim();
  const lower = raw.toLowerCase();
  if (!raw) return { type: 'error', message: 'Enter a molecular command. Run "help" for supported commands.' };
  if (lower === 'help' || lower.startsWith('help ')) return { type: 'help', topic: lower.slice(4).trim() };
  if (lower === 'select all') return { type: 'select', action: 'replace', query: { kind: 'all' } };
  if (lower === 'select none') return { type: 'select', action: 'replace', query: { kind: 'none' } };
  if (lower.startsWith('select ')) {
    let expression = raw.slice(7).trim();
    let action = 'replace';
    const actionMatch = expression.match(/^(add|remove)\s+(.+)$/i);
    if (actionMatch) { action = actionMatch[1].toLowerCase(); expression = actionMatch[2].trim(); }
    let match = expression.match(/^resi\s+(-?\d+)(?:-(-?\d+))?$/i);
    if (match) return { type: 'select', action, query: { kind: 'resi', start: Number(match[1]), end: Number(match[2] ?? match[1]) } };
    match = expression.match(/^(chain|resn|atom)\s+(.+)$/i);
    if (match) return { type: 'select', action, query: { kind: match[1].toLowerCase(), value: match[2].trim().toUpperCase() } };
    const residues = expression.split(',').map(parseResidueToken);
    if (residues.every(Boolean)) return { type: 'select', action, query: { kind: 'residues', residues } };
    return { type: 'error', message: `Unsupported select expression: "${expression}". Run "help select" for examples.` };
  }
  const color = lower.match(/^color\s+(green|red|blue|yellow|orange|cyan|magenta|cpk|chain|default)$/);
  if (color) return { type: 'display', patch: { color: color[1] }, label: `Color ${color[1]}` };
  if (['wireframe', 'sticks', 'spacefill', 'cartoon', 'hide', 'show'].includes(lower)) {
    return { type: 'display', patch: { representation: lower === 'show' ? 'default' : lower }, label: lower };
  }
  if (lower === 'spacefill off') return { type: 'display', patch: { representation: 'default' }, label: 'spacefill off' };
  return { type: 'error', message: `Unknown molecular command: "${raw}". Run "help" for supported commands.` };
}

function sameResidue(atom, expected) {
  const identity = atomIdentity(atom);
  const residueNumber = String(identity.residueNumber).toUpperCase();
  return (!expected.residueName || identity.residueName === expected.residueName)
    && (!expected.chain || identity.chain.toUpperCase() === expected.chain)
    && residueNumber === String(expected.residueNumber).toUpperCase();
}

export function atomsForCommand(allAtoms = [], query = {}) {
  if (query.kind === 'all') return allAtoms;
  if (query.kind === 'none') return [];
  if (query.kind === 'resi') {
    const minimum = Math.min(query.start, query.end);
    const maximum = Math.max(query.start, query.end);
    return allAtoms.filter((atom) => {
      const value = Number.parseInt(atomIdentity(atom).residueNumber, 10);
      return Number.isFinite(value) && value >= minimum && value <= maximum;
    });
  }
  if (query.kind === 'chain') return allAtoms.filter((atom) => atomIdentity(atom).chain.toUpperCase() === query.value);
  if (query.kind === 'resn') return allAtoms.filter((atom) => atomIdentity(atom).residueName === query.value);
  if (query.kind === 'atom') return allAtoms.filter((atom) => atomIdentity(atom).atomName.toUpperCase() === query.value);
  if (query.kind === 'residues') return allAtoms.filter((atom) => query.residues.some((residue) => sameResidue(atom, residue)));
  return [];
}

export function molecularCommandHelp(topic = '') {
  if (topic === 'select') return 'Selection: select all; select none; select ILE142; select A:142; select ILE142:A; select resi 140-150; select chain A; select resn ILE; select atom CB; select add/remove <expression>.';
  if (topic === 'color') return 'Colors: color green, red, blue, yellow, orange, cyan, magenta, cpk, chain, or default.';
  if (topic === 'spacefill') return 'Representations: wireframe, sticks, spacefill, spacefill off, cartoon, hide, or show.';
  return 'MolOptima supports a RasMol-inspired allowlisted subset, not full RasMol compatibility. Use help select, help color, or help spacefill.';
}

export function updateDisplayState(current = {}, atoms = [], patch = {}) {
  const next = { ...current };
  atoms.forEach((atom) => {
    const key = atomKey(atom);
    next[key] = { atom, ...(next[key] || {}), ...patch };
    if (next[key].representation === 'default') delete next[key].representation;
    if (next[key].color === 'default') delete next[key].color;
    if (!next[key].representation && !next[key].color) delete next[key];
  });
  return next;
}

function colorStyle(color) {
  if (!color || color === 'default') return {};
  if (color === 'cpk') return { colorscheme: 'Jmol' };
  if (color === 'chain') return { colorscheme: 'chain' };
  return { color: COLOR_VALUES[color] };
}

export function molecularDisplayStyle(entry = {}) {
  const color = colorStyle(entry.color);
  switch (entry.representation) {
    case 'wireframe': return { line: { ...color } };
    case 'sticks': return { stick: { radius: 0.22, ...color } };
    case 'ball_stick': return { stick: { radius: 0.2, ...color }, sphere: { scale: 0.34, ...color } };
    case 'spacefill': return { sphere: { scale: 1, ...color } };
    case 'cartoon': return { cartoon: { ...color } };
    case 'hide': return {};
    default:
      return entry.atom?.hetflag
        ? { stick: { radius: 0.13, ...color } }
        : { cartoon: { ...color } };
  }
}

export function displayOverridesFromState(displayState = {}) {
  const groups = new Map();
  Object.entries(displayState).forEach(([key, entry]) => {
    const groupKey = `${entry.representation || 'default'}:${entry.color || 'default'}:${entry.atom?.hetflag ? 'hetero' : 'protein'}`;
    if (!groups.has(groupKey)) groups.set(groupKey, { keys: new Set(), entry });
    groups.get(groupKey).keys.add(key);
  });
  return [...groups.entries()].map(([key, group]) => ({
    key,
    selection: { predicate: (atom) => group.keys.has(atomKey(atom)) },
    style: molecularDisplayStyle(group.entry),
  }));
}

export function matchingDetectedLigand(atoms = [], ligands = []) {
  const residues = uniqueResidues(atoms);
  if (residues.length !== 1) return null;
  const residue = residues[0];
  const match = ligands.find((ligand) => (
    String(ligand.chain || '') === residue.chain
    && String(ligand.residue_name || '').toUpperCase() === residue.residueName
    && String(ligand.residue_number ?? '') === String(residue.residueNumber)
    && Number(ligand.atom_count) === atoms.length
  ));
  return match || null;
}
