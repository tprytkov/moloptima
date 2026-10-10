import React, { useEffect, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';

const THUMBNAIL_STYLE = {
  stick: { radius: 0.16, colorscheme: 'Jmol' },
  sphere: { scale: 0.3, colorscheme: 'Jmol' },
};

export async function createMoleculeThumbnailViewer(
  host,
  molBlock,
  load3Dmol = () => import('3dmol/build/3Dmol.es6.js'),
) {
  const { createViewer } = await load3Dmol();
  const viewer = createViewer(host, { backgroundColor: '#ffffff', antialias: true });
  const model = viewer.addModel(molBlock, 'sdf');
  if (typeof model?.setStyle === 'function') model.setStyle({}, THUMBNAIL_STYLE);
  else viewer.setStyle({}, THUMBNAIL_STYLE);
  viewer.zoomTo();
  viewer.zoom(1.35);
  viewer.render();
  return viewer;
}

export function structure3dUrl(baseUrl, smiles) {
  return `${baseUrl}/api/molecules/structure-3d?${new URLSearchParams({ smiles })}`;
}

export default function MoleculeStructureThumbnail({ baseUrl, moleculeId, smiles }) {
  const hostRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState(smiles ? 'waiting' : 'unavailable');
  const label = `3D structure preview for ${moleculeId || 'molecule'}`;

  useEffect(() => {
    if (!smiles || !hostRef.current) return undefined;
    if (typeof IntersectionObserver !== 'function') {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '160px' });
    observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, [smiles]);

  useEffect(() => {
    if (!visible || !smiles || !hostRef.current) return undefined;
    const controller = new AbortController();
    let viewer;
    let disposed = false;
    setStatus('loading');
    fetch(structure3dUrl(baseUrl, smiles), { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Structure preview returned HTTP ${response.status}`);
        return response.text();
      })
      .then((molBlock) => createMoleculeThumbnailViewer(hostRef.current, molBlock))
      .then((createdViewer) => {
        if (disposed) createdViewer.clear();
        else {
          viewer = createdViewer;
          setStatus('ready');
        }
      })
      .catch((error) => {
        if (!disposed && error.name !== 'AbortError') setStatus('unavailable');
      });
    return () => {
      disposed = true;
      controller.abort();
      viewer?.clear();
    };
  }, [baseUrl, smiles, visible]);

  return (
    <Box
      role="img"
      aria-label={label}
      data-testid="molecule-structure-thumbnail"
      sx={{
        position: 'relative',
        width: 120,
        height: 90,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        overflow: 'hidden',
        bgcolor: '#fff',
      }}
    >
      <Box ref={hostRef} aria-hidden="true" sx={{ position: 'absolute', inset: 0 }} />
      {status !== 'ready' ? (
        <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', px: 1 }}>
          <Typography variant="caption" color="text.secondary" textAlign="center">
            {status === 'unavailable' ? 'Unavailable' : status === 'loading' ? 'Loading 3D…' : '3D preview'}
          </Typography>
        </Box>
      ) : null}
    </Box>
  );
}
