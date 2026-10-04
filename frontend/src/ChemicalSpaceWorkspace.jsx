import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Chip, CircularProgress,
  FormControl, InputLabel, MenuItem, Paper, Select, Stack, Tab, Tabs, TextField, Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { normalizeAdmetAnalysis } from './admetAnalysisData.js';
import { numericAdmetPlotValue } from './admetPlotData.js';
import {
  CHEMICAL_SPACE_TOP_K_OPTIONS, categoricalPointColor, numericPointColor,
  paddedChemicalSpaceDomain, projectChemicalSpacePoints, searchChemicalSpacePoints,
} from './chemicalSpaceData.js';

const WIDTH = 900;
const HEIGHT = 520;
const ADMET_COLOR_OPTIONS = [
  ['lipophilicity_astrazeneca', 'ADMET · Lipophilicity'],
  ['solubility_aqsoldb', 'ADMET · Solubility'],
  ['caco2_wang', 'ADMET · Caco-2 permeability'],
  ['ppbr_az', 'ADMET · Plasma protein binding'],
  ['vdss_lombardo', 'ADMET · Volume of distribution'],
];

async function requestJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || `Request failed (${response.status}).`);
  }
  return response.json();
}

function sourceLabel(point) {
  return point.source_filename || point.source_type || 'Entered SMILES';
}

function Detail({ point, baseUrl, admetMolecule }) {
  if (!point) return <Alert severity="info">Select a point to inspect its imported identity and structure.</Alert>;
  const params = new URLSearchParams({ smiles: point.canonical_smiles, width: '300', height: '220' });
  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-testid="chemical-space-detail">
      <Stack spacing={1.25}>
        <Typography variant="h3">{point.display_name || point.molecule_id}</Typography>
        <Box component="img" src={`${baseUrl}/api/molecules/structure?${params}`} alt={`2D structure for ${point.display_name || point.molecule_id}`} sx={{ width: '100%', maxWidth: 300, bgcolor: '#fff', border: '1px solid', borderColor: 'divider', borderRadius: 1 }} />
        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{point.canonical_smiles}</Typography>
        <Typography variant="body2" color="text.secondary">ID: {point.molecule_id}</Typography>
        <Typography variant="body2" color="text.secondary">Source: {sourceLabel(point)}{point.source_record ? ` · ${point.source_record}` : ''}</Typography>
        <Typography variant="body2" color="text.secondary">Validation: {point.validation_status || 'valid'}{point.duplicate_structure ? ' · duplicate structure retained' : ''}</Typography>
        <Typography variant="caption" color="text.secondary">{admetMolecule ? 'ADMET results are available for optional map coloring.' : 'No ADMET result is linked; chemical-space analysis remains available.'}</Typography>
      </Stack>
    </Paper>
  );
}

