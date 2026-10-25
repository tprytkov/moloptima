import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import PrioritizationSettings from './PrioritizationSettings.jsx';
import ScientificSetupDialog from './ScientificSetupDialog.jsx';
import {
  createScientificSetupState,
  scientificSetupReducer,
} from './scientificSetupState.js';

const TARGET_FIELDS = [
  ['target_name', 'Target name'],
  ['target_gene_symbol', 'Gene symbol'],
  ['target_chembl_id', 'ChEMBL target ID'],
  ['target_uniprot_id', 'UniProt ID'],
  ['pdb_id', 'PDB ID'],
  ['organism', 'Organism'],
  ['disease_context', 'Disease context'],
  ['mechanism_context', 'Mechanism context'],
  ['docking_protocol_notes', 'Docking protocol notes'],
  ['binding_site_notes', 'Binding site notes'],
];

export function createPrioritizationSetupConfiguration({
  prioritizationSettings,
  pubchemLookupEnabled,
  chemblLookupEnabled,
  patentLookupEnabled,
  targetReferenceEnabled,
  targetContext,
}) {
  return {
    prioritizationSettings,
    pubchemLookupEnabled: Boolean(pubchemLookupEnabled),
    chemblLookupEnabled: Boolean(chemblLookupEnabled),
    patentLookupEnabled: Boolean(patentLookupEnabled),
    targetReferenceEnabled: Boolean(targetReferenceEnabled),
    targetContext,
  };
}

export function validatePrioritizationSetup(configuration) {
  if (configuration?.prioritizationSettings?.method === 'v2'
    && !configuration.prioritizationSettings.validation?.scoreable) {
    return ['Multi-Parameter Prioritization requires a complete profile that passes backend scoring validation.'];
  }
  return [];
}

function EvidenceAndTargetSetup({ configuration, onChange }) {
  const targetContext = configuration.targetContext ?? {};
  const update = (patch) => onChange({ ...configuration, ...patch });
  const updateTarget = (key, value) => update({ targetContext: { ...targetContext, [key]: value } });
  const networkEnabled = configuration.pubchemLookupEnabled
    || configuration.chemblLookupEnabled
    || configuration.patentLookupEnabled
    || configuration.targetReferenceEnabled;

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h2">Evidence acquisition</Typography>
        <Typography variant="body2" color="text.secondary">
          These options are persisted with the combined calculation request. Public sources remain contextual research signals.
        </Typography>
      </Box>
      <Stack spacing={0.25}>
        <FormControlLabel control={<Checkbox checked={configuration.pubchemLookupEnabled} onChange={(event) => update({ pubchemLookupEnabled: event.target.checked })} />} label="Enable PubChem exact identity check" />
        <FormControlLabel control={<Checkbox checked={configuration.chemblLookupEnabled} onChange={(event) => update({ chemblLookupEnabled: event.target.checked })} />} label="Enable ChEMBL public bioactivity context" />
        <FormControlLabel control={<Checkbox checked={configuration.patentLookupEnabled} onChange={(event) => update({ patentLookupEnabled: event.target.checked })} />} label="Enable SureChEMBL patent-context signal" />
        <FormControlLabel control={<Checkbox checked={configuration.targetReferenceEnabled} onChange={(event) => update({ targetReferenceEnabled: event.target.checked })} />} label="Enable target reference discovery" />
      </Stack>
      <Alert severity={networkEnabled ? 'warning' : 'info'}>
        {networkEnabled
          ? 'Selected public lookups may use the network. Results are cached locally and reported as research signals only.'
          : 'Public compound lookup is off. Output rows will preserve Not requested states.'}
      </Alert>
      {configuration.targetReferenceEnabled ? (
        <Box component="section" aria-label="Target reference context">
          <Typography variant="h3" sx={{ mb: 1 }}>Target reference context</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.25 }}>
            {TARGET_FIELDS.map(([key, label]) => (
              <TextField
                key={key}
                size="small"
                label={label}
                value={targetContext[key] ?? ''}
                onChange={(event) => updateTarget(key, event.target.value)}
                sx={key.endsWith('_notes') ? { gridColumn: { sm: '1 / -1' } } : undefined}
              />
            ))}
          </Box>
        </Box>
      ) : null}
      <Box component="section" aria-label="Docking execution context">
        <Typography variant="h2">Docking execution</Typography>
        <FormControlLabel control={<Checkbox checked={Boolean(targetContext.enable_docking)} onChange={(event) => updateTarget('enable_docking', event.target.checked)} />} label="Enable local Vina docking" />
        <Typography variant="body2" color="text.secondary">
          Docking configuration: {targetContext.docking_configuration_id || 'not configured on Receptor & Docking page'}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Vina values are computational docking outputs, not experimental binding affinity.
        </Typography>
      </Box>
    </Stack>
  );
}

export default function PrioritizationSetupDialog({
  apiBaseUrl,
  appliedConfiguration,
  onApply,
  disabled = false,
}) {
  const [setupState, dispatch] = useReducer(
    scientificSetupReducer,
    appliedConfiguration,
    createScientificSetupState,
  );
  const [activeSection, setActiveSection] = useState(0);
  const triggerRef = useRef(null);
  const appliedKey = useMemo(() => JSON.stringify(appliedConfiguration), [appliedConfiguration]);

  useEffect(() => {
    dispatch({ type: 'replace-applied', configuration: appliedConfiguration });
  }, [appliedKey]);

  function changeConfiguration(nextConfiguration) {
    dispatch({ type: 'change', patch: nextConfiguration });
  }

  function applyConfiguration() {
    const errors = validatePrioritizationSetup(setupState.draftConfiguration);
    if (errors.length) {
      dispatch({ type: 'validation-failed', errors });
      return;
    }
    onApply(setupState.draftConfiguration);
    dispatch({ type: 'apply' });
  }

  return (
    <>
      <Button ref={triggerRef} variant="outlined" disabled={disabled} onClick={() => dispatch({ type: 'open' })}>
        Prioritization Setup
      </Button>
      <ScientificSetupDialog
        open={setupState.open}
        title="Prioritization Setup"
        context="Configure the existing combined prioritization calculation. Applying changes does not recompute current results."
        sections={[{ id: 'ranking', label: 'Ranking Method' }, { id: 'evidence', label: 'Evidence & Target' }]}
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        dirty={setupState.dirty}
        validationErrors={setupState.validationErrors}
        applyDisabled={!setupState.dirty}
        onCancel={() => dispatch({ type: 'cancel' })}
        onApply={applyConfiguration}
        restoreFocusRef={triggerRef}
      >
        {activeSection === 0 ? (
          <PrioritizationSettings
            apiBaseUrl={apiBaseUrl}
            value={setupState.draftConfiguration.prioritizationSettings}
            onChange={(prioritizationSettings) => changeConfiguration({ prioritizationSettings })}
            embedded
          />
        ) : (
          <EvidenceAndTargetSetup
            configuration={setupState.draftConfiguration}
            onChange={(next) => changeConfiguration(next)}
          />
        )}
      </ScientificSetupDialog>
    </>
  );
}
