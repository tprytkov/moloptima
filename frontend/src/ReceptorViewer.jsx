import React, {
  forwardRef, useEffect, useImperativeHandle, useRef, useState,
} from 'react';
import { Box, Typography } from '@mui/material';
import { canonicalInteractionToken, INTERACTION_STYLES } from './interactionVisualization.js';

const RECEPTOR_STYLE = { cartoon: { color: 'spectrum' } };
export const DOCKED_RECEPTOR_STYLE = { cartoon: { color: 'spectrum', opacity: 0.58 } };
const HETERO_STYLE = { stick: { radius: 0.13, colorscheme: 'Jmol' } };
const SELECTION_STYLE = { stick: { radius: 0.28, color: '#df6c3b' } };
export const SELECTED_LIGAND_STYLE = {
  stick: { radius: 0.48, colorscheme: 'Jmol' },
  sphere: { scale: 0.58, colorscheme: 'Jmol' },
};
export const DOCKED_LIGAND_CARBON_STYLE = {
  stick: { radius: 0.48, color: '#df6c3b' },
  sphere: { scale: 0.58, color: '#df6c3b' },
};
export const VINA_BOX_SOLID_STYLE = { color: '#df6c3b', opacity: 0.08, wireframe: false };
export const VINA_BOX_EDGE_STYLE = {
  color: '#20262e', radius: 0.16, fromCap: 2, toCap: 2,
};
const BOX_FOCUS_MARGIN = 4;
const BOX_EDGE_INDICES = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

export function toVinaBoxSpec(box) {
  if (!box) return null;
  const inputs = [box.centerX, box.centerY, box.centerZ, box.sizeX, box.sizeY, box.sizeZ];
  if (inputs.some((value) => value === '' || value === null || value === undefined)) return null;
  const values = inputs.map(Number);
  if (!values.every(Number.isFinite) || values.slice(3).some((value) => value <= 0)) return null;
  return {
    center: { x: values[0], y: values[1], z: values[2] },
    dimensions: { w: values[3], h: values[4], d: values[5] },
  };
}

export function deriveVinaBoxGeometry(box) {
  const spec = toVinaBoxSpec(box);
  if (!spec) return null;
  const { center, dimensions } = spec;
  const x = [center.x - dimensions.w / 2, center.x + dimensions.w / 2];
  const y = [center.y - dimensions.h / 2, center.y + dimensions.h / 2];
  const z = [center.z - dimensions.d / 2, center.z + dimensions.d / 2];
  const corners = [
    { x: x[0], y: y[0], z: z[0] }, { x: x[1], y: y[0], z: z[0] },
    { x: x[0], y: y[1], z: z[0] }, { x: x[1], y: y[1], z: z[0] },
    { x: x[0], y: y[0], z: z[1] }, { x: x[1], y: y[0], z: z[1] },
    { x: x[0], y: y[1], z: z[1] }, { x: x[1], y: y[1], z: z[1] },
  ];
  return {
    ...spec,
    corners,
    edges: BOX_EDGE_INDICES.map(([start, end]) => ({
      start: corners[start], end: corners[end],
    })),
  };
}

export async function createReceptorViewer(host, load3Dmol = () => import('3dmol/build/3Dmol.es6.js')) {
  const { createViewer } = await load3Dmol();
  return createViewer(host, { backgroundColor: '#f7f9fb' });
}

export function receptorStructureIdentity(structure) {
  if (!structure) return '';
  const identity = structure.identity ?? {};
  if (!identity.receptorId && !identity.artifactSha256) return `${structure.format}:${structure.text}`;
  return [
    identity.receptorId || '', identity.representation || '', identity.preparationId || '',
    identity.artifactSha256 || '', identity.dockingReceptorSha256 || '',
  ].join(':');
}

export function dockedLigandStructureIdentity(structure) {
  if (!structure) return '';
  const identity = structure.identity ?? {};
  return [
    identity.moleculeId || '', identity.poseSha256 || '', identity.mode || '',
  ].join(':');
}

function setModelStyle(model, fallbackViewer, selection, style, operation = 'setStyle') {
  if (model && typeof model[operation] === 'function') model[operation](selection, style);
  else fallbackViewer[operation](selection, style);
}

export function replaceReceptorModel(viewer, structure, onAtomSelect = () => {}, options = {}) {
  const preservedView = options.preserveCamera && typeof viewer.getView === 'function'
    ? viewer.getView() : null;
  viewer.removeAllModels();
  const model = viewer.addModel(structure.text, structure.format);
  setModelStyle(model, viewer, {}, RECEPTOR_STYLE);
  setModelStyle(model, viewer, { hetflag: true }, HETERO_STYLE, 'addStyle');
  viewer.setClickable({}, true, onAtomSelect);
  if (preservedView && typeof viewer.setView === 'function') viewer.setView(preservedView);
  else viewer.zoomTo();
  viewer.render();
  return model;
}

