import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Paper, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Typography,
} from '@mui/material';
import { formatRuntimeSource, formatScientificPresentationValue } from './scientificPresentation.js';

const DEFAULT_BASE_URL = 'http://localhost:8000';
export const SCIENTIFIC_RUNTIME_POLL_INTERVAL_MS = 3000;

function readableError(error) {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== '';
}

function formatDetailValue(value) {
  if (!hasValue(value)) return 'Not available';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

export async function fetchScientificRuntimeStatus(baseUrl = DEFAULT_BASE_URL, { refresh = false } = {}) {
  const response = await fetch(
    `${baseUrl}/api/scientific-runtime/${refresh ? 'refresh' : 'status'}`,
    refresh ? { method: 'POST' } : undefined,
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || `Scientific runtime status failed (HTTP ${response.status}).`);
  return payload;
}

export function scientificRuntimePollDelay(payload) {
  if (!payload) return null;
  if (payload.qualification_state === 'checking' || payload.refreshing) {
    return SCIENTIFIC_RUNTIME_POLL_INTERVAL_MS;
  }
  return Object.values(payload.components ?? {}).some(
    (component) => component?.status === 'checking' || component?.refreshing,
  ) ? SCIENTIFIC_RUNTIME_POLL_INTERVAL_MS : null;
}

export function runtimeStatusPresentation(runtime = {}) {
  const status = String(runtime.status || 'unavailable').toLowerCase();
  const reason = String(runtime.reason || '').toLowerCase();
  if (reason === 'runtime_probe_timeout') return { label: 'Probe Timed Out', color: 'warning' };
  if (status === 'error') return { label: 'Probe Error', color: 'error' };
  if (status === 'available') return { label: 'Available', color: 'success' };
  if (status === 'checking') return { label: 'Checking', color: 'info' };
  if (status === 'incompatible') return { label: 'Incompatible', color: 'error' };
  if (status === 'unavailable') return { label: 'Unavailable', color: 'warning' };
  return { label: formatScientificPresentationValue(status), color: 'default' };
}

function RuntimeStatusChip({ runtime }) {
  const presentation = runtimeStatusPresentation(runtime);
  return <Chip label={presentation.label} color={presentation.color} variant="outlined" />;
}

function inheritedRuntime(parent = {}, child = {}) {
  if (child?.status) return child;
  return {
    status: parent.status,
    reason: parent.reason,
    runtime_source: parent.runtime_source,
    refreshing: parent.refreshing,
  };
}

function RuntimeDetails({ runtime, checkedAt, probeSeconds }) {
  const rows = [
    ['Status code', runtime.status],
    ['Runtime source', formatRuntimeSource(runtime.runtime_source)],
    ['Version / identity', runtime.version || runtime.identity],
    ['Probe timestamp', checkedAt],
    ['Probe duration', hasValue(probeSeconds) ? `${probeSeconds} seconds` : null],
    ['Error code', runtime.reason],
  ].filter(([, value]) => hasValue(value));
  if (!rows.length) return null;
  return (
    <Box component="details" sx={{ '& > summary': { cursor: 'pointer' } }}>
      <Typography component="summary" variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
        Runtime Details
      </Typography>
      <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'minmax(120px, auto) minmax(0, 1fr)', gap: 0.65, mt: 1, mb: 0 }}>
        {rows.map(([label, value]) => (
          <React.Fragment key={label}>
            <Typography component="dt" variant="caption" color="text.secondary">{label}</Typography>
            <Typography component="dd" variant="caption" sx={{ m: 0, overflowWrap: 'anywhere' }}>{formatDetailValue(value)}</Typography>
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
}

function RuntimeCard({ title, runtime, checkedAt, probeSeconds, children }) {
  return (
    <Paper variant="outlined" component="article" aria-label={`${title} runtime status`} sx={{ p: 2, minWidth: 0, height: '100%' }}>
      <Stack spacing={1.15}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1}>
          <Typography variant="h3" sx={{ fontSize: '1.05rem', lineHeight: 1.3, fontWeight: 700, overflowWrap: 'anywhere' }}>{title}</Typography>
          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" justifyContent="flex-end">
            {runtime.refreshing ? <Typography variant="caption" color="text.secondary">Refreshing</Typography> : null}
            <RuntimeStatusChip runtime={runtime} />
          </Stack>
        </Stack>
        {runtime.reason === 'runtime_probe_timeout' ? (
          <Typography variant="body2" color="text.secondary">The runtime check did not finish within the probe timeout. Availability was not determined.</Typography>
        ) : null}
        {children}
        <RuntimeDetails runtime={runtime} checkedAt={checkedAt} probeSeconds={probeSeconds} />
      </Stack>
    </Paper>
  );
}

export function ScientificRuntimePanel({ runtimeState, onRefresh }) {
  const payload = runtimeState.payload;
  const components = payload?.components ?? {};
  const receptor = components.receptor_preparation ?? {};
  const docking = components.docking ?? {};
  const runtimeCards = useMemo(() => [
    {
      key: 'chemberta', title: 'ChemBERTa Classification', runtime: components.chemberta ?? {},
      description: `${components.chemberta?.public_endpoint_count ?? 9} public classification endpoints`,
    },
    {
      key: 'gmc_mpnn_bbb', title: 'GMC-MPNN BBB', runtime: components.gmc_mpnn_bbb ?? {},
      description: '5-seed raw ensemble probability · threshold 0.5 · provisional raw · calibration not frozen',
    },
    {
      key: 'chemprop_regression', title: 'Chemprop Regression', runtime: components.chemprop_regression ?? {},
      description: '5 regression endpoints · 5-seed ensemble · sample standard deviation',
    },
    { key: 'receptor_preparation', title: 'Meeko', runtime: inheritedRuntime(receptor, receptor.meeko), description: 'Ligand and receptor preparation dependency' },
    { key: 'receptor_preparation', title: 'Gemmi', runtime: inheritedRuntime(receptor, receptor.gemmi), description: 'Receptor structure processing dependency' },
    { key: 'receptor_preparation', title: 'PDBFixer', runtime: inheritedRuntime(receptor, receptor.pdbfixer), description: 'Isolated receptor-repair dependency' },
    { key: 'receptor_preparation', title: 'OpenMM', runtime: inheritedRuntime(receptor, receptor.openmm), description: 'Isolated receptor-repair dependency' },
    { key: 'docking', title: 'Vina', runtime: inheritedRuntime(docking, docking.vina), description: 'Protocol-dependent docking runtime; not experimental binding free energy' },
    { key: 'docking', title: 'Open Babel', runtime: inheritedRuntime(docking, docking.openbabel), description: 'Docking-format conversion runtime' },
  ], [components, docking, receptor]);
  const pollPending = scientificRuntimePollDelay(payload) !== null;

  return (
    <Paper variant="outlined" component="section" aria-labelledby="scientific-runtime-heading" sx={{ p: { xs: 2, md: 2.5 }, minWidth: 0 }}>
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'flex-start' }} gap={1.5}>
          <Box sx={{ minWidth: 0 }}>
            <Typography id="scientific-runtime-heading" variant="h2">Scientific Runtime</Typography>
            <Typography variant="body2" color="text.secondary">
              Read-only availability from production runtime contract probes. A runtime being available does not mean it has run for the current calculation.
            </Typography>
          </Box>
          <Button variant="outlined" onClick={onRefresh} disabled={runtimeState.loading}>Refresh runtime status</Button>
        </Stack>
        {runtimeState.loading && !payload ? <Alert severity="info">Loading scientific runtime status…</Alert> : null}
        {pollPending ? <Alert severity="info">Runtime qualification is running in the background. Completed probes appear as they finish.</Alert> : null}
        {runtimeState.error ? <Alert severity="error">Runtime status could not be loaded: {runtimeState.error}</Alert> : null}
        {!runtimeState.loading && !runtimeState.error && !payload ? <Alert severity="info">Scientific runtime status has not been checked.</Alert> : null}
        {payload ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5 }}>
            {runtimeCards.map((card) => (
              <RuntimeCard
                key={card.title}
                title={card.title}
                runtime={card.runtime}
                checkedAt={payload.checked_at}
                probeSeconds={payload.probe_timings_seconds?.[card.key]}
              >
                <Typography variant="body2" color="text.secondary">{card.description}</Typography>
              </RuntimeCard>
            ))}
          </Box>
        ) : null}
      </Stack>
    </Paper>
  );
}

