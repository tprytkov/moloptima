import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  Alert,
  Box,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { ADMET_ENDPOINT_BY_KEY } from './admetAnalysisData.js';
import {
  ADMET_PLOT_ENDPOINTS,
  createAdmetHistogram,
  plotEndpointLabel,
  prepareAdmetScatterPoints,
  projectAdmetScatterPoints,
} from './admetPlotData.js';

export const DEFAULT_ADMET_PLOT_STATE = Object.freeze({
  plotType: 'distribution',
  distributionKey: 'solubility_aqsoldb',
  xKey: 'lipophilicity_astrazeneca',
  yKey: 'solubility_aqsoldb',
});

function alternateEndpoint(key) {
  return ADMET_PLOT_ENDPOINTS.find((candidate) => candidate !== key) || key;
}

export function admetPlotStateReducer(state, action) {
  if (action.type === 'set-plot-type') return { ...state, plotType: action.plotType };
  if (action.type === 'set-distribution-key') return { ...state, distributionKey: action.endpointKey };
  if (action.type === 'set-x-key') {
    return { ...state, xKey: action.endpointKey, yKey: state.yKey === action.endpointKey ? alternateEndpoint(action.endpointKey) : state.yKey };
  }
  if (action.type === 'set-y-key') {
    return { ...state, yKey: action.endpointKey, xKey: state.xKey === action.endpointKey ? alternateEndpoint(action.endpointKey) : state.xKey };
  }
  return state;
}

function EndpointSelect({ id, label, value, onChange, exclude = null }) {
  return (
    <FormControl size="small" sx={{ minWidth: 240, flex: '1 1 240px' }}>
      <InputLabel id={`${id}-label`}>{label}</InputLabel>
      <Select labelId={`${id}-label`} id={id} value={value} label={label} onChange={(event) => onChange(event.target.value)}>
        {ADMET_PLOT_ENDPOINTS.filter((key) => key !== exclude).map((key) => {
          const endpoint = ADMET_ENDPOINT_BY_KEY.get(key);
          return <MenuItem key={key} value={key}>{endpoint.label} · {endpoint.unit}</MenuItem>;
        })}
      </Select>
    </FormControl>
  );
}

function PlotCounts({ totalCount, plottedCount, unavailableCount, unavailableLabel = 'unavailable' }) {
  return (
    <Typography variant="body2" color="text.secondary" aria-live="polite">
      {totalCount.toLocaleString()} filtered compounds · {plottedCount.toLocaleString()} plotted · {unavailableCount.toLocaleString()} {unavailableLabel}
    </Typography>
  );
}

