import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  applyAtomSelection, atomIdentity, atomsForCommand, atomsForPick, displayOverridesFromState,
  matchingDetectedLigand, molecularCommandHelp, parseMolecularCommand, residueKey,
  selectionSummary, updateDisplayState,
} from './molecularSelection.js';

const ATOMS = [
  { serial: 1, index: 0, atom: 'CA', elem: 'C', resn: 'ILE', resi: 142, chain: 'A', x: 1, y: 2, z: 3 },
  { serial: 2, index: 1, atom: 'CB', elem: 'C', resn: 'ILE', resi: 142, chain: 'A', x: 2, y: 2, z: 3 },
  { serial: 3, index: 2, atom: 'OD1', elem: 'O', resn: 'ASP', resi: 155, chain: 'A', x: 5, y: 6, z: 7 },
  { serial: 4, index: 3, atom: 'C7', elem: 'C', resn: 'CLR', resi: 602, chain: 'B', hetflag: true, x: -1, y: 0, z: 1 },
  { serial: 5, index: 4, atom: 'O', elem: 'O', resn: 'CLR', resi: 602, chain: 'B', hetflag: true, x: -2, y: 0, z: 1 },
];

test('extracts authoritative atom, residue, chain, serial, element, category, and coordinates', () => {
  assert.deepEqual(atomIdentity(ATOMS[1]), {
    atomName: 'CB', element: 'C', elementName: 'Carbon', residueName: 'ILE', residueNumber: 142,
    chain: 'A', serial: 2, index: 1, x: 2, y: 2, z: 3, category: 'Protein residue', hetflag: false,
  });
  assert.equal(atomIdentity(ATOMS[3]).category, 'Non-protein residue');
});

test('atom, residue, and molecule picking use the clicked authoritative identity', () => {
  assert.deepEqual(atomsForPick(ATOMS, ATOMS[1], 'atom').map((atom) => atom.serial), [2]);
  assert.deepEqual(atomsForPick(ATOMS, ATOMS[1], 'residue').map((atom) => atom.serial), [1, 2]);
  assert.deepEqual(atomsForPick(ATOMS, ATOMS[3], 'molecule').map((atom) => atom.serial), [4, 5]);
});

test('replace, add, remove, clear, and select-all semantics are immutable', () => {
  const replaced = applyAtomSelection([], ATOMS.slice(0, 2), 'replace');
  const added = applyAtomSelection(replaced, [ATOMS[2]], 'add');
  const removed = applyAtomSelection(added, [ATOMS[0]], 'remove');
  assert.deepEqual(replaced.map((atom) => atom.serial), [1, 2]);
  assert.deepEqual(added.map((atom) => atom.serial), [1, 2, 3]);
  assert.deepEqual(removed.map((atom) => atom.serial), [2, 3]);
  assert.deepEqual(applyAtomSelection(removed, [], 'replace'), []);
  assert.deepEqual(applyAtomSelection([], ATOMS, 'replace'), ATOMS);
});

test('selection summary reports unique residue and atom counts', () => {
  assert.deepEqual(selectionSummary(ATOMS).residues.map((residue) => residue.key), ['A:ILE:142', 'A:ASP:155', 'B:CLR:602']);
  assert.equal(selectionSummary(ATOMS).atomCount, 5);
  assert.equal(selectionSummary(ATOMS).residueCount, 3);
});

test('supported select commands resolve residue, range, chain, name, atom, add, remove, all, and none', () => {
  for (const command of ['select ILE142', 'select A:142', 'select ILE142:A']) {
    const parsed = parseMolecularCommand(command);
    assert.deepEqual(atomsForCommand(ATOMS, parsed.query).map((atom) => atom.serial), [1, 2]);
  }
  assert.deepEqual(atomsForCommand(ATOMS, parseMolecularCommand('select resi 142-155').query).map((atom) => atom.serial), [1, 2, 3]);
  assert.deepEqual(atomsForCommand(ATOMS, parseMolecularCommand('select chain B').query).map((atom) => atom.serial), [4, 5]);
  assert.deepEqual(atomsForCommand(ATOMS, parseMolecularCommand('select resn ASP').query).map((atom) => atom.serial), [3]);
  assert.deepEqual(atomsForCommand(ATOMS, parseMolecularCommand('select atom CB').query).map((atom) => atom.serial), [2]);
  assert.equal(parseMolecularCommand('select add ASP155').action, 'add');
  assert.equal(parseMolecularCommand('select remove ILE142').action, 'remove');
  assert.equal(parseMolecularCommand('select all').query.kind, 'all');
  assert.equal(parseMolecularCommand('select none').query.kind, 'none');
});

test('multiple-residue command syntax selects the documented set', () => {
  const parsed = parseMolecularCommand('select ILE142,ASP155');
  assert.deepEqual(atomsForCommand(ATOMS, parsed.query).map((atom) => atom.serial), [1, 2, 3]);
});

test('display commands are allowlisted and unknown commands fail safely', () => {
  assert.deepEqual(parseMolecularCommand('color green').patch, { color: 'green' });
  assert.deepEqual(parseMolecularCommand('spacefill').patch, { representation: 'spacefill' });
  assert.deepEqual(parseMolecularCommand('spacefill off').patch, { representation: 'default' });
  assert.deepEqual(parseMolecularCommand('show').patch, { representation: 'default' });
  assert.match(parseMolecularCommand('javascript alert(1)').message, /Unknown molecular command/);
  assert.match(molecularCommandHelp('select'), /select add\/remove/);
});

test('representation and color changes affect only selected atom identities and persist independently', () => {
  const first = updateDisplayState({}, ATOMS.slice(0, 2), { representation: 'spacefill', color: 'green' });
  const second = updateDisplayState(first, [ATOMS[2]], { representation: 'sticks', color: 'red' });
  assert.equal(Object.keys(first).length, 2);
  assert.equal(Object.keys(second).length, 3);
  assert.equal(second['serial:1'].color, 'green');
  assert.equal(second['serial:3'].color, 'red');
  const overrides = displayOverridesFromState(second);
  assert.equal(overrides.length, 2);
  assert.equal(overrides[0].selection.predicate(ATOMS[0]), true);
  assert.equal(overrides[0].selection.predicate(ATOMS[2]), false);
});

test('reset display is an empty override state and does not alter selection', () => {
  const selection = [...ATOMS];
  const display = updateDisplayState({}, selection, { representation: 'cartoon' });
  assert.ok(Object.keys(display).length);
  assert.deepEqual(displayOverridesFromState({}), []);
  assert.deepEqual(selection, ATOMS);
});

test('detected ligand recognition requires the exact authoritative component and atom count', () => {
  const ligand = { ligand_id: 'CLR:B:602:_', residue_name: 'CLR', residue_number: 602, chain: 'B', atom_count: 2 };
  assert.equal(matchingDetectedLigand(ATOMS.slice(3), [ligand]), ligand);
  assert.equal(matchingDetectedLigand([ATOMS[3]], [ligand]), null);
  assert.equal(residueKey(ATOMS[3]), 'B:CLR:602');
});

test('molecular command implementation contains no eval or dynamic code execution', async () => {
  const source = await readFile(new URL('./molecularSelection.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\beval\s*\(|new\s+Function\s*\(/);
});
