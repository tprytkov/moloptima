import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let module;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  module = await vite.ssrLoadModule('/src/DockingSetup.jsx');
});

after(async () => vite?.close());

test('renders the professional receptor upload and explicit box workflow', () => {
  const html = renderToStaticMarkup(React.createElement(module.default, {
    apiBaseUrl: 'http://localhost:8000', onConfirmed: () => {},
  }));
  assert.match(html, /Select PDB for visualization/);
  assert.match(html, /Select prepared PDBQT/);
  assert.match(html, /Receptor Preparation/);
  assert.match(html, /Advanced \/ reproducibility/);
  assert.match(html, /Hydrogen optimization and pH-dependent protonation are not performed/);
  assert.match(html, /final PDBQT retains the explicit polar\/donor hydrogens/i);
  assert.match(html, /nonpolar hydrogens are not retained as independent docking atoms/);
  assert.match(html, /Upload a PDB to display chains, waters, hetero groups, and alternate locations/);
  assert.match(html, /Binding-site definition/);
  assert.match(html, /Bound ligand/);
  assert.match(html, /Selected atom/);
  assert.match(html, /Selected residue region/);
  assert.match(html, /Manual coordinates/);
  assert.match(html, /Center X/);
  assert.match(html, /Size X/);
  assert.match(html, /updates immediately/);
  assert.match(html, /Confirm Docking Setup/);
  assert.match(html, /data-testid="receptor-viewer"/);
});

test('preparation choices fail closed until chains, hetero groups, and altlocs are explicit', () => {
  const inventory = {
    hetero_groups: [{ group_id: 'LIG:A:401:_', residue_name: 'LIG' }],
    alternate_locations: [{ residue_key: 'A:12', choices: ['A', 'B'] }],
  };
  assert.equal(module.preparationSelectionReady(inventory, [], {}, {}), false);
  assert.equal(module.preparationSelectionReady(inventory, ['A'], {}, {}), false);
  assert.equal(module.preparationSelectionReady(
    inventory, ['A'], { 'LIG:A:401:_': 'exclude' }, { 'A:12': 'B' },
  ), true);
});

test('preparation payload contains semantic choices and explicit bound-ligand exclusion', () => {
  assert.deepEqual(module.preparationPayload(
    ['A'], { 'LIG:A:401:_': 'exclude', 'ZN:A:500:_': 'keep' }, { 'A:12': 'A' }, 'LIG:A:401:_',
  ), {
    selected_chains: ['A'], water_policy: 'remove_all',
    hetero_choices: { 'LIG:A:401:_': false, 'ZN:A:500:_': true },
    altloc_choices: { 'A:12': 'A' }, bound_ligand_id: 'LIG:A:401:_',
  });
  assert.equal(module.summarizeHetero([
    { group_id: 'ZN:A:500:_', residue_name: 'ZN', chain: 'A', residue_number: '500', insertion_code: '' },
  ], { 'ZN:A:500:_': 'keep' }, 'keep'), 'ZN A 500');
});

test('runtime and preparation helpers use focused production APIs', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ available: true, receptor_id: 'a'.repeat(32) }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    await module.fetchReceptorPreparationRuntime('http://localhost:8000');
    await module.prepareDockingReceptor('http://localhost:8000', 'a'.repeat(32), {
      selected_chains: ['A'], water_policy: 'remove_all', hetero_choices: {}, altloc_choices: {},
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls[0].url, 'http://localhost:8000/api/docking/receptor-preparation/runtime');
  assert.equal(calls[1].url, `http://localhost:8000/api/docking/receptors/${'a'.repeat(32)}/prepare`);
  assert.equal(calls[1].options.method, 'POST');
});

test('selects source before preparation and exact docking representation when ready', () => {
  const source = { receptor_id: 'a'.repeat(32), docking_ready: false };
  const prepared = { receptor_id: 'b'.repeat(32), docking_ready: true };
  assert.equal(
    module.receptorStructureUrl('http://localhost:8000', source),
    `http://localhost:8000/api/docking/receptors/${source.receptor_id}/structure?representation=source`,
  );
  assert.equal(
    module.receptorStructureUrl('http://localhost:8000', prepared),
    `http://localhost:8000/api/docking/receptors/${prepared.receptor_id}/structure?representation=docking`,
  );
});