export function replaceDockedLigandModel(viewer, previousModel, structure) {
  const preservedView = typeof viewer.getView === 'function' ? viewer.getView() : null;
  if (previousModel && typeof viewer.removeModel === 'function') viewer.removeModel(previousModel);
  if (!structure) {
    if (preservedView && typeof viewer.setView === 'function') viewer.setView(preservedView);
    viewer.render();
    return null;
  }
  const model = viewer.addModel(structure.text, structure.format || 'pdbqt');
  setModelStyle(model, viewer, {}, SELECTED_LIGAND_STYLE);
  setModelStyle(model, viewer, { elem: 'C' }, DOCKED_LIGAND_CARBON_STYLE, 'addStyle');
  if (preservedView && typeof viewer.setView === 'function') viewer.setView(preservedView);
  viewer.render();
  return model;
}

export function renderVinaBox(viewer, previousShapes, box) {
  if (previousShapes?.solid) viewer.removeShape(previousShapes.solid);
  if (previousShapes?.frame) viewer.removeShape(previousShapes.frame);
  const geometry = deriveVinaBoxGeometry(box);
  let shapes = null;
  if (geometry) {
    const solid = viewer.addBox({
      center: geometry.center,
      dimensions: geometry.dimensions,
      ...VINA_BOX_SOLID_STYLE,
    });
    const frame = viewer.addShape({ color: VINA_BOX_EDGE_STYLE.color, opacity: 1 });
    geometry.edges.forEach((edge) => frame.addCylinder({ ...edge, ...VINA_BOX_EDGE_STYLE }));
    shapes = { solid, frame };
  }
  viewer.render();
  return shapes;
}

export function resetViewerCamera(viewer) {
  if (!viewer) return;
  viewer.zoomTo();
  viewer.render();
}

export function focusViewerOnBox(viewer, box) {
  const spec = toVinaBoxSpec(box);
  if (!viewer || !spec) return false;
  const { center, dimensions } = spec;
  const halfWidth = dimensions.w / 2 + BOX_FOCUS_MARGIN;
  const halfHeight = dimensions.h / 2 + BOX_FOCUS_MARGIN;
  const halfDepth = dimensions.d / 2 + BOX_FOCUS_MARGIN;
  const selection = {
    predicate: (atom) => Math.abs(atom.x - center.x) <= halfWidth
      && Math.abs(atom.y - center.y) <= halfHeight
      && Math.abs(atom.z - center.z) <= halfDepth,
  };
  if (!viewer.selectedAtoms(selection).length) return false;
  viewer.zoomTo(selection);
  viewer.zoom(0.65);
  viewer.render();
  return true;
}

export function ligandSelection(selectedLigand) {
  if (!selectedLigand) return null;
  return {
    chain: selectedLigand.chain,
    resi: selectedLigand.residue_number,
    resn: selectedLigand.residue_name,
  };
}

export function formatLegendDimension(value) {
  return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
}

export function viewerLegendPresentation(selectedLigand, box, dockedLigand = null) {
  const vinaBox = toVinaBoxSpec(box);
  return {
    ligand: dockedLigand
      ? `${dockedLigand.moleculeId || 'Docked ligand'} · Mode ${dockedLigand.mode ?? '–'}`
      : selectedLigand
      ? `${selectedLigand.residue_name || '–'} · Chain ${selectedLigand.chain || '–'} · Residue ${selectedLigand.residue_number ?? '–'}`
      : 'None',
    searchVolume: vinaBox
      ? `${formatLegendDimension(vinaBox.dimensions.w)} × ${formatLegendDimension(vinaBox.dimensions.h)} × ${formatLegendDimension(vinaBox.dimensions.d)} Å`
      : 'Not defined',
  };
}

