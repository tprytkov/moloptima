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
  const html = renderToStaticMarkup(React.createElement(module.default, { upload: null }));
  const measurementsHtml = renderToStaticMarkup(React.createElement(module.default, { upload: null, initialTab: 1 }));
  assert.match(html, /Experimental Data/);
  assert.match(html, /stored separately from predicted ADMET results/);
  assert.match(html, /Choose CSV \/ TSV/);
  assert.match(html, /Optional column mapping/);
  assert.match(measurementsHtml, /Finalize an import to inspect stored measurements/);
  assert.doesNotMatch(html, /activity cliff/i);
  assert.doesNotMatch(html, /ranking score/i);
});

test('preview shows validation counts, endpoint support, flags, and explicit censoring', () => {
  const html = renderToStaticMarkup(React.createElement(module.default, {
    upload: { upload_id: 'c'.repeat(32), valid_count: 2 }, initialPayload: payload(),
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
    upload: { upload_id: 'c'.repeat(32), valid_count: 2 }, initialPayload: payload('finalized'), initialTab: 1,
  }));
  assert.match(html, /Experimental measurements/);
  assert.match(html, /Search measurements/);
  assert.match(html, /Endpoint/);
  assert.match(html, /Export normalized CSV/);
  assert.match(html, /aria-label="Export normalized experimental measurements as CSV"/);
  assert.match(html, /MuiTablePagination-root/);
  assert.match(html, /No potency threshold or ranking is applied/);
});

test('formatters never present a censored boundary as exact transformed activity', () => {
  assert.equal(module.formatOriginalMeasurement(censored), '> 10 uM');
  assert.equal(module.formatNormalizedMeasurement(censored), '> 1.0000e-5 M');
  assert.equal(module.formatTransformedMeasurement(censored), 'pIC50 < 5.0000');
  assert.equal(module.formatTransformedMeasurement({ normalization: { status: 'not_applicable' } }), 'Not applicable');
});
