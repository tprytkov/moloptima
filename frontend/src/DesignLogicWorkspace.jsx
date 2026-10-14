import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Divider, FormControl, InputLabel, MenuItem,
  Paper, Select, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import {
  DESIGN_LOGIC_LIMIT, RAW_CONTACT_PAGE_SIZE, availablePoseModes, contactsForSelection,
  filterMatrixFeatures, firstDockedMoleculeId, formatMetric, interactionChains,
  interactionClassSummary, interactionStatusLabel, interactionTypes, pointTooltip,
  scatterCoordinates,
} from './designLogicData.js';
import InteractionVisualizationPanel from './InteractionVisualizationPanel.jsx';
import MultiLigandComparison from './MultiLigandComparison.jsx';
import PharmacophorePanel from './PharmacophorePanel.jsx';
import {
  MAX_SELECTED_COMPARISONS, addComparison, removeComparison, selectedComparisonPoints,
  selectedSetMatrix,
} from './designLogicComparison.js';

const SCATTER_WIDTH = 700;
const SCATTER_HEIGHT = 360;

async function postJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(typeof payload.detail === 'string' ? payload.detail : payload.detail?.message || `Request failed (${response.status}).`);
  }
  return response.json();
}

function structureUrl(baseUrl, point, width = 230, height = 150) {
  if (!point?.canonical_smiles) return '';
  return `${baseUrl}/api/molecules/structure?${new URLSearchParams({
    smiles: point.canonical_smiles, width: String(width), height: String(height),
  })}`;
}

function ModeSelect({ label, value, modes, onChange }) {
  return (
    <FormControl fullWidth size="small">
      <InputLabel>{label}</InputLabel>
      <Select label={label} value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {modes.map((mode) => <MenuItem key={mode} value={mode}>Vina mode {mode}</MenuItem>)}
      </Select>
    </FormControl>
  );
}

function StatusValue({ label, value, status }) {
  return (
    <Stack direction="row" justifyContent="space-between" gap={1}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="caption" fontWeight={700} color={status === 'warning' ? 'warning.dark' : 'text.primary'}>{value}</Typography>
    </Stack>
  );
}

function ControlRail({ reference, baseUrl, modes, referenceMode, comparisonMode, coverage, features, filters, onReferenceMode, onComparisonMode, onFilters, onAnalyze, analyzing }) {
  return (
    <Stack component="aside" aria-label="Design Logic reference and filters" spacing={1.4} sx={{ gridArea: 'rail', minWidth: 0, pr: { md: 1.5 }, borderRight: { md: '1px solid' }, borderColor: 'divider' }}>
      <Box>
        <Typography variant="overline" color="text.secondary">Reference molecule</Typography>
        <Typography variant="h2" sx={{ overflowWrap: 'anywhere' }}>{reference?.display_name || reference?.molecule_id || 'Not selected'}</Typography>
        <Typography variant="caption" color="text.secondary">ID: {reference?.molecule_id || '—'}</Typography>
      </Box>
      {reference ? <Box component="img" loading="lazy" src={structureUrl(baseUrl, reference)} alt={`2D structure for reference molecule ${reference.display_name || reference.molecule_id}`} sx={{ width: '100%', height: 145, objectFit: 'contain', bgcolor: '#fff', border: '1px solid', borderColor: 'divider', borderRadius: 1 }} /> : null}
      <StatusValue label="Source" value={reference?.source || '—'} />
      <StatusValue label="Scaffold" value={reference?.scaffold_id || 'Unavailable'} />
      <StatusValue label="Fingerprint" value={interactionStatusLabel(reference?.fingerprint_status)} status={reference?.fingerprint_status === 'available' ? '' : 'warning'} />
      <ModeSelect label="Reference Vina mode" value={referenceMode} modes={modes} onChange={onReferenceMode} />
      <ModeSelect label="Comparison Vina mode" value={comparisonMode} modes={modes} onChange={onComparisonMode} />
      <Button variant="contained" disabled={!reference || analyzing || reference.fingerprint_status === 'available'} onClick={() => onAnalyze(reference)}>
        {analyzing ? 'Analyzing selected pose…' : 'Analyze reference pose'}
      </Button>
      <Divider />
      <Box>
        <Typography variant="subtitle2" gutterBottom>Analysis coverage</Typography>
        <StatusValue label="Comparison set" value={coverage?.total ?? 0} />
        <StatusValue label="Fingerprinted" value={coverage?.available ?? 0} />
        <StatusValue label="Not analyzed" value={coverage?.not_analyzed ?? 0} status={coverage?.not_analyzed ? 'warning' : ''} />
        <StatusValue label="Incompatible" value={coverage?.incompatible ?? 0} status={coverage?.incompatible ? 'warning' : ''} />
        <StatusValue label="Missing pose" value={coverage?.missing_pose ?? 0} status={coverage?.missing_pose ? 'warning' : ''} />
      </Box>
      <Divider />
      <Typography variant="subtitle2">Matrix filters</Typography>
      <FormControl fullWidth size="small"><InputLabel>Interaction type</InputLabel><Select label="Interaction type" value={filters.interactionType} onChange={(event) => onFilters({ ...filters, interactionType: event.target.value })}><MenuItem value="all">All interaction types</MenuItem>{interactionTypes(features).map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}</Select></FormControl>
      <FormControl fullWidth size="small"><InputLabel>Chain</InputLabel><Select label="Chain" value={filters.chain} onChange={(event) => onFilters({ ...filters, chain: event.target.value })}><MenuItem value="all">All chains</MenuItem>{interactionChains(features).map((value) => <MenuItem key={value} value={value}>Chain {value}</MenuItem>)}</Select></FormControl>
      <TextField label="Residue or token search" value={filters.residueQuery} onChange={(event) => onFilters({ ...filters, residueQuery: event.target.value })} inputProps={{ 'aria-label': 'Filter interaction matrix by residue or token' }} />
    </Stack>
  );
}

