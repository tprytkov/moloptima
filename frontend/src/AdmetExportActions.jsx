import React, { useMemo, useState } from 'react';
import { Alert, Button, Stack } from '@mui/material';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import { resolveAdmetComparisonMolecules } from './admetComparison.js';
import { sortAdmetMolecules } from './admetAnalysisData.js';
import {
  admetExportFilename,
  buildAdmetReport,
  buildComparisonCsv,
  buildComparisonReport,
  buildFilteredAdmetCsv,
} from './admetExport.js';

export function downloadAdmetText(text, filename, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function AdmetExportActions({
  mode = 'filtered',
  molecules = [],
  allMolecules = molecules,
  selectedIds = [],
  viewState = {},
}) {
  const [message, setMessage] = useState('');
  const exportTimestamp = () => new Date();
  const sorted = useMemo(
    () => sortAdmetMolecules(molecules, viewState.sortKey, viewState.sortDirection),
    [molecules, viewState.sortDirection, viewState.sortKey],
  );
  const selected = useMemo(
    () => resolveAdmetComparisonMolecules(allMolecules, selectedIds).map(({ molecule }) => molecule).filter(Boolean),
    [allMolecules, selectedIds],
  );
  const comparisonReady = selected.length >= 2 && selected.length <= 5;
  const context = (date) => ({
    exportTimestamp: date.toISOString(),
    totalMolecules: allMolecules.length,
    query: viewState.query || '',
    filters: viewState.filters,
  });

  function exportFilteredCsv() {
    const date = exportTimestamp();
    downloadAdmetText(buildFilteredAdmetCsv(sorted, context(date)), admetExportFilename('filtered', 'csv', date), 'text/csv;charset=utf-8');
    setMessage(`Filtered CSV prepared for ${sorted.length.toLocaleString()} matching molecule${sorted.length === 1 ? '' : 's'}.`);
  }

  function exportFilteredReport() {
    const date = exportTimestamp();
    downloadAdmetText(buildAdmetReport(sorted, context(date), selected), admetExportFilename('report', 'md', date), 'text/markdown;charset=utf-8');
    setMessage(`ADMET report prepared for ${sorted.length.toLocaleString()} matching molecule${sorted.length === 1 ? '' : 's'}.`);
  }

  function exportComparisonCsv() {
    const date = exportTimestamp();
    downloadAdmetText(buildComparisonCsv(allMolecules, selectedIds), admetExportFilename('comparison', 'csv', date), 'text/csv;charset=utf-8');
    setMessage(`Comparison CSV prepared for ${selected.length} compounds.`);
  }

  function exportComparisonReport() {
    const date = exportTimestamp();
    downloadAdmetText(buildComparisonReport(allMolecules, selectedIds, context(date)), admetExportFilename('comparison_report', 'md', date), 'text/markdown;charset=utf-8');
    setMessage(`Comparison report prepared for ${selected.length} compounds.`);
  }

  if (mode === 'comparison') {
    return (
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          <Button variant="outlined" startIcon={<DownloadOutlinedIcon />} disabled={!comparisonReady} onClick={exportComparisonCsv} aria-label="Export current ADMET comparison as CSV">Export comparison</Button>
          <Button variant="outlined" startIcon={<DescriptionOutlinedIcon />} disabled={!comparisonReady} onClick={exportComparisonReport} aria-label="Generate current ADMET comparison report">Generate comparison report</Button>
        </Stack>
        {!comparisonReady ? <Alert severity="info">Select 2–5 available compounds to enable comparison exports.</Alert> : null}
        {message ? <Alert severity="success" aria-live="polite">{message}</Alert> : null}
      </Stack>
    );
  }
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
        <Button variant="outlined" startIcon={<DownloadOutlinedIcon />} disabled={!sorted.length} onClick={exportFilteredCsv} aria-label="Export all currently filtered ADMET rows as CSV">Export filtered CSV</Button>
        <Button variant="outlined" startIcon={<DescriptionOutlinedIcon />} disabled={!sorted.length} onClick={exportFilteredReport} aria-label="Generate ADMET analysis report for current filters">Generate report</Button>
      </Stack>
      {!sorted.length ? <Alert severity="info">No matching molecules are available to export.</Alert> : null}
      {message ? <Alert severity="success" aria-live="polite">{message}</Alert> : null}
    </Stack>
  );
}
