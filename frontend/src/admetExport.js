import { ADMET_ENDPOINT_REGISTRY } from './admetAnalysisData.js';
import { activeAdmetFilterSummaries } from './admetFilters.js';
import { buildAdmetComparisonRows, resolveAdmetComparisonMolecules } from './admetComparison.js';
import { formatAdmetRuntimeIdentity } from './admetModelMetadata.js';

const MISSING = 'Not available';

export function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function serializeCsv(headers, rows) {
  return [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
}

export function admetExportTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function admetExportFilename(kind, extension, date = new Date()) {
  return `moloptima_admet_${kind}_${admetExportTimestamp(date)}.${extension}`;
}

function contextFields(context, matchingCount) {
  const summaries = activeAdmetFilterSummaries(context.filters);
  return [
    context.exportTimestamp || new Date().toISOString(),
    context.totalMolecules ?? matchingCount,
    matchingCount,
    String(context.query || ''),
    summaries.map(({ label }) => label).join('; '),
  ];
}

function compactModelProvenance(property, endpoint) {
  const metadata = property?.modelMetadata;
  return [
    metadata?.modelFamilyLabel || property?.modelFamily || endpoint.modelFamily,
    metadata?.modelName || property?.modelName || endpoint.modelName,
    metadata?.modelVersion,
    formatAdmetRuntimeIdentity(metadata?.runtimeIdentity),
  ].filter((value) => value !== null && value !== undefined && value !== '').join(' | ');
}

function endpointHeaders(endpoint) {
  const prefix = endpoint.key;
  return endpoint.valueType === 'regression'
    ? [`${prefix}_value`, `${prefix}_unit`, `${prefix}_status`, `${prefix}_model`]
    : [`${prefix}_classification`, `${prefix}_probability`, `${prefix}_unit`, `${prefix}_status`, `${prefix}_model`];
}

function endpointValues(molecule, endpoint) {
  const property = molecule.properties?.[endpoint.key];
  const common = [property?.unit || endpoint.unit || '', property?.status?.code || 'not_run', compactModelProvenance(property, endpoint)];
  if (endpoint.valueType === 'regression') return [Number.isFinite(property?.value) ? property.value : '', ...common];
  return [property?.classification || '', Number.isFinite(property?.probability) ? property.probability : '', ...common];
}

export function admetCsvHeaders({ comparison = false } = {}) {
  const context = comparison ? [] : ['export_timestamp', 'total_molecules', 'matching_molecules', 'text_search_query', 'analysis_filters_applied'];
  return [
    ...context,
    'molecule_id', 'display_name', 'canonical_smiles', 'source_filename', 'source_record',
    ...ADMET_ENDPOINT_REGISTRY.flatMap(endpointHeaders),
  ];
}

function moleculeValues(molecule) {
  return [
    molecule.moleculeId,
    molecule.displayName,
    molecule.canonicalSmiles,
    molecule.sourceName,
    molecule.sourceRecord,
    ...ADMET_ENDPOINT_REGISTRY.flatMap((endpoint) => endpointValues(molecule, endpoint)),
  ];
}

export function buildFilteredAdmetCsv(molecules = [], context = {}) {
  const metadata = contextFields(context, molecules.length);
  return serializeCsv(admetCsvHeaders(), molecules.map((molecule) => [...metadata, ...moleculeValues(molecule)]));
}

function comparisonLabels(molecules) {
  const labels = new Map(molecules.map((molecule) => [molecule.moleculeId, new Map()]));
  for (const row of buildAdmetComparisonRows(molecules)) {
    if (row.endpoint.valueType === 'regression' && row.numericSummary?.count) {
      for (const molecule of molecules) {
        const value = molecule.properties?.[row.endpoint.key]?.value;
        let label = '';
        if (row.numericSummary.equal && Number.isFinite(value)) label = 'Equal';
        else if (Number.isFinite(value) && value === row.numericSummary.lowest) label = 'Lowest';
        else if (Number.isFinite(value) && value === row.numericSummary.highest) label = 'Highest';
        labels.get(molecule.moleculeId).set(row.endpoint.key, label);
      }
    } else if (row.classificationDifferent) {
      for (const molecule of molecules) labels.get(molecule.moleculeId).set(row.endpoint.key, 'Different classification');
    }
  }
  return labels;
}

export function buildComparisonCsv(molecules = [], selectedIds = []) {
  const resolved = resolveAdmetComparisonMolecules(molecules, selectedIds);
  const selected = resolved.map(({ molecule }) => molecule).filter(Boolean);
  const labels = comparisonLabels(selected);
  const headers = [...admetCsvHeaders({ comparison: true }), ...ADMET_ENDPOINT_REGISTRY.map(({ key }) => `${key}_comparison`)];
  const rows = selected.map((molecule) => [
    ...moleculeValues(molecule),
    ...ADMET_ENDPOINT_REGISTRY.map(({ key }) => labels.get(molecule.moleculeId)?.get(key) || ''),
  ]);
  return serializeCsv(headers, rows);
}

export function numericStatistics(values = []) {
  const present = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  if (!present.length) return { n: 0, min: null, median: null, mean: null, max: null };
  const middle = Math.floor(present.length / 2);
  const median = present.length % 2 ? present[middle] : (present[middle - 1] + present[middle]) / 2;
  return { n: present.length, min: present[0], median, mean: present.reduce((sum, value) => sum + value, 0) / present.length, max: present.at(-1) };
}

export function classificationCounts(values = []) {
  const counts = new Map();
  for (const value of values) if (value) counts.set(value, (counts.get(value) || 0) + 1);
  return Object.fromEntries([...counts.entries()].toSorted(([left], [right]) => left.localeCompare(right)));
}

export function summarizeAdmetEndpoint(molecules = [], endpoint) {
  const properties = molecules.map((molecule) => molecule.properties?.[endpoint.key]).filter(Boolean);
  const available = properties.filter((property) => property.status?.code === 'available');
  const result = { endpoint, available: available.length, unavailable: molecules.length - available.length };
  if (endpoint.valueType === 'regression') result.numeric = numericStatistics(available.map(({ value }) => value));
  else {
    result.classes = classificationCounts(available.map(({ classification }) => classification));
    result.probabilities = numericStatistics(available.map(({ probability }) => probability));
  }
  return result;
}

function formatNumber(value) {
  return Number.isFinite(value) ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(value) : MISSING;
}

function modelFamilyLines(molecules) {
  const families = new Map();
  for (const endpoint of ADMET_ENDPOINT_REGISTRY) {
    const property = molecules.find((molecule) => molecule.properties?.[endpoint.key]?.modelMetadata)?.properties?.[endpoint.key];
    const label = property?.modelMetadata?.modelFamilyLabel || endpoint.modelFamily;
    if (!families.has(label)) families.set(label, compactModelProvenance(property, endpoint));
  }
  return [...families.entries()].map(([label, detail]) => `- ${label}: ${detail || 'Model identity unavailable'}`);
}

function filterContextLines(context, matching) {
  const summaries = activeAdmetFilterSummaries(context.filters);
  return [
    `- Molecules analyzed: ${context.totalMolecules ?? matching}`,
    `- Molecules in current filtered set: ${matching}`,
    `- Text search: ${context.query ? `\`${String(context.query).replaceAll('`', '\\`')}\`` : 'None'}`,
    `- Analysis filters applied: ${summaries.length ? summaries.map(({ label }) => label).join('; ') : 'None'}`,
  ];
}

function endpointReportLines(molecules) {
  return ADMET_ENDPOINT_REGISTRY.flatMap((endpoint) => {
    const summary = summarizeAdmetEndpoint(molecules, endpoint);
    const lines = [`### ${endpoint.label}`, `- Available: ${summary.available}; unavailable / failed / not run: ${summary.unavailable}`];
    if (summary.numeric) lines.push(`- Numeric summary (${endpoint.unit}): n=${summary.numeric.n}; min=${formatNumber(summary.numeric.min)}; median=${formatNumber(summary.numeric.median)}; mean=${formatNumber(summary.numeric.mean)}; max=${formatNumber(summary.numeric.max)}`);
    else {
      const counts = Object.entries(summary.classes).map(([label, count]) => `${label}=${count}`).join('; ') || MISSING;
      lines.push(`- Class counts: ${counts}`);
      lines.push(`- Probability summary: n=${summary.probabilities.n}; min=${formatNumber(summary.probabilities.min)}; median=${formatNumber(summary.probabilities.median)}; mean=${formatNumber(summary.probabilities.mean)}; max=${formatNumber(summary.probabilities.max)}`);
    }
    return [...lines, ''];
  });
}

