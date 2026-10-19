import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Chip, CircularProgress,
  Button, Divider, FormControl, InputLabel, MenuItem, Paper, Select, Stack, Tab, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import { normalizeAdmetAnalysis } from './admetAnalysisData.js';
import { numericAdmetPlotValue } from './admetPlotData.js';
import ScaffoldWorkspace from './ScaffoldWorkspace.jsx';
import ExperimentalNeighborhood from './ExperimentalNeighborhood.jsx';
import ModuleConfigurationSummary from './ModuleConfigurationSummary.jsx';
import ScientificSetupDialog from './ScientificSetupDialog.jsx';
import {
  chemicalSpaceConfigurationItems,
  CHEMICAL_SPACE_GROUPINGS,
  DEFAULT_CHEMICAL_SPACE_CONFIGURATION,
  shouldInvalidateChemicalSpaceResult,
  validateChemicalSpaceConfiguration,
} from './chemicalSpaceConfiguration.js';
import {
  createScientificSetupState,
  scientificSetupReducer,
} from './scientificSetupState.js';
import {
  CHEMICAL_SPACE_TOP_K_OPTIONS, categoricalPointColor, numericPointColor,
  paddedChemicalSpaceDomain, projectChemicalSpacePoints, searchChemicalSpacePoints,
} from './chemicalSpaceData.js';
import { scaffoldColorPlan, scaffoldMembership, scaffoldPointColor } from './scaffoldData.js';

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

function structureUrl(baseUrl, point, width = 260, height = 180) {
  if (!point?.canonical_smiles) return '';
  return `${baseUrl}/api/molecules/structure?${new URLSearchParams({
    smiles: point.canonical_smiles, width: String(width), height: String(height),
  })}`;
}

function QueryRail({ point, baseUrl, query, onQueryChange, colorMode, onColorModeChange, admetColorAvailable, onFindAnalogs }) {
  return (
    <Box component="aside" aria-label="Chemical Space query and display controls" sx={{ minWidth: 0, borderRight: { md: '1px solid' }, borderColor: { md: 'divider' }, pr: { md: 1.75 } }}>
      <Stack spacing={1.5}>
        <Box>
          <Typography variant="overline" color="text.secondary">Query compound</Typography>
          <Typography variant="h2" sx={{ overflowWrap: 'anywhere' }}>{point?.display_name || point?.molecule_id || 'Not selected'}</Typography>
          {point ? <Typography variant="caption" color="text.secondary">ID: {point.molecule_id}</Typography> : null}
        </Box>
        {point ? <Box component="img" src={structureUrl(baseUrl, point, 240, 150)} alt={`2D structure for query compound ${point.display_name || point.molecule_id}`} sx={{ width: '100%', height: 150, objectFit: 'contain', bgcolor: '#fff', border: '1px solid', borderColor: 'divider', borderRadius: 1 }} /> : null}
        {point ? <Stack spacing={0.25}>
          <Typography variant="caption" color="text.secondary">Source · {sourceLabel(point)}</Typography>
          <Typography variant="caption" color="text.secondary">Validation · {point.validation_status || 'valid'}{point.duplicate_structure ? ' · duplicate retained' : ''}</Typography>
        </Stack> : null}
        <Button variant="outlined" disabled={!point} onClick={onFindAnalogs}>Find experimental analogs</Button>
        <Divider />
        <TextField fullWidth label="Search compounds" value={query} onChange={(event) => onQueryChange(event.target.value)} inputProps={{ 'aria-label': 'Search projected compounds' }} />
        <FormControl fullWidth size="small">
          <InputLabel id="chemical-color-label">Color points by</InputLabel>
          <Select labelId="chemical-color-label" value={colorMode} label="Color points by" onChange={(event) => onColorModeChange(event.target.value)}>
            <MenuItem value="source">Source</MenuItem><MenuItem value="status">Validation status</MenuItem><MenuItem value="scaffold">Scaffold group</MenuItem>
            {ADMET_COLOR_OPTIONS.map(([key, label]) => <MenuItem key={key} value={key} disabled={!admetColorAvailable}>{label}{!admetColorAvailable ? ' · unavailable' : ''}</MenuItem>)}
          </Select>
        </FormControl>
      </Stack>
    </Box>
  );
}

