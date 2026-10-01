import React, { useDeferredValue, useMemo, useReducer } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControl,
  FormHelperText,
  InputLabel,
  ListItemText,
  MenuItem,
  Paper,
  Select,
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
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  ADMET_ENDPOINT_BY_KEY,
  ADMET_PROPERTY_TABLE_ENDPOINTS,
  formatAdmetProperty,
  normalizeAdmetAnalysis,
  paginateAdmetMolecules,
  searchAdmetMolecules,
  sortAdmetMolecules,
} from './admetAnalysisData.js';
import {
  ADMET_FILTERABLE_STATUSES,
  BBB_CLASSIFICATIONS,
  activeAdmetFilterSummaries,
  admetTableStateReducer,
  clearAdmetFilter,
  createEmptyAdmetFilters,
  filterAdmetMolecules,
  numericFilterValidity,
  setAdmetFilterSelections,
  setNumericAdmetFilter,
} from './admetFilters.js';
import { ADMET_STATUS_PRESENTATION } from './admetStatus.js';

const COLUMN_KEYS = ['compound', ...ADMET_PROPERTY_TABLE_ENDPOINTS];
const QUICK_NUMERIC_ENDPOINTS = ['lipophilicity_astrazeneca', 'solubility_aqsoldb'];
const MORE_NUMERIC_ENDPOINTS = ['caco2_wang', 'ppbr_az', 'vdss_lombardo'];

function NumericFilterFields({ endpointKey, filters, onChange }) {
  const metadata = ADMET_ENDPOINT_BY_KEY.get(endpointKey);
  const constraint = filters.numeric[endpointKey];
  const validity = numericFilterValidity(constraint);
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" sx={{ display: 'block', mb: 0.5, fontWeight: 800 }}>{metadata.label}</Typography>
      <Stack direction="row" spacing={1}>
        {['min', 'max'].map((bound) => (
          <TextField
            key={bound}
            label={bound === 'min' ? 'Min' : 'Max'}
            value={constraint[bound]}
            onChange={(event) => onChange(setNumericAdmetFilter(filters, endpointKey, bound, event.target.value))}
            size="small"
            error={!validity[bound].valid || !validity.rangeValid}
            inputProps={{ inputMode: 'decimal', 'aria-label': `${metadata.label} ${bound}` }}
            sx={{ width: 112 }}
          />
        ))}
      </Stack>
      {!validity.valid ? <FormHelperText error>Enter a valid number.</FormHelperText> : null}
      {validity.valid && !validity.rangeValid ? <FormHelperText error>Min must not exceed max.</FormHelperText> : null}
    </Box>
  );
}

function MultiSelectFilter({ endpointKey, label, kind, options, filters, onChange }) {
  const selected = filters[kind][endpointKey];
  return (
    <FormControl size="small" sx={{ minWidth: 190 }}>
      <InputLabel>{label}</InputLabel>
      <Select
        multiple
        label={label}
        value={selected}
        onChange={(event) => onChange(setAdmetFilterSelections(filters, kind, endpointKey, event.target.value))}
        renderValue={(values) => values.map((value) => options.find((option) => option.value === value)?.label || value).join(', ')}
        inputProps={{ 'aria-label': label }}
      >
        {options.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            <Checkbox checked={selected.includes(option.value)} size="small" />
            <ListItemText primary={option.label} />
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

const BBB_OPTIONS = BBB_CLASSIFICATIONS.map((value) => ({ value, label: value }));
const STATUS_OPTIONS = ADMET_FILTERABLE_STATUSES.map((value) => ({
  value,
  label: ADMET_STATUS_PRESENTATION[value].label,
}));

export function AdmetFilterPanel({ filters, onChange, matchedCount, totalCount }) {
  const summaries = activeAdmetFilterSummaries(filters);
  return (
    <Box aria-label="ADMET property filters" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, p: 1.5 }}>
      <Stack spacing={1.25}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1}>
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>Filters</Typography>
            <Typography variant="caption" color="text.secondary">All active filters must match; selections within one field match any selected value.</Typography>
          </Box>
          <Button size="small" disabled={!summaries.length} onClick={() => onChange(createEmptyAdmetFilters())}>Clear all filters</Button>
        </Stack>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5, alignItems: 'start' }}>
          {QUICK_NUMERIC_ENDPOINTS.map((key) => <NumericFilterFields key={key} endpointKey={key} filters={filters} onChange={onChange} />)}
          <MultiSelectFilter endpointKey="gmc_mpnn_bbb" label="BBB classification" kind="classifications" options={BBB_OPTIONS} filters={filters} onChange={onChange} />
        </Box>
        <Accordion disableGutters elevation={0} sx={{ border: '1px solid', borderColor: 'divider', '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />} aria-controls="admet-more-filters" id="admet-more-filters-summary">
            <Typography variant="body2" sx={{ fontWeight: 700 }}>More filters · Caco-2, binding, distribution, and endpoint status</Typography>
          </AccordionSummary>
          <AccordionDetails id="admet-more-filters">
            <Stack spacing={2}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5 }}>
                {MORE_NUMERIC_ENDPOINTS.map((key) => <NumericFilterFields key={key} endpointKey={key} filters={filters} onChange={onChange} />)}
              </Box>
              <Box>
                <Typography variant="caption" sx={{ display: 'block', mb: 1, fontWeight: 800 }}>Endpoint status</Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' }, gap: 1 }}>
                  {ADMET_PROPERTY_TABLE_ENDPOINTS.map((key) => (
                    <MultiSelectFilter
                      key={key}
                      endpointKey={key}
                      label={`${ADMET_ENDPOINT_BY_KEY.get(key).label} status`}
                      kind="statuses"
                      options={STATUS_OPTIONS}
                      filters={filters}
                      onChange={onChange}
                    />
                  ))}
                </Box>
              </Box>
            </Stack>
          </AccordionDetails>
        </Accordion>
        {summaries.length ? (
          <Stack direction="row" useFlexGap flexWrap="wrap" spacing={0.75} aria-label="Active ADMET filters">
            {summaries.map((summary) => (
              <Chip
                key={summary.id}
                size="small"
                label={summary.label}
                onClick={() => onChange(clearAdmetFilter(filters, summary.kind, summary.endpointKey))}
                onDelete={() => onChange(clearAdmetFilter(filters, summary.kind, summary.endpointKey))}
                aria-label={`Remove ${summary.label} filter`}
              />
            ))}
          </Stack>
        ) : null}
        <Typography variant="caption" color="text.secondary" aria-live="polite">
          {matchedCount.toLocaleString()} of {totalCount.toLocaleString()} compounds
        </Typography>
      </Stack>
    </Box>
  );
}

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

