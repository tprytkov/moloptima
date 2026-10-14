import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let vite;
let module;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  module = await vite.ssrLoadModule('/src/pharmacophoreVisualization.js');
});

after(async () => vite?.close());

const pair = {
  matches: [{ reference_feature_id: 'r1', comparison_feature_id: 'c1', distance_angstrom: 0.5 }],
  reference_only_features: [{ feature_id: 'r2' }],
  comparison_only_features: [{ feature_id: 'c2' }],
};

test('feature status mapping uses loaded backend matches without distance recomputation', () => {
  const maps = module.featureStatusMaps(pair);
  assert.equal(maps.reference.get('r1').status, 'matched');
  assert.equal(maps.comparison.get('c1').status, 'matched');
  assert.equal(maps.reference.get('r2').status, 'reference_only');
  assert.equal(maps.comparison.get('c2').status, 'comparison_only');
});

test('matched feature selection synchronizes both backend-qualified feature identities', () => {
  assert.deepEqual([...module.selectedFeatureIds('c1', pair)], ['c1', 'r1']);
});

test('2D map anchors features to authoritative template atom indices and preserves unavailable mapping', () => {
  const features = [
    { feature_id: 'r1', canonical_class: 'HBA', template_atom_indices: [4] },
    { feature_id: 'missing', canonical_class: 'HBD', template_atom_indices: [99] },
  ];
  const mapped = module.mapFeatureAnnotations(features, [{ atom_index: 4, x: 120, y: 80 }], 'reference', pair);
  assert.deepEqual(mapped[0].anchor, { x: 120, y: 80 });
  assert.equal(mapped[0].status, 'matched');
  assert.equal(mapped[1].unavailable, true);
});

test('vector pharmacophore map has accessible feature controls, non-color semantics, and no raster image', () => {
  const svg = module.buildPharmacophoreMapSvg({
    depiction: { width: 420, height: 300, svg: '<svg><path d="M0 0L1 1"/></svg>', atom_positions: [{ atom_index: 4, x: 120, y: 80 }] },
    featureSet: { features: [{ feature_id: 'r1', canonical_class: 'HBA', template_atom_indices: [4] }] },
    role: 'reference', comparison: pair, selectedFeatureId: 'r1', moleculeId: 'ref', mode: 2, threshold: 1.5,
  });
  assert.match(svg, /data-feature-id="r1"/);
  assert.match(svg, /role="button" tabindex="0"/);
  assert.match(svg, /Reference only|Matched/);
  assert.match(svg, /Comparison threshold: 1.50 Å/);
  assert.doesNotMatch(svg, /<image\b/);
});

test('pharmacophore export preserves the vector map aspect ratio at qualified resolutions', () => {
  assert.deepEqual(module.pharmacophoreExportDimensions(3840), { width: 3840, height: 2359 });
});
