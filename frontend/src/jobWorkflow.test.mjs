import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_BATCH_SIZE,
  batchSizeError,
  countCsvMoleculeRecords,
  mergeJobIntoHistory,
  pollJobUntilTerminal,
} from './jobWorkflow.js';


test('frontend detects and rejects more than 1000 molecule records', () => {
  const csv = ['molecule_id,smiles'];
  for (let index = 1; index <= 1001; index += 1) {
    csv.push(`mol_${index},CCO`);
  }
  const detected = countCsvMoleculeRecords(`${csv.join('\r\n')}\r\n`);

  assert.equal(detected, 1001);
  assert.equal(MAX_BATCH_SIZE, 1000);
  assert.match(batchSizeError(detected), /Maximum batch size is 1,000/);
  assert.equal(batchSizeError(1000), '');
});


test('accepted queued job is stored in history by job id', () => {
  const job = {
    job_id: 'job-queued',
    status: 'queued',
    stage: 'queued',
    created_at: '2026-01-02T00:00:00+00:00',
  };

  const history = mergeJobIntoHistory([], job);

  assert.equal(history.length, 1);
  assert.equal(history[0].job_id, 'job-queued');
  assert.equal(history[0].status, 'queued');
});


test('polling publishes visible queued, running, and completed status updates', async () => {
  const responses = [
    { job_id: 'job-1', status: 'queued', stage: 'queued' },
    { job_id: 'job-1', status: 'running', stage: 'prioritization' },
    { job_id: 'job-1', status: 'completed', stage: 'completed' },
  ];
  const visibleStatuses = [];

  const terminal = await pollJobUntilTerminal('job-1', {
    request: async (path) => {
      assert.equal(path, '/api/jobs/job-1');
      return responses.shift();
    },
    onUpdate: (job) => visibleStatuses.push(`${job.status}:${job.stage}`),
    wait: async () => {},
    intervalMs: 0,
  });

  assert.deepEqual(visibleStatuses, [
    'queued:queued',
    'running:prioritization',
    'completed:completed',
  ]);
  assert.equal(terminal.job_id, 'job-1');
});