export default function AdmetPropertyTable({ rows, initialFilters = null }) {
  const normalized = useMemo(() => normalizeAdmetAnalysis(rows), [rows]);
  const [viewState, dispatch] = useReducer(admetTableStateReducer, undefined, () => ({
    query: '',
    filters: initialFilters || createEmptyAdmetFilters(),
    sortKey: 'compound',
    sortDirection: 'asc',
    page: 0,
    pageSize: 50,
  }));
  const deferredQuery = useDeferredValue(viewState.query);

  const searched = useMemo(
    () => searchAdmetMolecules(normalized.molecules, deferredQuery),
    [deferredQuery, normalized.molecules],
  );
  const filtered = useMemo(
    () => filterAdmetMolecules(searched, viewState.filters),
    [searched, viewState.filters],
  );
  const sorted = useMemo(
    () => sortAdmetMolecules(filtered, viewState.sortKey, viewState.sortDirection),
    [filtered, viewState.sortDirection, viewState.sortKey],
  );
  const paginated = useMemo(
    () => paginateAdmetMolecules(sorted, viewState.page, viewState.pageSize),
    [sorted, viewState.page, viewState.pageSize],
  );
  const hasActiveFilters = useMemo(
    () => activeAdmetFilterSummaries(viewState.filters).length > 0,
    [viewState.filters],
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
    dispatch({ type: 'set-sort', sortKey: key });
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
          value={viewState.query}
          onChange={(event) => dispatch({ type: 'set-query', query: event.target.value })}
          placeholder="Molecule name, ID, SMILES, or source file"
          size="small"
          sx={{ maxWidth: 440 }}
          inputProps={{ 'aria-label': 'Search ADMET compounds' }}
        />
        <AdmetFilterPanel
          filters={viewState.filters}
          onChange={(filters) => dispatch({ type: 'set-filters', filters })}
          matchedCount={filtered.length}
          totalCount={normalized.molecules.length}
        />
      </Stack>
      <TableContainer sx={{ overflowX: 'auto', borderTop: '1px solid', borderColor: 'divider' }}>
        <Table stickyHeader size="small" aria-label="ADMET property table" sx={{ minWidth: 1120 }}>
          <TableHead>
            <TableRow>
              {COLUMN_KEYS.map((key) => {
                const metadata = key === 'compound' ? null : ADMET_ENDPOINT_BY_KEY.get(key);
                const label = metadata?.label || 'Compound';
                return (
                  <TableCell key={key} sortDirection={viewState.sortKey === key ? viewState.sortDirection : false} sx={{ minWidth: key === 'compound' ? 220 : 140 }}>
                    <TableSortLabel
                      active={viewState.sortKey === key}
                      direction={viewState.sortKey === key ? viewState.sortDirection : 'asc'}
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
              <TableRow><TableCell colSpan={COLUMN_KEYS.length}>
                <Stack spacing={1} alignItems="flex-start" sx={{ py: 2 }}>
                  <Typography color="text.secondary">{hasActiveFilters ? 'No compounds match the current filters.' : 'No compounds match this search.'}</Typography>
                  {hasActiveFilters ? <Button size="small" onClick={() => dispatch({ type: 'set-filters', filters: createEmptyAdmetFilters() })}>Clear filters</Button> : null}
                </Stack>
              </TableCell></TableRow>
            ) : null}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={paginated.total}
        page={paginated.page}
        onPageChange={(_, nextPage) => dispatch({ type: 'set-page', page: nextPage })}
        rowsPerPage={paginated.pageSize}
        onRowsPerPageChange={(event) => dispatch({ type: 'set-page-size', pageSize: Number(event.target.value) })}
        rowsPerPageOptions={[25, 50, 100]}
        labelRowsPerPage="Rows per page:"
        showFirstButton
        showLastButton
      />
    </Paper>
  );
}