function SimilarityScatter({ points, referenceId, selectedId, onSelect }) {
  const plotted = useMemo(() => scatterCoordinates(points, SCATTER_WIDTH, SCATTER_HEIGHT), [points]);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <Box component="section" aria-labelledby="design-logic-scatter-title" sx={{ minWidth: 0 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={0.5}>
        <Box><Typography id="design-logic-scatter-title" variant="h2">Structural vs. interaction similarity</Typography><Typography variant="caption" color="text.secondary">Select a point to inspect it. The reference remains fixed until “Set as reference” is used.</Typography></Box>
        <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap"><Typography variant="caption">● Reference</Typography><Typography variant="caption" color="secondary.main">◆ Selected</Typography><Typography variant="caption" color="text.secondary">● Comparison</Typography></Stack>
      </Stack>
      <Box sx={{ width: '100%', overflowX: 'auto' }}>
        <Box component="svg" role="img" aria-label="Morgan structural Tanimoto by interaction fingerprint similarity scatter plot" viewBox={`0 0 ${SCATTER_WIDTH} ${SCATTER_HEIGHT}`} sx={{ display: 'block', minWidth: 620, width: '100%', height: 'auto', mt: 0.5, bgcolor: '#fff' }}>
          <rect x="44" y="44" width="612" height="272" fill="#fbfcfd" stroke="#d9e2ea" />
          {ticks.map((tick) => { const x = 44 + tick * 612; const y = 316 - tick * 272; return <g key={tick}><line x1={x} x2={x} y1="44" y2="316" stroke="#e8edf2" /><line x1="44" x2="656" y1={y} y2={y} stroke="#e8edf2" /><text x={x} y="334" textAnchor="middle" fontSize="10" fill="#5b6777">{tick.toFixed(2)}</text><text x="36" y={y + 3} textAnchor="end" fontSize="10" fill="#5b6777">{tick.toFixed(2)}</text></g>; })}
          <text x="350" y="354" textAnchor="middle" fontSize="12" fill="#18232f">Morgan fingerprint Tanimoto</text>
          <text transform="translate(12 180) rotate(-90)" textAnchor="middle" fontSize="12" fill="#18232f">Interaction fingerprint similarity</text>
          <text x="640" y="66" textAnchor="end" fontSize="10" fill="#5b6777">Lower structural similarity / higher interaction similarity</text>
          {plotted.map((point) => {
            const reference = point.molecule_id === referenceId;
            const selected = point.molecule_id === selectedId;
            return <g key={`${point.molecule_id}-${point.mode}`} role="button" tabIndex="0" aria-label={pointTooltip(point)} onClick={() => onSelect(point.molecule_id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(point.molecule_id); } }} style={{ cursor: 'pointer', outline: 'none' }}><title>{pointTooltip(point)}</title>{selected && !reference ? <rect x={point.screenX - 6} y={point.screenY - 6} width="12" height="12" transform={`rotate(45 ${point.screenX} ${point.screenY})`} fill="#2f8f6f" stroke="#fff" strokeWidth="2" /> : <circle cx={point.screenX} cy={point.screenY} r={reference ? 6 : 4.5} fill={reference ? '#145f74' : '#9eb7c8'} stroke={selected ? '#18232f' : '#fff'} strokeWidth={selected ? 2.5 : 1.5} />}</g>;
          })}
        </Box>
      </Box>
      {!plotted.length ? <Alert severity="info" sx={{ mt: 1 }}>No compatible fingerprint pairs are available for the selected explicit modes. Missing and incompatible molecules remain listed in coverage.</Alert> : null}
    </Box>
  );
}

