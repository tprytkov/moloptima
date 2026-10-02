const FAMILY_LABELS = Object.freeze({
  chemberta: 'ChemBERTa',
  chemprop_regression: 'Chemprop regression',
  gmc_mpnn_bbb: 'GMC-MPNN BBB',
});

function present(value) {
  return value !== null && value !== undefined && value !== '';
}

function finiteNumber(value) {
  if (!present(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeIdentityValue(value) {
  if (!present(value)) return null;
  const text = String(value);
  const normalized = text.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return null;
  return text;
}

export function findAdmetRuntimeIdentity(runtimeIdentities = [], modelFamily) {
  const aliases = modelFamily === 'gmc_mpnn_bbb' ? new Set(['gmc_mpnn_bbb', 'gmc_bbb']) : new Set([modelFamily]);
  return runtimeIdentities.find((identity) => identity && aliases.has(identity.family)) || null;
}

function modelVersion(raw, familyRaw, runtimeIdentity) {
  const manifest = runtimeIdentity?.production_manifest_identity || {};
  return [
    raw?.model_interface_version,
    raw?.manifest_version,
    familyRaw?.model_interface_version,
    familyRaw?.manifest_version,
    familyRaw?.manifest_schema_version,
    manifest.model_interface_version,
    manifest.manifest_version,
    manifest.manifest_schema_version,
  ].find(present) || null;
}

function ensembleSize(raw) {
  if (raw?.seed_probabilities && typeof raw.seed_probabilities === 'object') {
    return Object.keys(raw.seed_probabilities).length || null;
  }
  const seedKeys = Object.keys(raw || {}).filter((key) => /^seed\d+_/.test(key));
  return seedKeys.length || null;
}

export function resolveAdmetEndpointModelMetadata({ endpoint, property, familyRaw = null, runtimeIdentities = [] }) {
  const raw = property?.raw && typeof property.raw === 'object' ? property.raw : {};
  const runtimeIdentity = findAdmetRuntimeIdentity(runtimeIdentities, endpoint.modelFamily);
  const calibration = raw.calibration && typeof raw.calibration === 'object' ? raw.calibration : {};
  return {
    endpointKey: endpoint.key,
    modelFamily: endpoint.modelFamily,
    modelFamilyLabel: FAMILY_LABELS[endpoint.modelFamily] || endpoint.modelFamily,
    modelName: property?.modelName || familyRaw?.model_family || raw.model_family || endpoint.modelName,
    modelVersion: modelVersion(raw, familyRaw, runtimeIdentity),
    predictionType: endpoint.valueType,
    value: property?.value ?? null,
    classification: property?.classification ?? null,
    probability: property?.probability ?? null,
    threshold: finiteNumber(raw.threshold),
    thresholdStatus: safeIdentityValue(raw.threshold_status),
    calibrationMethod: safeIdentityValue(raw.calibration_method ?? calibration.method),
    calibrationStatus: safeIdentityValue(raw.calibration_status ?? calibration.status),
    runtimeIdentity,
    ensembleSize: ensembleSize(raw),
    status: property?.status || null,
    unit: property?.unit || endpoint.unit || null,
  };
}

export function formatAdmetThreshold(value) {
  return Number.isFinite(value)
    ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(value)
    : null;
}

export function formatAdmetMetadataLabel(value) {
  if (!present(value)) return null;
  return String(value).replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatAdmetRuntimeIdentity(identity) {
  if (!identity || typeof identity !== 'object') return null;
  const runner = safeIdentityValue(identity.runner_identity);
  if (runner) return runner.replaceAll('\\', '/').split('/').at(-1);
  const source = safeIdentityValue(identity.runtime_source || identity.model_source);
  if (source) return formatAdmetMetadataLabel(source);
  const versions = identity.runtime_versions && typeof identity.runtime_versions === 'object'
    ? identity.runtime_versions
    : {};
  const version = safeIdentityValue(versions.chemprop || versions.torch || versions.python);
  return version ? `Runtime ${version}` : null;
}

export function endpointMetadataFromMolecules(molecules = [], endpoint) {
  if (!endpoint) return null;
  for (const molecule of molecules) {
    const metadata = molecule?.properties?.[endpoint.key]?.modelMetadata;
    if (metadata) return metadata;
  }
  return resolveAdmetEndpointModelMetadata({ endpoint, property: null });
}