function Detail({ point, baseUrl, admetMolecule }) {
  if (!point) return <Alert severity="info">Select a point to inspect its imported identity and structure.</Alert>;
  return (
    <Box component="aside" aria-label="Selected compound details" sx={{ minWidth: 0, borderLeft: { lg: '1px solid' }, borderColor: { lg: 'divider' }, pl: { lg: 1.75 } }} data-testid="chemical-space-detail">
      <Stack spacing={1.1}>
        <Box><Typography variant="overline" color="text.secondary">Selected compound</Typography><Typography variant="h2">{point.display_name || point.molecule_id}</Typography></Box>
        <Box component="img" src={structureUrl(baseUrl, point)} alt={`2D structure for ${point.display_name || point.molecule_id}`} sx={{ width: '100%', height: 180, objectFit: 'contain', bgcolor: '#fff', border: '1px solid', borderColor: 'divider', borderRadius: 1 }} />
        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{point.canonical_smiles}</Typography>
        <Typography variant="caption" color="text.secondary">ID · {point.molecule_id}</Typography>
        <Typography variant="caption" color="text.secondary">Source · {sourceLabel(point)}{point.source_record ? ` · ${point.source_record}` : ''}</Typography>
        <Typography variant="caption" color="text.secondary">Validation · {point.validation_status || 'valid'}{point.duplicate_structure ? ' · duplicate structure retained' : ''}</Typography>
        <Typography variant="caption" color="text.secondary">{admetMolecule ? 'ADMET results are available for optional map coloring.' : 'No ADMET result is linked; chemical-space analysis remains available.'}</Typography>
      </Stack>
    </Box>
  );
}

