import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, CircularProgress, FormControlLabel, MenuItem, Paper, Stack,
  Tab, Tabs, TextField, Typography,
} from '@mui/material';
import ReceptorViewer from './ReceptorViewer.jsx';
import { fetchReceptorStructure } from './DockingSetup.jsx';
import { fetchDockingPoseArtifact, selectVinaPoseMode } from './dockingPose.js';
import {
  buildInteractionMapSvg, INTERACTION_STYLES, mapInteractionRecords, MAP_HEIGHT, MAP_WIDTH,
  resolveExportDimensions,
} from './interactionVisualization.js';

const WIDTH_PRESETS = [1920, 2560, 3840, 5120];

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  URL.revokeObjectURL(url);
}

export async function svgToPng(svg, width, height, transparent = false) {
  const image = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!transparent) { context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); }
    context.drawImage(image, 0, 0, width, height);
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}

export async function compose3dPng(uri, options, identity) {
  const image = new Image();
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = uri; });
  const canvas = document.createElement('canvas');
  canvas.width = options.width; canvas.height = options.height;
  const context = canvas.getContext('2d');
  if (!options.transparent) { context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const scale = Math.max(1, canvas.width / 1920);
  if (options.includeTitle) {
    context.fillStyle = options.transparent ? 'rgba(255,255,255,.88)' : 'rgba(255,255,255,.92)';
    context.fillRect(24 * scale, 24 * scale, 680 * scale, 70 * scale);
    context.fillStyle = '#20262e'; context.font = `700 ${19 * scale}px Arial`;
    context.fillText('Predicted protein–ligand interactions', 42 * scale, 52 * scale);
    context.font = `${13 * scale}px Arial`;
    context.fillText(`${identity.moleculeId} · Vina Mode ${identity.mode} · Receptor: ${identity.receptorId}`, 42 * scale, 78 * scale);
  }
  if (options.includeLegend) {
    let x = 34 * scale; let y = canvas.height - 38 * scale;
    context.font = `${11 * scale}px Arial`;
    Object.values(INTERACTION_STYLES).forEach((style, index) => {
      if (index === 5) { x = 34 * scale; y += 18 * scale; }
      context.strokeStyle = style.color; context.lineWidth = style.width * scale;
      context.setLineDash(style.dash.split(' ').map((value) => Number(value) * scale));
      context.beginPath(); context.moveTo(x, y); context.lineTo(x + 28 * scale, y); context.stroke();
      context.setLineDash([]); context.fillStyle = '#20262e';
      context.fillText(`${style.marker} ${style.label}`, x + 35 * scale, y + 4 * scale);
      x += 190 * scale;
    });
  }
  return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export function ExportControls({ kind, aspectRatio, onExport, supportsSvg = false, legendLabel = 'Interaction legend' }) {
  const [width, setWidth] = useState(3840);
  const [customWidth, setCustomWidth] = useState('3840');
  const [includeTitle, setIncludeTitle] = useState(true);
  const [includeLegend, setIncludeLegend] = useState(true);
  const [includeDistances, setIncludeDistances] = useState(true);
  const [transparent, setTransparent] = useState(false);
  const actualWidth = width === 'custom' ? Number(customWidth) : width;
  const dimensions = resolveExportDimensions(actualWidth, aspectRatio);
  const options = { ...dimensions, includeTitle, includeLegend, includeDistances, transparent };
  return (
    <Stack spacing={0.75} aria-label={`${kind} export options`}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
        <TextField select size="small" label="Output width" value={width} onChange={(event) => setWidth(event.target.value === 'custom' ? 'custom' : Number(event.target.value))} sx={{ minWidth: 155 }}>
          {WIDTH_PRESETS.map((value) => <MenuItem key={value} value={value}>{value}px{value === 3840 ? ' · default' : ''}</MenuItem>)}
          <MenuItem value="custom">Custom…</MenuItem>
        </TextField>
        {width === 'custom' ? <TextField size="small" type="number" label="Custom width (px)" value={customWidth} onChange={(event) => setCustomWidth(event.target.value)} inputProps={{ min: 320, max: 8192 }} /> : null}
        <Typography variant="caption" color="text.secondary">{dimensions.width} × {dimensions.height}px · aspect preserved</Typography>
      </Stack>
      <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1}>
        <FormControlLabel control={<Checkbox size="small" checked={includeTitle} onChange={(event) => setIncludeTitle(event.target.checked)} />} label="Title / identity" />
        <FormControlLabel control={<Checkbox size="small" checked={includeLegend} onChange={(event) => setIncludeLegend(event.target.checked)} />} label={legendLabel} />
        {kind === '2D' ? <FormControlLabel control={<Checkbox size="small" checked={includeDistances} onChange={(event) => setIncludeDistances(event.target.checked)} />} label="Distances" /> : null}
        <FormControlLabel control={<Checkbox size="small" checked={transparent} onChange={(event) => setTransparent(event.target.checked)} />} label="Transparent background" />
      </Stack>
      <Stack direction="row" spacing={1}>
        {supportsSvg ? <Button size="small" variant="outlined" onClick={() => onExport('svg', options)}>Export SVG</Button> : null}
        <Button size="small" variant="outlined" onClick={() => onExport('png', options)}>Export PNG</Button>
      </Stack>
    </Stack>
  );
}

