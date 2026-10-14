import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, FormControlLabel, MenuItem, Paper,
  Stack, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs,
  TextField, Typography,
} from '@mui/material';
import ReceptorViewer from './ReceptorViewer.jsx';
import { fetchReceptorStructure } from './DockingSetup.jsx';
import { fetchDockingPoseArtifact, selectVinaPoseMode } from './dockingPose.js';
import { downloadBlob, ExportControls, svgToPng } from './InteractionVisualizationPanel.jsx';
import {
  buildPharmacophoreMapSvg, PHARMACOPHORE_MAP_HEIGHT,
  PHARMACOPHORE_MAP_WIDTH, PHARMACOPHORE_STYLES,
} from './pharmacophoreVisualization.js';
import { resolveExportDimensions } from './interactionVisualization.js';

function metric(value, suffix = '') {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
    ? `${Number(value).toFixed(3)}${suffix}` : 'Unavailable';
}

function statusLabel(value = '') {
  return String(value || 'unavailable').replaceAll('_', ' ');
}

function featureCounts(features = []) {
  return features.reduce((counts, feature) => ({
    ...counts, [feature.canonical_class]: (counts[feature.canonical_class] || 0) + 1,
  }), {});
}

export function featureClassRows(referenceFeatures = [], comparisonFeatures = [], pair = {}) {
  const reference = featureCounts(referenceFeatures);
  const comparison = featureCounts(comparisonFeatures);
  const matched = pair.matched_features_by_class || {};
  return Object.keys(PHARMACOPHORE_STYLES).map((name) => ({
    name, reference: reference[name] || 0, comparison: comparison[name] || 0, matched: matched[name] || 0,
  }));
}

