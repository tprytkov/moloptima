const { spawnSync } = require('node:child_process');

const DEFAULT_LOG_HISTORY_LIMIT = 100;

function isEpipe(error) {
  return Boolean(error && error.code === 'EPIPE');
}

function createSafeLogger({
  stdout = process.stdout,
  stderr = process.stderr,
  historyLimit = DEFAULT_LOG_HISTORY_LIMIT,
} = {}) {
  const history = [];

  function remember(level, message) {
    history.push({ level, message: String(message) });
    if (history.length > historyLimit) {
      history.splice(0, history.length - historyLimit);
    }
  }

  function writer(stream, streamName) {
    let pipeClosed = !stream;
    const onError = (error) => {
      if (!isEpipe(error)) {
        throw error;
      }
      pipeClosed = true;
      remember('diagnostic', `${streamName} logging pipe closed (EPIPE)`);
    };
    stream?.on?.('error', onError);

    return {
      write(line) {
        if (pipeClosed || stream.destroyed || stream.writableEnded) {
          return false;
        }
        try {
          stream.write(`${line}\n`);
          return true;
        } catch (error) {
          if (!isEpipe(error)) {
            throw error;
          }
          pipeClosed = true;
          remember('diagnostic', `${streamName} logging pipe closed (EPIPE)`);
          return false;
        }
      },
      dispose() {
        stream?.off?.('error', onError);
      },
    };
  }

  const output = writer(stdout, 'stdout');
  const errors = writer(stderr, 'stderr');

  return {
    info(message) {
      remember('info', message);
      return output.write(message);
    },
    error(message) {
      const rendered = message instanceof Error ? (message.stack || message.message) : String(message);
      remember('error', rendered);
      return errors.write(rendered);
    },
    recent() {
      return history.map((entry) => ({ ...entry }));
    },
    dispose() {
      output.dispose();
      errors.dispose();
    },
  };
}

function classifyBackendTermination({ code = null, signal = null, expected = false } = {}) {
  return {
    status: expected ? 'stopped_expectedly' : 'exited_unexpectedly',
    expected,
    code,
    signal,
    summary: `${expected ? 'expected' : 'unexpected'} backend exit; code=${code} signal=${signal}`,
  };
}

function stopChildProcess(
  child,
  { platform = process.platform, spawnSyncImpl = spawnSync } = {},
) {
  if (!child || child.killed || child.exitCode !== null) {
    return { attempted: false, status: null };
  }
  if (platform === 'win32') {
    const completed = spawnSyncImpl('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return { attempted: true, status: completed.status };
  }
  child.kill('SIGTERM');
  return { attempted: true, status: null };
}

module.exports = {
  classifyBackendTermination,
  createSafeLogger,
  isEpipe,
  stopChildProcess,
};
