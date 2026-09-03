import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let module;

const metadata = {
  endpoints: [
    {
      endpoint_id: 'gmc_mpnn_bbb', model_family: 'gmc_mpnn_bbb',
      units: 'raw ensemble probability', semantic_direction: 'context_dependent',
      uncertainty_available: true,
      description: 'Five-seed raw BBB ensemble; threshold provisional and calibration not frozen.',
    },
    {
      endpoint_id: 'QED', model_family: 'rdkit_descriptor', units: 'unitless [0,1]',
      semantic_direction: 'higher_favorable', uncertainty_available: false,
      description: 'Quantitative estimate of drug-likeness.',
    },
  ],
  profile_options: {
    admet_domains: ['absorption', 'distribution_cns', 'metabolism_transport', 'developability'],
    domains: ['absorption', 'distribution_cns', 'metabolism_transport', 'developability', 'molecular_quality', 'safety', 'docking'],
    endpoint_roles: ['objective', 'penalty', 'gate', 'display_only'],
    missing_policies: ['renormalize_with_warning', 'penalty', 'unrankable', 'warning_only'],
    uncertainty_policies: ['warning_only', 'penalty', 'unrankable_above_threshold'],
    transform_schemas: {
      increasing_sigmoid: [{ name: 'midpoint', type: 'number' }, { name: 'slope', type: 'number' }],
      decreasing_sigmoid: [{ name: 'midpoint', type: 'number' }, { name: 'slope', type: 'number' }],
      target_range: [
        { name: 'lower', type: 'number' }, { name: 'upper', type: 'number' },
        { name: 'lower_width', type: 'number' }, { name: 'upper_width', type: 'number' },
      ],
      minimum_plateau: [{ name: 'minimum', type: 'number' }, { name: 'width', type: 'number' }],
      threshold: [{ name: 'threshold', type: 'number' }, { name: 'operator', type: 'enum', options: ['gte', 'lte'] }],
      categorical_map: [{ name: 'mapping', type: 'json_mapping' }],
      identity_01: [],
      reverse_identity_01: [],
    },
  },
};

before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  module = await vite.ssrLoadModule('/src/PrioritizationSettings.jsx');
});

after(async () => vite?.close());

function render(value, suppliedMetadata = metadata) {
  return renderToStaticMarkup(React.createElement(module.default, {
    apiBaseUrl: 'http://localhost:8000', value, onChange: () => {}, metadata: suppliedMetadata,
  }));
}

test('legacy v1 is the default and does not require v2 settings', () => {
  const html = render(undefined);
  assert.match(html, /Prioritization Settings/);
  assert.match(html, /Legacy v1 · compatibility scoring/);
  assert.match(html, /Prioritization v2 uses an explicit, validated multi-parameter profile/);
  assert.match(html, /Legacy v1 remains the application default/);
  assert.doesNotMatch(html, /Top-level component weights/);
});

test('v2 renders target mode, three explicit top-level weights, and separate ADMET domains', () => {
  const profile = module.emptyDraftProfile();
  const html = render({ method: 'v2', profile, validation: null });
  assert.match(html, /Target mode/);
  assert.match(html, /Top-level component weights/);
  assert.match(html, /data-testid="component-weight-docking"/);
  assert.match(html, /data-testid="component-weight-admet"/);
  assert.match(html, /data-testid="component-weight-molecular_quality"/);
  assert.match(html, /Internal ADMET domain composition/);
  assert.match(html, /ADMET total weight → internal ADMET domains/);
  assert.match(html, /data-testid="admet-domain-weight-absorption"/);
  assert.match(html, /data-testid="admet-domain-weight-distribution_cns"/);
  assert.match(html, /Draft — scientific parameters not yet complete/);
  assert.match(html, /Not scoreable/);
});

test('advanced endpoint editor uses metadata and renders transform-specific fields', () => {
  const profile = module.emptyDraftProfile();
  profile.endpoint_rules.QED = {
    enabled: true, role: 'objective', domain: 'molecular_quality', weight: 1,
    required: true, missing_policy: 'unrankable', uncertainty_policy: 'warning_only',
    transform: {
      type: 'target_range', params: { lower: 0.3, upper: 0.8, lower_width: 0.1, upper_width: 0.1 },
    },
    notes: 'Synthetic test only.',
  };
  const html = render({ method: 'v2', profile, validation: null });
  assert.match(html, /Advanced endpoint rules/);
  assert.match(html, /Quantitative estimate of drug-likeness/);
  assert.match(html, /Desirability transform/);
  assert.match(html, /Lower Width/);
  assert.match(html, /Upper Width/);
  assert.match(html, /Missing-data policy/);
  assert.match(html, /Uncertainty policy/);
});

