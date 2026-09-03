import React, { useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

const COMPONENTS = [
  ['docking', 'Docking'],
  ['admet', 'ADMET'],
  ['molecular_quality', 'Molecular quality'],
];
const TARGET_MODES = ['CNS', 'peripheral', 'neutral', 'custom'];
export const CUSTOM_PROFILE_CHOICE_LABEL = 'Custom · Create project-specific endpoint roles, transforms, and weights';

export function emptyDraftProfile() {
  return {
    schema_version: 'moloptima-prioritization-profile-v2',
    profile_id: 'new-draft-profile',
    profile_version: '0.0.0-draft',
    status: 'draft',
    name: 'Draft — scientific parameters not yet complete',
    target_mode: 'custom',
    aggregation: 'weighted_arithmetic',
    component_weights: {},
    domain_weights: {},
    endpoint_rules: {},
    missing_data_policy: 'renormalize_with_warning',
    uncertainty_policy: 'warning_only',
    liability_policy: {
      penalty_aggregation: 'domain_weighted_arithmetic',
      gate_failure_behavior: 'exclude',
    },
    docking_policy: {
      normalization: 'within_library',
      docking_required: false,
      campaign_id: null,
      reference_molecule_id: null,
      reference_best_vina_affinity_kcal_mol: null,
      reference_delta_role: 'explanatory_only',
    },
  };
}

export function normalizedWeights(weights = {}) {
  const usable = Object.fromEntries(COMPONENTS.map(([key]) => {
    const value = Number(weights[key]);
    return [key, Number.isFinite(value) && value >= 0 ? value : 0];
  }));
  const total = Object.values(usable).reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(Object.entries(usable).map(([key, value]) => [
    key, total > 0 ? value / total : null,
  ]));
}

export function parseProfileJson(value) {
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Profile JSON must contain one object.');
  }
  return parsed;
}

