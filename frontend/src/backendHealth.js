export const BACKEND_HEALTH_POLL_INTERVAL_MS = 2000;

export async function requestBackendHealth(apiBaseUrl, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`${apiBaseUrl}/health`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    return {
      status: 'online',
      label: 'Online',
      message: JSON.stringify(payload),
    };
  } catch (error) {
    return {
      status: 'offline',
      label: 'Offline',
      message: error instanceof Error ? error.message : 'Backend health check failed.',
    };
  }
}

export function startBackendHealthPolling({
  apiBaseUrl,
  onState,
  fetchImpl = fetch,
  intervalMs = BACKEND_HEALTH_POLL_INTERVAL_MS,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
}) {
  let active = true;
  let inFlight = false;

  async function check() {
    if (!active || inFlight) {
      return;
    }
    inFlight = true;
    const state = await requestBackendHealth(apiBaseUrl, fetchImpl);
    inFlight = false;
    if (active) {
      onState(state);
    }
  }

  const initialCheck = check();
  const intervalId = setIntervalImpl(check, intervalMs);
  return {
    initialCheck,
    stop() {
      active = false;
      clearIntervalImpl(intervalId);
    },
  };
}