function MapCanvas({ points, selectedId, onSelect, colorMode, admetById }) {
  const canvasRef = useRef(null);
  const [hovered, setHovered] = useState(null);
  const projected = useMemo(() => projectChemicalSpacePoints(points, WIDTH, HEIGHT), [points]);
  const numericValues = useMemo(() => projected.map((point) => numericAdmetPlotValue(admetById.get(point.molecule_id), colorMode)).filter(Number.isFinite), [admetById, colorMode, projected]);
  const numericDomain = paddedChemicalSpaceDomain(numericValues);

  function color(point) {
    if (colorMode === 'source') return categoricalPointColor(sourceLabel(point));
    if (colorMode === 'status') return categoricalPointColor(point.validation_status || 'valid');
    return numericPointColor(numericAdmetPlotValue(admetById.get(point.molecule_id), colorMode), numericDomain);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = WIDTH * ratio; canvas.height = HEIGHT * ratio;
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, WIDTH, HEIGHT);
    context.strokeStyle = '#d7e0e6'; context.lineWidth = 1;
    for (let tick = 0; tick <= 5; tick += 1) {
      const x = 42 + ((WIDTH - 84) * tick) / 5; const y = 42 + ((HEIGHT - 84) * tick) / 5;
      context.beginPath(); context.moveTo(x, 42); context.lineTo(x, HEIGHT - 42); context.stroke();
      context.beginPath(); context.moveTo(42, y); context.lineTo(WIDTH - 42, y); context.stroke();
    }
    for (const point of projected) {
      const emphasized = point.molecule_id === selectedId || point.molecule_id === hovered?.molecule_id;
      context.beginPath(); context.arc(point.screenX, point.screenY, emphasized ? 6 : 3, 0, Math.PI * 2);
      context.fillStyle = color(point); context.fill();
      if (emphasized) { context.strokeStyle = '#172b36'; context.lineWidth = 2; context.stroke(); }
    }
  }, [admetById, colorMode, hovered, numericDomain, projected, selectedId]);

  function nearest(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * WIDTH;
    const y = ((event.clientY - bounds.top) / bounds.height) * HEIGHT;
    let best = null; let distance = 144;
    for (const point of projected) {
      const candidate = (point.screenX - x) ** 2 + (point.screenY - y) ** 2;
      if (candidate <= distance) { best = point; distance = candidate; }
    }
    return best;
  }

  function handleKey(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !projected.length) return;
    event.preventDefault();
    const current = projected.findIndex((point) => point.molecule_id === selectedId);
    let next = event.key === 'Home' ? 0 : event.key === 'End' ? projected.length - 1 : current + (event.key === 'ArrowLeft' ? -1 : 1);
    if (next < 0) next = projected.length - 1; if (next >= projected.length) next = 0;
    onSelect(projected[next].molecule_id);
  }

  const visibleHovered = hovered
    ? projected.find((point) => point.molecule_id === hovered.molecule_id && point.source_index === hovered.source_index)
    : null;
  const identified = visibleHovered || projected.find((point) => point.molecule_id === selectedId);
  return (
    <Stack spacing={1}>
      <canvas ref={canvasRef} data-testid="chemical-space-canvas" tabIndex={0} aria-label={`Chemical-space map with ${projected.length} compounds. Use left and right arrow keys to select points.`}
        onPointerMove={(event) => setHovered(nearest(event))} onPointerLeave={() => setHovered(null)} onClick={(event) => { const point = nearest(event); if (point) onSelect(point.molecule_id); }} onKeyDown={handleKey}
        style={{ display: 'block', width: '100%', height: 'auto', aspectRatio: `${WIDTH} / ${HEIGHT}`, border: '1px solid #cbd5e1', borderRadius: 6 }} />
      <Typography variant="caption" aria-live="polite">{identified ? `${identified.display_name || identified.molecule_id} · ${sourceLabel(identified)}` : 'Hover, click, or use the canvas arrow keys to identify a compound.'}</Typography>
    </Stack>
  );
}

