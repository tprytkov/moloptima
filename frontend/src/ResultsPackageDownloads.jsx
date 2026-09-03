import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';

export async function fetchResultsPackage(apiBaseUrl, jobId) {
  const response = await fetch(`${apiBaseUrl}/api/results/${encodeURIComponent(jobId)}/package`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || `Results package request failed (${response.status}).`);
  return payload;
}

export function resultDownloadDefinitions(analysisMode) {
  return analysisMode === 'single_compound' ? [
    ['compound_results.csv', 'Download Compound Results CSV'],
    ['admet_results.csv', 'Download ADMET Results'],
    ['docking_results.csv', 'Download Docking Results'],
    ['compound_report.json', 'Download Compound Report'],
  ] : [
    ['all_compounds_results.csv', 'Download All Compound Results'],
    ['prioritized_compounds.csv', 'Download Prioritized Compounds'],
    ['docking_results.csv', 'Download Docking Results'],
    ['pareto_results.csv', 'Download Pareto Results'],
    ['sensitivity_results.csv', 'Download Sensitivity Results'],
    ['prioritized_compounds.sdf', 'Download Prioritized Structures SDF'],
  ];
}

export default function ResultsPackageDownloads({ apiBaseUrl, jobId, analysisMode }) {
  const [state, setState] = useState({ loading: Boolean(jobId), data: null, error: '' });
  useEffect(() => {
    let active = true;
    if (!jobId) {
      setState({ loading: false, data: null, error: '' });
      return () => { active = false; };
    }
    setState({ loading: true, data: null, error: '' });
    fetchResultsPackage(apiBaseUrl, jobId).then(
      (data) => { if (active) setState({ loading: false, data, error: '' }); },
      (error) => { if (active) setState({ loading: false, data: null, error: error.message }); },
    );
    return () => { active = false; };
  }, [apiBaseUrl, jobId]);

  const artifactPaths = useMemo(
    () => new Set((state.data?.artifacts ?? []).map((item) => item.relative_path)),
    [state.data],
  );
  if (!jobId) return <Alert severity="info">Complete the calculation to generate downloadable results.</Alert>;
  if (state.loading) return <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={18} /><Typography>Preparing deterministic results package…</Typography></Stack>;
  if (state.error) return <Alert severity="error">{state.error}</Alert>;

  const single = analysisMode === 'single_compound';
  const requested = resultDownloadDefinitions(analysisMode);
  return (
    <Paper elevation={0} sx={{ p: 2.5, border: '1px solid', borderColor: 'divider' }}>
      <Stack spacing={1.5}>
        <Box>
          <Typography variant="h2">Downloads</Typography>
          <Typography variant="body2" color="text.secondary">Files are generated from this job’s persisted scientific outputs and verified by SHA-256.</Typography>
        </Box>
        {!single ? <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          <Chip size="small" label={`Pareto: ${state.data?.pareto_status === 'available' ? 'available' : 'not run'}`} />
          <Chip size="small" label={`Sensitivity: ${state.data?.sensitivity_status === 'available' ? 'available' : 'not run'}`} />
        </Stack> : null}
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          {requested.filter(([path]) => artifactPaths.has(path)).map(([path, label]) => (
            <Button key={path} component="a" href={`${apiBaseUrl}/api/results/${encodeURIComponent(jobId)}/artifacts/${path}`} variant="outlined" startIcon={<DownloadOutlinedIcon />}>
              {label}
            </Button>
          ))}
          <Button component="a" href={`${apiBaseUrl}/api/results/${encodeURIComponent(jobId)}/package.zip`} variant="contained" startIcon={<DownloadOutlinedIcon />}>
            Download Complete Results Package
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
