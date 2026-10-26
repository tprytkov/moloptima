import React, { useEffect, useReducer, useRef, useState } from 'react';
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
import ModuleConfigurationSummary from './ModuleConfigurationSummary.jsx';
import ScientificSetupDialog from './ScientificSetupDialog.jsx';
import { createScientificSetupState, scientificSetupReducer } from './scientificSetupState.js';
import { fetchResultsPackage } from './ResultsPackageDownloads.jsx';

export const PARETO_DIMENSIONS = [
  ['docking', 'Docking'],
  ['admet', 'ADMET'],
  ['molecular_quality', 'Molecular quality'],
  ['safety', 'Safety / liability factor'],
];

export const DEFAULT_PARETO_CONFIGURATION = Object.freeze({
  dimensions: ['docking', 'admet', 'molecular_quality'],
});

export const DEFAULT_SENSITIVITY_CONFIGURATION = Object.freeze({
  perturbationMagnitude: 0.1,
  numberOfSamples: 100,
  analysisSeed: 2025,
});

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

export function validateParetoConfiguration(configuration) {
  return Array.isArray(configuration?.dimensions) && configuration.dimensions.length
    ? []
    : ['Select at least one Pareto objective.'];
}

export function validateSensitivityConfiguration(configuration) {
  const errors = [];
  if (!Number.isFinite(configuration?.perturbationMagnitude)
    || configuration.perturbationMagnitude < 0 || configuration.perturbationMagnitude > 1) {
    errors.push('Relative perturbation magnitude must be between 0 and 1.');
  }
  if (!Number.isInteger(configuration?.numberOfSamples)
    || configuration.numberOfSamples < 1 || configuration.numberOfSamples > 1000) {
    errors.push('Number of samples must be an integer from 1 to 1000.');
  }
  if (!Number.isInteger(configuration?.analysisSeed)) {
    errors.push('Analysis seed must be an integer.');
  }
  return errors;
}

export function analysisStatus(state, needsRecalculation = false) {
  if (state.loading) return 'Running';
  if (state.error) return 'Failed';
  if (needsRecalculation && state.data) return 'Results Need Recalculation';
  if (state.data) return 'Completed';
  return 'Not run';
}

export function isCurrentAnalysisRequest(requestId, currentRequestId, mounted = true) {
  return mounted && requestId === currentRequestId;
}