function DistributionPlot({ molecules, endpointKey }) {
  const histogram = useMemo(() => createAdmetHistogram(molecules, endpointKey), [endpointKey, molecules]);
  const endpoint = ADMET_ENDPOINT_BY_KEY.get(endpointKey);
  const width = 900;
  const height = 420;
  const margin = { left: 72, right: 24, top: 24, bottom: 64 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const barWidth = histogram.bins.length ? chartWidth / histogram.bins.length : chartWidth;

  return (
    <Stack spacing={1.25} data-testid="admet-distribution-view">
      <PlotCounts {...histogram} />
      {!molecules.length ? <Alert severity="info">No compounds match current search and filters.</Alert> : null}
      {molecules.length && !histogram.plottedCount ? <Alert severity="info">No available predictions for this property.</Alert> : null}
      {histogram.plottedCount ? (
        <Box sx={{ width: '100%', overflow: 'hidden' }}>
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${endpoint.label} distribution histogram`} style={{ display: 'block', width: '100%', height: 'auto', maxHeight: 480 }}>
            <line x1={margin.left} y1={margin.top + chartHeight} x2={width - margin.right} y2={margin.top + chartHeight} stroke="#5f6b7a" />
            <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + chartHeight} stroke="#5f6b7a" />
            {histogram.bins.map((bin, index) => {
              const barHeight = histogram.maxCount ? (bin.count / histogram.maxCount) * chartHeight : 0;
              return <rect key={`${bin.x0}-${index}`} x={margin.left + index * barWidth + 1} y={margin.top + chartHeight - barHeight} width={Math.max(1, barWidth - 2)} height={barHeight} fill="#2b6cb0"><title>{`${bin.x0.toPrecision(4)} to ${bin.x1.toPrecision(4)}: ${bin.count} compounds`}</title></rect>;
            })}
            <text x={margin.left} y={height - 38} fontSize="13" fill="#52606d">{histogram.domain[0].toPrecision(4)}</text>
            <text x={width - margin.right} y={height - 38} textAnchor="end" fontSize="13" fill="#52606d">{histogram.domain[1].toPrecision(4)}</text>
            <text x={margin.left + chartWidth / 2} y={height - 10} textAnchor="middle" fontSize="14" fill="#263238">{plotEndpointLabel(endpointKey)}</text>
            <text transform={`translate(18 ${margin.top + chartHeight / 2}) rotate(-90)`} textAnchor="middle" fontSize="14" fill="#263238">Compound count</text>
          </svg>
        </Box>
      ) : null}
    </Stack>
  );
}

const SCATTER_WIDTH = 900;
const SCATTER_HEIGHT = 500;
const SCATTER_PADDING = { left: 72, right: 24, top: 24, bottom: 58 };

function selectedPointLabel(point, xKey, yKey) {
  if (!point) return '';
  const name = point.displayName || point.moleculeId;
  const source = point.sourceName ? ` · ${point.sourceName}` : '';
  return `${name} · ${ADMET_ENDPOINT_BY_KEY.get(xKey).label}: ${point.x} · ${ADMET_ENDPOINT_BY_KEY.get(yKey).label}: ${point.y}${source}`;
}

function ScatterPlot({ molecules, xKey, yKey }) {
  const canvasRef = useRef(null);
  const [hovered, setHovered] = useState(null);
  const [selected, setSelected] = useState(null);
  const scatter = useMemo(() => prepareAdmetScatterPoints(molecules, xKey, yKey), [molecules, xKey, yKey]);
  const projected = useMemo(
    () => projectAdmetScatterPoints(scatter.points, scatter.xDomain, scatter.yDomain, SCATTER_WIDTH, SCATTER_HEIGHT, SCATTER_PADDING),
    [scatter],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = SCATTER_WIDTH * ratio;
    canvas.height = SCATTER_HEIGHT * ratio;
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, SCATTER_WIDTH, SCATTER_HEIGHT);
    context.strokeStyle = '#cbd5e1';
    context.lineWidth = 1;
    for (let tick = 0; tick <= 5; tick += 1) {
      const x = SCATTER_PADDING.left + ((SCATTER_WIDTH - SCATTER_PADDING.left - SCATTER_PADDING.right) * tick) / 5;
      const y = SCATTER_PADDING.top + ((SCATTER_HEIGHT - SCATTER_PADDING.top - SCATTER_PADDING.bottom) * tick) / 5;
      context.beginPath(); context.moveTo(x, SCATTER_PADDING.top); context.lineTo(x, SCATTER_HEIGHT - SCATTER_PADDING.bottom); context.stroke();
      context.beginPath(); context.moveTo(SCATTER_PADDING.left, y); context.lineTo(SCATTER_WIDTH - SCATTER_PADDING.right, y); context.stroke();
    }
    for (const point of projected) {
      const highlighted = (selected && selected.sourceIndex === point.sourceIndex) || (hovered && hovered.sourceIndex === point.sourceIndex);
      context.beginPath();
      context.arc(point.screenX, point.screenY, highlighted ? 5 : 2.6, 0, Math.PI * 2);
      context.fillStyle = highlighted ? '#c2410c' : 'rgba(30, 102, 173, 0.68)';
      context.fill();
    }
  }, [hovered, projected, selected]);

  function pointAtEvent(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * SCATTER_WIDTH;
    const y = ((event.clientY - bounds.top) / bounds.height) * SCATTER_HEIGHT;
    let nearest = null;
    let distanceSquared = 100;
    for (const point of projected) {
      const candidate = (point.screenX - x) ** 2 + (point.screenY - y) ** 2;
      if (candidate <= distanceSquared) { nearest = point; distanceSquared = candidate; }
    }
    return nearest;
  }

  function handleKeyboard(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !projected.length) return;
    event.preventDefault();
    const current = selected ? projected.findIndex((point) => point.sourceIndex === selected.sourceIndex) : -1;
    let next = event.key === 'Home' ? 0 : event.key === 'End' ? projected.length - 1 : current + (event.key === 'ArrowLeft' ? -1 : 1);
    if (next < 0) next = projected.length - 1;
    if (next >= projected.length) next = 0;
    setSelected(projected[next]);
  }

  const identified = hovered || selected;
  return (
    <Stack spacing={1.25} data-testid="admet-scatter-view">
      <PlotCounts {...scatter} unavailableLabel="unavailable for one or both selected properties" />
      {!molecules.length ? <Alert severity="info">No compounds match current search and filters.</Alert> : null}
      {molecules.length && !scatter.plottedCount ? <Alert severity="info">No molecules have available predictions for both selected properties.</Alert> : null}
      {scatter.plottedCount ? (
        <>
          <Box sx={{ position: 'relative', width: '100%', maxWidth: SCATTER_WIDTH, overflow: 'hidden' }}>
            <canvas
              ref={canvasRef}
              data-testid="admet-scatter-canvas"
              tabIndex={0}
              aria-label={`Scatter plot with ${scatter.plottedCount} compounds. Use left and right arrow keys to identify points.`}
              onPointerMove={(event) => { const point = pointAtEvent(event); if (point?.sourceIndex !== hovered?.sourceIndex) setHovered(point); }}
              onPointerLeave={() => setHovered(null)}
              onClick={(event) => setSelected(pointAtEvent(event))}
              onKeyDown={handleKeyboard}
              style={{ display: 'block', width: '100%', height: 'auto', aspectRatio: `${SCATTER_WIDTH} / ${SCATTER_HEIGHT}`, border: '1px solid #cbd5e1', borderRadius: 6 }}
            />
          </Box>
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={0.5}>
            <Typography variant="caption">X: {plotEndpointLabel(xKey)}</Typography>
            <Typography variant="caption">Y: {plotEndpointLabel(yKey)}</Typography>
          </Stack>
          <Paper variant="outlined" sx={{ p: 1.25, minHeight: 48 }} aria-live="polite">
            <Typography variant="caption" color="text.secondary">{identified ? (hovered ? 'Point under pointer' : 'Selected compound') : 'Hover, click, or focus the canvas and use arrow keys to identify a compound.'}</Typography>
            {identified ? <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{selectedPointLabel(identified, xKey, yKey)}</Typography> : null}
          </Paper>
        </>
      ) : null}
    </Stack>
  );
}

export default function AdmetPlots({ molecules = [], initialState = DEFAULT_ADMET_PLOT_STATE }) {
  const [state, dispatch] = useReducer(admetPlotStateReducer, { ...DEFAULT_ADMET_PLOT_STATE, ...initialState });
  return (
    <Paper elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="h2">ADMET property plots</Typography>
          <Typography variant="body2" color="text.secondary">Raw available prediction values for the current shared search and filter result.</Typography>
        </Box>
        <ToggleButtonGroup exclusive size="small" value={state.plotType} onChange={(_, value) => { if (value) dispatch({ type: 'set-plot-type', plotType: value }); }} aria-label="ADMET plot type">
          <ToggleButton value="distribution">Distribution</ToggleButton>
          <ToggleButton value="scatter">Scatter</ToggleButton>
        </ToggleButtonGroup>
        {state.plotType === 'distribution' ? (
          <>
            <EndpointSelect id="admet-distribution-property" label="Property" value={state.distributionKey} onChange={(endpointKey) => dispatch({ type: 'set-distribution-key', endpointKey })} />
            <DistributionPlot molecules={molecules} endpointKey={state.distributionKey} />
          </>
        ) : (
          <>
            <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap flexWrap="wrap" spacing={1.25}>
              <EndpointSelect id="admet-scatter-x" label="X axis" value={state.xKey} exclude={state.yKey} onChange={(endpointKey) => dispatch({ type: 'set-x-key', endpointKey })} />
              <EndpointSelect id="admet-scatter-y" label="Y axis" value={state.yKey} exclude={state.xKey} onChange={(endpointKey) => dispatch({ type: 'set-y-key', endpointKey })} />
            </Stack>
            <ScatterPlot molecules={molecules} xKey={state.xKey} yKey={state.yKey} />
          </>
        )}
      </Stack>
    </Paper>
  );
}
