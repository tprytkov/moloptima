import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Divider, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TableSortLabel, Typography,
} from '@mui/material';
import {
  buildComparisonFigureSvg, scaffoldGroups, scaffoldRelationshipLabel,
  selectedSetFrequency, sortComparisonPoints,
} from './designLogicComparison.js';
import { formatMetric, formatMetricWithUnit } from './designLogicData.js';
import { downloadBlob, ExportControls, svgToPng } from './InteractionVisualizationPanel.jsx';
import {
  buildInteractionMapSvg, interactionPositionHints, mapInteractionRecords, MAP_HEIGHT, MAP_WIDTH,
} from './interactionVisualization.js';

function exactRelationship(point) {
  const code = point?.scaffold_relationship?.code;
  if (code === 'SAME_EXACT_MURCKO') return 'Same exact Murcko';
  if (code === 'ACYCLIC_OR_NO_MURCKO') return 'No ring scaffold';
  return code ? 'Different exact Murcko' : 'Unavailable';
}

function genericRelationship(point) {
  const code = point?.scaffold_relationship?.code;
  if (code === 'SAME_EXACT_MURCKO' || code === 'SAME_GENERIC_FRAMEWORK') return 'Same generic framework';
  if (code === 'ACYCLIC_OR_NO_MURCKO') return 'No ring scaffold';
  return code ? 'Different generic framework' : 'Unavailable';
}

function sharedCounts(point) {
  const partition = point?.token_partition || {};
  return `${partition.shared?.length || 0} / ${partition.reference_only?.length || 0} / ${partition.comparison_only?.length || 0}`;
}

function SummaryTable({ points }) {
  const [sort, setSort] = useState({ key: 'molecule_id', direction: 'asc' });
  const sorted = useMemo(() => sortComparisonPoints(points, sort.key, sort.direction), [points, sort]);
  const columns = [
    ['molecule_id', 'Molecule'], ['mode', 'Pose'], ['vina_affinity_kcal_mol', 'Vina affinity'],
    ['structural_similarity', 'Morgan Tanimoto'], ['interaction_similarity', 'Interaction Jaccard'],
    ['scaffold_relationship', 'Scaffold relationship'],
  ];
  const changeSort = (key) => setSort((current) => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' }));
  return (
    <TableContainer sx={{ border: '1px solid', borderColor: 'divider', maxWidth: '100%' }}>
      <Table size="small" aria-label="Selected molecule scientific comparison" sx={{ minWidth: 1120 }}>
        <TableHead><TableRow>{columns.map(([key, label]) => <TableCell key={key}><TableSortLabel active={sort.key === key} direction={sort.key === key ? sort.direction : 'asc'} onClick={() => changeSort(key)}>{label}</TableSortLabel></TableCell>)}<TableCell>Exact scaffold</TableCell><TableCell>Generic framework</TableCell><TableCell>Shared / reference-only / comparison-only</TableCell></TableRow></TableHead>
        <TableBody>{sorted.map((point) => <TableRow key={point.molecule_id}><TableCell>{point.molecule_id}</TableCell><TableCell>Mode {point.mode}</TableCell><TableCell>{formatMetricWithUnit(point.vina_affinity_kcal_mol, 'kcal/mol')}</TableCell><TableCell>{formatMetric(point.structural_similarity)}</TableCell><TableCell>{formatMetric(point.interaction_similarity)}</TableCell><TableCell>{scaffoldRelationshipLabel(point)}</TableCell><TableCell>{exactRelationship(point)}</TableCell><TableCell>{genericRelationship(point)}</TableCell><TableCell>{sharedCounts(point)}</TableCell></TableRow>)}</TableBody>
      </Table>
    </TableContainer>
  );
}

function ScaffoldSummary({ points }) {
  const exact = scaffoldGroups(points, 'exact_scaffold_id', 'scf_no_ring');
  const generic = scaffoldGroups(points, 'generic_framework_id', 'no_generic_framework');
  return (
    <Paper component="section" variant="outlined" sx={{ p: 1.5 }}>
      <Typography variant="h2">Scaffold organization for selected set</Typography>
      <Typography variant="caption" color="text.secondary">{exact.length} unique exact Murcko groups · {generic.length} unique generic frameworks. Structural context only; no activity or design conclusion is inferred.</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 2, mt: 1 }}>
        <Box><Typography variant="subtitle2">Exact scaffolds</Typography>{exact.map((group) => <Box key={group.id} sx={{ mt: 0.75 }}><Typography variant="caption" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>{group.id}</Typography><Typography variant="caption" display="block" color="text.secondary">{group.moleculeIds.join(' · ')}</Typography></Box>)}</Box>
        <Box><Typography variant="subtitle2">Generic frameworks</Typography>{generic.map((group) => <Box key={group.id} sx={{ mt: 0.75 }}><Typography variant="caption" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>{group.id}</Typography><Typography variant="caption" display="block" color="text.secondary">{group.moleculeIds.join(' · ')}</Typography></Box>)}</Box>
      </Box>
    </Paper>
  );
}

