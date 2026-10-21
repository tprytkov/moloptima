import React, { useDeferredValue, useEffect, useMemo, useReducer, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import PrioritizationExplanationSection from './PrioritizationExplanationSection.jsx';

const PAGE_SIZE = 25;
const MAX_COMPARISON = 5;

function present(value) {
  if (value === null || value === undefined || value === '') return 'Not available';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value).replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function rawValue(value) {
  return value === null || value === undefined || value === '' ? 'Not available' : String(value);
}

function candidateKey(row, index = 0) {
  return String(row?.molecule_id || row?.canonical_smiles || row?.input_smiles || `candidate-${index}`);
}

export function authoritativePriority(row) {
  return {
    rank: row?.v2_rank ?? row?.scientific_rank ?? row?.prioritization?.ranking_position ?? null,
    score: row?.v2_score ?? row?.scientific_ranking_score ?? row?.prioritization?.ranking_score
      ?? row?.priority_score ?? null,
  };
}

export function dockingEvidence(row) {
  const result = row?.docking_result ?? {};
  const affinity = result.best_vina_affinity_kcal_mol ?? row?.best_vina_affinity_kcal_mol
    ?? row?.docking_score ?? null;
  return {
    status: result.status ?? row?.docking_status ?? 'not_available',
    affinity: affinity === '' ? null : affinity,
  };
}

export function experimentalEvidence(row) {
  return {
    exact: row?.chembl_lookup_status ?? 'not_available',
    analog: row?.chembl_similarity_status ?? row?.active_neighborhood_signal ?? 'not_available',
  };
}

export function filterAndSortPrioritizationRows(rows, controls) {
  const query = String(controls.query || '').trim().toLowerCase();
  const filtered = rows.filter((row) => {
    const searchable = [row.molecule_id, row.known_compound_name, row.canonical_smiles, row.input_smiles]
      .filter(Boolean).join(' ').toLowerCase();
    if (query && !searchable.includes(query)) return false;
    if (controls.readiness && String(row.prioritization_status || 'not_available') !== controls.readiness) return false;
    if (controls.admet && String(row.admet_model_status || 'not_available') !== controls.admet) return false;
    if (controls.docking && String(dockingEvidence(row).status) !== controls.docking) return false;
    return true;
  });
  if (controls.sort === 'contract') return filtered;
  return filtered.map((row, index) => ({ row, index })).sort((left, right) => {
    if (controls.sort === 'molecule') {
      return candidateKey(left.row, left.index).localeCompare(candidateKey(right.row, right.index));
    }
    const leftPriority = authoritativePriority(left.row);
    const rightPriority = authoritativePriority(right.row);
    const leftValue = controls.sort === 'rank' ? leftPriority.rank : leftPriority.score;
    const rightValue = controls.sort === 'rank' ? rightPriority.rank : rightPriority.score;
    if (leftValue === null || leftValue === undefined) return rightValue === null || rightValue === undefined ? left.index - right.index : 1;
    if (rightValue === null || rightValue === undefined) return -1;
    return controls.sort === 'rank'
      ? Number(leftValue) - Number(rightValue)
      : Number(rightValue) - Number(leftValue);
  }).map(({ row }) => row);
}

export function updateComparisonSelection(ids, moleculeId) {
  if (ids.includes(moleculeId)) return ids.filter((id) => id !== moleculeId);
  if (ids.length >= MAX_COMPARISON) return ids;
  return [...ids, moleculeId];
}

export function workspaceSelectionReducer(state, action) {
  if (action.type === 'sync-dataset') {
    if (state.datasetKey === action.datasetKey) return state;
    return { datasetKey: action.datasetKey, selectedId: action.firstId || '', comparisonIds: [] };
  }
  if (action.type === 'select') return { ...state, selectedId: action.moleculeId };
  if (action.type === 'toggle-comparison') {
    return { ...state, comparisonIds: updateComparisonSelection(state.comparisonIds, action.moleculeId) };
  }
  if (action.type === 'clear-comparison') return { ...state, comparisonIds: [] };
  return state;
}

function optionValues(rows, getter) {
  return Array.from(new Set(rows.map(getter).filter(Boolean))).sort();
}

function structureUrl(row, baseUrl = 'http://localhost:8000') {
  const smiles = row?.canonical_smiles || row?.input_smiles;
  if (!smiles) return '';
  const params = new URLSearchParams({ smiles, width: '160', height: '120' });
  return `${baseUrl.replace(/\/$/, '')}/api/molecules/structure?${params.toString()}`;
}

function StatusLabel({ value }) {
  return <Typography variant="body2" sx={{ fontWeight: 650 }}>{present(value)}</Typography>;
}

function Metric({ label, value, mono = false }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 700, fontFamily: mono ? 'ui-monospace, Consolas, monospace' : undefined, overflowWrap: 'anywhere' }}>
        {rawValue(value)}
      </Typography>
    </Box>
  );
}

