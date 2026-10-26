import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let module;

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  module = await vite.ssrLoadModule('/src/ExperimentalDataWorkspace.jsx');
});

after(async () => vite?.close());

const exact = {
  measurement_id: 'm-1', molecule_id: 'cmpd-1', endpoint_name: 'IC50', endpoint_id: 'IC50',
  original_value: 10, original_unit: 'nM', relation: '=', target: { name: 'Synthetic target' },
  assay_id: 'A-1', source: 'public-safe-demo', source_record_id: 'row-1',
  linkage: { status: 'linked' }, validation_status: 'valid', quality_flags: ['experimental_endpoint'],
  normalization: {
    status: 'normalized', normalized_value_molar: 1e-8, normalized_unit: 'M',
    transformed_endpoint: 'pIC50', transformed_relation: '=', transformed_value: 8,
  },
};

const censored = {
  ...exact, measurement_id: 'm-2', molecule_id: 'cmpd-2', relation: '>', original_value: 10,
  original_unit: 'uM', source_record_id: 'row-2', quality_flags: ['censored_value', 'missing_uncertainty'],
  normalization: {
    status: 'normalized', normalized_value_molar: 1e-5, normalized_unit: 'M',
    transformed_endpoint: 'pIC50', transformed_relation: '<', transformed_value: 5,
  },
};

function payload(status = 'preview') {
  return {
    preview_id: 'a'.repeat(32), experimental_dataset_id: 'b'.repeat(32), upload_id: 'c'.repeat(32),
    status, schema_version: 'moloptima-experimental-measurement-v1',
    summary: {
      row_count: 2, valid_measurements: 2, invalid_measurements: 0, linked_molecules: 2,
      unmatched_molecules: 0, ambiguous_links: 0, censored_values: 1, unit_problems: 0,
      supported_endpoints: ['IC50'], unsupported_endpoint_types: [], endpoint_counts: { IC50: 2 },
    },
    record_counts: status === 'finalized' ? { measurements: 2, excluded: 0, source_rows: 2 } : null,
    measurements: [exact, censored], excluded_records: [],
  };
}

test('renders separated Experimental Data empty state and import controls', () => {
  const html = renderToStaticMarkup(React.createElement(module.default, { upload: null, initialWorkspaceTab: 1 }));
  const measurementsHtml = renderToStaticMarkup(React.createElement(module.default, { upload: null, initialWorkspaceTab: 1, initialTab: 1 }));
  assert.match(html, /Experimental Data/);
  assert.match(html, /remain separate from predicted ADMET/);
  assert.match(html, /Choose CSV \/ TSV/);
  assert.match(html, /Optional column mapping/);
  assert.match(measurementsHtml, /Finalize an import to inspect stored measurements/);
  assert.doesNotMatch(html, /activity cliff/i);
  assert.doesNotMatch(html, /ranking score/i);
});

test('preview shows validation counts, endpoint support, flags, and explicit censoring', () => {
  const html = renderToStaticMarkup(React.createElement(module.default, {
    upload: { upload_id: 'c'.repeat(32), valid_count: 2 }, initialPayload: payload(), initialWorkspaceTab: 1,
  }));
  assert.match(html, /Validation preview/);
  assert.match(html, /Supported: IC50/);
  assert.match(html, /Finalize versioned dataset/);
  assert.match(html, /Censored/);
  assert.match(html, /pIC50 &lt; 5\.0000/);
  assert.match(html, /missing uncertainty/);
  assert.match(html, /public-safe-demo \/ row-2/);
});

test('measurement view supports search, endpoint filter, provenance, export, and bounded pagination', () => {
  const html = renderToStaticMarkup(React.createElement(module.default, {
    upload: { upload_id: 'c'.repeat(32), valid_count: 2 }, initialPayload: payload('finalized'), initialWorkspaceTab: 1, initialTab: 1,
  }));
  assert.match(html, /Experimental measurements/);
  assert.match(html, /Search measurements/);
  assert.match(html, /Endpoint/);
  assert.match(html, /Export normalized CSV/);
  assert.match(html, /aria-label="Export normalized experimental measurements as CSV"/);
  assert.match(html, /MuiTablePagination-root/);
  assert.match(html, /No potency threshold or ranking is applied/);
});

const evidenceRow = {
  molecule_id: 'cmpd-evidence', original_molecule_id: 'Candidate Evidence', canonical_smiles: 'CCO', valid_molecule: true,
  pubchem_exact_match: true, pubchem_lookup_status: 'exact_match', pubchem_cid: '702', pubchem_preferred_name: 'Ethanol', pubchem_cache_status: 'cache_hit',
  chembl_exact_match: false, chembl_lookup_status: 'similarity_match', chembl_activity_count: 0, chembl_target_count: 0,
  chembl_similarity_match: true, chembl_similarity_status: 'similarity_match', chembl_similarity_score: 91.2,
  chembl_similarity_molecule_id: 'CHEMBL545', chembl_similarity_pref_name: 'Known analog', chembl_cache_status: 'fresh_lookup',
  patent_lookup_status: 'no_match', patent_record_count: 0, patent_public_evidence_match: false, patent_source: 'SureChEMBL',
  target_reference_status: 'references_found', target_reference_source: 'local_curated', target_reference_count: 1,
  nearest_active_reference_id: 'REF-1', nearest_active_compound_name: 'Reference compound', nearest_active_similarity: 0.73,
  nearest_active_activity_type: 'IC50', nearest_active_activity_value: '10', nearest_active_activity_units: 'nM',
};

