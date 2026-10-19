import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chemicalSpaceConfigurationItems,
  DEFAULT_CHEMICAL_SPACE_CONFIGURATION,
  shouldInvalidateChemicalSpaceResult,
  validateChemicalSpaceConfiguration,
} from './chemicalSpaceConfiguration.js';

test('qualified Chemical Space methods and implemented grouping are valid', () => {
  assert.deepEqual(validateChemicalSpaceConfiguration(DEFAULT_CHEMICAL_SPACE_CONFIGURATION), []);
  assert.deepEqual(chemicalSpaceConfigurationItems(DEFAULT_CHEMICAL_SPACE_CONFIGURATION).map(({ value }) => value), [
    'Morgan fingerprint', 'PCA', 'Tanimoto', 'Source',
  ]);
});

test('unsupported scientific methods and groupings fail closed', () => {
  const errors = validateChemicalSpaceConfiguration({
    representation: 'Descriptor matrix', projection: 'UMAP', similarity: 'Euclidean', grouping: 'activity',
  });
  assert.equal(errors.length, 4);
});

test('applied changes invalidate an existing result but never an absent result', () => {
  const next = { ...DEFAULT_CHEMICAL_SPACE_CONFIGURATION, grouping: 'scaffold' };
  assert.equal(shouldInvalidateChemicalSpaceResult(DEFAULT_CHEMICAL_SPACE_CONFIGURATION, next, true), true);
  assert.equal(shouldInvalidateChemicalSpaceResult(DEFAULT_CHEMICAL_SPACE_CONFIGURATION, next, false), false);
  assert.equal(shouldInvalidateChemicalSpaceResult(next, next, true), false);
});
