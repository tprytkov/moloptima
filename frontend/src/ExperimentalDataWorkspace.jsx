import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, FormControl, InputLabel, Link, MenuItem,
  Paper, Select, Stack, Tab, Table, TableBody, TableCell, TableContainer, TableHead,
  TablePagination, TableRow, Tabs, TextField, Typography,
} from '@mui/material';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import ExperimentalNeighborhood from './ExperimentalNeighborhood.jsx';
import ModuleConfigurationSummary from './ModuleConfigurationSummary.jsx';

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

function hasValue(value) {
  return value !== null && value !== undefined && value !== '';
}

function isTrueValue(value) {
  return value === true || String(value).trim().toLowerCase() === 'true';
}

function present(value, fallback = 'Not available') {
  if (!hasValue(value)) return fallback;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value).replaceAll('_', ' ');
}

export function evidenceState(status, available = false) {
  if (available) return 'Available';
  const normalized = String(status || '').toLowerCase();
  if (!normalized || normalized === 'not_requested' || normalized === 'not_used') return 'Not run';
  if (normalized.includes('running') || normalized.includes('loading') || normalized.includes('queued')) return 'Running';
  if (normalized.includes('partial') || normalized.includes('warning')) return 'Partial';
  if (normalized.includes('failed') || normalized.includes('error')) return 'Failed';
  if (normalized.startsWith('no_') || normalized === 'no_match') return 'No matching records';
  if (normalized.includes('invalid') || normalized.includes('unavailable')) return 'Unavailable';
  if (normalized.includes('found') || normalized.includes('match') || normalized.includes('loaded') || normalized.includes('available') || normalized.includes('success') || normalized.includes('complete')) return 'Available';
  return present(status);
}

function stateColor(state) {
  if (state === 'Available') return 'success';
  if (state === 'Partial') return 'warning';
  if (state === 'Failed') return 'error';
  if (state === 'No matching records' || state === 'Running') return 'info';
  return 'default';
}

function SourceSection({ title, status, description, children }) {
  return (
    <Paper variant="outlined" component="section" sx={{ p: 2, minWidth: 0 }}>
      <Stack spacing={1.25}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={0.75} alignItems={{ sm: 'flex-start' }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h2">{title}</Typography>
            <Typography variant="body2" color="text.secondary">{description}</Typography>
          </Box>
          <Chip label={status} color={stateColor(status)} variant={status === 'Available' ? 'filled' : 'outlined'} />
        </Stack>
        {children}
      </Stack>
    </Paper>
  );
}

function DefinitionGrid({ rows, label }) {
  return (
    <Box component="dl" aria-label={label} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 1.25, m: 0 }}>
      {rows.map(([term, value]) => (
        <Box key={term} sx={{ minWidth: 0 }}>
          <Typography component="dt" variant="caption" color="text.secondary">{term}</Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0, overflowWrap: 'anywhere' }}>{present(value)}</Typography>
        </Box>
      ))}
    </Box>
  );
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

export function calculationEvidenceAvailability(row = {}, targetReferences = {}) {
  const exactAvailable = isTrueValue(row.pubchem_exact_match) || isTrueValue(row.chembl_exact_match);
  const analogAvailable = isTrueValue(row.chembl_similarity_match);
  const targetAvailable = Number(row.target_reference_count ?? targetReferences.reference_count ?? 0) > 0;
  const patentAvailable = isTrueValue(row.patent_public_evidence_match);
  return {
    exact: evidenceState(row.pubchem_lookup_status || row.chembl_lookup_status, exactAvailable),
    analog: evidenceState(row.chembl_similarity_status || row.chembl_lookup_status, analogAvailable),
    target: evidenceState(row.target_reference_status || targetReferences.lookup_status, targetAvailable),
    patent: evidenceState(row.patent_lookup_status, patentAvailable),
  };
}

