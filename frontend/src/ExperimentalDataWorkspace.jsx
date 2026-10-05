import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, FormControl, InputLabel, MenuItem,
  Paper, Select, Stack, Tab, Table, TableBody, TableCell, TableHead, TablePagination,
  TableRow, Tabs, TextField, Typography,
} from '@mui/material';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';

const PAGE_SIZE = 25;

export function formatOriginalMeasurement(record) {
  const relation = String(record?.relation || '=');
  const value = record?.original_value ?? record?.original_value_text ?? '—';
  const unit = record?.original_unit || '';
  return `${relation} ${value}${unit ? ` ${unit}` : ''}`;
}

export function formatNormalizedMeasurement(record) {
  const normalization = record?.normalization ?? {};
  if (normalization.status !== 'normalized') return 'Not converted';
  return `${record.relation || '='} ${Number(normalization.normalized_value_molar).toExponential(4)} M`;
}

export function formatTransformedMeasurement(record) {
  const normalization = record?.normalization ?? {};
  if (normalization.status !== 'normalized') return 'Not applicable';
  return `${normalization.transformed_endpoint} ${normalization.transformed_relation} ${Number(normalization.transformed_value).toFixed(4)}`;
}

export function qualityFlagLabel(flag) {
  return String(flag || '').replaceAll('_', ' ');
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const payload = await response.json();
      detail = payload.detail || detail;
    } catch {
      // Keep the HTTP fallback when the backend did not return JSON.
    }
    throw new Error(detail);
  }
  return response.json();
}

function SummaryCards({ summary }) {
  const cards = [
    ['Rows', summary?.row_count], ['Valid', summary?.valid_measurements],
    ['Invalid', summary?.invalid_measurements], ['Linked', summary?.linked_molecules],
    ['Unmatched', summary?.unmatched_molecules], ['Ambiguous', summary?.ambiguous_links],
    ['Censored', summary?.censored_values], ['Unit problems', summary?.unit_problems],
  ];
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 1 }}>
      {cards.map(([label, value]) => <Box key={label} sx={{ p: 1.25, bgcolor: '#f7f9fb', borderRadius: 1 }}>
        <Typography variant="caption" color="text.secondary">{label}</Typography>
        <Typography sx={{ fontWeight: 750, fontSize: 18 }}>{Number(value || 0).toLocaleString()}</Typography>
      </Box>)}
    </Box>
  );
}

export function MeasurementTable({ records, showValidation = false }) {
  if (!records?.length) return <Alert severity="info">No measurements match the current view.</Alert>;
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small" aria-label="Experimental measurements" sx={{ minWidth: 1320 }}>
        <TableHead><TableRow>
          <TableCell>Molecule</TableCell><TableCell>Endpoint</TableCell><TableCell>Original measurement</TableCell>
          <TableCell>Normalized molar</TableCell><TableCell>pEndpoint</TableCell><TableCell>Target</TableCell>
          <TableCell>Assay</TableCell><TableCell>Linkage</TableCell><TableCell>Source / record</TableCell>
          <TableCell>Quality flags</TableCell>{showValidation ? <TableCell>Validation</TableCell> : null}
        </TableRow></TableHead>
        <TableBody>{records.map((record) => {
          const target = record.target ?? {};
          const linkage = record.linkage ?? {};
          const isCensored = record.relation && record.relation !== '=';
          return <TableRow key={record.measurement_id} sx={{ verticalAlign: 'top' }}>
            <TableCell>{record.molecule_id || 'Unlinked'}</TableCell>
            <TableCell>{record.endpoint_name || record.endpoint_id}</TableCell>
            <TableCell><Stack direction="row" spacing={0.5} alignItems="center">
              <Typography component="span" sx={{ fontWeight: isCensored ? 750 : 500 }}>{formatOriginalMeasurement(record)}</Typography>
              {isCensored ? <Chip label="Censored" color="warning" variant="outlined" /> : null}
            </Stack></TableCell>
            <TableCell>{formatNormalizedMeasurement(record)}</TableCell>
            <TableCell>{formatTransformedMeasurement(record)}</TableCell>
            <TableCell>{target.name || target.identifier || 'Not supplied'}</TableCell>
            <TableCell>{record.assay_id || 'Not supplied'}</TableCell>
            <TableCell><Chip label={linkage.status || 'unknown'} color={linkage.status === 'linked' ? 'success' : linkage.status === 'ambiguous' ? 'warning' : 'default'} variant="outlined" /></TableCell>
            <TableCell>{record.source || '—'} / {record.source_record_id || '—'}</TableCell>
            <TableCell sx={{ minWidth: 220 }}><Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
              {(record.quality_flags ?? []).map((flag) => <Chip key={flag} label={qualityFlagLabel(flag)} variant="outlined" />)}
            </Stack></TableCell>
            {showValidation ? <TableCell sx={{ minWidth: 220 }}>
              <Chip label={record.validation_status} color={record.validation_status === 'valid' ? 'success' : 'error'} />
              {record.validation_errors?.length ? <Typography variant="caption" display="block" color="error" sx={{ mt: 0.5 }}>{record.validation_errors.map(qualityFlagLabel).join(' · ')}</Typography> : null}
            </TableCell> : null}
          </TableRow>;
        })}</TableBody>
      </Table>
    </Box>
  );
}

