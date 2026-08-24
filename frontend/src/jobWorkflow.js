export const MAX_BATCH_SIZE = 1000;
export const TERMINAL_JOB_STATUSES = new Set([
  'completed',
  'completed_with_warnings',
  'failed',
  'cancelled',
]);

export function countCsvMoleculeRecords(csvText) {
  const records = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index];
    if (character === '"') {
      if (inQuotes && csvText[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((character === '\n' || character === '\r') && !inQuotes) {
      if (character === '\r' && csvText[index + 1] === '\n') {
        index += 1;
      }
      if (current.trim()) {
        records.push(current);
      }
      current = '';
    } else {
      current += character;
    }
  }

  if (current.trim()) {
    records.push(current);
  }
  return Math.max(0, records.length - 1);
}

export function batchSizeError(rowCount) {
  if (rowCount <= MAX_BATCH_SIZE) {
    return '';
  }
  return `Maximum batch size is ${MAX_BATCH_SIZE.toLocaleString()} molecules per analysis; this CSV contains ${rowCount.toLocaleString()} molecule records.`;
}

export function mergeJobIntoHistory(jobs, job) {
  if (!job?.job_id) {
    return jobs;
  }
  const withoutCurrent = jobs.filter((item) => item.job_id !== job.job_id);
  return [job, ...withoutCurrent].sort((left, right) =>
    String(right.created_at ?? '').localeCompare(String(left.created_at ?? '')),
  );
}

export async function pollJobUntilTerminal(
  jobId,
  { request, onUpdate, intervalMs = 1000, wait = defaultWait },
) {
  while (true) {
    const job = await request(`/api/jobs/${jobId}`);
    onUpdate(job);
    if (TERMINAL_JOB_STATUSES.has(job.status)) {
      return job;
    }
    await wait(intervalMs);
  }
}

function defaultWait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
