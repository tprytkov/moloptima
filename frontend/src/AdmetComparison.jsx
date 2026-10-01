import React, { useDeferredValue, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { formatAdmetProperty } from './admetAnalysisData.js';
import {
  ADMET_COMPARISON_PICKER_LIMIT,
  MAX_ADMET_COMPARISON_MOLECULES,
  buildAdmetComparisonRows,
  comparisonVisibility,
  resolveAdmetComparisonMolecules,
  searchAdmetComparisonCandidates,
} from './admetComparison.js';

const NUMBER_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });
const PROBABILITY_FORMAT = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 });

function groupComparisonRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.endpoint.category)) groups.set(row.endpoint.category, []);
    groups.get(row.endpoint.category).push(row);
  }
  return [...groups.entries()];
}

function NumericSummary({ summary }) {
  if (!summary?.count) return null;
  if (summary.equal) return <Typography variant="caption" color="text.secondary">Equal available values: {NUMBER_FORMAT.format(summary.lowest)}</Typography>;
  return (
    <Typography variant="caption" color="text.secondary">
      Lowest {NUMBER_FORMAT.format(summary.lowest)} · Highest {NUMBER_FORMAT.format(summary.highest)} · Range {NUMBER_FORMAT.format(summary.range)}
    </Typography>
  );
}

function ComparisonValue({ property, endpoint, summary }) {
  if (!property) return <Typography variant="caption" color="text.secondary">Molecule unavailable</Typography>;
  if (property.status?.code !== 'available') {
    return <Typography variant="caption" color="text.secondary">{formatAdmetProperty(property, endpoint)}</Typography>;
  }
  if (endpoint.valueType === 'regression') {
    const isEqual = summary?.equal && Number.isFinite(property.value);
    const isLowest = !isEqual && Number.isFinite(property.value) && property.value === summary?.lowest;
    const isHighest = !isEqual && Number.isFinite(property.value) && property.value === summary?.highest;
    return (
      <Stack spacing={0.35}>
        <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{formatAdmetProperty(property, endpoint)}</Typography>
        <Typography variant="caption" color="text.secondary">{property.unit || endpoint.unit}</Typography>
        {isEqual ? <Chip size="small" variant="outlined" label="Equal value" sx={{ alignSelf: 'flex-start' }} /> : null}
        {isLowest ? <Chip size="small" color="info" variant="outlined" label="Lowest" sx={{ alignSelf: 'flex-start' }} /> : null}
        {isHighest ? <Chip size="small" color="secondary" variant="outlined" label="Highest" sx={{ alignSelf: 'flex-start' }} /> : null}
      </Stack>
    );
  }
  return (
    <Stack spacing={0.25}>
      <Typography variant="body2" sx={{ fontWeight: 700 }}>{property.classification || 'Endpoint not returned'}</Typography>
      {property.probability !== null && property.probability !== undefined ? (
        <Typography variant="caption" color="text.secondary">{PROBABILITY_FORMAT.format(property.probability)} probability</Typography>
      ) : null}
    </Stack>
  );
}

