import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  dockingPoseArtifactUrl, parseVinaPoseModels, selectVinaPoseMode,
} from './dockingPose.js';

const MODEL_ONE = `MODEL 1
REMARK VINA RESULT:      -8.3      0.000      0.000
ROOT
ATOM      1  C1  LIG A   1       1.000   2.000   3.000  0.00  0.00     0.000 C
ENDROOT
TORSDOF 0
ENDMDL
`;
const MODEL_TWO = `MODEL 2
REMARK VINA RESULT:      -7.9      1.250      2.500
ROOT
ATOM      1  C1  LIG A   1       9.000   8.000   7.000  0.00  0.00     0.000 C
ENDROOT
TORSDOF 0
ENDMDL
`;

test('splits a real-like multi-MODEL Vina PDBQT without changing coordinates', () => {
  const models = parseVinaPoseModels(`${MODEL_ONE}${MODEL_TWO}`);
  assert.equal(models.length, 2);
  assert.deepEqual(models.map((model) => model.modelNumber), [1, 2]);
  assert.match(models[0].text, /1\.000   2\.000   3\.000/);
  assert.doesNotMatch(models[0].text, /9\.000   8\.000   7\.000/);
  assert.match(models[1].text, /9\.000   8\.000   7\.000/);
  assert.deepEqual(
    [models[1].affinityKcalMol, models[1].rmsdLb, models[1].rmsdUb],
    [-7.9, 1.25, 2.5],
  );
});

test('accepts a single-mode Vina PDBQT without MODEL wrappers', () => {
  const single = MODEL_ONE.replace('MODEL 1\n', '').replace('ENDMDL\n', '');
  const models = parseVinaPoseModels(single);
  assert.equal(models.length, 1);
  assert.equal(models[0].modelNumber, 1);
  assert.equal(models[0].affinityKcalMol, -8.3);
});

for (const [name, text, message] of [
  ['empty artifact', '', /empty/],
  ['missing ENDMDL', MODEL_ONE.replace('ENDMDL\n', ''), /missing ENDMDL/],
  ['no atom records', MODEL_ONE.replace(/^ATOM.*\n/m, ''), /no atom records/],
  ['no Vina result', MODEL_ONE.replace(/^REMARK VINA RESULT.*\n/m, ''), /no valid Vina result/],
]) {
  test(`rejects ${name}`, () => assert.throws(() => parseVinaPoseModels(text), message));
}

test('maps selected metadata mode to its exact pose MODEL and synchronized values', () => {
  const models = parseVinaPoseModels(`${MODEL_ONE}${MODEL_TWO}`);
  const metadata = [
    { mode: 1, pose_model: 1, affinity_kcal_mol: -8.3, rmsd_lb: 0, rmsd_ub: 0 },
    { mode: 2, pose_model: 2, affinity_kcal_mol: -7.9, rmsd_lb: 1.25, rmsd_ub: 2.5 },
  ];
  const selected = selectVinaPoseMode(models, metadata, 2);
  assert.equal(selected.pose.modelNumber, 2);
  assert.equal(selected.metadata.affinity_kcal_mol, -7.9);
  assert.match(selected.pose.text, /9\.000   8\.000   7\.000/);
});

test('fails closed for invalid, missing, out-of-range, or mismatched mode metadata', () => {
  const models = parseVinaPoseModels(`${MODEL_ONE}${MODEL_TWO}`);
  assert.throws(() => selectVinaPoseMode(models, [], 0), /positive integer/);
  assert.throws(() => selectVinaPoseMode(models, [], 3), /metadata.*unavailable/);
  assert.throws(
    () => selectVinaPoseMode(models, [{ mode: 3, pose_model: 3, affinity_kcal_mol: -7 }], 3),
    /coordinates.*unavailable/,
  );
  assert.throws(
    () => selectVinaPoseMode(models, [{ mode: 2, pose_model: 2, affinity_kcal_mol: -1 }], 2),
    /does not match/,
  );
});

test('builds only a job-scoped authorized docking-pose URL', () => {
  assert.equal(
    dockingPoseArtifactUrl('http://localhost:8000', 'job 1', 'docking/poses/0001_pose.pdbqt'),
    'http://localhost:8000/api/results/job%201/artifacts/docking/poses/0001_pose.pdbqt',
  );
  assert.throws(() => dockingPoseArtifactUrl('', 'job', '../../secret.pdbqt'), /path is invalid/);
  assert.throws(() => dockingPoseArtifactUrl('', '', 'docking/poses/a.pdbqt'), /job context/);
});
