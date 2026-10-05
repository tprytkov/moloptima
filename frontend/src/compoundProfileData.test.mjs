import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { buildCompoundProfileMarkdown, resolveStructuralContext, safeProfileFilename, summarizeExperimentalContext } from './compoundProfileData.js';

const compound = {
  molecule_id: 'generated-1', canonical_smiles: 'Cc1ccccc1', source_filename: 'public-demo.csv', source_record: 'row 2',
  mw: 92.14, tpsa: 0, hba: 0, hbd: 0, rotatable_bonds: 0, qed: 0.46, sa_score: 1.1,
  admet_predictions: { hia_hou: { calibrated_probability: 0.8, binary_prediction: 1 } },
  docking_result: { status: 'success', receptor_id: 'receptor-public', best_vina_affinity_kcal_mol: -7.1, best_mode: 1 },
  prioritization_v2: { score: 0.6 }, priority_score: 0.6,
};

function analog(index) {
  return { source_compound_id: `CHEMBL${index}`, preferred_name: `Reference ${index}`, canonical_smiles: 'c1ccccc1', moloptima_tanimoto: 0.8 - index / 1000, same_murcko_scaffold: index % 2 ? 'Same scaffold' : 'Different scaffold', experimental_record_count: index };
}

function record(index) {
  return { measurement_id: `m${index}`, source: 'ChEMBL', source_record_id: `a${index}`, assay_id: `A${index}`, endpoint_name: index % 2 ? 'IC50' : 'Ki', relation: index % 7 ? '=' : '>', original_value: index + 1, original_unit: 'nM', target: { identifier: `T${index % 12}`, name: `Target ${index % 12}` }, quality_flags: index % 7 ? [] : ['censored_value'], normalization: { status: 'normalized', transformed_relation: index % 7 ? '=' : '<', transformed_value: 8, transformed_endpoint: 'pIC50' } };
}

function filterRecords(records, endpoint, query) {
  const needle = query.toLowerCase();
  return records.filter((item) => item.endpoint_name === endpoint && [item.target?.name, item.target?.identifier].some((value) => String(value || '').toLowerCase().includes(needle)));
}

test('structural context links by stable molecule ID and preserves query-relative neighbors', () => {
  const context = resolveStructuralContext({ scaffolds: [{ scaffold_id: 'scf-1', scaffold_smiles: 'c1ccccc1', member_count: 2, members: [{ molecule_id: 'generated-1' }] }] }, { neighbors: [{ molecule_id: 'local-2', similarity: 0.71 }] }, 'generated-1');
  assert.equal(context.scaffold.scaffoldId, 'scf-1');
  assert.equal(context.scaffold.memberCount, 2);
  assert.equal(context.neighbors[0].similarity, 0.71);
});

test('experimental summary is descriptive and keeps censored records and ownership', () => {
  const summary = summarizeExperimentalContext({ searchStatus: 'completed', searchResult: { exact_match: false, exact_matches: [], analogs: [analog(1)] }, selectedAnalog: analog(1), recordsPayload: { source_total_count: 2, records: [record(0), record(1)] } });
  assert.equal(summary.exactMatch, false);
  assert.equal(summary.analogCount, 1);
  assert.equal(summary.censoredCount, 1);
  assert.equal(summary.selectedAnalog.source_compound_id, 'CHEMBL1');
});

test('profile Markdown separates calculated, predicted, docking, prioritization, and known-analog experiments', () => {
  const context = { searchStatus: 'completed', searchResult: { exact_match: true, exact_matches: [analog(1)], analogs: [] }, selectedAnalog: analog(1), recordsPayload: { source_total_count: 1, records: [record(0)] }, mmpPayload: { matched_pair_count: 1, results: [{ policy_version: 'moloptima-mmp-policy-v1', matched_pair: true, reference: { id: 'CHEMBL1' }, shared_core: { canonical_smiles: 'c1ccc([*:1])cc1' }, query_fragment: { canonical_smiles: 'C[*:1]' }, reference_fragment: { canonical_smiles: 'Cl[*:1]' }, transformation: { query_to_reference: 'C[*:1] >> Cl[*:1]', reference_to_query: 'Cl[*:1] >> C[*:1]' }, relationship: { tanimoto: 0.375, murcko_scaffold_relationship: 'Yes' }, provenance: { rdkit_version: '2026.03.3' } }] } };
  const markdown = buildCompoundProfileMarkdown(compound, { scaffold: { scaffoldId: 'scf-1', scaffoldSmiles: 'c1ccccc1', memberCount: 2 }, neighbors: [] }, context);
  for (const heading of ['Selected compound', 'Calculated properties', 'Predicted ADMET', 'Docking', 'Prioritization', 'Structural context', 'Experimental analog context', 'Structural transformation', 'Experimental records for known reference compound CHEMBL1', 'Scientific interpretation notes', 'Provenance']) assert.match(markdown, new RegExp(`## ${heading}`));
  assert.match(markdown, /C\[\*:1\] &gt;&gt; Cl\[\*:1\]|C\[\*:1\] >> Cl\[\*:1\]/);
  assert.match(markdown, /moloptima-mmp-policy-v1/);
  assert.match(markdown, /belong to external reference compounds/);
  assert.match(markdown, /not establish equivalent biological activity/);
  assert.match(markdown, /Predicted ADMET values are model-derived predictions/);
  assert.match(markdown, /protocol-dependent results, not experimental binding affinity/);
  assert.doesNotMatch(markdown, /average potency|weighted potency|activity cliff|SALI|confidence score|novelty score/i);
  assert.equal(safeProfileFilename('generated 1/unsafe'), 'generated-1-unsafe-moloptima-compound-profile.md');
});

test('profile Markdown handles missing ADMET, docking, prioritization, and an analog with zero records', () => {
  const emptyAnalog = analog(2);
  const markdown = buildCompoundProfileMarkdown({ molecule_id: 'missing', canonical_smiles: 'CC' }, {}, { searchStatus: 'completed', searchResult: { exact_match: false, exact_matches: [], analogs: [emptyAnalog] }, selectedAnalog: emptyAnalog, recordsPayload: { records: [], source_total_count: 0 } });
  assert.match(markdown, /Search status \| completed/);
  assert.match(markdown, /Experimental records loaded for known analog \| 0/);
  assert.match(markdown, /Best Vina affinity \(kcal\/mol\) \| Not available/);
});

test('profile local preparation benchmarks remain bounded without network access', (t) => {
  const timings = {};
  for (const count of [0, 10, 25, 50]) {
    const context = { searchStatus: count ? 'completed' : 'not_run', searchResult: count ? { exact_match: false, exact_matches: [], analogs: Array.from({ length: count }, (_, index) => analog(index)) } : null };
    const start = performance.now();
    for (let iteration = 0; iteration < 100; iteration += 1) summarizeExperimentalContext(context);
    timings[`${count}_analogs_ms`] = (performance.now() - start) / 100;
  }
  for (const count of [100, 500]) {
    const records = Array.from({ length: count }, (_, index) => record(index));
    const start = performance.now();
    for (let iteration = 0; iteration < 20; iteration += 1) {
      summarizeExperimentalContext({ searchStatus: 'completed', recordsPayload: { records } });
      filterRecords(records, 'IC50', 'target');
      records[Math.min(iteration, records.length - 1)];
    }
    timings[`${count}_records_prepare_filter_select_ms`] = (performance.now() - start) / 20;
  }
  t.diagnostic(`Batch 12 local benchmark ${JSON.stringify(timings)}`);
  Object.values(timings).forEach((milliseconds) => assert.ok(milliseconds < 100));
});