function CompoundHeader({ entry, outsideCurrentFilters, onRemove }) {
  if (!entry.molecule) {
    return (
      <Stack spacing={0.75} sx={{ minWidth: 190 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{entry.moleculeId}</Typography>
        <Alert severity="warning">Molecule is no longer present in the current source data.</Alert>
        <Button size="small" onClick={() => onRemove(entry.moleculeId)} aria-label={`Remove ${entry.moleculeId} from comparison`}>Remove</Button>
      </Stack>
    );
  }
  const molecule = entry.molecule;
  return (
    <Stack spacing={0.5} sx={{ minWidth: 190 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 800, overflowWrap: 'anywhere' }}>{molecule.displayName}</Typography>
      {molecule.displayName !== molecule.moleculeId ? <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{molecule.moleculeId}</Typography> : null}
      {molecule.sourceName ? <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{molecule.sourceName}</Typography> : null}
      {molecule.canonicalSmiles ? <Typography variant="caption" sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>{molecule.canonicalSmiles}</Typography> : null}
      {outsideCurrentFilters ? <Chip size="small" color="warning" variant="outlined" label="Outside current filters" sx={{ alignSelf: 'flex-start' }} /> : null}
      <Button size="small" onClick={() => onRemove(molecule.moleculeId)} aria-label={`Remove ${molecule.displayName} from comparison`} sx={{ alignSelf: 'flex-start' }}>Remove</Button>
    </Stack>
  );
}

export default function AdmetComparison({ molecules = [], filteredMolecules = [], selectedIds = [], onAdd, onRemove, onClear, initialPickerQuery = '' }) {
  const [pickerQuery, setPickerQuery] = useState(initialPickerQuery);
  const deferredQuery = useDeferredValue(pickerQuery);
  const resolved = useMemo(() => resolveAdmetComparisonMolecules(molecules, selectedIds), [molecules, selectedIds]);
  const selectedMolecules = useMemo(() => resolved.map(({ molecule }) => molecule), [resolved]);
  const groupedRows = useMemo(() => groupComparisonRows(buildAdmetComparisonRows(selectedMolecules)), [selectedMolecules]);
  const visibility = useMemo(() => comparisonVisibility(selectedIds, filteredMolecules), [filteredMolecules, selectedIds]);
  const candidates = useMemo(
    () => searchAdmetComparisonCandidates(molecules, deferredQuery, selectedIds),
    [deferredQuery, molecules, selectedIds],
  );
  const atLimit = selectedIds.length >= MAX_ADMET_COMPARISON_MOLECULES;

  return (
    <Stack spacing={2}>
      <Paper elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
        <Stack spacing={1.5}>
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1}>
            <Box>
              <Typography variant="h2">Compound comparison</Typography>
              <Typography variant="body2" color="text.secondary">Compare 2–5 normalized ADMET profiles. Lowest and highest labels are descriptive, not scientific preferences.</Typography>
            </Box>
            <Button size="small" disabled={!selectedIds.length} onClick={onClear}>Clear comparison</Button>
          </Stack>
          <TextField
            label="Find a compound"
            value={pickerQuery}
            onChange={(event) => setPickerQuery(event.target.value)}
            placeholder="Name, molecule ID, SMILES, or source file"
            size="small"
            disabled={atLimit}
            inputProps={{ 'aria-label': 'Search compounds to compare' }}
            sx={{ maxWidth: 520 }}
          />
          {atLimit ? <Alert severity="info" aria-live="polite">Comparison limit reached. Remove a compound before adding another.</Alert> : null}
          {!atLimit && !pickerQuery.trim() ? <Typography variant="caption" color="text.secondary">Type to search. Up to {ADMET_COMPARISON_PICKER_LIMIT} matching compounds are shown.</Typography> : null}
          {!atLimit && pickerQuery.trim() ? (
            <Paper variant="outlined" aria-label="Comparison molecule search results" sx={{ maxWidth: 720, maxHeight: 280, overflowY: 'auto' }}>
              {candidates.length ? candidates.map((molecule) => (
                <Button
                  key={`${molecule.moleculeId}-${molecule.sourceIndex}`}
                  fullWidth
                  onClick={() => { onAdd(molecule.moleculeId); setPickerQuery(''); }}
                  aria-label={`Add ${molecule.displayName} to comparison`}
                  sx={{ display: 'flex', justifyContent: 'flex-start', textAlign: 'left', px: 1.5, py: 1, borderRadius: 0, textTransform: 'none' }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{molecule.displayName}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{molecule.moleculeId}{molecule.sourceName ? ` · ${molecule.sourceName}` : ''}</Typography>
                  </Box>
                </Button>
              )) : <Typography variant="body2" color="text.secondary" sx={{ p: 1.5 }}>No matching compounds.</Typography>}
            </Paper>
          ) : null}
          <Typography variant="caption" color="text.secondary" aria-live="polite">{selectedIds.length} of {MAX_ADMET_COMPARISON_MOLECULES} compounds selected</Typography>
        </Stack>
      </Paper>

      {!selectedIds.length ? <Alert severity="info">Select 2–5 compounds to compare.</Alert> : null}
      {selectedIds.length === 1 ? <Alert severity="info">One compound selected. Add at least one more compound to compare.</Alert> : null}
      {selectedIds.length >= 2 ? (
        <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider', overflowX: 'auto', maxWidth: '100%' }}>
          <Table size="small" aria-label="ADMET compound comparison" sx={{ minWidth: 260 + selectedIds.length * 220 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ minWidth: 260, position: 'sticky', left: 0, zIndex: 3, bgcolor: 'background.paper' }}>Property</TableCell>
                {resolved.map((entry) => (
                  <TableCell key={entry.moleculeId} component="th" scope="col" sx={{ minWidth: 220, verticalAlign: 'top' }}>
                    <CompoundHeader entry={entry} outsideCurrentFilters={!visibility[entry.moleculeId]} onRemove={onRemove} />
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow>
                <TableCell component="th" scope="row" sx={{ position: 'sticky', left: 0, zIndex: 2, bgcolor: 'background.paper', fontWeight: 800 }}>Molecule ID</TableCell>
                {resolved.map((entry) => <TableCell key={entry.moleculeId}>{entry.molecule?.moleculeId || 'Unavailable'}</TableCell>)}
              </TableRow>
              {groupedRows.map(([category, rows]) => (
                <React.Fragment key={category}>
                  <TableRow><TableCell colSpan={selectedIds.length + 1} sx={{ bgcolor: 'action.hover', fontWeight: 800 }}>{category}</TableCell></TableRow>
                  {rows.map((row) => (
                    <TableRow key={row.endpoint.key}>
                      <TableCell component="th" scope="row" sx={{ position: 'sticky', left: 0, zIndex: 2, bgcolor: 'background.paper', minWidth: 260 }}>
                        <Stack spacing={0.25}>
                          <Typography variant="body2" sx={{ fontWeight: 800 }}>{row.endpoint.label}</Typography>
                          <Typography variant="caption" color="text.secondary">{row.endpoint.modelName}</Typography>
                          <NumericSummary summary={row.numericSummary} />
                          {row.classificationDifferent ? <Chip size="small" color="warning" variant="outlined" label="Different classification" sx={{ alignSelf: 'flex-start' }} /> : null}
                        </Stack>
                      </TableCell>
                      {row.properties.map((property, index) => (
                        <TableCell key={resolved[index]?.moleculeId || index} sx={{ verticalAlign: 'top' }}>
                          <ComparisonValue property={property} endpoint={row.endpoint} summary={row.numericSummary} />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : null}
    </Stack>
  );
}
