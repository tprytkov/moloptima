const fs = require('node:fs');
const path = require('node:path');

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
  });
  console.log(`MolOptima runtime bundle copied to ${runtimeTarget}`);
};
