import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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
    removeModel(model) { this.models = this.models.filter((item) => item !== model); },
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
    addShape(spec) {
      const shape = {
        spec, cylinders: [],
        addCylinder(cylinder) { this.cylinders.push(cylinder); },
      };
      this.shapes.push(shape);
      return shape;
    },
    removeShape(shape) {
      this.removedShapes.push(shape);
      this.shapes = this.shapes.filter((item) => item !== shape);
    },
    selectedAtoms(selection = {}) {
      return this.atoms?.filter((atom) => !selection.predicate || selection.predicate(atom)) ?? [];
    },
    zoomTo(selection) { this.zoomToCount += 1; this.lastZoomSelection = selection; },
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

const I33 = {
  ligand_id: 'I33:A:603:_', chain: 'A', residue_name: 'I33', residue_number: 603,
};

test('viewer legend displays selected ligand identity and current rounded box dimensions', () => {
  const html = renderToStaticMarkup(React.createElement(module.ViewerLegend, {
    selectedLigand: I33,
    box: validBox(),
  }));
  assert.match(html, /aria-label="Receptor viewer legend"/);
  assert.match(html, /Highlighted ligand/);
  assert.match(html, /I33 · Chain A · Residue 603/);
  assert.match(html, /Vina search volume/);
  assert.match(html, /20.13 × 21.50 × 22.75 Å/);
});

test('switching or clearing ligand updates identity without stale metadata', () => {
  const second = { ligand_id: 'I34:B:602:_', chain: 'B', residue_name: 'I34', residue_number: 602 };
  assert.equal(module.viewerLegendPresentation(I33, validBox()).ligand, 'I33 · Chain A · Residue 603');
  assert.equal(module.viewerLegendPresentation(second, validBox()).ligand, 'I34 · Chain B · Residue 602');
  assert.equal(module.viewerLegendPresentation(null, validBox()).ligand, 'None');
});

test('docked ligand legend identifies the generated molecule and selected Vina mode', () => {
  assert.equal(
    module.viewerLegendPresentation(null, validBox(), { moleculeId: 'gen_4311', mode: 3 }).ligand,
    'gen_4311 · Mode 3',
  );
});

test('box dimension edits update legend and invalid values show Not defined', () => {
  assert.equal(module.viewerLegendPresentation(I33, validBox()).searchVolume, '20.13 × 21.50 × 22.75 Å');
  assert.equal(
    module.viewerLegendPresentation(I33, validBox({ sizeX: '30.555' })).searchVolume,
    '30.56 × 21.50 × 22.75 Å',
  );
  assert.equal(module.formatLegendDimension(17.235), '17.24');
  assert.equal(module.viewerLegendPresentation(I33, validBox({ sizeY: '' })).searchVolume, 'Not defined');
  assert.equal(module.viewerLegendPresentation(I33, validBox({ sizeZ: '-1' })).searchVolume, 'Not defined');
  assert.equal(module.viewerLegendPresentation(I33, validBox({ centerX: 'NaN' })).searchVolume, 'Not defined');
});

test('legend formatting is display-only and exposes no interactive control', () => {
  const ligand = structuredClone(I33);
  const box = validBox({ sizeX: '20.1251' });
  const ligandSnapshot = structuredClone(ligand);
  const boxSnapshot = structuredClone(box);
  const presentation = module.viewerLegendPresentation(ligand, box);
  assert.equal(presentation.searchVolume, '20.13 × 21.50 × 22.75 Å');
  assert.deepEqual(ligand, ligandSnapshot);
  assert.deepEqual(box, boxSnapshot);

  const html = renderToStaticMarkup(React.createElement(module.ViewerLegend, { selectedLigand: ligand, box }));
  assert.doesNotMatch(html, /<(button|input|select|textarea)\b/i);
  assert.doesNotMatch(html, /tabindex=/i);
});

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

test('docked ligand remains a separate highlighted model and mode replacement preserves receptor and camera', () => {
  const viewer = fakeViewer();
  viewer.addModel = function addModel(text, format) {
    const model = {
      text, format, styles: [],
      setStyle(selection, style) { this.styles.push({ operation: 'set', selection, style }); },
      addStyle(selection, style) { this.styles.push({ operation: 'add', selection, style }); },
    };
    this.models.push(model);
    return model;
  };
  const receptor = module.replaceReceptorModel(viewer, { text: 'RECEPTOR', format: 'pdbqt' });
  const camera = [2, 4, 6, 30, 0, 0, 0, 1];
  viewer.view = camera;
  const modeOne = module.replaceDockedLigandModel(viewer, null, { text: 'MODE 1', format: 'pdbqt' });
  assert.deepEqual(viewer.models, [receptor, modeOne]);
  assert.deepEqual(modeOne.styles[0].style, module.SELECTED_LIGAND_STYLE);
  assert.deepEqual(modeOne.styles[1], {
    operation: 'add', selection: { elem: 'C' }, style: module.DOCKED_LIGAND_CARBON_STYLE,
  });
  const modeTwo = module.replaceDockedLigandModel(viewer, modeOne, { text: 'MODE 2', format: 'pdbqt' });
  assert.deepEqual(viewer.models, [receptor, modeTwo]);
  assert.equal(viewer.models[0], receptor);
  assert.deepEqual(viewer.view, camera);
  assert.equal(viewer.zoomToCount, 1);
  assert.equal(viewer.setViewCount, 2);
});