function CandidateTable({ rows, selectedId, comparisonIds, onSelect, onToggleComparison, baseUrl }) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflowX: 'auto' }}>
      <Table size="small" aria-label="Prioritization candidates" sx={{ minWidth: 980 }}>
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox">Compare</TableCell>
            <TableCell>Structure</TableCell>
            <TableCell>Compound</TableCell>
            <TableCell>Stored rank</TableCell>
            <TableCell>Stored score</TableCell>
            <TableCell>Evidence readiness</TableCell>
            <TableCell>ADMET</TableCell>
            <TableCell>Vina affinity</TableCell>
            <TableCell>Experimental context</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, index) => {
            const id = candidateKey(row, index);
            const priority = authoritativePriority(row);
            const docking = dockingEvidence(row);
            const experimental = experimentalEvidence(row);
            const image = structureUrl(row, baseUrl);
            return (
              <TableRow
                hover
                key={id}
                selected={selectedId === id}
                tabIndex={0}
                aria-label={`Inspect prioritization evidence for ${id}`}
                onClick={() => onSelect(id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(id);
                  }
                }}
                sx={{ cursor: 'pointer', '&.Mui-selected': { bgcolor: 'rgba(25, 118, 210, 0.10)' } }}
              >
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    checked={comparisonIds.includes(id)}
                    disabled={!comparisonIds.includes(id) && comparisonIds.length >= MAX_COMPARISON}
                    inputProps={{ 'aria-label': `${comparisonIds.includes(id) ? 'Remove' : 'Add'} ${id} ${comparisonIds.includes(id) ? 'from' : 'to'} comparison set` }}
                    onClick={(event) => event.stopPropagation()}
                    onChange={() => onToggleComparison(id)}
                  />
                </TableCell>
                <TableCell sx={{ width: 118 }}>
                  {image ? <Box component="img" loading="lazy" src={image} alt={`2D structure for ${id}`} sx={{ display: 'block', width: 104, height: 70, objectFit: 'contain', bgcolor: '#fff' }} /> : <Typography variant="caption">Unavailable</Typography>}
                </TableCell>
                <TableCell><Typography variant="body2" sx={{ fontWeight: 750 }}>{id}</Typography></TableCell>
                <TableCell>{rawValue(priority.rank)}</TableCell>
                <TableCell>{rawValue(priority.score)}</TableCell>
                <TableCell><StatusLabel value={row.prioritization_status ?? 'not_available'} /></TableCell>
                <TableCell><StatusLabel value={row.admet_model_status ?? 'not_available'} /></TableCell>
                <TableCell>{docking.affinity === null ? 'Not available' : `${docking.affinity} kcal/mol`}</TableCell>
                <TableCell>
                  <Typography variant="body2">Exact: {present(experimental.exact)}</Typography>
                  <Typography variant="caption" color="text.secondary">Analog: {present(experimental.analog)}</Typography>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  );
}

