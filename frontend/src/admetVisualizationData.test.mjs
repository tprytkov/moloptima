import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ADMET_ENDPOINT_REGISTRY, normalizeAdmetAnalysis } from './admetAnalysisData.js';
import {
  admetEndpointScale,
  admetEndpointThreshold,
  admetVisualizationValue,
  buildAdmetHeatMap,
  heatMapCellDescription,
  normalizeAdmetDisplayValue,
  selectedAdmetMolecule,
} from './admetVisualizationData.js';

function molecule(id, values = {}, statuses = {}) {
  const properties = Object.fromEntries(ADMET_ENDPOINT_REGISTRY.map((endpoint) => {
    const provided = Object.hasOwn(values, endpoint.key) ? values[endpoint.key] : null;
    const status = statuses[endpoint.key] || (provided === null ? 'endpoint_not_returned' : 'available');
    return [endpoint.key, {
      value: endpoint.valueType === 'regression' ? provided : null,
      probability: endpoint.valueType === 'regression' ? null : provided,
      classification: endpoint.valueType === 'regression' || provided === null ? null : provided >= 0.5 ? 'Positive' : 'Negative',
      unit: endpoint.unit,
      status: { code: status, label: status === 'available' ? 'Results available' : status === 'failed' ? 'Failed' : 'Not available' },
      raw: endpoint.key === 'gmc_mpnn_bbb' ? { threshold: 0.5, threshold_status: 'provisional_raw', calibration_status: 'not_frozen' } : null,
    }];
  }));
  return { moleculeId: id, displayName: `Molecule ${id}`, sourceIndex: Number(id.replace(/\D/g, '')) || 0, properties };
}

test('visualization extraction preserves zero and one classification probabilities', () => {
  assert.equal(admetVisualizationValue(molecule('m0', { hia_hou: 0 }), 'hia_hou'), 0);
  assert.equal(admetVisualizationValue(molecule('m1', { hia_hou: 1 }), 'hia_hou'), 1);
});

test('regression extraction preserves zero and excludes failed or missing values', () => {
  assert.equal(admetVisualizationValue(molecule('m0', { caco2_wang: 0 }), 'caco2_wang'), 0);
  assert.equal(admetVisualizationValue(molecule('mf', { caco2_wang: 2 }, { caco2_wang: 'failed' }), 'caco2_wang'), null);
  assert.equal(admetVisualizationValue(molecule('mm'), 'caco2_wang'), null);
});

test('only BBB receives an authoritative visualization threshold', () => {
  assert.equal(admetEndpointThreshold({}, 'gmc_mpnn_bbb'), 0.5);
  assert.equal(admetEndpointThreshold({ raw: { threshold: 0.5 } }, 'gmc_mpnn_bbb'), 0.5);
  assert.equal(admetEndpointThreshold({ raw: { threshold: 0.5 } }, 'hia_hou'), null);
});

test('heat map preserves exact registry endpoint order and stable molecule identity', () => {
  const data = buildAdmetHeatMap([molecule('a', { hia_hou: 0.2 }), molecule('b', { hia_hou: 0.8 })]);
  assert.deepEqual(data.endpoints.map(({ key }) => key), ADMET_ENDPOINT_REGISTRY.map(({ key }) => key));
  assert.deepEqual(data.rows.map(({ moleculeId }) => moleculeId), ['a', 'b']);
});

test('classification heat map uses fixed probability scaling', () => {
  const data = buildAdmetHeatMap([molecule('a', { hia_hou: 0.2 }), molecule('b', { hia_hou: 0.8 })]);
  assert.deepEqual(data.scales.hia_hou, { minimum: 0, maximum: 1, count: 2, type: 'probability' });
  assert.equal(data.rows[0].cells[0].normalizedValue, 0.2);
});

test('regression heat map scales each endpoint independently without changing raw values', () => {
  const data = buildAdmetHeatMap([
    molecule('a', { caco2_wang: -6, ppbr_az: 20 }),
    molecule('b', { caco2_wang: -4, ppbr_az: 80 }),
  ]);
  const cacoIndex = ADMET_ENDPOINT_REGISTRY.findIndex(({ key }) => key === 'caco2_wang');
  const ppbIndex = ADMET_ENDPOINT_REGISTRY.findIndex(({ key }) => key === 'ppbr_az');
  assert.equal(data.rows[0].cells[cacoIndex].rawValue, -6);
  assert.equal(data.rows[0].cells[cacoIndex].normalizedValue, 0);
  assert.equal(data.rows[0].cells[ppbIndex].rawValue, 20);
  assert.equal(data.rows[1].cells[ppbIndex].normalizedValue, 1);
});