function InteractionMatrix({ matrix, filters, selectedToken, onSelectToken }) {
  const features = filterMatrixFeatures(matrix?.features || [], filters);
  return (
    <Box component="section" aria-labelledby="interaction-matrix-title" sx={{ minWidth: 0 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={0.5}><Box><Typography id="interaction-matrix-title" variant="h2">Residue × molecule interaction matrix</Typography><Typography variant="caption" color="text.secondary">Binary token presence only; raw contact multiplicity is retained in the inspector.</Typography></Box><Typography variant="caption" color="text.secondary">{matrix?.ordering}</Typography></Stack>
      <TableContainer sx={{ maxHeight: 330, mt: 0.75, border: '1px solid', borderColor: 'divider' }}>
        <Table stickyHeader size="small" aria-label="Binary residue by molecule interaction matrix" sx={{ minWidth: Math.max(620, 250 + (matrix?.columns?.length || 0) * 92) }}>
          <TableHead><TableRow><TableCell sx={{ position: 'sticky', left: 0, zIndex: 4, bgcolor: '#f5f8fa', minWidth: 235 }}>Canonical residue-interaction feature</TableCell>{(matrix?.columns || []).map((column) => <TableCell key={`${column.molecule_id}-${column.mode}`} align="center" sx={{ minWidth: 92 }}>{column.molecule_id}<Typography component="span" display="block" variant="caption">Mode {column.mode}</Typography></TableCell>)}</TableRow></TableHead>
        <TableBody>{features.map((feature) => <TableRow key={feature} hover selected={selectedToken === feature} tabIndex={0} aria-label={`Inspect raw contacts for ${feature}`} onClick={() => onSelectToken(feature)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectToken(feature); } }} sx={{ cursor: 'pointer' }}><TableCell component="th" scope="row" sx={{ position: 'sticky', left: 0, bgcolor: selectedToken === feature ? '#e9f4f1' : '#fff', zIndex: 1, fontFamily: 'monospace' }}>{feature}</TableCell>{(matrix?.columns || []).map((column) => { const present = column.present_tokens.includes(feature); return <TableCell key={`${feature}-${column.molecule_id}`} align="center" aria-label={`${column.molecule_id}, ${feature}: ${present ? 'present' : 'absent'}`}><Box component="span" aria-hidden="true" sx={{ display: 'inline-block', width: 12, height: 12, bgcolor: present ? 'primary.main' : '#fff', border: '1px solid', borderColor: present ? 'primary.main' : '#b7c3cc' }} /></TableCell>; })}</TableRow>)}</TableBody>
        </Table>
      </TableContainer>
      {!features.length ? <Alert severity="info" sx={{ mt: 1 }}>No matrix features match the current filters.</Alert> : null}
    </Box>
  );
}

function TokenList({ title, tokens = [] }) {
  return <Box><Typography variant="caption" fontWeight={700}>{title} ({tokens.length})</Typography><Stack spacing={0.25} sx={{ mt: 0.4 }}>{tokens.length ? tokens.slice(0, 8).map((token) => <Typography key={token} variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>{token}</Typography>) : <Typography variant="caption" color="text.secondary">None</Typography>}</Stack></Box>;
}

