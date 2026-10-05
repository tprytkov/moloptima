import { ADMET_ENDPOINT_REGISTRY, formatAdmetProperty, normalizeAdmetMolecule } from './admetAnalysisData.js';

export const PROFILE_SCIENTIFIC_NOTES = Object.freeze([
  'Predicted ADMET values are model-derived predictions. Probability is not confidence, uncertainty, or applicability domain.',
  'Docking scores are computational, protocol-dependent results, not experimental binding affinity.',
  'Experimental measurements in the Experimental Analog Context section belong to external reference compounds. Structural similarity provides context but does not establish equivalent biological activity for the selected MolOptima compound.',
  'Matched-pair membership and structural transformations are structural context only. They do not establish a property effect, activity trend, reaction, or experimental support for the selected compound.',
]);

export function resolveStructuralContext(scaffoldPayload, neighborPayload, moleculeId) {
  const groups = scaffoldPayload?.scaffolds || [];
  const scaffold = groups.find((group) => (group.members || []).some((member) => member.molecule_id === moleculeId)) || null;
  return {
    status: scaffoldPayload || neighborPayload ? 'available' : 'not_available',
    scaffold: scaffold ? {
      scaffoldId: scaffold.scaffold_id,
      scaffoldSmiles: scaffold.scaffold_smiles,
      memberCount: scaffold.member_count ?? scaffold.members?.length ?? 0,
      acyclic: Boolean(scaffold.acyclic),
    } : null,
    neighbors: neighborPayload?.neighbors || [],
    fingerprint: neighborPayload?.metadata || scaffoldPayload?.metadata || null,
  };
}

export function summarizeExperimentalContext(context = {}) {
  const search = context.searchResult;
  const records = context.recordsPayload?.records || [];
  const all = search ? [...(search.exact_matches || []), ...(search.analogs || [])] : [];
  const mmpResults = context.mmpPayload?.results || [];
  const selectedMmp = mmpResults.find((result) => result.reference?.id === context.selectedAnalog?.source_compound_id) || null;
  return {
    status: context.searchStatus || 'not_run',
    exactMatch: search?.exact_match ?? null,
    analogCount: search?.analogs?.length || 0,
    totalKnownCount: all.length,
    recordCount: records.length,
    sourceRecordCount: context.recordsPayload?.source_total_count ?? records.length,
    targetCount: new Set(records.map((record) => record.target?.identifier || record.target?.name).filter(Boolean)).size,
    censoredCount: records.filter((record) => record.quality_flags?.includes('censored_value')).length,
    selectedAnalog: context.selectedAnalog || null,
    selectedMmp,
    matchedPairCount: context.mmpPayload?.matched_pair_count ?? null,
    records,
  };
}

