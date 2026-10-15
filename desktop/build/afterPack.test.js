const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const path = require('node:path');

const { shouldCopyRuntimePath } = require('./afterPack.js');

test('runtime packaging omits generated Python bytecode only', () => {
  assert.equal(shouldCopyRuntimePath(path.join('runtime', 'python', 'module.py')), true);
  assert.equal(shouldCopyRuntimePath(path.join('runtime', 'python', 'module.pyd')), true);
  assert.equal(shouldCopyRuntimePath(path.join('runtime', 'python', 'model.pt')), true);
  assert.equal(
    shouldCopyRuntimePath(path.join('runtime', 'python', 'Lib', '__pycache__', 'module.pyc')),
    false,
  );
  assert.equal(shouldCopyRuntimePath(path.join('runtime', 'python', 'module.pyc')), false);
  assert.equal(shouldCopyRuntimePath(path.join('runtime', 'python', 'module.pyo')), false);
});

test('packaged backend process disables bytecode writes', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(source, /PYTHONDONTWRITEBYTECODE:\s*'1'/);
});