export function ViewerLegend({ selectedLigand, box, dockedLigand }) {
  const presentation = viewerLegendPresentation(selectedLigand, box, dockedLigand);
  return (
    <Box
      component="aside"
      aria-label="Receptor viewer legend"
      data-testid="receptor-viewer-legend"
      sx={{
        position: 'absolute',
        top: 12,
        left: 12,
        zIndex: 1,
        maxWidth: 'calc(100% - 24px)',
        px: 1.25,
        py: 1,
        border: '1px solid',
        borderColor: 'rgba(32, 38, 46, 0.18)',
        borderRadius: 1,
        bgcolor: 'rgba(247, 249, 251, 0.92)',
        boxShadow: '0 1px 3px rgba(32, 38, 46, 0.10)',
        pointerEvents: 'none',
      }}
    >
      <Box sx={{ display: 'grid', gridTemplateColumns: '12px minmax(0, 1fr)', columnGap: 0.75, rowGap: 0.75 }}>
        <Box
          aria-hidden="true"
          sx={{
            width: 10,
            height: 10,
            mt: 0.3,
            border: '1px solid rgba(32, 38, 46, 0.65)',
            borderRadius: '50%',
            background: 'conic-gradient(#d32f2f 0 25%, #1976d2 25% 50%, #4f7c55 50% 75%, #5d4037 75%)',
          }}
        />
        <Box>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.2 }}>
            Highlighted ligand
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.35 }}>
            {presentation.ligand}
          </Typography>
        </Box>
        <Box
          aria-hidden="true"
          sx={{
            width: 11,
            height: 9,
            mt: 0.3,
            border: '1.5px solid #20262e',
            bgcolor: 'rgba(223, 108, 59, 0.08)',
          }}
        />
        <Box>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.2 }}>
            Vina search volume
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.35 }}>
            {presentation.searchVolume}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

export function renderResidueHighlights(
  viewer, selectedResidues = [], selectedLigand = null, receptorModel = null, showDockedLigand = false,
) {
  setModelStyle(receptorModel, viewer, {}, showDockedLigand ? DOCKED_RECEPTOR_STYLE : RECEPTOR_STYLE);
  setModelStyle(receptorModel, viewer, { hetflag: true }, HETERO_STYLE, 'addStyle');
  selectedResidues.forEach((residue) => setModelStyle(receptorModel, viewer,
    { chain: residue.chain, resi: residue.residueNumber, resn: residue.residueName },
    SELECTION_STYLE,
    'addStyle',
  ));
  const selectedLigandAtoms = ligandSelection(selectedLigand);
  if (selectedLigandAtoms) setModelStyle(
    receptorModel, viewer, selectedLigandAtoms, SELECTED_LIGAND_STYLE, 'addStyle',
  );
  viewer.render();
}

export function observeViewerResize(host, viewer, ResizeObserverClass = globalThis.ResizeObserver) {
  if (!host || !viewer || typeof ResizeObserverClass !== 'function') return () => {};
  const observer = new ResizeObserverClass(() => {
    if (!host.isConnected || host.clientWidth < 1 || host.clientHeight < 1) return;
    viewer.resize();
    viewer.render();
  });
  observer.observe(host);
  return () => observer.disconnect();
}

function atomPoint(atom) {
  return atom && [atom.x, atom.y, atom.z].every((value) => Number.isFinite(Number(value)))
    ? { x: Number(atom.x), y: Number(atom.y), z: Number(atom.z) } : null;
}

function centroid(atoms) {
  const points = atoms.map(atomPoint).filter(Boolean);
  if (!points.length) return null;
  return points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length, z: sum.z + point.z / points.length }), { x: 0, y: 0, z: 0 });
}

export function resolveInteractionEndpoints(receptorModel, ligandModel, record = {}) {
  const receptorSerials = (record.receptor?.atoms || []).map((atom) => Number(atom.atom_serial)).filter(Number.isFinite);
  const ligandSerials = (record.ligand?.pose_atoms || []).map((atom) => Number(atom.pose_atom_serial)).filter(Number.isFinite);
  if (!receptorSerials.length || !ligandSerials.length) return null;
  const proteinAtoms = receptorModel?.selectedAtoms?.({ predicate: (atom) => receptorSerials.includes(Number(atom.serial)) }) || [];
  const ligandAtoms = ligandModel?.selectedAtoms?.({ predicate: (atom) => ligandSerials.includes(Number(atom.serial)) }) || [];
  const start = centroid(proteinAtoms.filter((atom) => receptorSerials.includes(Number(atom.serial))));
  const end = centroid(ligandAtoms.filter((atom) => ligandSerials.includes(Number(atom.serial))));
  return start && end ? { start, end, proteinAtoms, ligandAtoms } : null;
}

function interpolate(start, end, fraction) {
  return { x: start.x + (end.x - start.x) * fraction, y: start.y + (end.y - start.y) * fraction, z: start.z + (end.z - start.z) * fraction };
}

