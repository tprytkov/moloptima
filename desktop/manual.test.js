const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildManualHtml,
  manualHeadingId,
  readManual,
  renderMarkdownBody,
  resolveManualPath,
} = require('./manual.js');

test('manual heading anchors are stable and omit section numbering', () => {
  assert.equal(manualHeadingId('8. ADMET Visualization'), 'admet-visualization');
  assert.equal(manualHeadingId('13.2 Pareto Analysis'), 'pareto-analysis');
});

test('manual rendering is local, semantic, printable, and deep-linkable', () => {
  const html = buildManualHtml('# MolOptima User Manual\n\n## 7. ADMET Prediction\n\nProbability is not confidence.\n', 'admet-prediction');
  assert.match(html, /id="admet-prediction"/);
  assert.match(html, /aria-label="Manual sections"/);
  assert.match(html, /@media print/);
  assert.match(html, /window\.print\(\)/);
  assert.match(html, /target = document\.getElementById\("admet-prediction"\)/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test('manual path resolves to packaged resources without a development source dependency', () => {
  assert.equal(
    resolveManualPath({ isPackaged: true, resourcesPath: 'R', projectRoot: 'P' }),
    path.join('R', 'manual', 'MolOptima_User_Manual.md'),
  );
  assert.equal(
    resolveManualPath({ isPackaged: false, resourcesPath: 'R', projectRoot: 'P' }),
    path.join('P', 'docs', 'MolOptima_User_Manual.md'),
  );
});

test('missing manual fails with a readable typed result', () => {
  assert.deepEqual(readManual(path.join(os.tmpdir(), 'moloptima-manual-does-not-exist.md')), {
    ok: false,
    code: 'manual_missing',
    message: 'The offline user manual resource is unavailable.',
  });
});

test('manual source is readable through the same resource helper', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moloptima-manual-'));
  const manualPath = path.join(directory, 'manual.md');
  fs.writeFileSync(manualPath, '# Manual', 'utf8');
  assert.deepEqual(readManual(manualPath), { ok: true, markdown: '# Manual' });
  fs.rmSync(directory, { recursive: true, force: true });
});

test('desktop package includes the authoritative Markdown and manual runtime', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  assert.ok(packageJson.build.files.includes('manual.js'));
  assert.ok(packageJson.build.extraResources.some((resource) => (
    resource.from === '../docs/MolOptima_User_Manual.md'
    && resource.to === 'manual/MolOptima_User_Manual.md'
  )));
});

test('authoritative manual contains every deep-linked workspace section', () => {
  const manual = fs.readFileSync(path.join(__dirname, '..', 'docs', 'MolOptima_User_Manual.md'), 'utf8');
  const ids = new Set(renderMarkdownBody(manual).headings.map(({ id }) => id));
  for (const required of [
    'introduction', 'getting-started', 'moloptima-scientific-workflow', 'molecules',
    'receptor-and-docking', 'admet-prediction', 'chemical-space', 'design-logic',
    'prioritization', 'results', 'analysis', 'experimental-data',
    'settings-and-scientific-runtime', 'interpretation-guidelines',
    'scientific-terminology-glossary', 'troubleshooting',
  ]) assert.ok(ids.has(required), `missing manual section ${required}`);
});

test('manual bridge is isolated from scientific state and backend requests', () => {
  const preload = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  assert.match(preload, /openUserManual/);
  assert.match(preload, /moloptima:open-user-manual/);
  assert.match(main, /showUserManual/);
  assert.doesNotMatch(preload, /activeJob|prioritizationState|fetch\(/);
  const manualHandler = main.slice(main.indexOf("ipcMain.handle('moloptima:open-user-manual'"), main.indexOf("function getBundledPythonPath"));
  assert.doesNotMatch(manualHandler, /activeJob|prioritizationState|fetch\(|backendUrl/);
});
