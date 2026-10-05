import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, FormControl, InputLabel, Link,
  MenuItem, Paper, Select, Stack, Tab, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Tabs, TextField, Typography,
} from '@mui/material';

const PAGE_SIZE = 25;
const EMPTY_MMP_MAP = new Map();
const SCIENTIFIC_NOTE = 'Experimental measurements shown here belong to known reference compounds, not to the selected MolOptima compound. Structural similarity provides context but does not establish equivalent biological activity.';

async function postJson(baseUrl, path, body, offlineMessage = 'ChEMBL is unreachable; check the network connection.') {
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  } catch (cause) {
    const error = new Error(offlineMessage);
    error.code = 'offline';
    error.cause = cause;
    throw error;
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const detail = payload.detail;
    const error = new Error(typeof detail === 'object' ? detail.message : detail || `Request failed (${response.status}).`);
    error.code = typeof detail === 'object' ? detail.code : 'request_failed';
    throw error;
  }
  return response.json();
}

export function filterExperimentalRecords(records, filters) {
  const query = filters.query.trim().toLowerCase();
  return records.filter((record) => {
    const target = record.target || {};
    if (filters.target && (target.name || target.identifier || 'Unknown target') !== filters.target) return false;
    if (filters.endpoint && record.endpoint_name !== filters.endpoint) return false;
    if (filters.assayType && (record.assay_type || 'Unavailable') !== filters.assayType) return false;
    if (filters.organism && (target.organism || 'Unavailable') !== filters.organism) return false;
    if (filters.source && record.source !== filters.source) return false;
    if (!query) return true;
    return [record.source_record_id, record.endpoint_name, target.identifier, target.name, record.assay_id, record.publication_reference]
      .some((value) => String(value || '').toLowerCase().includes(query));
  });
}

function unique(records, getter) {
  return [...new Set(records.map(getter).filter(Boolean))].sort();
}

function structureUrl(baseUrl, smiles, width = 280, height = 190) {
  return `${baseUrl}/api/molecules/structure?${new URLSearchParams({ smiles, width: String(width), height: String(height) })}`;
}

function StructureCard({ baseUrl, label, name, smiles, nameVariant = 'h3' }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, minWidth: 0, flex: 1 }}>
      <Typography variant="overline">{label}</Typography>
      <Typography variant={nameVariant} sx={{ overflowWrap: 'anywhere' }}>{name}</Typography>
      {smiles ? <Box component="img" src={structureUrl(baseUrl, smiles)} alt={`2D structure for ${name}`} sx={{ width: '100%', maxWidth: 280, bgcolor: '#fff', border: '1px solid', borderColor: 'divider', borderRadius: 1 }} /> : null}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>{smiles || 'Structure unavailable'}</Typography>
    </Paper>
  );
}

function failureMessage(code, message) {
  const labels = {
    offline: 'ChEMBL is offline or unreachable. Local MolOptima analysis remains available.',
    timeout: 'The ChEMBL request timed out. Local data was not changed.',
    rate_limited: 'ChEMBL rate limited the request. Retry later or use a cached result.',
    source_unavailable: 'ChEMBL is temporarily unavailable. Local data was not changed.',
    malformed_source_response: 'ChEMBL returned a malformed response that MolOptima excluded safely.',
  };
  return labels[code] || message;
}

