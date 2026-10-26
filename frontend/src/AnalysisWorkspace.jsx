import React from 'react';
import { Stack } from '@mui/material';
import ModuleConfigurationSummary from './ModuleConfigurationSummary.jsx';

export function persistedAnalysisProfileContext(result = {}, job = {}) {
  const profile = result.prioritization_profile || job.prioritization_profile || null;
  const method = result.prioritization_method || job.prioritization_method || '';
  const profileSha256 = result.prioritization_profile_sha256 || job.prioritization_profile_sha256 || '';
  return {
    profile,
    profileSha256,
    scoreable: Boolean(profile && method === 'v2' && profileSha256),
  };
}

export function analysisWorkspaceSummary({ job = {}, result = {}, openedHistorical = false } = {}) {
  const rows = Array.isArray(result.results) ? result.results : [];
  return {
    status: rows.length ? 'Ready' : 'Not run',
    items: [
      { label: 'Calculation', value: openedHistorical ? 'Opened saved calculation' : 'Current calculation' },
      { label: 'Candidate scope', value: `${rows.length} candidates in this calculation` },
      { label: 'Prioritization Method', value: result.prioritization_method === 'v2' ? 'Multi-Parameter Prioritization' : 'Standard Prioritization' },
      { label: 'Available analyses', value: result.prioritization_method === 'v2' ? 'Pareto · Sensitivity' : 'Requires Multi-Parameter Prioritization' },
    ],
  };
}

export default function AnalysisWorkspace({ job, result, openedHistorical = false, children }) {
  const summary = analysisWorkspaceSummary({ job, result, openedHistorical });
  return (
    <Stack spacing={2} component="section" aria-label="Analysis scientific workspace">
      <ModuleConfigurationSummary title="Analysis" status={summary.status} items={summary.items} />
      {children}
    </Stack>
  );
}
