import { ADMET_STATUS_PRESENTATION, deriveAdmetFamilyStatuses, normalizeAdmetStatus } from './admetStatus.js';

export const ADMET_ENDPOINT_REGISTRY = Object.freeze([
  { key: 'hia_hou', label: 'HIA', category: 'Absorption', unit: 'Probability', modelFamily: 'chemberta', modelName: 'ChemBERTa multitask classifier', valueType: 'binary_classification' },
  { key: 'pgp_broccatelli', label: 'P-gp inhibition', category: 'Absorption', unit: 'Probability', modelFamily: 'chemberta', modelName: 'ChemBERTa multitask classifier', valueType: 'binary_classification' },
  { key: 'cyp1a2_veith', label: 'CYP1A2 inhibition', category: 'Metabolism', unit: 'Probability', modelFamily: 'chemberta', modelName: 'ChemBERTa multitask classifier', valueType: 'binary_classification' },
  { key: 'cyp2c19_veith', label: 'CYP2C19 inhibition', category: 'Metabolism', unit: 'Probability', modelFamily: 'chemberta', modelName: 'ChemBERTa multitask classifier', valueType: 'binary_classification' },
  { key: 'cyp2c9_veith', label: 'CYP2C9 inhibition', category: 'Metabolism', unit: 'Probability', modelFamily: 'chemberta', modelName: 'ChemBERTa multitask classifier', valueType: 'binary_classification' },
  { key: 'cyp2d6_veith', label: 'CYP2D6 inhibition', category: 'Metabolism', unit: 'Probability', modelFamily: 'chemberta', modelName: 'ChemBERTa multitask classifier', valueType: 'binary_classification' },
  { key: 'cyp3a4_veith', label: 'CYP3A4 inhibition', category: 'Metabolism', unit: 'Probability', modelFamily: 'chemberta', modelName: 'ChemBERTa multitask classifier', valueType: 'binary_classification' },
  { key: 'herg_karim', label: 'hERG liability', category: 'Toxicity', unit: 'Probability', modelFamily: 'chemberta', modelName: 'ChemBERTa multitask classifier', valueType: 'binary_classification' },
  { key: 'ames', label: 'AMES mutagenicity', category: 'Toxicity', unit: 'Probability', modelFamily: 'chemberta', modelName: 'ChemBERTa multitask classifier', valueType: 'binary_classification' },
  { key: 'gmc_mpnn_bbb', label: 'BBB permeability', category: 'Distribution', unit: 'Raw ensemble probability', modelFamily: 'gmc_mpnn_bbb', modelName: 'GMC-MPNN BBB five-seed ensemble', valueType: 'binary_classification' },
  { key: 'caco2_wang', label: 'Caco-2 permeability', category: 'Absorption', unit: 'log10(Papp [cm/s])', modelFamily: 'chemprop_regression', modelName: 'Chemprop regression', valueType: 'regression' },
  { key: 'lipophilicity_astrazeneca', label: 'Lipophilicity', category: 'Physicochemical', unit: 'log ratio', modelFamily: 'chemprop_regression', modelName: 'Chemprop regression', valueType: 'regression' },
  { key: 'solubility_aqsoldb', label: 'Aqueous solubility', category: 'Solubility', unit: 'log10(mol/L)', modelFamily: 'chemprop_regression', modelName: 'Chemprop regression', valueType: 'regression' },
  { key: 'ppbr_az', label: 'Plasma protein binding', category: 'Distribution', unit: 'percent bound', modelFamily: 'chemprop_regression', modelName: 'Chemprop regression', valueType: 'regression' },
  { key: 'vdss_lombardo', label: 'Volume of distribution', category: 'Distribution', unit: 'L/kg', modelFamily: 'chemprop_regression', modelName: 'Chemprop regression', valueType: 'regression' },
]);

export const ADMET_ENDPOINT_BY_KEY = new Map(ADMET_ENDPOINT_REGISTRY.map((endpoint) => [endpoint.key, endpoint]));
export const ADMET_PROPERTY_TABLE_ENDPOINTS = Object.freeze([
  'caco2_wang',
  'lipophilicity_astrazeneca',
  'solubility_aqsoldb',
  'ppbr_az',
  'vdss_lombardo',
  'gmc_mpnn_bbb',
]);

const ENDPOINT_NOT_RETURNED = ADMET_STATUS_PRESENTATION.endpoint_not_returned;

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function propertyStatus(familyStatus, endpoint, hasValue) {
  const endpointStatus = endpoint && Object.hasOwn(endpoint, 'status')
    ? normalizeAdmetStatus(endpoint.status, hasValue)
    : null;
  if (endpointStatus && !['available', 'not_run'].includes(endpointStatus.code)) return endpointStatus;
  if (familyStatus.code !== 'available') return familyStatus;
  return hasValue ? familyStatus : ENDPOINT_NOT_RETURNED;
}

function regressionValue(endpoint) {
  if (!endpoint || typeof endpoint !== 'object') return null;
  const valueKey = Object.keys(endpoint).find((key) => key.startsWith('ensemble_mean_'));
  return valueKey ? finiteNumber(endpoint[valueKey]) : finiteNumber(endpoint.ensemble_mean);
}

function normalizeRegressionProperty(row, metadata, familyStatus) {
  const family = row.admet_regression && typeof row.admet_regression === 'object' ? row.admet_regression : {};
  const endpoint = family.endpoints?.[metadata.key];
  const value = regressionValue(endpoint);
  return {
    endpointKey: metadata.key,
    value,
    displayValue: null,
    unit: endpoint?.unit || metadata.unit,
    status: propertyStatus(familyStatus, endpoint, value !== null),
    modelFamily: metadata.modelFamily,
    modelName: family.model_family || endpoint?.model_family || metadata.modelName,
    raw: endpoint ?? null,
  };
}