export async function requestProfileValidation(apiBaseUrl, profile) {
  const response = await fetch(`${apiBaseUrl}/api/prioritization/profiles/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile }),
  });
  if (!response.ok) {
    throw new Error(`Profile validation failed (${response.status}).`);
  }
  return response.json();
}

export function builtinProfileKey(record) {
  return `${record.profile_id}@${record.profile_version}`;
}

export function builtinProfileChoiceLabel(record) {
  const lifecycle = record.current ? ' · Current' : record.historical ? ' · Historical' : '';
  return `${record.choice_label ?? record.name} — ${humanize(record.status)} · Version ${record.profile_version}${lifecycle}`;
}

export function primaryBuiltinProfiles(records = []) {
  return records.filter((record) => !record.historical);
}

export function endpointRoleSummary(profile) {
  const summary = { objective: 0, penalty: 0, gate: 0, display_only: 0 };
  Object.values(profile?.endpoint_rules ?? {}).forEach((rule) => {
    if (Object.hasOwn(summary, rule.role)) summary[rule.role] += 1;
  });
  return summary;
}

export default function PrioritizationSettings({
  apiBaseUrl,
  value,
  onChange,
  metadata: suppliedMetadata = null,
}) {
  const method = value?.method ?? 'legacy_v1';
  const profile = value?.profile ?? null;
  const validation = value?.validation ?? null;
  const [metadata, setMetadata] = useState(suppliedMetadata);
  const [metadataError, setMetadataError] = useState('');
  const [validationBusy, setValidationBusy] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');

  useEffect(() => {
    if (suppliedMetadata) {
      setMetadata(suppliedMetadata);
      return undefined;
    }
    let active = true;
    fetch(`${apiBaseUrl}/api/prioritization/metadata`)
      .then((response) => {
        if (!response.ok) throw new Error(`Metadata request failed (${response.status}).`);
        return response.json();
      })
      .then((payload) => { if (active) setMetadata(payload); })
      .catch((error) => { if (active) setMetadataError(error.message); });
    return () => { active = false; };
  }, [apiBaseUrl, suppliedMetadata]);

  const normalized = useMemo(
    () => normalizedWeights(profile?.component_weights),
    [profile?.component_weights],
  );
  const selectedBuiltin = useMemo(
    () => (metadata?.builtin_profiles ?? []).find((record) => (
      record.profile_id === profile?.profile_id
      && record.profile_version === profile?.profile_version
      && JSON.stringify(record.profile) === JSON.stringify(profile)
    )) ?? null,
    [metadata?.builtin_profiles, profile],
  );
  const roleSummary = useMemo(() => endpointRoleSummary(profile), [profile]);
  const readOnly = profile?.status === 'frozen';
  const profileJson = profile ? JSON.stringify(profile, null, 2) : '';

  function updateProfile(patch) {
    if (readOnly) return;
    const nextProfile = typeof patch === 'function' ? patch(profile) : { ...profile, ...patch };
    onChange({ method: 'v2', profile: nextProfile, validation: null });
  }

  function selectMethod(nextMethod) {
    onChange({
      method: nextMethod,
      profile: nextMethod === 'v2' ? profile ?? emptyDraftProfile() : profile,
      validation: nextMethod === 'v2' ? validation : null,
    });
  }

  function selectBuiltin(nextKey) {
    if (!nextKey) {
      onChange({ method: 'v2', profile: emptyDraftProfile(), validation: null });
      return;
    }
    const record = (metadata?.builtin_profiles ?? []).find(
      (candidate) => builtinProfileKey(candidate) === nextKey,
    );
    if (!record) return;
    const nextProfile = JSON.parse(JSON.stringify(record.profile));
    onChange({
      method: 'v2',
      profile: nextProfile,
      validation: {
        structurally_valid: true,
        scoreable: Boolean(record.scoreable),
        profile_sha256: record.profile_sha256,
        warnings: record.warnings ?? [],
        errors: [],
        profile: nextProfile,
      },
    });
  }

  async function validateProfile() {
    setValidationBusy(true);
    try {
      const result = await requestProfileValidation(apiBaseUrl, profile);
      onChange({ method: 'v2', profile: result.profile ?? profile, validation: result });
    } catch (error) {
      onChange({
        method: 'v2', profile, validation: {
          structurally_valid: false, scoreable: false, errors: [error.message], warnings: [],
        },
      });
    } finally {
      setValidationBusy(false);
    }
  }

  function importProfile() {
    try {
      const imported = parseProfileJson(importText);
      setImportError('');
      onChange({ method: 'v2', profile: imported, validation: null });
    } catch (error) {
      setImportError(error.message);
    }
  }

  async function copyProfile() {
    try {
      await navigator.clipboard.writeText(profileJson);
      setCopyStatus('Profile JSON copied.');
    } catch {
      setCopyStatus('Clipboard unavailable; select the JSON manually.');
    }
  }

  return (
    <Box component="section" aria-label="Prioritization Settings" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2 }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="h2">Prioritization Settings</Typography>
          <Typography variant="body2" color="text.secondary">
            Legacy v1 is the compatibility scoring method. Prioritization v2 uses an explicit, validated multi-parameter profile.
          </Typography>
        </Box>

        <FormControl fullWidth size="small">
          <InputLabel id="prioritization-method-label">Prioritization method</InputLabel>
          <Select
            labelId="prioritization-method-label"
            label="Prioritization method"
            value={method}
            onChange={(event) => selectMethod(event.target.value)}
            inputProps={{ 'data-testid': 'prioritization-method' }}
          >
            <MenuItem value="legacy_v1">Legacy v1 · compatibility scoring</MenuItem>
            <MenuItem value="v2">Prioritization v2 · configurable multi-parameter</MenuItem>
          </Select>
        </FormControl>

        {method === 'legacy_v1' ? (
          <Alert severity="info">
            Legacy v1 remains the application default. No v2 profile configuration is required.
          </Alert>
        ) : (
          <Stack spacing={2}>
            <ProfileStatus profile={profile} validation={validation} />
            <FormControl fullWidth size="small">
              <InputLabel id="builtin-profile-label">Profile</InputLabel>
              <Select
                labelId="builtin-profile-label"
                label="Profile"
                value={selectedBuiltin ? builtinProfileKey(selectedBuiltin) : ''}
                onChange={(event) => selectBuiltin(event.target.value)}
                inputProps={{ 'data-testid': 'builtin-profile-selector' }}
              >
                <MenuItem value="">
                  {CUSTOM_PROFILE_CHOICE_LABEL}
                </MenuItem>
                {primaryBuiltinProfiles(metadata?.builtin_profiles).map((record) => (
                  <MenuItem value={builtinProfileKey(record)} key={builtinProfileKey(record)}>
                    {builtinProfileChoiceLabel(record)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {selectedBuiltin ? (
              <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }} data-testid="builtin-profile-summary">
                <Stack spacing={0.75}>
                  <Typography sx={{ fontWeight: 750 }}>{profile.name}</Typography>
                  <Typography variant="body2">
                    Version {profile.profile_version} · Status {humanize(profile.status)} · Target mode {profile.target_mode}
                  </Typography>
                  <Typography variant="caption">SHA256: {selectedBuiltin.profile_sha256}</Typography>
                  <Typography variant="caption">
                    Endpoint roles: {roleSummary.objective} objectives · {roleSummary.penalty} penalties · {roleSummary.display_only} display-only · {roleSummary.gate} gates
                  </Typography>
                  <Typography variant="body2">{selectedBuiltin.description}</Typography>
                  {selectedBuiltin.route_warning ? (
                    <Alert severity="warning" data-testid="oral-systemic-route-warning">
                      {selectedBuiltin.route_warning}
                    </Alert>
                  ) : null}
                  <Alert severity={selectedBuiltin.current ? 'info' : 'warning'}>{selectedBuiltin.notice}</Alert>
                  <Typography variant="caption" color="text.secondary">
                    {selectedBuiltin.current && selectedBuiltin.profile_id === 'moloptima_cns_literature_v2'
                      ? 'This freezes the configuration prospectively evaluated on the generated α7 library without post-evaluation retuning. It is not biological or clinical validation.'
                      : selectedBuiltin.current
                        ? 'Version 1.0.0 freezes the scientifically identical draft configuration after deterministic synthetic behavior testing. It was defined independently of α7 rankings and is not biological or clinical validation.'
                      : selectedBuiltin.historical
                        ? 'This historical draft is preserved for reproducibility and is not a primary profile choice.'
                        : 'This literature-informed draft is intended for target-aware behavior testing and remains customizable; it has not been frozen or biologically validated.'}
                  </Typography>
                </Stack>
              </Box>
            ) : null}
            {readOnly ? (
              <Alert severity="info" data-testid="frozen-profile-read-only">
                Frozen built-in profiles are read-only and cannot be edited in place. Select Custom or import a custom profile to change scientific parameters.
              </Alert>
            ) : null}

            <FormControl fullWidth size="small" disabled={readOnly}>
              <InputLabel id="target-mode-label">Target mode</InputLabel>
              <Select
                labelId="target-mode-label"
                label="Target mode"
                value={profile?.target_mode ?? 'custom'}
                onChange={(event) => updateProfile({ target_mode: event.target.value })}
                inputProps={{ 'data-testid': 'target-mode' }}
              >
                {TARGET_MODES.map((mode) => (
                  <MenuItem value={mode} key={mode}>{mode === 'peripheral' ? 'Peripheral' : mode}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>Top-level component weights</Typography>
              <Typography variant="caption" color="text.secondary">
                These three values determine total docking, ADMET, and molecular-quality importance. Configured weights are scientific policy choices and do not imply biological optimization.
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 1.5, mt: 1 }}>
                {COMPONENTS.map(([key, label]) => (
                  <TextField
                    key={key}
                    label={label}
                    type="number"
                    size="small"
                    disabled={readOnly}
                    value={profile?.component_weights?.[key] ?? ''}
                    onChange={(event) => updateProfile((current) => ({
                      ...current,
                      component_weights: numericMappingUpdate(
                        current.component_weights, key, event.target.value,
                      ),
                    }))}
                    helperText={`Normalized: ${formatNormalized(normalized[key])}`}
                    inputProps={{ min: 0, 'data-testid': `component-weight-${key}` }}
                  />
                ))}
              </Box>
            </Box>

            <Accordion disableGutters>
              <AccordionSummary expandIcon={<span aria-hidden="true">▾</span>}>
                <Typography sx={{ fontWeight: 750 }}>Advanced profile settings</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={2}>
                  <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>Internal ADMET domain composition</Typography>
                    <Typography variant="body2" color="text.secondary">
                      ADMET total weight → internal ADMET domains. Changing these values does not change the top-level ADMET weight.
                    </Typography>
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' }, gap: 1.5, mt: 1 }}>
                      {(metadata?.profile_options?.admet_domains ?? []).map((domain) => (
                        <TextField
                          key={domain}
                          label={humanize(domain)}
                          type="number"
                          size="small"
                          disabled={readOnly}
                          value={profile?.domain_weights?.[domain] ?? ''}
                          onChange={(event) => updateProfile((current) => ({
                            ...current,
                            domain_weights: numericMappingUpdate(
                              current.domain_weights, domain, event.target.value,
                            ),
                          }))}
                          inputProps={{ min: 0, 'data-testid': `admet-domain-weight-${domain}` }}
                        />
                      ))}
                    </Box>
                  </Box>

                  <Divider />
                  <DockingPolicyEditor profile={profile} updateProfile={updateProfile} disabled={readOnly} />
                  <Divider />
                  <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>Advanced endpoint rules</Typography>
                  {metadataError ? <Alert severity="warning">{metadataError}</Alert> : null}
                  {(metadata?.endpoints ?? []).map((endpoint) => (
                    <EndpointRuleEditor
                      key={endpoint.endpoint_id}
                      endpoint={endpoint}
                      rule={profile?.endpoint_rules?.[endpoint.endpoint_id]}
                      options={metadata.profile_options}
                      disabled={readOnly}
                      onChange={(nextRule) => updateProfile((current) => ({
                        ...current,
                        endpoint_rules: {
                          ...current.endpoint_rules,
                          [endpoint.endpoint_id]: nextRule,
                        },
                      }))}
                    />
                  ))}
                </Stack>
              </AccordionDetails>
            </Accordion>

            {profile?.endpoint_rules?.gmc_mpnn_bbb?.enabled ? (
              <Alert severity="warning">
                GMC-MPNN BBB uses a raw ensemble output. Its decision threshold is provisional and calibration is not frozen. Target mode changes profile configuration only.
              </Alert>
            ) : null}

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button variant="contained" onClick={validateProfile} disabled={validationBusy || !profile}>
                {validationBusy ? 'Validating' : 'Validate profile'}
              </Button>
              <Button variant="outlined" onClick={copyProfile} disabled={!profile}>Copy profile JSON</Button>
            </Stack>
            {copyStatus ? <Typography variant="caption">{copyStatus}</Typography> : null}

            <Accordion disableGutters>
              <AccordionSummary expandIcon={<span aria-hidden="true">▾</span>}>
                <Typography sx={{ fontWeight: 750 }}>Profile JSON and provenance</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={1.5}>
                  <TextField label="Current profile JSON" multiline minRows={8} value={profileJson} InputProps={{ readOnly: true }} />
                  <TextField label="Import profile JSON" multiline minRows={5} value={importText} onChange={(event) => setImportText(event.target.value)} />
                  <Button variant="outlined" onClick={importProfile}>Import JSON as custom profile</Button>
                  {importError ? <Alert severity="error">{importError}</Alert> : null}
                  <Typography variant="caption">Profile SHA256: {validation?.profile_sha256 ?? 'Validate to calculate'}</Typography>
                </Stack>
              </AccordionDetails>
            </Accordion>
          </Stack>
        )}
      </Stack>
    </Box>
  );
}

function ProfileStatus({ profile, validation }) {
  const scoreability = validation?.scoreable ? 'Scoreable' : 'Not scoreable';
  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      <Chip label={`Status: ${profile?.status ?? 'draft'}`} variant="outlined" />
      <Chip label={scoreability} color={validation?.scoreable ? 'success' : 'warning'} variant="outlined" />
      {validation?.structurally_valid ? <Chip label="Structurally valid" variant="outlined" /> : null}
      {(validation?.errors ?? []).map((error) => <Alert severity="error" key={error}>{error}</Alert>)}
      {(validation?.warnings ?? []).map((warning) => <Alert severity="warning" key={warning}>{warning}</Alert>)}
      {!validation ? <Alert severity="warning">Draft — scientific parameters not yet complete. Validate before scoring.</Alert> : null}
    </Stack>
  );
}

function DockingPolicyEditor({ profile, updateProfile, disabled }) {
  const policy = profile?.docking_policy ?? {};
  function updatePolicy(patch) {
    updateProfile({ docking_policy: { ...policy, ...patch } });
  }
  return (
    <Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>Docking policy</Typography>
      <Alert severity="info" sx={{ my: 1 }}>
        Within library: docking values are normalized relative to successfully docked molecules in the current generated campaign.
      </Alert>
      <Stack spacing={1.5}>
        <FormControlLabel
          control={<Checkbox checked={Boolean(policy.docking_required)} disabled={disabled} onChange={(event) => updatePolicy({ docking_required: event.target.checked })} />}
          label="Docking required for ranking"
        />
        <TextField label="Optional campaign ID" size="small" disabled={disabled} value={policy.campaign_id ?? ''} onChange={(event) => updatePolicy({ campaign_id: nullableText(event.target.value) })} />
        <TextField label="Optional reference molecule ID" size="small" disabled={disabled} value={policy.reference_molecule_id ?? ''} onChange={(event) => updatePolicy({ reference_molecule_id: nullableText(event.target.value) })} />
        <TextField label="Optional reference best Vina affinity (kcal/mol)" type="number" size="small" disabled={disabled} value={policy.reference_best_vina_affinity_kcal_mol ?? ''} onChange={(event) => updatePolicy({ reference_best_vina_affinity_kcal_mol: nullableNumber(event.target.value) })} />
        <Typography variant="caption" color="text.secondary">
          Reference delta is explanatory/contextual only and does not add another scoring term. Vina execution settings are configured separately.
        </Typography>
      </Stack>
    </Box>
  );
}

function EndpointRuleEditor({ endpoint, rule, options, disabled, onChange }) {
  const enabled = Boolean(rule?.enabled);
  function update(patch) {
    onChange({ ...(rule ?? emptyEndpointRule()), ...patch });
  }
  return (
    <Accordion variant="outlined" disableGutters>
      <AccordionSummary expandIcon={<span aria-hidden="true">▾</span>}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" sx={{ width: '100%', pr: 1 }}>
          <Typography sx={{ fontWeight: 700 }}>{endpoint.endpoint_id}</Typography>
          <Typography variant="caption" color="text.secondary">{endpoint.model_family} · {endpoint.units ?? 'unitless'}</Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1.5}>
          <Typography variant="body2">{endpoint.description}</Typography>
          <Typography variant="caption">Direction: {endpoint.semantic_direction} · uncertainty: {endpoint.uncertainty_available ? 'available' : 'not available'}</Typography>
          <FormControlLabel
            control={<Checkbox checked={enabled} disabled={disabled} onChange={(event) => update({ enabled: event.target.checked })} />}
            label="Enabled"
          />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' }, gap: 1.5 }}>
            <OptionSelect label="Role" value={rule?.role ?? ''} options={options.endpoint_roles} disabled={disabled || !enabled} onChange={(role) => update({ role })} />
            <OptionSelect label="Domain" value={rule?.domain ?? ''} options={options.domains} disabled={disabled || !enabled} onChange={(domain) => update({ domain })} />
            <TextField label="Endpoint weight" type="number" size="small" value={rule?.weight ?? ''} disabled={disabled || !enabled} onChange={(event) => update({ weight: nullableNumber(event.target.value) ?? '' })} inputProps={{ min: 0 }} />
            <OptionSelect label="Missing-data policy" value={rule?.missing_policy ?? ''} options={options.missing_policies} disabled={disabled || !enabled} onChange={(missing_policy) => update({ missing_policy })} />
            <OptionSelect label="Uncertainty policy" value={rule?.uncertainty_policy ?? ''} options={options.uncertainty_policies} disabled={disabled || !enabled} onChange={(uncertainty_policy) => update({ uncertainty_policy })} />
            <FormControlLabel control={<Checkbox checked={Boolean(rule?.required)} disabled={disabled || !enabled} onChange={(event) => update({ required: event.target.checked })} />} label="Required endpoint" />
          </Box>
          <TransformEditor label="Desirability transform" transform={rule?.transform} schemas={options.transform_schemas} disabled={disabled || !enabled} onChange={(transform) => update({ transform })} />
          {rule?.uncertainty_policy && rule.uncertainty_policy !== 'warning_only' ? (
            <TransformEditor label="Uncertainty transform" transform={rule?.uncertainty_transform} schemas={options.transform_schemas} disabled={disabled || !enabled} onChange={(uncertainty_transform) => update({ uncertainty_transform })} />
          ) : null}
          <TextField label="Notes" multiline minRows={2} value={rule?.notes ?? ''} disabled={disabled || !enabled} onChange={(event) => update({ notes: nullableText(event.target.value) })} />
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

function TransformEditor({ label, transform, schemas, disabled, onChange }) {
  const type = transform?.type ?? '';
  const parameters = type ? schemas?.[type] ?? [] : [];
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
      <Stack spacing={1.25}>
        <OptionSelect label={label} value={type} options={Object.keys(schemas ?? {})} disabled={disabled} onChange={(nextType) => onChange({ type: nextType, params: {} })} />
        {parameters.map((parameter) => (
          parameter.type === 'enum' ? (
            <OptionSelect key={parameter.name} label={humanize(parameter.name)} value={transform?.params?.[parameter.name] ?? ''} options={parameter.options} disabled={disabled} onChange={(value) => onChange({ ...transform, params: { ...transform.params, [parameter.name]: value } })} />
          ) : (
            <TextField
              key={parameter.name}
              label={humanize(parameter.name)}
              type={parameter.type === 'number' ? 'number' : 'text'}
              size="small"
              disabled={disabled}
              value={parameter.type === 'json_mapping' ? JSON.stringify(transform?.params?.[parameter.name] ?? {}) : transform?.params?.[parameter.name] ?? ''}
              onChange={(event) => onChange({
                ...transform,
                params: {
                  ...transform.params,
                  [parameter.name]: parameter.type === 'number'
                    ? nullableNumber(event.target.value) ?? ''
                    : parseMappingOrText(event.target.value),
                },
              })}
              helperText={parameter.type === 'json_mapping' ? 'JSON object mapping categories to desirability values.' : ''}
            />
          )
        ))}
      </Stack>
    </Box>
  );
}

function OptionSelect({ label, value, options = [], disabled, onChange }) {
  const id = `option-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`;
  return (
    <FormControl fullWidth size="small" disabled={disabled}>
      <InputLabel id={`${id}-label`}>{label}</InputLabel>
      <Select labelId={`${id}-label`} label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        <MenuItem value=""><em>Not configured</em></MenuItem>
        {options.map((option) => <MenuItem value={option} key={option}>{humanize(option)}</MenuItem>)}
      </Select>
    </FormControl>
  );
}

function emptyEndpointRule() {
  return {
    enabled: false,
    role: '',
    domain: '',
    transform: { type: '', params: {} },
    weight: '',
    required: false,
    missing_policy: '',
    uncertainty_policy: '',
    notes: null,
  };
}

function numericMappingUpdate(mapping = {}, key, rawValue) {
  const next = { ...mapping };
  if (rawValue === '') delete next[key];
  else next[key] = Number(rawValue);
  return next;
}

function nullableNumber(value) {
  if (value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function nullableText(value) {
  return value.trim() ? value : null;
}

function parseMappingOrText(value) {
  try { return JSON.parse(value); } catch { return value; }
}

function formatNormalized(value) {
  return value === null || value === undefined ? 'not available' : value.toFixed(3);
}

function humanize(value) {
  return String(value).replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