function CandidateEvidence({ row, targetReferences = {}, targetContext = {} }) {
  const availability = calculationEvidenceAvailability(row, targetReferences);
  const patentUrl = safeExternalUrl(row.patent_top_record_url);
  const similarity = hasValue(row.chembl_similarity_score) ? row.chembl_similarity_score : 'Not available';
  const targetReferenceRows = Array.isArray(targetReferences.references) ? targetReferences.references.slice(0, 10) : [];
  return (
    <Stack spacing={2}>
      <Alert severity="info">
        Exact-compound evidence and analog evidence are separate. Analog measurements belong to the related compound; structural similarity does not establish equivalent biological activity.
      </Alert>
      <SourceSection
        title="Exact Compound Evidence"
        status={availability.exact}
        description="Persisted exact-identity context from this calculation. PubChem metadata is compound identity context; ChEMBL counts summarize public bioactivity records."
      >
        <DefinitionGrid label="Exact compound evidence details" rows={[
          ['PubChem status', evidenceState(row.pubchem_lookup_status, isTrueValue(row.pubchem_exact_match))],
          ['PubChem exact match', isTrueValue(row.pubchem_exact_match)],
          ['PubChem preferred name', row.pubchem_preferred_name],
          ['PubChem CID', row.pubchem_cid],
          ['ChEMBL status', evidenceState(row.chembl_lookup_status, isTrueValue(row.chembl_exact_match))],
          ['ChEMBL exact match', isTrueValue(row.chembl_exact_match)],
          ['ChEMBL compound', row.chembl_pref_name || row.chembl_molecule_id],
          ['ChEMBL activity records', row.chembl_activity_count],
          ['ChEMBL represented targets', row.chembl_target_count],
          ['ChEMBL target summary', row.chembl_target_summary],
        ]} />
      </SourceSection>

      <SourceSection
        title="Analog Evidence"
        status={availability.analog}
        description="A structural-neighbor result only. Any activity belongs to the ChEMBL analog, not to the selected MolOptima molecule."
      >
        <DefinitionGrid label="Analog evidence details" rows={[
          ['Analog lookup status', evidenceState(row.chembl_similarity_status, isTrueValue(row.chembl_similarity_match))],
          ['Related ChEMBL compound', row.chembl_similarity_pref_name || row.chembl_similarity_molecule_id],
          ['Authoritative similarity', similarity],
          ['Similarity meaning', 'Structural similarity only; not biological equivalence'],
        ]} />
      </SourceSection>

      <SourceSection
        title="Target / Reference Evidence"
        status={availability.target}
        description="Target-active reference context produced by the calculation. Nearest-reference activity is not assigned to the selected molecule."
      >
        <DefinitionGrid label="Target and reference evidence details" rows={[
          ['Target Context', targetContext.target_name || targetReferences.resolved_target_name],
          ['Target gene', targetContext.target_gene_symbol],
          ['Target organism', targetContext.organism],
          ['Reference source', row.target_reference_source || targetReferences.source],
          ['Reference count', row.target_reference_count ?? targetReferences.reference_count],
          ['Nearest reference', row.nearest_active_compound_name || row.nearest_active_reference_id],
          ['Structural similarity to nearest reference', row.nearest_active_similarity],
          ['Reference activity', hasValue(row.nearest_active_activity_value)
            ? `${row.nearest_active_activity_type || 'Activity'} ${row.nearest_active_activity_value}${row.nearest_active_activity_units ? ` ${row.nearest_active_activity_units}` : ''}`
            : null],
        ]} />
        {targetReferenceRows.length ? (
          <TableContainer sx={{ maxHeight: 360, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
            <Table stickyHeader size="small" aria-label="Persisted target reference records" sx={{ minWidth: 760 }}>
              <TableHead><TableRow><TableCell>Reference compound</TableCell><TableCell>Target</TableCell><TableCell>Activity</TableCell><TableCell>Source</TableCell></TableRow></TableHead>
              <TableBody>{targetReferenceRows.map((reference, index) => <TableRow key={reference.reference_id || index}>
                <TableCell>{reference.compound_name || reference.reference_id || 'Not available'}</TableCell>
                <TableCell>{reference.target_name || reference.target_chembl_id || 'Not available'}</TableCell>
                <TableCell>{hasValue(reference.activity_value) ? `${reference.activity_type || 'Activity'} ${reference.activity_value}${reference.activity_units ? ` ${reference.activity_units}` : ''}` : 'Not available'}</TableCell>
                <TableCell>{reference.reference_source || 'Not available'}</TableCell>
              </TableRow>)}</TableBody>
            </Table>
          </TableContainer>
        ) : null}
      </SourceSection>

      <SourceSection
        title="Patent Evidence"
        status={availability.patent}
        description="Patent-associated occurrence is IP context, not experimental validation, demonstrated target activity, novelty, or freedom-to-operate."
      >
        <DefinitionGrid label="Patent evidence details" rows={[
          ['Lookup status', evidenceState(row.patent_lookup_status, isTrueValue(row.patent_public_evidence_match))],
          ['Source', row.patent_source],
          ['Returned records', row.patent_record_count],
          ['Top record', row.patent_top_record_title || row.patent_top_record_id],
        ]} />
        {patentUrl ? <Link href={patentUrl} target="_blank" rel="noopener noreferrer">Open top patent record in {row.patent_source || 'the source database'}</Link> : null}
      </SourceSection>

      <Box component="details" sx={{ '& > summary': { cursor: 'pointer' } }}>
        <Box component="summary" sx={{ fontWeight: 700, color: 'text.secondary', mb: 1 }}>Scientific provenance and identifiers</Box>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <DefinitionGrid label="Scientific provenance and identifiers" rows={[
            ['Molecule ID', row.molecule_id],
            ['Canonical SMILES', row.canonical_smiles],
            ['PubChem cache status', row.pubchem_cache_status],
            ['PubChem warning', row.pubchem_warning],
            ['ChEMBL molecule ID', row.chembl_molecule_id],
            ['ChEMBL analog molecule ID', row.chembl_similarity_molecule_id],
            ['ChEMBL cache status', row.chembl_cache_status],
            ['ChEMBL warning', row.chembl_warning],
            ['Patent record ID', row.patent_top_record_id],
            ['Patent query identifier', row.patent_query_identifier],
            ['Patent cache status', row.patent_cache_status],
            ['Patent warning', row.patent_warning],
            ['Target ChEMBL ID', targetContext.target_chembl_id || targetReferences.resolved_target_chembl_id],
            ['Target-reference cache status', targetReferences.cache_status],
            ['Target-reference warning', targetReferences.warning],
          ]} />
        </Paper>
      </Box>
    </Stack>
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

export default function ExperimentalDataWorkspace({
  upload,
  activeJob = null,
  calculationResult = null,
  targetContext = {},
  openedHistorical = false,
  baseUrl = 'http://localhost:8000',
  initialPayload = null,
  initialTab = 0,
  initialWorkspaceTab = 0,
}) {
  const [workspaceTab, setWorkspaceTab] = useState(initialWorkspaceTab);
  const [measurementTab, setMeasurementTab] = useState(initialTab);
  const [selectedMoleculeId, setSelectedMoleculeId] = useState('');
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
  const calculationRows = useMemo(
    () => (Array.isArray(calculationResult?.results) ? calculationResult.results : []),
    [calculationResult?.results],
  );
  const selectableRows = useMemo(
    () => calculationRows.filter((row) => row?.valid_molecule !== false && row?.molecule_id),
    [calculationRows],
  );
  const selectedRow = selectableRows.find((row) => row.molecule_id === selectedMoleculeId) || selectableRows[0] || null;
  const targetReferences = calculationResult?.target_references ?? {};
  const persistedTargetContext = Object.fromEntries([
    'target_name', 'target_gene_symbol', 'target_uniprot_id', 'target_chembl_id', 'organism',
  ].map((key) => [key, calculationResult?.[key] ?? activeJob?.[key] ?? targetContext?.[key] ?? '']));
  const hasActiveCalculation = Boolean(activeJob?.job_id);
  const selectedAvailability = selectedRow ? calculationEvidenceAvailability(selectedRow, targetReferences) : null;

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
      setPayload(response); setRecords(response.measurements ?? []); setFilteredCount(response.record_counts?.measurements ?? 0); setMeasurementTab(1);
    } catch (finalizeError) { setError(finalizeError.message); } finally { setLoading(false); }
  }

  return (
    <Stack spacing={2} sx={{ width: '100%', maxWidth: 1440, mx: 'auto', minWidth: 0 }}>
      <Paper elevation={0} sx={{ p: { xs: 2.5, md: 3 }, border: '1px solid', borderColor: 'divider' }}>
        <Stack spacing={1.25} sx={{ maxWidth: 860 }}>
          <Typography variant="h1">Experimental Data</Typography>
          <Typography color="text.secondary">
            Inspect persisted public evidence and source-preserving assay measurements without combining exact, analog, patent, target-reference, or computational evidence into a single score.
          </Typography>
        </Stack>
      </Paper>

      <ModuleConfigurationSummary
        title="Experimental Data"
        status={hasActiveCalculation ? (calculationRows.length ? 'Available' : present(activeJob?.status, 'Not available')) : 'No active calculation'}
        items={[
          { label: 'Calculation Context', value: hasActiveCalculation ? (openedHistorical ? 'Opened saved calculation' : 'Current calculation') : 'Not selected' },
          { label: 'Molecule Scope', value: calculationRows.length ? `${calculationRows.length} candidates in this calculation` : 'Not available' },
          { label: 'Target Context', value: persistedTargetContext.target_name || 'Not configured' },
          { label: 'Imported Dataset', value: datasetId ? 'Finalized' : payload?.status === 'preview' ? 'Validation preview' : 'Not loaded' },
        ]}
      />

      <Paper variant="outlined" component="section" aria-labelledby="experimental-evidence-availability" sx={{ p: 2, minWidth: 0 }}>
        <Stack spacing={1.25}>
          <Box>
            <Typography id="experimental-evidence-availability" variant="h2">Evidence Availability</Typography>
            <Typography variant="body2" color="text.secondary">Statuses describe persisted source results for the selected candidate. No matching records is not a negative experimental result.</Typography>
          </Box>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            <Chip label={`Imported measurements: ${datasetId ? 'Available' : payload?.status === 'preview' ? 'Preview' : 'Not loaded'}`} color={datasetId ? 'success' : 'default'} variant={datasetId ? 'filled' : 'outlined'} />
            <Chip label={`Exact compound: ${selectedAvailability?.exact || 'Not available'}`} color={stateColor(selectedAvailability?.exact)} variant="outlined" />
            <Chip label={`Analog: ${selectedAvailability?.analog || 'Not available'}`} color={stateColor(selectedAvailability?.analog)} variant="outlined" />
            <Chip label={`Target / reference: ${selectedAvailability?.target || 'Not available'}`} color={stateColor(selectedAvailability?.target)} variant="outlined" />
            <Chip label={`Patent context: ${selectedAvailability?.patent || 'Not available'}`} color={stateColor(selectedAvailability?.patent)} variant="outlined" />
          </Stack>
        </Stack>
      </Paper>

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', minWidth: 0 }}>
        <Tabs value={workspaceTab} onChange={(_event, next) => setWorkspaceTab(next)} aria-label="Experimental Data workspace sections" variant="scrollable" scrollButtons="auto" sx={{ px: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Tab label="Calculation Evidence" />
          <Tab label="Imported Measurements" />
          <Tab label="External ChEMBL" />
        </Tabs>

        {workspaceTab === 0 ? <Stack spacing={2} sx={{ p: { xs: 2, md: 3 } }}>
          {!hasActiveCalculation ? <Alert severity="info">No active calculation. Open a previous calculation or run a new calculation to inspect its persisted public evidence.</Alert> : null}
          {hasActiveCalculation && !calculationRows.length ? <Alert severity="info">This calculation has no persisted candidate evidence to inspect. Evidence was not inferred or refreshed.</Alert> : null}
          {selectedRow ? <>
            <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={1.5} alignItems={{ md: 'center' }}>
              <Box sx={{ minWidth: 0 }}><Typography variant="h2">Persisted Calculation Evidence</Typography><Typography variant="body2" color="text.secondary">Read-only evidence returned with this calculation. Pipeline-owned sources are not rerun from this workspace.</Typography></Box>
              <FormControl size="small" sx={{ width: { xs: '100%', md: 320 }, flexShrink: 0 }}>
                <InputLabel id="experimental-candidate-label">Candidate</InputLabel>
                <Select labelId="experimental-candidate-label" label="Candidate" value={selectedRow.molecule_id} onChange={(event) => setSelectedMoleculeId(event.target.value)}>
                  {selectableRows.map((row) => <MenuItem key={row.molecule_id} value={row.molecule_id}>{row.original_molecule_id || row.display_name || row.molecule_id}</MenuItem>)}
                </Select>
              </FormControl>
            </Stack>
            <CandidateEvidence row={selectedRow} targetReferences={targetReferences} targetContext={persistedTargetContext} />
          </> : null}
        </Stack> : null}

        {workspaceTab === 1 ? <Stack spacing={2.25} sx={{ p: { xs: 2, md: 3 } }}>
          <Alert severity="info">Imported experimental measurements remain separate from predicted ADMET, docking, ranking, and public-neighbor context. Censored values remain censored, and unsupported records are never silently converted.</Alert>
          <Tabs value={measurementTab} onChange={(_event, next) => setMeasurementTab(next)} aria-label="Imported measurement views" variant="scrollable" scrollButtons="auto"><Tab label="Import & Validate" /><Tab label="Measurements" /></Tabs>
          {measurementTab === 0 ? <Stack spacing={2.25}>
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
          </Stack> : <Stack spacing={2}>
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
        </Stack> : null}

        {workspaceTab === 2 ? <Stack spacing={2} sx={{ p: { xs: 2, md: 3 } }}>
          <Box><Typography variant="h2">External ChEMBL Evidence</Typography><Typography variant="body2" color="text.secondary">This is the only independently executable public-evidence lookup currently supported here. It is molecule-scoped and does not modify persisted calculation evidence.</Typography></Box>
          {!hasActiveCalculation ? <Alert severity="info">Select an active calculation before starting a molecule-scoped ChEMBL search.</Alert> : null}
          {hasActiveCalculation && !selectedRow ? <Alert severity="info">No valid molecule is available for Experimental Neighborhood.</Alert> : null}
          {selectedRow ? <>
            <FormControl size="small" sx={{ width: { xs: '100%', md: 360 } }}>
              <InputLabel id="experimental-neighborhood-candidate-label">Query molecule</InputLabel>
              <Select labelId="experimental-neighborhood-candidate-label" label="Query molecule" value={selectedRow.molecule_id} onChange={(event) => setSelectedMoleculeId(event.target.value)}>
                {selectableRows.map((row) => <MenuItem key={row.molecule_id} value={row.molecule_id}>{row.original_molecule_id || row.display_name || row.molecule_id}</MenuItem>)}
              </Select>
            </FormControl>
            <ExperimentalNeighborhood
              upload={upload}
              queryMolecule={{
                molecule_id: selectedRow.molecule_id,
                display_name: selectedRow.original_molecule_id || selectedRow.display_name || selectedRow.molecule_id,
                canonical_smiles: selectedRow.canonical_smiles,
              }}
              baseUrl={baseUrl}
            />
          </> : null}
        </Stack> : null}
      </Paper>
    </Stack>
  );
}
