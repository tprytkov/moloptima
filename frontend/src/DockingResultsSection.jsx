import React from 'react';
import {
  Alert,
  Box,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';

function valueOrUnavailable(value) {
  return value === null || value === undefined || value === '' ? 'Not available' : String(value);
}

export default function DockingResultsSection({ compound }) {
  const result = compound?.docking_result;
  if (!result || typeof result !== 'object') {
    return null;
  }
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
  return (
    <Box component="section" aria-label="Vina docking results" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2 }}>
      <Stack spacing={1}>
        <Typography variant="h2">Vina Docking</Typography>
        {success ? (
          <>
            <Typography variant="h5" sx={{ fontWeight: 750 }}>
              Best Vina affinity: {valueOrUnavailable(bestAffinity)} kcal/mol
            </Typography>
            <Typography variant="body2">
              Best mode: {valueOrUnavailable(result.best_mode)}. All returned Vina poses are retained. The most favorable (most negative) affinity is used for prioritization.
            </Typography>
            <Typography variant="body2">Docking status: success</Typography>
            <Typography variant="caption" color="text.secondary">
              Receptor: {valueOrUnavailable(result.receptor_id)} · Vina: {valueOrUnavailable(result.vina_version)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Box center: ({valueOrUnavailable(configuration.center_x)}, {valueOrUnavailable(configuration.center_y)}, {valueOrUnavailable(configuration.center_z)}) · size: ({valueOrUnavailable(configuration.size_x)}, {valueOrUnavailable(configuration.size_y)}, {valueOrUnavailable(configuration.size_z)})
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Receptor SHA-256: {valueOrUnavailable(result.prepared_receptor_sha256)} · requested modes: {valueOrUnavailable(requestedNumModes)} · returned modes: {valueOrUnavailable(returnedModeCount)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Pose availability: {result.pose_available || result.pose_file ? 'available' : 'not available'} · file: {valueOrUnavailable(result.pose_file)}
            </Typography>
            {modes.length ? (
              <Box component="details">
                <Typography component="summary" variant="subtitle2" sx={{ cursor: 'pointer' }}>
                  Alternative Vina poses ({returnedModeCount})
                </Typography>
                <Table size="small" aria-label="Returned Vina modes">
                  <TableHead>
                    <TableRow>
                      <TableCell>Mode</TableCell>
                      <TableCell>Affinity (kcal/mol)</TableCell>
                      <TableCell>RMSD lower bound</TableCell>
                      <TableCell>RMSD upper bound</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {modes.map((mode) => (
                      <TableRow key={`${mode.mode}-${mode.pose_model ?? ''}`}>
                        <TableCell>{valueOrUnavailable(mode.mode)}</TableCell>
                        <TableCell>{valueOrUnavailable(mode.affinity_kcal_mol)}</TableCell>
                        <TableCell>{valueOrUnavailable(mode.rmsd_lb)}</TableCell>
                        <TableCell>{valueOrUnavailable(mode.rmsd_ub)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            ) : null}
          </>
        ) : (
          <Alert severity={result.status === 'not_run_invalid_molecule' ? 'info' : 'warning'}>
            Docking {valueOrUnavailable(result.status)}. {result.warning || result.error_message || 'No docking result is available.'}
          </Alert>
        )}
        <Typography variant="caption" color="text.secondary">
          Vina affinity is a receptor-, site-, and protocol-dependent screening score, not binding free energy.
        </Typography>
      </Stack>
    </Box>
  );
}
