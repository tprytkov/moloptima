import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BACKEND_HEALTH_POLL_INTERVAL_MS,
  requestBackendHealth,
  startBackendHealthPolling,
} from './backendHealth.js';

test('backend health uses the real health endpoint and reports request failure Offline', async () => {
  let requested = '';
  const online = await requestBackendHealth('http://backend', async (url) => {
    requested = url;
    return { ok: true, json: async () => ({ status: 'ok' }) };
  });
  const offline = await requestBackendHealth('http://backend', async () => {
    throw new TypeError('connection refused');
  });

  assert.equal(requested, 'http://backend/health');
  assert.equal(online.status, 'online');
  assert.equal(online.label, 'Online');
  assert.equal(offline.status, 'offline');
  assert.equal(offline.label, 'Offline');
});

test('health polling replaces stale Online state after the backend becomes unreachable', async () => {
  const states = [];
  let scheduledCheck;
  let cleared = false;
  let online = true;
  const controller = startBackendHealthPolling({
    apiBaseUrl: 'http://backend',
    onState: (state) => states.push(state),
    fetchImpl: async () => {
      if (!online) throw new TypeError('connection refused');
      return { ok: true, json: async () => ({ status: 'ok' }) };
    },
    setIntervalImpl: (callback, interval) => {
      assert.equal(interval, BACKEND_HEALTH_POLL_INTERVAL_MS);
      scheduledCheck = callback;
      return 17;
    },
    clearIntervalImpl: (id) => {
      assert.equal(id, 17);
      cleared = true;
    },
  });

  await controller.initialCheck;
  assert.equal(states.at(-1).label, 'Online');
  online = false;
  await scheduledCheck();
  assert.equal(states.at(-1).label, 'Offline');
  controller.stop();
  assert.equal(cleared, true);
});
