import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAdmetHistogram,
  extractAdmetNumericValues,
  numericDisplayDomain,
  prepareAdmetScatterPoints,
  projectAdmetScatterPoints,
} from './admetPlotData.js';

function molecule(id, x, y, options = {}) {
  const status = options.status || 'available';
  return {
    moleculeId: id,
    displayName: options.displayName || id,
    sourceName: options.sourceName || `${id}.sdf`,
    sourceIndex: options.sourceIndex ?? (Number(id.replace(/\D/g, '')) || 0),
    properties: {
      lipophilicity_astrazeneca: { value: x, status: { code: options.xStatus || status } },
      solubility_aqsoldb: { value: y, status: { code: options.yStatus || status } },
    },
  };
}

test('numeric values are extracted in source order with zero and negative values', () => {
  const result = extractAdmetNumericValues([molecule('m1', -2, 1), molecule('m2', 0, 2), molecule('m3', 3, 3)], 'lipophilicity_astrazeneca');
  assert.deepEqual(result.values, [-2, 0, 3]);
});

test('missing and unavailable values are excluded and counted', () => {
  const rows = [molecule('valid', 1, 1), molecule('missing', null, 2), molecule('unavailable', 3, 3, { xStatus: 'model_unavailable' })];
  const result = extractAdmetNumericValues(rows, 'lipophilicity_astrazeneca');
  assert.deepEqual(result.values, [1]);
  assert.equal(result.unavailableCount, 2);
  assert.equal(result.totalCount, 3);
});

test('histogram bins are deterministic', () => {
  const rows = Array.from({ length: 37 }, (_, index) => molecule(`m${index}`, index - 18, index));
  assert.deepEqual(createAdmetHistogram(rows, 'lipophilicity_astrazeneca').bins, createAdmetHistogram(rows, 'lipophilicity_astrazeneca').bins);
});

test('constant-value histogram creates one non-zero-width bin', () => {
  const histogram = createAdmetHistogram([molecule('m1', 2, 1), molecule('m2', 2, 2)], 'lipophilicity_astrazeneca');
  assert.equal(histogram.bins.length, 1);
  assert.equal(histogram.bins[0].count, 2);
  assert.ok(histogram.bins[0].x1 > histogram.bins[0].x0);
});

test('an extreme outlier is retained without unbounded bin growth', () => {
  const rows = [...Array.from({ length: 100 }, (_, index) => molecule(`m${index}`, index / 100, 1)), molecule('outlier', 1e12, 2)];
  const histogram = createAdmetHistogram(rows, 'lipophilicity_astrazeneca');
  assert.ok(histogram.bins.length <= 40);
  assert.equal(histogram.bins.reduce((sum, bin) => sum + bin.count, 0), 101);
});

test('empty histogram has stable defaults', () => {
  assert.deepEqual(createAdmetHistogram([], 'lipophilicity_astrazeneca'), {
    observations: [], values: [], totalCount: 0, plottedCount: 0, unavailableCount: 0, bins: [], domain: [0, 1], maxCount: 0,
  });
});

test('histogram does not mutate raw source data', () => {
  const rows = [molecule('m2', 2, 1), molecule('m1', 1, 2)];
  const before = structuredClone(rows);
  createAdmetHistogram(rows, 'lipophilicity_astrazeneca');
  assert.deepEqual(rows, before);
});

test('scatter maps X and Y raw values correctly', () => {
  const result = prepareAdmetScatterPoints([molecule('m1', 1.25, -3.5)], 'lipophilicity_astrazeneca', 'solubility_aqsoldb');
  assert.equal(result.points[0].x, 1.25);
  assert.equal(result.points[0].y, -3.5);
});

test('scatter includes only molecules with both numeric values', () => {
  const result = prepareAdmetScatterPoints([molecule('both', 1, 2), molecule('missing-x', null, 2), molecule('missing-y', 1, null)], 'lipophilicity_astrazeneca', 'solubility_aqsoldb');
  assert.deepEqual(result.points.map(({ moleculeId }) => moleculeId), ['both']);
  assert.equal(result.unavailableCount, 2);
});