export function renderInteractionConnectors(viewer, previousShapes = [], receptorModel, ligandModel, records = [], selectedToken = '') {
  previousShapes.forEach((shape) => viewer.removeShape?.(shape));
  const shapes = [];
  const diagnostics = [];
  records.forEach((record) => {
    const token = canonicalInteractionToken(record);
    const endpoints = resolveInteractionEndpoints(receptorModel, ligandModel, record);
    if (!endpoints) {
      diagnostics.push({ token, status: 'authoritative_atom_unavailable' });
      return;
    }
    const style = INTERACTION_STYLES[record.interaction_type] || INTERACTION_STYLES.VdWContact;
    const shape = viewer.addShape({ color: style.color, opacity: 1 });
    const segments = style.dash === '3 5' || style.dash === '2 7' ? 5 : style.dash === '1 5' ? 7 : 3;
    for (let index = 0; index < segments; index += 1) {
      const from = index / segments;
      const to = Math.min(1, from + 0.55 / segments);
      shape.addCylinder({
        start: interpolate(endpoints.start, endpoints.end, from),
        end: interpolate(endpoints.start, endpoints.end, to),
        color: style.color,
        radius: (token === selectedToken ? 0.18 : 0.1) * Math.max(1, style.width / 2),
        fromCap: 1, toCap: 1,
      });
    }
    shape.addSphere?.({ center: endpoints.end, radius: token === selectedToken ? 0.3 : 0.2, color: style.color });
    shape.userData = { token, interactionType: record.interaction_type };
    shapes.push(shape);
  });
  viewer.render();
  return { shapes, diagnostics };
}

export function renderQualifiedPocket(viewer, receptorModel, ligandModel, enabled, interactionRecords = [], selectedToken = '') {
  if (!viewer || !receptorModel || !ligandModel) return;
  setModelStyle(receptorModel, viewer, {}, DOCKED_RECEPTOR_STYLE);
  if (enabled) setModelStyle(receptorModel, viewer, {
    byres: true, within: { distance: 8, sel: { model: ligandModel } },
  }, { stick: { radius: 0.14, colorscheme: 'Jmol', opacity: 0.38 } }, 'addStyle');
  const residues = new Map();
  interactionRecords.forEach((record) => {
    const receptor = record.receptor || {};
    const key = `${receptor.chain}:${receptor.residue_name}:${receptor.residue_number}:${receptor.insertion_code || ''}`;
    if (!residues.has(key)) residues.set(key, { receptor, selected: canonicalInteractionToken(record) === selectedToken });
    else if (canonicalInteractionToken(record) === selectedToken) residues.get(key).selected = true;
  });
  residues.forEach(({ receptor, selected }) => setModelStyle(receptorModel, viewer, {
    chain: receptor.chain, resn: receptor.residue_name, resi: receptor.residue_number,
  }, { stick: { radius: selected ? 0.34 : 0.24, color: selected ? '#126d5b' : '#df6c3b' } }, 'addStyle'));
}

export async function renderViewerPngAtResolution(viewer, host, width, height, transparent = false) {
  if (!viewer || !host || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('A valid viewer and output dimensions are required.');
  }
  const view = viewer.getView?.();
  const previous = { width: host.style.width, height: host.style.height };
  host.style.width = `${width}px`; host.style.height = `${height}px`;
  try {
    viewer.setBackgroundColor?.('#ffffff', transparent ? 0 : 1);
    viewer.resize();
    if (view) viewer.setView(view);
    viewer.render();
    const uri = await Promise.resolve(viewer.pngURI());
    return { uri, width, height };
  } finally {
    host.style.width = previous.width; host.style.height = previous.height;
    viewer.setBackgroundColor?.('#f7f9fb', 1);
    viewer.resize();
    if (view) viewer.setView(view);
    viewer.render();
  }
}