function normalizeClassificationProperty(row, metadata, familyStatus) {
  const endpoint = row.admet_predictions?.[metadata.key];
  const value = endpoint?.binary_prediction === 0 || endpoint?.binary_prediction === 1
    ? endpoint.binary_prediction
    : null;
  const probability = finiteNumber(endpoint?.calibrated_probability);
  return {
    endpointKey: metadata.key,
    value,
    classification: value === 1 ? 'Positive' : value === 0 ? 'Negative' : null,
    probability,
    displayValue: null,
    unit: metadata.unit,
    status: propertyStatus(familyStatus, endpoint, probability !== null || value !== null),
    modelFamily: metadata.modelFamily,
    modelName: metadata.modelName,
    raw: endpoint ?? null,
  };
}

function normalizeBbbProperty(row, metadata, familyStatus) {
  const endpoint = row.bbb_result && typeof row.bbb_result === 'object' ? row.bbb_result : null;
  const probability = finiteNumber(endpoint?.ensemble_probability);
  const classification = endpoint?.raw_classification || endpoint?.prediction;
  const value = classification && classification !== 'unavailable' ? classification : null;
  return {
    endpointKey: metadata.key,
    value,
    classification: value,
    probability,
    displayValue: null,
    unit: metadata.unit,
    status: propertyStatus(familyStatus, endpoint, probability !== null || value !== null),
    modelFamily: metadata.modelFamily,
    modelName: endpoint?.model_family || metadata.modelName,
    raw: endpoint,
  };
}

export function normalizeAdmetMolecule(row, sourceIndex = 0) {
  const source = row && typeof row === 'object' ? row : {};
  const familyStatuses = deriveAdmetFamilyStatuses(source);
  const properties = {};
  for (const metadata of ADMET_ENDPOINT_REGISTRY) {
    if (metadata.modelFamily === 'chemprop_regression') {
      properties[metadata.key] = normalizeRegressionProperty(source, metadata, familyStatuses.chemprop_regression);
    } else if (metadata.modelFamily === 'gmc_mpnn_bbb') {
      properties[metadata.key] = normalizeBbbProperty(source, metadata, familyStatuses.gmc_mpnn_bbb);
    } else {
      properties[metadata.key] = normalizeClassificationProperty(source, metadata, familyStatuses.chemberta);
    }
  }
  const moleculeId = String(source.molecule_id || source.original_molecule_id || source.canonical_smiles || `Molecule ${sourceIndex + 1}`);
  return {
    moleculeId,
    displayName: String(source.original_molecule_id || moleculeId),
    canonicalSmiles: String(source.canonical_smiles || ''),
    sourceName: String(source.source_filename || source.source_type || ''),
    sourceRecord: String(source.source_record || ''),
    sourceIndex,
    familyStatuses,
    properties,
    source,
  };
}

export function normalizeAdmetAnalysis(rows = []) {
  const safeRows = Array.isArray(rows) ? rows : [];
  return {
    molecules: safeRows.map((row, index) => normalizeAdmetMolecule(row, index)),
    endpoints: ADMET_ENDPOINT_REGISTRY,
  };
}

export function formatAdmetProperty(property, metadata) {
  if (!property || property.status.code !== 'available') return property?.status.label || 'Not predicted';
  if (metadata.valueType === 'regression') {
    return property.value === null
      ? 'Endpoint not returned'
      : new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(property.value);
  }
  const parts = [];
  if (property.classification) parts.push(property.classification);
  if (property.probability !== null) {
    parts.push(`${new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 }).format(property.probability)}`);
  }
  return parts.length ? parts.join(' · ') : 'Endpoint not returned';
}

export function searchAdmetMolecules(molecules, query) {
  const normalizedQuery = String(query || '').trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...molecules];
  return molecules.filter((molecule) => [
    molecule.moleculeId,
    molecule.displayName,
    molecule.canonicalSmiles,
    molecule.sourceName,
  ].some((value) => String(value || '').toLocaleLowerCase().includes(normalizedQuery)));
}

function sortValue(molecule, sortKey) {
  if (sortKey === 'compound') return molecule.displayName || molecule.moleculeId;
  const property = molecule.properties[sortKey];
  if (!property || property.status.code !== 'available') return null;
  return property.probability ?? property.value;
}

export function sortAdmetMolecules(molecules, sortKey = 'compound', direction = 'asc') {
  const factor = direction === 'desc' ? -1 : 1;
  return molecules.map((molecule, index) => ({ molecule, index })).sort((left, right) => {
    const leftValue = sortValue(left.molecule, sortKey);
    const rightValue = sortValue(right.molecule, sortKey);
    if (leftValue === null && rightValue === null) return left.index - right.index;
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    const comparison = typeof leftValue === 'number' && typeof rightValue === 'number'
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: 'base' });
    return comparison === 0 ? left.index - right.index : comparison * factor;
  }).map(({ molecule }) => molecule);
}

export function paginateAdmetMolecules(molecules, page = 0, pageSize = 50) {
  const safePageSize = [25, 50, 100].includes(pageSize) ? pageSize : 50;
  const maxPage = Math.max(0, Math.ceil(molecules.length / safePageSize) - 1);
  const safePage = Math.min(Math.max(0, page), maxPage);
  return {
    rows: molecules.slice(safePage * safePageSize, (safePage + 1) * safePageSize),
    page: safePage,
    pageSize: safePageSize,
    total: molecules.length,
  };
}