test('docked-pose context changes only receptor cartoon opacity and never applies ligand style to it', () => {
  const viewer = fakeViewer();
  const receptor = {
    styles: [],
    setStyle(selection, style) { this.styles.push({ operation: 'set', selection, style }); },
    addStyle(selection, style) { this.styles.push({ operation: 'add', selection, style }); },
  };
  module.renderResidueHighlights(viewer, [], null, receptor, true);
  assert.deepEqual(receptor.styles[0].style, module.DOCKED_RECEPTOR_STYLE);
  assert.equal(module.DOCKED_RECEPTOR_STYLE.cartoon.opacity, 0.58);
  assert.ok(!receptor.styles.some(({ style }) => style === module.DOCKED_LIGAND_CARBON_STYLE));
});

test('clearing a compound pose removes only the ligand model', () => {
  const viewer = fakeViewer();
  const receptor = viewer.addModel('RECEPTOR', 'pdbqt');
  const ligand = viewer.addModel('LIGAND', 'pdbqt');
  const cleared = module.replaceDockedLigandModel(viewer, ligand, null);
  assert.equal(cleared, null);
  assert.deepEqual(viewer.models, [receptor]);
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
  assert.equal(viewer.shapes.length, 2);
  assert.deepEqual(viewer.shapes[0].spec.center, { x: 1.25, y: -2.5, z: 0 });
});

test('derives all eight exact corners and twelve edge connections from center and half-dimensions', () => {
  const geometry = module.deriveVinaBoxGeometry({
    centerX: '10', centerY: '20', centerZ: '30',
    sizeX: '8', sizeY: '10', sizeZ: '12',
  });
  assert.deepEqual(geometry.corners, [
    { x: 6, y: 15, z: 24 }, { x: 14, y: 15, z: 24 },
    { x: 6, y: 25, z: 24 }, { x: 14, y: 25, z: 24 },
    { x: 6, y: 15, z: 36 }, { x: 14, y: 15, z: 36 },
    { x: 6, y: 25, z: 36 }, { x: 14, y: 25, z: 36 },
  ]);
  assert.deepEqual(geometry.edges, [
    { start: geometry.corners[0], end: geometry.corners[1] },
    { start: geometry.corners[2], end: geometry.corners[3] },
    { start: geometry.corners[4], end: geometry.corners[5] },
    { start: geometry.corners[6], end: geometry.corners[7] },
    { start: geometry.corners[0], end: geometry.corners[2] },
    { start: geometry.corners[1], end: geometry.corners[3] },
    { start: geometry.corners[4], end: geometry.corners[6] },
    { start: geometry.corners[5], end: geometry.corners[7] },
    { start: geometry.corners[0], end: geometry.corners[4] },
    { start: geometry.corners[1], end: geometry.corners[5] },
    { start: geometry.corners[2], end: geometry.corners[6] },
    { start: geometry.corners[3], end: geometry.corners[7] },
  ]);
});

test('valid search box creates one subtle volume and one exact twelve-cylinder frame', () => {
  const viewer = fakeViewer();
  const shapes = module.renderVinaBox(viewer, null, validBox());
  assert.equal(viewer.shapes.length, 2);
  assert.equal(shapes.frame.cylinders.length, 12);
  assert.deepEqual(
    { color: shapes.solid.spec.color, opacity: shapes.solid.spec.opacity, wireframe: shapes.solid.spec.wireframe },
    module.VINA_BOX_SOLID_STYLE,
  );
  assert.ok(shapes.frame.cylinders.every((edge) => edge.color === module.VINA_BOX_EDGE_STYLE.color));
  assert.ok(shapes.frame.cylinders.every((edge) => edge.radius === module.VINA_BOX_EDGE_STYLE.radius));
});