const ReceptorViewer = forwardRef(function ReceptorViewer({
  structure,
  box,
  showBox = true,
  selectedResidues,
  selectedLigand,
  dockedLigand,
  onAtomSelect,
  onLigandRender,
  onError,
  interactionRecords = [],
  selectedInteractionToken = '',
  pocketMode = 'interactions',
  viewerAspectRatio = '',
}, ref) {
  const hostRef = useRef(null);
  const viewerRef = useRef(null);
  const receptorModelRef = useRef(null);
  const ligandModelRef = useRef(null);
  const boxShapeRef = useRef(null);
  const interactionShapesRef = useRef([]);
  const onAtomSelectRef = useRef(onAtomSelect);
  const onLigandRenderRef = useRef(onLigandRender);
  const onErrorRef = useRef(onError);
  const renderedReceptorIdRef = useRef('');
  const [viewerGeneration, setViewerGeneration] = useState(0);
  const artifactIdentity = receptorStructureIdentity(structure);
  const dockedLigandIdentity = dockedLigandStructureIdentity(dockedLigand);
  const hasDockedLigand = Boolean(dockedLigand);

  useEffect(() => { onAtomSelectRef.current = onAtomSelect; }, [onAtomSelect]);
  useEffect(() => { onLigandRenderRef.current = onLigandRender; }, [onLigandRender]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  useImperativeHandle(ref, () => ({
    selectedAtoms(selection) {
      return viewerRef.current?.selectedAtoms(selection) ?? [];
    },
    resetView() {
      resetViewerCamera(viewerRef.current);
    },
    focusBox() {
      return focusViewerOnBox(viewerRef.current, box);
    },
    exportPng(width, height, transparent = false) {
      return renderViewerPngAtResolution(viewerRef.current, hostRef.current, width, height, transparent);
    },
    aspectRatio() {
      const width = hostRef.current?.clientWidth;
      const height = hostRef.current?.clientHeight;
      return width && height ? width / height : 16 / 9;
    },
  }), [box]);

  useEffect(() => {
    let disposed = false;
    let viewer;
    createReceptorViewer(hostRef.current)
      .then((createdViewer) => {
        if (disposed) {
          createdViewer.clear();
          return;
        }
        viewer = createdViewer;
        viewerRef.current = viewer;
        setViewerGeneration((current) => current + 1);
      })
      .catch((viewerError) => {
        if (!disposed) onErrorRef.current?.(viewerError);
      });
    return () => {
      disposed = true;
      boxShapeRef.current = null;
      receptorModelRef.current = null;
      ligandModelRef.current = null;
      interactionShapesRef.current = [];
      if (viewer) viewer.clear();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !structure) return;
    const receptorId = structure.identity?.receptorId || '';
    receptorModelRef.current = replaceReceptorModel(
      viewer,
      structure,
      (atom) => onAtomSelectRef.current?.(atom),
      { preserveCamera: Boolean(receptorId && receptorId === renderedReceptorIdRef.current) },
    );
    ligandModelRef.current = null;
    renderedReceptorIdRef.current = receptorId;
  }, [artifactIdentity, viewerGeneration]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const started = performance.now();
    ligandModelRef.current = replaceDockedLigandModel(
      viewer,
      ligandModelRef.current,
      structure ? dockedLigand : null,
    );
    onLigandRenderRef.current?.({
      durationMs: performance.now() - started,
      mode: dockedLigand?.identity?.mode ?? null,
    });
  }, [artifactIdentity, dockedLigandIdentity, viewerGeneration]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    boxShapeRef.current = renderVinaBox(
      viewer,
      boxShapeRef.current,
      structure && showBox ? box : null,
    );
  }, [box, showBox, artifactIdentity, viewerGeneration]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !structure) return;
    renderResidueHighlights(
      viewer, selectedResidues, selectedLigand, receptorModelRef.current, hasDockedLigand,
    );
  }, [selectedResidues, selectedLigand, hasDockedLigand, artifactIdentity, viewerGeneration]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !receptorModelRef.current || !ligandModelRef.current) return;
    renderQualifiedPocket(
      viewer, receptorModelRef.current, ligandModelRef.current, pocketMode === 'pocket',
      interactionRecords, selectedInteractionToken,
    );
    const rendered = renderInteractionConnectors(
      viewer, interactionShapesRef.current, receptorModelRef.current, ligandModelRef.current,
      interactionRecords, selectedInteractionToken,
    );
    interactionShapesRef.current = rendered.shapes;
  }, [interactionRecords, selectedInteractionToken, pocketMode, artifactIdentity, dockedLigandIdentity, viewerGeneration]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return undefined;
    return observeViewerResize(hostRef.current, viewer);
  }, [viewerGeneration]);

  return (
    <Box sx={{ position: 'relative' }}>
      <Box
        ref={hostRef}
        data-testid="receptor-viewer"
        sx={{
          height: viewerAspectRatio ? 'auto' : 430,
          aspectRatio: viewerAspectRatio || 'auto',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          overflow: 'hidden',
          bgcolor: '#f7f9fb',
        }}
      />
      <ViewerLegend selectedLigand={selectedLigand} dockedLigand={dockedLigand?.identity} box={box} />
      {!structure ? (
        <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
          <Typography color="text.secondary">Upload a PDB or prepared PDBQT to view the receptor.</Typography>
        </Box>
      ) : null}
    </Box>
  );
});

export default ReceptorViewer;