test('constant regression values remain visible at the center of their display scale', () => {
  const scale = admetEndpointScale([molecule('a', { vdss_lombardo: 2 }), molecule('b', { vdss_lombardo: 2 })], 'vdss_lombardo');
  assert.equal(normalizeAdmetDisplayValue(2, scale), 0.5);
});

test('missing cells remain missing rather than becoming zero or negative class', () => {
  const data = buildAdmetHeatMap([molecule('missing')]);
  assert.equal(data.rows[0].cells[0].rawValue, null);
  assert.equal(data.rows[0].cells[0].normalizedValue, null);
  assert.equal(data.rows[0].cells[0].classification, null);
});

test('failed and not-run states remain distinguishable in heat map descriptions', () => {
  const failed = buildAdmetHeatMap([molecule('failed', { hia_hou: 0.4 }, { hia_hou: 'failed' })]).rows[0];
  assert.match(heatMapCellDescription(failed, failed.cells[0]), /Failed/);
  const notRunMolecule = molecule('not-run');
  notRunMolecule.properties.hia_hou.status = { code: 'not_run', label: 'Not run' };
  const notRun = buildAdmetHeatMap([notRunMolecule]).rows[0];
  assert.match(heatMapCellDescription(notRun, notRun.cells[0]), /Not run/);
  const invalidMolecule = molecule('invalid');
  invalidMolecule.properties.hia_hou.status = { code: 'invalid_molecule', label: 'Invalid molecule' };
  const invalid = buildAdmetHeatMap([invalidMolecule]).rows[0];
  assert.match(heatMapCellDescription(invalid, invalid.cells[0]), /Invalid molecule/);
});

test('table normalization and visualization extraction use the same authoritative raw result values', () => {
  const [normalized] = normalizeAdmetAnalysis([{
    molecule_id: 'source-1',
    admet_model_status: 'model_available',
    admet_predictions: { hia_hou: { calibrated_probability: 0, binary_prediction: 0, status: 'success' } },
    bbb_status: 'success',
    bbb_result: { ensemble_probability: 0.823, raw_classification: 'BBB+', threshold: 0.5, threshold_status: 'provisional_raw', calibration_status: 'not_frozen' },
    admet_regression: { status: 'success', endpoints: { caco2_wang: { status: 'success', ensemble_mean_log10_papp_cm_per_s: 0, unit: 'log10(Papp [cm/s])' } } },
  }]).molecules;
  assert.equal(normalized.properties.hia_hou.probability, 0);
  assert.equal(admetVisualizationValue(normalized, 'hia_hou'), normalized.properties.hia_hou.probability);
  assert.equal(admetVisualizationValue(normalized, 'gmc_mpnn_bbb'), normalized.properties.gmc_mpnn_bbb.probability);
  assert.equal(admetVisualizationValue(normalized, 'caco2_wang'), normalized.properties.caco2_wang.value);
});

test('heat map tooltip text includes raw value, class, threshold, and BBB statuses', () => {
  const data = buildAdmetHeatMap([molecule('bbb', { gmc_mpnn_bbb: 0.823 })]);
  const index = ADMET_ENDPOINT_REGISTRY.findIndex(({ key }) => key === 'gmc_mpnn_bbb');
  const description = heatMapCellDescription(data.rows[0], data.rows[0].cells[index]);
  assert.match(description, /0\.823 probability/);
  assert.match(description, /Predicted class: Positive/);
  assert.match(description, /Threshold: 0\.5/);
  assert.match(description, /provisional_raw/);
  assert.match(description, /not_frozen/);
});

test('linked selection resolves by molecule ID rather than display name', () => {
  const molecules = [molecule('stable-a'), molecule('stable-b')];
  molecules[0].displayName = 'Duplicate';
  molecules[1].displayName = 'Duplicate';
  assert.equal(selectedAdmetMolecule(molecules, 'stable-b').moleculeId, 'stable-b');
});

test('5,000-molecule heat map derivation retains every row without sampling', () => {
  const molecules = Array.from({ length: 5000 }, (_, index) => molecule(`m${index}`, { hia_hou: (index % 100) / 100, caco2_wang: index % 13 }));
  const started = performance.now();
  const data = buildAdmetHeatMap(molecules);
  assert.equal(data.rows.length, 5000);
  assert.equal(data.rows[4999].moleculeId, 'm4999');
  assert.ok(performance.now() - started < 2500);
});