export default function ExperimentalDataWorkspace({ upload, baseUrl = 'http://localhost:8000', initialPayload = null, initialTab = 0 }) {
  const [tab, setTab] = useState(initialTab);
  const [selectedFile, setSelectedFile] = useState(null);
  const [columnMapping, setColumnMapping] = useState('{}');
  const [payload, setPayload] = useState(initialPayload);
  const [records, setRecords] = useState(initialPayload?.measurements ?? []);
  const [filteredCount, setFilteredCount] = useState(initialPayload?.record_counts?.measurements ?? initialPayload?.summary?.valid_measurements ?? 0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [page, setPage] = useState(0);
  const deferredQuery = useDeferredValue(query);
  const datasetId = payload?.status === 'finalized' ? payload.experimental_dataset_id : '';
  const endpointOptions = useMemo(() => Object.keys(payload?.summary?.endpoint_counts ?? {}).sort(), [payload?.summary?.endpoint_counts]);

  useEffect(() => {
    if (!datasetId) return undefined;
    const controller = new AbortController();
    const parameters = new URLSearchParams({ query: deferredQuery, endpoint, offset: String(page * PAGE_SIZE), limit: String(PAGE_SIZE) });
    requestJson(`${baseUrl}/api/experimental-data/${datasetId}/measurements?${parameters}`, { signal: controller.signal })
      .then((response) => { setRecords(response.measurements ?? []); setFilteredCount(response.filtered_count ?? 0); })
      .catch((requestError) => { if (requestError.name !== 'AbortError') setError(requestError.message); });
    return () => controller.abort();
  }, [baseUrl, datasetId, deferredQuery, endpoint, page]);

  async function handlePreview() {
    if (!upload?.upload_id) return setError('Load a molecule collection before importing experimental measurements.');
    if (!selectedFile) return setError('Choose a CSV or TSV measurement file.');
    try {
      const parsedMapping = JSON.parse(columnMapping || '{}');
      if (!parsedMapping || Array.isArray(parsedMapping) || typeof parsedMapping !== 'object') throw new TypeError('Column mapping must be a JSON object.');
      const form = new FormData();
      form.append('file', selectedFile); form.append('upload_id', upload.upload_id); form.append('column_mapping', JSON.stringify(parsedMapping));
      setLoading(true); setError('');
      const response = await requestJson(`${baseUrl}/api/experimental-data/previews`, { method: 'POST', body: form });
      setPayload(response); setRecords(response.measurements ?? []); setFilteredCount(response.summary?.valid_measurements ?? 0);
    } catch (previewError) {
      setError(previewError instanceof SyntaxError ? 'Column mapping must be valid JSON.' : previewError.message);
    } finally { setLoading(false); }
  }

  async function handleFinalize() {
    if (!payload?.preview_id) return;
    try {
      setLoading(true); setError('');
      const response = await requestJson(`${baseUrl}/api/experimental-data/previews/${payload.preview_id}/finalize`, { method: 'POST' });
      setPayload(response); setRecords(response.measurements ?? []); setFilteredCount(response.record_counts?.measurements ?? 0); setTab(1);
    } catch (finalizeError) { setError(finalizeError.message); } finally { setLoading(false); }
  }

  return (
    <Stack spacing={2.5} sx={{ width: '100%', maxWidth: 1440, mx: 'auto' }}>
      <Box><Typography variant="h1">Experimental Data</Typography><Typography color="text.secondary" sx={{ mt: 0.5 }}>
        Import and inspect source-preserving experimental measurements. This workspace does not calculate SAR conclusions, rankings, or prediction comparisons.
      </Typography></Box>
      <Alert severity="info">Experimental measurements are stored separately from predicted ADMET results. Censored values remain censored, and unsupported records are never silently converted.</Alert>
      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
        <Tabs value={tab} onChange={(_event, next) => setTab(next)} aria-label="Experimental Data views" sx={{ px: 2, borderBottom: '1px solid', borderColor: 'divider' }}><Tab label="Import" /><Tab label="Measurements" /></Tabs>
        {tab === 0 ? <Stack spacing={2.25} sx={{ p: 3 }}>
          <Box><Typography variant="h2">Import experimental measurements</Typography><Typography color="text.secondary">Linked molecule collection: {upload?.upload_id ? `${Number(upload.valid_count || 0).toLocaleString()} valid molecules` : 'None loaded'}</Typography></Box>
          <Button component="label" aria-label="Choose experimental CSV or TSV" variant="outlined" startIcon={<UploadFileOutlinedIcon />} sx={{ alignSelf: 'flex-start' }}>Choose CSV / TSV<input hidden type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} /></Button>
          <Typography variant="body2">{selectedFile ? selectedFile.name : 'No measurement file selected'}</Typography>
          <TextField label="Optional column mapping (JSON)" value={columnMapping} onChange={(event) => setColumnMapping(event.target.value)} multiline minRows={2} helperText={'Use logical-to-source mappings only when headers are nonstandard, for example {"endpoint":"activity_type","value":"result"}.'} />
          <Box><Button variant="contained" disabled={loading || !upload?.upload_id || !selectedFile} onClick={handlePreview} startIcon={loading ? <CircularProgress size={17} color="inherit" /> : null}>Preview and validate</Button></Box>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {payload ? <Stack spacing={2}>
            <Typography variant="h2">Validation preview</Typography><SummaryCards summary={payload.summary} />
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              {(payload.summary?.supported_endpoints ?? []).map((item) => <Chip key={item} label={`Supported: ${item}`} color="success" variant="outlined" />)}
              {(payload.summary?.unsupported_endpoint_types ?? []).map((item) => <Chip key={item} label={`Unsupported: ${item}`} color="warning" variant="outlined" />)}
            </Stack>
            <MeasurementTable records={payload.measurements ?? []} showValidation />
            {payload.status === 'preview' ? <Box><Button variant="contained" color="success" disabled={loading || !payload.summary?.valid_measurements} onClick={handleFinalize}>Finalize versioned dataset</Button></Box> : <Alert severity="success">Dataset finalized without replacing prior experimental datasets.</Alert>}
          </Stack> : null}
        </Stack> : <Stack spacing={2} sx={{ p: 3 }}>
          {!datasetId ? <Alert severity="info">Finalize an import to inspect stored measurements.</Alert> : <>
            <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={1.5}><Box><Typography variant="h2">Experimental measurements</Typography><Typography color="text.secondary">Dataset {datasetId} · schema {payload.schema_version}</Typography></Box><Button component="a" aria-label="Export normalized experimental measurements as CSV" href={`${baseUrl}/api/experimental-data/${datasetId}/export.csv`} startIcon={<DownloadOutlinedIcon />} variant="outlined">Export normalized CSV</Button></Stack>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
              <TextField label="Search measurements" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} sx={{ minWidth: 280 }} />
              <FormControl sx={{ minWidth: 200 }} size="small"><InputLabel id="experimental-endpoint-filter-label">Endpoint</InputLabel><Select labelId="experimental-endpoint-filter-label" value={endpoint} label="Endpoint" onChange={(event) => { setEndpoint(event.target.value); setPage(0); }}><MenuItem value="">All endpoints</MenuItem>{endpointOptions.map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</Select></FormControl>
            </Stack>
            {error ? <Alert severity="error">{error}</Alert> : null}<MeasurementTable records={records} />
            <TablePagination component="div" count={filteredCount} page={page} onPageChange={(_event, nextPage) => setPage(nextPage)} rowsPerPage={PAGE_SIZE} rowsPerPageOptions={[PAGE_SIZE]} />
            <Typography variant="caption" color="text.secondary">Experimental source values, provenance, linkage, and quality flags are shown factually. No potency threshold or ranking is applied.</Typography>
          </>}
        </Stack>}
      </Paper>
    </Stack>
  );
}
