import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let vite;
let module;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  module = await vite.ssrLoadModule('/src/MoleculeStructureThumbnail.jsx');
});

after(async () => vite?.close());

test('encodes the canonical structure in the display-conformer URL', () => {
  assert.equal(
    module.structure3dUrl('http://localhost:8000', 'C/C=C\\O'),
    'http://localhost:8000/api/molecules/structure-3d?smiles=C%2FC%3DC%5CO',
  );
});

test('configures one compact ball-and-stick viewer without importing 3Dmol eagerly', async () => {
  const calls = [];
  const model = { setStyle(selection, style) { calls.push(['style', selection, style]); } };
  const viewer = {
    addModel(text, format) { calls.push(['model', text, format]); return model; },
    zoomTo() { calls.push(['zoomTo']); },
    zoom(value) { calls.push(['zoom', value]); },
    render() { calls.push(['render']); },
  };
  const load3Dmol = async () => ({
    createViewer(host, options) {
      calls.push(['viewer', host, options]);
      return viewer;
    },
  });

  assert.equal(await module.createMoleculeThumbnailViewer('host', 'MOLBLOCK', load3Dmol), viewer);
  assert.deepEqual(calls.map((entry) => entry[0]), ['viewer', 'model', 'style', 'zoomTo', 'zoom', 'render']);
  assert.deepEqual(calls[1], ['model', 'MOLBLOCK', 'sdf']);
  assert.deepEqual(calls[4], ['zoom', 1.35]);
});