export default function MultiLigandComparison({ points, referenceId, baseUrl, selectedToken, onSelectToken, onFocus3d }) {
  const [depictions, setDepictions] = useState({});
  const [depictionError, setDepictionError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const reference = points.find((point) => point.molecule_id === referenceId);
    setDepictions({}); setDepictionError('');
    Promise.all(points.map(async (point) => {
      const params = { smiles: point.canonical_smiles, width: '420', height: '300' };
      if (point.molecule_id !== referenceId && point.scaffold_relationship?.code === 'SAME_EXACT_MURCKO') params.reference_smiles = reference?.canonical_smiles || '';
      const response = await fetch(`${baseUrl}/api/design-logic/depiction?${new URLSearchParams(params)}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Depiction unavailable for ${point.molecule_id} (${response.status}).`);
      return [point.molecule_id, await response.json()];
    })).then((entries) => setDepictions(Object.fromEntries(entries))).catch((error) => { if (!controller.signal.aborted) setDepictionError(error.message); });
    return () => controller.abort();
  }, [baseUrl, points, referenceId]);

  const maps = useMemo(() => {
    const reference = points.find((point) => point.molecule_id === referenceId);
    const referenceDepiction = depictions[referenceId];
    const referenceInteractions = mapInteractionRecords(reference?.fingerprint?.raw_interaction_records || [], referenceDepiction?.atom_positions || []);
    const hints = referenceDepiction ? interactionPositionHints(referenceInteractions, referenceDepiction) : {};
    return points.map((point) => {
      const depiction = depictions[point.molecule_id];
      if (!depiction) return { point, svg: '' };
      const interactions = mapInteractionRecords(point.fingerprint?.raw_interaction_records || [], depiction.atom_positions || []);
      const svg = buildInteractionMapSvg({ depiction, interactions, selectedToken, moleculeId: point.molecule_id, mode: point.mode, contextLabel: scaffoldRelationshipLabel(point), receptorId: point.visualization?.receptor_id, residuePositionHints: point.molecule_id === referenceId ? {} : hints });
      return { point, svg };
    });
  }, [depictions, points, referenceId, selectedToken]);

  const frequency = useMemo(() => selectedSetFrequency(points), [points]);
  const comparisonSvg = useMemo(() => buildComparisonFigureSvg(maps.map((map) => map.svg).filter(Boolean)), [maps]);
  const comparisonAspect = maps.length > 1 ? (2 * MAP_WIDTH) / (Math.ceil(maps.length / 2) * MAP_HEIGHT) : MAP_WIDTH / MAP_HEIGHT;
  async function exportComparison(format, options) {
    const svg = buildComparisonFigureSvg(maps.map((map) => map.svg).filter(Boolean), options);
    if (format === 'svg') downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), 'design-logic-selected-set.svg');
    else downloadBlob(await svgToPng(svg, options.width, options.height, options.transparent), `design-logic-selected-set-${options.width}x${options.height}.png`);
  }

  return (
    <Stack component="section" aria-label="Multi-ligand interaction comparison" spacing={1.5}>
      <Box><Typography variant="h2">Selected-set scientific comparison</Typography><Typography variant="caption" color="text.secondary">Morgan similarity, scaffold class, interaction Jaccard, and Vina affinity remain independent evidence. No composite score or automatic scaffold-hop claim is produced.</Typography></Box>
      <SummaryTable points={points} />
      <ScaffoldSummary points={points} />
      <Paper variant="outlined" sx={{ p: 1.5 }}><Typography variant="h2">Selected-set interaction frequency</Typography><Typography variant="caption" color="text.secondary">Descriptive frequency across the currently selected explicit docked poses only.</Typography><Stack direction="row" useFlexGap flexWrap="wrap" gap={0.75} sx={{ mt: 1 }}>{frequency.map((item) => <Chip key={item.token} variant={selectedToken === item.token ? 'filled' : 'outlined'} onClick={() => onSelectToken(item.token)} label={`${item.token} · ${item.presentCount}/${item.selectedPoseCount} · ${item.category}`} aria-label={`${item.token}, present in ${item.presentCount} of ${item.selectedPoseCount} selected poses, ${item.category}`} />)}</Stack></Paper>
      <Box><Typography variant="h2">Side-by-side 2D interaction maps</Typography><Typography variant="caption" color="text.secondary">Residue placement in the 2D interaction map is schematic and does not represent physical 3D distance. Reference features provide cross-panel position hints; readability takes priority when labels collide.</Typography></Box>
      {depictionError ? <Alert severity="warning">{depictionError}</Alert> : null}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5 }}>
        {maps.map(({ point, svg }) => <Paper key={`${point.molecule_id}-${point.mode}`} variant="outlined" sx={{ p: 1.25, minWidth: 0 }}><Stack direction="row" justifyContent="space-between" gap={1}><Box><Typography variant="subtitle2">{point.molecule_id}{point.molecule_id === referenceId ? ' · Reference' : ''}</Typography><Typography variant="caption" color="text.secondary">Mode {point.mode} · {scaffoldRelationshipLabel(point)}</Typography></Box><Button size="small" variant="outlined" onClick={() => onFocus3d(point.molecule_id)} aria-label={`Focus ${point.molecule_id} mode ${point.mode} in 3D`}>Focus in 3D</Button></Stack>{svg ? <Box data-testid={`comparison-map-${point.molecule_id}`} aria-label={`2D interaction diagram for ${point.molecule_id}, Vina mode ${point.mode}`} onClick={(event) => { const token = event.target.closest?.('[data-token]')?.getAttribute('data-token'); if (token) onSelectToken(token); }} sx={{ overflowX: 'auto', '& > svg': { width: '100%', minWidth: 620, height: 'auto', display: 'block' } }} dangerouslySetInnerHTML={{ __html: svg }} /> : <Typography variant="caption">Loading deterministic RDKit depiction…</Typography>}<Divider sx={{ my: 1 }} /><Typography variant="caption">Morgan {formatMetric(point.structural_similarity)} · Jaccard {formatMetric(point.interaction_similarity)} · Vina {formatMetricWithUnit(point.vina_affinity_kcal_mol, 'kcal/mol')}</Typography></Paper>)}
      </Box>
      {comparisonSvg ? <ExportControls kind="2D comparison" supportsSvg aspectRatio={comparisonAspect} onExport={exportComparison} /> : null}
    </Stack>
  );
}