function NeighborTable({ neighbors, selectedId, onSelect, baseUrl, scaffoldByMolecule }) {
  return (
    <TableContainer sx={{ maxHeight: 'min(58vh, 560px)', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Table stickyHeader size="small" aria-label="Query-relative structural neighbors">
        <TableHead><TableRow><TableCell width={52}>#</TableCell><TableCell width={86}>Structure</TableCell><TableCell>Compound</TableCell><TableCell>Source</TableCell><TableCell>Scaffold context</TableCell><TableCell align="right">Tanimoto</TableCell></TableRow></TableHead>
        <TableBody>{neighbors.map((neighbor, index) => <TableRow key={`${neighbor.molecule_id}-${neighbor.source_index}`} hover selected={neighbor.molecule_id === selectedId} tabIndex={0} sx={{ cursor: 'pointer' }} onClick={() => onSelect(neighbor.molecule_id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(neighbor.molecule_id); } }}>
          <TableCell>{index + 1}</TableCell>
          <TableCell><Box component="img" src={structureUrl(baseUrl, neighbor, 96, 64)} alt={`2D structure for ${neighbor.display_name || neighbor.molecule_id}`} loading="lazy" sx={{ width: 72, height: 48, display: 'block', objectFit: 'contain', bgcolor: '#fff' }} /></TableCell>
          <TableCell><Typography variant="body2" fontWeight={700}>{neighbor.display_name || neighbor.molecule_id}</Typography><Typography variant="caption" color="text.secondary">{neighbor.molecule_id}{neighbor.duplicate_structure ? ' · duplicate retained' : ''}</Typography></TableCell>
          <TableCell>{sourceLabel(neighbor)}</TableCell>
          <TableCell>{scaffoldByMolecule.get(neighbor.molecule_id) || 'Unavailable'}</TableCell>
          <TableCell align="right"><Typography variant="body2" fontWeight={700}>{neighbor.similarity.toFixed(3)}</Typography></TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </TableContainer>
  );
}

function MapCanvas({ points, selectedId, onSelect, colorMode, admetById, scaffoldByMolecule, scaffoldPlan, selectedScaffoldId }) {
  const canvasRef = useRef(null);
  const [hovered, setHovered] = useState(null);
  const projected = useMemo(() => projectChemicalSpacePoints(points, WIDTH, HEIGHT), [points]);
  const numericValues = useMemo(() => projected.map((point) => numericAdmetPlotValue(admetById.get(point.molecule_id), colorMode)).filter(Number.isFinite), [admetById, colorMode, projected]);
  const numericDomain = paddedChemicalSpaceDomain(numericValues);

  function color(point) {
    if (colorMode === 'source') return categoricalPointColor(sourceLabel(point));
    if (colorMode === 'status') return categoricalPointColor(point.validation_status || 'valid');
    if (colorMode === 'scaffold') return scaffoldPointColor(scaffoldByMolecule.get(point.molecule_id), scaffoldPlan);
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
      const inSelectedScaffold = selectedScaffoldId && scaffoldByMolecule.get(point.molecule_id) === selectedScaffoldId;
      const emphasized = point.molecule_id === selectedId || point.molecule_id === hovered?.molecule_id;
      context.beginPath(); context.arc(point.screenX, point.screenY, emphasized ? 6 : inSelectedScaffold ? 4.5 : 3, 0, Math.PI * 2);
      context.fillStyle = color(point); context.fill();
      if (emphasized || inSelectedScaffold) { context.strokeStyle = '#172b36'; context.lineWidth = emphasized ? 2 : 1.25; context.stroke(); }
    }
  }, [admetById, colorMode, hovered, numericDomain, projected, scaffoldByMolecule, scaffoldPlan, selectedId, selectedScaffoldId]);

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
  const [scaffoldData, setScaffoldData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [colorMode, setColorMode] = useState('source');
  const [topK, setTopK] = useState(10);
  const [neighbors, setNeighbors] = useState(null);
  const [neighborsLoading, setNeighborsLoading] = useState(false);
  const [selectedScaffoldId, setSelectedScaffoldId] = useState('');
  const [setup, dispatchSetup] = useReducer(
    scientificSetupReducer,
    DEFAULT_CHEMICAL_SPACE_CONFIGURATION,
    createScientificSetupState,
  );
  const generationRef = useRef(0);
  const configureButtonRef = useRef(null);
  const admet = useMemo(() => normalizeAdmetAnalysis(admetRows), [admetRows]);
  const admetById = useMemo(() => new Map(admet.molecules.map((molecule) => [molecule.moleculeId, molecule])), [admet]);

  useEffect(() => {
    generationRef.current += 1;
    setProjection(null);
    setScaffoldData(null);
    setSelectedId('');
    setSelectedScaffoldId('');
    setNeighbors(null);
    setStale(false);
    setError('');
    setLoading(false);
  }, [upload?.upload_id]);

  async function generateChemicalSpace(configuration = setup.appliedConfiguration) {
    if (!upload?.upload_id || loading) return false;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setLoading(true);
    setError('');
    try {
      const [projectResult, scaffoldResult] = await Promise.allSettled([
        requestJson(baseUrl, '/api/chemical-space/project', { upload_id: upload.upload_id }),
        requestJson(baseUrl, '/api/chemical-space/scaffolds', { upload_id: upload.upload_id }),
      ]);
      if (generationRef.current !== generation) return false;
      if (projectResult.status === 'rejected') throw projectResult.reason;
      const payload = projectResult.value;
      setProjection(payload);
      setSelectedId((current) => payload.points.some((point) => point.molecule_id === current) ? current : '');
      if (scaffoldResult.status === 'fulfilled') {
        const scaffolds = scaffoldResult.value;
        setScaffoldData(scaffolds);
        setSelectedScaffoldId((current) => scaffolds.scaffolds.some((group) => group.scaffold_id === current) ? current : '');
      } else {
        setScaffoldData(null);
        setSelectedScaffoldId('');
        setError(`Scaffold organization is unavailable: ${scaffoldResult.reason.message}`);
      }
      setColorMode(configuration.grouping);
      setStale(false);
      return true;
    } catch (caught) {
      if (generationRef.current === generation) setError(caught.message);
      return false;
    } finally {
      if (generationRef.current === generation) setLoading(false);
    }
  }

  function validateDraft() {
    const errors = validateChemicalSpaceConfiguration(setup.draftConfiguration);
    if (errors.length) dispatchSetup({ type: 'validation-failed', errors });
    return errors.length === 0;
  }

  function applyConfiguration() {
    if (!validateDraft()) return;
    const invalidatesResult = shouldInvalidateChemicalSpaceResult(
      setup.appliedConfiguration,
      setup.draftConfiguration,
      projection,
    );
    dispatchSetup({ type: 'apply' });
    setColorMode(setup.draftConfiguration.grouping);
    if (invalidatesResult) setStale(true);
  }

  async function applyConfigurationAndRun() {
    if (!validateDraft() || !upload?.upload_id) return;
    const configuration = { ...setup.draftConfiguration };
    dispatchSetup({ type: 'apply-and-run' });
    setColorMode(configuration.grouping);
    if (projection) setStale(true);
    await generateChemicalSpace(configuration);
    dispatchSetup({ type: 'run-finished' });
  }

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
  const scaffoldByMolecule = useMemo(() => scaffoldMembership(scaffoldData?.scaffolds || []), [scaffoldData]);
  const scaffoldPlan = useMemo(() => scaffoldColorPlan(scaffoldData?.scaffolds || []), [scaffoldData]);
  const hasActiveCollection = Boolean(upload?.upload_id);
  const hasCurrentResult = Boolean(projection) && !stale;
  const analysisStatus = loading
    ? 'Running'
    : error && !projection ? 'Failed'
      : stale ? 'Requires update'
        : projection ? 'Completed'
          : hasActiveCollection ? 'Ready' : 'Not generated';
  const actionLabel = projection || stale ? 'Update Chemical Space' : 'Generate Chemical Space';

  return (
    <Stack spacing={1.5} data-testid={hasActiveCollection ? 'chemical-space-workstation' : 'chemical-space-empty-state'}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'baseline' }} gap={0.5}>
        <Typography variant="h1">Chemical Space</Typography>
        {hasCurrentResult ? <Typography variant="body2" color="text.secondary">{projection.projected_count.toLocaleString()} projected · {projection.excluded_count.toLocaleString()} excluded · query: {selected?.display_name || selected?.molecule_id || 'not selected'}</Typography> : null}
      </Stack>
      <Typography variant="caption" color="text.secondary">Descriptive structural analysis only; activity, potency, applicability domain, confidence, preference, and rank are not inferred.</Typography>
      <ModuleConfigurationSummary
        title="Analysis configuration"
        status={analysisStatus}
        items={chemicalSpaceConfigurationItems(setup.appliedConfiguration)}
        actions={<>
          <Button ref={configureButtonRef} aria-label="Configure Chemical Space" variant="outlined" startIcon={<SettingsOutlinedIcon />} onClick={() => dispatchSetup({ type: 'open' })}>Configure</Button>
          <Button variant="contained" disabled={!hasActiveCollection || loading} onClick={() => generateChemicalSpace()}>{loading ? 'Generating…' : actionLabel}</Button>
        </>}
      />
      <ScientificSetupDialog
        open={setup.open}
        title="Configure Chemical Space"
        context="Review the implemented structural-analysis methods and choose the default map grouping. Settings are applied only when you confirm them."
        sections={[{ id: 'methods', label: 'Methods & display' }]}
        dirty={setup.dirty}
        validationErrors={setup.validationErrors}
        loading={loading}
        runDisabled={!hasActiveCollection}
        onCancel={() => dispatchSetup({ type: 'cancel' })}
        onApply={applyConfiguration}
        onApplyAndRun={applyConfigurationAndRun}
        restoreFocusRef={configureButtonRef}
      >
        <Box component="section" aria-labelledby="chemical-space-methods-heading">
          <Typography id="chemical-space-methods-heading" variant="h2" sx={{ mb: 0.5 }}>Implemented methods</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>These qualified methods are fixed in the current release.</Typography>
          <Box component="dl" aria-label="Implemented Chemical Space methods" sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5, m: 0 }}>
            {[
              ['Molecular representation', setup.draftConfiguration.representation],
              ['Projection', setup.draftConfiguration.projection],
              ['Similarity basis', setup.draftConfiguration.similarity],
            ].map(([label, value]) => (
              <Paper key={label} component="div" variant="outlined" sx={{ p: 1.5, minWidth: 0, bgcolor: 'background.default' }}>
                <Typography component="dt" variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>{label}</Typography>
                <Typography component="dd" variant="body2" sx={{ m: 0, fontWeight: 700, overflowWrap: 'anywhere' }}>{value}</Typography>
                <Typography variant="caption" color="text.secondary">Implemented · read only</Typography>
              </Paper>
            ))}
          </Box>
        </Box>
        <Box component="section" aria-labelledby="chemical-space-display-heading">
          <Typography id="chemical-space-display-heading" variant="h2" sx={{ mb: 0.5 }}>Initial display</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Choose the grouping used when a generated map first opens. Display controls remain available in the workspace.</Typography>
          <FormControl fullWidth size="small">
            <InputLabel id="chemical-space-grouping-label">Default grouping</InputLabel>
            <Select
              labelId="chemical-space-grouping-label"
              value={setup.draftConfiguration.grouping}
              label="Default grouping"
              onChange={(event) => dispatchSetup({ type: 'change', patch: { grouping: event.target.value } })}
            >
              {CHEMICAL_SPACE_GROUPINGS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
            </Select>
          </FormControl>
        </Box>
        <Alert severity="info" variant="outlined">PCA map distance is not Tanimoto similarity. Query-relative neighbors are calculated independently with Morgan-fingerprint Tanimoto.</Alert>
      </ScientificSetupDialog>
      {!hasActiveCollection ? <Alert severity="info">No active molecule collection. Start a new calculation or open a previous calculation; configuration remains available, but generation requires an active collection.</Alert> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      {loading ? <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={20} /><Typography>Projecting the current collection…</Typography></Stack> : null}
      {stale ? <Alert severity="warning">The applied configuration changed. The prior Chemical Space result is retained internally but is not presented as current; select Update Chemical Space to regenerate it.</Alert> : null}
      {!projection && hasActiveCollection && !loading && !error ? <Paper variant="outlined" sx={{ p: 2 }}><Typography variant="h2">Ready to generate</Typography><Typography color="text.secondary" sx={{ mt: 0.5 }}>Generate the Chemical Space workspace from the active molecule collection. No scientific request runs when settings are opened, edited, cancelled, or applied.</Typography></Paper> : null}
      {!hasCurrentResult ? <Alert severity="info" variant="outlined">The projection visualizes Morgan fingerprint variation. Distance in the PCA projection is not itself molecular similarity; query-relative similarity uses locally recalculated Tanimoto values.</Alert> : null}
      {hasCurrentResult ? <Tabs value={tab} onChange={(_, value) => setTab(value)} aria-label="Chemical Space workspace views" variant="scrollable" scrollButtons="auto" sx={{ minHeight: 36, borderBottom: '1px solid', borderColor: 'divider', '& .MuiTab-root': { minHeight: 36, py: 0.5 } }}><Tab label="Map" /><Tab label="Neighbors" /><Tab label="Scaffolds" /><Tab label="Experimental Neighborhood" /></Tabs> : null}
      {hasCurrentResult && projection.projected_count === 0 ? <Alert severity="warning">No valid resolved structures are available to fingerprint. Excluded records remain listed in the import workflow.</Alert> : null}
      {hasCurrentResult && projection.projected_count ? (
          tab === 0 ? <Paper variant="outlined" sx={{ p: 1.5, minWidth: 0 }}><Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '210px minmax(0, 1fr)', lg: '210px minmax(0, 1fr) 240px', xl: '220px minmax(0, 1fr) 270px' }, gap: 1.75 }}>
          <QueryRail point={selected} baseUrl={baseUrl} query={query} onQueryChange={setQuery} colorMode={colorMode} onColorModeChange={setColorMode} admetColorAvailable={admetColorAvailable} onFindAnalogs={() => setTab(3)} />
          <Stack spacing={1} sx={{ minWidth: 0 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={0.5}><Typography variant="h2">Randomized PCA projection</Typography><Typography variant="caption" color="text.secondary">Map distance is not Tanimoto similarity.</Typography></Stack>
            <Typography variant="caption" color="text.secondary">Showing {visiblePoints.length.toLocaleString()} of {projection.projected_count.toLocaleString()} projected records · Morgan radius {projection.metadata?.fingerprint_radius} · {projection.metadata?.fingerprint_bits}-bit fingerprints. Duplicate structures remain distinct and may overlap.</Typography>
            {visiblePoints.length ? <MapCanvas points={visiblePoints} selectedId={selectedId} onSelect={setSelectedId} colorMode={colorMode} admetById={admetById} scaffoldByMolecule={scaffoldByMolecule} scaffoldPlan={scaffoldPlan} selectedScaffoldId={selectedScaffoldId} /> : <Alert severity="info">No projected compounds match this search.</Alert>}
            {colorMode === 'scaffold' ? <Stack direction="row" useFlexGap flexWrap="wrap" spacing={0.75}>{scaffoldPlan.legend.map((entry) => <Chip key={entry.key} label={entry.label} sx={{ borderLeft: `8px solid ${entry.color}` }} />)}<Typography variant="caption" color="text.secondary">Categorical scaffold colors do not indicate preference.</Typography></Stack> : null}
          </Stack>
            <Box sx={{ gridColumn: { md: '1 / -1', lg: 'auto' } }}><Detail point={selected} baseUrl={baseUrl} admetMolecule={selected ? admetById.get(selected.molecule_id) : null} /></Box>
        </Box></Paper> : tab === 1 ? <Paper variant="outlined" sx={{ p: 1.5, minWidth: 0 }}><Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '220px minmax(0, 1fr)' }, gap: 2 }}>
          <Box component="aside" sx={{ borderRight: { md: '1px solid' }, borderColor: { md: 'divider' }, pr: { md: 2 } }}><Stack spacing={1.5}><Box><Typography variant="overline" color="text.secondary">Query compound</Typography><Typography variant="h2">{selected?.display_name || selected?.molecule_id || 'Not selected'}</Typography><Typography variant="caption" color="text.secondary">Neighbors are ranked by independently calculated Morgan-fingerprint Tanimoto.</Typography></Box><FormControl fullWidth size="small"><InputLabel id="neighbor-count-label">Neighbors shown</InputLabel><Select labelId="neighbor-count-label" value={topK} label="Neighbors shown" onChange={(event) => setTopK(Number(event.target.value))}>{CHEMICAL_SPACE_TOP_K_OPTIONS.map((value) => <MenuItem key={value} value={value}>Top {value}</MenuItem>)}</Select></FormControl><Button onClick={() => setTab(0)}>Change query on map</Button></Stack></Box>
          <Stack spacing={1.25} sx={{ minWidth: 0 }}><Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={0.5}><Typography variant="h2">Structural neighbors</Typography><Typography variant="caption" color="text.secondary">Projection position is not used for this ordering.</Typography></Stack>{!selectedId ? <Alert severity="info">Select a molecule on the Map to calculate query-relative neighbors.</Alert> : null}{selectedId && neighborsLoading ? <Stack direction="row" gap={1}><CircularProgress size={20} /><Typography variant="body2">Calculating query-relative neighbors…</Typography></Stack> : null}{selectedId && !neighborsLoading && neighbors ? (neighbors.neighbors.length ? <NeighborTable neighbors={neighbors.neighbors} selectedId={selectedId} onSelect={setSelectedId} baseUrl={baseUrl} scaffoldByMolecule={scaffoldByMolecule} /> : <Alert severity="info">This collection has no other valid structures to compare.</Alert>) : null}</Stack>
        </Box></Paper> : tab === 2 ? (scaffoldData ? <ScaffoldWorkspace data={scaffoldData} selectedScaffoldId={selectedScaffoldId} selectedMoleculeId={selectedId} onSelectScaffold={setSelectedScaffoldId} onSelectMolecule={setSelectedId} onViewMap={(scaffoldId) => { setSelectedScaffoldId(scaffoldId); setColorMode('scaffold'); setTab(0); }} baseUrl={baseUrl} admetById={admetById} /> : null) : <ExperimentalNeighborhood key={selected?.molecule_id || 'no-selection'} upload={upload} queryMolecule={selected} baseUrl={baseUrl} />
      ) : null}
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
        {hasCurrentResult && projection?.metadata ? <Accordion sx={{ flex: 1 }}><AccordionSummary expandIcon={<ExpandMoreIcon />}><Typography variant="body2" fontWeight={700}>Method and provenance</Typography></AccordionSummary><AccordionDetails><Stack spacing={0.75}><Typography variant="body2">Representation: Morgan radius {projection.metadata.fingerprint_radius}, {projection.metadata.fingerprint_bits}-bit fingerprints · RDKit {projection.metadata.rdkit_version}.</Typography><Typography variant="body2">Similarity: {projection.metadata.similarity_metric}. Projection: {projection.metadata.projection_method} via {projection.metadata.projection_package} {projection.metadata.projection_package_version}, seed {projection.metadata.projection_seed}.</Typography><Typography variant="body2">Projection input: {projection.metadata.projection_input}.</Typography><Alert severity="info">{projection.metadata.caveat}</Alert></Stack></AccordionDetails></Accordion> : null}
        {hasCurrentResult && scaffoldData?.metadata ? <Accordion sx={{ flex: 1 }}><AccordionSummary expandIcon={<ExpandMoreIcon />}><Typography variant="body2" fontWeight={700}>Scaffold method and provenance</Typography></AccordionSummary><AccordionDetails><Stack spacing={0.75}><Typography variant="body2">{scaffoldData.metadata.method} via {scaffoldData.metadata.implementation} · RDKit {scaffoldData.metadata.rdkit_version} · algorithm {scaffoldData.metadata.algorithm_version}.</Typography><Typography variant="body2">{scaffoldData.metadata.canonicalization}. {scaffoldData.metadata.input_context}</Typography><Typography variant="body2">{scaffoldData.metadata.acyclic_policy} {scaffoldData.metadata.invalid_policy} {scaffoldData.metadata.duplicate_policy}</Typography><Alert severity="info">{scaffoldData.metadata.caveat}</Alert></Stack></AccordionDetails></Accordion> : null}
      </Stack>
    </Stack>
  );
}
