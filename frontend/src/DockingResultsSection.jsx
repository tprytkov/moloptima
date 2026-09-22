import React from 'react';
import {
  Alert, Box, Chip, Divider, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';

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

export default function DockingResultsSection({ compound }) {
  const result = compound?.docking_result;
  if (!result || typeof result !== 'object') return null;
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
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 1 }}>
              <Metric label="Best Vina affinity" value={bestAffinity} detail="kcal/mol" />
              <Metric label="Best pose" value={result.best_mode} detail="Vina mode" />
              <Metric label="Poses returned" value={returnedModeCount} detail={`${valueOrUnavailable(requestedNumModes)} requested`} />
            </Box>
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
                        <TableRow key={`${mode.mode}-${mode.pose_model ?? ''}`} selected={mode.mode === result.best_mode}>
                          <TableCell>{valueOrUnavailable(mode.mode)}{mode.mode === result.best_mode ? ' (best)' : ''}</TableCell>
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
