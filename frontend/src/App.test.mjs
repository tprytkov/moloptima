import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let module;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  module = await vite.ssrLoadModule('/src/App.jsx');
});

after(async () => vite?.close());

test('primary navigation follows the scientific workflow and hides history tools', () => {
  const labels = module.PRIMARY_NAVIGATION.flatMap((group) => group.items.map((item) => item.label));
  assert.deepEqual(labels, [
    'New Calculation', 'Molecules', 'Receptor & Docking', 'ADMET',
    'Prioritization', 'Results', 'Analysis', 'Settings',
  ]);
  assert.equal(labels.includes('Run History'), false);
  assert.equal(labels.includes('Run Comparison'), false);
});

test('sidebar uses the approved MolOptima logo without a duplicate wordmark', async () => {
  const source = await readFile(new URL('./App.jsx', import.meta.url), 'utf8');
  assert.match(source, /moloptima-logo\.png/);
  assert.match(source, /alt="MolOptima"/);
  assert.doesNotMatch(source, />MOLOPTIMA<\/Typography>/);
});

test('primary-page scroll reset targets the provided scrolling element', () => {
  let options = null;
  module.resetPrimaryPageScroll({ scrollTo: (value) => { options = value; } });
  assert.deepEqual(options, { top: 0, left: 0, behavior: 'auto' });
});

test('home status uses one human-readable status and a concise job ID', () => {
  const fullJobId = 'b1d1b0f655ce46ba8d2dc350ec7718b7';
  assert.equal(module.compactJobId(fullJobId), 'b1d1b0f6…');
  assert.equal(module.currentJobStatusLabel({ status: 'completed', stage: 'completed' }), 'Completed');
  assert.equal(module.currentJobStatusLabel({ status: 'completed_with_warnings', stage: 'completed' }), 'Completed with warnings');

  const html = renderToStaticMarkup(React.createElement(module.NewCalculationPage, {
    workflowStatuses: {}, onStart: () => {}, analysisMode: 'library',
    currentJob: { job_id: fullJobId, status: 'completed', stage: 'completed' },
  }));
  assert.match(html, /Current job:[\s\S]*b1d1b0f6…[\s\S]*· Completed/);
  assert.match(html, new RegExp(`title="Full job ID: ${fullJobId}"`));
  assert.doesNotMatch(html, /completed · completed/i);
});

test('compound-detail reveal scrolls and focuses the mounted detail container', () => {
  const calls = [];
  module.revealCompoundDetail({
    scrollIntoView: (options) => calls.push(['scroll', options]),
    focus: (options) => calls.push(['focus', options]),
  });
  assert.deepEqual(calls, [
    ['scroll', { behavior: 'smooth', block: 'start' }],
    ['focus', { preventScroll: true }],
  ]);
  assert.equal(module.revealCompoundDetail(null), undefined);
});

test('Results export and Compound Detail actions expose meaningful accessible names', () => {
  const filterHtml = renderToStaticMarkup(React.createElement(module.EvidenceFilterPanel, {
    rows: [], filteredRows: [], filters: {}, onChange: () => {}, onReset: () => {}, exportFilename: 'results.csv',
  }));
  assert.match(filterHtml, /aria-label="Export filtered results as CSV"/);

  const exportHtml = renderToStaticMarkup(React.createElement(module.CandidateExportPanel, { rows: [] }));
  assert.match(exportHtml, />Export selected candidates<\/button>/);
  assert.match(exportHtml, />Markdown handoff summary<\/button>/);

  const detailHtml = renderToStaticMarkup(React.createElement(module.CompoundDetailPanel, {
    compound: { molecule_id: 'cmpd-1', canonical_smiles: '', valid_molecule: true },
    annotationsState: {}, onSaveReviewAnnotation: () => {}, onClose: () => {},
  }));
  assert.match(detailHtml, /aria-label="Download compound detail as Markdown report"/);
  assert.match(detailHtml, /aria-label="Close compound detail"/);
  assert.match(detailHtml, /tabindex="-1"/);
  assert.match(detailHtml, /aria-labelledby="compound-detail-heading"/);
});

