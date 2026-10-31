import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let content;
let components;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  content = await vite.ssrLoadModule('/src/helpContent.js');
  components = await vite.ssrLoadModule('/src/HelpSystem.jsx');
});

after(async () => vite?.close());

test('central Help exposes the complete stable topic architecture offline', () => {
  assert.deepEqual(content.HELP_TOPIC_ORDER, [
    'getting-started', 'scientific-workflow', 'molecules', 'receptor-docking', 'admet',
    'chemical-space', 'design-logic', 'prioritization', 'results', 'analysis',
    'experimental-data', 'settings', 'scientific-concepts', 'glossary',
    'troubleshooting', 'user-manual',
  ]);
  const html = renderToStaticMarkup(React.createElement(components.HelpWorkspace));
  assert.match(html, /MolOptima Help/);
  assert.match(html, /Search MolOptima Help/);
  assert.match(html, /Help is informational and never runs or changes a calculation/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test('every major scientific workspace maps to focused module Help', () => {
  for (const workspace of [
    'Molecules', 'Receptor & Docking', 'ADMET', 'Chemical Space', 'Design Logic',
    'Prioritization', 'Results', 'Analysis', 'Experimental Data', 'Settings',
  ]) {
    const mapping = content.moduleHelpForNavigation(workspace);
    assert.ok(mapping, `${workspace} should have module Help`);
    assert.ok(content.HELP_TOPICS[mapping.topicId]);
    assert.ok(content.contextHelpForModule(workspace));
  }
  assert.equal(content.moduleHelpForNavigation('Help'), null);
});

test('local Help search covers titles, scientific content, statuses, and glossary terms', () => {
  assert.ok(content.filterHelpTopics('Tanimoto').some((topic) => topic.id === 'chemical-space'));
  assert.ok(content.filterHelpTopics('Probe Timed Out').some((topic) => topic.id === 'settings'));
  assert.ok(content.filterHelpTopics('ProLIF').some((topic) => topic.id === 'design-logic'));
  assert.ok(content.filterHelpTopics('AMES').some((topic) => topic.id === 'glossary'));
  assert.deepEqual(content.filterHelpTopics('no-such-help-term'), []);
});

test('ADMET Help preserves current model families, units, and BBB semantics', () => {
  const text = JSON.stringify(content.HELP_TOPICS.admet);
  for (const expected of [
    'ChemBERTa', 'GMC-MPNN', 'Chemprop', 'HIA', 'P-gp inhibition', 'AMES',
    'log10(Papp [cm/s])', 'log-ratio', 'log mol/L', 'percent bound', 'L/kg',
    'five-seed', '0.5', 'provisional_raw', 'not_frozen',
  ]) assert.match(text, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(text, /not a formal confidence estimate/);
  for (const termId of ['admet-probability-bars', 'admet-regression-scales', 'admet-heat-map', 'admet-histogram', 'admet-scatter', 'admet-comparison']) {
    assert.equal(content.CONTEXT_HELP[termId].topicId, 'admet');
    assert.ok(content.MODULE_HELP.ADMET.terms.includes(termId));
  }
});

test('scientific boundaries distinguish docking, projections, evidence, and analysis', () => {
  assert.match(JSON.stringify(content.HELP_TOPICS['receptor-docking']), /not an experimental binding affinity/);
  assert.match(JSON.stringify(content.HELP_TOPICS['chemical-space']), /PCA projection is not Tanimoto molecular similarity/);
  assert.match(JSON.stringify(content.HELP_TOPICS['design-logic']), /does not calculate an overall score/);
  assert.match(JSON.stringify(content.HELP_TOPICS.analysis), /not statistical confidence/);
  assert.match(JSON.stringify(content.HELP_TOPICS['experimental-data']), /Analog activity belongs to the measured analog/);
});

test('Prioritization Help uses only approved user-facing terminology', () => {
  const text = JSON.stringify(content.HELP_TOPICS.prioritization);
  for (const approved of ['Standard Prioritization', 'Multi-Parameter Prioritization', 'Prioritization Profile', 'Priority Rank', 'Prioritization Score', 'Evidence Status', 'Results Need Recalculation']) {
    assert.match(text, new RegExp(approved));
  }
  assert.doesNotMatch(text, /Legacy v1|Legacy v2|Prioritization v2|AI Ranking|Smart Ranking|Optimized Ranking/);
  assert.doesNotMatch(text, /best compound|objectively best/i);
});

test('context Help is keyboard-addressable and exposes a Learn more path', async () => {
  const html = renderToStaticMarkup(React.createElement(components.ContextHelp, { termId: 'classification-probability' }));
  assert.match(html, /aria-label="Help: Classification probability"/);
  assert.match(html, /aria-haspopup="dialog"/);
  const source = await readFile(new URL('./HelpSystem.jsx', import.meta.url), 'utf8');
  assert.match(source, />Learn more</);
  assert.match(source, /onLearnMore\?\.\(content\.topicId\)/);
  assert.match(source, /onClose={close}/);
});

test('module Help uses one bounded dialog pattern with full-Help navigation', async () => {
  const source = await readFile(new URL('./HelpSystem.jsx', import.meta.url), 'utf8');
  assert.match(source, /export function ModuleHelpDialog/);
  assert.match(source, /maxHeight: 'min\(760px, calc\(100vh - 32px\)\)'/);
  assert.match(source, /Open full Help/);
  assert.match(source, />Key terms</);
  assert.match(source, /moduleHelp\.terms\.map/);
  assert.match(source, /aria-labelledby="module-help-title"/);
  assert.match(source, /Close \$\{moduleHelp\.title\}/);
});

test('Help components accept no active calculation or scientific mutation callbacks', async () => {
  const source = await readFile(new URL('./HelpSystem.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /activeJob|prioritizationState|onRun|onApply|apiRequest|fetch\(/);
  const html = renderToStaticMarkup(React.createElement(components.HelpWorkspace, { initialTopicId: 'troubleshooting' }));
  assert.match(html, /Troubleshooting &amp; Status Interpretation/);
});

test('manual guidance does not expose an unbundled development path', () => {
  const text = JSON.stringify(content.HELP_TOPICS['user-manual']);
  assert.match(text, /not currently bundled/);
  assert.doesNotMatch(text, /C:\\MolOptima|docs\/MolOptima_User_Manual/);
});

test('simple labels are deliberately absent from contextual Help', () => {
  for (const simple of ['Name', 'Status', 'Molecule', 'Search']) {
    assert.equal(Object.values(content.CONTEXT_HELP).some((item) => item.label === simple), false);
  }
});
