import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let ScaffoldWorkspace;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  ({ default: ScaffoldWorkspace } = await vite.ssrLoadModule('/src/ScaffoldWorkspace.jsx'));
});
after(async () => vite?.close());

function render(data, extra = {}) {
  return renderToStaticMarkup(React.createElement(ScaffoldWorkspace, {
    data, selectedScaffoldId: '', selectedMoleculeId: '', onSelectScaffold() {},
    onSelectMolecule() {}, onViewMap() {}, baseUrl: 'http://localhost:8000', admetById: new Map(), ...extra,
  }));
}

test('scaffold browser renders counts, acyclic state, search, and provenance-safe language', () => {
  const group = { scaffold_id: 'scf_no_ring', scaffold_smiles: null, label: 'No ring scaffold', category: 'no_ring', member_count: 2, unique_structure_count: 2, members: [] };
  const html = render({ scaffolds: [group], summary: { scaffold_count: 0, acyclic_count: 2 } });
  assert.match(html, /Search scaffold ID or SMILES/);
  assert.match(html, /No ring scaffold/);
  assert.match(html, /2 members/);
  assert.match(html, /do not establish activity, potency, preference/);
});

test('selected scaffold renders bounded members, shared-selection controls, and ADMET unavailable state', () => {
  const members = Array.from({ length: 5000 }, (_, index) => ({ molecule_id: `member-${index}`, display_name: `Member ${index}`, source_index: index, canonical_smiles: 'c1ccccc1', source_filename: 'library.csv' }));
  const group = { scaffold_id: 'scf_ring', scaffold_smiles: 'c1ccccc1', label: 'scf_ring', category: 'bemis_murcko', member_count: 5000, unique_structure_count: 1, members };
  const html = render({ scaffolds: [group], summary: { scaffold_count: 1, acyclic_count: 0 } }, { selectedScaffoldId: 'scf_ring', selectedMoleculeId: 'member-0' });
  assert.match(html, /View members on map/);
  assert.match(html, /Member 0/);
  assert.match(html, /aria-pressed="true"/);
  assert.doesNotMatch(html, /Member 25</);
  assert.match(html, /Members page 1 of 200/);
  assert.match(html, /Run ADMET analysis/);
});

test('selected scaffold reports normalized descriptive ADMET sample size', () => {
  const group = { scaffold_id: 'scf_ring', scaffold_smiles: 'c1ccccc1', label: 'scf_ring', category: 'bemis_murcko', member_count: 1, unique_structure_count: 1, members: [{ molecule_id: 'm1', display_name: 'M1', source_index: 0, canonical_smiles: 'c1ccccc1' }] };
  const properties = { lipophilicity_astrazeneca: { status: { code: 'available' }, value: 2.5 } };
  const html = render({ scaffolds: [group], summary: { scaffold_count: 1, acyclic_count: 0 } }, { selectedScaffoldId: 'scf_ring', admetById: new Map([['m1', { properties }]]) });
  assert.match(html, /n 1 · mean 2.5 · median 2.5 · min 2.5 · max 2.5/);
  assert.match(html, /unavailable 0/);
});