function comparisonReportLines(molecules) {
  if (molecules.length < 2) return [];
  const rows = buildAdmetComparisonRows(molecules);
  const lines = ['## Selected compound comparison', '', `Compounds: ${molecules.map(({ displayName }) => displayName).join('; ')}`, ''];
  for (const row of rows) {
    const values = molecules.map((molecule, index) => {
      const property = row.properties[index];
      const value = row.endpoint.valueType === 'regression'
        ? `${formatNumber(property?.value)} ${property?.unit || row.endpoint.unit}`
        : `${property?.classification || MISSING}${Number.isFinite(property?.probability) ? ` (${formatNumber(property.probability)} probability)` : ''}`;
      return `${molecule.displayName}: ${value} [${property?.status?.code || 'not_run'}]`;
    }).join('; ');
    let note = '';
    if (row.numericSummary?.equal) note = ' — Equal available values';
    else if (row.numericSummary?.count) note = ` — Lowest ${formatNumber(row.numericSummary.lowest)}; Highest ${formatNumber(row.numericSummary.highest)}`;
    else if (row.classificationDifferent) note = ' — Different classification';
    lines.push(`- **${row.endpoint.label}:** ${values}${note}`);
  }
  return [...lines, ''];
}

export function buildAdmetReport(molecules = [], context = {}, comparisonMolecules = []) {
  return [
    '# MolOptima ADMET Analysis Report', '',
    `Generated: ${context.exportTimestamp || new Date().toISOString()}`, '',
    '## Analysis summary', '', ...filterContextLines(context, molecules.length), '',
    '## Model families', '', ...modelFamilyLines(molecules), '',
    '## Endpoint summary', '', ...endpointReportLines(molecules),
    ...comparisonReportLines(comparisonMolecules),
    '## Provenance / interpretation notes', '',
    '- Values are serialized from the existing normalized ADMET analysis data; export does not run inference.',
    '- Probabilities are probabilities, not confidence, uncertainty, or applicability-domain measurements.',
    '- No applicability-domain classification is included.',
    '- Analysis filters are display and exploration filters unless explicitly defined elsewhere as a prioritization rule.',
    '',
  ].join('\n');
}

export function buildComparisonReport(molecules = [], selectedIds = [], context = {}) {
  const selected = resolveAdmetComparisonMolecules(molecules, selectedIds).map(({ molecule }) => molecule).filter(Boolean);
  return buildAdmetReport(selected, { ...context, totalMolecules: molecules.length }, selected);
}
