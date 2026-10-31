import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { ContextHelp } from './HelpSystem.jsx';
import { ADMET_ENDPOINT_BY_KEY, ADMET_ENDPOINT_REGISTRY } from './admetAnalysisData.js';
import {
  ADMET_CLASSIFICATION_ENDPOINT_KEYS,
  ADMET_REGRESSION_ENDPOINT_KEYS,
  admetEndpointScale,
  admetEndpointThreshold,
  admetVisualizationValue,
  buildAdmetHeatMap,
  formatAdmetVisualizationValue,
  heatMapCellDescription,
  normalizeAdmetDisplayValue,
} from './admetVisualizationData.js';

const HEAT_MAP_ROW_HEIGHT = 42;
const HEAT_MAP_HEADER_HEIGHT = 76;
const HEAT_MAP_VIEWPORT_HEIGHT = 520;
const HEAT_MAP_OVERSCAN = 4;
const HEAT_MAP_LABEL_WIDTH = 210;
const HEAT_MAP_CELL_WIDTH = 118;

function ProbabilityBar({ molecule, endpointKey }) {
  const endpoint = ADMET_ENDPOINT_BY_KEY.get(endpointKey);
  const property = molecule?.properties?.[endpointKey];
  const probability = admetVisualizationValue(molecule, endpointKey);
  const threshold = admetEndpointThreshold(property, endpointKey);
  const percentage = probability === null ? 0 : Math.max(0, Math.min(100, probability * 100));
  const statusLabel = property?.status?.label || 'Not available';
  return (
    <Box component="article" aria-label={`${endpoint.label}: ${probability === null ? statusLabel : `${probability.toFixed(3)} probability, ${property?.classification || 'class not returned'}${threshold !== null ? `, threshold ${threshold}` : ''}`}`} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '190px minmax(180px, 1fr) 150px' }, gap: 1, alignItems: 'center', py: 0.8, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 750 }}>{endpoint.label}</Typography>
        <Typography variant="caption" color="text.secondary">{endpoint.modelName}</Typography>
      </Box>
      {probability === null ? (
        <Box sx={{ minHeight: 18, border: '1px dashed', borderColor: 'divider', borderRadius: 8, px: 1 }}>
          <Typography variant="caption" color="text.secondary">{statusLabel}</Typography>
        </Box>
      ) : (
        <Box aria-hidden="true" sx={{ position: 'relative', height: 18, borderRadius: 9, bgcolor: '#e8eef5', overflow: 'hidden', outline: '1px solid #b8c5d1' }}>
          <Box sx={{ width: `${percentage}%`, height: '100%', bgcolor: '#26758d' }} />
          {threshold !== null ? <Box sx={{ position: 'absolute', left: `${threshold * 100}%`, top: -2, bottom: -2, width: 2, bgcolor: '#111827', boxShadow: '0 0 0 1px #fff' }} /> : null}
        </Box>
      )}
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
          {probability === null ? statusLabel : `${probability.toFixed(3)} · ${(probability * 100).toFixed(1)}%`}
        </Typography>
        {probability !== null ? <Typography variant="caption" color="text.secondary">{property?.classification || 'Class not returned'}{threshold !== null ? ` · threshold ${threshold}` : ''}</Typography> : null}
        {endpointKey === 'gmc_mpnn_bbb' && probability !== null ? <Typography variant="caption" color="text.secondary" display="block">Threshold status: {property?.raw?.threshold_status || 'Not specified'} · Calibration status: {property?.raw?.calibration_status || 'Not specified'}</Typography> : null}
      </Box>
    </Box>
  );
}