test('BBB editor states raw provisional and not-frozen status without calibrated claim', () => {
  const profile = module.emptyDraftProfile();
  profile.target_mode = 'neutral';
  profile.endpoint_rules.gmc_mpnn_bbb = {
    enabled: true, role: 'display_only', domain: 'distribution_cns', weight: 0,
    required: false, missing_policy: 'warning_only', uncertainty_policy: 'warning_only',
    transform: { type: 'identity_01', params: {} }, notes: null,
  };
  const html = render({ method: 'v2', profile, validation: null });
  assert.match(html, /raw ensemble output/);
  assert.match(html, /threshold is provisional/);
  assert.match(html, /calibration is not frozen/);
  assert.doesNotMatch(html, /calibrated probability/i);
});

test('docking policy wording and profile JSON provenance controls are explicit', () => {
  const profile = module.emptyDraftProfile();
  const html = render({
    method: 'v2', profile,
    validation: { structurally_valid: true, scoreable: false, profile_sha256: 'a'.repeat(64), errors: ['Weights incomplete.'], warnings: [] },
  });
  assert.match(html, /Within library/);
  assert.match(html, /normalized relative to successfully docked molecules/);
  assert.match(html, /Reference delta is explanatory\/contextual only/);
  assert.match(html, /Copy profile JSON/);
  assert.match(html, /Import profile JSON/);
  assert.match(html, /Profile SHA256: a{64}/);
  assert.match(html, /Weights incomplete/);
});

test('profile JSON helpers and independent normalization are deterministic', () => {
  assert.deepEqual(module.normalizedWeights({ docking: 4, admet: 4, molecular_quality: 2 }), {
    docking: 0.4, admet: 0.4, molecular_quality: 0.2,
  });
  assert.equal(module.parseProfileJson('{"status":"draft"}').status, 'draft');
  assert.throws(() => module.parseProfileJson('[]'), /one object/);
});

