import assert from 'node:assert/strict';
import test from 'node:test';
import { paginateScaffolds, scaffoldColorPlan, scaffoldMembership, scaffoldPointColor, searchScaffolds, summarizeScaffoldAdmet } from './scaffoldData.js';

const groups = Array.from({ length: 30 }, (_, index) => ({
  scaffold_id: `scf_${String(index).padStart(2, '0')}`, scaffold_smiles: index === 0 ? 'c1ccccc1' : `C${index}`,
  category: 'bemis_murcko', member_count: 1, members: [{ molecule_id: `m${index}` }],
}));

test('scaffold search, paging, membership, and colors are deterministic and bounded', () => {
  assert.equal(searchScaffolds(groups, 'c1ccccc1')[0].scaffold_id, 'scf_00');
  assert.equal(paginateScaffolds(groups, 0).rows.length, 25);
  assert.equal(paginateScaffolds(groups, 99).page, 1);
  assert.equal(scaffoldMembership(groups).get('m2'), 'scf_02');
  const plan = scaffoldColorPlan(groups);
  assert.equal(plan.topIds.size, 12);
  assert.equal(scaffoldPointColor('scf_29', plan), '#9aa4ad');
  assert.equal(scaffoldPointColor('scf_01', plan), scaffoldPointColor('scf_01', scaffoldColorPlan(groups)));
});

test('ADMET summaries are descriptive and preserve unavailable counts', () => {
  const admetById = new Map([
    ['m1', { properties: { lipophilicity_astrazeneca: { status: { code: 'available' }, value: 2 }, ames: { status: { code: 'available' }, classification: 'Negative' } } }],
    ['m2', { properties: { lipophilicity_astrazeneca: { status: { code: 'available' }, value: 4 }, ames: { status: { code: 'unavailable' }, classification: null } } }],
  ]);
  const summary = summarizeScaffoldAdmet({ members: [{ molecule_id: 'm1' }, { molecule_id: 'm2' }] }, admetById);
  const regression = summary.find((row) => row.key === 'lipophilicity_astrazeneca');
  assert.deepEqual(regression.statistics, { n: 2, mean: 3, median: 3, min: 2, max: 4 });
  const classification = summary.find((row) => row.key === 'ames');
  assert.deepEqual(classification.classCounts, { Negative: 1 });
  assert.equal(classification.unavailableCount, 1);
});