export async function composePharmacophore3dPng(uri, options, identity) {
  const image = new Image();
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = uri; });
  const canvas = document.createElement('canvas');
  canvas.width = options.width; canvas.height = options.height;
  const context = canvas.getContext('2d');
  if (!options.transparent) { context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const scale = Math.max(1, canvas.width / 1920);
  if (options.includeTitle) {
    context.fillStyle = 'rgba(255,255,255,.92)'; context.fillRect(24 * scale, 24 * scale, 860 * scale, 82 * scale);
    context.fillStyle = '#20262e'; context.font = `700 ${19 * scale}px Arial`;
    context.fillText('Pose-specific pharmacophore comparison', 42 * scale, 53 * scale);
    context.font = `${13 * scale}px Arial`;
    context.fillText(`Reference: ${identity.referenceId} · Mode ${identity.referenceMode} | Comparison: ${identity.comparisonId} · Mode ${identity.comparisonMode} | Threshold: ${Number(identity.threshold).toFixed(2)} Å`, 42 * scale, 80 * scale);
  }
  if (options.includeLegend) {
    context.fillStyle = 'rgba(255,255,255,.9)'; context.fillRect(24 * scale, canvas.height - 60 * scale, 1120 * scale, 42 * scale);
    context.font = `${11 * scale}px Arial`; let x = 42 * scale;
    Object.values(PHARMACOPHORE_STYLES).forEach((style) => { context.fillStyle = style.color; context.fillText(`${style.symbol} ${style.label}`, x, canvas.height - 34 * scale); x += 155 * scale; });
    context.fillStyle = '#52616c'; context.fillText('R outlined · C filled · neutral dashed connector = backend feature match, not a protein interaction', x, canvas.height - 34 * scale);
  }
  return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export function pharmacophore3dExportDimensions(options = {}) {
  return { width: Number(options.width), height: Number(options.height) };
}

export function pairMetricRows(pair = {}) {
  const distanceLabel = pair.matched_feature_count === 1
    ? metric(pair.single_match_distance_angstrom, ' Å')
    : metric(pair.matched_feature_center_rmsd_angstrom, ' Å');
  return [
    ['Matched features', pair.matched_feature_count ?? '—'],
    ['Reference coverage', metric(pair.reference_coverage)],
    ['Comparison coverage', metric(pair.comparison_coverage)],
    ['Feature overlap', metric(pair.pharmacophore_feature_overlap)],
    [pair.matched_feature_count === 1 ? 'Single-match distance' : 'Matched-center RMSD', distanceLabel],
  ];
}

export function PharmacophoreLegend() {
  return (
    <Stack direction="row" flexWrap="wrap" useFlexGap gap={1} aria-label="Pharmacophore feature legend">
      {Object.entries(PHARMACOPHORE_STYLES).map(([name, style]) => (
        <Stack key={name} direction="row" spacing={0.5} alignItems="center">
          <Box aria-hidden="true" sx={{ width: 16, height: 16, borderRadius: style.shape === 'circle' || style.shape === 'double-circle' ? '50%' : 0.5, bgcolor: style.color, color: '#fff', fontSize: 10, display: 'grid', placeItems: 'center' }}>{style.symbol}</Box>
          <Typography variant="caption">{style.label}</Typography>
        </Stack>
      ))}
      <Typography variant="caption" color="text.secondary">Reference: outlined · Comparison: filled · Dashed/neutral connector: backend match</Typography>
    </Stack>
  );
}

function FeatureList({ title, features = [], selectedFeatureId, onSelect }) {
  return (
    <Box>
      <Typography variant="subtitle2">{title} ({features.length})</Typography>
      <Stack direction="row" flexWrap="wrap" useFlexGap gap={0.6} sx={{ mt: 0.5 }}>
        {features.map((feature) => (
          <Chip
            key={feature.feature_id}
            size="small"
            clickable
            color={selectedFeatureId === feature.feature_id ? 'primary' : 'default'}
            variant={selectedFeatureId === feature.feature_id ? 'filled' : 'outlined'}
            label={`${feature.canonical_class} · ${feature.feature_id}`}
            onClick={() => onSelect(feature.feature_id)}
          />
        ))}
        {!features.length ? <Typography variant="caption" color="text.secondary">None</Typography> : null}
      </Stack>
    </Box>
  );
}

function MatchedFeatureTable({ pair, selectedFeatureId, onSelect }) {
  return (
    <TableContainer sx={{ maxHeight: 280, border: '1px solid', borderColor: 'divider' }}>
      <Table stickyHeader size="small" aria-label="Matched pharmacophore feature pairs"><TableHead><TableRow><TableCell>Class</TableCell><TableCell>Reference feature / atoms</TableCell><TableCell>Comparison feature / atoms</TableCell><TableCell>Distance</TableCell><TableCell>Aromatic plane angle</TableCell></TableRow></TableHead><TableBody>{(pair.matches || []).map((match) => <TableRow key={`${match.reference_feature_id}-${match.comparison_feature_id}`} hover selected={selectedFeatureId === match.reference_feature_id || selectedFeatureId === match.comparison_feature_id} tabIndex={0} onClick={() => onSelect(match.reference_feature_id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(match.reference_feature_id); } }} sx={{ cursor: 'pointer' }}><TableCell>{match.canonical_class}</TableCell><TableCell>{match.reference_feature_id}<Typography variant="caption" color="text.secondary" display="block">Template atoms {(match.reference_template_atom_indices || []).join(', ') || 'unavailable'}</Typography></TableCell><TableCell>{match.comparison_feature_id}<Typography variant="caption" color="text.secondary" display="block">Template atoms {(match.comparison_template_atom_indices || []).join(', ') || 'unavailable'}</Typography></TableCell><TableCell>{metric(match.distance_angstrom, ' Å')}</TableCell><TableCell>{metric(match.aromatic_orientation_angle_degrees, '°')}</TableCell></TableRow>)}</TableBody></Table>
    </TableContainer>
  );
}

