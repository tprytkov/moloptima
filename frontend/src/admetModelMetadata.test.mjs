import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findAdmetRuntimeIdentity,
  formatAdmetRuntimeIdentity,
  formatAdmetThreshold,
  resolveAdmetEndpointModelMetadata,
} from './admetModelMetadata.js';

const bbbEndpoint = {
  key: 'gmc_mpnn_bbb', modelFamily: 'gmc_mpnn_bbb', modelName: 'GMC-MPNN BBB five-seed ensemble',
  valueType: 'binary_classification', unit: 'Raw ensemble probability',
};

function metadata(raw = {}, overrides = {}) {
  return resolveAdmetEndpointModelMetadata({
    endpoint: bbbEndpoint,
    property: {
      value: 'BBB+', classification: 'BBB+', probability: 0.8123,
      modelName: 'GMC-MPNN', status: { code: 'available', label: 'Results available' }, raw,
      ...overrides,
    },
    runtimeIdentities: [{ family: 'gmc_mpnn_bbb', runtime_source: 'packaged', runner_identity: 'scripts/predict_bbb.py@abc' }],
  });
}

test('BBB probability, threshold, calibration metadata, and runtime identity are preserved', () => {
  const result = metadata({ threshold: 0.7464, threshold_status: 'frozen', calibration_method: 'platt_scaling', calibration_status: 'frozen', seed_probabilities: { 1: 0.8, 2: 0.9 } });
  assert.equal(result.probability, 0.8123);
  assert.equal(result.threshold, 0.7464);
  assert.equal(result.calibrationMethod, 'platt_scaling');
  assert.equal(result.calibrationStatus, 'frozen');
  assert.equal(result.ensembleSize, 2);
  assert.equal(result.runtimeIdentity.runner_identity, 'scripts/predict_bbb.py@abc');
});

test('missing threshold and calibration stay missing without replacement metadata', () => {
  const result = metadata({});
  assert.equal(result.threshold, null);
  assert.equal(result.calibrationMethod, null);
  assert.equal(formatAdmetThreshold(result.threshold), null);
});

test('regression and ChemBERTa families resolve without scientific reinterpretation', () => {
  const regression = resolveAdmetEndpointModelMetadata({
    endpoint: { key: 'caco2_wang', modelFamily: 'chemprop_regression', modelName: 'Chemprop regression', valueType: 'regression', unit: 'x' },
    property: { value: -5, modelName: 'chemprop_dmpnn', status: { code: 'available', label: 'Results available' }, raw: {} },
  });
  const chemberta = resolveAdmetEndpointModelMetadata({
    endpoint: { key: 'hia_hou', modelFamily: 'chemberta', modelName: 'ChemBERTa multitask classifier', valueType: 'binary_classification', unit: 'Probability' },
    property: { value: 1, probability: 0.9, status: { code: 'available', label: 'Results available' }, raw: {} },
  });
  assert.equal(regression.modelFamilyLabel, 'Chemprop regression');
  assert.equal(chemberta.modelFamilyLabel, 'ChemBERTa');
  assert.equal(chemberta.probability, 0.9);
});

test('unavailable and failed statuses are preserved and missing metadata does not crash', () => {
  assert.equal(metadata({}, { status: { code: 'model_unavailable', label: 'Model unavailable' } }).status.code, 'model_unavailable');
  assert.equal(metadata({}, { status: { code: 'failed', label: 'Failed' } }).status.code, 'failed');
  assert.doesNotThrow(() => resolveAdmetEndpointModelMetadata({ endpoint: bbbEndpoint, property: null }));
});

test('runtime formatting refuses absolute local paths and preserves portable identities', () => {
  assert.equal(formatAdmetRuntimeIdentity({ runner_identity: 'scripts/predict.py@abc' }), 'predict.py@abc');
  assert.equal(formatAdmetRuntimeIdentity({ runner_identity: 'C:\\Users\\private\\runner.py' }), null);
  assert.equal(findAdmetRuntimeIdentity([{ family: 'gmc_bbb' }], 'gmc_mpnn_bbb').family, 'gmc_bbb');
});
