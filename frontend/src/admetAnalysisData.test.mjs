import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADMET_ENDPOINT_BY_KEY,
  ADMET_ENDPOINT_REGISTRY,
  formatAdmetProperty,
  normalizeAdmetAnalysis,
  paginateAdmetMolecules,
  searchAdmetMolecules,
  sortAdmetMolecules,
} from './admetAnalysisData.js';

function resultRow(overrides = {}) {
  return {
    molecule_id: 'cmpd-002',
    original_molecule_id: 'Compound Two',
    canonical_smiles: 'CCO',
    source_filename: 'two.sdf',
    source_record: 'record:1',
    admet_model_status: 'model_available',
    admet_family_status: {
      chemberta: 'available',
      gmc_bbb: 'success',
      chemprop_regression: 'success',
    },
    admet_predictions: {
      hia_hou: { calibrated_probability: 0.75, binary_prediction: 1 },
    },
    bbb_result: {
      status: 'success', raw_classification: 'BBB+', ensemble_probability: 0.87,
    },
    admet_regression: {
      status: 'success', model_family: 'chemprop_dmpnn', endpoints: {
        caco2_wang: {
          status: 'success', ensemble_mean_log10_papp_cm_per_s: -5.125,
          unit: 'log10(Papp [cm/s])',
        },
        lipophilicity_astrazeneca: { status: 'success', ensemble_mean_log_ratio: 0, unit: 'log ratio' },
        solubility_aqsoldb: { status: 'success', ensemble_mean_log_mol_per_l: null, unit: 'log mol/L' },
      },
    },
    ...overrides,
  };
}

test('normalizes regression values without changing raw numeric data', () => {
  const property = normalizeAdmetAnalysis([resultRow()]).molecules[0].properties.caco2_wang;
  assert.equal(property.value, -5.125);
  assert.equal(property.raw.ensemble_mean_log10_papp_cm_per_s, -5.125);
  assert.equal(property.modelName, 'chemprop_dmpnn');
});

test('normalizes classification result and preserves probability separately', () => {
  const property = normalizeAdmetAnalysis([resultRow()]).molecules[0].properties.hia_hou;
  assert.equal(property.value, 1);
  assert.equal(property.classification, 'Positive');
  assert.equal(property.probability, 0.75);
});

test('preserves GMC BBB scientific classification and raw ensemble probability', () => {
  const property = normalizeAdmetAnalysis([resultRow()]).molecules[0].properties.gmc_mpnn_bbb;
  assert.equal(property.value, 'BBB+');
  assert.equal(property.classification, 'BBB+');
  assert.equal(property.probability, 0.87);
  assert.equal(formatAdmetProperty(property, ADMET_ENDPOINT_BY_KEY.get('gmc_mpnn_bbb')), 'BBB+ · 87%');
});

test('zero remains an available regression value', () => {
  const property = normalizeAdmetAnalysis([resultRow()]).molecules[0].properties.lipophilicity_astrazeneca;
  assert.equal(property.value, 0);
  assert.equal(property.status.code, 'available');
  assert.equal(formatAdmetProperty(property, ADMET_ENDPOINT_BY_KEY.get('lipophilicity_astrazeneca')), '0');
});

test('null remains unavailable and is not converted to zero', () => {
  const property = normalizeAdmetAnalysis([resultRow()]).molecules[0].properties.solubility_aqsoldb;
  assert.equal(property.value, null);
  assert.equal(property.status.code, 'endpoint_not_returned');
  assert.equal(formatAdmetProperty(property, ADMET_ENDPOINT_BY_KEY.get('solubility_aqsoldb')), 'Endpoint not returned');
});

test('model_unavailable remains distinguishable from an absent endpoint', () => {
  const row = resultRow({
    admet_family_status: { chemberta: 'available', gmc_bbb: 'model_unavailable', chemprop_regression: 'model_unavailable' },
    bbb_result: { status: 'model_unavailable' },
    admet_regression: { status: 'model_unavailable', endpoints: {} },
  });
  const properties = normalizeAdmetAnalysis([row]).molecules[0].properties;
  assert.equal(properties.caco2_wang.status.code, 'model_unavailable');
  assert.equal(properties.gmc_mpnn_bbb.status.code, 'model_unavailable');
});