function MapView({ depiction, state, role, pair, selectedFeatureId, onSelect, threshold }) {
  const set = state?.feature_set;
  const options = {
    depiction, featureSet: set, role, comparison: pair, selectedFeatureId,
    moleculeId: state?.molecule_id, mode: state?.mode, threshold,
  };
  const svg = depiction ? buildPharmacophoreMapSvg(options) : '';
  async function exportMap(format, exportOptions) {
    const exportSvg = buildPharmacophoreMapSvg({ ...options, ...exportOptions });
    const name = `${state.molecule_id}-mode-${state.mode}-pharmacophore-${role}`;
    if (format === 'svg') downloadBlob(new Blob([exportSvg], { type: 'image/svg+xml' }), `${name}.svg`);
    else downloadBlob(await svgToPng(exportSvg, exportOptions.width, exportOptions.height, exportOptions.transparent), `${name}-${exportOptions.width}x${exportOptions.height}.png`);
  }
  return (
    <Stack spacing={0.75} sx={{ minWidth: 0 }}>
      <Typography variant="subtitle2">{role === 'reference' ? 'Reference' : 'Comparison'} · {state?.molecule_id} · Mode {state?.mode}</Typography>
      {svg ? (
        <Box
          data-testid={`pharmacophore-map-${role}`}
          onClick={(event) => { const id = event.target.closest?.('[data-feature-id]')?.getAttribute('data-feature-id'); if (id) onSelect(id); }}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { const id = event.target.closest?.('[data-feature-id]')?.getAttribute('data-feature-id'); if (id) { event.preventDefault(); onSelect(id); } } }}
          sx={{ width: '100%', overflowX: 'auto', '& > svg': { display: 'block', width: '100%', minWidth: 540, height: 'auto' } }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : <Alert severity="info">Loading deterministic RDKit depiction…</Alert>}
      <ExportControls kind="2D" supportsSvg aspectRatio={PHARMACOPHORE_MAP_WIDTH / PHARMACOPHORE_MAP_HEIGHT} onExport={exportMap} />
    </Stack>
  );
}