function ComparisonSet({ rows, comparisonIds, onSelect, onRemove, onClear }) {
  const byId = new Map(rows.map((row, index) => [candidateKey(row, index), row]));
  const selected = comparisonIds.map((id) => byId.get(id)).filter(Boolean);
  return (
    <Paper component="section" elevation={0} aria-label="Prioritization comparison set" sx={{ border: '1px solid', borderColor: 'divider' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 2, py: 1.5 }}>
        <Box>
          <Typography variant="h3">Comparison set ({selected.length}/{MAX_COMPARISON})</Typography>
          <Typography variant="caption" color="text.secondary">Selection is explicit and does not affect stored score or rank.</Typography>
        </Box>
        <Button size="small" onClick={onClear} disabled={selected.length === 0}>Clear</Button>
      </Stack>
      <Divider />
      {selected.length === 0 ? <Typography color="text.secondary" sx={{ p: 2 }}>Select up to five candidates from the table for a side-by-side evidence summary.</Typography> : (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label="Selected prioritization comparison" sx={{ minWidth: 720 }}>
            <TableHead><TableRow><TableCell>Compound</TableCell><TableCell>Stored rank</TableCell><TableCell>Stored score</TableCell><TableCell>Evidence readiness</TableCell><TableCell>ADMET</TableCell><TableCell>Vina affinity</TableCell><TableCell>Remove</TableCell></TableRow></TableHead>
            <TableBody>{selected.map((row) => {
              const id = candidateKey(row);
              const priority = authoritativePriority(row);
              const docking = dockingEvidence(row);
              return <TableRow key={id} hover onClick={() => onSelect(id)} sx={{ cursor: 'pointer' }}>
                <TableCell sx={{ fontWeight: 700 }}>{id}</TableCell><TableCell>{rawValue(priority.rank)}</TableCell><TableCell>{rawValue(priority.score)}</TableCell><TableCell>{present(row.prioritization_status)}</TableCell><TableCell>{present(row.admet_model_status)}</TableCell><TableCell>{docking.affinity === null ? 'Not available' : `${docking.affinity} kcal/mol`}</TableCell>
                <TableCell><IconButton size="small" aria-label={`Remove ${id} from comparison set`} onClick={(event) => { event.stopPropagation(); onRemove(id); }}><CloseIcon fontSize="small" /></IconButton></TableCell>
              </TableRow>;
            })}</TableBody>
          </Table>
        </Box>
      )}
    </Paper>
  );
}