test('mixed family availability is retained per endpoint', () => {
  const row = resultRow({
    admet_family_status: { chemberta: 'available', gmc_bbb: 'failed', chemprop_regression: 'success' },
    bbb_result: { status: 'failed', error_message: 'runner failed' },
  });
  const molecule = normalizeAdmetAnalysis([row]).molecules[0];
  assert.equal(molecule.properties.hia_hou.status.code, 'available');
  assert.equal(molecule.properties.caco2_wang.status.code, 'available');
  assert.equal(molecule.properties.gmc_mpnn_bbb.status.code, 'failed');
});

test('normalization preserves deterministic source order', () => {
  const rows = [resultRow({ molecule_id: 'zeta' }), resultRow({ molecule_id: 'alpha' })];
  const molecules = normalizeAdmetAnalysis(rows).molecules;
  assert.deepEqual(molecules.map((molecule) => molecule.moleculeId), ['zeta', 'alpha']);
  assert.deepEqual(molecules.map((molecule) => molecule.sourceIndex), [0, 1]);
});

test('source molecule identity and provenance are retained', () => {
  const molecule = normalizeAdmetAnalysis([resultRow()]).molecules[0];
  assert.deepEqual({
    moleculeId: molecule.moleculeId,
    displayName: molecule.displayName,
    canonicalSmiles: molecule.canonicalSmiles,
    sourceName: molecule.sourceName,
    sourceRecord: molecule.sourceRecord,
  }, {
    moleculeId: 'cmpd-002', displayName: 'Compound Two', canonicalSmiles: 'CCO',
    sourceName: 'two.sdf', sourceRecord: 'record:1',
  });
});

test('registry and payload units map to the normalized property', () => {
  const property = normalizeAdmetAnalysis([resultRow()]).molecules[0].properties.caco2_wang;
  assert.equal(property.unit, 'log10(Papp [cm/s])');
  assert.equal(ADMET_ENDPOINT_BY_KEY.get('vdss_lombardo').unit, 'L/kg');
});

test('unknown source endpoints do not crash or change the presentation registry', () => {
  const row = resultRow({ admet_predictions: { unknown_future_endpoint: { calibrated_probability: 0.2 } } });
  const normalized = normalizeAdmetAnalysis([row]);
  assert.equal(normalized.molecules.length, 1);
  assert.equal(normalized.endpoints.length, ADMET_ENDPOINT_REGISTRY.length);
  assert.equal(normalized.molecules[0].properties.unknown_future_endpoint, undefined);
});

test('sorting is immutable, stable, and supports both directions', () => {
  const molecules = normalizeAdmetAnalysis([
    resultRow({ molecule_id: 'b', original_molecule_id: 'Beta' }),
    resultRow({ molecule_id: 'a', original_molecule_id: 'Alpha', admet_regression: { status: 'success', endpoints: { caco2_wang: { status: 'success', ensemble_mean_log10_papp_cm_per_s: -6 } } } }),
  ]).molecules;
  assert.deepEqual(sortAdmetMolecules(molecules, 'compound', 'asc').map((row) => row.displayName), ['Alpha', 'Beta']);
  assert.deepEqual(sortAdmetMolecules(molecules, 'compound', 'desc').map((row) => row.displayName), ['Beta', 'Alpha']);
  assert.deepEqual(molecules.map((row) => row.displayName), ['Beta', 'Alpha']);
});

test('search matches molecule identity and pagination bounds rendered rows', () => {
  const molecules = normalizeAdmetAnalysis(Array.from({ length: 1000 }, (_, index) => resultRow({
    molecule_id: `cmpd-${index + 1}`,
    original_molecule_id: `Library compound ${index + 1}`,
  }))).molecules;
  assert.equal(searchAdmetMolecules(molecules, 'cmpd-750').length, 1);
  assert.equal(paginateAdmetMolecules(molecules, 0, 50).rows.length, 50);
  assert.equal(paginateAdmetMolecules(molecules, 0, 100).rows.length, 100);
});