export function KnownAnalogTable({ analogs, selectedId, onSelect, sortMode, mmpById = EMPTY_MMP_MAP, mmpLoading = false }) {
  const ordered = useMemo(() => [...analogs].sort((left, right) => {
    if (sortMode === 'records') return (right.experimental_record_count || 0) - (left.experimental_record_count || 0) || left.source_compound_id.localeCompare(right.source_compound_id);
    if (sortMode === 'targets') return (right.target_count || 0) - (left.target_count || 0) || left.source_compound_id.localeCompare(right.source_compound_id);
    if (sortMode === 'source_id') return left.source_compound_id.localeCompare(right.source_compound_id);
    return right.moloptima_tanimoto - left.moloptima_tanimoto || left.source_compound_id.localeCompare(right.source_compound_id);
  }), [analogs, sortMode]);
  return (
    <TableContainer sx={{ maxHeight: 520 }}>
      <Table stickyHeader size="small" aria-label="Known experimentally characterized analogs">
        <TableHead><TableRow><TableCell>Known compound</TableCell><TableCell align="right">MolOptima Tanimoto</TableCell><TableCell>Same Murcko scaffold</TableCell><TableCell>Matched pair</TableCell><TableCell align="right">Records</TableCell><TableCell align="right">Targets</TableCell><TableCell /></TableRow></TableHead>
        <TableBody>{ordered.map((analog) => <TableRow key={analog.source_compound_id} selected={analog.source_compound_id === selectedId}>
          <TableCell><Typography variant="body2" fontWeight={700}>{analog.preferred_name || analog.source_compound_id}</Typography><Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>{analog.source_compound_id}</Typography></TableCell>
          <TableCell align="right">{analog.moloptima_tanimoto.toFixed(3)}</TableCell>
          <TableCell>{analog.same_murcko_scaffold}</TableCell>
          <TableCell>{mmpLoading ? 'Analyzing…' : mmpById.has(analog.source_compound_id) ? (mmpById.get(analog.source_compound_id).matched_pair ? 'Yes' : 'No') : 'Not analyzed'}</TableCell>
          <TableCell align="right">{analog.experimental_record_count ?? 'Load'}</TableCell>
          <TableCell align="right">{analog.target_count ?? 'Load'}</TableCell>
          <TableCell><Button size="small" variant={analog.source_compound_id === selectedId ? 'contained' : 'outlined'} onClick={() => onSelect(analog)}>Inspect records</Button></TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </TableContainer>
  );
}

export function StructuralTransformation({ analysis, baseUrl }) {
  if (!analysis) return <Alert severity="info">Structural transformation analysis is not available for this reference.</Alert>;
  if (!analysis.matched_pair) return <Alert severity="info">Matched molecular pair: No under {analysis.policy_version}. Reason: {String(analysis.reason || 'no accepted relationship').replaceAll('_', ' ')}. Tanimoto and scaffold context remain independent.</Alert>;
  return <Paper variant="outlined" sx={{ p: 2 }} aria-label="Structural Transformation"><Stack spacing={1.5}>
    <Box><Typography variant="overline">Matched Molecular Pair</Typography><Typography variant="h3">Structural Transformation</Typography></Box>
    <Alert severity="info">This is a structural substituent relationship, not a reaction, activity trend, or transfer of experimental evidence.</Alert>
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
      <StructureCard baseUrl={baseUrl} label="Shared core" name="Core with mapped attachment" smiles={analysis.shared_core.canonical_smiles} nameVariant="h5" />
      <StructureCard baseUrl={baseUrl} label="Selected compound substituent" name="Query fragment" smiles={analysis.query_fragment.canonical_smiles} nameVariant="h5" />
      <StructureCard baseUrl={baseUrl} label="Known analog substituent" name="Reference fragment" smiles={analysis.reference_fragment.canonical_smiles} nameVariant="h5" />
    </Stack>
    <Typography fontWeight={700}>{analysis.transformation.display}</Typography>
    <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>Canonical direction: {analysis.transformation.query_to_reference}</Typography>
    <Stack direction="row" useFlexGap flexWrap="wrap" spacing={1}>
      <Chip label={`Tanimoto: ${analysis.relationship?.tanimoto?.toFixed(3) ?? 'Unavailable'}`} />
      <Chip label={`Murcko scaffold: ${analysis.relationship?.murcko_scaffold_relationship || 'Unavailable'}`} />
      <Chip label={`Policy: ${analysis.policy_version}`} />
      <Chip label={`RDKit: ${analysis.provenance?.rdkit_version || 'Unavailable'}`} />
    </Stack>
    <Typography variant="caption" color="text.secondary">Attachment label {analysis.transformation.attachment_label} marks the corresponding connection point; it does not describe a synthetic reaction.</Typography>
  </Stack></Paper>;
}

export function ExperimentalRecordTable({ records }) {
  return (
    <TableContainer sx={{ maxHeight: 560 }}><Table stickyHeader size="small" aria-label="Known analog experimental records"><TableHead><TableRow><TableCell>Target</TableCell><TableCell>Assay</TableCell><TableCell>Endpoint</TableCell><TableCell>Experimental value</TableCell><TableCell>Normalized pEndpoint</TableCell><TableCell>Compatibility</TableCell><TableCell>Provenance</TableCell></TableRow></TableHead><TableBody>{records.map((record) => <TableRow key={record.measurement_id}><TableCell>{record.target?.name || record.target?.identifier || 'Unavailable'}<Typography variant="caption" display="block">{record.target?.organism || 'Organism unavailable'}</Typography></TableCell><TableCell>{record.assay_id || 'Unavailable'}<Typography variant="caption" display="block">{record.assay_type || 'Type unavailable'}</Typography></TableCell><TableCell>{record.endpoint_name || 'Unavailable'}</TableCell><TableCell><strong>{record.relation || 'relation unavailable'} {record.original_value ?? 'value unavailable'} {record.original_unit || ''}</strong>{record.quality_flags?.includes('censored_value') ? <Chip size="small" label="Censored" sx={{ ml: 0.5 }} /> : null}</TableCell><TableCell>{record.normalization?.status === 'normalized' ? `${record.normalization.transformed_relation} ${Number(record.normalization.transformed_value).toFixed(3)} ${record.normalization.transformed_endpoint}` : 'Not converted'}</TableCell><TableCell>{record.compatibility?.label}</TableCell><TableCell><Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>{record.source} · {record.source_record_id}<br />{record.publication_reference || 'No publication ID supplied'}<br />Retrieved {record.provenance?.retrieved_at}</Typography></TableCell></TableRow>)}</TableBody></Table></TableContainer>
  );
}

export default function ExperimentalNeighborhood({ upload, queryMolecule, baseUrl = 'http://localhost:8000', onContextChange = () => {} }) {
  const [view, setView] = useState(0);
  const [maxAnalogs, setMaxAnalogs] = useState(25);
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState(null);
  const [error, setError] = useState(null);
  const [sortMode, setSortMode] = useState('similarity');
  const [selectedAnalog, setSelectedAnalog] = useState(null);
  const [recordsPayload, setRecordsPayload] = useState(null);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [mmpPayload, setMmpPayload] = useState(null);
  const [mmpLoading, setMmpLoading] = useState(false);
  const [mmpError, setMmpError] = useState('');
  const [filters, setFilters] = useState({ query: '', target: '', endpoint: '', assayType: '', organism: '', source: '' });
  const [page, setPage] = useState(0);
  const deferredQuery = useDeferredValue(filters.query);
  const requestIdentityRef = useRef(0);
  const mmpRequestIdentityRef = useRef(0);
  const contextIdentity = `${upload?.upload_id || ''}:${queryMolecule?.molecule_id || ''}`;

  useEffect(() => {
    requestIdentityRef.current += 1;
    mmpRequestIdentityRef.current += 1;
    setView(0); setSearchResult(null); setSelectedAnalog(null); setRecordsPayload(null); setMmpPayload(null); setError(null); setMmpError('');
    setSearching(false); setRecordsLoading(false); setMmpLoading(false); setPage(0);
  }, [contextIdentity]);

  useEffect(() => {
    onContextChange({
      contextIdentity, searchResult, selectedAnalog, recordsPayload, mmpPayload,
      searchStatus: searching ? 'searching' : error ? (error.code === 'offline' ? 'offline' : 'failed') : searchResult ? 'completed' : 'not_run',
    });
  }, [contextIdentity, error, mmpPayload, onContextChange, recordsPayload, searchResult, searching, selectedAnalog]);

  async function analyzeKnownPairs(payload) {
    const known = [...(payload.exact_matches || []), ...(payload.analogs || [])];
    if (!known.length) { setMmpPayload({ results: [], candidate_count: 0, matched_pair_count: 0 }); return; }
    const requestIdentity = ++mmpRequestIdentityRef.current;
    setMmpLoading(true); setMmpError('');
    try {
      const analysis = await postJson(baseUrl, '/api/matched-pairs/analyze-batch', {
        query: { id: queryMolecule.molecule_id, source: 'moloptima', smiles: queryMolecule.canonical_smiles },
        references: known.map((analog) => ({ id: analog.source_compound_id, source: 'chembl', smiles: analog.canonical_smiles })),
      }, 'The local structural transformation endpoint is unreachable.');
      if (requestIdentity === mmpRequestIdentityRef.current) setMmpPayload(analysis);
    } catch (caught) {
      if (requestIdentity === mmpRequestIdentityRef.current) setMmpError(caught.message);
    } finally { if (requestIdentity === mmpRequestIdentityRef.current) setMmpLoading(false); }
  }

  async function runSearch(refresh = false) {
    if (!upload?.upload_id || !queryMolecule?.molecule_id) return;
    const requestIdentity = ++requestIdentityRef.current;
    mmpRequestIdentityRef.current += 1;
    setSearching(true); setError(null); setMmpError(''); setMmpPayload(null); setSelectedAnalog(null); setRecordsPayload(null); setView(0);
    try {
      const payload = await postJson(baseUrl, '/api/experimental-neighborhood/search', {
        upload_id: upload.upload_id, molecule_id: queryMolecule.molecule_id,
        source: 'chembl', max_analogs: maxAnalogs, refresh,
      });
      if (requestIdentity !== requestIdentityRef.current) return;
      setSearchResult(payload);
      void analyzeKnownPairs(payload);
    } catch (caught) {
      if (requestIdentity !== requestIdentityRef.current) return;
      setError({ code: caught.code, message: failureMessage(caught.code, caught.message) });
    } finally { if (requestIdentity === requestIdentityRef.current) setSearching(false); }
  }

  async function inspectAnalog(analog, refresh = false) {
    const requestIdentity = ++requestIdentityRef.current;
    setSelectedAnalog(analog); setView(1); setRecordsLoading(true); setError(null); setPage(0);
    try {
      const payload = await postJson(baseUrl, '/api/experimental-neighborhood/records', {
        source: 'chembl', source_compound_id: analog.source_compound_id, limit: 500, refresh,
      });
      if (requestIdentity !== requestIdentityRef.current) return;
      setRecordsPayload(payload);
      const counts = { experimental_record_count: payload.source_total_count, target_count: payload.targets.length, counts_status: payload.truncated ? 'bounded_record_retrieval' : 'records_retrieved' };
      setSelectedAnalog((current) => current ? { ...current, ...counts } : current);
      setSearchResult((current) => current ? {
        ...current,
        exact_matches: current.exact_matches.map((item) => item.source_compound_id === analog.source_compound_id ? { ...item, ...counts } : item),
        analogs: current.analogs.map((item) => item.source_compound_id === analog.source_compound_id ? { ...item, ...counts } : item),
      } : current);
    } catch (caught) {
      if (requestIdentity !== requestIdentityRef.current) return;
      setRecordsPayload(null);
      setError({ code: caught.code, message: failureMessage(caught.code, caught.message) });
    } finally { if (requestIdentity === requestIdentityRef.current) setRecordsLoading(false); }
  }

  const records = recordsPayload?.records || [];
  const filterValues = useMemo(() => ({
    targets: unique(records, (record) => record.target?.name || record.target?.identifier || 'Unknown target'),
    endpoints: unique(records, (record) => record.endpoint_name),
    assayTypes: unique(records, (record) => record.assay_type || 'Unavailable'),
    organisms: unique(records, (record) => record.target?.organism || 'Unavailable'),
    sources: unique(records, (record) => record.source),
  }), [records]);
  const filteredRecords = useMemo(() => filterExperimentalRecords(records, { ...filters, query: deferredQuery }), [deferredQuery, filters, records]);
  const pageCount = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE));
  const visibleRecords = filteredRecords.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const allKnown = searchResult ? [...(searchResult.exact_matches || []), ...(searchResult.analogs || [])] : [];
  const mmpById = useMemo(() => new Map((mmpPayload?.results || []).map((result) => [result.reference.id, result])), [mmpPayload]);
  const selectedMmp = selectedAnalog ? mmpById.get(selectedAnalog.source_compound_id) : null;
  const analogsWithRecords = allKnown.filter((analog) => Number(analog.experimental_record_count) > 0).length;
  const representedTargets = new Set(records.map((record) => record.target?.identifier || record.target?.name).filter(Boolean)).size;
  const sameScaffoldCount = allKnown.filter((analog) => ['yes', 'same scaffold', 'no ring scaffold'].includes(String(analog.same_murcko_scaffold).toLowerCase())).length;
  const highestSimilarity = allKnown.length ? Math.max(...allKnown.map((analog) => Number(analog.moloptima_tanimoto) || 0)).toFixed(3) : 'Not available';

  if (!queryMolecule) return <Alert severity="info">Select a molecule on the Chemical Space map, then open Experimental Neighborhood.</Alert>;
  return (
    <Stack spacing={2} data-testid="experimental-neighborhood">
      <Box>
        <Typography variant="h2">Experimental Neighborhood</Typography>
        <Typography color="text.secondary">Search ChEMBL explicitly for the selected structure and experimentally characterized structural neighbors. No neighbor measurement is assigned to the selected molecule.</Typography>
      </Box>
      <Alert severity="warning">{SCIENTIFIC_NOTE}</Alert>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}><Typography variant="overline">Selected MolOptima compound</Typography><Typography variant="h3">{queryMolecule.display_name || queryMolecule.molecule_id}</Typography><Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{queryMolecule.canonical_smiles}</Typography><Typography variant="caption">ID: {queryMolecule.molecule_id} · no experimental value is assigned by this search</Typography></Box>
          <FormControl size="small" sx={{ minWidth: 150 }}><InputLabel id="analog-limit-label">Known analogs</InputLabel><Select labelId="analog-limit-label" label="Known analogs" value={maxAnalogs} onChange={(event) => setMaxAnalogs(Number(event.target.value))}>{[10, 25, 50].map((value) => <MenuItem key={value} value={value}>Top {value}</MenuItem>)}</Select></FormControl>
          <Button variant="contained" disabled={searching || !upload?.upload_id} onClick={() => runSearch(false)}>Find experimental analogs</Button>
          {searchResult ? <Button variant="outlined" disabled={searching} onClick={() => runSearch(true)}>Refresh source</Button> : null}
        </Stack>
      </Paper>
      {!upload?.upload_id ? <Alert severity="info">Experimental analog search requires the current upload identity. Local profile evidence remains available.</Alert> : null}
      {searching ? <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={22} /><Typography>Searching ChEMBL by structure…</Typography></Stack> : null}
      {error ? <Alert severity="error"><strong>{error.code || 'Search unavailable'}:</strong> {error.message}</Alert> : null}
      {searchResult ? <>
        <Alert severity={searchResult.exact_match ? 'success' : 'info'}>{searchResult.exact_match ? `Exact structure match found in ChEMBL (${searchResult.exact_matches.length}).` : 'No exact structure match found in the searched database.'}</Alert>
        <Paper variant="outlined" sx={{ p: 1.5 }} aria-label="Experimental Neighborhood summary">
          <Typography variant="h3" gutterBottom>Experimental Neighborhood summary</Typography>
          <Stack direction="row" useFlexGap flexWrap="wrap" spacing={1}>
            <Chip label={`Exact ChEMBL match: ${searchResult.exact_match ? 'Yes' : 'No'}`} />
            <Chip label={`Structural neighbors: ${searchResult.analogs.length}`} />
            <Chip label={`Highest retrieved Tanimoto: ${highestSimilarity}`} />
            <Chip label={`Same-scaffold neighbors: ${sameScaffoldCount}`} />
            <Chip label={`Matched pairs: ${mmpLoading ? 'Analyzing…' : mmpPayload?.matched_pair_count ?? 'Not analyzed'}`} />
            <Chip label={`Analogs with loaded records: ${analogsWithRecords}`} />
            <Chip label={`Targets in selected records: ${representedTargets}`} />
          </Stack>
        </Paper>
        {mmpError ? <Alert severity="warning">Structural transformation analysis is unavailable: {mmpError}. The ChEMBL search result remains available.</Alert> : null}
        {!allKnown.length ? <Alert severity="info">ChEMBL returned no exact matches or structural analogs for this bounded query.</Alert> : null}
        <Tabs value={view} onChange={(_, value) => setView(value)} aria-label="Experimental Neighborhood views"><Tab label="Known Analogs" /><Tab label="Experimental Records" /></Tabs>
        {view === 0 ? <Stack spacing={1.5}>
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1}><Stack direction="row" useFlexGap flexWrap="wrap" spacing={1}><Chip label={`${searchResult.exact_matches.length} exact`} /><Chip label={`${searchResult.analogs.length} structural neighbors`} /><Chip label={`Source retrieval threshold ${searchResult.search_provenance.source_query_threshold}%`} /></Stack><FormControl size="small" sx={{ minWidth: 210 }}><InputLabel id="analog-sort-label">Order analogs by</InputLabel><Select labelId="analog-sort-label" label="Order analogs by" value={sortMode} onChange={(event) => setSortMode(event.target.value)}><MenuItem value="similarity">MolOptima Tanimoto</MenuItem><MenuItem value="records">Experimental record count</MenuItem><MenuItem value="targets">Target count</MenuItem><MenuItem value="source_id">Source compound ID</MenuItem></Select></FormControl></Stack>
          <Typography variant="caption" color="text.secondary">The source threshold is only a ChEMBL retrieval parameter, not a MolOptima scientific analog cutoff. Similarities below are recalculated locally.</Typography>
          {searchResult.exact_matches.length ? <><Typography variant="h3">Exact structure matches</Typography><KnownAnalogTable analogs={searchResult.exact_matches} selectedId={selectedAnalog?.source_compound_id} onSelect={inspectAnalog} sortMode={sortMode} mmpById={mmpById} mmpLoading={mmpLoading} /></> : null}
          {searchResult.analogs.length ? <><Typography variant="h3">Structural neighbors</Typography><KnownAnalogTable analogs={searchResult.analogs} selectedId={selectedAnalog?.source_compound_id} onSelect={inspectAnalog} sortMode={sortMode} mmpById={mmpById} mmpLoading={mmpLoading} /></> : null}
        </Stack> : <Stack spacing={2}>
          {!selectedAnalog ? <Alert severity="info">Choose a known compound in Known Analogs to retrieve its assay-level experimental records.</Alert> : null}
          {recordsLoading ? <Stack direction="row" spacing={1}><CircularProgress size={22} /><Typography>Retrieving assay-level records…</Typography></Stack> : null}
          {selectedAnalog ? <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}><StructureCard baseUrl={baseUrl} label="Selected MolOptima compound · no assigned experimental activity" name={queryMolecule.display_name || queryMolecule.molecule_id} smiles={queryMolecule.canonical_smiles} /><StructureCard baseUrl={baseUrl} label="Known reference compound · experimental records below" name={selectedAnalog.preferred_name || selectedAnalog.source_compound_id} smiles={selectedAnalog.canonical_smiles} /></Stack> : null}
          {selectedAnalog ? <TableContainer><Table size="small" aria-label="Selected compound and known analog comparison"><TableHead><TableRow><TableCell>Attribute</TableCell><TableCell>Selected MolOptima compound</TableCell><TableCell>Known reference analog</TableCell></TableRow></TableHead><TableBody>
            {[
              ['Evidence ownership', 'Calculated/predicted/computational evidence belongs to selected compound', 'Experimental measurements belong to external known analog'],
              ['Identifier', queryMolecule.molecule_id, selectedAnalog.source_compound_id],
              ['Query-relative Tanimoto', '1.0 to self', selectedAnalog.moloptima_tanimoto?.toFixed(3) || 'Unavailable'],
              ['Murcko scaffold relationship', 'Selected scaffold', selectedAnalog.same_murcko_scaffold || 'Unavailable'],
              ['Matched molecular pair', 'Query under versioned structural policy', mmpLoading ? 'Analyzing…' : selectedMmp ? (selectedMmp.matched_pair ? 'Yes' : `No · ${String(selectedMmp.reason).replaceAll('_', ' ')}`) : 'Not analyzed'],
              ['Predicted ADMET', 'See selected-compound profile', 'Not computed by this workflow'],
              ['Experimental measurements', 'None assigned by Experimental Neighborhood', recordsPayload ? `${recordsPayload.returned_count} known-analog records loaded` : 'Not retrieved'],
              ['Docking', 'See selected-compound profile', 'Not computed by this workflow'],
            ].map(([attribute, selectedValue, analogValue]) => <TableRow key={attribute}><TableCell>{attribute}</TableCell><TableCell>{selectedValue}</TableCell><TableCell>{analogValue}</TableCell></TableRow>)}
          </TableBody></Table></TableContainer> : null}
          {selectedAnalog ? <StructuralTransformation analysis={selectedMmp} baseUrl={baseUrl} /> : null}
          {recordsPayload ? <>
            <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap flexWrap="wrap" spacing={1}><Chip label={`${recordsPayload.returned_count} records loaded`} /><Chip label={`${recordsPayload.targets.length} targets`} /><Chip label={`${recordsPayload.normalization_summary.normalized} normalized`} /><Chip label={`${recordsPayload.normalization_summary.censored} censored`} />{recordsPayload.truncated ? <Chip color="warning" label={`Bounded result · ${recordsPayload.source_total_count} source records`} /> : null}</Stack>
            {!records.length ? <Alert severity="info">This known compound has no experimental records in the bounded ChEMBL response.</Alert> : null}
            {records.length ? <>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} useFlexGap flexWrap="wrap">
                <TextField size="small" label="Search records" value={filters.query} onChange={(event) => { setFilters((current) => ({ ...current, query: event.target.value })); setPage(0); }} />
                {[['target', 'Target', filterValues.targets], ['endpoint', 'Endpoint', filterValues.endpoints], ['assayType', 'Assay type', filterValues.assayTypes], ['organism', 'Organism', filterValues.organisms], ['source', 'Source', filterValues.sources]].map(([key, label, options]) => <FormControl key={key} size="small" sx={{ minWidth: 150 }}><InputLabel id={`${key}-filter-label`}>{label}</InputLabel><Select labelId={`${key}-filter-label`} label={label} value={filters[key]} onChange={(event) => { setFilters((current) => ({ ...current, [key]: event.target.value })); setPage(0); }}><MenuItem value="">All</MenuItem>{options.map((option) => <MenuItem key={option} value={option}>{option}</MenuItem>)}</Select></FormControl>)}
              </Stack>
              <ExperimentalRecordTable records={visibleRecords} />
              <Stack direction="row" justifyContent="space-between" alignItems="center"><Button size="small" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Previous</Button><Typography variant="caption">Records {filteredRecords.length ? page * PAGE_SIZE + 1 : 0}–{Math.min((page + 1) * PAGE_SIZE, filteredRecords.length)} of {filteredRecords.length} · page {page + 1} of {pageCount}</Typography><Button size="small" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</Button></Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}><Button component={Link} href={`${baseUrl}/api/experimental-neighborhood/records/export.csv?${new URLSearchParams({ source: 'chembl', source_compound_id: selectedAnalog.source_compound_id })}`} variant="outlined" download>Prepare CSV for Experimental Data import</Button><Typography variant="caption" color="text.secondary">This does not persist records. Import the known analog into the molecule collection before using Batch 10B structure linkage.</Typography></Stack>
            </> : null}
          </> : null}
        </Stack>}
        <Typography variant="caption" color="text.secondary">Source: {searchResult.search_provenance.source} · retrieved {searchResult.search_provenance.retrieved_at} · cache {searchResult.search_provenance.cache_status} · {searchResult.search_provenance.fingerprint} · {searchResult.search_provenance.similarity_metric}</Typography>
      </> : null}
    </Stack>
  );
}
