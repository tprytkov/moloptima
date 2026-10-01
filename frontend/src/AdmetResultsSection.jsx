import React from 'react';
import { Alert, Box, Chip, Stack, Typography } from '@mui/material';
import { ADMET_ENDPOINT_REGISTRY } from './admetAnalysisData.js';
import {
  aggregateAdmetFamilyStatus,
  deriveAdmetFamilyStatuses,
  normalizeAdmetStatus,
} from './admetStatus.js';

export { aggregateAdmetFamilyStatus, deriveAdmetFamilyStatuses, normalizeAdmetStatus } from './admetStatus.js';

export const ADMET_GROUPS = [
  {
    label: 'Absorption',
    endpoints: ['hia_hou', 'pgp_broccatelli', 'regression:caco2_wang'],
  },
  {
    label: 'Distribution',
    endpoints: ['bbb:gmc_mpnn_bbb'],
  },
  {
    label: 'Distribution / physicochemical',
    endpoints: ['regression:ppbr_az', 'regression:vdss_lombardo', 'regression:lipophilicity_astrazeneca'],
  },
  {
    label: 'Solubility',
    endpoints: ['regression:solubility_aqsoldb'],
  },
  {
    label: 'Metabolism',
    endpoints: [
      'cyp1a2_veith',
      'cyp2c19_veith',
      'cyp2c9_veith',
      'cyp2d6_veith',
      'cyp3a4_veith',
    ],
  },
  {
    label: 'Toxicity',
    endpoints: ['herg_karim', 'ames'],
  },
];

const ENDPOINT_LABELS = Object.fromEntries(ADMET_ENDPOINT_REGISTRY.map(({ key, label }) => [key, label]));

const EVIDENCE_LABELS = {
  experimental_low_confidence: 'Experimental / Low confidence',
  limited_support: 'Limited support',
  strong_ranking: 'Strong ranking support',
  moderate_good: 'Moderate support',
  moderate: 'Moderate support',
  strong: 'Strong support',
};

export function formatCalibratedProbability(value) {
  if (value === null || value === undefined || value === '') {
    return 'Not available';
  }
  const probability = Number(value);
  if (!Number.isFinite(probability)) {
    return 'Not available';
  }
  const percentage = probability * 100;
  const precision = Math.abs(percentage) > 0 && Math.abs(percentage) < 1 ? 2 : 1;
  return `${percentage.toFixed(precision)}%`;
}

function formatBinaryPrediction(value) {
  if (value === 1 || value === '1' || value === true) {
    return '1 · positive class';
  }
  if (value === 0 || value === '0' || value === false) {
    return '0 · negative class';
  }
  return 'Not available';
}

function evidenceLabel(endpointName, evidenceStatus) {
  if (endpointName === 'hia_hou') {
    return 'Limited support';
  }
  return EVIDENCE_LABELS[evidenceStatus] ?? String(evidenceStatus || 'Evidence not specified');
}

function firstEnsembleValue(endpoint) {
  const key = Object.keys(endpoint || {}).find((name) => name.startsWith('ensemble_mean_'));
  return key ? endpoint[key] : null;
}

function RegressionEndpointCard({ endpointName, endpoint, status }) {
  const value = firstEnsembleValue(endpoint);
  const uncertaintyKey = Object.keys(endpoint || {}).find((name) => name.startsWith('seed_standard_deviation_'));
  return (
    <Box data-testid={`admet-endpoint-${endpointName}`} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2, bgcolor: 'background.paper' }}>
      <Stack spacing={1}>
        <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>{ENDPOINT_LABELS[endpointName]}</Typography>
        {status.code !== 'available' ? <Chip variant="outlined" color={status.color} label={status.label} /> : null}
        <Typography variant="h5" sx={{ fontWeight: 750 }}>{value ?? 'Not available'} {endpoint?.unit || ''}</Typography>
        <Typography variant="caption" color="text.secondary">
          Ensemble SD: {uncertaintyKey ? endpoint[uncertaintyKey] : 'Not available'} · {endpoint?.representation || 'representation unavailable'}
        </Typography>
        {endpoint?.warning ? <Alert severity="warning">{endpoint.warning}</Alert> : null}
      </Stack>
    </Box>
  );
}