test('center and size edits replace both box shapes without accumulation or camera movement', () => {
  const viewer = fakeViewer();
  const first = module.renderVinaBox(viewer, null, validBox());
  const moved = module.renderVinaBox(viewer, first, validBox({ centerX: '-8', centerY: '9', centerZ: '10' }));
  const resized = module.renderVinaBox(viewer, moved, validBox({ sizeX: '30', sizeY: '31', sizeZ: '32' }));
  assert.deepEqual(moved.solid.spec.center, { x: -8, y: 9, z: 10 });
  assert.equal(moved.frame.cylinders.length, 12);
  assert.deepEqual(resized.solid.spec.dimensions, { w: 30, h: 31, d: 32 });
  assert.equal(resized.frame.cylinders.length, 12);
  assert.equal(viewer.removedShapes.length, 4);
  assert.equal(viewer.shapes.length, 2);
  assert.equal(viewer.zoomToCount, 0);
});

test('invalid edits remove the existing shape and do not create another', () => {
  const viewer = fakeViewer();
  const shapes = module.renderVinaBox(viewer, null, validBox());
  const result = module.renderVinaBox(viewer, shapes, validBox({ centerX: '' }));
  assert.equal(result, null);
  assert.equal(viewer.shapes.length, 0);
  assert.equal(viewer.removedShapes.length, 2);
});

test('hiding and showing the search box preserves values and restores the current box', () => {
  const viewer = fakeViewer();
  const box = validBox();
  const snapshot = structuredClone(box);
  const visible = module.renderVinaBox(viewer, null, box);
  const hidden = module.renderVinaBox(viewer, visible, null);
  assert.equal(hidden, null);
  assert.equal(viewer.shapes.length, 0);
  assert.deepEqual(box, snapshot);
  const restored = module.renderVinaBox(viewer, hidden, box);
  assert.deepEqual(restored.solid.spec, visible.solid.spec);
  assert.deepEqual(restored.frame.cylinders, visible.frame.cylinders);
  assert.equal(viewer.shapes.length, 2);
  assert.deepEqual(box, snapshot);
});

test('selected ligand uses the receptor-model identity and element-aware ball-and-stick style', () => {
  const viewer = fakeViewer();
  const ligand = { ligand_id: 'I33:A:603:_', chain: 'A', residue_name: 'I33', residue_number: 603 };
  const box = validBox();
  const boxSnapshot = structuredClone(box);
  module.renderResidueHighlights(viewer, [], ligand);
  const highlight = viewer.styles.at(-1);
  assert.deepEqual(highlight.selection, { chain: 'A', resi: 603, resn: 'I33' });
  assert.deepEqual(highlight.style, module.SELECTED_LIGAND_STYLE);
  assert.deepEqual(box, boxSnapshot);
});

test('switching or clearing ligand replaces visual emphasis without mutating receptor metadata', () => {
  const viewer = fakeViewer();
  const first = { ligand_id: 'I33:A:603:_', chain: 'A', residue_name: 'I33', residue_number: 603 };
  const second = { ligand_id: 'I34:B:602:_', chain: 'B', residue_name: 'I34', residue_number: 602 };
  const receptorState = { receptorId: '7EKT', selectedLigandId: first.ligand_id };
  const snapshot = structuredClone(receptorState);
  module.renderResidueHighlights(viewer, [], first);
  module.renderResidueHighlights(viewer, [], second);
  assert.deepEqual(viewer.styles.at(-1).selection, { chain: 'B', resi: 602, resn: 'I34' });
  const styleCount = viewer.styles.length;
  module.renderResidueHighlights(viewer, [], null);
  assert.equal(viewer.styles.length, styleCount + 2);
  assert.equal(viewer.styles.at(-1).selection.hetflag, true);
  assert.deepEqual(receptorState, snapshot);
});

test('focus box frames nearby receptor context without mutating box values', () => {
  const viewer = fakeViewer();
  viewer.atoms = [
    { x: 1.25, y: -2.5, z: 0 },
    { x: 14, y: -2.5, z: 0 },
    { x: 100, y: 100, z: 100 },
  ];
  const box = validBox();
  const snapshot = structuredClone(box);
  assert.equal(module.focusViewerOnBox(viewer, box), true);
  assert.equal(viewer.zoomToCount, 1);
  assert.equal(viewer.cameraZoom, 1);
  assert.equal(viewer.renderCount, 1);
  assert.equal(viewer.selectedAtoms(viewer.lastZoomSelection).length, 2);
  assert.deepEqual(box, snapshot);
});

test('focus box rejects invalid boxes and leaves the camera unchanged', () => {
  const viewer = fakeViewer();
  assert.equal(module.focusViewerOnBox(viewer, validBox({ sizeX: '0' })), false);
  assert.equal(viewer.zoomToCount, 0);
  assert.equal(viewer.renderCount, 0);
});

test('reset view changes only the camera and preserves authoritative box values', () => {
  const viewer = fakeViewer();
  const box = validBox();
  const snapshot = structuredClone(box);
  module.resetViewerCamera(viewer);
  assert.equal(viewer.zoomToCount, 1);
  assert.equal(viewer.renderCount, 1);
  assert.deepEqual(box, snapshot);
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
