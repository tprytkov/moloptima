import React, { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import ModuleConfigurationSummary from './ModuleConfigurationSummary.jsx';

function hasValue(value) {
  return value !== null && value !== undefined && value !== '';
}

function validRows(rows) {
  return rows.filter((row) => row?.valid_molecule === true || String(row?.valid_molecule).toLowerCase() === 'true');
}

function domainStatus({ available, expected, attempted, failed = false }) {
  if (available > 0 && expected > available) return `Partial · ${available} of ${expected}`;
  if (available > 0) return 'Available';
  if (failed) return 'Failed';
  return attempted ? 'Unavailable' : 'Not run';
}

export function deriveResultDomains({ rows = [], job = {}, analysisMode = 'library' } = {}) {
  const valid = validRows(rows);
  const expected = valid.length;
  const admetStatuses = rows.map((row) => String(row?.admet_model_status || '')).filter(Boolean);
  const admetAvailable = valid.filter((row) => (
    row.admet_model_status === 'model_available'
    || (row.admet_predictions && typeof row.admet_predictions === 'object' && Object.keys(row.admet_predictions).length > 0)
    || hasValue(row.bbb_result?.probability)
    || row.admet_regression?.status === 'available'
  )).length;
  const admetFailed = admetStatuses.some((status) => /failed|error|runtime_unavailable/.test(status));
  const admetAttempted = admetStatuses.some((status) => !/not_requested|not_run/.test(status));

  const dockingStatuses = rows.map((row) => String(row?.docking_result?.status || row?.docking_status || '')).filter(Boolean);
  const dockingAvailable = valid.filter((row) => (
    row?.docking_result?.status === 'success'
    || (row?.docking_status === 'provided' && hasValue(row?.docking_score))
  )).length;
  const dockingFailed = dockingStatuses.some((status) => /failed|error|runtime_unavailable/.test(status));
  const dockingAttempted = Boolean(job?.docking_requested)
    || dockingStatuses.some((status) => !/not_requested|not_run/.test(status));

  const ranked = rows.filter((row) => hasValue(
    row?.v2_rank ?? row?.scientific_rank ?? row?.prioritization?.ranking_position,
  )).length;
  const rankingAvailable = Number(job?.ranked_count || 0) > 0 || ranked > 0;
  const chemicalSpaceAvailable = rows.filter((row) => (
    (hasValue(row?.chemical_space_x) && hasValue(row?.chemical_space_y))
    || ['available', 'completed'].includes(String(row?.chemical_space_status || '').toLowerCase())
  )).length;
  const chemicalSpaceAttempted = rows.some((row) => {
    const status = String(row?.chemical_space_status || '').toLowerCase();
    return chemicalSpaceAvailable > 0
      || (hasValue(status) && !['not_run', 'not_requested'].includes(status))
      || (hasValue(row?.chemical_space_method) && status !== 'not_run');
  });

  return [
    { label: 'Molecule Results', status: rows.length ? 'Available' : 'Unavailable' },
    {
      label: 'ADMET Results',
      status: domainStatus({ available: admetAvailable, expected, attempted: admetAttempted, failed: admetFailed }),
    },
    {
      label: 'Docking Results',
      status: domainStatus({ available: dockingAvailable, expected, attempted: dockingAttempted, failed: dockingFailed }),
    },
    {
      label: 'Prioritization Results',
      status: analysisMode === 'single_compound'
        ? 'Not used'
        : rankingAvailable ? 'Available' : String(job?.status || '').toLowerCase() === 'failed' ? 'Failed' : 'Not run',
    },
    {
      label: 'Chemical Space Results',
      status: domainStatus({
        available: chemicalSpaceAvailable,
        expected: rows.length,
        attempted: chemicalSpaceAttempted,
      }),
    },
  ];
}

function statusColor(status) {
  if (status === 'Available') return 'success';
  if (status.startsWith('Partial')) return 'warning';
  if (status === 'Failed') return 'error';
  return 'default';
}

export default function ResultsWorkspace({
  title,
  description,
  status,
  summaryItems,
  domains,
  provenanceRows,
  exportContent,
  children,
  initialExportOpen = false,
}) {
  const [exportOpen, setExportOpen] = useState(initialExportOpen);

  return (
    <Stack spacing={2}>
      <Paper elevation={0} sx={{ width: '100%', maxWidth: 1440, mx: 'auto', p: { xs: 2.5, md: 3 }, border: '1px solid', borderColor: 'divider' }}>
        <Stack spacing={1.25} sx={{ maxWidth: 780 }}>
          <Typography component="h1" variant="h1">{title}</Typography>
          <Typography color="text.secondary">{description}</Typography>
        </Stack>
      </Paper>

      <ModuleConfigurationSummary
        title="Results"
        status={status}
        items={summaryItems}
        actions={(
          <Button variant="contained" startIcon={<DownloadOutlinedIcon />} onClick={() => setExportOpen(true)}>
            Export Results
          </Button>
        )}
      />

      <Paper variant="outlined" component="section" aria-labelledby="result-domain-availability" sx={{ p: 2, minWidth: 0 }}>
        <Stack spacing={1.25}>
          <Box>
            <Typography id="result-domain-availability" variant="h2">Result availability</Typography>
            <Typography variant="body2" color="text.secondary">Availability reflects this calculation’s persisted outputs. Not run and unavailable are not failures.</Typography>
          </Box>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {domains.map((domain) => (
              <Chip
                key={domain.label}
                label={`${domain.label}: ${domain.status}`}
                color={statusColor(domain.status)}
                variant={domain.status === 'Available' ? 'filled' : 'outlined'}
                size="small"
              />
            ))}
          </Stack>
        </Stack>
      </Paper>

      <Box component="details" sx={{ '& > summary': { cursor: 'pointer' } }}>
        <Box component="summary" sx={{ fontWeight: 700, color: 'text.secondary', mb: 1 }}>
          Scientific provenance and identifiers
        </Box>
        <Paper variant="outlined" component="dl" sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5, p: 2, m: 0 }}>
          {provenanceRows.map(([label, value]) => (
            <Box key={label} sx={{ minWidth: 0 }}>
              <Typography component="dt" variant="caption" color="text.secondary">{label}</Typography>
              <Typography component="dd" variant="body2" sx={{ m: 0, overflowWrap: 'anywhere' }}>{value}</Typography>
            </Box>
          ))}
        </Paper>
      </Box>

      {children}

      <Dialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        fullWidth
        maxWidth="md"
        aria-labelledby="export-results-title"
        slotProps={{ paper: { sx: { maxHeight: 'calc(100dvh - 32px)' } } }}
      >
        <DialogTitle id="export-results-title">Export Results</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Typography color="text.secondary">
              Export files from the persisted scientific outputs for this calculation. Exporting does not rerun or modify the calculation.
            </Typography>
            {exportContent}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setExportOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