export default function PrioritizationAnalysisPanel({
  apiBaseUrl,
  jobId = '',
  results,
  profile,
  profileScoreable,
}) {
  const [paretoSetup, dispatchParetoSetup] = useReducer(
    scientificSetupReducer,
    DEFAULT_PARETO_CONFIGURATION,
    createScientificSetupState,
  );
  const [sensitivitySetup, dispatchSensitivitySetup] = useReducer(
    scientificSetupReducer,
    DEFAULT_SENSITIVITY_CONFIGURATION,
    createScientificSetupState,
  );
  const [pareto, setPareto] = useState({ loading: false, data: null, error: '' });
  const [sensitivity, setSensitivity] = useState({ loading: false, data: null, error: '' });
  const [paretoNeedsRecalculation, setParetoNeedsRecalculation] = useState(false);
  const [sensitivityNeedsRecalculation, setSensitivityNeedsRecalculation] = useState(false);
  const paretoSetupButtonRef = useRef(null);
  const sensitivitySetupButtonRef = useRef(null);
  const mountedRef = useRef(true);
  const paretoRequestRef = useRef(0);
  const sensitivityRequestRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      paretoRequestRef.current += 1;
      sensitivityRequestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const paretoRequestId = paretoRequestRef.current + 1;
    const sensitivityRequestId = sensitivityRequestRef.current + 1;
    paretoRequestRef.current = paretoRequestId;
    sensitivityRequestRef.current = sensitivityRequestId;
    setPareto({ loading: false, data: null, error: '' });
    setSensitivity({ loading: false, data: null, error: '' });
    setParetoNeedsRecalculation(false);
    setSensitivityNeedsRecalculation(false);
    dispatchParetoSetup({ type: 'replace-applied', configuration: DEFAULT_PARETO_CONFIGURATION });
    dispatchSensitivitySetup({ type: 'replace-applied', configuration: DEFAULT_SENSITIVITY_CONFIGURATION });
    if (!jobId) return undefined;

    let active = true;
    fetchResultsPackage(apiBaseUrl, jobId).then(async (data) => {
      if (!active || !mountedRef.current) return;
      if (data.pareto_status === 'available'
        && isCurrentAnalysisRequest(paretoRequestId, paretoRequestRef.current, mountedRef.current)) {
        setPareto({ loading: true, data: null, error: '' });
        try {
          const analysis = await fetchSavedAnalysis(apiBaseUrl, jobId, 'pareto');
          if (active && isCurrentAnalysisRequest(paretoRequestId, paretoRequestRef.current, mountedRef.current)) {
            setPareto({ loading: false, data: analysis, error: '' });
            dispatchParetoSetup({ type: 'replace-applied', configuration: { dimensions: [...analysis.dimensions_used] } });
          }
        } catch (error) {
          if (active && isCurrentAnalysisRequest(paretoRequestId, paretoRequestRef.current, mountedRef.current)) {
            setPareto({ loading: false, data: null, error: error.message });
          }
        }
      }
      if (data.sensitivity_status === 'available'
        && isCurrentAnalysisRequest(sensitivityRequestId, sensitivityRequestRef.current, mountedRef.current)) {
        setSensitivity({ loading: true, data: null, error: '' });
        try {
          const analysis = await fetchSavedAnalysis(apiBaseUrl, jobId, 'sensitivity');
          if (active && isCurrentAnalysisRequest(sensitivityRequestId, sensitivityRequestRef.current, mountedRef.current)) {
            const provenance = analysis.provenance ?? {};
            setSensitivity({ loading: false, data: analysis, error: '' });
            dispatchSensitivitySetup({
              type: 'replace-applied',
              configuration: {
                perturbationMagnitude: provenance.perturbation_magnitude,
                numberOfSamples: provenance.number_of_samples,
                analysisSeed: provenance.analysis_seed,
              },
            });
          }
        } catch (error) {
          if (active && isCurrentAnalysisRequest(sensitivityRequestId, sensitivityRequestRef.current, mountedRef.current)) {
            setSensitivity({ loading: false, data: null, error: error.message });
          }
        }
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [apiBaseUrl, jobId]);

  const applyParetoSetup = () => {
    const errors = validateParetoConfiguration(paretoSetup.draftConfiguration);
    if (errors.length) {
      dispatchParetoSetup({ type: 'validation-failed', errors });
      return;
    }
    if (pareto.data && paretoSetup.dirty) setParetoNeedsRecalculation(true);
    dispatchParetoSetup({ type: 'apply' });
  };

  const applySensitivitySetup = () => {
    const errors = validateSensitivityConfiguration(sensitivitySetup.draftConfiguration);
    if (errors.length) {
      dispatchSensitivitySetup({ type: 'validation-failed', errors });
      return;
    }
    if (sensitivity.data && sensitivitySetup.dirty) setSensitivityNeedsRecalculation(true);
    dispatchSensitivitySetup({ type: 'apply' });
  };

  const runPareto = async () => {
    const requestId = paretoRequestRef.current + 1;
    paretoRequestRef.current = requestId;
    setPareto({ loading: true, data: null, error: '' });
    setParetoNeedsRecalculation(false);
    try {
      const data = await requestParetoAnalysis(
        apiBaseUrl,
        results,
        paretoSetup.appliedConfiguration.dimensions,
        jobId,
      );
      if (!isCurrentAnalysisRequest(requestId, paretoRequestRef.current, mountedRef.current)) return;
      setPareto({ loading: false, data, error: '' });
    } catch (error) {
      if (!isCurrentAnalysisRequest(requestId, paretoRequestRef.current, mountedRef.current)) return;
      setPareto({ loading: false, data: null, error: error.message });
    }
  };

  const runSensitivity = async () => {
    const requestId = sensitivityRequestRef.current + 1;
    sensitivityRequestRef.current = requestId;
    setSensitivity({ loading: true, data: null, error: '' });
    setSensitivityNeedsRecalculation(false);
    try {
      const data = await requestSensitivityAnalysis(
        apiBaseUrl,
        results,
        profile,
        sensitivitySetup.appliedConfiguration,
        jobId,
      );
      if (!isCurrentAnalysisRequest(requestId, sensitivityRequestRef.current, mountedRef.current)) return;
      setSensitivity({ loading: false, data, error: '' });
    } catch (error) {
      if (!isCurrentAnalysisRequest(requestId, sensitivityRequestRef.current, mountedRef.current)) return;
      setSensitivity({ loading: false, data: null, error: error.message });
    }
  };

  const paretoConfiguration = paretoSetup.appliedConfiguration;
  const sensitivityConfiguration = sensitivitySetup.appliedConfiguration;
  const paretoStatus = analysisStatus(pareto, paretoNeedsRecalculation);
  const sensitivityStatus = analysisStatus(sensitivity, sensitivityNeedsRecalculation);

  return (
    <Stack component="section" aria-label="Multi-Parameter Prioritization secondary analyses" spacing={2}>
      <Box>
        <Typography variant="h2">Pareto and Sensitivity Analysis</Typography>
        <Typography variant="body2" color="text.secondary">
          These optional analyses explain trade-offs and ranking stability. They do not alter the Prioritization Score, Priority Rank, Prioritization Profile, penalties, or gates.
        </Typography>
      </Box>

      <ModuleConfigurationSummary
        title="Pareto Analysis"
        status={paretoStatus}
        items={[
          { label: 'Objectives', value: paretoConfiguration.dimensions.map(dimensionLabel).join(' · ') },
          { label: 'Direction', value: 'Higher normalized desirability' },
          { label: 'Candidate scope', value: `${results.length} candidates` },
          { label: 'Interpretation', value: 'Trade-off interpretation only' },
        ]}
        actions={<>
          <Button ref={paretoSetupButtonRef} variant="outlined" onClick={() => dispatchParetoSetup({ type: 'open' })}>Configure Pareto</Button>
          <Button variant="contained" onClick={runPareto} disabled={pareto.loading || !paretoConfiguration.dimensions.length || !results.length}>
            {pareto.loading ? 'Running Pareto' : pareto.data ? 'Rerun Pareto' : 'Run Pareto'}
          </Button>
        </>}
      />
      {paretoNeedsRecalculation ? <Alert severity="warning">Pareto configuration changed. Existing results remain historical and require recalculation before they are current.</Alert> : null}
      {pareto.error ? <Alert severity="error">Pareto analysis failed: {pareto.error}</Alert> : null}
      {!pareto.loading && !pareto.data && !pareto.error ? <Alert severity="info">Pareto analysis has not been run for this calculation.</Alert> : null}
      {pareto.data ? <ParetoResults analysis={pareto.data} /> : null}
      {pareto.data && jobId ? <SavedAnalysisFigure
        alt="Saved docking versus ADMET Pareto visualization"
        src={`${apiBaseUrl}/api/results/${encodeURIComponent(jobId)}/artifacts/visualizations/pareto_docking_vs_admet.svg`}
        downloadLabel="Download saved Pareto SVG"
      /> : null}

      <ModuleConfigurationSummary
        title="Sensitivity Analysis"
        status={sensitivityStatus}
        items={[
          { label: 'Perturbation', value: `±${formatFrequency(sensitivityConfiguration.perturbationMagnitude)}` },
          { label: 'Samples', value: sensitivityConfiguration.numberOfSamples },
          { label: 'Analysis seed', value: sensitivityConfiguration.analysisSeed },
          { label: 'Profile', value: profile?.name || profile?.profile_id || 'Not available' },
        ]}
        actions={<>
          <Button ref={sensitivitySetupButtonRef} variant="outlined" onClick={() => dispatchSensitivitySetup({ type: 'open' })}>Configure Sensitivity</Button>
          <Button variant="contained" onClick={runSensitivity} disabled={sensitivity.loading || !profile || !profileScoreable || !results.length}>
            {sensitivity.loading ? 'Running Sensitivity' : sensitivity.data ? 'Rerun Sensitivity' : 'Run Sensitivity'}
          </Button>
        </>}
      />
      {!profileScoreable ? <Alert severity="info">Sensitivity analysis requires the valid persisted Prioritization Profile associated with this calculation.</Alert> : null}
      {sensitivityNeedsRecalculation ? <Alert severity="warning">Sensitivity configuration changed. Existing results remain historical and require recalculation before they are current.</Alert> : null}
      {sensitivity.error ? <Alert severity="error">Sensitivity analysis failed: {sensitivity.error}</Alert> : null}
      {!sensitivity.loading && !sensitivity.data && !sensitivity.error ? <Alert severity="info">Sensitivity analysis has not been run for this calculation.</Alert> : null}
      {sensitivity.data ? <SensitivityResults analysis={sensitivity.data} /> : null}
      {sensitivity.data && jobId ? <SavedAnalysisFigure
        alt="Saved sensitivity ranking-stability visualization"
        src={`${apiBaseUrl}/api/results/${encodeURIComponent(jobId)}/artifacts/visualizations/sensitivity_top_candidates.svg`}
        downloadLabel="Download saved sensitivity SVG"
      /> : null}

      <ScientificSetupDialog
        open={paretoSetup.open}
        title="Configure Pareto Analysis"
        context="Choose the existing normalized objectives used to calculate non-dominated fronts. All selected objectives are maximized."
        dirty={paretoSetup.dirty}
        validationErrors={paretoSetup.validationErrors}
        applyDisabled={!paretoSetup.dirty}
        onCancel={() => dispatchParetoSetup({ type: 'cancel' })}
        onApply={applyParetoSetup}
        restoreFocusRef={paretoSetupButtonRef}
      >
        <Stack spacing={0.5}>
          <Typography variant="h6">Pareto objectives</Typography>
          {PARETO_DIMENSIONS.map(([dimension, label]) => (
            <FormControlLabel
              key={dimension}
              control={<Checkbox
                checked={paretoSetup.draftConfiguration.dimensions.includes(dimension)}
                onChange={() => dispatchParetoSetup({
                  type: 'change',
                  patch: {
                    dimensions: paretoSetup.draftConfiguration.dimensions.includes(dimension)
                      ? paretoSetup.draftConfiguration.dimensions.filter((item) => item !== dimension)
                      : [...paretoSetup.draftConfiguration.dimensions, dimension],
                  },
                })}
              />}
              label={`${label} — Maximize`}
            />
          ))}
        </Stack>
      </ScientificSetupDialog>

      <ScientificSetupDialog
        open={sensitivitySetup.open}
        title="Configure Sensitivity Analysis"
        context="Configure analysis-only bounded perturbations of the existing top-level Evidence Weights. Prioritization Rules and thresholds remain unchanged."
        dirty={sensitivitySetup.dirty}
        validationErrors={sensitivitySetup.validationErrors}
        applyDisabled={!sensitivitySetup.dirty}
        onCancel={() => dispatchSensitivitySetup({ type: 'cancel' })}
        onApply={applySensitivitySetup}
        restoreFocusRef={sensitivitySetupButtonRef}
      >
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5 }}>
          <TextField
            label="Relative perturbation magnitude"
            type="number"
            size="small"
            value={sensitivitySetup.draftConfiguration.perturbationMagnitude}
            onChange={(event) => dispatchSensitivitySetup({ type: 'change', patch: { perturbationMagnitude: Number(event.target.value) } })}
            inputProps={{ min: 0, max: 1, step: 0.01 }}
            helperText="Default 0.10; range 0–1"
          />
          <TextField
            label="Number of samples"
            type="number"
            size="small"
            value={sensitivitySetup.draftConfiguration.numberOfSamples}
            onChange={(event) => dispatchSensitivitySetup({ type: 'change', patch: { numberOfSamples: Number(event.target.value) } })}
            inputProps={{ min: 1, max: 1000, step: 1 }}
            helperText="Default 100"
          />
          <TextField
            label="Analysis seed"
            type="number"
            size="small"
            value={sensitivitySetup.draftConfiguration.analysisSeed}
            onChange={(event) => dispatchSensitivitySetup({ type: 'change', patch: { analysisSeed: Number(event.target.value) } })}
            inputProps={{ step: 1 }}
            helperText="Default 2025"
          />
        </Box>
      </ScientificSetupDialog>
    </Stack>
  );
}