export default function ChemicalSpaceWorkspace({ upload, admetRows = [], baseUrl = 'http://localhost:8000' }) {
  const [tab, setTab] = useState(0);
  const [projection, setProjection] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [colorMode, setColorMode] = useState('source');
  const [topK, setTopK] = useState(10);
  const [neighbors, setNeighbors] = useState(null);
  const [neighborsLoading, setNeighborsLoading] = useState(false);
  const admet = useMemo(() => normalizeAdmetAnalysis(admetRows), [admetRows]);
  const admetById = useMemo(() => new Map(admet.molecules.map((molecule) => [molecule.moleculeId, molecule])), [admet]);

  useEffect(() => {
    if (!upload?.upload_id) { setProjection(null); return; }
    let active = true; setLoading(true); setError('');
    requestJson(baseUrl, '/api/chemical-space/project', { upload_id: upload.upload_id })
      .then((payload) => { if (active) { setProjection(payload); setSelectedId((current) => payload.points.some((point) => point.molecule_id === current) ? current : ''); } })
      .catch((caught) => { if (active) setError(caught.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [baseUrl, upload?.upload_id]);

  useEffect(() => {
    if (!upload?.upload_id || !selectedId || tab !== 1) return;
    let active = true; setNeighborsLoading(true); setError('');
    requestJson(baseUrl, '/api/chemical-space/neighbors', { upload_id: upload.upload_id, query_molecule_id: selectedId, top_k: topK })
      .then((payload) => { if (active) setNeighbors(payload); })
      .catch((caught) => { if (active) setError(caught.message); })
      .finally(() => { if (active) setNeighborsLoading(false); });
    return () => { active = false; };
  }, [baseUrl, selectedId, tab, topK, upload?.upload_id]);

  const visiblePoints = useMemo(() => searchChemicalSpacePoints(projection?.points || [], query), [projection, query]);
  const selected = projection?.points.find((point) => point.molecule_id === selectedId) || null;
  const admetColorAvailable = admet.molecules.length > 0;

  if (!upload?.upload_id) return <Alert severity="info">Import a molecule collection first. Chemical Space uses that current collection directly; no second upload is required.</Alert>;
  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h1">Chemical Space</Typography>
        <Typography color="text.secondary">Explore a descriptive Morgan-fingerprint projection and query-relative structural neighbors. This workspace does not infer activity, potency, applicability domain, confidence, or rank.</Typography>
      </Box>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {loading ? <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={20} /><Typography>Projecting the current collection…</Typography></Stack> : null}
      {projection ? <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}><Chip label={`${projection.projected_count.toLocaleString()} projected`} /><Chip label={`${projection.excluded_count.toLocaleString()} invalid or unresolved excluded`} /><Chip label={`${projection.total_count.toLocaleString()} imported records`} /></Stack> : null}
      <Tabs value={tab} onChange={(_, value) => setTab(value)} aria-label="Chemical Space workspace views"><Tab label="Map" /><Tab label="Neighbors" /></Tabs>
      {projection && projection.projected_count === 0 ? <Alert severity="warning">No valid resolved structures are available to fingerprint. Excluded records remain listed in the import workflow.</Alert> : null}
      {projection?.projected_count ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 2fr) minmax(280px, 1fr)' }, gap: 2 }}>
          <Paper variant="outlined" sx={{ p: 2, minWidth: 0 }}>
            {tab === 0 ? <Stack spacing={2}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                <TextField size="small" label="Search compounds" value={query} onChange={(event) => setQuery(event.target.value)} sx={{ flex: 1 }} />
                <FormControl size="small" sx={{ minWidth: 220 }}><InputLabel id="chemical-color-label">Color points by</InputLabel><Select labelId="chemical-color-label" value={colorMode} label="Color points by" onChange={(event) => setColorMode(event.target.value)}><MenuItem value="source">Source</MenuItem><MenuItem value="status">Validation status</MenuItem>{ADMET_COLOR_OPTIONS.map(([key, label]) => <MenuItem key={key} value={key} disabled={!admetColorAvailable}>{label}{!admetColorAvailable ? ' · unavailable' : ''}</MenuItem>)}</Select></FormControl>
              </Stack>
              <Typography variant="body2" color="text.secondary">Showing {visiblePoints.length.toLocaleString()} of {projection.projected_count.toLocaleString()} projected records. Duplicate structures remain distinct points and may overlap exactly.</Typography>
              {visiblePoints.length ? <MapCanvas points={visiblePoints} selectedId={selectedId} onSelect={setSelectedId} colorMode={colorMode} admetById={admetById} /> : <Alert severity="info">No projected compounds match this search.</Alert>}
            </Stack> : <Stack spacing={2}>
              <FormControl size="small" sx={{ width: 180 }}><InputLabel id="neighbor-count-label">Neighbors shown</InputLabel><Select labelId="neighbor-count-label" value={topK} label="Neighbors shown" onChange={(event) => setTopK(Number(event.target.value))}>{CHEMICAL_SPACE_TOP_K_OPTIONS.map((value) => <MenuItem key={value} value={value}>Top {value}</MenuItem>)}</Select></FormControl>
              {!selectedId ? <Alert severity="info">Select a molecule on the Map to calculate query-relative neighbors.</Alert> : null}
              {selectedId && neighborsLoading ? <CircularProgress size={22} /> : null}
              {selectedId && !neighborsLoading && neighbors ? <Stack spacing={1}>{neighbors.neighbors.length ? neighbors.neighbors.map((neighbor, index) => <Paper key={`${neighbor.molecule_id}-${neighbor.source_index}`} variant="outlined" sx={{ p: 1.25, cursor: 'pointer' }} onClick={() => setSelectedId(neighbor.molecule_id)}><Stack direction="row" justifyContent="space-between" gap={2}><Box><Typography variant="body2" fontWeight={700}>{index + 1}. {neighbor.display_name || neighbor.molecule_id}</Typography><Typography variant="caption" color="text.secondary">{sourceLabel(neighbor)}{neighbor.duplicate_structure ? ' · duplicate structure retained' : ''}</Typography></Box><Typography variant="body2" fontWeight={700}>{neighbor.similarity.toFixed(3)}</Typography></Stack></Paper>) : <Alert severity="info">This collection has no other valid structures to compare.</Alert>}</Stack> : null}
            </Stack>}
          </Paper>
          <Detail point={selected} baseUrl={baseUrl} admetMolecule={selected ? admetById.get(selected.molecule_id) : null} />
        </Box>
      ) : null}
      {projection?.metadata ? <Accordion><AccordionSummary expandIcon={<ExpandMoreIcon />}><Typography fontWeight={700}>Method and provenance</Typography></AccordionSummary><AccordionDetails><Stack spacing={0.75}><Typography variant="body2">Representation: Morgan radius {projection.metadata.fingerprint_radius}, {projection.metadata.fingerprint_bits}-bit fingerprints · RDKit {projection.metadata.rdkit_version}.</Typography><Typography variant="body2">Similarity: {projection.metadata.similarity_metric}. Projection: {projection.metadata.projection_method} via {projection.metadata.projection_package} {projection.metadata.projection_package_version}, seed {projection.metadata.projection_seed}.</Typography><Typography variant="body2">Projection input: {projection.metadata.projection_input}.</Typography><Alert severity="info">{projection.metadata.caveat}</Alert></Stack></AccordionDetails></Accordion> : null}
    </Stack>
  );
}
