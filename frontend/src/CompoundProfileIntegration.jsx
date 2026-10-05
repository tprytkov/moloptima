import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Chip, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import ExperimentalNeighborhood from './ExperimentalNeighborhood.jsx';
import { buildCompoundProfileMarkdown, PROFILE_SCIENTIFIC_NOTES, resolveStructuralContext, safeProfileFilename, summarizeExperimentalContext } from './compoundProfileData.js';

async function requestJson(baseUrl, path, body, signal) {
  const response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!response.ok) throw new Error(`Local structural context unavailable (HTTP ${response.status}).`);
  return response.json();
}

function downloadText(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}

export function ProfileAvailabilityOverview({ compound, structuralContext, experimentalContext }) {
  const experimental = summarizeExperimentalContext(experimentalContext);
  const admetAvailable = Boolean(compound?.admet_predictions || compound?.admet_regression || compound?.bbb_result);
  const dockingAvailable = Boolean(compound?.docking_result && compound.docking_result.status !== 'not_requested');
  const prioritizationAvailable = Boolean(compound?.prioritization || compound?.prioritization_v2 || compound?.priority_score !== undefined);
  return <Paper variant="outlined" sx={{ p: 2 }} aria-label="Compound profile overview"><Stack spacing={1.5}>
    <Stack direction="row" useFlexGap flexWrap="wrap" spacing={1}>
      <Chip label={`Calculated · ${compound?.mw !== undefined ? 'Available' : 'Descriptors not available'}`} />
      <Chip label={`Predicted · ${admetAvailable ? 'ADMET available' : 'Predictions not available'}`} />
      <Chip label={`Docking · ${dockingAvailable ? 'Result available' : 'No docking result available'}`} />
      <Chip label={`Prioritization · ${prioritizationAvailable ? 'Result available' : 'Prioritization result not available'}`} />
      <Chip label={`Structural context · ${structuralContext.status === 'available' ? 'Available' : 'Loading or unavailable'}`} />
      <Chip label={`Experimental — known analog · ${experimental.status === 'not_run' ? 'Search not run' : experimental.status}`} />
      <Chip label={`Matched pair · ${experimental.selectedMmp ? (experimental.selectedMmp.matched_pair ? 'Yes' : 'No under current policy') : 'Not analyzed'}`} />
    </Stack>
    <Typography variant="body2" color="text.secondary">Availability labels report whether evidence exists; they are not quality judgments. Missing evidence is not negative evidence.</Typography>
  </Stack></Paper>;
}

export function StructuralContextSection({ context, loading, error }) {
  return <Box component="section" aria-label="Structural Context"><Stack spacing={1.5}>
    <Box><Typography variant="overline">Calculated</Typography><Typography variant="h2">Structural Context</Typography></Box>
    <Alert severity="info">Murcko scaffold membership is descriptive. Local similarities use query-relative ECFP4/Tanimoto; 2D projection distance is visualization only.</Alert>
    {loading ? <Typography>Loading cached local structural context…</Typography> : null}
    {error ? <Alert severity="warning">{error} The rest of the compound profile remains available.</Alert> : null}
    {!loading && !error && !context.scaffold ? <Alert severity="info">No Murcko scaffold context is available for this molecule.</Alert> : null}
    {context.scaffold ? <Paper variant="outlined" sx={{ p: 1.5 }}><Typography fontWeight={700}>{context.scaffold.acyclic ? 'Acyclic structure' : context.scaffold.scaffoldId}</Typography><Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{context.scaffold.scaffoldSmiles || 'No ring scaffold'}</Typography><Typography variant="caption">Collection group size: {context.scaffold.memberCount}</Typography></Paper> : null}
    {context.neighbors?.length ? <Box sx={{ overflowX: 'auto' }}><Table size="small" aria-label="Local ECFP4 structural neighbors"><TableHead><TableRow><TableCell>Local molecule</TableCell><TableCell>Source</TableCell><TableCell align="right">ECFP4/Tanimoto</TableCell></TableRow></TableHead><TableBody>{context.neighbors.map((neighbor) => <TableRow key={`${neighbor.molecule_id}-${neighbor.source_index}`}><TableCell sx={{ overflowWrap: 'anywhere' }}>{neighbor.display_name || neighbor.molecule_id}</TableCell><TableCell sx={{ overflowWrap: 'anywhere' }}>{neighbor.source_filename || neighbor.source_type || 'Imported collection'}</TableCell><TableCell align="right">{Number(neighbor.similarity).toFixed(3)}</TableCell></TableRow>)}</TableBody></Table></Box> : <Alert severity="info">No other local molecules are available as structural neighbors.</Alert>}
  </Stack></Box>;
}

