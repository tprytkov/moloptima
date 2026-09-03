const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const {
  classifyBackendTermination,
  createSafeLogger,
  isEpipe,
  stopChildProcess,
} = require('./lifecycle.js');

class TestStream extends EventEmitter {
  constructor() {
    super();
    this.lines = [];
    this.destroyed = false;
    this.writableEnded = false;
  }

  write(value) {
    this.lines.push(value);
    return true;
  }
}

test('safe logger preserves ordinary stdout and stderr logging', () => {
  const stdout = new TestStream();
  const stderr = new TestStream();
  const logger = createSafeLogger({ stdout, stderr });

  assert.equal(logger.info('backend ready'), true);
  assert.equal(logger.error('backend warning'), true);
  assert.deepEqual(stdout.lines, ['backend ready\n']);
  assert.deepEqual(stderr.lines, ['backend warning\n']);
  assert.deepEqual(logger.recent().slice(-2), [
    { level: 'info', message: 'backend ready' },
    { level: 'error', message: 'backend warning' },
  ]);
});

test('safe logger handles only EPIPE and retains diagnostics after the pipe closes', () => {
  const stdout = new TestStream();
  const logger = createSafeLogger({ stdout, stderr: new TestStream() });

  assert.equal(isEpipe(Object.assign(new Error('closed'), { code: 'EPIPE' })), true);
  assert.doesNotThrow(() => stdout.emit('error', Object.assign(new Error('closed'), { code: 'EPIPE' })));
  assert.equal(logger.info('after close'), false);
  assert.match(JSON.stringify(logger.recent()), /stdout logging pipe closed \(EPIPE\)/);
  assert.match(JSON.stringify(logger.recent()), /after close/);
});

test('safe logger does not swallow non-EPIPE stream errors', () => {
  const stdout = new TestStream();
  createSafeLogger({ stdout, stderr: new TestStream() });
  const failure = Object.assign(new Error('permission failure'), { code: 'EACCES' });

  assert.throws(() => stdout.emit('error', failure), failure);
});

test('backend termination classification distinguishes expected shutdown from a crash', () => {
  assert.deepEqual(classifyBackendTermination({ code: 0, expected: true }), {
    status: 'stopped_expectedly', expected: true, code: 0, signal: null,
    summary: 'expected backend exit; code=0 signal=null',
  });
  assert.deepEqual(classifyBackendTermination({ code: 9, signal: 'SIGTERM' }), {
    status: 'exited_unexpectedly', expected: false, code: 9, signal: 'SIGTERM',
    summary: 'unexpected backend exit; code=9 signal=SIGTERM',
  });
});

test('Windows shutdown waits for the exact child process tree to stop', () => {
  const calls = [];
  const result = stopChildProcess(
    { pid: 1234, killed: false, exitCode: null },
    {
      platform: 'win32',
      spawnSyncImpl: (...args) => {
        calls.push(args);
        return { status: 0 };
      },
    },
  );

  assert.deepEqual(result, { attempted: true, status: 0 });
  assert.deepEqual(calls[0][0], 'taskkill');
  assert.deepEqual(calls[0][1], ['/pid', '1234', '/T', '/F']);
  assert.equal(calls[0][2].windowsHide, true);
  assert.deepEqual(
    stopChildProcess({ pid: 1234, killed: true, exitCode: null }, { platform: 'win32' }),
    { attempted: false, status: null },
  );
});