function SelectedInspector({ row, profile, profileSha256, job }) {
  if (!row) return <Alert severity="info">Select a candidate row to inspect its stored prioritization evidence.</Alert>;
  const id = candidateKey(row);
  const priority = authoritativePriority(row);
  const docking = dockingEvidence(row);
  const experimental = experimentalEvidence(row);
  const explanation = row.prioritization_v2 ?? {};
  const missing = Array.isArray(explanation.missing_data) ? explanation.missing_data : [];
  const warnings = Array.isArray(explanation.warnings) ? explanation.warnings : [];
  return (
    <Paper component="aside" elevation={0} aria-label={`Selected compound ${id}`} sx={{ border: '1px solid', borderColor: 'divider', position: { xl: 'sticky' }, top: { xl: 16 } }}>
      <Box sx={{ p: 2 }}>
        <Typography variant="overline">Selected compound</Typography>
        <Typography variant="h2" sx={{ overflowWrap: 'anywhere' }}>{id}</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.5, mt: 1.5 }}>
          <Metric label="Stored rank" value={priority.rank} />
          <Metric label="Stored score" value={priority.score} />
          <Metric label="Evidence readiness" value={present(row.prioritization_status)} />
          <Metric label="Rank eligibility" value={present(row.v2_rank_eligible ?? row.rank_eligible)} />
        </Box>
      </Box>
      <Divider />
      <Stack spacing={2} sx={{ p: 2 }}>
        <Box component="section" aria-label="Active prioritization profile">
          <Typography variant="h3">Active profile and target mode</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.25, mt: 1 }}>
            <Metric label="Profile" value={profile?.name ?? profile?.profile_id} />
            <Metric label="Version" value={profile?.profile_version} />
            <Metric label="Status" value={present(profile?.status)} />
            <Metric label="Target mode" value={present(profile?.target_mode ?? explanation?.provenance?.target_mode)} />
          </Box>
        </Box>
        <Divider />
        <Box component="section" aria-label="Evidence by domain">
          <Typography variant="h3">Evidence by domain</Typography>
          <Stack spacing={1} sx={{ mt: 1 }}>
            <Metric label="ADMET (predicted)" value={present(row.admet_model_status)} />
            <Metric label="Docking status" value={present(docking.status)} />
            <Metric label="Best Vina affinity" value={docking.affinity === null ? null : `${docking.affinity} kcal/mol`} />
            <Metric label="Exact experimental-compound context" value={present(experimental.exact)} />
            <Metric label="Analog / neighbor context" value={present(experimental.analog)} />
            <Metric label="Diversity cluster" value={row.diversity_cluster_id} />
            <Metric label="Nearest-neighbor Morgan similarity" value={row.nearest_neighbor_similarity} />
          </Stack>
        </Box>
        <Divider />
        <Box component="section" aria-label="Unavailable prioritization evidence">
          <Typography variant="h3">Missing or unavailable evidence</Typography>
          {missing.length === 0 && warnings.length === 0 ? <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>No missing-data entries or prioritization warnings were recorded.</Typography> : null}
          {missing.map((entry) => <Alert severity="warning" key={`${entry.endpoint_id}-${entry.configured_policy}`} sx={{ mt: 1 }}>Missing {entry.endpoint_id}: {present(entry.configured_policy)} → {present(entry.action_taken)}</Alert>)}
          {warnings.map((warning) => <Alert severity="warning" key={warning} sx={{ mt: 1 }}>{warning}</Alert>)}
        </Box>
        <Divider />
        <PrioritizationExplanationSection compound={row} />
        <Box component="details">
          <Box component="summary" sx={{ cursor: 'pointer', fontWeight: 750 }}>Provenance</Box>
          <Box sx={{ display: 'grid', gap: 1, mt: 1 }}>
            <Metric label="Profile SHA256" value={profileSha256 ?? explanation?.provenance?.profile_sha256} mono />
            <Metric label="Schema version" value={profile?.schema_version ?? explanation?.provenance?.schema_version} />
            <Metric label="Job ID" value={job?.job_id} mono />
            <Metric label="Completed" value={job?.completed_at} />
            <Metric label="Receptor" value={job?.receptor_id ?? job?.receptor_source} mono />
          </Box>
        </Box>
      </Stack>
    </Paper>
  );
}