function Inspector({ point, referenceId, baseUrl, selectedToken, onSelectToken, onAnalyze, analyzing, onSetReference, comparisonIds, onAddComparison }) {
  const fingerprint = point?.fingerprint;
  const contacts = contactsForSelection(fingerprint, selectedToken).slice(0, RAW_CONTACT_PAGE_SIZE);
  const partitions = point?.token_partition || { shared: [], reference_only: [], comparison_only: [] };
  return (
    <Stack component="aside" aria-label="Selected molecule interaction inspector" spacing={1.25} sx={{ gridArea: 'inspector', minWidth: 0, borderColor: 'divider', '@media (min-width: 1400px)': { pl: 1.5, borderLeft: '1px solid' } }}>
      <Stack direction="row" justifyContent="space-between" gap={1}><Box><Typography variant="overline" color="text.secondary">Selected molecule</Typography><Typography variant="h2" sx={{ overflowWrap: 'anywhere' }}>{point?.display_name || point?.molecule_id || 'Not selected'}</Typography></Box>{point && point.molecule_id !== referenceId ? <Button size="small" variant="outlined" onClick={() => onSetReference(point.molecule_id)}>Set as reference</Button> : null}</Stack>
      {point && point.molecule_id !== referenceId ? <Button size="small" variant="contained" disabled={comparisonIds.includes(point.molecule_id) || comparisonIds.length >= MAX_SELECTED_COMPARISONS} onClick={() => onAddComparison(point.molecule_id)}>{comparisonIds.includes(point.molecule_id) ? 'In comparison set' : comparisonIds.length >= MAX_SELECTED_COMPARISONS ? 'Comparison set limit reached' : 'Add to comparison'}</Button> : null}
      {point ? <Box component="img" loading="lazy" src={structureUrl(baseUrl, point, 300, 165)} alt={`2D structure for selected molecule ${point.display_name || point.molecule_id}`} sx={{ width: '100%', height: 165, objectFit: 'contain', bgcolor: '#fff', border: '1px solid', borderColor: 'divider', borderRadius: 1 }} /> : null}
      <StatusValue label="Selected Vina pose" value={point ? `Mode ${point.mode}` : '—'} />
      <StatusValue label="Source" value={point?.source || '—'} />
      <StatusValue label="Vina affinity" value={`${formatMetric(point?.vina_affinity_kcal_mol)} kcal/mol`} />
      <StatusValue label="Morgan fingerprint Tanimoto" value={formatMetric(point?.structural_similarity)} />
      <StatusValue label="Interaction fingerprint similarity" value={formatMetric(point?.interaction_similarity)} status={point?.interaction_similarity_status === 'valid' ? '' : 'warning'} />
      <StatusValue label="Fingerprint status" value={interactionStatusLabel(point?.fingerprint_status)} status={point?.fingerprint_status === 'available' ? '' : 'warning'} />
      <StatusValue label="Scaffold relationship" value={point?.same_scaffold_as_reference == null ? 'Unavailable' : point.same_scaffold_as_reference ? 'Same scaffold' : 'Different scaffold'} />
      <StatusValue label="Raw interaction count" value={fingerprint?.raw_interaction_count ?? fingerprint?.raw_interaction_records?.length ?? 0} />
      <StatusValue label="Unique token count" value={fingerprint?.unique_token_count ?? fingerprint?.canonical_tokens?.length ?? 0} />
      <StatusValue label="Shared / reference only / comparison only" value={`${partitions.shared.length} / ${partitions.reference_only.length} / ${partitions.comparison_only.length}`} />
      {point?.fingerprint_status !== 'available' ? <Button variant="contained" disabled={!point || analyzing || point?.fingerprint_status === 'missing_pose'} onClick={() => onAnalyze(point)}>{analyzing ? 'Analyzing selected pose…' : 'Analyze selected pose'}</Button> : null}
      {point?.fingerprint_message ? <Alert severity="info">{point.fingerprint_message}</Alert> : null}
      {fingerprint ? <><Divider /><Box><Typography variant="subtitle2">Interaction summary</Typography><StatusValue label="Unique interaction features" value={fingerprint.unique_token_count ?? fingerprint.canonical_tokens?.length ?? 0} />{interactionClassSummary(fingerprint).map(([name, count]) => <StatusValue key={name} label={name} value={count} />)}</Box><Divider /><Stack spacing={1}><TokenList title="Shared" tokens={partitions.shared} /><TokenList title="Reference-only" tokens={partitions.reference_only} /><TokenList title="Comparison-only" tokens={partitions.comparison_only} /></Stack><Divider /><Box><Typography variant="subtitle2">Raw contacts {selectedToken ? `for ${selectedToken}` : ''}</Typography><Typography variant="caption" color="text.secondary">Showing {contacts.length} of {contactsForSelection(fingerprint, selectedToken).length} atom-level contacts.</Typography><Stack spacing={0.65} sx={{ mt: 0.75, maxHeight: 250, overflowY: 'auto' }}>{contacts.map((record, index) => { const token = [record.receptor.chain, record.receptor.residue_name, `${record.receptor.residue_number}${record.receptor.insertion_code || ''}`, record.interaction_type, record.direction].filter(Boolean).join(':'); return <Box key={`${record.interaction_type}-${index}`} role="button" tabIndex={0} aria-pressed={selectedToken === token} onClick={() => onSelectToken(token)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectToken(token); } }} sx={{ p: 0.5, borderBottom: '1px solid', borderColor: 'divider', cursor: 'pointer', bgcolor: selectedToken === token ? '#e9f4f1' : 'transparent' }}><Typography variant="caption" fontWeight={700}>{record.receptor.chain}:{record.receptor.residue_name}:{record.receptor.residue_number}{record.receptor.insertion_code} · {record.interaction_type}{record.direction ? ` · ${record.direction}` : ''}</Typography><Typography variant="caption" color="text.secondary" display="block">Protein {record.receptor.atoms?.map((atom) => `${atom.atom_name}#${atom.atom_serial}`).join(', ') || 'atoms unavailable'} · ligand template {(record.ligand.template_atom_indices || []).map((index) => `#${index}`).join(', ') || 'atoms unavailable'} · ligand PDBQT {record.ligand.pose_atoms?.map((atom) => `#${atom.pose_atom_serial}`).join(', ') || 'atoms unavailable'}</Typography><Typography variant="caption" color="text.secondary" display="block">{Object.entries(record.geometry || {}).map(([key, value]) => `${key} ${typeof value === 'number' ? formatMetric(value) : value}`).join(' · ') || 'No engine geometry reported'} · Vina mode {point.mode}</Typography></Box>; })}</Stack></Box><Box component="details"><Typography component="summary" variant="subtitle2" sx={{ cursor: 'pointer' }}>Fingerprint provenance</Typography><Stack spacing={0.35} sx={{ mt: 0.75 }}><StatusValue label="Selected pose mode" value={`Vina Mode ${point.mode}`} /><StatusValue label="Receptor" value={fingerprint.receptor?.identity || '—'} /><StatusValue label="Receptor SHA" value={fingerprint.receptor?.authoritative_sha256 ? `${fingerprint.receptor.authoritative_sha256.slice(0, 12)}…` : '—'} /><StatusValue label="Fingerprint schema" value={fingerprint.schema_version} /><StatusValue label="Mapping schema" value={fingerprint.mapping_schema_version} /><StatusValue label="ProLIF" value={fingerprint.runtime_provenance?.versions?.prolif || '—'} /><StatusValue label="Cache" value={fingerprint.cache_status || '—'} /><StatusValue label="Protonation" value={fingerprint.receptor?.protonation_status || 'not_scientifically_resolved'} /></Stack></Box></> : null}
    </Stack>
  );
}

