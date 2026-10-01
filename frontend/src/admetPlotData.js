import { ADMET_ENDPOINT_BY_KEY } from './admetAnalysisData.js';

export const ADMET_PLOT_ENDPOINTS = Object.freeze([
  'caco2_wang',
  'lipophilicity_astrazeneca',
  'solubility_aqsoldb',
  'ppbr_az',
  'vdss_lombardo',
]);

export function numericAdmetPlotValue(molecule, endpointKey) {
  const property = molecule?.properties?.[endpointKey];
  if (property?.status?.code !== 'available') return null;
  const value = endpointKey === 'gmc_mpnn_bbb' ? property.probability : property.value;
  return Number.isFinite(value) ? value : null;
}

export function extractAdmetNumericValues(molecules = [], endpointKey) {
  const observations = [];
  for (const molecule of molecules) {
    const value = numericAdmetPlotValue(molecule, endpointKey);
    if (value !== null) observations.push({ value, molecule });
  }
  return {
    observations,
    values: observations.map(({ value }) => value),
    totalCount: molecules.length,
    plottedCount: observations.length,
    unavailableCount: molecules.length - observations.length,
  };
}

function quantile(sorted, probability) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower] + ((sorted[lower + 1] ?? sorted[lower]) - sorted[lower]) * fraction;
}

function boundedBinCount(sorted) {
  if (sorted.length <= 1 || sorted[0] === sorted.at(-1)) return 1;
  const range = sorted.at(-1) - sorted[0];
  const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);
  const width = iqr > 0 ? (2 * iqr) / Math.cbrt(sorted.length) : 0;
  const estimate = width > 0 ? Math.ceil(range / width) : Math.ceil(Math.sqrt(sorted.length));
  return Math.max(5, Math.min(40, estimate));
}

export function numericDisplayDomain(values = []) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return [0, 1];
  const minimum = Math.min(...finite);
  const maximum = Math.max(...finite);
  if (minimum === maximum) {
    const padding = Math.max(Math.abs(minimum) * 0.05, 0.5);
    return [minimum - padding, maximum + padding];
  }
  const padding = (maximum - minimum) * 0.05;
  return [minimum - padding, maximum + padding];
}

export function createAdmetHistogram(molecules = [], endpointKey) {
  const extracted = extractAdmetNumericValues(molecules, endpointKey);
  const sorted = [...extracted.values].sort((left, right) => left - right);
  if (!sorted.length) return { ...extracted, bins: [], domain: [0, 1], maxCount: 0 };
  const binCount = boundedBinCount(sorted);
  const minimum = sorted[0];
  const maximum = sorted.at(-1);
  const domain = numericDisplayDomain(sorted);
  if (binCount === 1) {
    return { ...extracted, bins: [{ x0: domain[0], x1: domain[1], count: sorted.length }], domain, maxCount: sorted.length };
  }
  const width = (maximum - minimum) / binCount;
  const counts = Array.from({ length: binCount }, () => 0);
  for (const value of sorted) {
    const index = value === maximum ? binCount - 1 : Math.floor((value - minimum) / width);
    counts[Math.max(0, Math.min(binCount - 1, index))] += 1;
  }
  const bins = counts.map((count, index) => ({
    x0: minimum + width * index,
    x1: index === binCount - 1 ? maximum : minimum + width * (index + 1),
    count,
  }));
  return { ...extracted, bins, domain: [minimum, maximum], maxCount: Math.max(...counts) };
}

export function prepareAdmetScatterPoints(molecules = [], xKey, yKey) {
  const points = [];
  for (const molecule of molecules) {
    const x = numericAdmetPlotValue(molecule, xKey);
    const y = numericAdmetPlotValue(molecule, yKey);
    if (x === null || y === null) continue;
    points.push({
      moleculeId: molecule.moleculeId,
      displayName: molecule.displayName,
      sourceName: molecule.sourceName,
      sourceIndex: molecule.sourceIndex,
      x,
      y,
      molecule,
    });
  }
  return {
    points,
    totalCount: molecules.length,
    plottedCount: points.length,
    unavailableCount: molecules.length - points.length,
    xDomain: numericDisplayDomain(points.map(({ x }) => x)),
    yDomain: numericDisplayDomain(points.map(({ y }) => y)),
  };
}

export function projectAdmetScatterPoints(points, xDomain, yDomain, width, height, padding = { left: 72, right: 24, top: 24, bottom: 58 }) {
  const plotWidth = Math.max(1, width - padding.left - padding.right);
  const plotHeight = Math.max(1, height - padding.top - padding.bottom);
  const xSpan = xDomain[1] - xDomain[0] || 1;
  const ySpan = yDomain[1] - yDomain[0] || 1;
  return points.map((point) => ({
    ...point,
    screenX: padding.left + ((point.x - xDomain[0]) / xSpan) * plotWidth,
    screenY: padding.top + plotHeight - ((point.y - yDomain[0]) / ySpan) * plotHeight,
  }));
}

export function plotEndpointLabel(endpointKey) {
  const endpoint = ADMET_ENDPOINT_BY_KEY.get(endpointKey);
  return endpoint ? `${endpoint.label} (${endpoint.unit})` : endpointKey;
}