export function ParetoResults({ analysis }) {
  const dimensions = Array.isArray(analysis.dimensions_used) ? analysis.dimensions_used : [];
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
        <Chip size="small" label={`Objectives: ${dimensions.map(dimensionLabel).join(', ')}`} variant="outlined" />
        <Chip size="small" label={`${analysis.rank_eligible_molecule_count} eligible candidates`} variant="outlined" />
        <Chip size="small" label="Front 1 = non-dominated" variant="outlined" />
      </Stack>
      <Typography variant="body2" color="text.secondary">
        Pareto front membership describes trade-offs among the selected objectives. It does not designate a preferred candidate or imply experimental validation.
      </Typography>
      <AnalysisTable
        label="Pareto analysis results"
        headers={[
          'Molecule', 'Priority Rank', 'Pareto front', 'Non-dominated', 'Dominated by', 'Dominates',
          ...dimensions.map((dimension) => dimensionLabel(dimension)),
        ]}
        rows={(analysis.results ?? []).map((row) => [
          row.molecule_id || `Row ${row.source_index + 1}`,
          row.scalar_rank,
          row.pareto_front,
          row.pareto_non_dominated ? 'Yes' : 'No',
          row.pareto_dominated_by_count,
          row.pareto_dominates_count,
          ...dimensions.map((dimension) => formatNumber(row.objective_values?.[dimension])),
        ])}
      />
      <AnalysisProvenance rows={[
        ['Analysis method', analysis.analysis_version],
        ['Objectives', dimensions.map(dimensionLabel).join(', ')],
        ['Excluded unrankable candidates', analysis.excluded_unrankable_count],
      ]} />
    </Stack>
  );
}