export function ReferenceFeatureMatrix({ matrix }) {
  return (
    <Box component="section" aria-labelledby="pharmacophore-matrix-title">
      <Typography id="pharmacophore-matrix-title" variant="h2">Reference-feature match matrix</Typography>
      <Typography variant="caption" color="text.secondary">{matrix?.semantics}</Typography>
      <TableContainer sx={{ mt: 0.75, maxHeight: 360, border: '1px solid', borderColor: 'divider' }}>
        <Table stickyHeader size="small" aria-label="Reference pharmacophore feature by selected molecule match matrix" sx={{ minWidth: 620 }}>
          <TableHead><TableRow><TableCell>Reference feature</TableCell><TableCell>Selected-set frequency</TableCell>{(matrix?.columns || []).map((column) => <TableCell key={`${column.molecule_id}-${column.mode}`} align="center">{column.molecule_id}<Typography variant="caption" display="block">Mode {column.mode}</Typography></TableCell>)}</TableRow></TableHead>
          <TableBody>{(matrix?.rows || []).map((row) => <TableRow key={row.reference_feature_id}><TableCell component="th" scope="row">{row.canonical_class}<Typography variant="caption" color="text.secondary" display="block">{row.reference_feature_id}</Typography></TableCell><TableCell>{row.matched_comparison_count}/{row.selected_comparison_count}</TableCell>{row.cells.map((cell) => <TableCell key={`${row.reference_feature_id}-${cell.molecule_id}`} align="center" aria-label={`${cell.molecule_id}: ${statusLabel(cell.status)}`}>{cell.status === 'matched' ? `${metric(cell.distance_angstrom, ' Å')}` : statusLabel(cell.status)}</TableCell>)}</TableRow>)}</TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

async function loadPose(baseUrl, jobId, state, row, signal) {
  const visualization = state?.visualization || {};
  const artifact = await fetchDockingPoseArtifact(baseUrl, jobId, visualization.pose_artifact, visualization.pose_sha256, signal);
  const selected = selectVinaPoseMode(artifact.models, row?.docking_result?.modes || [], state.mode);
  return { text: selected.pose.text, format: 'pdbqt', identity: { moleculeId: state.molecule_id, poseSha256: artifact.sha256, mode: state.mode } };
}

export default function PharmacophorePanel({ baseUrl, jobId, payload, points = [], rows = [], focusedMoleculeId = '', onFocusComparison = () => {} }) {
  const comparisons = payload?.comparisons || [];
  const focused = comparisons.find((item) => item.molecule_id === focusedMoleculeId) || comparisons[0] || null;
  const pair = focused?.comparison || {};
  const reference = payload?.reference;
  const comparison = focused?.feature_state;
  const [tab, setTab] = useState(0);
  const [selectedFeatureId, setSelectedFeatureId] = useState('');
  const [depictions, setDepictions] = useState({});
  const [artifacts, setArtifacts] = useState({ status: 'idle', receptor: null, reference: null, comparison: null, referenceFeatures: [], comparisonFeatures: [], matches: [], error: '' });
  const [visibility, setVisibility] = useState({ reference: true, comparison: true });
  const [showConnectors, setShowConnectors] = useState(true);
  const [showReferenceLigand, setShowReferenceLigand] = useState(true);
  const [showComparisonLigand, setShowComparisonLigand] = useState(true);
  const [showPocket, setShowPocket] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const viewerRef = useRef(null);
  const referenceFeatures = reference?.feature_set?.features || [];
  const comparisonFeatures = comparison?.feature_set?.features || [];
  const matchedReferenceIds = new Set((pair.matches || []).map((match) => match.reference_feature_id));
  const matchedComparisonIds = new Set((pair.matches || []).map((match) => match.comparison_feature_id));
  const referenceOnly = referenceFeatures.filter((feature) => !matchedReferenceIds.has(feature.feature_id));
  const comparisonOnly = comparisonFeatures.filter((feature) => !matchedComparisonIds.has(feature.feature_id));
  const matchedFeatures = referenceFeatures.filter((feature) => matchedReferenceIds.has(feature.feature_id));
  const refPoint = points.find((point) => point.molecule_id === reference?.molecule_id);
  const cmpPoint = points.find((point) => point.molecule_id === comparison?.molecule_id);

  useEffect(() => {
    setSelectedFeatureId('');
    if (!reference || !comparison) return undefined;
    const controller = new AbortController();
    const requested = [reference, ...comparisons.map((item) => item.feature_state)];
    Promise.all(requested.map(async (state) => {
      const point = points.find((item) => item.molecule_id === state.molecule_id);
      if (!point?.canonical_smiles) return [state.molecule_id, null];
      const response = await fetch(`${baseUrl}/api/design-logic/depiction?${new URLSearchParams({ smiles: point.canonical_smiles, width: '420', height: '300' })}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Ligand depiction unavailable (${response.status}).`);
      return [state.molecule_id, await response.json()];
    })).then((entries) => setDepictions(Object.fromEntries(entries))).catch(() => {});
    return () => controller.abort();
  }, [baseUrl, reference?.molecule_id, comparisons, points]);

  useEffect(() => {
    if (!reference?.visualization || !comparison?.visualization || !focused) return undefined;
    const controller = new AbortController();
    setArtifacts((current) => current.receptor
      ? { ...current, status: 'refreshing', error: '' }
      : { status: 'loading', receptor: null, reference: null, comparison: null, referenceFeatures: [], comparisonFeatures: [], matches: [], error: '' });
    const visualization = reference.visualization;
    const receptorPromise = fetchReceptorStructure(baseUrl, {
      receptor_id: visualization.receptor_id, docking_ready: true,
      docking_receptor_sha256: visualization.prepared_receptor_sha256,
      preparation_id: visualization.preparation_id || '',
    }, controller.signal);
    const referenceRow = rows.find((row) => String(row.molecule_id) === reference.molecule_id);
    const comparisonRow = rows.find((row) => String(row.molecule_id) === comparison.molecule_id);
    Promise.all([
      receptorPromise,
      loadPose(baseUrl, jobId, reference, referenceRow, controller.signal),
      loadPose(baseUrl, jobId, comparison, comparisonRow, controller.signal),
    ]).then(([receptor, referencePose, comparisonPose]) => setArtifacts({ status: 'ready', receptor, reference: referencePose, comparison: comparisonPose, referenceFeatures, comparisonFeatures, matches: pair.matches || [], error: '' }))
      .catch((error) => { if (!controller.signal.aborted) setArtifacts({ status: 'error', receptor: null, reference: null, comparison: null, referenceFeatures: [], comparisonFeatures: [], matches: [], error: error.message }); });
    return () => controller.abort();
  }, [baseUrl, jobId,
    reference?.molecule_id, reference?.mode, reference?.visualization?.pose_artifact_path,
    comparison?.molecule_id, comparison?.mode, comparison?.visualization?.pose_artifact_path,
    focused?.molecule_id, rows]);

  async function export3d(_format, options) {
    const dimensions = pharmacophore3dExportDimensions(options);
    const output = await viewerRef.current?.exportPng(dimensions.width, dimensions.height, options.transparent);
    if (!output?.uri) return;
    const blob = await composePharmacophore3dPng(output.uri, { ...options, ...dimensions }, {
      referenceId: reference.molecule_id, referenceMode: reference.mode,
      comparisonId: comparison.molecule_id, comparisonMode: comparison.mode,
      threshold: payload.distance_threshold_angstrom,
    });
    downloadBlob(blob, `${reference.molecule_id}-vs-${comparison.molecule_id}-pharmacophore-${dimensions.width}x${dimensions.height}.png`);
  }

  if (!payload) return null;
  if (!comparisons.length) return <Alert severity="info">Add a comparison molecule to inspect pose-specific pharmacophore evidence.</Alert>;
  return (
    <Stack spacing={1.25} data-testid="pharmacophore-panel">
      <Alert severity="warning" variant="outlined">Pharmacophore features describe pose-specific molecular-recognition geometry in the selected docking poses. Matching is threshold-dependent and does not establish experimental binding, potency, or biological equivalence. Protonation is not scientifically resolved and poses are not realigned.</Alert>
      <Paper component="section" variant="outlined" sx={{ p: { xs: 1.25, md: 1.75 }, minWidth: 0 }}>
        <Stack spacing={1.25}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={1}>
            <Box><Typography variant="h2">Pose-specific pharmacophore evidence</Typography><Typography variant="caption" color="text.secondary">{reference?.molecule_id} · Mode {reference?.mode} vs {comparison?.molecule_id} · Mode {comparison?.mode} · explicit {Number(payload.distance_threshold_angstrom).toFixed(2)} Å threshold</Typography></Box>
            <TextField select size="small" label="Focused comparison" value={focused?.molecule_id || ''} onChange={(event) => onFocusComparison(event.target.value)} sx={{ minWidth: 220 }}>{comparisons.map((item) => <MenuItem key={item.molecule_id} value={item.molecule_id}>{item.molecule_id} · Mode {item.mode}</MenuItem>)}</TextField>
          </Stack>
          {pair.status !== 'available' && pair.status !== 'one_empty' && pair.status !== 'both_empty' ? <Alert severity="warning">{statusLabel(pair.status)}: {pair.message || 'This explicit pair is unavailable.'}</Alert> : null}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(5, minmax(0, 1fr))' }, gap: 1 }}>{pairMetricRows(pair).map(([label, value]) => <Paper key={label} variant="outlined" sx={{ p: 1 }}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography variant="h3">{value}</Typography></Paper>)}</Box>
          <Stack direction="row" flexWrap="wrap" useFlexGap gap={0.75}><Chip size="small" variant="outlined" label={`Reference features: ${pair.reference_feature_count ?? referenceFeatures.length}`} /><Chip size="small" label={`Comparison features: ${pair.comparison_feature_count ?? comparisonFeatures.length}`} /><Chip size="small" variant="outlined" label={`Mean match distance: ${metric(pair.mean_match_distance_angstrom, ' Å')}`} /><Chip size="small" variant="outlined" label={`Maximum match distance: ${metric(pair.max_match_distance_angstrom, ' Å')}`} /><Chip size="small" variant="outlined" label={`Compatibility: ${statusLabel(pair.compatibility?.status || pair.status)}`} /></Stack>
          <Typography variant="caption" color="text.secondary">Independent context: Morgan Tanimoto {metric(cmpPoint?.structural_similarity)} · exact Murcko {cmpPoint?.scaffold_relationship?.exact_match == null ? 'unavailable' : cmpPoint.scaffold_relationship.exact_match ? 'same' : 'different'} · generic framework {cmpPoint?.scaffold_relationship?.generic_framework_match == null ? 'unavailable' : cmpPoint.scaffold_relationship.generic_framework_match ? 'same' : 'different'} · interaction Jaccard {metric(cmpPoint?.interaction_similarity)} · Vina affinity {metric(cmpPoint?.vina_affinity_kcal_mol, ' kcal/mol')}. These measurements are not combined into a score.</Typography>
          <TableContainer sx={{ border: '1px solid', borderColor: 'divider' }}><Table size="small" aria-label="Pharmacophore feature class counts"><TableHead><TableRow><TableCell>Canonical class</TableCell><TableCell>Reference</TableCell><TableCell>Comparison</TableCell><TableCell>Matched</TableCell></TableRow></TableHead><TableBody>{featureClassRows(referenceFeatures, comparisonFeatures, pair).map((row) => <TableRow key={row.name}><TableCell>{PHARMACOPHORE_STYLES[row.name].label}</TableCell><TableCell>{row.reference}</TableCell><TableCell>{row.comparison}</TableCell><TableCell>{row.matched}</TableCell></TableRow>)}</TableBody></Table></TableContainer>
          <FeatureList title="Matched reference features" features={matchedFeatures} selectedFeatureId={selectedFeatureId} onSelect={setSelectedFeatureId} />
          <FeatureList title="Reference-only features" features={referenceOnly} selectedFeatureId={selectedFeatureId} onSelect={setSelectedFeatureId} />
          <FeatureList title="Comparison-only features" features={comparisonOnly} selectedFeatureId={selectedFeatureId} onSelect={setSelectedFeatureId} />
          <MatchedFeatureTable pair={pair} selectedFeatureId={selectedFeatureId} onSelect={setSelectedFeatureId} />
          <Tabs value={tab} onChange={(_event, value) => setTab(value)} aria-label="Pharmacophore visualization type"><Tab label="3D Pharmacophore" /><Tab label="2D Feature Maps" /></Tabs>
          {tab === 0 ? <Stack spacing={1}>
            <Stack direction="row" flexWrap="wrap" useFlexGap gap={1}><FormControlLabel control={<Checkbox size="small" checked={visibility.reference} onChange={(event) => setVisibility((current) => ({ ...current, reference: event.target.checked }))} />} label="Reference features" /><FormControlLabel control={<Checkbox size="small" checked={visibility.comparison} onChange={(event) => setVisibility((current) => ({ ...current, comparison: event.target.checked }))} />} label="Comparison features" /><FormControlLabel control={<Checkbox size="small" checked={showReferenceLigand} onChange={(event) => setShowReferenceLigand(event.target.checked)} />} label="Reference ligand" /><FormControlLabel control={<Checkbox size="small" checked={showComparisonLigand} onChange={(event) => setShowComparisonLigand(event.target.checked)} />} label="Comparison ligand" /><FormControlLabel control={<Checkbox size="small" checked={showPocket} onChange={(event) => setShowPocket(event.target.checked)} />} label="Receptor pocket" /><FormControlLabel control={<Checkbox size="small" checked={showConnectors} onChange={(event) => setShowConnectors(event.target.checked)} />} label="Matched-feature connectors" /><FormControlLabel control={<Checkbox size="small" checked={showLabels} onChange={(event) => setShowLabels(event.target.checked)} />} label="Feature labels" /></Stack>
            {artifacts.status === 'loading' || artifacts.status === 'refreshing' ? <Stack direction="row" spacing={1}><CircularProgress size={18} /><Typography variant="body2">Loading two validated pose artifacts into one shared viewer…</Typography></Stack> : null}
            {artifacts.status === 'ready' || artifacts.status === 'refreshing' ? <ReceptorViewer ref={viewerRef} structure={artifacts.receptor} dockedLigand={artifacts.reference} comparisonLigand={artifacts.comparison} showReferenceLigand={showReferenceLigand} showComparisonLigand={showComparisonLigand} box={null} showBox={false} selectedResidues={[]} selectedLigand={null} pocketMode={showPocket ? 'pocket' : 'interactions'} pharmacophoreReferenceFeatures={artifacts.status === 'refreshing' ? artifacts.referenceFeatures : referenceFeatures} pharmacophoreComparisonFeatures={artifacts.status === 'refreshing' ? artifacts.comparisonFeatures : comparisonFeatures} pharmacophoreMatches={artifacts.status === 'refreshing' ? artifacts.matches : (pair.matches || [])} selectedPharmacophoreFeatureId={selectedFeatureId} pharmacophoreVisibility={visibility} showPharmacophoreConnectors={showConnectors} showPharmacophoreLabels={showLabels} onSelectPharmacophoreFeature={setSelectedFeatureId} showViewerLegend={false} viewerAspectRatio="16 / 9" /> : null}
            {artifacts.error ? <Alert severity="warning">Pharmacophore viewer unavailable: {artifacts.error}</Alert> : null}
            <PharmacophoreLegend />
            <Typography variant="caption" color="text.secondary">Feature centers use authoritative pose-resolved coordinates. H-bond features are center markers only; no direction arrows are inferred. Aromatic planes are visual context and are not an orientation match filter.</Typography>
            <ExportControls kind="3D" aspectRatio={16 / 9} onExport={export3d} legendLabel="Pharmacophore legend" />
          </Stack> : <Stack spacing={1}><Typography variant="caption" color="text.secondary">2D pharmacophore feature placement is schematic; spatial matching is calculated from 3D receptor-frame coordinates.</Typography><Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', xl: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5 }}><MapView depiction={depictions[reference?.molecule_id]} state={reference} role="reference" pair={pair} selectedFeatureId={selectedFeatureId} onSelect={setSelectedFeatureId} threshold={payload.distance_threshold_angstrom} /><MapView depiction={depictions[comparison?.molecule_id]} state={comparison} role="comparison" pair={pair} selectedFeatureId={selectedFeatureId} onSelect={setSelectedFeatureId} threshold={payload.distance_threshold_angstrom} /></Box></Stack>}
        </Stack>
      </Paper>
      <Paper component="section" variant="outlined" sx={{ p: { xs: 1.25, md: 1.75 }, minWidth: 0 }}><Typography variant="h2">Threshold sensitivity</Typography><Typography variant="caption" color="text.secondary">Same explicit pose pair; only the qualified center-distance threshold changes.</Typography><TableContainer sx={{ mt: 0.75 }}><Table size="small" aria-label="Pharmacophore threshold sensitivity"><TableHead><TableRow><TableCell>Threshold</TableCell><TableCell>Matches</TableCell><TableCell>Reference coverage</TableCell><TableCell>Comparison coverage</TableCell><TableCell>Overlap</TableCell><TableCell>RMSD / single distance</TableCell></TableRow></TableHead><TableBody>{(focused?.threshold_sensitivity || []).map((row) => <TableRow key={row.distance_threshold_angstrom} selected={row.distance_threshold_angstrom === payload.distance_threshold_angstrom}><TableCell>{Number(row.distance_threshold_angstrom).toFixed(2)} Å</TableCell><TableCell>{row.matched_feature_count ?? '—'}</TableCell><TableCell>{metric(row.reference_coverage)}</TableCell><TableCell>{metric(row.comparison_coverage)}</TableCell><TableCell>{metric(row.pharmacophore_feature_overlap)}</TableCell><TableCell>{row.matched_feature_count === 1 ? metric(row.single_match_distance_angstrom, ' Å') : metric(row.matched_feature_center_rmsd_angstrom, ' Å')}</TableCell></TableRow>)}</TableBody></Table></TableContainer></Paper>
      <Paper component="section" variant="outlined" sx={{ p: { xs: 1.25, md: 1.75 }, minWidth: 0 }}><Typography variant="h2">Selected-set pharmacophore comparison</Typography><TableContainer sx={{ mt: 0.75, overflowX: 'auto' }}><Table size="small" aria-label="Selected molecule pharmacophore comparison" sx={{ minWidth: 980 }}><TableHead><TableRow><TableCell>Molecule / pose</TableCell><TableCell>Scaffold / framework</TableCell><TableCell>Morgan</TableCell><TableCell>Status</TableCell><TableCell>Matches</TableCell><TableCell>Reference coverage</TableCell><TableCell>Comparison coverage</TableCell><TableCell>Overlap</TableCell><TableCell>RMSD / single distance</TableCell><TableCell>Focus</TableCell></TableRow></TableHead><TableBody>{comparisons.map((item) => { const point = points.find((candidate) => candidate.molecule_id === item.molecule_id); return <TableRow key={item.molecule_id} selected={item.molecule_id === focused?.molecule_id}><TableCell>{item.molecule_id} · Mode {item.mode}</TableCell><TableCell>{point?.scaffold_relationship?.label || 'Unavailable'}</TableCell><TableCell>{metric(point?.structural_similarity)}</TableCell><TableCell>{statusLabel(item.comparison.status)}</TableCell><TableCell>{item.comparison.matched_feature_count ?? '—'}</TableCell><TableCell>{metric(item.comparison.reference_coverage)}</TableCell><TableCell>{metric(item.comparison.comparison_coverage)}</TableCell><TableCell>{metric(item.comparison.pharmacophore_feature_overlap)}</TableCell><TableCell>{item.comparison.matched_feature_count === 1 ? metric(item.comparison.single_match_distance_angstrom, ' Å') : metric(item.comparison.matched_feature_center_rmsd_angstrom, ' Å')}</TableCell><TableCell><Button size="small" aria-label={`Focus ${item.molecule_id} in shared 3D pharmacophore viewer`} onClick={() => onFocusComparison(item.molecule_id)}>Focus in shared 3D</Button></TableCell></TableRow>; })}</TableBody></Table></TableContainer></Paper>
      <Paper variant="outlined" sx={{ p: { xs: 1.25, md: 1.75 }, minWidth: 0 }}><ReferenceFeatureMatrix matrix={payload.reference_feature_matrix} /><Box component="details" sx={{ mt: 1 }}><Typography component="summary" variant="subtitle2">Selected-set 2D pharmacophore maps</Typography><Typography variant="caption" color="text.secondary" display="block" sx={{ my: 0.75 }}>Each lightweight vector map uses the current backend comparison and explicit pose; no additional WebGL viewer is created.</Typography><Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', xl: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5 }}>{comparisons.map((item) => <MapView key={item.molecule_id} depiction={depictions[item.molecule_id]} state={item.feature_state} role="comparison" pair={item.comparison} selectedFeatureId={selectedFeatureId} onSelect={setSelectedFeatureId} threshold={payload.distance_threshold_angstrom} />)}</Box></Box><Box component="details" sx={{ mt: 1 }}><Typography component="summary" variant="subtitle2">Provenance and limitations</Typography><Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>Workspace schema {payload.schema_version} · pharmacophore schema {reference?.feature_set?.schema_version || 'unavailable'} · RDKit {reference?.feature_set?.feature_definition?.rdkit_version || 'unavailable'} · BaseFeatures SHA-256 {reference?.feature_set?.feature_definition?.feature_definition_sha256 || 'unavailable'} · mapping {reference?.feature_set?.mapping_schema || 'unavailable'}.</Typography><Typography variant="caption" color="text.secondary" display="block">Reference {reference?.molecule_id} · Mode {reference?.mode} · comparison {comparison?.molecule_id} · Mode {comparison?.mode} · receptor {reference?.feature_set?.receptor_identity || 'unavailable'} · receptor SHA-256 {reference?.feature_set?.receptor_sha256 || 'unavailable'} · threshold {Number(payload.distance_threshold_angstrom).toFixed(2)} Å · protonation {statusLabel(reference?.feature_set?.protonation_status)}.</Typography><Typography variant="caption" color="text.secondary" display="block">Backend matching authority {payload.metadata?.matching_authority || 'unavailable'} · cache {payload.metadata?.cache_status || 'unavailable'}. No ligand realignment was used. Aromatic orientation was not used as a match filter. Feature classes come from the qualified backend feature definition; frontend rendering does not recompute features or matches.</Typography></Box></Paper>
    </Stack>
  );
}
