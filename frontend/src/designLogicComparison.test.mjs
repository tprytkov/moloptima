import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let vite;
let comparison;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  comparison = await vite.ssrLoadModule('/src/designLogicComparison.js');
});
after(async () => vite?.close());

const fingerprint = (tokens) => ({ canonical_tokens: tokens });
const points = [
  { molecule_id: 'ref', fingerprint_status: 'available', fingerprint: fingerprint(['A:MET:1:Hydrophobic', 'B:ASN:2:HBDonor:ligand_donor']), scaffold: { exact_scaffold_id: 's1', generic_framework_id: 'g1' } },
  { molecule_id: 'a', fingerprint_status: 'available', fingerprint: fingerprint(['A:MET:1:Hydrophobic']), scaffold: { exact_scaffold_id: 's1', generic_framework_id: 'g1' } },
  { molecule_id: 'b', fingerprint_status: 'available', fingerprint: fingerprint(['C:LEU:3:VdWContact']), scaffold: { exact_scaffold_id: 's2', generic_framework_id: 'g1' } },
];

test('comparison selection is explicit, duplicate-free, bounded, and keeps reference separate', () => {
  let ids = comparison.addComparison([], 'a', 'ref');
  assert.deepEqual(comparison.addComparison(ids, 'a', 'ref'), ['a']);
  assert.deepEqual(comparison.addComparison(ids, 'ref', 'ref'), ['a']);
  ids = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(comparison.addComparison(ids, 'f', 'ref'), ids);
  assert.deepEqual(comparison.removeComparison(ids, 'c'), ['a', 'b', 'd', 'e']);
  assert.deepEqual(comparison.selectedComparisonPoints(points, 'ref', ['b', 'a']).map((point) => point.molecule_id), ['ref', 'b', 'a']);
});

test('selected-set matrix and frequency retain canonical binary tokens', () => {
  const matrix = comparison.selectedSetMatrix(points);
  assert.equal(matrix.columns.length, 3);
  assert.deepEqual(matrix.features, ['A:MET:1:Hydrophobic', 'B:ASN:2:HBDonor:ligand_donor', 'C:LEU:3:VdWContact']);
  const frequency = new Map(comparison.selectedSetFrequency(points).map((item) => [item.token, item]));
  assert.equal(frequency.get('A:MET:1:Hydrophobic').presentCount, 2);
  assert.equal(frequency.get('B:ASN:2:HBDonor:ligand_donor').category, 'Reference only');
  assert.equal(frequency.get('C:LEU:3:VdWContact').category, 'Comparison-specific');
});

test('scaffold grouping is independent and comparison export stays vector', () => {
  assert.deepEqual(comparison.scaffoldGroups(points, 'exact_scaffold_id', 'none'), [
    { id: 's1', moleculeIds: ['ref', 'a'] }, { id: 's2', moleculeIds: ['b'] },
  ]);
  const svg = comparison.buildComparisonFigureSvg([
    '<svg><path d="M0 0L1 1"/><text>ref</text></svg>',
    '<svg><line x1="0" y1="0" x2="1" y2="1"/><text>a</text></svg>',
  ]);
  assert.match(svg, /ref/); assert.match(svg, /<path/); assert.match(svg, /<line/);
  assert.doesNotMatch(svg, /<image\b|data:image/i);
});