test('scatter retains zero and negative values', () => {
  const result = prepareAdmetScatterPoints([molecule('zero', 0, 0), molecule('negative', -1, -2)], 'lipophilicity_astrazeneca', 'solubility_aqsoldb');
  assert.deepEqual(result.points.map(({ x, y }) => [x, y]), [[0, 0], [-1, -2]]);
});

test('scatter excludes unavailable X and unavailable Y independently', () => {
  const rows = [molecule('x', 1, 2, { xStatus: 'failed' }), molecule('y', 1, 2, { yStatus: 'endpoint_not_returned' })];
  assert.equal(prepareAdmetScatterPoints(rows, 'lipophilicity_astrazeneca', 'solubility_aqsoldb').points.length, 0);
});

test('scatter preserves molecule identity and source filename', () => {
  const row = molecule('source-id', 1, 2, { displayName: 'Lead 7', sourceName: 'library-seven.sdf', sourceIndex: 42 });
  const point = prepareAdmetScatterPoints([row], 'lipophilicity_astrazeneca', 'solubility_aqsoldb').points[0];
  assert.equal(point.moleculeId, 'source-id');
  assert.equal(point.displayName, 'Lead 7');
  assert.equal(point.sourceName, 'library-seven.sdf');
  assert.equal(point.sourceIndex, 42);
  assert.equal(point.molecule, row);
});

test('scatter order is deterministic and input order is preserved', () => {
  const rows = [molecule('m3', 3, 3), molecule('m1', 1, 1), molecule('m2', 2, 2)];
  assert.deepEqual(prepareAdmetScatterPoints(rows, 'lipophilicity_astrazeneca', 'solubility_aqsoldb').points.map(({ moleculeId }) => moleculeId), ['m3', 'm1', 'm2']);
});

test('scatter preparation and projection do not mutate input', () => {
  const rows = [molecule('m1', 1, 2), molecule('m2', 3, 4)];
  const before = structuredClone(rows);
  const scatter = prepareAdmetScatterPoints(rows, 'lipophilicity_astrazeneca', 'solubility_aqsoldb');
  projectAdmetScatterPoints(scatter.points, scatter.xDomain, scatter.yDomain, 900, 500);
  assert.deepEqual(rows, before);
});

test('display domains handle no points, one point, and mixed ranges', () => {
  assert.deepEqual(numericDisplayDomain([]), [0, 1]);
  assert.deepEqual(numericDisplayDomain([0]), [-0.5, 0.5]);
  assert.deepEqual(numericDisplayDomain([-10, 10]), [-11, 11]);
});

test('projection remains finite for a single usable point', () => {
  const scatter = prepareAdmetScatterPoints([molecule('only', 2, -3)], 'lipophilicity_astrazeneca', 'solubility_aqsoldb');
  const point = projectAdmetScatterPoints(scatter.points, scatter.xDomain, scatter.yDomain, 900, 500)[0];
  assert.ok(Number.isFinite(point.screenX));
  assert.ok(Number.isFinite(point.screenY));
});

test('10,000-point histogram and scatter transforms stay responsive', () => {
  const rows = Array.from({ length: 10000 }, (_, index) => molecule(`m${index}`, (index % 1000) / 100, -((index * 7) % 900) / 100));
  const started = performance.now();
  const histogram = createAdmetHistogram(rows, 'lipophilicity_astrazeneca');
  const histogramMs = performance.now() - started;
  const scatterStarted = performance.now();
  const scatter = prepareAdmetScatterPoints(rows, 'lipophilicity_astrazeneca', 'solubility_aqsoldb');
  const scatterMs = performance.now() - scatterStarted;
  assert.equal(histogram.plottedCount, 10000);
  assert.equal(scatter.plottedCount, 10000);
  assert.ok(histogramMs < 2000, `10,000-value histogram took ${histogramMs.toFixed(1)} ms`);
  assert.ok(scatterMs < 2000, `10,000-point scatter transform took ${scatterMs.toFixed(1)} ms`);
});
