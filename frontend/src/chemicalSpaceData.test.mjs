import assert from 'node:assert/strict';
import test from 'node:test';
import {
  categoricalPointColor, paddedChemicalSpaceDomain, projectChemicalSpacePoints,
  searchChemicalSpacePoints,
} from './chemicalSpaceData.js';

test('chemical-space point projection is deterministic and finite', () => {
  const points = [{ molecule_id: 'a', x: -1, y: 2 }, { molecule_id: 'b', x: 3, y: -2 }];
  const first = projectChemicalSpacePoints(points);
  assert.deepEqual(first, projectChemicalSpacePoints(points));
  assert.ok(first.every((point) => Number.isFinite(point.screenX) && Number.isFinite(point.screenY)));
});

test('chemical-space search covers identity, structure, and source metadata', () => {
  const points = [
    { molecule_id: 'cmpd-a', display_name: 'Ethanol', canonical_smiles: 'CCO', source_filename: 'set-a.csv', source_record: 'row:1' },
    { molecule_id: 'cmpd-b', display_name: 'Benzene', canonical_smiles: 'c1ccccc1', source_filename: 'set-b.sdf', source_record: 'record:1' },
  ];
  assert.deepEqual(searchChemicalSpacePoints(points, 'set-b'), [points[1]]);
  assert.deepEqual(searchChemicalSpacePoints(points, 'CCO'), [points[0]]);
});

test('constant projections and categorical colors remain stable', () => {
  assert.deepEqual(paddedChemicalSpaceDomain([2, 2]), [1, 3]);
  assert.equal(categoricalPointColor('library.csv'), categoricalPointColor('library.csv'));
});