export function InteractionLegend() {
  return <Stack direction="row" flexWrap="wrap" useFlexGap gap={1} aria-label="Interaction class legend">{Object.entries(INTERACTION_STYLES).map(([type, style]) => <Stack direction="row" alignItems="center" spacing={0.4} key={type}><Box aria-hidden="true" sx={{ width: 24, borderTop: `${style.width}px dashed ${style.color}` }} /><Typography variant="caption">{style.marker} {style.label}</Typography></Stack>)}</Stack>;
}

function InteractionMap({ depiction, point, selectedToken, onSelectToken }) {
  const interactions = useMemo(() => mapInteractionRecords(point?.fingerprint?.raw_interaction_records || [], depiction?.atom_positions || []), [point, depiction]);
  const visualization = point?.visualization || {};
  const options = { depiction, interactions, selectedToken, moleculeId: point?.molecule_id, mode: point?.mode, receptorId: visualization.receptor_id };
  const svg = depiction ? buildInteractionMapSvg(options) : '';
  async function onExport(format, exportOptions) {
    const exportSvg = buildInteractionMapSvg({ ...options, ...exportOptions });
    const filename = `${point.molecule_id}-mode-${point.mode}-interactions`;
    if (format === 'svg') downloadBlob(new Blob([exportSvg], { type: 'image/svg+xml' }), `${filename}.svg`);
    else downloadBlob(await svgToPng(exportSvg, exportOptions.width, exportOptions.height, exportOptions.transparent), `${filename}-${exportOptions.width}x${exportOptions.height}.png`);
  }
  return (
    <Stack spacing={1}>
      <Typography variant="caption" color="text.secondary">Residue placement in the 2D interaction map is schematic and does not represent physical 3D distance.</Typography>
      {svg ? <Box data-testid="interaction-map" onClick={(event) => { const token = event.target.closest?.('[data-token]')?.getAttribute('data-token'); if (token) onSelectToken(token); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { const token = event.target.closest?.('[data-token]')?.getAttribute('data-token'); if (token) { event.preventDefault(); onSelectToken(token); } } }} sx={{ width: '100%', overflowX: 'auto', '& > svg': { display: 'block', width: '100%', minWidth: 660, height: 'auto' } }} dangerouslySetInnerHTML={{ __html: svg }} /> : <Alert severity="info">Loading deterministic RDKit depiction…</Alert>}
      <ExportControls kind="2D" supportsSvg aspectRatio={MAP_WIDTH / MAP_HEIGHT} onExport={onExport} />
    </Stack>
  );
}

