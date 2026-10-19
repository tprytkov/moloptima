import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeCalculationKey,
  activeUploadContext,
  isCurrentActiveRequest,
  isRestorableJob,
  newCalculationState,
  openedActiveRun,
  startupActiveRun,
} from './activeCalculationLifecycle.js';

test('completed, failed, and cancelled jobs remain history-only at startup', () => {
  for (const status of ['completed', 'completed_with_warnings', 'failed', 'cancelled']) {
    const job = { job_id: `job-${status}`, status };
    assert.equal(isRestorableJob(job), false);
    assert.equal(startupActiveRun(job), null);
  }
});

test('queued and running jobs are eligible for startup restoration', () => {
  for (const status of ['queued', 'running']) {
    const job = { job_id: `job-${status}`, status };
    assert.equal(isRestorableJob(job), true);
    assert.deepEqual(startupActiveRun(job), { job, result: null, loading: true, error: '' });
  }
});

test('opening a persisted result reconstructs its molecule collection context', () => {
  const activeRun = openedActiveRun(
    { job_id: 'job-a', upload_id: 'upload-a', analysis_mode: 'library' },
    { results: [{ valid_molecule: true }, { valid_molecule: false }] },
  );
  const context = activeUploadContext(null, activeRun);
  assert.equal(activeRun.job.job_id, 'job-a');
  assert.deepEqual(context, {
    upload_id: 'upload-a', analysis_mode: 'library', submitted_count: 2,
    valid_count: 1, row_count: 2, restored_from_job: true,
  });
});

test('New Calculation clears active context while preserving saved history', () => {
  const historyJobs = [{ job_id: 'job-a', status: 'completed' }];
  const reset = newCalculationState(historyJobs);
  assert.equal(reset.activeRun.job, null);
  assert.equal(reset.activeRun.result, null);
  assert.equal(reset.upload, null);
  assert.equal(reset.annotations.jobId, '');
  assert.equal(reset.selectedHistoryJobId, '');
  assert.strictEqual(reset.historyJobs, historyJobs);
});

test('job-scoped component keys change across jobs and clear on a new calculation', () => {
  assert.equal(activeCalculationKey({ job: { job_id: 'job-a' } }, null), 'job-a');
  assert.equal(activeCalculationKey({ job: { job_id: 'job-b' } }, null), 'job-b');
  assert.equal(activeCalculationKey({ job: null }, null), 'no-active-calculation');
});

test('active request generations reject a response from a previous job', () => {
  assert.equal(isCurrentActiveRequest(4, 5), false);
  assert.equal(isCurrentActiveRequest(5, 5), true);
});
