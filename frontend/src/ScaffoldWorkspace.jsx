import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Chip, Divider, Paper, Stack, TextField, Typography } from '@mui/material';
import { paginateScaffolds, searchScaffolds, summarizeScaffoldAdmet } from './scaffoldData.js';

function formatNumber(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value);
}

export default function ScaffoldWorkspace({ data, selectedScaffoldId, selectedMoleculeId, onSelectScaffold, onSelectMolecule, onViewMap, baseUrl, admetById }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [memberPage, setMemberPage] = useState(0);
  const filtered = useMemo(() => searchScaffolds(data?.scaffolds || [], query), [data, query]);
  const paged = useMemo(() => paginateScaffolds(filtered, page), [filtered, page]);
  const selected = data?.scaffolds.find((group) => group.scaffold_id === selectedScaffoldId) || null;
  const memberPageData = useMemo(() => paginateScaffolds(selected?.members || [], memberPage), [memberPage, selected]);
  const admetSummary = useMemo(() => selected ? summarizeScaffoldAdmet(selected, admetById) : [], [admetById, selected]);

  useEffect(() => { setPage(0); }, [query]);
  useEffect(() => { setMemberPage(0); }, [selectedScaffoldId]);

  return (
    <Stack spacing={1.5} data-testid="scaffold-workspace">
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={0.5}><Box><Typography variant="h2">Bemis–Murcko scaffold organization</Typography><Typography variant="caption" color="text.secondary">Descriptive organization only; no activity, potency, preference, confidence, applicability domain, or causal SAR is established.</Typography></Box><Typography variant="body2" color="text.secondary">{data.summary.scaffold_count.toLocaleString()} ring scaffolds · {data.summary.acyclic_count.toLocaleString()} no-ring molecules</Typography></Stack>
      <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(240px, 0.7fr) minmax(0, 1.6fr)' }, gap: 2 }}>
        <Stack spacing={1} component="aside" aria-label="Scaffold browser" sx={{ minWidth: 0, borderRight: { md: '1px solid' }, borderColor: { md: 'divider' }, pr: { md: 2 } }}>
          <TextField fullWidth label="Search scaffold ID or SMILES" value={query} onChange={(event) => setQuery(event.target.value)} />
          <Typography variant="caption" color="text.secondary">Showing {paged.rows.length.toLocaleString()} of {filtered.length.toLocaleString()} matching groups</Typography>
          <Stack spacing={0.5} sx={{ maxHeight: 560, overflowY: 'auto', pr: 0.5 }}>
          {paged.rows.map((group) => <Button key={group.scaffold_id} variant={group.scaffold_id === selectedScaffoldId ? 'outlined' : 'text'} aria-pressed={group.scaffold_id === selectedScaffoldId} sx={{ px: 1, py: 0.75, justifyContent: 'flex-start', textAlign: 'left', textTransform: 'none', borderColor: group.scaffold_id === selectedScaffoldId ? 'primary.main' : 'transparent' }} onClick={() => onSelectScaffold(group.scaffold_id)}>
            <Box sx={{ minWidth: 0, width: '100%' }}><Stack direction="row" justifyContent="space-between" gap={1}><Typography variant="body2" fontWeight={700}>{group.label}</Typography><Typography variant="caption" color="text.secondary">{group.member_count} members</Typography></Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>{group.scaffold_smiles || 'Acyclic / no ring scaffold'} · {group.unique_structure_count} unique</Typography></Box>
          </Button>)}
          </Stack>
          {!paged.rows.length ? <Alert severity="info">No scaffold groups match this search.</Alert> : null}
          <Stack direction="row" justifyContent="space-between" alignItems="center"><Button size="small" disabled={paged.page === 0} onClick={() => setPage((value) => value - 1)}>Previous</Button><Typography variant="caption">Page {paged.page + 1} of {paged.pageCount}</Typography><Button size="small" disabled={paged.page + 1 >= paged.pageCount} onClick={() => setPage((value) => value + 1)}>Next</Button></Stack>
        </Stack>
        {selected ? <Stack spacing={2}>
          <Box><Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1}><Box sx={{ minWidth: 0 }}><Typography variant="overline" color="text.secondary">Selected scaffold</Typography><Typography variant="h2" sx={{ overflowWrap: 'anywhere' }}>{selected.label}</Typography><Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{selected.scaffold_smiles || 'No ring scaffold (acyclic)'}</Typography><Typography variant="caption" color="text.secondary">{selected.member_count} imported members · {selected.unique_structure_count} unique canonical structures. Duplicate imports remain separate members.</Typography></Box><Button variant="outlined" sx={{ flexShrink: 0, alignSelf: 'flex-start' }} onClick={() => onViewMap(selected.scaffold_id)}>View members on map</Button></Stack>
          {selected.scaffold_smiles ? <Box component="img" src={`${baseUrl}/api/molecules/structure?${new URLSearchParams({ smiles: selected.scaffold_smiles, width: '340', height: '190' })}`} alt={`2D structure for ${selected.scaffold_id}`} sx={{ width: '100%', maxWidth: 340, height: 190, objectFit: 'contain', bgcolor: '#fff', border: '1px solid', borderColor: 'divider', borderRadius: 1, mt: 1 }} /> : null}</Box>
          <Box><Typography variant="h2" gutterBottom>Members</Typography><Stack spacing={0.25} sx={{ maxHeight: 280, overflowY: 'auto' }}>{memberPageData.rows.map((member) => <Button key={`${member.molecule_id}-${member.source_index}`} variant={member.molecule_id === selectedMoleculeId ? 'outlined' : 'text'} aria-pressed={member.molecule_id === selectedMoleculeId} sx={{ justifyContent: 'flex-start', textTransform: 'none', textAlign: 'left', py: 0.5 }} onClick={() => onSelectMolecule(member.molecule_id)}><Box sx={{ minWidth: 0 }}><Typography variant="body2" fontWeight={700}>{member.display_name || member.molecule_id}</Typography><Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>{member.canonical_smiles}</Typography><Typography variant="caption" color="text.secondary">{member.duplicate_structure ? 'Duplicate retained · ' : ''}{member.source_filename || member.source_type || 'Entered SMILES'}</Typography></Box></Button>)}</Stack><Stack direction="row" justifyContent="space-between" alignItems="center"><Button size="small" disabled={memberPageData.page === 0} onClick={() => setMemberPage((value) => value - 1)}>Previous</Button><Typography variant="caption">Members page {memberPageData.page + 1} of {memberPageData.pageCount}</Typography><Button size="small" disabled={memberPageData.page + 1 >= memberPageData.pageCount} onClick={() => setMemberPage((value) => value + 1)}>Next</Button></Stack></Box>
          <Divider />
          <Box><Typography variant="h2" gutterBottom>Descriptive ADMET summaries</Typography>{admetById.size ? <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' }, borderTop: '1px solid', borderLeft: '1px solid', borderColor: 'divider' }}>{admetSummary.map((row) => <Box key={row.key} sx={{ p: 1, borderRight: '1px solid', borderBottom: '1px solid', borderColor: 'divider' }}><Typography variant="body2" fontWeight={700}>{row.label}</Typography>{row.valueType === 'regression' ? <Typography variant="caption">{row.statistics ? `n ${row.statistics.n} · mean ${formatNumber(row.statistics.mean)} · median ${formatNumber(row.statistics.median)} · min ${formatNumber(row.statistics.min)} · max ${formatNumber(row.statistics.max)}` : 'No available values'} · unavailable {row.unavailableCount}</Typography> : <Typography variant="caption">{row.availableCount ? Object.entries(row.classCounts).map(([label, count]) => `${label} ${count}`).join(' · ') : 'No available classifications'} · unavailable {row.unavailableCount}</Typography>}</Box>)}</Box> : <Alert severity="info">Run ADMET analysis to add normalized descriptive endpoint summaries. Scaffold browsing remains available without predictions.</Alert>}</Box>
        </Stack> : <Alert severity="info">Select a scaffold group to inspect its members and descriptive summaries.</Alert>}
      </Box>
      </Paper>
    </Stack>
  );
}