test('retains and verifies docking receptor identity metadata', async () => {
  const originalFetch = globalThis.fetch;
  const receptor = {
    receptor_id: 'b'.repeat(32), docking_ready: true,
    docking_receptor_sha256: 'd'.repeat(64), preparation_id: 'p'.repeat(32),
  };
  globalThis.fetch = async (url) => {
    assert.match(String(url), /representation=docking$/);
    return new Response('PDBQT', { headers: {
      'X-MolOptima-Structure-Format': 'pdbqt',
      'X-MolOptima-Structure-Representation': 'docking',
      'X-MolOptima-Receptor-ID': receptor.receptor_id,
      'X-MolOptima-Artifact-SHA256': receptor.docking_receptor_sha256,
      'X-MolOptima-Preparation-ID': receptor.preparation_id,
      'X-MolOptima-Docking-Receptor-SHA256': receptor.docking_receptor_sha256,
    } });
  };
  try {
    assert.deepEqual(await module.fetchReceptorStructure('http://localhost:8000', receptor), {
      text: 'PDBQT', format: 'pdbqt', identity: {
        representation: 'docking', receptorId: receptor.receptor_id,
        artifactSha256: receptor.docking_receptor_sha256,
        preparationId: receptor.preparation_id,
        dockingReceptorSha256: receptor.docking_receptor_sha256,
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects receptor structure responses whose identity does not match metadata', async () => {
  const originalFetch = globalThis.fetch;
  const receptor = {
    receptor_id: 'b'.repeat(32), docking_ready: true,
    docking_receptor_sha256: 'd'.repeat(64), preparation_id: '',
  };
  globalThis.fetch = async () => new Response('PDBQT', { headers: {
    'X-MolOptima-Structure-Format': 'pdbqt',
    'X-MolOptima-Structure-Representation': 'source',
    'X-MolOptima-Receptor-ID': receptor.receptor_id,
    'X-MolOptima-Artifact-SHA256': receptor.docking_receptor_sha256,
    'X-MolOptima-Docking-Receptor-SHA256': receptor.docking_receptor_sha256,
  } });
  try {
    await assert.rejects(
      module.fetchReceptorStructure('http://localhost:8000', receptor),
      /identity does not match the requested receptor representation/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function lifecycleReceptor(id, overrides = {}) {
  return {
    receptor_id: id,
    docking_ready: false,
    source_receptor_sha256: `source-${id}`,
    structure_inventory: { protein: { chains: [{ chain: id.toUpperCase() }] } },
    ...overrides,
  };
}

function populatedReceptorState() {
  return module.createReceptorScopedState({
    method: 'selected_region',
    selectedAtom: { chain: 'A', residueName: 'TYR', residueNumber: 42 },
    selectedResidues: [{ key: 'A:TYR:42', chain: 'A', residueName: 'TYR', residueNumber: 42 }],
    selectedLigandId: 'LIG:A:401:_',
    box: { centerX: '1', centerY: '2', centerZ: '3', sizeX: '20', sizeY: '21', sizeZ: '22' },
    confirmed: { configuration_id: 'configured' },
    selectedChains: ['A'],
    heteroChoices: { ligand: 'exclude' },
    altlocChoices: { residue: 'A' },
    pocketGroupId: 'LIG:A:401:_',
  });
}

test('different receptor clears box, selections, highlights, and receptor preparation choices', () => {
  const receptorA = lifecycleReceptor('a');
  const receptorB = lifecycleReceptor('b');
  const next = module.transitionReceptorScopedState(populatedReceptorState(), receptorA, receptorB);
  assert.deepEqual(next.box, {
    centerX: '', centerY: '', centerZ: '', sizeX: '', sizeY: '', sizeZ: '',
  });
  assert.equal(next.method, 'manual');
  assert.equal(next.selectedAtom, null);
  assert.deepEqual(next.selectedResidues, []);
  assert.equal(next.selectedLigandId, '');
  assert.deepEqual(next.selectedChains, ['B']);
  assert.deepEqual(next.heteroChoices, {});
  assert.deepEqual(next.altlocChoices, {});
  assert.equal(next.pocketGroupId, '');
  assert.equal(next.confirmed, null);
});

test('same receptor preparation preserves one authoritative box and clears unmappable selections', () => {
  const source = lifecycleReceptor('a');
  const prepared = lifecycleReceptor('a', {
    docking_ready: true,
    preparation_id: 'preparation-1',
    docking_receptor_sha256: 'prepared-hash',
  });
  const current = populatedReceptorState();
  const next = module.transitionReceptorScopedState(current, source, prepared);
  assert.deepEqual(next.box, current.box);
  assert.equal(next.method, 'manual');
  assert.equal(next.selectedAtom, null);
  assert.deepEqual(next.selectedResidues, []);
  assert.equal(next.selectedLigandId, '');
  assert.deepEqual(next.selectedChains, current.selectedChains);
  assert.deepEqual(next.heteroChoices, current.heteroChoices);
  assert.deepEqual(next.altlocChoices, current.altlocChoices);
  assert.equal(next.pocketGroupId, current.pocketGroupId);
  assert.equal(next.confirmed, null);
});

test('same receptor with a new preparation or docking hash is an artifact change', () => {
  const first = lifecycleReceptor('a', {
    docking_ready: true, preparation_id: 'preparation-1', docking_receptor_sha256: 'hash-1',
  });
  const second = { ...first, preparation_id: 'preparation-2', docking_receptor_sha256: 'hash-2' };
  assert.deepEqual(module.classifyReceptorTransition(first, second), {
    receptorChanged: false, artifactChanged: true,
  });
  assert.notEqual(module.receptorArtifactIdentity(first), module.receptorArtifactIdentity(second));
});

test('latest request guard prevents delayed receptor A from replacing receptor B', async () => {
  const guard = module.createLatestRequestGuard();
  const requestA = guard.start();
  let releaseA;
  const delayedA = new Promise((resolve) => { releaseA = resolve; });
  let activeReceptor = null;
  const commitA = delayedA.then((value) => {
    if (requestA.isCurrent()) activeReceptor = value;
  });
  const requestB = guard.start();
  assert.equal(requestA.signal.aborted, true);
  if (requestB.isCurrent()) activeReceptor = 'B';
  releaseA('A');
  await commitA;
  assert.equal(activeReceptor, 'B');
});

test('failed prepared-structure load cannot replace the existing source visualization state', async () => {
  const originalFetch = globalThis.fetch;
  const sourceState = populatedReceptorState();
  const snapshot = structuredClone(sourceState);
  const prepared = lifecycleReceptor('a', {
    docking_ready: true, preparation_id: 'preparation-1', docking_receptor_sha256: 'hash-1',
  });
  globalThis.fetch = async () => new Response('Prepared artifact unavailable', { status: 503 });
  try {
    await assert.rejects(
      module.fetchReceptorStructure('http://localhost:8000', prepared),
      /Prepared artifact unavailable/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(sourceState, snapshot);
});

test('direct PDBQT receptor remains on a stable docking representation', () => {
  const direct = lifecycleReceptor('a', {
    docking_ready: true, receptor_source: 'uploaded_pdbqt', docking_receptor_sha256: 'direct-hash',
  });
  assert.match(module.receptorStructureUrl('http://localhost:8000', direct), /representation=docking$/);
  assert.deepEqual(module.classifyReceptorTransition(direct, { ...direct }), {
    receptorChanged: false, artifactChanged: false,
  });
  const current = populatedReceptorState();
  assert.deepEqual(module.transitionReceptorScopedState(current, direct, { ...direct }), {
    ...current, confirmed: null,
  });
});

test('reports clicked atom identity and finite coordinates', () => {
  assert.deepEqual(module.atomDetails({ chain: 'A', resn: 'TYR', resi: 115, atom: 'OH', x: 1, y: -2.5, z: 3 }), {
    chain: 'A', residueName: 'TYR', residueNumber: 115, atomName: 'OH', x: 1, y: -2.5, z: 3,
  });
  assert.equal(module.atomDetails({ x: Number.NaN, y: 0, z: 0 }), null);
});

test('centroid and fit-to-selection calculations are deterministic', () => {
  const atoms = [{ x: 0, y: 2, z: -2 }, { x: 4, y: 6, z: 2 }];
  assert.deepEqual(module.centroidForAtoms(atoms), { x: 2, y: 4, z: 0 });
  assert.deepEqual(module.fitBoxToAtoms(atoms, 3), {
    centerX: '2', centerY: '4', centerZ: '0', sizeX: '10', sizeY: '10', sizeZ: '10',
  });
  assert.equal(module.fitBoxToAtoms([], 3), null);
  assert.equal(module.fitBoxToAtoms(atoms, -1), null);
});

test('docking readiness fails closed until PDBQT, center, and positive dimensions exist', () => {
  const empty = { centerX: '', centerY: '', centerZ: '', sizeX: '', sizeY: '', sizeZ: '' };
  assert.deepEqual(module.dockingReadiness(null, empty), {
    receptorLoaded: false, preparedReceptor: false, centerDefined: false, positiveDimensions: false,
  });
  assert.deepEqual(module.dockingReadiness({ docking_ready: true }, {
    centerX: '0', centerY: '0', centerZ: '0', sizeX: '20', sizeY: '20', sizeZ: '20',
  }), { receptorLoaded: true, preparedReceptor: true, centerDefined: true, positiveDimensions: true });
});

test('viewer-derived modes map to the authoritative atom-or-residue backend contract', () => {
  const box = { centerX: '1', centerY: '2', centerZ: '3', sizeX: '20', sizeY: '20', sizeZ: '20' };
  const advanced = { exhaustiveness: '8', numModes: '9', seed: '2025', workerCount: '4' };
  assert.equal(module.configurationPayload('a'.repeat(32), 'selected_atom', '', box, advanced).center_method, 'atom_or_residue');
  assert.equal(module.configurationPayload('a'.repeat(32), 'selected_region', '', box, advanced).center_method, 'atom_or_residue');
});

test('bound-ligand centroid populates editable center values', () => {
  assert.deepEqual(module.ligandCentroid({
    centroid: { center_x: 1.25, center_y: -2.5, center_z: 3 },
  }), { centerX: '1.25', centerY: '-2.5', centerZ: '3' });
});

test('configuration submission preserves center size and advanced values', () => {
  const payload = module.configurationPayload(
    'a'.repeat(32),
    'manual',
    '',
    { centerX: '0', centerY: '1.5', centerZ: '-2', sizeX: '20', sizeY: '21', sizeZ: '22' },
    { exhaustiveness: '8', numModes: '9', seed: '2025', workerCount: '4' },
  );
  assert.deepEqual(payload, {
    receptor_id: 'a'.repeat(32), center_method: 'manual', selected_ligand_id: '',
    center_x: 0, center_y: 1.5, center_z: -2,
    size_x: 20, size_y: 21, size_z: 22,
    exhaustiveness: 8, num_modes: 9, seed: 2025, worker_count: 4,
  });
});

test('configuration submission includes optional energy range only when supplied', () => {
  const box = {
    centerX: '0', centerY: '1.5', centerZ: '-2', sizeX: '20', sizeY: '21', sizeZ: '22',
  };
  const advanced = { exhaustiveness: '8', numModes: '9', seed: '2025', workerCount: '4' };
  const omitted = module.configurationPayload('a'.repeat(32), 'manual', '', box, advanced);
  assert.equal('energy_range' in omitted, false);

  const supplied = module.configurationPayload(
    'a'.repeat(32), 'manual', '', box, { ...advanced, energyRange: '4' },
  );
  assert.equal(supplied.energy_range, 4);
});

test('upload and configuration helpers call the production API contracts', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ receptor_id: 'b'.repeat(32), configuration_id: 'c'.repeat(32) }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const file = new File(['ATOM'], 'target.pdb', { type: 'chemical/x-pdb' });
    await module.uploadDockingReceptor('http://localhost:8000', file);
    await module.submitDockingConfiguration('http://localhost:8000', { receptor_id: 'b'.repeat(32) });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls[0].url, 'http://localhost:8000/api/docking/receptors?');
  assert.equal(calls[0].options.method, 'POST');
  assert.ok(calls[0].options.body instanceof FormData);
  assert.equal(calls[1].url, 'http://localhost:8000/api/docking/configurations');
  assert.equal(calls[1].options.method, 'POST');
});