function DiagnosticsSection({ sourceStatusState, onCheckLocalModelCache, onRefreshSourceStatus }) {
  const payload = sourceStatusState.payload ?? {};
  const modelManifest = payload.model_manifest ?? {};
  const publicManifest = payload.public_data_manifest ?? {};
  const runManifest = payload.run_manifest ?? {};
  const bbbModel = modelManifest.models?.bbb_chemberta ?? {};
  const latestRunId = runManifest.latest_run;
  const latestRun = latestRunId ? runManifest.runs?.[latestRunId] : null;
  const cached = Boolean(bbbModel.cached);
  const sources = Object.values(publicManifest.sources ?? {});

  return (
    <Paper variant="outlined" component="section" aria-labelledby="settings-diagnostics-heading" sx={{ p: { xs: 2, md: 2.5 }, minWidth: 0 }}>
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'flex-start' }} gap={1.5}>
          <Box>
            <Typography id="settings-diagnostics-heading" variant="h2">Diagnostics</Typography>
            <Typography variant="body2" color="text.secondary">Read-only source manifests and compatibility diagnostics. These actions do not execute scientific calculations.</Typography>
          </Box>
          <Button variant="outlined" onClick={onRefreshSourceStatus} disabled={sourceStatusState.loading}>Refresh source status</Button>
        </Stack>
        {sourceStatusState.loading ? <Alert severity="info">Refreshing diagnostic status…</Alert> : null}
        {sourceStatusState.error ? <Alert severity="error">Diagnostics could not be loaded: {sourceStatusState.error}</Alert> : null}
        <Box>
          <Typography variant="h3">Public Lookup Sources</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Source status is diagnostic only. PubChem, pipeline ChEMBL, SureChEMBL, and target-reference execution remain configured by their owning scientific workflows.
          </Typography>
          {sources.length ? (
            <TableContainer sx={{ maxWidth: '100%', overflowX: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              <Table size="small" aria-label="Public lookup source diagnostic status" sx={{ minWidth: 760 }}>
                <TableHead><TableRow><TableCell>Source</TableCell><TableCell>Status</TableCell><TableCell>Last checked</TableCell><TableCell>Last successful lookup</TableCell><TableCell>Details</TableCell></TableRow></TableHead>
                <TableBody>{sources.map((source) => (
                  <TableRow key={source.source_name}>
                    <TableCell>{source.source_name}</TableCell>
                    <TableCell>{formatScientificPresentationValue(source.status)}</TableCell>
                    <TableCell>{formatDetailValue(source.last_checked)}</TableCell>
                    <TableCell>{source.last_successful_lookup ? formatDetailValue(source.last_successful_lookup) : 'Not active'}</TableCell>
                    <TableCell><Box component="details"><Typography component="summary" variant="caption" sx={{ cursor: 'pointer', fontWeight: 700 }}>Source details</Typography><Typography variant="caption" display="block" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>Cache path: {formatDetailValue(source.cache_path)}</Typography></Box></TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            </TableContainer>
          ) : <Alert severity="info">Refresh source status to load the current manifest snapshot.</Alert>}
        </Box>
        <Box component="details" sx={{ '& > summary': { cursor: 'pointer' } }}>
          <Typography component="summary" sx={{ fontWeight: 700, color: 'text.secondary' }}>Legacy BBB cache compatibility details</Typography>
          <Stack spacing={1.25} sx={{ mt: 1.25 }}>
            <Alert severity="info">Compatibility-only diagnostics for the retired cache-backed BBB classifier. Current ChemBERTa and GMC-MPNN availability is reported in Scientific Runtime.</Alert>
            <Box><Button variant="outlined" onClick={onCheckLocalModelCache} disabled={sourceStatusState.loading}>Check legacy cache</Button></Box>
            <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'minmax(180px, auto) minmax(0, 1fr)' }, gap: 0.75, m: 0 }}>
              {[
                ['Cache status', cached ? 'Cached' : 'Not cached'],
                ['Model status', formatScientificPresentationValue(bbbModel.status ?? 'not_checked')],
                ['Latest legacy run status', formatScientificPresentationValue(latestRun?.actual_bbb_model_status ?? 'not_run')],
                ['Latest run timestamp', latestRun?.timestamp],
                ['Cache path', modelManifest.cache_root ?? bbbModel.cache_path],
                ['Output file', latestRun?.output_file],
              ].map(([label, value]) => <React.Fragment key={label}><Typography component="dt" variant="caption" color="text.secondary">{label}</Typography><Typography component="dd" variant="caption" sx={{ m: 0, overflowWrap: 'anywhere' }}>{formatDetailValue(value)}</Typography></React.Fragment>)}
            </Box>
          </Stack>
        </Box>
      </Stack>
    </Paper>
  );
}

