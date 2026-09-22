import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let vite;
let module;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  module = await vite.ssrLoadModule('/src/ReceptorViewer.jsx');
});

after(async () => vite?.close());

function validBox(overrides = {}) {
  return {
    centerX: '1.25', centerY: '-2.5', centerZ: '0',
    sizeX: '20.125', sizeY: '21.5', sizeZ: '22.75',
    ...overrides,
  };
}

function fakeViewer() {
  return {
    models: [], shapes: [], removedShapes: [], styles: [],
    renderCount: 0, zoomToCount: 0, resizeCount: 0,
    view: [0, 0, 0, 10, 0, 0, 0, 1], setViewCount: 0,
    removeAllModels() { this.models = []; },
    addModel(text, format) {
      const model = { text, format };
      this.models.push(model);
      return model;
    },
    setStyle(selection, style) { this.styles.push({ operation: 'set', selection, style }); },
    addStyle(selection, style) { this.styles.push({ operation: 'add', selection, style }); },
    setClickable(selection, clickable, callback) { this.clickable = { selection, clickable, callback }; },
    addBox(spec) {
      const shape = { spec };
      this.shapes.push(shape);
      return shape;
    },
    removeShape(shape) {
      this.removedShapes.push(shape);
      this.shapes = this.shapes.filter((item) => item !== shape);
    },
    selectedAtoms() { return []; },
    zoomTo() { this.zoomToCount += 1; },
    getView() { return [...this.view]; },
    setView(view) { this.view = [...view]; this.setViewCount += 1; },
    render() { this.renderCount += 1; },
    resize() { this.resizeCount += 1; },
    rotate() { this.cameraRotation = (this.cameraRotation ?? 0) + 1; },
    zoom() { this.cameraZoom = (this.cameraZoom ?? 0) + 1; },
    pan() { this.cameraPan = (this.cameraPan ?? 0) + 1; },
    clear() {},
  };
}

test('maps Vina center and dimensions directly without rounding or transformation', () => {
  assert.deepEqual(module.toVinaBoxSpec(validBox()), {
    center: { x: 1.25, y: -2.5, z: 0 },
    dimensions: { w: 20.125, h: 21.5, d: 22.75 },
  });
  assert.deepEqual(module.toVinaBoxSpec(validBox({
    centerX: '-123.456789', centerY: '0.000001', centerZ: '-0',
    sizeX: '1.0000001', sizeY: '2.2222222', sizeZ: '3.3333333',
  })), {
    center: { x: -123.456789, y: 0.000001, z: -0 },
    dimensions: { w: 1.0000001, h: 2.2222222, d: 3.3333333 },
  });
});

test('accepts positive, negative, zero, and decimal center coordinates', () => {
  assert.deepEqual(module.toVinaBoxSpec(validBox({ centerX: '4', centerY: '-5.5', centerZ: '0' })).center, {
    x: 4, y: -5.5, z: 0,
  });
});

for (const [name, overrides] of [
  ['blank center', { centerX: '' }],
  ['blank size', { sizeY: '' }],
  ['NaN center', { centerZ: 'NaN' }],
  ['infinite center', { centerY: 'Infinity' }],
  ['zero size', { sizeX: '0' }],
  ['negative size', { sizeZ: '-1' }],
]) {
  test(`rejects ${name}`, () => {
    assert.equal(module.toVinaBoxSpec(validBox(overrides)), null);
  });
}

test('loads supplied receptor format and removes the old model before replacement', () => {
  const viewer = fakeViewer();
  module.replaceReceptorModel(viewer, { text: 'SOURCE', format: 'pdb' });
  assert.deepEqual(viewer.models, [{ text: 'SOURCE', format: 'pdb' }]);
  module.replaceReceptorModel(viewer, { text: 'DOCKING', format: 'pdbqt' });
  assert.deepEqual(viewer.models, [{ text: 'DOCKING', format: 'pdbqt' }]);
  assert.equal(viewer.zoomToCount, 2);
});