function markdownValue(value) {
  if (value === null || value === undefined || value === '') return 'Not available';
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function markdownTable(rows) {
  return ['| Field | Value |', '| --- | --- |', ...rows.map(([key, value]) => `| ${markdownValue(key)} | ${markdownValue(value)} |`)].join('\n');
}

export function buildCompoundProfileMarkdown(compound, structuralContext = {}, experimentalContext = {}) {
  const admet = normalizeAdmetMolecule(compound || {});
  const experimental = summarizeExperimentalContext(experimentalContext);
  const docking = compound?.docking_result || {};
  const lines = [
    `# MolOptima Compound Profile: ${markdownValue(compound?.molecule_id)}`,
    '', '## Selected compound', markdownTable([
      ['Molecule ID', compound?.molecule_id], ['Source file', compound?.source_filename],
      ['Source record', compound?.source_record], ['Canonical SMILES', compound?.canonical_smiles || compound?.input_smiles],
    ]),
    '', '## Calculated properties', markdownTable([
      ['Molecular weight', compound?.mw], ['TPSA', compound?.tpsa], ['H-bond acceptors', compound?.hba],
      ['H-bond donors', compound?.hbd], ['Rotatable bonds', compound?.rotatable_bonds], ['QED', compound?.qed],
      ['SA score', compound?.sa_score], ['Structural alerts', compound?.medchem_alert_summary],
    ]),
    '', '## Predicted ADMET',
    markdownTable(ADMET_ENDPOINT_REGISTRY.map((metadata) => {
      const property = admet.properties[metadata.key];
      return [metadata.label, `${formatAdmetProperty(property, metadata)} · ${property?.unit || metadata.unit} · ${property?.modelName || metadata.modelName} · ${property?.status?.label || 'Not available'}`];
    })),
    '', '## Docking', markdownTable([
      ['Status', docking.status || compound?.docking_status], ['Receptor', docking.receptor_id],
      ['Best Vina affinity (kcal/mol)', docking.best_vina_affinity_kcal_mol ?? compound?.docking_score],
      ['Best pose/mode', docking.best_mode], ['Pose artifact', docking.pose_file || docking.pose_path],
    ]),
    '', '## Prioritization', markdownTable([
      ['Priority score', compound?.v2_score ?? compound?.scientific_ranking_score ?? compound?.priority_score],
      ['Rank', compound?.v2_rank ?? compound?.scientific_rank ?? compound?.prioritization?.ranking_position],
      ['Method', compound?.prioritization_v2 ? 'Prioritization v2' : compound?.prioritization ? 'Scientific prioritization' : 'Not available'],
      ['Explanation status', compound?.prioritization_v2 || compound?.prioritization ? 'Available in persisted result' : 'Not available'],
    ]),
    '', '## Structural context', markdownTable([
      ['Murcko scaffold ID', structuralContext.scaffold?.scaffoldId],
      ['Murcko scaffold SMILES', structuralContext.scaffold?.scaffoldSmiles],
      ['Scaffold group size', structuralContext.scaffold?.memberCount],
      ['Local ECFP4 neighbors shown', structuralContext.neighbors?.length || 0],
    ]),
    '', '## Experimental analog context', markdownTable([
      ['Search status', experimental.status], ['Exact ChEMBL structure match', experimental.exactMatch === null ? 'Search not run' : experimental.exactMatch ? 'Yes' : 'No'],
      ['Structural neighbors returned', experimental.analogCount], ['Selected known analog', experimental.selectedAnalog?.source_compound_id],
      ['Experimental records loaded for known analog', experimental.recordCount], ['Targets represented', experimental.targetCount],
    ]),
    '', '## Structural transformation', markdownTable([
      ['Matched molecular pair', experimental.selectedMmp ? (experimental.selectedMmp.matched_pair ? 'Yes' : 'No') : 'Not analyzed'],
      ['MMP policy', experimental.selectedMmp?.policy_version],
      ['No-match reason', experimental.selectedMmp?.matched_pair ? 'Not applicable' : experimental.selectedMmp?.reason?.replaceAll('_', ' ')],
      ['Shared core', experimental.selectedMmp?.shared_core?.canonical_smiles],
      ['Selected compound substituent', experimental.selectedMmp?.query_fragment?.canonical_smiles],
      ['Known analog substituent', experimental.selectedMmp?.reference_fragment?.canonical_smiles],
      ['Selected to known-reference direction', experimental.selectedMmp?.transformation?.query_to_reference],
      ['Reverse direction', experimental.selectedMmp?.transformation?.reference_to_query],
      ['Independent Tanimoto', experimental.selectedMmp?.relationship?.tanimoto],
      ['Independent Murcko scaffold relationship', experimental.selectedMmp?.relationship?.murcko_scaffold_relationship],
      ['RDKit version', experimental.selectedMmp?.provenance?.rdkit_version],
      ['Scientific scope', 'Structural substituent relationship only; no reaction or property-effect inference'],
    ]),
  ];
  if (experimental.selectedAnalog) {
    lines.push('', `## Experimental records for known reference compound ${markdownValue(experimental.selectedAnalog.source_compound_id)}`,
      '| Target | Assay | Endpoint | Relation | Original value | Unit | Normalized pEndpoint | Provenance |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      ...experimental.records.map((record) => `| ${markdownValue(record.target?.name || record.target?.identifier)} | ${markdownValue(record.assay_id)} | ${markdownValue(record.endpoint_name)} | ${markdownValue(record.relation)} | ${markdownValue(record.original_value)} | ${markdownValue(record.original_unit)} | ${markdownValue(record.normalization?.status === 'normalized' ? `${record.normalization.transformed_relation} ${record.normalization.transformed_value} ${record.normalization.transformed_endpoint}` : 'Not converted')} | ${markdownValue(`${record.source} ${record.source_record_id}`)} |`));
  }
  lines.push('', '## Scientific interpretation notes', ...PROFILE_SCIENTIFIC_NOTES.map((note) => `- ${note}`),
    '', '## Provenance', markdownTable([
      ['MolOptima molecule ID', compound?.molecule_id], ['Upload-scoped source record', compound?.source_record],
      ['Experimental source', experimental.selectedAnalog ? 'ChEMBL external known compound' : 'Not retrieved'],
      ['Evidence ownership', 'Selected-compound computational evidence and known-analog experimental evidence remain separate'],
    ]), '');
  return lines.join('\n');
}

export function safeProfileFilename(moleculeId) {
  const safe = String(moleculeId || 'compound').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'compound';
  return `${safe}-moloptima-compound-profile.md`;
}

