import React, {
  forwardRef, useEffect, useImperativeHandle, useRef, useState,
} from 'react';
import { Box, Typography } from '@mui/material';

const RECEPTOR_STYLE = { cartoon: { color: 'spectrum' } };
const HETERO_STYLE = { stick: { radius: 0.22, colorscheme: 'Jmol' } };
const SELECTION_STYLE = { stick: { radius: 0.28, color: '#df6c3b' } };

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

export function renderVinaBox(viewer, previousShape, box) {
  if (previousShape) viewer.removeShape(previousShape);
  const spec = toVinaBoxSpec(box);
  const shape = spec ? viewer.addBox({
    ...spec,
    color: '#df6c3b',
    opacity: 0.22,
    wireframe: true,
  }) : null;
  viewer.render();
  return shape;
}

export function renderResidueHighlights(viewer, selectedResidues = []) {
  viewer.setStyle({}, RECEPTOR_STYLE);
  viewer.addStyle({ hetflag: true }, HETERO_STYLE);
  selectedResidues.forEach((residue) => viewer.addStyle(
    { chain: residue.chain, resi: residue.residueNumber, resn: residue.residueName },
    SELECTION_STYLE,
  ));
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
  selectedResidues,
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
  }), []);

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
    boxShapeRef.current = renderVinaBox(viewer, boxShapeRef.current, structure ? box : null);
  }, [box, artifactIdentity, viewerGeneration]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !structure) return;
    renderResidueHighlights(viewer, selectedResidues);
  }, [selectedResidues, artifactIdentity, viewerGeneration]);

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
      {!structure ? (
        <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
          <Typography color="text.secondary">Upload a PDB or prepared PDBQT to view the receptor.</Typography>
        </Box>
      ) : null}
    </Box>
  );
});

export default ReceptorViewer;
