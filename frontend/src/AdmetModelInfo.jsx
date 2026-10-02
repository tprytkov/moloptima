import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import {
  formatAdmetMetadataLabel,
  formatAdmetRuntimeIdentity,
  formatAdmetThreshold,
} from './admetModelMetadata.js';

function InfoRow({ label, value }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="flex-start">
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="caption" sx={{ fontWeight: 700, textAlign: 'right', overflowWrap: 'anywhere' }}>{value}</Typography>
    </Stack>
  );
}

export default function AdmetModelInfo({ metadata, label = 'Model info', compact = false }) {
  if (!metadata) return null;
  const classification = metadata.predictionType !== 'regression';
  return (
    <Box
      component="details"
      sx={{
        mt: compact ? 0.25 : 0.5,
        '& > summary': { cursor: 'pointer', color: 'primary.main', fontSize: '0.75rem', fontWeight: 700 },
      }}
    >
      <Box component="summary" aria-label={`${label} for ${metadata.endpointKey}`}>{label}</Box>
      <Stack spacing={0.45} sx={{ mt: 0.75, p: 1, minWidth: 220, maxWidth: 340, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
        <InfoRow label="Model family" value={metadata.modelFamilyLabel} />
        <InfoRow label="Model" value={metadata.modelName} />
        <InfoRow label="Prediction type" value={formatAdmetMetadataLabel(metadata.predictionType)} />
        <InfoRow label="Model version" value={metadata.modelVersion} />
        <InfoRow label="Runtime identity" value={formatAdmetRuntimeIdentity(metadata.runtimeIdentity)} />
        <InfoRow label="Ensemble" value={metadata.ensembleSize ? `${metadata.ensembleSize} members` : null} />
        <InfoRow label="Decision threshold" value={formatAdmetThreshold(metadata.threshold)} />
        <InfoRow label="Threshold status" value={formatAdmetMetadataLabel(metadata.thresholdStatus)} />
        <InfoRow label="Calibration method" value={formatAdmetMetadataLabel(metadata.calibrationMethod)} />
        <InfoRow label="Calibration status" value={formatAdmetMetadataLabel(metadata.calibrationStatus)} />
        <InfoRow label="Status" value={metadata.status?.label} />
        {classification ? (
          <Typography variant="caption" color="text.secondary">
            Probability is not confidence, uncertainty, or applicability domain.
          </Typography>
        ) : null}
      </Stack>
    </Box>
  );
}
