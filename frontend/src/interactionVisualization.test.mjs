import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let vite;
let view;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  view = await vite.ssrLoadModule('/src/interactionVisualization.js');
});
after(async () => vite?.close());

const records = [{
  receptor: { chain: 'B', residue_name: 'ASN', residue_number: 236, insertion_code: '', atoms: [{ atom_serial: 20, atom_name: 'OD1' }] },
  ligand: { template_atom_indices: [1], pose_atoms: [{ pose_atom_serial: 7 }] },
  interaction_type: 'HBDonor', direction: 'ligand_donor', geometry: { distance: 2.91 },
}, {
  receptor: { chain: 'A', residue_name: 'MET', residue_number: 301, insertion_code: '', atoms: [{ atom_serial: 30, atom_name: 'SD' }] },
  ligand: { template_atom_indices: [0], pose_atoms: [{ pose_atom_serial: 4 }] },
  interaction_type: 'Hydrophobic', direction: '', geometry: { distance: 3.8 },
}];
const atoms = [{ atom_index: 0, x: 100, y: 150, element: 'C' }, { atom_index: 1, x: 320, y: 150, element: 'N' }];

test('maps canonical features to authoritative ligand and receptor atoms', () => {
  const mapped = view.mapInteractionRecords(records, atoms);
  assert.equal(mapped[0].token, 'A:MET:301:Hydrophobic');
  assert.deepEqual(mapped[1].ligandAtoms.map((atom) => atom.atom_index), [1]);
  assert.deepEqual(mapped[1].receptorAtoms.map((atom) => atom.atom_serial), [20]);
});

test('preferred direction follows the contacted ligand atom and placement is deterministic without collisions', () => {
  const mapped = view.mapInteractionRecords(records, atoms);
  assert.ok(view.preferredResidueDirection(mapped[1]).x > 0);
  const first = view.layoutInteractionMap(mapped, { width: 420, height: 300 });
  assert.deepEqual(first, view.layoutInteractionMap(mapped, { width: 420, height: 300 }));
  assert.equal(first.length, 2);
  assert.ok(Math.abs(first[0].x - first[1].x) >= 146 || Math.abs(first[0].y - first[1].y) >= 58);
});

test('SVG contains vector ligand, connectors, atom provenance labels, legend, and no raster image', () => {
  const mapped = view.mapInteractionRecords(records, atoms);
  const svg = view.buildInteractionMapSvg({ depiction: { width: 420, height: 300, svg: '<svg><path d="M0 0L1 1"/><text>C</text></svg>' }, interactions: mapped, selectedToken: mapped[1].token, moleculeId: 'gen_1', mode: 2, receptorId: '9IIR' });
  assert.match(svg, /<path d="M0 0L1 1"/);
  assert.match(svg, /<line/);
  assert.match(svg, /B:ASN236/);
  assert.match(svg, /2\.91 Å/);
  assert.match(svg, /H-bond · ligand donor/);
  assert.match(svg, /data-token=/);
  assert.doesNotMatch(svg, /<image\b|data:image/i);
});

test('all qualified interaction classes have non-color line and marker semantics', () => {
  assert.deepEqual(Object.keys(view.INTERACTION_STYLES), ['Hydrophobic', 'HBDonor', 'HBAcceptor', 'PiStacking', 'Anionic', 'Cationic', 'CationPi', 'PiCation', 'VdWContact']);
  Object.values(view.INTERACTION_STYLES).forEach((style) => {
    assert.ok(style.dash); assert.ok(style.width); assert.ok(style.marker);
  });
});

test('export dimensions preserve diagram or current viewer aspect ratio', () => {
  assert.deepEqual(view.resolveExportDimensions(3840), { width: 3840, height: 2627 });
  assert.deepEqual(view.resolveExportDimensions(2560, 16 / 9), { width: 2560, height: 1440 });
  assert.deepEqual(view.resolveExportDimensions(99999, 2), { width: 8192, height: 4096 });
});
