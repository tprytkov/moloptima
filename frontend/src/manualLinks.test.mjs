import assert from 'node:assert/strict';
import test from 'node:test';

import { manualSectionForTopic, openUserManual } from './manualLinks.js';

test('Help topics map to stable manual section anchors', () => {
  assert.equal(manualSectionForTopic('admet'), 'admet-prediction');
  assert.equal(manualSectionForTopic('chemical-space'), 'chemical-space');
  assert.equal(manualSectionForTopic('prioritization'), 'prioritization');
  assert.equal(manualSectionForTopic('unknown-topic'), 'introduction');
});

test('manual opening passes only the mapped section to the desktop bridge', async () => {
  const calls = [];
  const result = await openUserManual('experimental-data', {
    openUserManual: async (sectionId) => { calls.push(sectionId); return { ok: true, sectionId }; },
  });
  assert.deepEqual(calls, ['experimental-data']);
  assert.deepEqual(result, { ok: true, sectionId: 'experimental-data' });
});

test('missing desktop bridge produces a readable non-throwing failure', async () => {
  const result = await openUserManual('admet', null);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'desktop_bridge_unavailable');
  assert.match(result.message, /packaged MolOptima desktop application/);
});

test('missing packaged manual and bridge failures remain readable', async () => {
  const missing = await openUserManual('admet', {
    openUserManual: async () => ({ ok: false, code: 'manual_missing', message: 'The offline user manual resource is unavailable.' }),
  });
  assert.equal(missing.code, 'manual_missing');
  await assert.doesNotReject(() => openUserManual('admet', { openUserManual: async () => { throw new Error('closed'); } }));
  assert.equal((await openUserManual('admet', { openUserManual: async () => { throw new Error('closed'); } })).code, 'manual_open_failed');
});