function RegressionScale({ molecule, molecules, endpointKey }) {
  const endpoint = ADMET_ENDPOINT_BY_KEY.get(endpointKey);
  const property = molecule?.properties?.[endpointKey];
  const value = admetVisualizationValue(molecule, endpointKey);
  const scale = useMemo(() => admetEndpointScale(molecules, endpointKey), [endpointKey, molecules]);
  const position = normalizeAdmetDisplayValue(value, scale);
  const unit = property?.unit || endpoint.unit;
  const statusLabel = property?.status?.label || 'Not available';
  return (
    <Box component="article" aria-label={`${endpoint.label}: ${formatAdmetVisualizationValue(value, endpointKey, unit)}`} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '190px minmax(180px, 1fr) 170px' }, gap: 1, alignItems: 'center', py: 0.8, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 750 }}>{endpoint.label}</Typography>
        <Typography variant="caption" color="text.secondary">{unit}</Typography>
      </Box>
      {value === null ? (
        <Box sx={{ minHeight: 18, border: '1px dashed', borderColor: 'divider', borderRadius: 8, px: 1 }}>
          <Typography variant="caption" color="text.secondary">{statusLabel}</Typography>
        </Box>
      ) : (
        <Box aria-hidden="true" sx={{ position: 'relative', height: 18, borderRadius: 9, background: 'linear-gradient(90deg, #edf4f4, #78aeb4)', outline: '1px solid #b8c5d1' }}>
          <Box sx={{ position: 'absolute', left: `calc(${position * 100}% - 5px)`, top: 3, width: 10, height: 10, borderRadius: '50%', bgcolor: '#172a3a', border: '2px solid #fff', boxShadow: '0 0 0 1px #172a3a' }} />
        </Box>
      )}
      <Box>
        <Typography variant="body2" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{formatAdmetVisualizationValue(value, endpointKey, unit)}</Typography>
        {value !== null ? <Typography variant="caption" color="text.secondary">Relative position within {scale.count} available value{scale.count === 1 ? '' : 's'}</Typography> : null}
      </Box>
    </Box>
  );
}

export function AdmetSelectedProfile({ molecule, molecules = [], onOpenHelp = () => {} }) {
  if (!molecule) return <Alert severity="info">Select a molecule to view its ADMET profile.</Alert>;
  return (
    <Paper component="section" elevation={0} aria-labelledby="admet-selected-profile-title" sx={{ p: 2, border: '1px solid', borderColor: 'divider', minWidth: 0 }}>
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
          <Box sx={{ minWidth: 0 }}>
            <Typography id="admet-selected-profile-title" variant="h2">Selected-compound visual profile</Typography>
            <Typography variant="subtitle2" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>{molecule.displayName}</Typography>
            {molecule.displayName !== molecule.moleculeId ? <Typography variant="caption" color="text.secondary">{molecule.moleculeId}</Typography> : null}
          </Box>
          <Chip size="small" variant="outlined" label="15 fixed endpoints" sx={{ alignSelf: { xs: 'flex-start', sm: 'center' } }} />
        </Stack>
        <Box>
          <Stack direction="row" spacing={0.25} alignItems="center">
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>Classification probabilities</Typography>
            <ContextHelp termId="admet-probability-bars" onLearnMore={onOpenHelp} />
          </Stack>
          <Typography variant="caption" color="text.secondary">Bars use the 0–1 probability scale. A marker is shown only for the authoritative BBB threshold.</Typography>
          <Box sx={{ mt: 0.5 }}>{ADMET_CLASSIFICATION_ENDPOINT_KEYS.map((key) => <ProbabilityBar key={key} molecule={molecule} endpointKey={key} />)}</Box>
        </Box>
        <Box>
          <Stack direction="row" spacing={0.25} alignItems="center">
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>Chemprop regression properties</Typography>
            <ContextHelp termId="admet-regression-scales" onLearnMore={onOpenHelp} />
          </Stack>
          <Typography variant="caption" color="text.secondary">Each scale uses only that endpoint’s available values in the current collection. It does not define a favorable range.</Typography>
          <Box sx={{ mt: 0.5 }}>{ADMET_REGRESSION_ENDPOINT_KEYS.map((key) => <RegressionScale key={key} molecule={molecule} molecules={molecules} endpointKey={key} />)}</Box>
        </Box>
      </Stack>
    </Paper>
  );
}