export default function CompoundProfileIntegration({ compound, upload, baseUrl = 'http://localhost:8000', children }) {
  const [structuralState, setStructuralState] = useState({ loading: false, error: '', context: { status: 'not_available', scaffold: null, neighbors: [] } });
  const [experimentalContext, setExperimentalContext] = useState({ searchStatus: 'not_run' });
  const stableIdentity = `${upload?.upload_id || ''}:${compound?.molecule_id || ''}`;
  const handleExperimentalChange = useCallback((context) => setExperimentalContext(context), []);

  useEffect(() => {
    setExperimentalContext({ searchStatus: 'not_run', contextIdentity: stableIdentity });
    if (!upload?.upload_id || !compound?.molecule_id) {
      setStructuralState({ loading: false, error: 'Structural context requires the current imported collection.', context: { status: 'not_available', scaffold: null, neighbors: [] } });
      return undefined;
    }
    const controller = new AbortController();
    setStructuralState({ loading: true, error: '', context: { status: 'not_available', scaffold: null, neighbors: [] } });
    Promise.allSettled([
      requestJson(baseUrl, '/api/chemical-space/scaffolds', { upload_id: upload.upload_id }, controller.signal),
      requestJson(baseUrl, '/api/chemical-space/neighbors', { upload_id: upload.upload_id, query_molecule_id: compound.molecule_id, top_k: 10 }, controller.signal),
    ]).then(([scaffolds, neighbors]) => {
      if (controller.signal.aborted) return;
      const scaffoldPayload = scaffolds.status === 'fulfilled' ? scaffolds.value : null;
      const neighborPayload = neighbors.status === 'fulfilled' ? neighbors.value : null;
      const failures = [scaffolds, neighbors].filter((result) => result.status === 'rejected');
      setStructuralState({ loading: false, error: failures.length === 2 ? failures[0].reason.message : '', context: resolveStructuralContext(scaffoldPayload, neighborPayload, compound.molecule_id) });
    });
    return () => controller.abort();
  }, [baseUrl, compound?.molecule_id, stableIdentity, upload?.upload_id]);

  const markdown = useMemo(() => buildCompoundProfileMarkdown(compound, structuralState.context, experimentalContext), [compound, experimentalContext, structuralState.context]);
  return <Stack spacing={3}>
    <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={1.5} alignItems={{ md: 'flex-start' }}>
      <ProfileAvailabilityOverview compound={compound} structuralContext={structuralState.context} experimentalContext={experimentalContext} />
      <Button variant="outlined" startIcon={<DownloadOutlinedIcon />} aria-label="Download integrated compound profile as Markdown report" onClick={() => downloadText(markdown, safeProfileFilename(compound?.molecule_id))}>Download Profile Markdown</Button>
    </Stack>
    {children}
    <StructuralContextSection context={structuralState.context} loading={structuralState.loading} error={structuralState.error} />
    <Box component="section" aria-label="Experimental Analog Context"><Box sx={{ mb: 1 }}><Typography variant="overline">Experimental — known analog</Typography><Typography variant="h2">Experimental Analog Context</Typography></Box><ExperimentalNeighborhood key={stableIdentity} upload={upload} queryMolecule={{ ...compound, display_name: compound?.original_molecule_id || compound?.molecule_id }} baseUrl={baseUrl} onContextChange={handleExperimentalChange} /></Box>
    <Box component="section" aria-label="Scientific interpretation notes"><Typography variant="h2" gutterBottom>Scientific interpretation notes</Typography><Stack spacing={0.75}>{PROFILE_SCIENTIFIC_NOTES.map((note) => <Alert key={note} severity="info">{note}</Alert>)}</Stack></Box>
    <Box component="section" aria-label="Profile provenance"><Typography variant="overline">Provenance</Typography><Typography variant="h2">Evidence ownership and provenance</Typography><Typography variant="body2">Selected-compound calculated, predicted, docking, and prioritization results retain the MolOptima molecule ID <strong>{compound?.molecule_id}</strong>. ChEMBL measurements retain the external known-compound ID and are never copied into selected-compound property fields.</Typography></Box>
  </Stack>;
}
