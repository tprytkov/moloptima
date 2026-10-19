export const DEFAULT_CHEMICAL_SPACE_CONFIGURATION = Object.freeze({
  representation: 'Morgan fingerprint',
  projection: 'PCA',
  similarity: 'Tanimoto',
  grouping: 'source',
});

export const CHEMICAL_SPACE_GROUPINGS = Object.freeze([
  { value: 'source', label: 'Source' },
  { value: 'scaffold', label: 'Scaffold group' },
]);

export function validateChemicalSpaceConfiguration(configuration) {
  const errors = [];
  if (configuration.representation !== 'Morgan fingerprint') errors.push('Molecular representation must remain Morgan fingerprint.');
  if (configuration.projection !== 'PCA') errors.push('Projection must remain PCA.');
  if (configuration.similarity !== 'Tanimoto') errors.push('Similarity basis must remain Tanimoto.');
  if (!CHEMICAL_SPACE_GROUPINGS.some(({ value }) => value === configuration.grouping)) errors.push('Choose an implemented default grouping.');
  return errors;
}

export function chemicalSpaceConfigurationItems(configuration) {
  const grouping = CHEMICAL_SPACE_GROUPINGS.find(({ value }) => value === configuration.grouping)?.label || 'Unavailable';
  return [
    { label: 'Molecular representation', value: configuration.representation },
    { label: 'Projection', value: configuration.projection },
    { label: 'Similarity basis', value: configuration.similarity },
    { label: 'Default grouping', value: grouping },
  ];
}

export function shouldInvalidateChemicalSpaceResult(previousConfiguration, nextConfiguration, hasResult) {
  return Boolean(hasResult) && JSON.stringify(previousConfiguration) !== JSON.stringify(nextConfiguration);
}
