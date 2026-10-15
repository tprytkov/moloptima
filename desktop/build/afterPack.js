const fs = require('node:fs');
const path = require('node:path');

function shouldCopyRuntimePath(sourcePath) {
  const normalized = path.normalize(sourcePath);
  const parts = normalized.split(path.sep);
  const lower = normalized.toLowerCase();
  return !parts.includes('__pycache__') && !lower.endsWith('.pyc') && !lower.endsWith('.pyo');
}

exports.default = async function afterPack(context) {
  const runtimeSource = path.join(context.packager.projectDir, 'runtime');
  if (!fs.existsSync(runtimeSource)) {
    console.log('MolOptima runtime bundle not found; packaging without bundled Python runtime.');
    return;
  }

  const runtimeTarget = path.join(context.appOutDir, 'resources', 'runtime');
  fs.cpSync(runtimeSource, runtimeTarget, {
    recursive: true,
    force: true,
    filter: shouldCopyRuntimePath,
  });
  console.log(`MolOptima runtime bundle copied to ${runtimeTarget}`);
};

exports.shouldCopyRuntimePath = shouldCopyRuntimePath;