export function SensitivityResults({ analysis }) {
  const provenance = analysis.provenance ?? {};
  return (
    <Stack spacing={1}>
      <Typography variant="body2" color="text.secondary">
        Ranking Stability reports rank movement under configured weight perturbations. It does not estimate uncertainty, probability, or an experimental effect.
      </Typography>
      <AnalysisTable
        label="Sensitivity analysis results"
        headers={['Molecule', 'Baseline rank', 'Baseline score', 'Rank range', 'Median rank', 'Rank SD', 'Top-1 frequency', 'Top-5 frequency', 'Top-10 frequency']}
        rows={(analysis.results ?? []).map((row) => [
          row.molecule_id || `Row ${row.source_index + 1}`,
          row.baseline_rank,
          formatNumber(row.baseline_score),
          formatRange(row.minimum_rank, row.maximum_rank),
          formatNumber(row.median_rank),
          formatNumber(row.rank_standard_deviation),
          formatFrequency(row.top_1_frequency),
          formatFrequency(row.top_5_frequency),
          formatFrequency(row.top_10_frequency),
        ])}
      />
      {analysis.excluded_unrankable?.length ? <Alert severity="warning">{analysis.excluded_unrankable.length} hard-gated or otherwise unrankable candidates remained excluded.</Alert> : null}
      <AnalysisProvenance rows={[
        ['Analysis method', analysis.analysis_version || provenance.analysis_version],
        ['Prioritization Profile', [provenance.source_profile_id, provenance.source_profile_version].filter(Boolean).join(' · ')],
        ['Profile SHA256', provenance.source_profile_sha256],
        ['Perturbation method', provenance.perturbation_method],
        ['Perturbation magnitude', provenance.perturbation_magnitude],
        ['Number of samples', provenance.number_of_samples],
        ['Analysis seed', provenance.analysis_seed],
      ]} />
    </Stack>
  );
}

