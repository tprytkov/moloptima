import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADMET_PANEL_ID,
  admetRunStatusLabel,
  cancelQueuedAdmetRun,
  canRunIndependentAdmet,
  executeIndependentAdmetRun,
  selectAdmetResultSource,
} from './admetRunWorkflow.js';

const identity = {
  run_id: 'a'.repeat(32), upload_id: 'b'.repeat(32), molecule_collection_sha256: 'collection-sha',
};
const run = (status, extra = {}) => ({ ...identity, status, ...extra });

test('independent ADMET submission uses the exact fixed-panel payload and stores queued status', async () => {
  const calls = [];
  const statuses = [];
  const outcome = await executeIndependentAdmetRun({
    uploadId: identity.upload_id,
    request: async (path, options) => {
      calls.push([path, options]);
      if (calls.length === 1) return run('queued');
      return run('cancelled');
    },
    onStatus: (status) => statuses.push(status),
    wait: async () => {},
  });
  assert.deepEqual(JSON.parse(calls[0][1].body), { upload_id: identity.upload_id, panel: ADMET_PANEL_ID });
  assert.deepEqual(Object.keys(JSON.parse(calls[0][1].body)), ['upload_id', 'panel']);
  assert.equal(statuses[0].run_id, identity.run_id);
  assert.deepEqual(statuses.map(({ status }) => status), ['queued', 'cancelled']);
  assert.equal(outcome.result, null);
});

test('running then completed retrieves the result only after the terminal status', async () => {
  const paths = [];
  const responses = [run('queued'), run('running'), run('completed'), { ...run('completed'), results: [{ molecule_id: 'm1' }] }];
  const outcome = await executeIndependentAdmetRun({
    uploadId: identity.upload_id,
    request: async (path) => { paths.push(path); return responses.shift(); },
    wait: async () => {},
  });
  assert.deepEqual(paths, [
    '/api/admet/runs',
    `/api/admet/runs/${identity.run_id}`,
    `/api/admet/runs/${identity.run_id}`,
    `/api/admet/runs/${identity.run_id}/result`,
  ]);
  assert.equal(outcome.result.results[0].molecule_id, 'm1');
});

test('completed_with_warnings remains successful and retrieves scientific rows', async () => {
  const responses = [run('completed_with_warnings', { warning_count: 1 }), { ...run('completed_with_warnings'), results: [] }];
  const outcome = await executeIndependentAdmetRun({
    uploadId: identity.upload_id,
    request: async () => responses.shift(),
  });
  assert.equal(outcome.run.status, 'completed_with_warnings');
  assert.deepEqual(outcome.result.results, []);
});

test('failed terminal state does not request unavailable results', async () => {
  const paths = [];
  const outcome = await executeIndependentAdmetRun({
    uploadId: identity.upload_id,
    request: async (path) => { paths.push(path); return run('failed', { error_message: 'runtime unavailable' }); },
  });
  assert.equal(outcome.run.error_message, 'runtime unavailable');
  assert.deepEqual(paths, ['/api/admet/runs']);
});

test('queued cancellation calls the qualified endpoint while running cancellation is restricted locally', async () => {
  const calls = [];
  const cancelled = await cancelQueuedAdmetRun({
    run: run('queued'),
    request: async (path, options) => { calls.push([path, options]); return run('cancelled'); },
  });
  assert.equal(cancelled.run.status, 'cancelled');
  assert.deepEqual(calls, [[`/api/admet/runs/${identity.run_id}/cancel`, { method: 'POST' }]]);
  const restricted = await cancelQueuedAdmetRun({ run: run('running'), request: async () => assert.fail('must not call') });
  assert.equal(restricted.restricted, true);
});

test('stale status and result responses are ignored', async () => {
  let current = true;
  const staleStatus = await executeIndependentAdmetRun({
    uploadId: identity.upload_id,
    request: async (path) => {
      if (path === '/api/admet/runs') return run('queued');
      current = false;
      return run('running');
    },
    isCurrent: () => current,
    wait: async () => {},
  });
  assert.equal(staleStatus.stale, true);

  current = true;
  const staleResult = await executeIndependentAdmetRun({
    uploadId: identity.upload_id,
    request: async (path) => {
      if (path.endsWith('/result')) current = false;
      return path === '/api/admet/runs' ? run('completed') : { ...run('completed'), results: [] };
    },
    isCurrent: () => current,
  });
  assert.equal(staleResult.stale, true);
});

test('source precedence is identity-safe and never combines independent and historical rows', () => {
  const upload = { upload_id: identity.upload_id };
  const independent = {
    uploadId: identity.upload_id,
    run: run('completed'),
    result: { ...run('completed'), results: [{ molecule_id: 'independent' }] },
  };
  const historical = {
    job: { job_id: 'job-1', upload_id: identity.upload_id },
    result: { upload_id: identity.upload_id, results: [{ molecule_id: 'historical' }] },
  };
  assert.deepEqual(selectAdmetResultSource({ independentState: independent, upload, prioritizationState: historical }).rows.map((row) => row.molecule_id), ['independent']);
  const switched = selectAdmetResultSource({ independentState: independent, upload: { upload_id: 'c'.repeat(32) }, prioritizationState: historical });
  assert.equal(switched.kind, 'none');
  const fallback = selectAdmetResultSource({ independentState: null, upload, prioritizationState: historical });
  assert.equal(fallback.kind, 'prioritization');
});

test('fixed-panel eligibility and exact backend status labels remain explicit', () => {
  assert.equal(canRunIndependentAdmet({ upload_id: identity.upload_id, valid_count: 1 }), true);
  assert.equal(canRunIndependentAdmet({ upload_id: identity.upload_id, valid_count: 0 }), false);
  assert.deepEqual(['queued', 'running', 'completed', 'completed_with_warnings', 'failed', 'cancelled'].map(admetRunStatusLabel), [
    'Queued', 'Running', 'Completed', 'Completed with warnings', 'Failed', 'Cancelled',
  ]);
});
