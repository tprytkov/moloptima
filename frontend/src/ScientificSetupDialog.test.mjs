import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import { createScientificSetupState, scientificSetupReducer } from './scientificSetupState.js';

let vite;
let shouldConfirmScientificSetupClose;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  ({ shouldConfirmScientificSetupClose } = await vite.ssrLoadModule('/src/ScientificSetupDialog.jsx'));
});

after(async () => vite?.close());

test('open creates an isolated draft from the applied configuration', () => {
  const applied = { method: 'PCA', grouping: 'source' };
  const opened = scientificSetupReducer(createScientificSetupState(applied), { type: 'open' });
  assert.equal(opened.open, true);
  assert.deepEqual(opened.draftConfiguration, applied);
  assert.notStrictEqual(opened.draftConfiguration, applied);
});

test('draft edits do not mutate applied configuration', () => {
  const opened = scientificSetupReducer(createScientificSetupState({ grouping: 'source' }), { type: 'open' });
  const edited = scientificSetupReducer(opened, { type: 'change', patch: { grouping: 'scaffold' } });
  assert.equal(edited.draftConfiguration.grouping, 'scaffold');
  assert.equal(edited.appliedConfiguration.grouping, 'source');
  assert.equal(edited.dirty, true);
});

test('Cancel discards draft changes while Apply commits them', () => {
  const opened = scientificSetupReducer(createScientificSetupState({ grouping: 'source' }), { type: 'open' });
  const edited = scientificSetupReducer(opened, { type: 'change', patch: { grouping: 'scaffold' } });
  const cancelled = scientificSetupReducer(edited, { type: 'cancel' });
  assert.deepEqual(cancelled.draftConfiguration, { grouping: 'source' });
  assert.equal(cancelled.open, false);
  const applied = scientificSetupReducer(edited, { type: 'apply' });
  assert.deepEqual(applied.appliedConfiguration, { grouping: 'scaffold' });
  assert.equal(applied.open, false);
});

test('Apply & Run commits the draft while retaining the dialog for progress', () => {
  const edited = scientificSetupReducer(
    scientificSetupReducer(createScientificSetupState({ grouping: 'source' }), { type: 'open' }),
    { type: 'change', patch: { grouping: 'scaffold' } },
  );
  const running = scientificSetupReducer(edited, { type: 'apply-and-run' });
  assert.equal(running.open, true);
  assert.equal(running.dirty, false);
  assert.equal(running.appliedConfiguration.grouping, 'scaffold');
  assert.equal(scientificSetupReducer(running, { type: 'run-finished' }).open, false);
});

test('dirty implicit close paths require confirmation while explicit Cancel does not', () => {
  for (const reason of ['escapeKeyDown', 'backdropClick', 'closeButton']) {
    assert.equal(shouldConfirmScientificSetupClose({ dirty: true, reason }), true);
  }
  assert.equal(shouldConfirmScientificSetupClose({ dirty: false, reason: 'escapeKeyDown' }), false);
  assert.equal(shouldConfirmScientificSetupClose({ dirty: true, reason: 'cancelButton' }), false);
});

test('validation failures remain in the draft state and are cleared by the next edit', () => {
  const opened = scientificSetupReducer(createScientificSetupState({ grouping: 'source' }), { type: 'open' });
  const invalid = scientificSetupReducer(opened, { type: 'validation-failed', errors: ['Choose an option.'] });
  assert.deepEqual(invalid.validationErrors, ['Choose an option.']);
  assert.equal(invalid.open, true);
  const edited = scientificSetupReducer(invalid, { type: 'change', patch: { grouping: 'scaffold' } });
  assert.deepEqual(edited.validationErrors, []);
});

test('replace-applied resets a module configuration after authoritative context changes', () => {
  const edited = scientificSetupReducer(
    scientificSetupReducer(createScientificSetupState({ receptor: 'A' }), { type: 'open' }),
    { type: 'change', patch: { receptor: 'draft-A' } },
  );
  const replaced = scientificSetupReducer(edited, { type: 'replace-applied', configuration: { receptor: 'B' } });
  assert.deepEqual(replaced, createScientificSetupState({ receptor: 'B' }));
});

test('dialog exposes accessible sections, validation, and disabled run behavior', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('./ScientificSetupDialog.jsx', import.meta.url), 'utf8');
  assert.match(source, /aria-labelledby="scientific-setup-title"/);
  assert.match(source, /aria-describedby="scientific-setup-context"/);
  assert.match(source, /aria-label={`Close \${title}`}/);
  assert.match(source, /aria-label={`\${title} sections`}/);
  assert.match(source, /validationErrors\.length/);
  assert.match(source, /disabled={loading \|\| runDisabled}/);
});

test('dialog source preserves focus restoration defaults and exposes loading and scrolling states', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('./ScientificSetupDialog.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /disableRestoreFocus/);
  assert.match(source, /CircularProgress/);
  assert.match(source, /overflowY: 'auto'/);
  assert.match(source, /position: 'sticky'/);
  assert.match(source, /restoreFocusRef\.current\?\.focus/);
  assert.match(source, /onExited: restoreAfterDiscardTransition/);
});

test('dirty-close confirmation uses the approved exact copy and actions', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('./ScientificSetupDialog.jsx', import.meta.url), 'utf8');
  assert.match(source, />Discard unapplied changes\?</);
  assert.match(source, />Your changes have not been applied\. Discard them and close the setup dialog\?</);
  assert.match(source, />Keep Editing</);
  assert.match(source, />Discard Changes</);
});

test('generic setup dialog remains free of Chemical Space method hard-coding', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('./ScientificSetupDialog.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Chemical Space|Morgan|PCA|Tanimoto/);
});
