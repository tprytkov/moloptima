import assert from 'node:assert/strict';
import test from 'node:test';
import {
  availablePoseModes, contactsForSelection, filterMatrixFeatures, interactionClassSummary,
  formatMetricWithUnit, interactionStatusLabel, scatterCoordinates,
} from './designLogicData.js';

test('explicit pose modes are deterministic and never substitute a best pose', () => {
  const rows = [{ docking_result: { best_mode: 3, modes: [{ mode: 3 }, { mode: 1 }] } }];
  assert.deepEqual(availablePoseModes(rows), [1, 3]);
  assert.equal(availablePoseModes(rows).includes(2), false);
});

test('scatter uses independent numeric structural and interaction axes', () => {
  const [point] = scatterCoordinates([{ molecule_id: 'm1', structural_similarity: 0.2, interaction_similarity: 0.8 }], 700, 360);
  assert.equal(point.screenX, 166.4);
  assert.equal(point.screenY, 98.39999999999998);
});

test('matrix filtering retains canonical token semantics', () => {
  const tokens = ['A:MET:301:Hydrophobic', 'B:ASN:236:HBDonor:ligand_donor'];
  assert.deepEqual(filterMatrixFeatures(tokens, { interactionType: 'HBDonor', chain: 'B', residueQuery: '236' }), [tokens[1]]);
});

test('raw contacts and binary summaries stay distinct', () => {
  const fingerprint = {
    canonical_tokens: ['A:MET:301:VdWContact'],
    raw_interaction_records: [
      { receptor: { chain: 'A', residue_name: 'MET', residue_number: '301', insertion_code: '' }, interaction_type: 'VdWContact' },
      { receptor: { chain: 'A', residue_name: 'MET', residue_number: '301', insertion_code: '' }, interaction_type: 'VdWContact' },
    ],
  };
  assert.deepEqual(interactionClassSummary(fingerprint), [['VdWContact', 1]]);
  assert.equal(contactsForSelection(fingerprint, 'A:MET:301:VdWContact').length, 2);
});

test('typed unavailable and both-empty states remain explicit', () => {
  assert.equal(interactionStatusLabel('not_analyzed'), 'Not analyzed');
  assert.equal(interactionStatusLabel('incompatible'), 'Incompatible');
  assert.equal(interactionStatusLabel('both_empty'), 'Both fingerprints empty');
});

test('unit formatting preserves numeric zero without attaching units to missing values', () => {
  assert.equal(formatMetricWithUnit(0, 'kcal/mol'), '0.000 kcal/mol');
  assert.equal(formatMetricWithUnit(null, 'kcal/mol'), '—');
  assert.equal(formatMetricWithUnit(undefined, 'kcal/mol'), '—');
});