function heatColor(value) {
  if (!Number.isFinite(value)) return '#f2f4f7';
  const lightness = 94 - value * 48;
  return `hsl(193 42% ${lightness}%)`;
}

function HeatMapCell({ row, cell, selected, onSelect }) {
  const description = heatMapCellDescription(row, cell);
  const dark = Number.isFinite(cell.normalizedValue) && cell.normalizedValue > 0.62;
  return (
    <Button
      type="button"
      title={description}
      aria-label={description}
      onClick={() => onSelect(row.moleculeId)}
      sx={{
        minWidth: 0,
        width: '100%',
        height: HEAT_MAP_ROW_HEIGHT - 4,
        px: 0.5,
        py: 0.25,
        borderRadius: 0.75,
        border: selected ? '2px solid #f59e0b' : '1px solid rgba(31, 41, 55, 0.18)',
        color: dark ? '#fff' : '#172a3a',
        bgcolor: heatColor(cell.normalizedValue),
        backgroundImage: cell.rawValue === null ? 'repeating-linear-gradient(135deg, transparent, transparent 5px, rgba(100,116,139,.16) 5px, rgba(100,116,139,.16) 7px)' : 'none',
        fontSize: '0.69rem',
        lineHeight: 1.1,
        fontVariantNumeric: 'tabular-nums',
        textTransform: 'none',
        '&:hover': { bgcolor: heatColor(cell.normalizedValue), filter: 'brightness(0.96)' },
        '&:focus-visible': { outline: '3px solid #111827', outlineOffset: 1 },
      }}
    >
      {cell.rawValue === null ? 'N/A' : ADMET_ENDPOINT_BY_KEY.get(cell.endpointKey).valueType === 'binary_classification' ? cell.rawValue.toFixed(2) : Number(cell.rawValue).toPrecision(3)}
    </Button>
  );
}

