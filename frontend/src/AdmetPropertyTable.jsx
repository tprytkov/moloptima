import React, { useDeferredValue, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  TextField,
  Typography,
} from '@mui/material';
import {
  ADMET_ENDPOINT_BY_KEY,
  ADMET_PROPERTY_TABLE_ENDPOINTS,
  formatAdmetProperty,
  normalizeAdmetAnalysis,
  paginateAdmetMolecules,
  searchAdmetMolecules,
  sortAdmetMolecules,
} from './admetAnalysisData.js';

const COLUMN_KEYS = ['compound', ...ADMET_PROPERTY_TABLE_ENDPOINTS];

function PropertyCell({ property, metadata }) {
  const display = formatAdmetProperty(property, metadata);
  if (property.status.code !== 'available') {
    return <Typography variant="caption" color="text.secondary">{display}</Typography>;
  }
  if (metadata.key === 'gmc_mpnn_bbb') {
    return (
      <Stack spacing={0.25}>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>{property.classification || 'Endpoint not returned'}</Typography>
        {property.probability !== null ? (
          <Typography variant="caption" color="text.secondary">
            {new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 }).format(property.probability)} raw ensemble probability
          </Typography>
        ) : null}
      </Stack>
    );
  }
  return <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{display}</Typography>;
}

export default function AdmetPropertyTable({ rows }) {
  const normalized = useMemo(() => normalizeAdmetAnalysis(rows), [rows]);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState('compound');
  const [sortDirection, setSortDirection] = useState('asc');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const deferredQuery = useDeferredValue(query);

  const searched = useMemo(
    () => searchAdmetMolecules(normalized.molecules, deferredQuery),
    [deferredQuery, normalized.molecules],
  );
  const sorted = useMemo(
    () => sortAdmetMolecules(searched, sortKey, sortDirection),
    [searched, sortDirection, sortKey],
  );
  const paginated = useMemo(
    () => paginateAdmetMolecules(sorted, page, pageSize),
    [page, pageSize, sorted],
  );
  const availablePropertyCount = useMemo(
    () => normalized.molecules.reduce(
      (count, molecule) => count + ADMET_PROPERTY_TABLE_ENDPOINTS.filter(
        (key) => molecule.properties[key].status.code === 'available',
      ).length,
      0,
    ),
    [normalized.molecules],
  );

  function handleSort(key) {
    setSortDirection((current) => sortKey === key && current === 'asc' ? 'desc' : 'asc');
    setSortKey(key);
    setPage(0);
  }

  if (!normalized.molecules.length) {
    return <Alert severity="info">No molecules are available for ADMET analysis.</Alert>;
  }

  return (
    <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
      <Stack spacing={1.5} sx={{ p: 2 }}>
        <Box>
          <Typography variant="h2">ADMET property table</Typography>
          <Typography variant="body2" color="text.secondary">
            Existing prediction outputs only. Model and endpoint availability are retained for every molecule.
          </Typography>
        </Box>
        {availablePropertyCount === 0 ? (
          <Alert severity="info">ADMET has not produced available property values for this molecule library. Cell labels preserve the recorded model and endpoint status.</Alert>
        ) : null}
        <TextField
          label="Search compounds"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setPage(0); }}
          placeholder="Molecule name, ID, SMILES, or source file"
          size="small"
          sx={{ maxWidth: 440 }}
          inputProps={{ 'aria-label': 'Search ADMET compounds' }}
        />
        <Typography variant="caption" color="text.secondary" aria-live="polite">
          {searched.length.toLocaleString()} of {normalized.molecules.length.toLocaleString()} molecules
        </Typography>
      </Stack>
      <TableContainer sx={{ overflowX: 'auto', borderTop: '1px solid', borderColor: 'divider' }}>
        <Table stickyHeader size="small" aria-label="ADMET property table" sx={{ minWidth: 1120 }}>
          <TableHead>
            <TableRow>
              {COLUMN_KEYS.map((key) => {
                const metadata = key === 'compound' ? null : ADMET_ENDPOINT_BY_KEY.get(key);
                const label = metadata?.label || 'Compound';
                return (
                  <TableCell key={key} sortDirection={sortKey === key ? sortDirection : false} sx={{ minWidth: key === 'compound' ? 220 : 140 }}>
                    <TableSortLabel
                      active={sortKey === key}
                      direction={sortKey === key ? sortDirection : 'asc'}
                      onClick={() => handleSort(key)}
                      aria-label={`Sort by ${label}`}
                    >
                      <Stack spacing={0.1}>
                        <Typography component="span" variant="caption" sx={{ fontWeight: 800 }}>{label}</Typography>
                        {metadata ? <Typography component="span" variant="caption" color="text.secondary">{metadata.unit} · {metadata.modelName}</Typography> : null}
                      </Stack>
                    </TableSortLabel>
                  </TableCell>
                );
              })}
            </TableRow>
          </TableHead>
          <TableBody>
            {paginated.rows.map((molecule) => (
              <TableRow hover key={`${molecule.moleculeId}-${molecule.sourceIndex}`} data-testid="admet-property-row">
                <TableCell component="th" scope="row" sx={{ maxWidth: 300 }}>
                  <Stack spacing={0.25}>
                    <Typography variant="body2" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{molecule.displayName}</Typography>
                    {molecule.moleculeId !== molecule.displayName ? <Typography variant="caption" color="text.secondary">{molecule.moleculeId}</Typography> : null}
                    {molecule.sourceName ? <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{molecule.sourceName}</Typography> : null}
                  </Stack>
                </TableCell>
                {ADMET_PROPERTY_TABLE_ENDPOINTS.map((key) => (
                  <TableCell key={key}>
                    <PropertyCell property={molecule.properties[key]} metadata={ADMET_ENDPOINT_BY_KEY.get(key)} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {!paginated.rows.length ? (
              <TableRow><TableCell colSpan={COLUMN_KEYS.length}><Typography color="text.secondary">No compounds match this search.</Typography></TableCell></TableRow>
            ) : null}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={paginated.total}
        page={paginated.page}
        onPageChange={(_, nextPage) => setPage(nextPage)}
        rowsPerPage={paginated.pageSize}
        onRowsPerPageChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }}
        rowsPerPageOptions={[25, 50, 100]}
        labelRowsPerPage="Rows per page:"
        showFirstButton
        showLastButton
      />
    </Paper>
  );
}