test('same-receptor artifact identity replaces the model while preserving the camera', () => {
  const viewer = fakeViewer();
  const source = {
    text: 'SOURCE', format: 'pdb',
    identity: { receptorId: 'receptor-a', representation: 'source', artifactSha256: 'source-hash' },
  };
  const docking = {
    text: 'DOCKING', format: 'pdbqt',
    identity: {
      receptorId: 'receptor-a', representation: 'docking', preparationId: 'preparation-1',
      artifactSha256: 'docking-hash', dockingReceptorSha256: 'docking-hash',
    },
  };
  assert.notEqual(module.receptorStructureIdentity(source), module.receptorStructureIdentity(docking));
  module.replaceReceptorModel(viewer, source);
  const camera = [1, 2, 3, 40, 0, 0.25, 0, 0.968];
  viewer.view = camera;
  module.replaceReceptorModel(viewer, docking, () => {}, { preserveCamera: true });
  assert.deepEqual(viewer.models, [{ text: 'DOCKING', format: 'pdbqt' }]);
  assert.deepEqual(viewer.view, camera);
  assert.equal(viewer.setViewCount, 1);
  assert.equal(viewer.zoomToCount, 1);
});

test('renders an existing valid box immediately after delayed viewer creation', async () => {
  const viewer = fakeViewer();
  let releaseModule;
  const pendingViewer = module.createReceptorViewer({}, () => new Promise((resolve) => {
    releaseModule = resolve;
  }));
  await Promise.resolve();
  assert.equal(viewer.shapes.length, 0);
  releaseModule({ createViewer: () => viewer });
  const createdViewer = await pendingViewer;
  module.replaceReceptorModel(createdViewer, { text: 'ATOM', format: 'pdbqt' });
  module.renderVinaBox(createdViewer, null, validBox());
  assert.equal(viewer.shapes.length, 1);
  assert.deepEqual(viewer.shapes[0].spec.center, { x: 1.25, y: -2.5, z: 0 });
});

test('center and size edits replace only the box shape without moving the camera', () => {
  const viewer = fakeViewer();
  const first = module.renderVinaBox(viewer, null, validBox());
  const moved = module.renderVinaBox(viewer, first, validBox({ centerX: '-8', centerY: '9', centerZ: '10' }));
  const resized = module.renderVinaBox(viewer, moved, validBox({ sizeX: '30', sizeY: '31', sizeZ: '32' }));
  assert.deepEqual(moved.spec.center, { x: -8, y: 9, z: 10 });
  assert.deepEqual(resized.spec.dimensions, { w: 30, h: 31, d: 32 });
  assert.equal(viewer.removedShapes.length, 2);
  assert.equal(viewer.zoomToCount, 0);
});

test('invalid edits remove the existing shape and do not create another', () => {
  const viewer = fakeViewer();
  const shape = module.renderVinaBox(viewer, null, validBox());
  const result = module.renderVinaBox(viewer, shape, validBox({ centerX: '' }));
  assert.equal(result, null);
  assert.equal(viewer.shapes.length, 0);
});

test('camera operations cannot alter authoritative box values', () => {
  const viewer = fakeViewer();
  const box = validBox();
  const snapshot = structuredClone(box);
  viewer.rotate();
  viewer.zoom();
  viewer.pan();
  assert.deepEqual(box, snapshot);
});

test('resize observer resizes and renders without changing camera or box state', () => {
  const viewer = fakeViewer();
  const host = {};
  const box = validBox();
  let callback;
  let disconnected = false;
  class FakeResizeObserver {
    constructor(nextCallback) { callback = nextCallback; }
    observe(target) { assert.equal(target, host); }
    disconnect() { disconnected = true; }
  }
  const disconnect = module.observeViewerResize(host, viewer, FakeResizeObserver);
  callback();
  assert.equal(viewer.resizeCount, 1);
  assert.equal(viewer.renderCount, 1);
  assert.equal(viewer.zoomToCount, 0);
  assert.deepEqual(box, validBox());
  disconnect();
  assert.equal(disconnected, true);
});