export function AdmetHeatMap({ molecules = [], selectedMoleculeId = '', onSelectMolecule = () => {}, onOpenHelp = () => {} }) {
  const heatMap = useMemo(() => buildAdmetHeatMap(molecules), [molecules]);
  const [scrollTop, setScrollTop] = useState(0);
  const visibleCount = Math.ceil(HEAT_MAP_VIEWPORT_HEIGHT / HEAT_MAP_ROW_HEIGHT);
  const start = Math.max(0, Math.floor(scrollTop / HEAT_MAP_ROW_HEIGHT) - HEAT_MAP_OVERSCAN);
  const end = Math.min(heatMap.rows.length, start + visibleCount + HEAT_MAP_OVERSCAN * 2);
  const visibleRows = heatMap.rows.slice(start, end);
  const gridWidth = HEAT_MAP_LABEL_WIDTH + heatMap.endpoints.length * HEAT_MAP_CELL_WIDTH;

  return (
    <Paper component="section" elevation={0} aria-labelledby="admet-heat-map-title" sx={{ p: 2, border: '1px solid', borderColor: 'divider', minWidth: 0 }}>
      <Stack spacing={1.25}>
        <Box>
          <Stack direction="row" spacing={0.25} alignItems="center">
            <Typography id="admet-heat-map-title" variant="h2">Compound-by-endpoint heat map</Typography>
            <ContextHelp termId="admet-heat-map" onLearnMore={onOpenHelp} />
          </Stack>
          <Typography variant="body2" color="text.secondary">{molecules.length.toLocaleString()} compounds · {ADMET_ENDPOINT_REGISTRY.length} endpoints · all rows retained</Typography>
        </Box>
        {!molecules.length ? <Alert severity="info">No compounds match the current search and filters.</Alert> : null}
        {molecules.length ? (
          <Box
            data-testid="admet-heat-map-scroll"
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            sx={{ maxHeight: HEAT_MAP_VIEWPORT_HEIGHT + HEAT_MAP_HEADER_HEIGHT, overflow: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
          >
            <Box sx={{ width: gridWidth, minWidth: '100%' }}>
              <Box sx={{ position: 'sticky', top: 0, zIndex: 5, height: HEAT_MAP_HEADER_HEIGHT, display: 'grid', gridTemplateColumns: `${HEAT_MAP_LABEL_WIDTH}px repeat(${heatMap.endpoints.length}, ${HEAT_MAP_CELL_WIDTH}px)`, bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider' }}>
                <Box sx={{ p: 1, position: 'sticky', left: 0, zIndex: 6, bgcolor: 'background.paper' }}><Typography variant="caption" sx={{ fontWeight: 800 }}>Molecule</Typography></Box>
                {heatMap.endpoints.map((endpoint) => <Box key={endpoint.key} sx={{ p: 0.75, borderLeft: '1px solid', borderColor: 'divider' }}><Typography variant="caption" sx={{ fontWeight: 800, lineHeight: 1.1, display: 'block' }}>{endpoint.label}</Typography><Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.05 }}>{endpoint.valueType === 'regression' ? endpoint.unit : 'Probability'}</Typography></Box>)}
              </Box>
              <Box sx={{ position: 'relative', height: heatMap.rows.length * HEAT_MAP_ROW_HEIGHT }}>
                {visibleRows.map((row, offset) => {
                  const rowIndex = start + offset;
                  const selected = row.moleculeId === selectedMoleculeId;
                  return (
                    <Box key={`${row.moleculeId}-${row.sourceIndex}`} data-testid="admet-heat-map-row" sx={{ position: 'absolute', top: rowIndex * HEAT_MAP_ROW_HEIGHT, left: 0, width: '100%', height: HEAT_MAP_ROW_HEIGHT, display: 'grid', gridTemplateColumns: `${HEAT_MAP_LABEL_WIDTH}px repeat(${heatMap.endpoints.length}, ${HEAT_MAP_CELL_WIDTH}px)`, alignItems: 'center', bgcolor: rowIndex % 2 ? '#fbfcfd' : '#fff' }}>
                      <Button onClick={() => onSelectMolecule(row.moleculeId)} aria-label={`Inspect ${row.displayName}`} sx={{ position: 'sticky', left: 0, zIndex: 2, height: '100%', justifyContent: 'flex-start', px: 1, borderRadius: 0, bgcolor: selected ? '#fff3cd' : rowIndex % 2 ? '#fbfcfd' : '#fff', textTransform: 'none', overflow: 'hidden', '&:hover': { bgcolor: selected ? '#ffecb5' : '#eef4f7' } }}><Typography variant="caption" noWrap sx={{ fontWeight: selected ? 800 : 600 }}>{row.displayName}</Typography></Button>
                      {row.cells.map((cell) => <Box key={cell.endpointKey} sx={{ px: 0.25 }}><HeatMapCell row={row} cell={cell} selected={selected} onSelect={onSelectMolecule} /></Box>)}
                    </Box>
                  );
                })}
              </Box>
            </Box>
          </Box>
        ) : null}
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} useFlexGap flexWrap="wrap" aria-label="ADMET heat map legend">
          <Chip size="small" variant="outlined" label="Classification: 0–1 predicted probability" />
          <Chip size="small" variant="outlined" label="Regression: independently scaled within each endpoint" />
          <Chip size="small" variant="outlined" label="Striped N/A: value unavailable" />
          <Chip size="small" variant="outlined" label="Amber outline: selected molecule" />
        </Stack>
        <Typography variant="caption" color="text.secondary">Color intensity across different endpoints is not direct quantitative equivalence. Inspect each raw value and unit; regression scaling is presentation-only.</Typography>
      </Stack>
    </Paper>
  );
}
