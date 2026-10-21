import React from 'react';
import { Alert, Box, Chip, Divider, Stack, Typography } from '@mui/material';
import ScientificSetupDialog from './ScientificSetupDialog.jsx';
import { ADMET_ENDPOINT_REGISTRY } from './admetAnalysisData.js';

const FAMILY_INVENTORY = [
  { key: 'chemberta', label: 'ChemBERTa classification' },
  { key: 'gmc_mpnn_bbb', label: 'GMC-MPNN' },
  { key: 'chemprop_regression', label: 'Chemprop regression' },
];

function runtimeIdentityForFamily(runtimeIdentities, family) {
  const aliases = family === 'gmc_mpnn_bbb' ? ['gmc_mpnn_bbb', 'gmc_bbb'] : [family];
  return runtimeIdentities.find((identity) => aliases.includes(identity?.family)) || null;
}

function runtimeIdentityLabel(identity) {
  if (!identity) return 'Readiness checked when the ADMET run starts';
  return identity.runner_identity
    || identity.release_archive_sha256
    || identity.runtime_source
    || 'Runtime identity recorded';
}

export default function AdmetPanelRuntimeDialog({
  open,
  onClose,
  restoreFocusRef,
  upload,
  run,
  runtimeIdentities = [],
}) {
  return (
    <ScientificSetupDialog
      open={open}
      title="ADMET Panel & Runtime"
      context="The qualified full-panel contract is fixed. Model families, endpoints, thresholds, and calibration are not editable."
      showApply={false}
      cancelLabel="Close"
      onCancel={onClose}
      restoreFocusRef={restoreFocusRef}
    >
      <Stack spacing={1.5}>
        <Box>
          <Typography variant="overline" color="text.secondary">Panel</Typography>
          <Typography variant="h2">Full frozen ADMET panel</Typography>
          <Typography variant="body2" color="text.secondary">3 model families · 15 endpoints</Typography>
        </Box>
        <Alert severity="info">Runtime readiness is checked when the ADMET run starts. Opening this dialog does not load models or start a runtime probe.</Alert>
        <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1, m: 0 }}>
          <Box><Typography component="dt" variant="caption" color="text.secondary">Molecule collection</Typography><Typography component="dd" variant="body2" fontWeight={700} sx={{ m: 0, overflowWrap: 'anywhere' }}>{upload?.upload_id || 'No active molecule collection'}</Typography></Box>
          <Box><Typography component="dt" variant="caption" color="text.secondary">Current run</Typography><Typography component="dd" variant="body2" fontWeight={700} sx={{ m: 0, overflowWrap: 'anywhere' }}>{run?.run_id || 'Not run'}</Typography></Box>
        </Box>
      </Stack>
      <Divider />
      <Stack spacing={2} aria-label="Fixed ADMET model-family and endpoint inventory">
        {FAMILY_INVENTORY.map((family) => {
          const endpoints = ADMET_ENDPOINT_REGISTRY.filter((endpoint) => endpoint.modelFamily === family.key);
          const identity = runtimeIdentityForFamily(runtimeIdentities, family.key);
          return (
            <Box key={family.key} component="section" aria-labelledby={`admet-family-${family.key}`}>
              <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={0.75}>
                <Box>
                  <Typography id={`admet-family-${family.key}`} variant="h2">{family.label}</Typography>
                  <Typography variant="caption" color="text.secondary">{endpoints.length} endpoint{endpoints.length === 1 ? '' : 's'}</Typography>
                </Box>
                <Chip size="small" variant="outlined" label={runtimeIdentityLabel(identity)} sx={{ maxWidth: { xs: '100%', sm: 360 }, '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }} />
              </Stack>
              <Box component="ul" sx={{ columns: { xs: 1, sm: endpoints.length > 5 ? 2 : 1 }, pl: 2.5, mb: 0.5 }}>
                {endpoints.map((endpoint) => <Typography component="li" variant="body2" key={endpoint.key}>{endpoint.label}</Typography>)}
              </Box>
            </Box>
          );
        })}
      </Stack>
    </ScientificSetupDialog>
  );
}
