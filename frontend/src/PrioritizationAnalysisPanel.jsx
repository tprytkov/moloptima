import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { fetchResultsPackage } from './ResultsPackageDownloads.jsx';

const PARETO_DIMENSIONS = [
  ['docking', 'Docking'],
  ['admet', 'ADMET'],
  ['molecular_quality', 'Molecular quality'],
  ['safety', 'Safety / liability factor'],
];

export async function requestParetoAnalysis(apiBaseUrl, results, dimensions, jobId = '') {
  return postAnalysis(`${apiBaseUrl}/api/prioritization/analysis/pareto`, {
    job_id: jobId || null,
    results,
    dimensions,
  });
}

export async function requestSensitivityAnalysis(apiBaseUrl, candidates, profile, config, jobId = '') {
  return postAnalysis(`${apiBaseUrl}/api/prioritization/analysis/sensitivity`, {
    job_id: jobId || null,
    candidates,
    profile,
    perturbation_magnitude: config.perturbationMagnitude,
    number_of_samples: config.numberOfSamples,
    analysis_seed: config.analysisSeed,
  });
}

export async function fetchSavedAnalysis(apiBaseUrl, jobId, analysisName) {
  const response = await fetch(`${apiBaseUrl}/api/results/${encodeURIComponent(jobId)}/analysis/${analysisName}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || `Saved ${analysisName} analysis is unavailable.`);
  return payload;
}

export default function PrioritizationAnalysisPanel({
  apiBaseUrl,
  jobId = '',
  results,
  profile,
  profileScoreable,
}) {
  const [dimensions, setDimensions] = useState(['docking', 'admet', 'molecular_quality']);
  const [config, setConfig] = useState({
    perturbationMagnitude: 0.1,
    numberOfSamples: 100,
    analysisSeed: 2025,
  });
  const [pareto, setPareto] = useState({ loading: false, data: null, error: '' });
  const [sensitivity, setSensitivity] = useState({ loading: false, data: null, error: '' });
  const [saved, setSaved] = useState({ pareto: false, sensitivity: false });

  useEffect(() => {
    let active = true;
    if (!jobId) return () => { active = false; };
    fetchResultsPackage(apiBaseUrl, jobId).then(
      (data) => {
        if (!active) return;
        const paretoAvailable = data.pareto_status === 'available';
        const sensitivityAvailable = data.sensitivity_status === 'available';
        setSaved({ pareto: paretoAvailable, sensitivity: sensitivityAvailable });
        if (paretoAvailable) fetchSavedAnalysis(apiBaseUrl, jobId, 'pareto').then(
          (analysis) => { if (active) setPareto({ loading: false, data: analysis, error: '' }); }, () => {},
        );
        if (sensitivityAvailable) fetchSavedAnalysis(apiBaseUrl, jobId, 'sensitivity').then(
          (analysis) => { if (active) setSensitivity({ loading: false, data: analysis, error: '' }); }, () => {},
        );
      },
      () => {},
    );
    return () => { active = false; };
  }, [apiBaseUrl, jobId]);

  const toggleDimension = (dimension) => {
    setDimensions((current) => (
      current.includes(dimension)
        ? current.filter((item) => item !== dimension)
        : [...current, dimension]
    ));
  };

  const runPareto = async () => {
    setPareto({ loading: true, data: null, error: '' });
    try {
      const data = await requestParetoAnalysis(apiBaseUrl, results, dimensions, jobId);
      setPareto({ loading: false, data, error: '' });
      setSaved((current) => ({ ...current, pareto: true }));
    } catch (error) {
      setPareto({ loading: false, data: null, error: error.message });
    }
  };

  const runSensitivity = async () => {
    setSensitivity({ loading: true, data: null, error: '' });
    try {
      const data = await requestSensitivityAnalysis(apiBaseUrl, results, profile, config, jobId);
      setSensitivity({ loading: false, data, error: '' });
      setSaved((current) => ({ ...current, sensitivity: true }));
    } catch (error) {
      setSensitivity({ loading: false, data: null, error: error.message });
    }
  };

  return (
    <Box component="section" aria-label="Prioritization v2 secondary analyses" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2 }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="h2">Secondary v2 Analyses</Typography>
          <Typography variant="body2" color="text.secondary">
            Pareto and sensitivity analyses do not alter the Prioritization v2 score, scalar rank, profile, penalties, or gates.
          </Typography>
        </Box>

        <Box>
          <Typography variant="h6">Pareto trade-off analysis</Typography>
          <Typography variant="caption" color="text.secondary">
            Pareto front analysis shows non-dominated trade-offs and does not replace the scalar prioritization rank. Higher normalized desirability is better. Safety uses the existing combined liability-penalty factor.
          </Typography>
          <Stack direction="row" useFlexGap flexWrap="wrap">
            {PARETO_DIMENSIONS.map(([dimension, label]) => (
              <FormControlLabel
                key={dimension}
                control={<Checkbox checked={dimensions.includes(dimension)} onChange={() => toggleDimension(dimension)} />}
                label={label}
              />
            ))}
          </Stack>
          <Button variant="outlined" onClick={runPareto} disabled={pareto.loading || dimensions.length === 0 || results.length === 0}>
            {pareto.loading ? 'Running Pareto analysis' : 'Run Pareto analysis'}
          </Button>
          {pareto.error ? <Alert severity="error" sx={{ mt: 1 }}>{pareto.error}</Alert> : null}
          {pareto.data ? <ParetoResults analysis={pareto.data} /> : null}
          {saved.pareto && jobId ? <Stack spacing={1} sx={{ mt: 1.5 }}>
            <Alert severity="success">Saved Pareto results are available for this job.</Alert>
            <Box component="img" alt="Saved docking versus ADMET Pareto visualization" src={`${apiBaseUrl}/api/results/${encodeURIComponent(jobId)}/artifacts/visualizations/pareto_docking_vs_admet.svg`} sx={{ width: '100%', maxWidth: 640, height: 'auto' }} />
            <Button component="a" href={`${apiBaseUrl}/api/results/${encodeURIComponent(jobId)}/artifacts/visualizations/pareto_docking_vs_admet.svg`} sx={{ alignSelf: 'flex-start' }}>Download saved Pareto SVG</Button>
          </Stack> : null}
        </Box>

        <Box>
          <Typography variant="h6">Top-level weight sensitivity</Typography>
          <Typography variant="caption" color="text.secondary">
            Analysis-only bounded relative perturbations change docking, ADMET, and molecular-quality weights, normalize them to one, and rerun the existing v2 engine. Endpoint rules and thresholds are unchanged.
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5, my: 1.5 }}>
            <TextField
              label="Relative perturbation magnitude"
              type="number"
              size="small"
              value={config.perturbationMagnitude}
              onChange={(event) => setConfig({ ...config, perturbationMagnitude: Number(event.target.value) })}
              inputProps={{ min: 0, max: 1, step: 0.01 }}
              helperText="Analysis default: 0.10; range 0–1"
            />
            <TextField
              label="Number of samples"
              type="number"
              size="small"
              value={config.numberOfSamples}
              onChange={(event) => setConfig({ ...config, numberOfSamples: Number(event.target.value) })}
              inputProps={{ min: 1, max: 1000, step: 1 }}
              helperText="Analysis default: 100"
            />
            <TextField
              label="Analysis seed"
              type="number"
              size="small"
              value={config.analysisSeed}
              onChange={(event) => setConfig({ ...config, analysisSeed: Number(event.target.value) })}
              inputProps={{ step: 1 }}
              helperText="Analysis default: 2025"
            />
          </Box>
          <Button variant="outlined" onClick={runSensitivity} disabled={sensitivity.loading || !profile || !profileScoreable || results.length === 0}>
            {sensitivity.loading ? 'Running sensitivity analysis' : 'Run sensitivity analysis'}
          </Button>
          {!profileScoreable ? (
            <Alert severity="info" sx={{ mt: 1 }}>
              Sensitivity analysis requires the valid scoreable v2 profile associated with this analysis session.
            </Alert>
          ) : null}
          {sensitivity.error ? <Alert severity="error" sx={{ mt: 1 }}>{sensitivity.error}</Alert> : null}
          {sensitivity.data ? <SensitivityResults analysis={sensitivity.data} /> : null}
          {saved.sensitivity && jobId ? <Button component="a" href={`${apiBaseUrl}/api/results/${encodeURIComponent(jobId)}/artifacts/visualizations/sensitivity_top_candidates.svg`} sx={{ ml: 1 }}>Download saved sensitivity SVG</Button> : null}
          {!sensitivity.loading && !sensitivity.data && !sensitivity.error && !saved.sensitivity ? (
            <Alert severity="info" sx={{ mt: 1 }}>Sensitivity analysis not run.</Alert>
          ) : null}
        </Box>
      </Stack>
    </Box>
  );
}

export function ParetoResults({ analysis }) {
  return (
    <Stack spacing={1} sx={{ mt: 1.5 }}>
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
        <Chip size="small" label={`Dimensions: ${analysis.dimensions_used.join(', ')}`} variant="outlined" />
        <Chip size="small" label={`${analysis.rank_eligible_molecule_count} eligible molecules`} variant="outlined" />
      </Stack>
      <AnalysisTable
        label="Pareto analysis results"
        headers={['Molecule', 'Scalar rank', 'Pareto front', 'Non-dominated', 'Dominated by', 'Dominates']}
        rows={analysis.results.map((row) => [
          row.molecule_id || `Row ${row.source_index + 1}`,
          row.scalar_rank,
          row.pareto_front,
          row.pareto_non_dominated ? 'Yes' : 'No',
          row.pareto_dominated_by_count,
          row.pareto_dominates_count,
        ])}
      />
    </Stack>
  );
}

export function SensitivityResults({ analysis }) {
  const provenance = analysis.provenance ?? {};
  return (
    <Stack spacing={1} sx={{ mt: 1.5 }}>
      <Typography variant="caption" color="text.secondary">
        Source profile SHA256: {provenance.source_profile_sha256} · {provenance.number_of_samples} samples · seed {provenance.analysis_seed}
      </Typography>
      <AnalysisTable
        label="Weight sensitivity results"
        headers={['Molecule', 'Baseline', 'Rank range', 'Median', 'Rank SD', 'Top-1', 'Top-5', 'Top-10']}
        rows={analysis.results.map((row) => [
          row.molecule_id || `Row ${row.source_index + 1}`,
          row.baseline_rank,
          `${row.minimum_rank}–${row.maximum_rank}`,
          formatNumber(row.median_rank),
          formatNumber(row.rank_standard_deviation),
          formatFrequency(row.top_1_frequency),
          formatFrequency(row.top_5_frequency),
          formatFrequency(row.top_10_frequency),
        ])}
      />
      {analysis.excluded_unrankable?.length ? (
        <Alert severity="warning">{analysis.excluded_unrankable.length} hard-gated or otherwise unrankable molecules remained excluded.</Alert>
      ) : null}
    </Stack>
  );
}

function AnalysisTable({ label, headers, rows }) {
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small" aria-label={label}>
        <TableHead><TableRow>{headers.map((header) => <TableCell key={header}>{header}</TableCell>)}</TableRow></TableHead>
        <TableBody>{rows.map((row, index) => (
          <TableRow key={`${row[0]}-${index}`}>{row.map((value, cell) => <TableCell key={`${headers[cell]}-${cell}`}>{value ?? 'Not available'}</TableCell>)}</TableRow>
        ))}</TableBody>
      </Table>
    </Box>
  );
}

async function postAnalysis(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || `Analysis request failed (${response.status}).`);
  }
  return data;
}

function formatFrequency(value) {
  return typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : 'N/A for population';
}

function formatNumber(value) {
  return typeof value === 'number' ? Number(value.toFixed(3)) : 'Not available';
}