function SavedAnalysisFigure({ alt, src, downloadLabel }) {
  return (
    <Stack spacing={1} sx={{ minWidth: 0 }}>
      <Box component="img" alt={alt} src={src} sx={{ width: '100%', maxWidth: 720, height: 'auto', alignSelf: 'flex-start' }} />
      <Button component="a" href={src} sx={{ alignSelf: 'flex-start' }}>{downloadLabel}</Button>
    </Stack>
  );
}

function AnalysisProvenance({ rows }) {
  return (
    <Box component="details" sx={{ minWidth: 0 }}>
      <Typography component="summary" variant="body2" fontWeight={700} sx={{ cursor: 'pointer' }}>
        Scientific provenance and identifiers
      </Typography>
      <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1, mt: 1, mb: 0 }}>
        {rows.map(([label, value]) => (
          <Box key={label} sx={{ minWidth: 0 }}>
            <Typography component="dt" variant="caption" color="text.secondary">{label}</Typography>
            <Typography component="dd" variant="body2" sx={{ m: 0, overflowWrap: 'anywhere' }}>{formatValue(value)}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function AnalysisTable({ label, headers, rows }) {
  return (
    <Box sx={{ overflowX: 'auto', maxWidth: '100%' }}>
      <Table size="small" aria-label={label} sx={{ minWidth: 720 }}>
        <TableHead><TableRow>{headers.map((header) => <TableCell key={header}>{header}</TableCell>)}</TableRow></TableHead>
        <TableBody>{rows.map((row, index) => (
          <TableRow key={`${row[0]}-${index}`}>{row.map((value, cell) => <TableCell key={`${headers[cell]}-${cell}`}>{formatValue(value)}</TableCell>)}</TableRow>
        ))}</TableBody>
      </Table>
    </Box>
  );
}

function dimensionLabel(dimension) {
  return PARETO_DIMENSIONS.find(([id]) => id === dimension)?.[1] || dimension;
}

async function postAnalysis(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `Analysis request failed (${response.status}).`);
  return data;
}

function formatRange(minimum, maximum) {
  return typeof minimum === 'number' && typeof maximum === 'number' ? `${minimum}–${maximum}` : 'Not available';
}

function formatFrequency(value) {
  return typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : 'Not available';
}

function formatNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(3)) : 'Not available';
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') return 'Not available';
  if (typeof value === 'number' && !Number.isFinite(value)) return 'Not available';
  return value;
}