export default function InteractionVisualizationPanel({ baseUrl, jobId, point, resultRow, selectedToken, onSelectToken }) {
  const [tab, setTab] = useState(0);
  const [pocketMode, setPocketMode] = useState('interactions');
  const [depiction, setDepiction] = useState(null);
  const [artifacts, setArtifacts] = useState({ status: 'idle', receptor: null, ligand: null, error: '' });
  const viewerRef = useRef(null);
  const visualization = point?.visualization || {};
  const rawRecords = point?.fingerprint?.raw_interaction_records || [];

  useEffect(() => {
    setDepiction(null); setArtifacts({ status: 'idle', receptor: null, ligand: null, error: '' });
    if (!point?.canonical_smiles || point?.fingerprint_status !== 'available') return undefined;
    const controller = new AbortController();
    fetch(`${baseUrl}/api/design-logic/depiction?${new URLSearchParams({ smiles: point.canonical_smiles, width: '420', height: '300' })}`, { signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error(`Ligand depiction unavailable (${response.status}).`); return response.json(); })
      .then(setDepiction).catch((error) => { if (!controller.signal.aborted) setArtifacts((current) => ({ ...current, error: error.message })); });
    return () => controller.abort();
  }, [baseUrl, point?.molecule_id, point?.mode, point?.canonical_smiles, point?.fingerprint_status]);

  useEffect(() => {
    if (!point || point.fingerprint_status !== 'available' || !visualization.pose_artifact || !visualization.receptor_id) return undefined;
    const controller = new AbortController();
    setArtifacts({ status: 'loading', receptor: null, ligand: null, error: '' });
    const receptorRequest = fetchReceptorStructure(baseUrl, {
      receptor_id: visualization.receptor_id, docking_ready: true,
      docking_receptor_sha256: visualization.prepared_receptor_sha256,
      preparation_id: visualization.preparation_id || '',
    }, controller.signal);
    const poseRequest = fetchDockingPoseArtifact(baseUrl, jobId, visualization.pose_artifact, visualization.pose_sha256, controller.signal);
    Promise.all([receptorRequest, poseRequest]).then(([receptor, poseArtifact]) => {
      const selected = selectVinaPoseMode(poseArtifact.models, resultRow?.docking_result?.modes || [], point.mode);
      setArtifacts({ status: 'ready', receptor, ligand: { text: selected.pose.text, format: 'pdbqt', identity: { moleculeId: point.molecule_id, poseSha256: poseArtifact.sha256, mode: point.mode } }, error: '' });
    }).catch((error) => { if (!controller.signal.aborted) setArtifacts({ status: 'error', receptor: null, ligand: null, error: error.message }); });
    return () => controller.abort();
  }, [baseUrl, jobId, point?.molecule_id, point?.mode, point?.fingerprint_status, resultRow, visualization.pose_artifact, visualization.pose_sha256, visualization.receptor_id, visualization.prepared_receptor_sha256, visualization.preparation_id]);

  async function export3d(_format, options) {
    const aspect = viewerRef.current?.aspectRatio?.() || 16 / 9;
    const dimensions = resolveExportDimensions(options.width, aspect);
    const actualOptions = { ...options, ...dimensions };
    const output = await viewerRef.current?.exportPng(actualOptions.width, actualOptions.height, actualOptions.transparent);
    if (!output?.uri) return;
    const blob = await compose3dPng(output.uri, actualOptions, { moleculeId: point.molecule_id, mode: point.mode, receptorId: visualization.receptor_id });
    downloadBlob(blob, `${point.molecule_id}-mode-${point.mode}-3d-${actualOptions.width}x${actualOptions.height}.png`);
  }

  if (!point || point.fingerprint_status !== 'available') return <Alert severity="info">Analyze the selected explicit pose to enable synchronized interaction visualization.</Alert>;
  return (
    <Paper component="section" variant="outlined" aria-label="Selected pose interaction visualization" sx={{ p: { xs: 1.25, md: 1.75 }, minWidth: 0 }}>
      <Stack spacing={1.25}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1}><Box><Typography variant="h2">Selected pose interaction visualization</Typography><Typography variant="caption" color="text.secondary">{point.molecule_id} · Vina Mode {point.mode} · Receptor {visualization.receptor_id || 'unavailable'} · {rawRecords.length} raw contacts</Typography></Box><TextField select size="small" label="3D receptor display" value={pocketMode} onChange={(event) => setPocketMode(event.target.value)} sx={{ minWidth: 190 }}><MenuItem value="interactions">Interactions</MenuItem><MenuItem value="pocket">Pocket · qualified 8 Å</MenuItem></TextField></Stack>
        <Tabs value={tab} onChange={(_event, value) => setTab(value)} aria-label="Interaction visualization type"><Tab label="3D Interactions" /><Tab label="2D Interaction Map" /></Tabs>
        {tab === 0 ? <Stack spacing={1}>{artifacts.status === 'loading' ? <Stack direction="row" spacing={1}><CircularProgress size={18} /><Typography variant="body2">Loading validated pose and receptor artifacts…</Typography></Stack> : null}{artifacts.status === 'ready' ? <ReceptorViewer ref={viewerRef} structure={artifacts.receptor} dockedLigand={artifacts.ligand} box={null} showBox={false} selectedResidues={[]} selectedLigand={null} interactionRecords={rawRecords} selectedInteractionToken={selectedToken} pocketMode={pocketMode} viewerAspectRatio="16 / 9" /> : null}{artifacts.error ? <Alert severity="warning">Interaction viewer unavailable: {artifacts.error}</Alert> : null}<InteractionLegend /><ExportControls kind="3D" aspectRatio={16 / 9} onExport={export3d} /></Stack> : <InteractionMap depiction={depiction} point={point} selectedToken={selectedToken} onSelectToken={onSelectToken} />}
      </Stack>
    </Paper>
  );
}
