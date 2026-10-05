import React, {
  useEffect, useMemo, useRef, useState,
} from 'react';
import {
  Alert, Box, Chip, CircularProgress, Divider, MenuItem, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import ReceptorViewer from './ReceptorViewer.jsx';
import { fetchReceptorStructure } from './DockingSetup.jsx';
import { fetchDockingPoseArtifact, selectVinaPoseMode } from './dockingPose.js';

function valueOrUnavailable(value) {
  return value === null || value === undefined || value === '' ? 'Not available' : String(value);
}

const DOCKING_STATUS_LABELS = {
  success: 'Completed',
  cancelled: 'Cancelled',
  configuration_invalid: 'Configuration invalid',
  docking_failed: 'Docking failed',
  not_requested: 'Not requested',
  not_run_invalid_molecule: 'Not run — invalid molecule',
  receptor_unavailable: 'Receptor unavailable',
  runtime_unavailable: 'Vina runtime unavailable',
};

export function dockingStatusLabel(status) {
  if (!status) return 'Not available';
  return DOCKING_STATUS_LABELS[status]
    || String(status).replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function Detail({ label, value, title }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" component="dt">{label}</Typography>
      <Typography variant="body2" component="dd" title={title} sx={{ m: 0, overflowWrap: 'anywhere' }}>
        {valueOrUnavailable(value)}
      </Typography>
    </Box>
  );
}

function Metric({ label, value, detail }) {
  return (
    <Box sx={{ minWidth: 0, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="h5" sx={{ fontWeight: 750, overflowWrap: 'anywhere' }}>
        {valueOrUnavailable(value)}
      </Typography>
      {detail ? <Typography variant="caption" color="text.secondary">{detail}</Typography> : null}
    </Box>
  );
}

function requestStateFor(state, key) {
  return state.key === key ? state : { key, status: 'idle', data: null, error: '' };
}

export default function DockingResultsSection({
  compound, jobId = '', apiBaseUrl = 'http://localhost:8000',
}) {
  const hasResult = Boolean(compound?.docking_result && typeof compound.docking_result === 'object');
  const result = hasResult ? compound.docking_result : {};
  const success = result.status === 'success';
  const configuration = result.docking_configuration || {};
  const modes = Array.isArray(result.modes)
    ? result.modes
    : (result.mode_affinities_kcal_mol || []).map((affinity, index) => ({
      mode: index + 1, affinity_kcal_mol: affinity, rmsd_lb: null, rmsd_ub: null,
    }));
  const bestAffinity = result.best_vina_affinity_kcal_mol
    ?? result.best_affinity_kcal_mol
    ?? result.vina_affinity;
  const returnedModeCount = result.returned_mode_count ?? result.mode_count ?? modes.length;
  const requestedNumModes = result.requested_num_modes ?? configuration.num_modes;
  const moleculeIdentity = compound?.molecule_id || result.molecule_id || compound?.canonical_smiles;
  const poseFile = result.pose_file || result.pose_path;
  const poseAvailable = Boolean(result.pose_available || poseFile);
  const defaultMode = modes.some((mode) => mode.mode === result.best_mode)
    ? result.best_mode : (modes[0]?.mode ?? 1);
  const [selectedMode, setSelectedMode] = useState(defaultMode);
  const effectiveMode = modes.some((mode) => Number(mode.mode) === Number(selectedMode))
    ? Number(selectedMode) : Number(defaultMode);
  const [poseState, setPoseState] = useState({ key: '', status: 'idle', data: null, error: '' });
  const [receptorState, setReceptorState] = useState({ key: '', status: 'idle', data: null, error: '' });
  const [viewerError, setViewerError] = useState('');
  const [ligandRenderMs, setLigandRenderMs] = useState(null);
  const poseRequestRef = useRef(0);
  const receptorRequestRef = useRef(0);
  const viewerRef = useRef(null);
  const focusedPoseKeyRef = useRef('');
  const receptorKey = `${result.receptor_id || ''}:${result.prepared_receptor_sha256 || ''}`;
  const poseKey = `${jobId}:${moleculeIdentity || ''}:${receptorKey}:${poseFile || ''}:${result.pose_sha256 || ''}`;
  const currentPoseState = requestStateFor(poseState, poseKey);
  const currentReceptorState = requestStateFor(receptorState, receptorKey);
  const box = useMemo(() => ({
    centerX: configuration.center_x,
    centerY: configuration.center_y,
    centerZ: configuration.center_z,
    sizeX: configuration.size_x,
    sizeY: configuration.size_y,
    sizeZ: configuration.size_z,
  }), [
    configuration.center_x, configuration.center_y, configuration.center_z,
    configuration.size_x, configuration.size_y, configuration.size_z,
  ]);

  useEffect(() => {
    setSelectedMode(defaultMode);
  }, [defaultMode, moleculeIdentity, poseFile]);

  useEffect(() => {
    const requestId = poseRequestRef.current + 1;
    poseRequestRef.current = requestId;
    if (!success || !poseAvailable || !poseFile) {
      setPoseState({ key: poseKey, status: 'idle', data: null, error: '' });
      return undefined;
    }
    if (!jobId) {
      setPoseState({
        key: poseKey, status: 'error', data: null,
        error: 'Pose visualization is unavailable because this result has no job context.',
      });
      return undefined;
    }
    const controller = new AbortController();
    setPoseState({ key: poseKey, status: 'loading', data: null, error: '' });
    fetchDockingPoseArtifact(
      apiBaseUrl, jobId, poseFile, result.pose_sha256, controller.signal,
    ).then((data) => {
      if (!controller.signal.aborted && poseRequestRef.current === requestId) {
        setPoseState({ key: poseKey, status: 'ready', data, error: '' });
      }
    }).catch((error) => {
      if (!controller.signal.aborted && poseRequestRef.current === requestId) {
        setPoseState({ key: poseKey, status: 'error', data: null, error: error.message });
      }
    });
    return () => controller.abort();
  }, [apiBaseUrl, jobId, poseAvailable, poseFile, poseKey, result.pose_sha256, success]);

  useEffect(() => {
    const requestId = receptorRequestRef.current + 1;
    receptorRequestRef.current = requestId;
    if (!success || !result.receptor_id || !result.prepared_receptor_sha256) {
      setReceptorState({
        key: receptorKey, status: 'error', data: null,
        error: 'Prepared receptor visualization metadata is unavailable.',
      });
      return undefined;
    }
    const controller = new AbortController();
    const receptor = {
      receptor_id: result.receptor_id,
      docking_ready: true,
      docking_receptor_sha256: result.prepared_receptor_sha256,
      preparation_id: result.preparation_id || '',
    };
    setReceptorState({ key: receptorKey, status: 'loading', data: null, error: '' });
    fetchReceptorStructure(apiBaseUrl, receptor, controller.signal).then((data) => {
      if (!controller.signal.aborted && receptorRequestRef.current === requestId) {
        setReceptorState({ key: receptorKey, status: 'ready', data, error: '' });
      }
    }).catch((error) => {
      if (!controller.signal.aborted && receptorRequestRef.current === requestId) {
        setReceptorState({ key: receptorKey, status: 'error', data: null, error: error.message });
      }
    });
    return () => controller.abort();
  }, [apiBaseUrl, receptorKey, result.preparation_id, result.prepared_receptor_sha256, result.receptor_id, success]);

  const modeSelection = useMemo(() => {
    if (currentPoseState.status !== 'ready') return { pose: null, metadata: null, error: '' };
    try {
      const selected = selectVinaPoseMode(currentPoseState.data.models, modes, effectiveMode);
      return { ...selected, error: '' };
    } catch (error) {
      return { pose: null, metadata: null, error: error.message };
    }
  }, [currentPoseState, effectiveMode, modes]);
  const dockedLigand = modeSelection.pose ? {
    text: modeSelection.pose.text,
    format: 'pdbqt',
    identity: {
      moleculeId: moleculeIdentity,
      poseSha256: currentPoseState.data.sha256,
      mode: effectiveMode,
    },
  } : null;
  const displayedMode = modeSelection.metadata
    || modes.find((mode) => Number(mode.mode) === effectiveMode)
    || null;
  const poseError = currentPoseState.error || modeSelection.error;

  if (!hasResult) return null;

  return (
    <Box component="section" aria-label="Vina docking results" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: { xs: 1.5, sm: 2 } }}>
      <Stack spacing={1.5}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} gap={1}>
          <Box>
            <Typography variant="h2">Vina docking result</Typography>
            <Typography variant="caption" color="text.secondary">
              Molecule: {valueOrUnavailable(moleculeIdentity)} · Receptor: {valueOrUnavailable(result.receptor_id)}
            </Typography>
          </Box>
          <Chip label={dockingStatusLabel(result.status)} color={success ? 'success' : 'warning'} variant="outlined" size="small" />
        </Stack>
        {success ? (
          <>
            <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5} alignItems={{ sm: 'center' }}>
              <TextField
                select
                size="small"
                label="Displayed docking mode"
                value={effectiveMode}
                onChange={(event) => setSelectedMode(Number(event.target.value))}
                disabled={!modes.length}
                sx={{ minWidth: 240 }}
              >
                {modes.map((mode) => (
                  <MenuItem key={mode.mode} value={mode.mode}>
                    Mode {mode.mode} · {valueOrUnavailable(mode.affinity_kcal_mol)} kcal/mol
                  </MenuItem>
                ))}
              </TextField>
              {currentPoseState.status === 'loading' || currentReceptorState.status === 'loading'
                ? <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={18} /><Typography variant="body2">Loading validated docking artifacts…</Typography></Stack>
                : null}
            </Stack>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(4, minmax(0, 1fr))' }, gap: 1 }}>
              <Metric label="Displayed Vina affinity" value={displayedMode?.affinity_kcal_mol} detail="kcal/mol" />
              <Metric label="Displayed pose" value={displayedMode?.mode} detail={displayedMode?.mode === result.best_mode ? 'Best Vina mode' : 'Vina mode'} />
              <Metric label="RMSD lower / upper" value={displayedMode ? `${valueOrUnavailable(displayedMode.rmsd_lb)} / ${valueOrUnavailable(displayedMode.rmsd_ub)}` : null} detail="Å" />
              <Metric label="Poses returned" value={returnedModeCount} detail={`${valueOrUnavailable(requestedNumModes)} requested`} />
            </Box>
            {currentReceptorState.status === 'ready' ? (
              <Box data-testid="docked-pose-viewer">
                <ReceptorViewer
                  ref={viewerRef}
                  structure={currentReceptorState.data}
                  dockedLigand={dockedLigand}
                  box={box}
                  showBox
                  selectedResidues={[]}
                  selectedLigand={null}
                  onError={(error) => setViewerError(error.message || String(error))}
                  onLigandRender={({ durationMs, mode }) => {
                    setLigandRenderMs(durationMs);
                    if (mode !== null && focusedPoseKeyRef.current !== poseKey) {
                      viewerRef.current?.focusBox();
                      focusedPoseKeyRef.current = poseKey;
                    }
                  }}
                />
              </Box>
            ) : null}
            {currentReceptorState.error ? <Alert severity="warning">{currentReceptorState.error}</Alert> : null}
            {poseError ? <Alert severity="warning">{poseError}</Alert> : null}
            {viewerError ? <Alert severity="warning">Docking viewer unavailable: {viewerError}</Alert> : null}
            {currentPoseState.status === 'ready' ? (
              <Typography variant="caption" color="text.secondary" data-testid="pose-performance">
                Pose artifact fetched in {currentPoseState.data.fetchDurationMs.toFixed(1)} ms; parsed in {currentPoseState.data.parseDurationMs.toFixed(1)} ms; latest ligand-model update {ligandRenderMs === null ? 'pending' : `${ligandRenderMs.toFixed(1)} ms`}.
              </Typography>
            ) : null}
            <Typography variant="body2">
              All returned Vina poses are retained. The most favorable (most negative) affinity is used for prioritization.
            </Typography>
            <Box component="details">
              <Typography component="summary" variant="subtitle2" sx={{ cursor: 'pointer' }}>
                Docking protocol and provenance
              </Typography>
              <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.25, mt: 1, mb: 0 }}>
                <Detail label="Receptor ID" value={result.receptor_id} />
                <Detail label="Receptor source" value={result.receptor_source} />
                <Detail label="Receptor source file" value={result.receptor_source_filename} title={result.receptor_source_filename} />
                <Detail label="Ligand preparation" value={result.ligand_preparation} />
                <Detail label="Ligand preparation status" value={dockingStatusLabel(result.ligand_preparation_status)} />
                <Detail label="Vina version" value={result.vina_version} />
                <Detail label="Vina runtime source" value={result.vina_runtime_source} />
                <Detail label="Open Babel version" value={result.obabel_version} />
                <Detail label="Open Babel runtime source" value={result.obabel_runtime_source} />
                <Detail label="Box center (Å)" value={`(${valueOrUnavailable(configuration.center_x)}, ${valueOrUnavailable(configuration.center_y)}, ${valueOrUnavailable(configuration.center_z)})`} />
                <Detail label="Box dimensions (Å)" value={`(${valueOrUnavailable(configuration.size_x)}, ${valueOrUnavailable(configuration.size_y)}, ${valueOrUnavailable(configuration.size_z)})`} />
                <Detail label="Exhaustiveness" value={configuration.exhaustiveness} />
                <Detail label="Random seed" value={configuration.seed} />
                <Detail label="Configuration reference" value={result.configuration_reference} title={result.configuration_reference} />
                <Detail label="Receptor SHA-256" value={result.prepared_receptor_sha256} title={result.prepared_receptor_sha256} />
                <Detail label="Runtime" value={result.runtime_duration_seconds === null || result.runtime_duration_seconds === undefined ? null : `${result.runtime_duration_seconds} s`} />
                <Detail label="Pose artifact" value={poseAvailable ? poseFile : 'Not available'} title={poseFile} />
                <Detail label="Pose SHA-256" value={result.pose_sha256} title={result.pose_sha256} />
              </Box>
            </Box>
            {modes.length ? (
              <Box component="details">
                <Typography component="summary" variant="subtitle2" sx={{ cursor: 'pointer' }}>
                  Returned Vina poses ({returnedModeCount})
                </Typography>
                <Box sx={{ overflowX: 'auto', mt: 0.5 }}>
                  <Table size="small" aria-label="Returned Vina poses" sx={{ minWidth: 620 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell>Mode</TableCell>
                        <TableCell>Affinity (kcal/mol)</TableCell>
                        <TableCell>RMSD lower bound (Å)</TableCell>
                        <TableCell>RMSD upper bound (Å)</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {modes.map((mode) => (
                        <TableRow key={`${mode.mode}-${mode.pose_model ?? ''}`} selected={Number(mode.mode) === effectiveMode}>
                          <TableCell>{valueOrUnavailable(mode.mode)}{mode.mode === result.best_mode ? ' (best)' : ''}{Number(mode.mode) === effectiveMode ? ' (displayed)' : ''}</TableCell>
                          <TableCell>{valueOrUnavailable(mode.affinity_kcal_mol)}</TableCell>
                          <TableCell>{valueOrUnavailable(mode.rmsd_lb)}</TableCell>
                          <TableCell>{valueOrUnavailable(mode.rmsd_ub)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              </Box>
            ) : <Alert severity="info">Docking completed, but no pose-level rows were returned.</Alert>}
          </>
        ) : (
          <Alert severity={result.status === 'not_run_invalid_molecule' || result.status === 'not_requested' ? 'info' : 'warning'}>
            <strong>{dockingStatusLabel(result.status)}.</strong>{' '}
            {result.warning || result.error_message || 'No docking result is available.'}
          </Alert>
        )}
        <Divider />
        <Typography variant="caption" color="text.secondary">
          Vina affinity is a receptor-, site-, and protocol-dependent screening score, not binding free energy.
        </Typography>
      </Stack>
    </Box>
  );
}