export default function PrioritizationWorkspace({ rows, result, job, baseUrl }) {
  const datasetKey = String(job?.job_id || result?.upload_id || rows.map((row, index) => candidateKey(row, index)).join('|'));
  const firstId = rows.length ? candidateKey(rows[0]) : '';
  const [selection, dispatch] = useReducer(workspaceSelectionReducer, { datasetKey, selectedId: firstId, comparisonIds: [] });
  const [controls, setControls] = useState({ query: '', readiness: '', admet: '', docking: '', sort: 'contract' });
  const [page, setPage] = useState(0);
  const deferredQuery = useDeferredValue(controls.query);
  const controlled = { ...controls, query: deferredQuery };
  const visibleRows = useMemo(() => filterAndSortPrioritizationRows(rows, controlled), [rows, deferredQuery, controls.readiness, controls.admet, controls.docking, controls.sort]);
  const pages = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const pageRows = visibleRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const selected = rows.find((row, index) => candidateKey(row, index) === selection.selectedId) ?? null;
  const profile = result?.prioritization_profile ?? job?.prioritization_profile ?? null;

  useEffect(() => { dispatch({ type: 'sync-dataset', datasetKey, firstId }); }, [datasetKey, firstId]);
  useEffect(() => { setPage(0); }, [deferredQuery, controls.readiness, controls.admet, controls.docking, controls.sort]);
  useEffect(() => { if (page >= pages) setPage(pages - 1); }, [page, pages]);

  const setControl = (key) => (event) => setControls((current) => ({ ...current, [key]: event.target.value }));
  return (
    <Stack spacing={2} component="section" aria-label="Prioritization scientific workspace">
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', xl: 'minmax(0, 1.65fr) minmax(340px, 0.85fr)' }, gap: 2, alignItems: 'start', minWidth: 0 }}>
        <Stack spacing={2} sx={{ minWidth: 0 }}>
          <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
            <Box sx={{ p: 2 }}>
              <Typography variant="h2">Candidate overview</Typography>
              <Typography color="text.secondary">Stored prioritization values and evidence availability; filtering and sorting do not recalculate science.</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'minmax(220px, 1.5fr) repeat(4, minmax(130px, 1fr))' }, gap: 1, mt: 2 }}>
                <TextField size="small" label="Search candidates" value={controls.query} onChange={setControl('query')} />
                <TextField select slotProps={{ select: { native: true } }} size="small" label="Evidence readiness" value={controls.readiness} onChange={setControl('readiness')}><option value="">All</option>{optionValues(rows, (row) => row.prioritization_status || 'not_available').map((value) => <option key={value} value={value}>{present(value)}</option>)}</TextField>
                <TextField select slotProps={{ select: { native: true } }} size="small" label="ADMET status" value={controls.admet} onChange={setControl('admet')}><option value="">All</option>{optionValues(rows, (row) => row.admet_model_status || 'not_available').map((value) => <option key={value} value={value}>{present(value)}</option>)}</TextField>
                <TextField select slotProps={{ select: { native: true } }} size="small" label="Docking status" value={controls.docking} onChange={setControl('docking')}><option value="">All</option>{optionValues(rows, (row) => dockingEvidence(row).status).map((value) => <option key={value} value={value}>{present(value)}</option>)}</TextField>
                <TextField select slotProps={{ select: { native: true } }} size="small" label="Sort by" value={controls.sort} onChange={setControl('sort')}><option value="contract">Contract order</option><option value="rank">Stored rank</option><option value="score">Stored score</option><option value="molecule">Compound ID</option></TextField>
              </Box>
            </Box>
            <CandidateTable rows={pageRows} selectedId={selection.selectedId} comparisonIds={selection.comparisonIds} onSelect={(moleculeId) => dispatch({ type: 'select', moleculeId })} onToggleComparison={(moleculeId) => dispatch({ type: 'toggle-comparison', moleculeId })} baseUrl={baseUrl} />
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} gap={1} sx={{ p: 1.5 }}>
              <Typography variant="caption" color="text.secondary">{visibleRows.length === 0 ? 'No candidates match the current filters.' : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, visibleRows.length)} of ${visibleRows.length} candidates`}</Typography>
              <Stack direction="row" spacing={1} alignItems="center"><Button size="small" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Previous</Button><Chip size="small" variant="outlined" label={`Page ${page + 1} of ${pages}`} /><Button size="small" disabled={page + 1 >= pages} onClick={() => setPage((value) => value + 1)}>Next</Button></Stack>
            </Stack>
          </Paper>
          <ComparisonSet rows={rows} comparisonIds={selection.comparisonIds} onSelect={(moleculeId) => dispatch({ type: 'select', moleculeId })} onRemove={(moleculeId) => dispatch({ type: 'toggle-comparison', moleculeId })} onClear={() => dispatch({ type: 'clear-comparison' })} />
        </Stack>
        <SelectedInspector row={selected} profile={profile} profileSha256={result?.prioritization_profile_sha256 ?? job?.prioritization_profile_sha256} job={job} />
      </Box>
    </Stack>
  );
}
