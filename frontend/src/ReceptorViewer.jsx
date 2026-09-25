import React, {
  forwardRef, useEffect, useImperativeHandle, useRef, useState,
} from 'react';
import { Box, Typography } from '@mui/material';

const RECEPTOR_STYLE = { cartoon: { color: 'spectrum' } };
const HETERO_STYLE = { stick: { radius: 0.13, colorscheme: 'Jmol' } };
const SELECTION_STYLE = { stick: { radius: 0.28, color: '#df6c3b' } };
export const SELECTED_LIGAND_STYLE = {
  stick: { radius: 0.4, colorscheme: 'Jmol' },
  sphere: { scale: 0.38, colorscheme: 'Jmol' },
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

export function replaceReceptorModel(viewer, structure, onAtomSelect = () => {}, options = {}) {
  const preservedView = options.preserveCamera && typeof viewer.getView === 'function'
    ? viewer.getView() : null;
  viewer.removeAllModels();
  const model = viewer.addModel(structure.text, structure.format);
  viewer.setStyle({}, RECEPTOR_STYLE);
  viewer.addStyle({ hetflag: true }, HETERO_STYLE);
  viewer.setClickable({}, true, onAtomSelect);
  if (preservedView && typeof viewer.setView === 'function') viewer.setView(preservedView);
  else viewer.zoomTo();
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

export function viewerLegendPresentation(selectedLigand, box) {
  const vinaBox = toVinaBoxSpec(box);
  return {
    ligand: selectedLigand
      ? `${selectedLigand.residue_name || '–'} · Chain ${selectedLigand.chain || '–'} · Residue ${selectedLigand.residue_number ?? '–'}`
      : 'None',
    searchVolume: vinaBox
      ? `${formatLegendDimension(vinaBox.dimensions.w)} × ${formatLegendDimension(vinaBox.dimensions.h)} × ${formatLegendDimension(vinaBox.dimensions.d)} Å`
      : 'Not defined',
  };
}

export function ViewerLegend({ selectedLigand, box }) {
  const presentation = viewerLegendPresentation(selectedLigand, box);
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

export function renderResidueHighlights(viewer, selectedResidues = [], selectedLigand = null) {
  viewer.setStyle({}, RECEPTOR_STYLE);
  viewer.addStyle({ hetflag: true }, HETERO_STYLE);
  selectedResidues.forEach((residue) => viewer.addStyle(
    { chain: residue.chain, resi: residue.residueNumber, resn: residue.residueName },
    SELECTION_STYLE,
  ));
  const selectedLigandAtoms = ligandSelection(selectedLigand);
  if (selectedLigandAtoms) viewer.addStyle(selectedLigandAtoms, SELECTED_LIGAND_STYLE);
  viewer.render();
}

export function observeViewerResize(host, viewer, ResizeObserverClass = globalThis.ResizeObserver) {
  if (!host || !viewer || typeof ResizeObserverClass !== 'function') return () => {};
  const observer = new ResizeObserverClass(() => {
    viewer.resize();
    viewer.render();
  });
  observer.observe(host);
  return () => observer.disconnect();
}

const ReceptorViewer = forwardRef(function ReceptorViewer({
  structure,
  box,
  showBox = true,
  selectedResidues,
  selectedLigand,
  onAtomSelect,
  onError,
}, ref) {
  const hostRef = useRef(null);
  const viewerRef = useRef(null);
  const boxShapeRef = useRef(null);
  const onAtomSelectRef = useRef(onAtomSelect);
  const onErrorRef = useRef(onError);
  const renderedReceptorIdRef = useRef('');
  const [viewerGeneration, setViewerGeneration] = useState(0);
  const artifactIdentity = receptorStructureIdentity(structure);

  useEffect(() => { onAtomSelectRef.current = onAtomSelect; }, [onAtomSelect]);
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
      if (viewer) viewer.clear();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !structure) return;
    const receptorId = structure.identity?.receptorId || '';
    replaceReceptorModel(
      viewer,
      structure,
      (atom) => onAtomSelectRef.current?.(atom),
      { preserveCamera: Boolean(receptorId && receptorId === renderedReceptorIdRef.current) },
    );
    renderedReceptorIdRef.current = receptorId;
  }, [artifactIdentity, viewerGeneration]);

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
    renderResidueHighlights(viewer, selectedResidues, selectedLigand);
  }, [selectedResidues, selectedLigand, artifactIdentity, viewerGeneration]);

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
          height: 430,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          overflow: 'hidden',
          bgcolor: '#f7f9fb',
        }}
      />
      <ViewerLegend selectedLigand={selectedLigand} box={box} />
      {!structure ? (
        <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
          <Typography color="text.secondary">Upload a PDB or prepared PDBQT to view the receptor.</Typography>
        </Box>
      ) : null}
    </Box>
  );
});

export default ReceptorViewer;
