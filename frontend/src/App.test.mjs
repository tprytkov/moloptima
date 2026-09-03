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
  assert.match(html, /Meeko 0\.7\.1 · available/);
  assert.match(html, /Gemmi 0\.7\.5 · available/);
  assert.match(html, /AutoDock Vina 1\.1\.2/);
  assert.match(html, /Open Babel 3\.1\.0/);
  assert.match(html, /does not establish pH-correct protonation/);
  assert.match(html, /not binding free energy/);
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
  assert.match(html, /user_supplied_pdbqt/);
  assert.match(html, /partial failures or unavailable scientific outputs/);
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