function BBBEndpointCard({ endpoint, status }) {
  const rawClassification = endpoint?.raw_classification || endpoint?.prediction;
  const threshold = Number(endpoint?.threshold ?? 0.5).toFixed(2);
  const thresholdStatus = endpoint?.threshold_status === 'provisional_raw' ? 'Provisional raw' : 'Not specified';
  const calibrationStatus = endpoint?.calibration_status === 'not_frozen' ? 'Not frozen' : 'Not specified';
  return (
    <Box data-testid="admet-endpoint-gmc_mpnn_bbb" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2, bgcolor: 'background.paper' }}>
      <Stack spacing={1}>
        <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>BBB permeability · GMC-MPNN</Typography>
        {status.code !== 'available' ? <Chip variant="outlined" color={status.color} label={status.label} /> : null}
        <Typography variant="caption" color="text.secondary">Raw ensemble probability</Typography>
        <Typography variant="h5" sx={{ fontWeight: 750 }}>{formatCalibratedProbability(endpoint?.ensemble_probability)}</Typography>
        <Typography variant="body2">Raw classification at {threshold}: {rawClassification || 'Not available'}</Typography>
        <Typography variant="caption" color="text.secondary">Model disagreement / seed SD: {endpoint?.ensemble_standard_deviation ?? 'Not available'}</Typography>
        <Typography variant="caption" color="text.secondary">Threshold status: {thresholdStatus} · Calibration status: {calibrationStatus}</Typography>
        {endpoint?.warning || endpoint?.error_message ? <Alert severity="warning">{endpoint.warning || endpoint.error_message}</Alert> : null}
      </Stack>
    </Box>
  );
}

function ADMETEndpointCard({ endpointName, endpoint, status }) {
  const displayName = endpoint?.display_name || ENDPOINT_LABELS[endpointName];
  const badgeLabel = evidenceLabel(endpointName, endpoint?.evidence_status);
  const warning = endpoint?.warning;

  return (
    <Box
      data-testid={`admet-endpoint-${endpointName}`}
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        p: 2,
        bgcolor: 'background.paper',
      }}
    >
      <Stack spacing={1.25}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          justifyContent="space-between"
          alignItems={{ sm: 'flex-start' }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>
            {displayName}
          </Typography>
          <Chip
            size="small"
            variant="outlined"
            color={status.code === 'available' && endpointName === 'hia_hou' ? 'warning' : status.color}
            label={status.code === 'available' ? badgeLabel : status.label}
          />
        </Stack>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Calibrated probability
          </Typography>
          <Typography variant="h5" sx={{ fontWeight: 750, lineHeight: 1.2 }}>
            {formatCalibratedProbability(endpoint?.calibrated_probability)}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary">
          High probability represents: {endpoint?.positive_class_meaning || 'Positive-class meaning unavailable'}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Binary prediction (threshold 0.5): {formatBinaryPrediction(endpoint?.binary_prediction)}
        </Typography>
        {warning ? <Alert severity="warning">{warning}</Alert> : null}
      </Stack>
    </Box>
  );
}

export default function AdmetResultsSection({ compound }) {
  const status = compound?.admet_model_status;
  const predictions = compound?.admet_predictions;
  const hasPredictions = predictions && typeof predictions === 'object' && !Array.isArray(predictions);
  const familyStatuses = deriveAdmetFamilyStatuses(compound);

  if (status === 'not_run_invalid_molecule') {
    return (
      <Box aria-label="ADMET classification">
        <Typography variant="h2" sx={{ mb: 1.25 }}>ADMET Results</Typography>
        <Alert severity="info">
          ADMET prediction was not run because the molecule is invalid.
        </Alert>
      </Box>
    );
  }

  if (!hasPredictions && Object.values(familyStatuses).every((family) => family.code === 'not_run')) {
    return (
      <Box aria-label="ADMET classification">
        <Typography variant="h2" sx={{ mb: 1.25 }}>ADMET Results</Typography>
        <Alert severity="info">ADMET data is not available for this result.</Alert>
      </Box>
    );
  }

  return (
    <Box aria-label="ADMET classification">
      <Stack spacing={0.75} sx={{ mb: 2 }}>
        <Typography variant="h2">ADMET Results</Typography>
        <Typography variant="body2" color="text.secondary">
          Model probabilities are computational research signals, not clinical conclusions. GMC BBB is shown as a raw, uncalibrated ensemble.
        </Typography>
        {compound?.admet_warning ? <Alert severity="warning">{compound.admet_warning}</Alert> : null}
      </Stack>
      <Stack spacing={2}>
        {ADMET_GROUPS.map((group) => (
          <Box key={group.label} component="section" aria-label={`${group.label} ADMET endpoints`}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1, fontWeight: 750 }}>
              {group.label}
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
                gap: 1.5,
              }}
            >
              {group.endpoints.map((endpointKey) => {
                if (endpointKey.startsWith('bbb:')) {
                  return <BBBEndpointCard key={endpointKey} endpoint={compound?.bbb_result} status={familyStatuses.gmc_mpnn_bbb} />;
                }
                if (endpointKey.startsWith('regression:')) {
                  const endpointName = endpointKey.split(':')[1];
                  return <RegressionEndpointCard key={endpointKey} endpointName={endpointName} endpoint={compound?.admet_regression?.endpoints?.[endpointName]} status={familyStatuses.chemprop_regression} />;
                }
                return <ADMETEndpointCard key={endpointKey} endpointName={endpointKey} endpoint={predictions?.[endpointKey]} status={familyStatuses.chemberta} />;
              })}
            </Box>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}