test('readable cards are capped without imposing a global table width', () => {
  const pageHtml = renderToStaticMarkup(React.createElement(module.NewCalculationPage, {
    workflowStatuses: {}, onStart: () => {}, currentJob: null, analysisMode: 'library',
  }));
  assert.match(pageHtml, new RegExp(`max-width:${module.READABLE_CONTENT_MAX_WIDTH}px`));

  const filterHtml = renderToStaticMarkup(React.createElement(module.EvidenceFilterPanel, {
    rows: [], filteredRows: [], filters: {}, onChange: () => {}, onReset: () => {}, exportFilename: 'results.csv',
  }));
  assert.match(filterHtml, new RegExp(`max-width:${module.READABLE_CONTENT_MAX_WIDTH}px`));
});

test('production UI source contains no Phase 1 terminology', async () => {
  const source = await readFile(new URL('./App.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Phase[ -]?1/i);
});

test('scientific runtime Settings panel presents backend-qualified production contracts', () => {
  const html = renderToStaticMarkup(React.createElement(module.ScientificRuntimePanel, {
    runtimeState: {
      loading: false, error: '', payload: { components: {
        chemberta: { status: 'available', public_endpoint_count: 9, runtime_source: 'application_process' },
        gmc_mpnn_bbb: { status: 'available', runtime_source: 'packaged' },
        chemprop_regression: { status: 'available', runtime_source: 'packaged' },
        receptor_preparation: {
          status: 'available',
          meeko: { status: 'available', version: '0.7.1' },
          gemmi: { status: 'available', version: '0.7.5' },
        },
        docking: {
          status: 'available',
          vina: { status: 'available', identity: 'AutoDock Vina 1.1.2' },
          openbabel: { status: 'available', identity: 'Open Babel 3.1.0' },
        },
      } },
    },
    onRefresh: () => {},
  }));

  assert.match(html, /Scientific Runtime/);
  assert.match(html, /9 public classification endpoints/);
  assert.match(html, /5-seed ensemble · raw unweighted ensemble mean · population SD/);
  assert.match(html, /Threshold 0\.5 · provisional raw · calibration not frozen/);
  assert.match(html, /5 regression endpoints · 5-seed ensemble · sample SD/);
  assert.match(html, /Meeko 0\.7\.1 · Available/);
  assert.match(html, /Gemmi 0\.7\.5 · Available/);
  assert.match(html, /AutoDock Vina 1\.1\.2/);
  assert.match(html, /Open Babel 3\.1\.0/);
  assert.match(html, /does not establish pH-correct protonation/);
  assert.match(html, /not binding free energy/);
  assert.match(html, /Runtime source: Current application process/);
  assert.match(html, /Runtime source: Packaged scientific runtime/);
  assert.doesNotMatch(html, /application_process/);
});

test('scientific presentation mappings preserve distinct states and safely label runtime sources', () => {
  assert.equal(module.formatScientificPresentationValue('not_requested'), 'Not requested');
  assert.equal(module.formatScientificPresentationValue('not_used'), 'Not used');
  assert.equal(module.formatScientificPresentationValue('not_provided'), 'Not provided');
  assert.equal(module.formatScientificPresentationValue('model_unavailable'), 'Model unavailable');
  assert.equal(module.formatScientificPresentationValue('failed'), 'Failed');
  assert.equal(module.formatScientificPresentationValue(null), 'Not available');
  assert.equal(module.formatScientificPresentationValue('unmapped_scientific_state'), 'unmapped_scientific_state');
  assert.equal(module.formatScientificPresentationValue(false), 'No');
  assert.equal(module.formatRuntimeSource('application_process'), 'Current application process');
  assert.equal(module.formatRuntimeSource('future_runtime_source'), 'Future runtime source');
});

test('Settings moves obsolete BBB cache presentation under Advanced diagnostics', () => {
  const html = renderToStaticMarkup(React.createElement(module.ModelDataSourcesPage, {
    sourceStatusState: { payload: null, loading: false, error: '' },
    onCheckLocalModelCache: () => {},
    onRefreshSourceStatus: () => {},
  }));

  assert.match(html, /Advanced diagnostics · legacy BBB cache and run manifests/);
  assert.match(html, /<details/);
  assert.match(html, /Legacy BBB Cache Diagnostics/);
  assert.match(html, /retired cache-backed BBB classifier/);
  assert.match(html, /does not describe current production ChemBERTa classification or GMC-MPNN BBB inference/);
  assert.doesNotMatch(html, /BBB\/ChemBERTa model/);
  assert.doesNotMatch(html, />Local Model Cache</);
});

test('scientific runtime status helper calls the focused backend endpoint', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  let requestedOptions;
  globalThis.fetch = async (url, options) => {
    requestedUrl = url;
    requestedOptions = options;
    return { ok: true, json: async () => ({ status_source: 'production_runtime_contract_probes' }) };
  };
  try {
    const payload = await module.fetchScientificRuntimeStatus('http://api');
    assert.equal(requestedUrl, 'http://api/api/scientific-runtime/status');
    assert.equal(requestedOptions, undefined);
    assert.equal(payload.status_source, 'production_runtime_contract_probes');
    await module.fetchScientificRuntimeStatus('http://api', { refresh: true });
    assert.equal(requestedUrl, 'http://api/api/scientific-runtime/refresh');
    assert.deepEqual(requestedOptions, { method: 'POST' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('scientific runtime cards render completed families while another remains pending', () => {
  const payload = { qualification_state: 'checking', components: {
    chemberta: { status: 'available', public_endpoint_count: 9, runtime_source: 'application_process' },
    gmc_mpnn_bbb: { status: 'checking', runtime_source: 'pending' },
    chemprop_regression: { status: 'checking', runtime_source: 'pending' },
    receptor_preparation: {
      status: 'available',
      meeko: { status: 'available', version: '0.7.1' },
      gemmi: { status: 'available', version: '0.7.5' },
    },
    docking: {
      status: 'available',
      vina: { status: 'available', identity: 'AutoDock Vina 1.1.2' },
      openbabel: { status: 'available', identity: 'Open Babel 3.1.0' },
    },
  } };
  const html = renderToStaticMarkup(React.createElement(module.ScientificRuntimePanel, {
    runtimeState: { loading: false, error: '', payload }, onRefresh: () => {},
  }));

  assert.match(html, /ChemBERTa classification[\s\S]*Available/);
  assert.match(html, /GMC-MPNN BBB[\s\S]*Checking/);
  assert.match(html, /Completed runtimes are shown as they finish/);
});

test('scientific runtime polling continues only while statuses are non-terminal', () => {
  assert.equal(module.scientificRuntimePollDelay({ qualification_state: 'checking', components: {} }), 3000);
  assert.equal(module.scientificRuntimePollDelay({
    qualification_state: 'complete', components: { gmc_mpnn_bbb: { status: 'checking' } },
  }), 3000);
  assert.equal(module.scientificRuntimePollDelay({
    qualification_state: 'complete', components: {
      chemberta: { status: 'available' },
      gmc_mpnn_bbb: { status: 'incompatible' },
      chemprop_regression: { status: 'error' },
    },
  }), null);
  assert.equal(module.scientificRuntimePollDelay(null), null);
});

test('CSV preview handles quoted commas and exposes only real input rows', () => {
  assert.deepEqual(module.csvMoleculePreview('molecule_id,smiles\n"M,1",CCO\nM2,c1ccccc1\n'), [
    { moleculeId: 'M,1', smiles: 'CCO' }, { moleculeId: 'M2', smiles: 'c1ccccc1' },
  ]);
});

test('workflow status comes from current upload, configuration, job, and results', () => {
  const status = module.deriveWorkflowStatuses({
    uploadState: { upload: { upload_id: 'u1' } },
    targetContext: { docking_configuration_id: 'c1' },
    prioritizationState: {
      loading: false, error: '', job: { status: 'completed', stage: 'completed' },
      result: { results: [{ admet_model_status: 'model_available', docking_result: { status: 'success' } }] },
    },
  });
  assert.equal(status.Molecules, 'Complete');
  assert.equal(status['Receptor & Docking'], 'Complete');
  assert.equal(status.ADMET, 'Complete');
  assert.equal(status.Prioritization, 'Complete');
  assert.equal(status.Results, 'Complete');
  assert.equal(status.Analysis, 'Ready');
});

test('a fresh workflow does not fabricate completed work', () => {
  const status = module.deriveWorkflowStatuses({
    uploadState: {}, targetContext: {}, prioritizationState: { loading: false, error: '', job: null, result: null },
  });
  Object.values(status).forEach((value) => assert.equal(value, 'Not started'));
});

test('single-compound results render assessment sections without ranking language', () => {
  const html = renderToStaticMarkup(React.createElement(module.SingleCompoundAssessment, {
    compound: {
      molecule_id: 'ethanol', canonical_smiles: 'CCO', valid_molecule: true,
      mw: 46.069, tpsa: 20.23, hbd: 1, hba: 1, rotatable_bonds: 0, qed: 0.4,
      source_type: 'smiles', validation_status: 'valid', admet_predictions: {},
      docking_result: { status: 'not_requested' },
    },
  }));
  assert.match(html, /Single Compound Assessment/);
  assert.match(html, /Molecular Properties/);
  assert.match(html, /Profile Interpretation/);
  assert.match(html, /Structure Provenance/);
  assert.match(html, /does not assign a final library rank/);
  assert.doesNotMatch(html, /Prioritized candidate #1|Top Candidate|rank = 1/i);
});

test('single-compound analysis disables Pareto and rank sensitivity', () => {
  const html = renderToStaticMarkup(React.createElement(module.AnalysisWorkflowPage, {
    currentRunState: { job: { analysis_mode: 'single_compound' }, result: { analysis_mode: 'single_compound', results: [{}] } },
    annotationsState: {}, onSaveReviewAnnotation: () => {}, prioritizationSettings: {},
  }));
  assert.match(html, /Not applicable for Single Compound Analysis/);
  assert.match(html, /Pareto Analysis/);
  assert.match(html, /Rank Sensitivity/);
  assert.doesNotMatch(html, /aria-label="Analysis views"/);
});

test('single Results mode uses assessment title, provenance, and no library analysis UI', () => {
  const html = renderToStaticMarkup(React.createElement(module.ResultsWorkflowPage, {
    prioritizationState: {
      job: { job_id: 'single-job', status: 'completed', analysis_mode: 'single_compound', warning_count: 0 },
      result: {
        analysis_mode: 'single_compound', prioritization_method: 'v2',
        prioritization_profile_sha256: 'single-profile-sha',
        prioritization_profile: {
          profile_id: 'single-profile', name: 'Single profile', profile_version: '1.2.3',
          status: 'validated', target_mode: 'cns',
        },
        results: [{
        molecule_id: 'ethanol', canonical_smiles: 'CCO', valid_molecule: true,
        validation_status: 'valid', source_type: 'smiles', admet_model_status: 'model_available',
        admet_predictions: {}, docking_result: { status: 'not_requested' }, prioritization_v2: {},
      }] },
    },
    annotationsState: {}, onSaveReviewAnnotation: () => {},
  }));
  assert.match(html, /Single Compound Assessment/);
  assert.match(html, /Compound Identity/);
  assert.match(html, /Structure Provenance/);
  assert.match(html, /Selected profile context/);
  assert.match(html, /single-profile/);
  assert.match(html, /Single profile/);
  assert.match(html, /1\.2\.3/);
  assert.match(html, /validated/);
  assert.match(html, /single-profile-sha/);
  assert.match(html, /cns/);
  assert.doesNotMatch(html, /Pareto trade-off analysis|Sensitivity analysis not run|Prioritized compounds/i);
});

test('library Results mode reports ranks, profile, receptor, and partial failures honestly', () => {
  const html = renderToStaticMarkup(React.createElement(module.ResultsWorkflowPage, {
    prioritizationState: {
      job: {
        job_id: 'library-job', status: 'completed', analysis_mode: 'library', ranked_count: 1,
        warning_count: 1, failure_count: 1, docking_requested: true, receptor_source: 'user_supplied_pdbqt',
        prioritization_profile_sha256: 'profile-sha', prioritization_profile: { profile_id: 'profile-a', profile_version: '1.0.0' },
      },
      result: { analysis_mode: 'library', prioritization_method: 'v2', results: [
        { molecule_id: 'valid', canonical_smiles: 'CCO', valid_molecule: true, admet_model_status: 'model_available', docking_result: { status: 'success' } },
        { molecule_id: 'invalid', valid_molecule: false, validation_status: 'invalid', docking_result: { status: 'not_run_invalid_molecule' } },
      ] },
    },
    annotationsState: {}, onSaveReviewAnnotation: () => {},
  }));
  assert.match(html, /Library Prioritization Results/);
  assert.match(html, /Prioritized/);
  assert.match(html, /profile-a \/ 1\.0\.0 \/ status unavailable \/ profile-sha/);
  assert.match(html, /User-supplied PDBQT/);
  assert.match(html, /Run provenance and identifiers/);
  assert.match(html, /partial failures or unavailable scientific outputs/);
});

test('Compound Detail curates decision fields and keeps diagnostics available', () => {
  const compound = {
    molecule_id: 'cmpd-1', canonical_smiles: 'CCO', valid_molecule: true,
    validation_status: 'valid', identity_check_status: 'exact_match', known_compound_match: true,
    known_compound_name: 'Ethanol', known_compound_source: 'local_reference',
    pubchem_lookup_status: 'not_requested', pubchem_cache_status: 'not_used',
    chembl_lookup_status: 'not_requested', chembl_cache_status: 'not_used',
    patent_lookup_status: 'not_requested', patent_cache_status: 'not_used',
    bbb_model_status: 'model_unavailable', docking_status: 'not_requested', lipinski_pass: 'True',
  };
  const sections = module.compoundDetailSummarySections(compound);
  assert.deepEqual(sections.map(({ title }) => title), [
    'Molecule Identity', 'Prioritization and Evidence', 'Physicochemical Properties',
    'Model Outputs', 'Docking and Structural Context', 'Public Evidence Context',
  ]);
  const html = renderToStaticMarkup(React.createElement(module.CompoundDetailPanel, {
    compound, annotationsState: {}, onSaveReviewAnnotation: () => {}, onClose: () => {},
  }));
  assert.match(html, /Model unavailable/);
  assert.match(html, /Not requested/);
  assert.match(html, /Local reference/);
  assert.match(html, /Complete provenance and diagnostic fields/);
  assert.match(html, /Docking score[\s\S]*Not available/);
  assert.match(html, /Lipinski assessment[\s\S]*Pass/);
  assert.doesNotMatch(html, />model_unavailable</);
  assert.doesNotMatch(html, />local_reference</);
});

test('prioritization page adapts to compound assessment for one valid compound', () => {
  const noop = () => {};
  const html = renderToStaticMarkup(React.createElement(module.PrioritizationPage, {
    uploadState: { upload: { upload_id: 'u1', analysis_mode: 'single_compound' } },
    prioritizationState: { job: null, result: null, loading: false, error: '' },
    onStartPrioritization: noop, onCancelPrioritization: noop,
    pubchemLookupEnabled: false, setPubchemLookupEnabled: noop,
    chemblLookupEnabled: false, setChemblLookupEnabled: noop,
    patentLookupEnabled: false, setPatentLookupEnabled: noop,
    targetReferenceEnabled: false, setTargetReferenceEnabled: noop,
    targetContext: { enable_docking: false }, setTargetContext: noop,
    prioritizationSettings: { method: 'legacy_v1', profile: null, validation: null },
    setPrioritizationSettings: noop, annotationsState: {}, onSaveReviewAnnotation: noop,
    onNavigate: noop,
  }));
  assert.match(html, /Compound Assessment/);
  assert.match(html, /Start compound assessment/);
  assert.match(html, /Not applicable: Library Prioritization, Pareto Analysis, and Rank Sensitivity/);
});

function renderDockingWorkflow(upload) {
  const noop = () => {};
  return renderToStaticMarkup(React.createElement(module.DockingWorkflowPage, {
    uploadState: { upload },
    prioritizationState: { job: null, result: null, loading: false, error: '' },
    targetContext: {},
    onDockingSetupConfirmed: noop,
    onRunDocking: noop,
    onNavigate: noop,
  }));
}

function continueToAdmetButton(html) {
  return html.match(/<button[^>]*data-testid="continue-to-admet"[^>]*>/)?.[0] ?? '';
}

test('invalid-only upload reports zero valid molecules and blocks scientific continuation', () => {
  const html = renderDockingWorkflow({ rows: 1, submitted_count: 1, valid_count: 0, invalid_count: 1 });
  assert.match(html, /1 submitted; 0 valid molecules available/);
  assert.match(continueToAdmetButton(html), /disabled/);
  assert.equal(module.validatedMoleculeCount({ valid_count: 0 }), 0);
});

test('mixed upload allows continuation when one validated molecule remains', () => {
  const html = renderDockingWorkflow({ rows: 2, submitted_count: 2, valid_count: 1, invalid_count: 1 });
  assert.match(html, /2 submitted; 1 valid molecule available/);
  assert.doesNotMatch(continueToAdmetButton(html), /disabled/);
});

test('fully valid upload preserves scientific continuation', () => {
  const html = renderDockingWorkflow({ rows: 2, submitted_count: 2, valid_count: 2, invalid_count: 0 });
  assert.match(html, /2 submitted; 2 valid molecules available/);
  assert.doesNotMatch(continueToAdmetButton(html), /disabled/);
});

test('docking result selection exposes a keyboard-operable action and readable status', () => {
  const noop = () => {};
  const html = renderToStaticMarkup(React.createElement(module.DockingWorkflowPage, {
    uploadState: { upload: { rows: 1, submitted_count: 1, valid_count: 1 } },
    prioritizationState: {
      job: { status: 'completed' }, loading: false, error: '',
      result: { results: [{
        molecule_id: 'a-very-long-molecule-name-used-to-check-wrapping',
        docking_result: {
          status: 'runtime_unavailable', returned_mode_count: 0, modes: [],
          warning: 'Vina executable missing.',
        },
      }] },
    },
    targetContext: {}, onDockingSetupConfirmed: noop, onRunDocking: noop, onNavigate: noop,
  }));
  assert.match(html, /aria-label="Current docking results"/);
  assert.match(html, /aria-label="View docking result for a-very-long-molecule-name-used-to-check-wrapping"/);
  assert.match(html, /Vina runtime unavailable/);
  assert.doesNotMatch(html, />runtime_unavailable</);
});

test('normalizes current-format completed prioritization from result rows', () => {
  const summary = module.normalizePrioritizationSummary({
    job: { status: 'completed', submitted_count: 2, total_count: 2 },
    result: { prioritization_method: 'profile_v2', results: [
      { valid_molecule: true, prioritization_status: 'fully_scored', scientific_rank: 1 },
      { valid_molecule: false, prioritization_status: 'unscorable' },
    ] },
  });
  assert.equal(summary.processedCount, 2);
  assert.equal(summary.validCount, 1);
  assert.equal(summary.rankedCount, 1);
  assert.equal(summary.unscorableCount, 1);
  assert.match(summary.completionMessage, /2 result rows are ready/);
});

test('normalizes legacy completed results without fabricating unavailable ranking counts', () => {
  const summary = module.normalizePrioritizationSummary({
    job: { status: 'completed', row_count: 1, processed_count: 1, total_count: 1, eligible_count: 0, ranked_count: 0 },
    result: { results: [{ valid_molecule: true, priority_score: 0.673 }] },
  });
  assert.equal(summary.processedCount, 1);
  assert.equal(summary.validCount, 1);
  assert.equal(summary.rankedCount, 'Not available');
  assert.equal(summary.resultCount, 1);
});

test('normalizes zero-result completed and failed prioritization states honestly', () => {
  const empty = module.normalizePrioritizationSummary({
    job: { status: 'completed', submitted_count: 0, total_count: 0 }, result: { results: [] },
  });
  assert.equal(empty.completionMessage, 'Calculation completed with no result rows.');
  const failed = module.normalizePrioritizationSummary({
    job: { status: 'failed', error_message: 'Pipeline stopped.' }, result: { results: [] },
  });
  assert.equal(failed.completionTitle(false), 'Calculation failed');
  assert.equal(failed.completionMessage, 'Pipeline stopped.');
});

test('Biopharma evidence fields use unique semantic keys across repeated rendering', () => {
  const compound = {
    molecule_id: 'cmpd-1', valid_molecule: true, nearest_active_compound_name: 'Reference A',
    nearest_active_similarity: 0.81, active_neighborhood_signal: 'supported',
    nearest_active_activity_class: 'active', target_reference_source: 'local',
  };
  const rows = module.biopharmaEvidenceRows(compound);
  const provenanceRows = module.biopharmaProvenanceRows({
    ...compound, pubchem_cache_status: 'cache_hit', chembl_cache_status: 'not_used', patent_cache_status: 'not_used',
  });
  const labels = rows.map(([label]) => label);
  assert.equal(new Set(labels).size, labels.length);
  assert.equal(rows.find(([label]) => label === 'Reference source'), undefined);
  assert.deepEqual(provenanceRows.slice(0, 3), [
    ['Reference source', 'Local reference'],
    ['PubChem cache status', 'Cache hit'],
    ['ChEMBL cache status', 'Not used'],
  ]);

  const originalError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args.join(' '));
  try {
    const props = { compound, annotationsState: {}, onSaveReviewAnnotation: () => {} };
    const first = renderToStaticMarkup(React.createElement(module.BiopharmaInterpretationPanel, props));
    const second = renderToStaticMarkup(React.createElement(module.BiopharmaInterpretationPanel, props));
    assert.equal((first.match(/Nearest active\/reference compound/g) ?? []).length, 1);
    assert.equal((second.match(/Nearest active\/reference compound/g) ?? []).length, 1);
  } finally {
    console.error = originalError;
  }
  assert.equal(errors.filter((message) => /same key|unique.*key/i.test(message)).length, 0);
});