function ComparisonTray({ reference, points, comparisonIds, onRemove, onClear }) {
  const byId = new Map(points.map((point) => [point.molecule_id, point]));
  return (
    <Paper component="section" variant="outlined" aria-label="Comparison set" sx={{ p: 1.25 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1}><Box><Typography variant="subtitle2">Comparison set</Typography><Typography variant="caption" color="text.secondary">Reference: {reference?.molecule_id || '—'} · up to {MAX_SELECTED_COMPARISONS} explicit comparisons</Typography></Box><Button size="small" disabled={!comparisonIds.length} onClick={onClear}>Clear comparisons</Button></Stack>
      <Stack direction="row" useFlexGap flexWrap="wrap" gap={0.75} sx={{ mt: 0.75 }}><Chip label={`${reference?.molecule_id || 'Reference'} · Reference`} color="primary" variant="outlined" />{comparisonIds.map((id) => <Chip key={id} label={`${byId.get(id)?.display_name || id} · Mode ${byId.get(id)?.mode || '—'}`} onDelete={() => onRemove(id)} deleteIcon={<span aria-hidden="true">×</span>} aria-label={`Remove ${id} from comparison set`} />)}</Stack>
      {comparisonIds.length >= MAX_SELECTED_COMPARISONS ? <Typography variant="caption" color="warning.dark" display="block" sx={{ mt: 0.75 }}>Maximum of {MAX_SELECTED_COMPARISONS} comparison molecules reached. Remove one before adding another.</Typography> : null}
    </Paper>
  );
}

export default function DesignLogicWorkspace({
  result, baseUrl = 'http://localhost:8000', initialWorkspace = null,
  initialReferenceId = '', initialSelectedId = '', initialReferenceMode = null,
  initialComparisonMode = null, initialComparisonIds = [], initialViewMode = 'single',
  initialEvidenceView = 'interactions', initialPharmacophore = null,
}) {
  const rows = result?.results || [];
  const jobId = result?.job_id || '';
  const modes = useMemo(() => availablePoseModes(rows), [rows]);
  const initialReference = initialReferenceId || firstDockedMoleculeId(rows);
  const [referenceId, setReferenceId] = useState(initialReference);
  const [referenceMode, setReferenceMode] = useState(initialReferenceMode || modes[0] || 1);
  const [comparisonMode, setComparisonMode] = useState(initialComparisonMode || modes[0] || 1);
  const [selectedId, setSelectedId] = useState(initialSelectedId || initialReference);
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [loading, setLoading] = useState(false);
  const [analyzingId, setAnalyzingId] = useState('');
  const [error, setError] = useState('');
  const [selectedToken, setSelectedToken] = useState('');
  const [comparisonIds, setComparisonIds] = useState(() => initialComparisonIds.slice(0, MAX_SELECTED_COMPARISONS).filter((id) => id !== initialReference));
  const [viewMode, setViewMode] = useState(initialViewMode);
  const [filters, setFilters] = useState({ interactionType: 'all', chain: 'all', residueQuery: '' });
  const [evidenceView, setEvidenceView] = useState(initialEvidenceView);
  const [pharmacophoreThreshold, setPharmacophoreThreshold] = useState(1.5);
  const [pharmacophore, setPharmacophore] = useState(initialPharmacophore);
  const [pharmacophoreLoading, setPharmacophoreLoading] = useState(false);
  const [pharmacophoreError, setPharmacophoreError] = useState('');

  const loadWorkspace = useCallback(async () => {
    if (!jobId || !referenceId) return;
    setLoading(true); setError('');
    try {
      const payload = await postJson(baseUrl, '/api/design-logic/workspace', {
        job_id: jobId, reference_molecule_id: referenceId, reference_mode: referenceMode,
        comparison_mode: comparisonMode, limit: DESIGN_LOGIC_LIMIT,
      });
      setWorkspace(payload);
      setSelectedId((current) => payload.points.some((point) => point.molecule_id === current) ? current : referenceId);
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }, [baseUrl, jobId, referenceId, referenceMode, comparisonMode]);

  useEffect(() => { loadWorkspace(); }, [loadWorkspace]);

  const pharmacophoreComparisonIds = useMemo(() => {
    if (viewMode === 'compare') return comparisonIds.filter((id) => id !== referenceId);
    return selectedId && selectedId !== referenceId ? [selectedId] : [];
  }, [viewMode, comparisonIds, selectedId, referenceId]);
  const pharmacophoreComparisonKey = pharmacophoreComparisonIds.join('|');

  useEffect(() => {
    if (evidenceView !== 'pharmacophore' || !jobId || !referenceId || !pharmacophoreComparisonIds.length) {
      if (!pharmacophoreComparisonIds.length) setPharmacophore(null);
      return undefined;
    }
    const controller = new AbortController();
    setPharmacophoreLoading(true); setPharmacophoreError('');
    fetch(`${baseUrl}/api/design-logic/pharmacophore`, {
      method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: jobId, reference_molecule_id: referenceId, reference_mode: referenceMode,
        comparison_molecule_ids: pharmacophoreComparisonIds, comparison_mode: comparisonMode,
        distance_threshold_angstrom: pharmacophoreThreshold,
      }),
    }).then(async (response) => {
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.detail?.message || body.detail || `Request failed (${response.status}).`); }
      return response.json();
    }).then(setPharmacophore).catch((requestError) => { if (!controller.signal.aborted) setPharmacophoreError(requestError.message); })
      .finally(() => { if (!controller.signal.aborted) setPharmacophoreLoading(false); });
    return () => controller.abort();
  }, [baseUrl, jobId, referenceId, referenceMode, comparisonMode, pharmacophoreThreshold,
    pharmacophoreComparisonKey, evidenceView]);

  async function analyze(point) {
    if (!point || analyzingId) return;
    setAnalyzingId(point.molecule_id); setError('');
    try {
      const payload = await postJson(baseUrl, '/api/design-logic/analyze', { job_id: jobId, molecule_id: point.molecule_id, mode: point.mode });
      if (payload.status !== 'available') throw new Error(payload.message || interactionStatusLabel(payload.status));
      await loadWorkspace();
    } catch (requestError) { setError(requestError.message); }
    finally { setAnalyzingId(''); }
  }

  const points = workspace?.points || [];
  const reference = points.find((point) => point.molecule_id === referenceId) || null;
  const selected = points.find((point) => point.molecule_id === selectedId) || reference;
  const comparisonPoints = useMemo(() => selectedComparisonPoints(points, referenceId, comparisonIds), [points, referenceId, comparisonIds]);
  const visibleMatrix = viewMode === 'compare' ? selectedSetMatrix(comparisonPoints) : workspace?.matrix;
  if (!jobId || !rows.length) return <Alert severity="info">Complete a docking calculation to use Design Logic. Interaction fingerprints remain tied to explicit Vina poses.</Alert>;
  if (!initialReference || !modes.length) return <Alert severity="info">No successful pose-bearing docking results are available for Design Logic.</Alert>;
  return (
    <Stack spacing={1.25} data-testid="design-logic-workspace" sx={{ minWidth: 0 }}>
      <Alert severity="warning" variant="outlined">Interaction fingerprints describe predicted contacts in selected docking poses. They are not experimental binding evidence, and protonation is not scientifically resolved.</Alert>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} gap={1}><Box><Typography variant="h1">Design Logic</Typography><Typography variant="body2" color="text.secondary">Compare structural similarity with predicted dock-pose interaction patterns without combining the measurements.</Typography></Box>{loading ? <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={18} /><Typography variant="caption">Loading cached fingerprint states…</Typography></Stack> : <Chip variant="outlined" label={`Explicit comparison mode ${comparisonMode}`} />}</Stack>
      <ToggleButtonGroup exclusive size="small" value={viewMode} onChange={(_event, value) => { if (value) { setViewMode(value); setSelectedToken(''); } }} aria-label="Design Logic view mode"><ToggleButton value="single">Single</ToggleButton><ToggleButton value="compare">Compare</ToggleButton></ToggleButtonGroup>
      <ComparisonTray reference={reference} points={points} comparisonIds={comparisonIds} onRemove={(id) => setComparisonIds((current) => removeComparison(current, id))} onClear={() => setComparisonIds([])} />
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Paper variant="outlined" sx={{ p: { xs: 1.25, md: 1.75 }, minWidth: 0 }}>
        <Box sx={{ display: 'grid', gridTemplateAreas: { xs: "'rail' 'center' 'inspector'", md: "'rail center' 'inspector inspector'" }, gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: '200px minmax(0, 1fr)' }, gap: { xs: 2, md: 1.5 }, minWidth: 0, '@media (min-width: 1400px)': { gridTemplateAreas: "'rail center inspector'", gridTemplateColumns: '220px minmax(480px, 1fr) 300px' } }}>
          <ControlRail reference={reference} baseUrl={baseUrl} modes={modes} referenceMode={referenceMode} comparisonMode={comparisonMode} coverage={workspace?.coverage} features={workspace?.matrix?.features || []} filters={filters} onReferenceMode={(mode) => { setReferenceMode(mode); setSelectedToken(''); }} onComparisonMode={(mode) => { setComparisonMode(mode); setSelectedToken(''); }} onFilters={setFilters} onAnalyze={analyze} analyzing={analyzingId === reference?.molecule_id} />
          <Stack spacing={2} sx={{ gridArea: 'center', minWidth: 0 }}><SimilarityScatter points={points} referenceId={referenceId} selectedId={selected?.molecule_id} onSelect={(moleculeId) => { setSelectedId(moleculeId); setSelectedToken(''); }} /><Divider /><InteractionMatrix matrix={visibleMatrix} filters={filters} selectedToken={selectedToken} onSelectToken={setSelectedToken} /><Box><Typography variant="subtitle2">Unavailable comparison states</Typography><Stack direction="row" useFlexGap flexWrap="wrap" spacing={0.75} sx={{ mt: 0.5 }}>{points.filter((point) => point.fingerprint_status !== 'available' || !Number.isFinite(point.interaction_similarity)).slice(0, 12).map((point) => <Tooltip key={point.molecule_id} title={point.fingerprint_message || interactionStatusLabel(point.interaction_similarity_status)}><Chip clickable onClick={() => setSelectedId(point.molecule_id)} variant={selectedId === point.molecule_id ? 'filled' : 'outlined'} color={point.fingerprint_status === 'not_analyzed' ? 'default' : 'warning'} label={`${point.molecule_id} · ${interactionStatusLabel(point.fingerprint_status === 'available' ? point.interaction_similarity_status : point.fingerprint_status)}`} /></Tooltip>)}</Stack></Box></Stack>
          <Inspector point={selected} referenceId={referenceId} baseUrl={baseUrl} selectedToken={selectedToken} onSelectToken={setSelectedToken} onAnalyze={analyze} analyzing={analyzingId === selected?.molecule_id} comparisonIds={comparisonIds} onAddComparison={(moleculeId) => setComparisonIds((current) => addComparison(current, moleculeId, referenceId))} onSetReference={(moleculeId) => { setReferenceId(moleculeId); setSelectedId(moleculeId); setComparisonIds((current) => current.filter((id) => id !== moleculeId)); setSelectedToken(''); }} />
        </Box>
      </Paper>
      {viewMode === 'compare' && comparisonIds.length ? <MultiLigandComparison points={comparisonPoints} referenceId={referenceId} baseUrl={baseUrl} selectedToken={selectedToken} onSelectToken={setSelectedToken} onFocus3d={(moleculeId) => { setSelectedId(moleculeId); setSelectedToken(''); }} /> : null}
      {viewMode === 'compare' && !comparisonIds.length ? <Alert severity="info">Add one to five molecules to the comparison set, then use Compare to inspect selected-set interactions and scaffolds.</Alert> : null}
      <Paper component="section" variant="outlined" sx={{ p: 1.25, minWidth: 0 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} gap={1}>
          <Box><Typography variant="h2">Scientific evidence view</Typography><Typography variant="caption" color="text.secondary">Interaction fingerprints and pharmacophore geometry remain separate interpretations of explicit docking poses.</Typography></Box>
          <ToggleButtonGroup exclusive size="small" value={evidenceView} onChange={(_event, value) => { if (value) setEvidenceView(value); }} aria-label="Scientific evidence view"><ToggleButton value="interactions">Interactions</ToggleButton><ToggleButton value="pharmacophore">Pharmacophore</ToggleButton></ToggleButtonGroup>
        </Stack>
        {evidenceView === 'pharmacophore' ? <TextField select size="small" label="Feature center threshold" value={pharmacophoreThreshold} onChange={(event) => setPharmacophoreThreshold(Number(event.target.value))} helperText="Explicit qualified preset; not a universal cutoff." sx={{ mt: 1, minWidth: 240 }}>{[0.75, 1, 1.5, 2].map((value) => <MenuItem key={value} value={value}>{value.toFixed(2)} Å</MenuItem>)}</TextField> : null}
      </Paper>
      {evidenceView === 'interactions' ? <InteractionVisualizationPanel
        baseUrl={baseUrl}
        jobId={jobId}
        point={selected}
        resultRow={rows.find((row) => String(row.molecule_id) === selected?.molecule_id)}
        selectedToken={selectedToken}
        onSelectToken={setSelectedToken}
      /> : null}
      {evidenceView === 'pharmacophore' && pharmacophoreLoading ? <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={18} /><Typography variant="body2">Loading qualified backend pharmacophore evidence…</Typography></Stack> : null}
      {evidenceView === 'pharmacophore' && pharmacophoreError ? <Alert severity="error">{pharmacophoreError}</Alert> : null}
      {evidenceView === 'pharmacophore' && !pharmacophoreComparisonIds.length ? <Alert severity="info">Select a non-reference molecule, or add one to five molecules in Compare mode, to request pharmacophore evidence.</Alert> : null}
      {evidenceView === 'pharmacophore' && pharmacophore ? <PharmacophorePanel baseUrl={baseUrl} jobId={jobId} payload={pharmacophore} points={points} rows={rows} focusedMoleculeId={selectedId} onFocusComparison={setSelectedId} /> : null}
    </Stack>
  );
}