export default function SettingsWorkspace({
  sourceStatusState = { payload: null, loading: false, error: '' },
  onCheckLocalModelCache = () => {},
  onRefreshSourceStatus = () => {},
  baseUrl = DEFAULT_BASE_URL,
}) {
  const [runtimeState, setRuntimeState] = useState({ payload: null, loading: true, error: '' });

  async function refreshScientificRuntime() {
    setRuntimeState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const payload = await fetchScientificRuntimeStatus(baseUrl, { refresh: true });
      setRuntimeState({ payload, loading: false, error: '' });
    } catch (error) {
      setRuntimeState((current) => ({ ...current, loading: false, error: readableError(error) }));
    }
  }

  useEffect(() => {
    let active = true;
    fetchScientificRuntimeStatus(baseUrl).then(
      (payload) => active && setRuntimeState({ payload, loading: false, error: '' }),
      (error) => active && setRuntimeState({ payload: null, loading: false, error: readableError(error) }),
    );
    return () => { active = false; };
  }, [baseUrl]);

  useEffect(() => {
    const delay = scientificRuntimePollDelay(runtimeState.payload);
    if (delay === null) return undefined;
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const payload = await fetchScientificRuntimeStatus(baseUrl);
        if (active) setRuntimeState({ payload, loading: false, error: '' });
      } catch (error) {
        if (active) setRuntimeState((current) => ({ ...current, loading: false, error: readableError(error) }));
      }
    }, delay);
    return () => { active = false; window.clearTimeout(timer); };
  }, [baseUrl, runtimeState.payload]);

  return (
    <Stack spacing={2} sx={{ width: '100%', maxWidth: 1440, mx: 'auto', minWidth: 0 }}>
      <Paper variant="outlined" sx={{ p: { xs: 2.5, md: 3 } }}>
        <Stack spacing={0.75} sx={{ maxWidth: 820 }}>
          <Typography variant="h1">Settings</Typography>
          <Typography color="text.secondary">Inspect application-wide runtime availability and technical diagnostics. Scientific configuration and execution remain in their owning workspaces.</Typography>
        </Stack>
      </Paper>
      <ScientificRuntimePanel runtimeState={runtimeState} onRefresh={refreshScientificRuntime} />
      <DiagnosticsSection sourceStatusState={sourceStatusState} onCheckLocalModelCache={onCheckLocalModelCache} onRefreshSourceStatus={onRefreshSourceStatus} />
    </Stack>
  );
}

export const ModelDataSourcesPage = SettingsWorkspace;
