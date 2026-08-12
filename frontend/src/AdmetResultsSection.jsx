import React from 'react';
import { Alert, Box, Chip, Stack, Typography } from '@mui/material';

export const ADMET_GROUPS = [
  {
    label: 'Absorption',
    endpoints: ['hia_hou', 'pgp_broccatelli'],
  },
  {
    label: 'Distribution',
    endpoints: ['bbb_martins'],
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

const ENDPOINT_LABELS = {
  hia_hou: 'HIA',
  pgp_broccatelli: 'P-gp inhibition',
  bbb_martins: 'BBB',
  cyp1a2_veith: 'CYP1A2 inhibition',
  cyp2c19_veith: 'CYP2C19 inhibition',
  cyp2c9_veith: 'CYP2C9 inhibition',
  cyp2d6_veith: 'CYP2D6 inhibition',
  cyp3a4_veith: 'CYP3A4 inhibition',
  herg_karim: 'hERG liability',
  ames: 'AMES mutagenicity',
};

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
  if (endpointName === 'bbb_martins') {
    return 'Experimental / Low confidence';
  }
  if (endpointName === 'hia_hou') {
    return 'Limited support';
  }
  return EVIDENCE_LABELS[evidenceStatus] ?? String(evidenceStatus || 'Evidence not specified');
}

function ADMETEndpointCard({ endpointName, endpoint }) {
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
            color={endpointName === 'bbb_martins' || endpointName === 'hia_hou' ? 'warning' : 'default'}
            label={badgeLabel}
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

  if (status === 'model_unavailable') {
    return (
      <Box aria-label="ADMET classification">
        <Typography variant="h2" sx={{ mb: 1.25 }}>ADMET Classification</Typography>
        <Alert severity="warning">
          ADMET model unavailable. {compound?.admet_warning || 'Predictions are not available for this molecule.'}
        </Alert>
      </Box>
    );
  }

  if (status === 'not_run_invalid_molecule') {
    return (
      <Box aria-label="ADMET classification">
        <Typography variant="h2" sx={{ mb: 1.25 }}>ADMET Classification</Typography>
        <Alert severity="info">
          ADMET prediction was not run because the molecule is invalid.
        </Alert>
      </Box>
    );
  }

  if (!hasPredictions) {
    return (
      <Box aria-label="ADMET classification">
        <Typography variant="h2" sx={{ mb: 1.25 }}>ADMET Classification</Typography>
        <Alert severity="info">ADMET data is not available for this result.</Alert>
      </Box>
    );
  }

  return (
    <Box aria-label="ADMET classification">
      <Stack spacing={0.75} sx={{ mb: 2 }}>
        <Typography variant="h2">ADMET Classification</Typography>
        <Typography variant="body2" color="text.secondary">
          Calibrated model probabilities are computational research signals, not clinical conclusions.
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
              {group.endpoints.map((endpointName) => (
                <ADMETEndpointCard
                  key={endpointName}
                  endpointName={endpointName}
                  endpoint={predictions[endpointName]}
                />
              ))}
            </Box>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}
