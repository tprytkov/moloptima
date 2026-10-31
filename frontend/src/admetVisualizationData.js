import { ADMET_ENDPOINT_BY_KEY, ADMET_ENDPOINT_REGISTRY } from './admetAnalysisData.js';

export const ADMET_CLASSIFICATION_ENDPOINT_KEYS = Object.freeze(
  ADMET_ENDPOINT_REGISTRY.filter(({ valueType }) => valueType === 'binary_classification').map(({ key }) => key),
);

export const ADMET_REGRESSION_ENDPOINT_KEYS = Object.freeze(
  ADMET_ENDPOINT_REGISTRY.filter(({ valueType }) => valueType === 'regression').map(({ key }) => key),
);

const NUMBER_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function admetVisualizationValue(molecule, endpointKey) {
  const endpoint = ADMET_ENDPOINT_BY_KEY.get(endpointKey);
  const property = molecule?.properties?.[endpointKey];
  if (!endpoint || property?.status?.code !== 'available') return null;
  return finiteNumber(endpoint.valueType === 'regression' ? property.value : property.probability);
}

export function admetEndpointThreshold(property, endpointKey) {
  if (endpointKey !== 'gmc_mpnn_bbb') return null;
  return finiteNumber(property?.raw?.threshold) ?? 0.5;
}

export function admetEndpointScale(molecules = [], endpointKey) {
  const endpoint = ADMET_ENDPOINT_BY_KEY.get(endpointKey);
  if (!endpoint) return { minimum: 0, maximum: 1, count: 0, type: 'unknown' };
  if (endpoint.valueType === 'binary_classification') {
    const count = molecules.reduce(
      (total, molecule) => total + (admetVisualizationValue(molecule, endpointKey) === null ? 0 : 1),
      0,
    );
    return { minimum: 0, maximum: 1, count, type: 'probability' };
  }
  let minimum = Infinity;
  let maximum = -Infinity;
  let count = 0;
  for (const molecule of molecules) {
    const value = admetVisualizationValue(molecule, endpointKey);
    if (value === null) continue;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
    count += 1;
  }
  if (!count) return { minimum: 0, maximum: 1, count: 0, type: 'within-endpoint' };
  return { minimum, maximum, count, type: 'within-endpoint' };
}

export function normalizeAdmetDisplayValue(value, scale) {
  if (!Number.isFinite(value) || !scale?.count) return null;
  if (scale.maximum === scale.minimum) return 0.5;
  return Math.max(0, Math.min(1, (value - scale.minimum) / (scale.maximum - scale.minimum)));
}

export function formatAdmetVisualizationValue(value, endpointKey, unitOverride = '') {
  if (!Number.isFinite(value)) return 'Not available';
  const endpoint = ADMET_ENDPOINT_BY_KEY.get(endpointKey);
  if (endpoint?.valueType === 'binary_classification') return `${value.toFixed(3)} probability`;
  return `${NUMBER_FORMAT.format(value)} ${unitOverride || endpoint?.unit || ''}`.trim();
}

export function buildAdmetHeatMap(molecules = []) {
  const scales = Object.fromEntries(
    ADMET_ENDPOINT_REGISTRY.map(({ key }) => [key, admetEndpointScale(molecules, key)]),
  );
  const rows = molecules.map((molecule) => ({
    moleculeId: molecule.moleculeId,
    displayName: molecule.displayName,
    sourceIndex: molecule.sourceIndex,
    molecule,
    cells: ADMET_ENDPOINT_REGISTRY.map((endpoint) => {
      const property = molecule.properties?.[endpoint.key];
      const rawValue = admetVisualizationValue(molecule, endpoint.key);
      return {
        endpointKey: endpoint.key,
        rawValue,
        normalizedValue: normalizeAdmetDisplayValue(rawValue, scales[endpoint.key]),
        unit: property?.unit || endpoint.unit,
        classification: property?.classification || null,
        threshold: admetEndpointThreshold(property, endpoint.key),
        thresholdStatus: property?.raw?.threshold_status || null,
        calibrationStatus: property?.raw?.calibration_status || null,
        statusCode: property?.status?.code || 'endpoint_not_returned',
        statusLabel: property?.status?.label || 'Not available',
      };
    }),
  }));
  return { endpoints: ADMET_ENDPOINT_REGISTRY, rows, scales };
}

export function heatMapCellDescription(row, cell) {
  const endpoint = ADMET_ENDPOINT_BY_KEY.get(cell.endpointKey);
  const identity = row.displayName || row.moleculeId;
  if (cell.rawValue === null) return `${identity}. ${endpoint.label}: ${cell.statusLabel || 'Not available'}.`;
  const parts = [
    `${identity}. ${endpoint.label}: ${formatAdmetVisualizationValue(cell.rawValue, cell.endpointKey, cell.unit)}.`,
  ];
  if (cell.classification) parts.push(`Predicted class: ${cell.classification}.`);
  if (cell.threshold !== null) parts.push(`Threshold: ${cell.threshold}.`);
  if (cell.thresholdStatus) parts.push(`Threshold status: ${cell.thresholdStatus}.`);
  if (cell.calibrationStatus) parts.push(`Calibration status: ${cell.calibrationStatus}.`);
  return parts.join(' ');
}

export function selectedAdmetMolecule(molecules = [], moleculeId = '') {
  return molecules.find((molecule) => molecule.moleculeId === moleculeId) || molecules[0] || null;
}