function calculationResult(row = evidenceRow) {
  return {
    results: [row], target_name: 'Synthetic target', target_gene_symbol: 'GENE1', organism: 'Human',
    target_references: {
      lookup_status: 'references_found', cache_status: 'cache_hit', source: 'local_curated', reference_count: 1,
      references: [{ reference_id: 'REF-1', compound_name: 'Reference compound', target_name: 'Synthetic target', activity_type: 'IC50', activity_value: '10', activity_units: 'nM', reference_source: 'curated-test' }],
    },
  };
}

test('calculation evidence stays source-specific and keeps exact and analog ownership separate', () => {
  const html = renderToStaticMarkup(React.createElement(module.default, {
    upload: { upload_id: 'c'.repeat(32), valid_count: 1 },
    activeJob: { job_id: 'job-1', status: 'completed' },
    calculationResult: calculationResult(),
  }));
  for (const phrase of ['Calculation Evidence', 'Exact Compound Evidence', 'Analog Evidence', 'Target / Reference Evidence', 'Patent Evidence', 'Candidate Evidence']) assert.match(html, new RegExp(phrase));
  assert.match(html, /Any activity belongs to the ChEMBL analog, not to the selected MolOptima molecule/);
  assert.match(html, /Structural similarity only; not biological equivalence/);
  assert.match(html, /No matching records/);
  assert.doesNotMatch(html, /evidence score|confirmed active|patent-safe/i);
});

test('fresh start does not auto-open historical evidence and exposes an explicit neutral state', () => {
  const html = renderToStaticMarkup(React.createElement(module.default, { upload: null, activeJob: null, calculationResult: null }));
  assert.match(html, /No active calculation/);
  assert.match(html, /Open a previous calculation or run a new calculation/);
  assert.doesNotMatch(html, /Candidate Evidence/);
});

test('external ChEMBL is the only independent public lookup and keeps the selected molecule explicit', () => {
  const html = renderToStaticMarkup(React.createElement(module.default, {
    upload: { upload_id: 'c'.repeat(32), valid_count: 1 },
    activeJob: { job_id: 'job-1', status: 'completed' },
    calculationResult: calculationResult(), initialWorkspaceTab: 2,
  }));
  assert.match(html, /only independently executable public-evidence lookup/);
  assert.match(html, /Query molecule/);
  assert.match(html, /Find experimental analogs/);
  assert.doesNotMatch(html, /Run PubChem|Run patent|Run target reference/i);
});

test('source-state helpers preserve zero, no-hit, failure, unavailable, and not-run distinctions', () => {
  assert.equal(module.evidenceState('not_requested'), 'Not run');
  assert.equal(module.evidenceState('no_match'), 'No matching records');
  assert.equal(module.evidenceState('lookup_failed'), 'Failed');
  assert.equal(module.evidenceState('not_run_invalid_molecule'), 'Unavailable');
  assert.equal(module.evidenceState('running'), 'Running');
  assert.equal(module.evidenceState('completed_with_warnings'), 'Partial');
  assert.equal(module.evidenceState('exact_match', true), 'Available');
  assert.equal(module.formatOriginalMeasurement({ relation: '=', original_value: 0, original_unit: 'nM' }), '= 0 nM');
  assert.equal(module.formatOriginalMeasurement({ relation: '=', original_value: null, original_unit: '' }), '= —');
  assert.deepEqual(module.calculationEvidenceAvailability({
    pubchem_exact_match: 'False', pubchem_lookup_status: 'not_requested',
    chembl_exact_match: 'False', chembl_lookup_status: 'not_requested',
    chembl_similarity_match: 'False', chembl_similarity_status: 'not_requested',
    patent_public_evidence_match: 'False', patent_lookup_status: 'not_requested',
  }), { exact: 'Not run', analog: 'Not run', target: 'Not run', patent: 'Not run' });
});

test('formatters never present a censored boundary as exact transformed activity', () => {
  assert.equal(module.formatOriginalMeasurement(censored), '> 10 uM');
  assert.equal(module.formatNormalizedMeasurement(censored), '> 1.0000e-5 M');
  assert.equal(module.formatTransformedMeasurement(censored), 'pIC50 < 5.0000');
  assert.equal(module.formatTransformedMeasurement({ normalization: { status: 'not_applicable' } }), 'Not applicable');
});