test('validation helper calls the authoritative backend route', async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return new Response(JSON.stringify({ structurally_valid: true, scoreable: false }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    await module.requestProfileValidation('http://localhost:8000', module.emptyDraftProfile());
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(captured.url, 'http://localhost:8000/api/prioritization/profiles/validate');
  assert.equal(captured.options.method, 'POST');
  assert.match(captured.options.body, /component_weights/);
});

test('historical CNS draft remains inspectable but is excluded from primary choices', () => {
  const profile = module.emptyDraftProfile();
  Object.assign(profile, {
    profile_id: 'moloptima_cns_literature_v2',
    profile_version: '0.1.0',
    name: 'MolOptima CNS Literature Profile',
    target_mode: 'CNS',
    component_weights: { docking: 1, admet: 1, molecular_quality: 1 },
    domain_weights: { absorption: 1, distribution_cns: 1, developability: 1 },
    endpoint_rules: {
      hia_hou: {
        enabled: true, role: 'objective', domain: 'absorption', weight: 1,
        required: false, missing_policy: 'renormalize_with_warning',
        uncertainty_policy: 'warning_only', transform: { type: 'identity_01', params: {} },
      },
      cyp1a2_veith: {
        enabled: true, role: 'penalty', domain: 'metabolism_transport', weight: 1,
        required: false, missing_policy: 'warning_only', uncertainty_policy: 'warning_only',
        transform: { type: 'reverse_identity_01', params: {} },
      },
      PPBR_AZ: {
        enabled: false, role: 'display_only', domain: 'distribution_cns', weight: 0,
        required: false, missing_policy: 'warning_only', uncertainty_policy: 'warning_only',
        transform: { type: 'identity_01', params: {} },
      },
    },
  });
  const sha = 'b'.repeat(64);
  const builtInMetadata = {
    ...metadata,
    builtin_profiles: [{
      profile_id: profile.profile_id,
      profile_version: profile.profile_version,
      name: profile.name,
      status: 'draft',
      target_mode: 'CNS',
      profile_sha256: sha,
      scoreable: true,
      historical: true,
      warnings: [],
      notice: 'Literature-informed draft profile. Scientific parameters have not yet been frozen.',
      profile,
    }],
  };
  const html = render({
    method: 'v2', profile,
    validation: { structurally_valid: true, scoreable: true, profile_sha256: sha, warnings: [], errors: [] },
  }, builtInMetadata);
  assert.equal(module.builtinProfileKey(builtInMetadata.builtin_profiles[0]), 'moloptima_cns_literature_v2@0.1.0');
  assert.deepEqual(module.endpointRoleSummary(profile), { objective: 1, penalty: 1, gate: 0, display_only: 1 });
  assert.match(html, /MolOptima CNS Literature Profile/);
  assert.doesNotMatch(html, /CNS Drug Discovery — Draft/);
  assert.match(html, /Version 0.1.0 · Status Draft · Target mode CNS/);
  assert.match(html, new RegExp(`SHA256: ${sha}`));
  assert.match(html, /1 objectives · 1 penalties · 1 display-only · 0 gates/);
  assert.match(html, /Literature-informed draft profile\. Scientific parameters have not yet been frozen/);
  assert.match(html, /historical draft is preserved for reproducibility/);
  assert.match(html, /Normalized: 0\.333/g);
});

test('current frozen CNS built-in is visibly read-only and directs changes to custom profiles', () => {
  const profile = module.emptyDraftProfile();
  Object.assign(profile, {
    profile_id: 'moloptima_cns_literature_v2',
    profile_version: '1.0.0',
    status: 'frozen',
    name: 'MolOptima CNS Literature Profile',
    target_mode: 'CNS',
    component_weights: { docking: 1, admet: 1, molecular_quality: 1 },
    domain_weights: { absorption: 1, distribution_cns: 1, developability: 1 },
    endpoint_rules: {
      hia_hou: {
        enabled: true, role: 'objective', domain: 'absorption', weight: 1,
        required: false, missing_policy: 'renormalize_with_warning',
        uncertainty_policy: 'warning_only', transform: { type: 'identity_01', params: {} },
      },
    },
  });
  const sha = 'c'.repeat(64);
  const frozenRecord = {
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    name: profile.name,
    status: 'frozen',
    target_mode: 'CNS',
    profile_sha256: sha,
    scoreable: true,
    current: true,
    recommended: true,
    historical: false,
    read_only: true,
    warnings: [],
    notice: 'Frozen literature-informed CNS profile. Scientific parameters are read-only; create a custom profile to change them.',
    profile,
  };
  const html = render({
    method: 'v2', profile,
    validation: { structurally_valid: true, scoreable: true, profile_sha256: sha, warnings: [], errors: [] },
  }, { ...metadata, builtin_profiles: [frozenRecord] });

  assert.match(html, /Frozen · Version 1\.0\.0 · Current/);
  assert.match(html, /Version 1\.0\.0 · Status Frozen · Target mode CNS/);
  assert.match(html, /data-testid="frozen-profile-read-only"/);
  assert.match(html, /cannot be edited in place/);
  assert.match(html, /Select Custom or import a custom profile/);
  assert.match(html, /without post-evaluation retuning/);
  assert.match(html, /not biological or clinical validation/);
  assert.match(html, /data-testid="target-mode"[^>]*disabled|disabled=""[^>]*data-testid="target-mode"/);
  assert.match(html, /data-testid="component-weight-docking"[^>]*disabled|disabled=""[^>]*data-testid="component-weight-docking"/);
  assert.match(html, /Import JSON as custom profile/);
});

test('catalog shows three current frozen profiles while historical drafts stay out of primary choices', () => {
  const profileFor = (profileId, version, status, targetMode, name) => ({
    ...module.emptyDraftProfile(),
    profile_id: profileId,
    profile_version: version,
    status,
    target_mode: targetMode,
    name,
    component_weights: { docking: 1, admet: 1, molecular_quality: 1 },
    domain_weights: { absorption: 1, developability: 1 },
    endpoint_rules: {
      hia_hou: {
        enabled: true, role: 'objective', domain: 'absorption', weight: 1,
        required: false, missing_policy: 'renormalize_with_warning',
        uncertainty_policy: 'warning_only', transform: { type: 'identity_01', params: {} },
      },
    },
  });
  const cns = profileFor(
    'moloptima_cns_literature_v2', '1.0.0', 'frozen', 'CNS',
    'MolOptima CNS Literature Profile',
  );
  const general = profileFor(
    'moloptima_general_systemic_oral_v2', '1.0.0', 'frozen', 'neutral',
    'MolOptima General Systemic Oral Profile',
  );
  const peripheral = profileFor(
    'moloptima_peripheral_systemic_oral_v2', '1.0.0', 'frozen', 'peripheral',
    'MolOptima Peripheral Systemic Oral Profile',
  );
  const historical = { ...cns, profile_version: '0.1.0', status: 'draft' };
  const historicalGeneral = { ...general, profile_version: '0.1.0', status: 'draft' };
  const historicalPeripheral = { ...peripheral, profile_version: '0.1.0', status: 'draft' };
  const routeWarning = 'These profiles assume oral systemic drug discovery. For IV, topical, inhaled, gut-restricted, or other target-product profiles, create a custom profile.';
  const records = [
    {
      profile_id: cns.profile_id, profile_version: cns.profile_version, status: cns.status,
      name: cns.name, choice_label: 'CNS Drug Discovery', description: 'Use when CNS penetration is desirable.',
      current: true, historical: false, profile_sha256: '1'.repeat(64), scoreable: true,
      notice: 'Frozen profile.', profile: cns,
    },
    {
      profile_id: general.profile_id, profile_version: general.profile_version, status: general.status,
      name: general.name, choice_label: 'General Systemic Oral',
      description: 'Use for oral systemic projects where CNS exposure is not a design objective.',
      current: true, historical: false, read_only: true, route_warning: routeWarning,
      profile_sha256: '2'.repeat(64), scoreable: true, notice: 'Frozen profile.', profile: general,
    },
    {
      profile_id: peripheral.profile_id, profile_version: peripheral.profile_version, status: peripheral.status,
      name: peripheral.name, choice_label: 'Peripheral Systemic Oral',
      description: 'Use when oral systemic exposure is desired and CNS penetration should be limited.',
      current: true, historical: false, read_only: true, route_warning: routeWarning,
      profile_sha256: '3'.repeat(64), scoreable: true, notice: 'Frozen profile.', profile: peripheral,
    },
    {
      profile_id: historical.profile_id, profile_version: historical.profile_version, status: historical.status,
      name: historical.name, choice_label: 'CNS Drug Discovery', description: 'Historical evaluated draft.',
      current: false, historical: true, profile_sha256: '4'.repeat(64), scoreable: true,
      notice: 'Historical draft.', profile: historical,
    },
    {
      profile_id: historicalGeneral.profile_id, profile_version: historicalGeneral.profile_version,
      status: historicalGeneral.status, name: historicalGeneral.name,
      choice_label: 'General Systemic Oral', description: 'Historical tested draft.',
      current: false, historical: true, profile_sha256: '5'.repeat(64), scoreable: true,
      notice: 'Historical draft.', profile: historicalGeneral,
    },
    {
      profile_id: historicalPeripheral.profile_id, profile_version: historicalPeripheral.profile_version,
      status: historicalPeripheral.status, name: historicalPeripheral.name,
      choice_label: 'Peripheral Systemic Oral', description: 'Historical tested draft.',
      current: false, historical: true, profile_sha256: '6'.repeat(64), scoreable: true,
      notice: 'Historical draft.', profile: historicalPeripheral,
    },
  ];
  const html = render({
    method: 'v2', profile: general,
    validation: { structurally_valid: true, scoreable: true, profile_sha256: '2'.repeat(64), warnings: [], errors: [] },
  }, { ...metadata, builtin_profiles: records });

  assert.equal(
    module.CUSTOM_PROFILE_CHOICE_LABEL,
    'Custom · Create project-specific endpoint roles, transforms, and weights',
  );
  assert.deepEqual(records.map(module.builtinProfileChoiceLabel), [
    'CNS Drug Discovery — Frozen · Version 1.0.0 · Current',
    'General Systemic Oral — Frozen · Version 1.0.0 · Current',
    'Peripheral Systemic Oral — Frozen · Version 1.0.0 · Current',
    'CNS Drug Discovery — Draft · Version 0.1.0 · Historical',
    'General Systemic Oral — Draft · Version 0.1.0 · Historical',
    'Peripheral Systemic Oral — Draft · Version 0.1.0 · Historical',
  ]);
  assert.deepEqual(module.primaryBuiltinProfiles(records), records.slice(0, 3));
  assert.match(html, /Use for oral systemic projects where CNS exposure is not a design objective/);
  assert.match(html, /data-testid="oral-systemic-route-warning"/);
  assert.match(html, /For IV, topical, inhaled, gut-restricted, or other target-product profiles/);
  assert.match(html, /data-testid="frozen-profile-read-only"/);
  assert.match(html, /scientifically identical draft configuration/);
  assert.match(html, /independently of α7 rankings/);
});
