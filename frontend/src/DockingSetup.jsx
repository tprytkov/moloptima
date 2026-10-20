import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, FormControl, FormControlLabel, FormLabel, MenuItem,
  Paper, Radio, RadioGroup, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, TextField, Typography,
} from '@mui/material';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import ModuleConfigurationSummary from './ModuleConfigurationSummary.jsx';
import ReceptorViewer from './ReceptorViewer.jsx';
import ScientificSetupDialog from './ScientificSetupDialog.jsx';
import { createScientificSetupState, scientificSetupReducer } from './scientificSetupState.js';

export const DEFAULT_VINA_SETTINGS = Object.freeze({
  exhaustiveness: '8', numModes: '9', energyRange: '', seed: '2025', workerCount: '4',
});
const EMPTY_BOX = Object.freeze({ centerX: '', centerY: '', centerZ: '', sizeX: '', sizeY: '', sizeZ: '' });

export const RECEPTOR_STATE_POLICY = Object.freeze({
  box: 'clear on receptor ID change; preserve on same-receptor artifact change',
  method: 'clear on receptor ID change; reset if an artifact change invalidates its selection',
  selectedAtom: 'clear on receptor ID or artifact change',
  selectedResidues: 'clear on receptor ID or artifact change',
  selectedLigandId: 'clear on receptor ID or artifact change',
  selectedChains: 'initialize for a different receptor; preserve for same-receptor artifact change',
  heteroChoices: 'clear on receptor ID change; preserve for same-receptor artifact change',
  altlocChoices: 'clear on receptor ID change; preserve for same-receptor artifact change',
  pocketGroupId: 'clear on receptor ID change; preserve for same-receptor artifact change',
  ligandRemovalIds: 'clear on receptor ID change; preserve for same-receptor artifact change',
  confirmed: 'clear whenever receptor metadata is refreshed',
});

export function receptorArtifactIdentity(receptor) {
  if (!receptor) return '';
  const representation = receptor.docking_ready ? 'docking' : 'source';
  const digest = receptor.docking_ready
    ? receptor.docking_receptor_sha256
    : receptor.source_receptor_sha256;
  return [receptor.receptor_id, representation, receptor.preparation_id || '', digest || ''].join(':');
}

export function classifyReceptorTransition(previousReceptor, nextReceptor) {
  const receptorChanged = previousReceptor?.receptor_id !== nextReceptor?.receptor_id;
  return {
    receptorChanged,
    artifactChanged: !receptorChanged
      && receptorArtifactIdentity(previousReceptor) !== receptorArtifactIdentity(nextReceptor),
  };
}

export function createReceptorScopedState(overrides = {}) {
  return {
    method: '', selectedAtom: null, selectedResidues: [], selectedLigandId: '',
    box: { ...EMPTY_BOX }, confirmed: null, selectedChains: [], heteroChoices: {},
    altlocChoices: {}, pocketGroupId: '', ligandRemovalIds: [], ...overrides,
  };
}

export function heteroChoicesForInventory(groups = [], existingChoices = {}) {
  return Object.fromEntries(groups.map((group) => [
    group.group_id,
    ['keep', 'exclude'].includes(existingChoices[group.group_id])
      ? existingChoices[group.group_id]
      : 'exclude',
  ]));
}

export function updateHeteroChoice(current, groupId, action) {
  if (!['keep', 'exclude'].includes(action)) return current;
  return {
    ...current,
    heteroChoices: { ...current.heteroChoices, [groupId]: action },
  };
}

export function excludeAllHeteroGroups(current, groups = []) {
  return {
    ...current,
    heteroChoices: heteroChoicesForInventory(groups),
  };
}

export function transitionReceptorScopedState(current, previousReceptor, nextReceptor) {
  const transition = classifyReceptorTransition(previousReceptor, nextReceptor);
  const nextGroups = nextReceptor?.structure_inventory?.hetero_groups;
  if (transition.receptorChanged) {
    const chains = nextReceptor?.structure_inventory?.protein?.chains ?? [];
    return createReceptorScopedState({
      selectedChains: chains.map((item) => item.chain),
      heteroChoices: heteroChoicesForInventory(nextGroups ?? []),
    });
  }
  const heteroChoices = Array.isArray(nextGroups)
    ? heteroChoicesForInventory(nextGroups, current.heteroChoices)
    : current.heteroChoices;
  if (transition.artifactChanged) {
    return {
      ...current,
      selectedAtom: null,
      selectedResidues: [],
      heteroChoices,
      confirmed: null,
    };
  }
  return { ...current, heteroChoices, confirmed: null };
}

export function createLatestRequestGuard(AbortControllerClass = globalThis.AbortController) {
  let generation = 0;
  let controller = null;
  return {
    start() {
      controller?.abort();
      controller = new AbortControllerClass();
      const requestController = controller;
      const requestGeneration = ++generation;
      return {
        signal: requestController.signal,
        isCurrent: () => requestGeneration === generation && !requestController.signal.aborted,
      };
    },
    invalidate() {
      generation += 1;
      controller?.abort();
      controller = null;
    },
  };
}

export async function uploadDockingReceptor(apiBaseUrl, file, receptorId = '', signal) {
  const formData = new FormData();
  formData.append('file', file);
  const query = new URLSearchParams();
  if (receptorId) query.set('receptor_id', receptorId);
  return decodeResponse(await fetch(`${apiBaseUrl}/api/docking/receptors?${query}`, {
    method: 'POST', body: formData, signal,
  }));
}

export async function submitDockingConfiguration(apiBaseUrl, payload) {
  return decodeResponse(await fetch(`${apiBaseUrl}/api/docking/configurations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }));
}

export async function fetchReceptorPreparationRuntime(apiBaseUrl) {
  return decodeResponse(await fetch(`${apiBaseUrl}/api/docking/receptor-preparation/runtime`));
}

export async function prepareDockingReceptor(apiBaseUrl, receptorId, payload, signal) {
  return decodeResponse(await fetch(`${apiBaseUrl}/api/docking/receptors/${receptorId}/prepare`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal,
  }));
}

export function receptorStructureUrl(apiBaseUrl, receptor) {
  const representation = receptor.docking_ready ? 'docking' : 'source';
  return `${apiBaseUrl}/api/docking/receptors/${receptor.receptor_id}/structure?representation=${representation}`;
}

export async function fetchReceptorStructure(apiBaseUrl, receptor, signal) {
  const expectedRepresentation = receptor.docking_ready ? 'docking' : 'source';
  const response = await fetch(receptorStructureUrl(apiBaseUrl, receptor), { signal });
  if (!response.ok) throw new Error(await response.text());
  const identity = {
    representation: response.headers.get('X-MolOptima-Structure-Representation') || '',
    receptorId: response.headers.get('X-MolOptima-Receptor-ID') || '',
    artifactSha256: response.headers.get('X-MolOptima-Artifact-SHA256') || '',
    preparationId: response.headers.get('X-MolOptima-Preparation-ID') || '',
    dockingReceptorSha256: response.headers.get('X-MolOptima-Docking-Receptor-SHA256') || '',
  };
  const format = response.headers.get('X-MolOptima-Structure-Format') || '';
  if (identity.representation !== expectedRepresentation || identity.receptorId !== receptor.receptor_id) {
    throw new Error('Receptor visualization identity does not match the requested receptor representation.');
  }
  const expectedDigest = receptor.docking_ready
    ? receptor.docking_receptor_sha256
    : receptor.source_receptor_sha256;
  if (!format || !identity.artifactSha256 || identity.artifactSha256 !== expectedDigest) {
    throw new Error('Receptor visualization artifact identity does not match receptor metadata.');
  }
  if (receptor.docking_ready && (
    format !== 'pdbqt'
    || identity.dockingReceptorSha256 !== expectedDigest
    || (receptor.preparation_id && identity.preparationId !== receptor.preparation_id)
  )) {
    throw new Error('Docking receptor visualization does not match the validated Vina receptor.');
  }
  return { text: await response.text(), format, identity };
}

export function preparationPayload(selectedChains, heteroChoices, altlocChoices, pocketGroupId = '', method = 'manual', ligandRemovalIds = [], box = EMPTY_BOX, padding = '4') {
  const base = {
    selected_chains: selectedChains,
    water_policy: 'remove_all',
    hetero_choices: Object.fromEntries(Object.entries(heteroChoices).map(([key, value]) => [key, value === 'keep'])),
    altloc_choices: altlocChoices,
    bound_ligand_id: pocketGroupId,
  };
  if (arguments.length <= 4) return base;
  return {
    ...base,
    pocket_definition_method: method === 'reference_ligand' ? 'reference_ligand' : 'manual',
    reference_ligand_id: method === 'reference_ligand' ? pocketGroupId : '',
    ligand_removal_ids: ligandRemovalIds,
    pocket_box: {
      center_x: numericOrNull(box.centerX), center_y: numericOrNull(box.centerY), center_z: numericOrNull(box.centerZ),
      size_x: numericOrNull(box.sizeX), size_y: numericOrNull(box.sizeY), size_z: numericOrNull(box.sizeZ),
      ...(method === 'reference_ligand' ? { padding: numericOrNull(padding) } : {}),
    },
  };
}

export function preparationSelectionReady(inventory, selectedChains, heteroChoices, altlocChoices) {
  if (!inventory || !selectedChains.length) return false;
  const hetero = inventory.hetero_groups ?? [];
  const altlocs = inventory.alternate_locations ?? [];
  return hetero.every((group) => ['keep', 'exclude'].includes(heteroChoices[group.group_id]))
    && altlocs.every((item) => item.choices.includes(altlocChoices[item.residue_key]));
}

export function ligandCentroid(ligand) {
  const centroid = ligand?.centroid ?? {};
  return { centerX: String(centroid.center_x ?? ''), centerY: String(centroid.center_y ?? ''), centerZ: String(centroid.center_z ?? '') };
}

export function atomDetails(atom) {
  if (!atom || ![atom.x, atom.y, atom.z].map(Number).every(Number.isFinite)) return null;
  return {
    chain: atom.chain || '', residueName: atom.resn || '', residueNumber: atom.resi ?? '',
    atomName: atom.atom || atom.elem || '', x: Number(atom.x), y: Number(atom.y), z: Number(atom.z),
  };
}

export function centroidForAtoms(atoms) {
  const valid = (atoms || []).filter((atom) => atomDetails(atom));
  if (!valid.length) return null;
  return {
    x: valid.reduce((sum, atom) => sum + Number(atom.x), 0) / valid.length,
    y: valid.reduce((sum, atom) => sum + Number(atom.y), 0) / valid.length,
    z: valid.reduce((sum, atom) => sum + Number(atom.z), 0) / valid.length,
  };
}

export function fitBoxToAtoms(atoms, padding = 4) {
  const valid = (atoms || []).filter((atom) => atomDetails(atom));
  const margin = Number(padding);
  if (!valid.length || !Number.isFinite(margin) || margin < 0) return null;
  const coordinates = ['x', 'y', 'z'].map((key) => valid.map((atom) => Number(atom[key])));
  const minima = coordinates.map((values) => Math.min(...values));
  const maxima = coordinates.map((values) => Math.max(...values));
  return {
    centerX: formatCoordinate((minima[0] + maxima[0]) / 2),
    centerY: formatCoordinate((minima[1] + maxima[1]) / 2),
    centerZ: formatCoordinate((minima[2] + maxima[2]) / 2),
    sizeX: formatCoordinate(maxima[0] - minima[0] + margin * 2),
    sizeY: formatCoordinate(maxima[1] - minima[1] + margin * 2),
    sizeZ: formatCoordinate(maxima[2] - minima[2] + margin * 2),
  };
}

export function dockingReadiness(receptor, box) {
  const centerInput = [box.centerX, box.centerY, box.centerZ];
  const sizeInput = [box.sizeX, box.sizeY, box.sizeZ];
  const center = centerInput.map(Number);
  const size = sizeInput.map(Number);
  return {
    receptorLoaded: Boolean(receptor), preparedReceptor: Boolean(receptor?.docking_ready),
    centerDefined: centerInput.every((value) => value !== '' && value !== null && value !== undefined)
      && center.every(Number.isFinite),
    positiveDimensions: sizeInput.every((value) => value !== '' && value !== null && value !== undefined)
      && size.every((value) => Number.isFinite(value) && value > 0),
  };
}

export function searchSpacePresentation(box) {
  const centerInput = [box.centerX, box.centerY, box.centerZ];
  const sizeInput = [box.sizeX, box.sizeY, box.sizeZ];
  const inputs = [...centerInput, ...sizeInput];
  if (inputs.some((value) => value === '' || value === null || value === undefined)) {
    return {
      status: 'incomplete',
      message: 'Incomplete search space. Enter all three center coordinates and all three box dimensions.',
    };
  }
  const center = centerInput.map(Number);
  const size = sizeInput.map(Number);
  if (![...center, ...size].every(Number.isFinite)) {
    return { status: 'invalid', message: 'Invalid search space. Enter finite numeric values.' };
  }
  if (size.some((value) => value <= 0)) {
    return { status: 'invalid-size', message: 'Invalid search-box size. All three dimensions must be greater than 0 Å.' };
  }
  const display = (value) => (Object.is(value, -0) ? 0 : value).toFixed(2);
  return {
    status: 'valid',
    center: `Center: (${center.map(display).join(', ')}) Å`,
    size: `Size: ${size.map(display).join(' × ')} Å`,
  };
}

export function configurationPayload(receptorId, method, selectedLigandId, box, advanced) {
  const energyRange = numericOrNull(advanced.energyRange);
  const centerMethod = ['selected_atom', 'selected_region'].includes(method) ? 'atom_or_residue' : method;
  return {
    receptor_id: receptorId, center_method: centerMethod,
    selected_ligand_id: ['bound_ligand', 'reference_ligand'].includes(method) ? selectedLigandId : '',
    ...(['bound_ligand', 'reference_ligand'].includes(method) ? { padding: numericOrNull(advanced.padding) } : {}),
    center_x: numericOrNull(box.centerX), center_y: numericOrNull(box.centerY), center_z: numericOrNull(box.centerZ),
    size_x: numericOrNull(box.sizeX), size_y: numericOrNull(box.sizeY), size_z: numericOrNull(box.sizeZ),
    exhaustiveness: numericOrNull(advanced.exhaustiveness), num_modes: numericOrNull(advanced.numModes),
    ...(energyRange === null ? {} : { energy_range: energyRange }),
    seed: numericOrNull(advanced.seed), worker_count: numericOrNull(advanced.workerCount),
  };
}

export function selectedLigandForId(boundLigands, ligandId) {
  if (!ligandId) return null;
  return boundLigands.find((ligand) => ligand.ligand_id === ligandId) ?? null;
}

export function heterogroupPresentation(group = {}) {
  const groupName = String(group.residue_name || 'Unavailable');
  const chain = group.chain === '' ? '(blank)' : String(group.chain ?? 'Unavailable');
  const residueNumber = group.residue_number === '' ? 'Unavailable' : String(group.residue_number ?? 'Unavailable');
  const insertionCode = String(group.insertion_code || '');
  const residue = `${residueNumber}${insertionCode}`;
  const identity = `${chain}:${groupName}${residue}`;
  return {
    identity,
    accessibleIdentity: group.group_id ? `${identity} [${group.group_id}]` : identity,
    groupName,
    chain,
    residue,
    type: String(group.type || 'Unavailable').replaceAll('_', ' '),
    atomCount: group.atom_count ?? 'Unavailable',
  };
}

export function validateBindingConfiguration(configuration = {}) {
  const errors = [];
  const presentation = searchSpacePresentation(configuration.box || EMPTY_BOX);
  if (!['manual', 'reference_ligand', 'selected_atom', 'selected_region'].includes(configuration.method)) {
    errors.push('Choose an implemented pocket-definition method.');
  }
  if (presentation.status !== 'valid') errors.push(presentation.message);
  const padding = Number(configuration.padding);
  if (!Number.isFinite(padding) || padding < 0) errors.push('Fit padding must be a finite value greater than or equal to 0 Å.');
  if (configuration.method === 'reference_ligand' && !configuration.selectedLigandId) {
    errors.push('Select a detected bound ligand for the reference-ligand method.');
  }
  return errors;
}

export function validateDockingSettings(settings = {}) {
  const errors = [];
  const positiveInteger = (value) => Number.isInteger(Number(value)) && Number(value) > 0;
  if (!positiveInteger(settings.exhaustiveness)) errors.push('Exhaustiveness must be a positive integer.');
  if (!positiveInteger(settings.numModes)) errors.push('Number of modes must be a positive integer.');
  if (!positiveInteger(settings.workerCount)) errors.push('Workers must be a positive integer.');
  if (!Number.isInteger(Number(settings.seed))) errors.push('Random seed must be an integer.');
  if (settings.energyRange !== '' && (!Number.isFinite(Number(settings.energyRange)) || Number(settings.energyRange) <= 0)) {
    errors.push('Energy range must be blank or a positive finite value.');
  }
  return errors;
}

export function validatePreparationChoices(inventory, state) {
  return preparationSelectionReady(inventory, state.selectedChains, state.heteroChoices, state.altlocChoices)
    ? []
    : ['Select at least one protein chain and complete every heterogroup and alternate-location choice.'];
}

export function HeterogroupTable({ groups = [], choices = {}, pocketGroupId = '', onActionChange, onPocketChange }) {
  if (!groups.length) return <Typography variant="caption" color="text.secondary">No non-water hetero groups detected.</Typography>;
  return (
    <TableContainer sx={{ maxWidth: '100%', maxHeight: 300, overflow: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Table stickyHeader size="small" aria-label="Receptor heterogroups" sx={{ minWidth: 900 }}>
        <TableHead><TableRow><TableCell>Identity</TableCell><TableCell>Group</TableCell><TableCell>Chain</TableCell><TableCell>Residue</TableCell><TableCell>Type</TableCell><TableCell align="right">Atoms</TableCell><TableCell>Receptor action</TableCell><TableCell>Use for pocket</TableCell></TableRow></TableHead>
        <TableBody>{groups.map((group) => {
          const display = heterogroupPresentation(group);
          return <TableRow key={group.group_id || display.identity}>
            <TableCell sx={{ fontWeight: 750, whiteSpace: 'nowrap' }}>{display.identity}</TableCell>
            <TableCell>{display.groupName}</TableCell><TableCell>{display.chain}</TableCell><TableCell>{display.residue}</TableCell>
            <TableCell>{display.type}</TableCell><TableCell align="right">{display.atomCount}</TableCell>
            <TableCell><TextField select size="small" aria-label={`Receptor action for heterogroup ${display.accessibleIdentity}`} value={choices[group.group_id] ?? 'exclude'} onChange={(event) => onActionChange?.(group.group_id, event.target.value)} sx={{ minWidth: 110 }}><MenuItem value="keep">Include</MenuItem><MenuItem value="exclude">Exclude</MenuItem></TextField></TableCell>
            <TableCell><Checkbox size="small" aria-label={`Use heterogroup ${display.accessibleIdentity} for pocket definition`} checked={pocketGroupId === group.group_id} onChange={(event) => onPocketChange?.(group, event.target.checked)} /></TableCell>
          </TableRow>;
        })}</TableBody>
      </Table>
    </TableContainer>
  );
}

function createDockingWorkspaceConfiguration() {
  return {
    receptor: createReceptorScopedState(),
    padding: '4',
    advanced: { ...DEFAULT_VINA_SETTINGS },
  };
}

export default function DockingSetup({ apiBaseUrl, onConfirmed, onRunDocking, runDisabled = false, runLoading = false }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [receptor, setReceptor] = useState(null);
  const [structure, setStructure] = useState(null);
  const [activeDialog, setActiveDialog] = useState('');
  const [uploading, setUploading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [error, setError] = useState('');
  const [preparationRuntime, setPreparationRuntime] = useState(null);
  const [showBox, setShowBox] = useState(true);
  const [selectedAtom, setSelectedAtom] = useState(null);
  const [selectedResidues, setSelectedResidues] = useState([]);
  const [confirmed, setConfirmed] = useState(null);
  const [setup, dispatchSetup] = useReducer(
    scientificSetupReducer,
    null,
    () => createScientificSetupState(createDockingWorkspaceConfiguration()),
  );
  const setupRef = useRef(setup);
  setupRef.current = setup;
  const viewerRef = useRef(null);
  const receptorRef = useRef(null);
  const requestGuardRef = useRef(null);
  const selectButtonRef = useRef(null);
  const prepareButtonRef = useRef(null);
  const bindingButtonRef = useRef(null);
  const dockingButtonRef = useRef(null);
  if (!requestGuardRef.current) requestGuardRef.current = createLatestRequestGuard();

  const applied = setup.appliedConfiguration;
  const draft = setup.draftConfiguration;
  const appliedState = applied.receptor;
  const draftState = draft.receptor;
  const boundLigands = receptor?.bound_ligands ?? [];
  const inventory = receptor?.structure_inventory ?? null;
  const selectedLigand = selectedLigandForId(boundLigands, appliedState.selectedLigandId);
  const draftLigand = selectedLigandForId(boundLigands, draftState.selectedLigandId);
  const matchingDraftLigands = draftLigand
    ? boundLigands.filter((ligand) => ligand.residue_name === draftLigand.residue_name && ligand.residue_number === draftLigand.residue_number)
    : [];
  const appliedSearchSpace = searchSpacePresentation(appliedState.box);
  const draftSearchSpace = searchSpacePresentation(draftState.box);
  const readiness = dockingReadiness(receptor, appliedState.box);
  const ready = Object.values(readiness).every(Boolean);
  const selectedRegionAtoms = useMemo(() => {
    const viewer = viewerRef.current;
    if (!viewer) return [];
    return selectedResidues.flatMap((residue) => viewer.selectedAtoms({ chain: residue.chain, resi: residue.residueNumber, resn: residue.residueName }));
  }, [selectedResidues]);

  useEffect(() => {
    let active = true;
    fetchReceptorPreparationRuntime(apiBaseUrl)
      .then((status) => { if (active) setPreparationRuntime(status); })
      .catch((runtimeError) => { if (active) setPreparationRuntime({ available: false, status: 'unavailable', reason: runtimeError.message }); });
    return () => { active = false; };
  }, [apiBaseUrl]);

  useEffect(() => () => requestGuardRef.current?.invalidate(), []);

  function replaceAppliedConfiguration(configuration) {
    dispatchSetup({ type: 'replace-applied', configuration });
  }

  function updateDraftReceptor(patch) {
    dispatchSetup({ type: 'change', patch: { receptor: { ...setupRef.current.draftConfiguration.receptor, ...patch } } });
  }

  function updateDraftBox(value) {
    const current = setupRef.current.draftConfiguration.receptor.box;
    updateDraftReceptor({ box: typeof value === 'function' ? value(current) : value });
  }

  function updateDraftAdvanced(value) {
    const current = setupRef.current.draftConfiguration.advanced;
    dispatchSetup({ type: 'change', patch: { advanced: typeof value === 'function' ? value(current) : value } });
  }

  function openSetup(name) {
    setActiveDialog(name);
    dispatchSetup({ type: 'open' });
  }

  function cancelSetup() {
    dispatchSetup({ type: 'cancel' });
    setActiveDialog('');
  }

  function commitLoadedReceptor(metadata, nextStructure) {
    const previousReceptor = receptorRef.current;
    const current = setupRef.current.appliedConfiguration;
    const nextReceptorState = transitionReceptorScopedState(current.receptor, previousReceptor, metadata);
    replaceAppliedConfiguration({ ...current, receptor: nextReceptorState });
    receptorRef.current = metadata;
    setReceptor(metadata);
    setStructure(nextStructure);
    setSelectedAtom(null);
    setSelectedResidues([]);
    setConfirmed(null);
  }

  async function handleUpload() {
    if (!selectedFile) return;
    const request = requestGuardRef.current.start();
    const file = selectedFile;
    setPreparing(false); setUploading(true); setError('');
    try {
      const associationId = receptorRef.current && file.name.toLowerCase().endsWith('.pdbqt')
        ? receptorRef.current.receptor_id : '';
      const metadata = await uploadDockingReceptor(apiBaseUrl, file, associationId, request.signal);
      if (!request.isCurrent()) return;
      const nextStructure = await fetchReceptorStructure(apiBaseUrl, metadata, request.signal);
      if (!request.isCurrent()) return;
      commitLoadedReceptor(metadata, nextStructure);
      setSelectedFile(null);
      setActiveDialog('');
    } catch (uploadError) {
      if (request.isCurrent() && uploadError.name !== 'AbortError') setError(uploadError.message ?? String(uploadError));
    } finally { if (request.isCurrent()) setUploading(false); }
  }

  function toggleDraftChain(chain) {
    const selectedChains = draftState.selectedChains.includes(chain)
      ? draftState.selectedChains.filter((item) => item !== chain)
      : [...draftState.selectedChains, chain];
    updateDraftReceptor({ selectedChains });
  }

  function setDraftHeteroAction(groupId, action) {
    updateDraftReceptor(updateHeteroChoice(draftState, groupId, action));
  }

  function useDraftHeteroForPocket(group, checked) {
    if (!checked) {
      if (draftState.pocketGroupId === group.group_id) updateDraftReceptor({ pocketGroupId: '' });
      return;
    }
    const ligand = boundLigands.find((item) => item.ligand_id === group.group_id);
    updateDraftReceptor({
      pocketGroupId: group.group_id,
      method: 'selected_region',
      selectedLigandId: ligand?.ligand_id ?? '',
      box: {
        ...draftState.box,
        centerX: formatCoordinate(group.centroid.center_x),
        centerY: formatCoordinate(group.centroid.center_y),
        centerZ: formatCoordinate(group.centroid.center_z),
      },
    });
  }

  function preparationErrors(configuration) {
    const state = configuration.receptor;
    const errors = [
      ...validatePreparationChoices(inventory, state),
      ...validateBindingConfiguration({ ...state, padding: configuration.padding }),
    ];
    if (state.method === 'reference_ligand' && (!state.pocketGroupId || !state.ligandRemovalIds.includes(state.pocketGroupId))) {
      errors.push('The reference ligand selected for pocket definition must also be selected for removal before repair.');
    }
    return errors;
  }

  function applyPreparation() {
    const errors = validatePreparationChoices(inventory, draft.receptor);
    if (errors.length) { dispatchSetup({ type: 'validation-failed', errors }); return; }
    dispatchSetup({ type: 'apply' });
    setActiveDialog('');
  }

  async function applyAndPrepare() {
    const configuration = setupRef.current.draftConfiguration;
    const errors = preparationErrors(configuration);
    if (errors.length || !receptor || !preparationRuntime?.available) {
      dispatchSetup({ type: 'validation-failed', errors: errors.length ? errors : ['Receptor preparation runtime is unavailable.'] });
      return;
    }
    dispatchSetup({ type: 'apply-and-run' });
    const state = configuration.receptor;
    const request = requestGuardRef.current.start();
    setPreparing(true); setError('');
    try {
      const metadata = await prepareDockingReceptor(apiBaseUrl, receptor.receptor_id, preparationPayload(
        state.selectedChains, state.heteroChoices, state.altlocChoices, state.pocketGroupId,
        state.method, state.ligandRemovalIds, state.box, configuration.padding,
      ), request.signal);
      if (!request.isCurrent()) return;
      const nextStructure = await fetchReceptorStructure(apiBaseUrl, metadata, request.signal);
      if (!request.isCurrent()) return;
      commitLoadedReceptor(metadata, nextStructure);
      setActiveDialog('');
    } catch (preparationError) {
      if (request.isCurrent() && preparationError.name !== 'AbortError') {
        const message = preparationError.message ?? String(preparationError);
        setError(message);
        dispatchSetup({ type: 'validation-failed', errors: [`Receptor preparation failed: ${message}`] });
      }
    } finally { if (request.isCurrent()) setPreparing(false); }
  }

  function selectDraftLigand(ligand) {
    if (!ligand) { updateDraftReceptor({ selectedLigandId: '' }); return; }
    const defaults = ligand.default_box;
    updateDraftReceptor({
      method: 'reference_ligand', selectedLigandId: ligand.ligand_id, pocketGroupId: ligand.ligand_id,
      ligandRemovalIds: draftState.ligandRemovalIds.includes(ligand.ligand_id)
        ? draftState.ligandRemovalIds : [...draftState.ligandRemovalIds, ligand.ligand_id],
      box: defaults ? {
        centerX: formatBoxInput(defaults.center_x), centerY: formatBoxInput(defaults.center_y), centerZ: formatBoxInput(defaults.center_z),
        sizeX: formatBoxInput(defaults.size_x), sizeY: formatBoxInput(defaults.size_y), sizeZ: formatBoxInput(defaults.size_z),
      } : { ...draftState.box, ...ligandCentroid(ligand) },
    });
  }

  function fitDraftSelection(atoms) {
    const fitted = fitBoxToAtoms(atoms, draft.padding);
    if (!fitted) {
      dispatchSetup({ type: 'validation-failed', errors: ['A valid atom selection and non-negative padding are required to fit the docking box.'] });
      return;
    }
    updateDraftBox(fitted);
  }

  function applyBindingSite() {
    const errors = validateBindingConfiguration({ ...draftState, padding: draft.padding });
    if (errors.length) { dispatchSetup({ type: 'validation-failed', errors }); return; }
    dispatchSetup({ type: 'apply' });
    setConfirmed(null);
    setActiveDialog('');
  }

  function dockingErrors(configuration) {
    const state = configuration.receptor;
    const errors = validateBindingConfiguration({ ...state, padding: configuration.padding });
    if (!receptor?.docking_ready) errors.unshift('A prepared PDBQT receptor is required.');
    errors.push(...validateDockingSettings(configuration.advanced));
    return errors;
  }

  async function applyDockingSettings(runAfter = false) {
    const configurationState = setupRef.current.draftConfiguration;
    const errors = dockingErrors(configurationState);
    if (errors.length || (runAfter && runDisabled)) {
      dispatchSetup({ type: 'validation-failed', errors: errors.length ? errors : ['Load at least one valid molecule before running docking.'] });
      return;
    }
    dispatchSetup({ type: 'apply-and-run' });
    setConfiguring(true); setError('');
    try {
      const state = configurationState.receptor;
      const configuration = await submitDockingConfiguration(apiBaseUrl, configurationPayload(
        receptor.receptor_id, state.method, state.selectedLigandId, state.box,
        { ...configurationState.advanced, padding: configurationState.padding },
      ));
      setConfirmed(configuration);
      onConfirmed?.({ receptor, configuration });
      dispatchSetup({ type: 'run-finished' });
      setActiveDialog('');
      if (runAfter) await onRunDocking?.({ receptor, configuration });
    } catch (configurationError) {
      const message = configurationError.message ?? String(configurationError);
      setError(message);
      dispatchSetup({ type: 'validation-failed', errors: [`Docking configuration failed: ${message}`] });
    } finally { setConfiguring(false); }
  }

  function openBindingFromAtom() {
    openSetup('binding');
    updateDraftReceptor({
      method: 'selected_atom',
      box: {
        ...setupRef.current.appliedConfiguration.receptor.box,
        centerX: formatCoordinate(selectedAtom.x), centerY: formatCoordinate(selectedAtom.y), centerZ: formatCoordinate(selectedAtom.z),
      },
    });
  }

  function addSelectedResidue() {
    if (!selectedAtom) return;
    const key = `${selectedAtom.chain}:${selectedAtom.residueName}:${selectedAtom.residueNumber}`;
    setSelectedResidues((current) => current.some((item) => item.key === key) ? current
      : [...current, { key, chain: selectedAtom.chain, residueName: selectedAtom.residueName, residueNumber: selectedAtom.residueNumber }]);
  }

  const keptCount = (inventory?.hetero_groups ?? []).filter((group) => appliedState.heteroChoices[group.group_id] === 'keep').length;
  const excludedCount = (inventory?.hetero_groups ?? []).filter((group) => appliedState.heteroChoices[group.group_id] === 'exclude').length;
  const preparationStatus = receptor?.docking_ready ? 'Ready' : receptor ? 'Required' : 'Not configured';
  const bindingStatus = appliedSearchSpace.status === 'valid' ? 'Defined' : 'Not defined';
  const dockingStatus = confirmed ? 'Configured' : ready ? 'Needs confirmation' : 'Needs configuration';
  const summaryStatus = confirmed ? 'Configured' : receptor ? 'In progress' : 'Not configured';

  return (
    <Stack component="section" aria-label="Docking setup" spacing={1.5} sx={{ width: '100%', minWidth: 0 }}>
      <ModuleConfigurationSummary
        title="Receptor and docking configuration"
        status={summaryStatus}
        items={[
          { label: 'Receptor', value: receptor?.display_name || 'Not selected' },
          { label: 'Preparation', value: preparationStatus },
          { label: 'Binding site', value: bindingStatus },
          { label: 'Docking settings', value: dockingStatus },
        ]}
        actions={<>
          <Button ref={selectButtonRef} size="small" variant="outlined" onClick={() => setActiveDialog('receptor')}>{receptor ? 'Change Receptor' : 'Select Receptor'}</Button>
          <Button ref={prepareButtonRef} size="small" variant="outlined" disabled={!receptor || !inventory} onClick={() => openSetup('preparation')}>{receptor?.docking_ready ? 'Edit Preparation' : 'Prepare Receptor'}</Button>
          <Button ref={bindingButtonRef} size="small" variant="outlined" disabled={!receptor} onClick={() => openSetup('binding')}>Configure Binding Site</Button>
          <Button ref={dockingButtonRef} size="small" variant="outlined" disabled={!receptor} onClick={() => openSetup('docking')}>Configure Docking</Button>
        </>}
      />

      {receptor ? <Paper variant="outlined" sx={{ px: 2, py: 1.25 }}><Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1}>
        <Box sx={{ minWidth: 0 }}><Typography variant="h2">Current receptor</Typography><Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{receptor.display_name} · {receptor.original_filename}</Typography><Typography variant="caption" color="text.secondary">Source: {receptor.receptor_source || receptor.preparation_method || 'Uploaded receptor'} · Receptor ID: {receptor.receptor_id}</Typography></Box>
        <Stack alignItems={{ sm: 'flex-end' }}><Typography variant="body2" fontWeight={700}>{preparationStatus}</Typography><Typography variant="caption" color="text.secondary">{receptor.docking_ready ? `Prepared artifact ${receptor.docking_receptor_sha256?.slice(0, 12) || 'identity unavailable'}…` : 'Source structure loaded'}</Typography>{inventory ? <Typography variant="caption" color="text.secondary">Heterogroups: {keptCount} included · {excludedCount} excluded</Typography> : null}</Stack>
      </Stack></Paper> : <Alert severity="info">No receptor is selected. Receptor selection is available before molecule import; running docking still requires valid molecules.</Alert>}

      <Paper variant="outlined" sx={{ p: 1.5, minWidth: 0 }}>
        <Stack spacing={1}>
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1}>
            <Box><Typography variant="h2">Receptor, ligand, and search-box viewer</Typography><Typography variant="caption" color="text.secondary">The viewer shows only applied receptor and binding-site configuration.</Typography></Box>
            <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap"><Button size="small" variant="outlined" aria-pressed={showBox} onClick={() => setShowBox((current) => !current)}>{showBox ? 'Hide search box' : 'Show search box'}</Button><Button size="small" variant="outlined" disabled={!structure || appliedSearchSpace.status !== 'valid'} onClick={() => viewerRef.current?.focusBox()}>Focus search box</Button><Button size="small" variant="outlined" disabled={!structure} onClick={() => viewerRef.current?.resetView()}>Reset view</Button></Stack>
          </Stack>
          <ReceptorViewer ref={viewerRef} structure={structure} box={appliedState.box} showBox={showBox} selectedResidues={selectedResidues} selectedLigand={selectedLigand} onAtomSelect={(atom) => setSelectedAtom(atomDetails(atom))} onError={(viewerError) => setError(`Interactive receptor viewer unavailable: ${viewerError.message ?? viewerError}`)} />
          <Box sx={{ px: 1.25, py: 1, bgcolor: '#f7f9fb', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}><Typography variant="subtitle2">Selected atom / pocket region</Typography>
            {selectedAtom ? <><Typography variant="body2">Chain {selectedAtom.chain || '–'} · {selectedAtom.residueName || '–'} {selectedAtom.residueNumber || '–'} · {selectedAtom.atomName || '–'} · x {formatCoordinate(selectedAtom.x)} · y {formatCoordinate(selectedAtom.y)} · z {formatCoordinate(selectedAtom.z)}</Typography><Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap"><Button size="small" variant="outlined" onClick={openBindingFromAtom}>Configure box from atom</Button><Button size="small" variant="outlined" onClick={addSelectedResidue}>Add residue</Button><Button size="small" variant="text" onClick={() => setSelectedAtom(null)}>Clear</Button></Stack></> : <Typography variant="caption" color="text.secondary">Click an atom to inspect its authoritative identity and coordinates.</Typography>}
            {selectedResidues.length ? <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ mt: 0.5 }}>{selectedResidues.map((residue) => <Chip size="small" key={residue.key} label={`${residue.chain || '–'} ${residue.residueName} ${residue.residueNumber}`} onDelete={() => setSelectedResidues((current) => current.filter((item) => item.key !== residue.key))} />)}<Button size="small" variant="text" onClick={() => setSelectedResidues([])}>Clear pocket selection</Button></Stack> : null}
          </Box>
        </Stack>
      </Paper>

      <ScientificSetupDialog open={activeDialog === 'receptor'} title={receptor ? 'Change Receptor' : 'Select Receptor'} context="Load an implemented local PDB source structure or associate a prepared PDBQT with the current receptor." dirty={Boolean(selectedFile)} loading={uploading} showApply={false} runDisabled={!selectedFile} applyAndRunLabel="Load Receptor" onCancel={() => { setSelectedFile(null); setActiveDialog(''); }} onApplyAndRun={handleUpload} restoreFocusRef={selectButtonRef}>
        <Stack spacing={1.5}><Button aria-label="Select PDB for visualization" variant="outlined" component="label" startIcon={<UploadFileOutlinedIcon />}>Select PDB<input hidden type="file" accept=".pdb" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} /></Button><Button aria-label="Select prepared PDBQT" variant="outlined" component="label" startIcon={<UploadFileOutlinedIcon />}>Select prepared PDBQT<input hidden type="file" accept=".pdbqt" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} /></Button><Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{selectedFile?.name || 'No receptor file selected.'}</Typography><Alert severity="info">Uploaded PDBQT files are preserved unchanged and validated through the existing fail-closed receptor validator.</Alert></Stack>
      </ScientificSetupDialog>

      <ScientificSetupDialog open={activeDialog === 'preparation'} title="Prepare Receptor" context="Review receptor identity and configure the existing fail-closed preparation workflow. Editing does not run preparation." sections={[{ id: 'identity', label: 'Identity & choices' }, { id: 'heterogroups', label: 'Heterogroups' }]} dirty={setup.dirty} validationErrors={setup.validationErrors} loading={preparing} runDisabled={!receptor || !preparationRuntime?.available} onCancel={cancelSetup} onApply={applyPreparation} onApplyAndRun={applyAndPrepare} restoreFocusRef={prepareButtonRef}>
        <Paper variant="outlined" sx={{ p: 1.5 }}><Typography variant="subtitle2">Receptor identity and provenance</Typography><Typography variant="body2">{receptor ? `${receptor.display_name} · ${receptor.original_filename}` : 'No receptor selected'}</Typography><Typography variant="caption" color="text.secondary">{receptor?.receptor_source || receptor?.preparation_method || 'Source unavailable'} · {receptor?.receptor_id || 'ID unavailable'}</Typography></Paper>
        <Box><Typography variant="subtitle2">Protein chains</Typography><Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">{(inventory?.protein?.chains ?? []).map((item) => <FormControlLabel key={item.chain || '_blank'} sx={{ mr: 0 }} control={<Checkbox size="small" aria-label={`Include protein chain ${item.chain || '(blank)'}`} checked={draftState.selectedChains.includes(item.chain)} onChange={() => toggleDraftChain(item.chain)} />} label={`${item.chain || '(blank)'} · ${item.residue_count} residues`} />)}</Stack><Typography variant="caption">Waters: remove all ({inventory?.waters?.count ?? 0} detected)</Typography></Box>
        <Stack spacing={1}><Stack direction="row" justifyContent="space-between" alignItems="center"><Box><Typography variant="subtitle2">Heterogroups</Typography><Typography variant="caption" color="text.secondary">Identity is authoritative PDB residue metadata. Include/Exclude and pocket use remain separate choices.</Typography></Box><Button size="small" disabled={!(inventory?.hetero_groups ?? []).length} onClick={() => updateDraftReceptor(excludeAllHeteroGroups(draftState, inventory.hetero_groups))}>Exclude all</Button></Stack><HeterogroupTable groups={inventory?.hetero_groups ?? []} choices={draftState.heteroChoices} pocketGroupId={draftState.pocketGroupId} onActionChange={setDraftHeteroAction} onPocketChange={useDraftHeteroForPocket} /></Stack>
        {(inventory?.alternate_locations ?? []).length ? <Stack spacing={0.75}><Typography variant="subtitle2">Alternate locations</Typography>{inventory.alternate_locations.map((item) => <TextField key={item.residue_key} select size="small" label={`Conformer for ${item.residue_key}`} value={draftState.altlocChoices[item.residue_key] ?? ''} onChange={(event) => updateDraftReceptor({ altlocChoices: { ...draftState.altlocChoices, [item.residue_key]: event.target.value } })}><MenuItem value=""><em>Choose explicitly</em></MenuItem>{item.choices.map((choice) => <MenuItem key={choice} value={choice}>{choice}</MenuItem>)}</TextField>)}</Stack> : null}
        <Paper variant="outlined" sx={{ p: 1.5 }}><Typography variant="subtitle2">Applied preparation policy</Typography><Typography variant="caption" display="block">Missing side-chain heavy atoms only; missing backbone or residue blocks stop preparation.</Typography><Typography variant="caption" display="block">Hydrogen optimization and pH-dependent protonation are not performed.</Typography><Typography variant="caption" display="block">Meeko {preparationRuntime?.version ?? 'unavailable'} retains explicit polar/donor hydrogens required by the AutoDock atom representation.</Typography><Typography variant="caption" display="block">Draft included: {summarizeHetero(inventory?.hetero_groups, draftState.heteroChoices, 'keep')}</Typography><Typography variant="caption" display="block">Draft excluded: {summarizeHetero(inventory?.hetero_groups, draftState.heteroChoices, 'exclude')}</Typography></Paper>
      </ScientificSetupDialog>

      <ScientificSetupDialog open={activeDialog === 'binding'} title="Configure Binding Site" context="Configure the applied Vina search box. Draft values are not rendered in the main viewer until Apply." sections={[{ id: 'method', label: 'Pocket method' }, { id: 'box', label: 'Search box' }]} dirty={setup.dirty} validationErrors={setup.validationErrors} onCancel={cancelSetup} onApply={applyBindingSite} restoreFocusRef={bindingButtonRef}>
        <FormControl><FormLabel>How do you want to define the docking pocket?</FormLabel><RadioGroup value={draftState.method} onChange={(event) => updateDraftReceptor({ method: event.target.value })}><FormControlLabel value="reference_ligand" control={<Radio size="small" />} label="Bound reference ligand" disabled={!boundLigands.length} /><FormControlLabel value="manual" control={<Radio size="small" />} label="Manual box coordinates" /></RadioGroup></FormControl>
        {boundLigands.length ? <TextField select size="small" label="Detected bound ligand" value={draftState.selectedLigandId} onChange={(event) => selectDraftLigand(selectedLigandForId(boundLigands, event.target.value))}><MenuItem value=""><em>Select a ligand</em></MenuItem>{boundLigands.map((ligand) => <MenuItem key={ligand.ligand_id} value={ligand.ligand_id}>{ligand.residue_name} {ligand.chain || '–'} {ligand.residue_number}{ligand.insertion_code || ''} ({ligand.atom_count} atoms)</MenuItem>)}</TextField> : <Alert severity="info">No plausible non-water bound ligand was identified.</Alert>}
        <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" alignItems="center"><TextField size="small" label="Fit padding (Å)" type="number" value={draft.padding} onChange={(event) => dispatchSetup({ type: 'change', patch: { padding: event.target.value } })} inputProps={{ min: 0, step: 0.5 }} sx={{ width: 150 }} /><Button size="small" variant="outlined" disabled={!draftLigand} onClick={() => { const viewer = viewerRef.current; fitDraftSelection(viewer && draftLigand ? viewer.selectedAtoms({ chain: draftLigand.chain, resi: draftLigand.residue_number, resn: draftLigand.residue_name }) : []); }}>Fit ligand + padding</Button><Button size="small" variant="outlined" disabled={!selectedRegionAtoms.length} onClick={() => { updateDraftReceptor({ method: 'selected_region' }); fitDraftSelection(selectedRegionAtoms); }}>Fit selected region</Button></Stack>
        {boundLigands.length ? <Box><Typography variant="subtitle2">Ligand copies removed before repair</Typography>{draftLigand ? <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap"><Button size="small" variant="outlined" onClick={() => updateDraftReceptor({ ligandRemovalIds: [draftLigand.ligand_id] })}>Selected copy only</Button><Button size="small" variant="outlined" onClick={() => updateDraftReceptor({ ligandRemovalIds: matchingDraftLigands.map((ligand) => ligand.ligand_id) })}>All {matchingDraftLigands.length} matching copies</Button></Stack> : null}<Stack direction="row" useFlexGap flexWrap="wrap">{boundLigands.map((ligand) => <FormControlLabel key={ligand.ligand_id} sx={{ mr: 1 }} control={<Checkbox size="small" checked={draftState.ligandRemovalIds.includes(ligand.ligand_id)} onChange={(event) => updateDraftReceptor({ ligandRemovalIds: event.target.checked ? [...new Set([...draftState.ligandRemovalIds, ligand.ligand_id])] : draftState.ligandRemovalIds.filter((id) => id !== ligand.ligand_id) })} />} label={ligand.ligand_id} />)}</Stack></Box> : null}
        <NumericGrid title="Center (Å)" values={draftState.box} setValues={updateDraftBox} fields={[["centerX", "Center X"], ["centerY", "Center Y"], ["centerZ", "Center Z"]]} /><NumericGrid title="Box size (Å)" values={draftState.box} setValues={updateDraftBox} fields={[["sizeX", "Size X"], ["sizeY", "Size Y"], ["sizeZ", "Size Z"]]} />
        <Box aria-live="polite" sx={{ p: 1.25, bgcolor: '#f7f9fb', borderRadius: 1 }}>{draftSearchSpace.status === 'valid' ? <><Typography variant="body2">Draft preview · {draftSearchSpace.center}</Typography><Typography variant="body2">{draftSearchSpace.size}</Typography><Typography variant="caption" color="text.secondary">Apply to update the main viewer.</Typography></> : <Typography variant="body2" color={draftSearchSpace.status === 'incomplete' ? 'text.secondary' : 'warning.main'}>{draftSearchSpace.message}</Typography>}</Box>
      </ScientificSetupDialog>

      <ScientificSetupDialog open={activeDialog === 'docking'} title="Configure Docking" context="Review the implemented Vina execution settings. Apply saves a backend configuration without running docking; Apply & Run starts the existing calculation when molecules are available." sections={[{ id: 'protocol', label: 'Vina protocol' }]} dirty={setup.dirty} validationErrors={setup.validationErrors} loading={configuring || runLoading} runDisabled={runDisabled || !ready} onCancel={cancelSetup} onApply={() => applyDockingSettings(false)} onApplyAndRun={() => applyDockingSettings(true)} restoreFocusRef={dockingButtonRef}>
        <Paper variant="outlined" sx={{ p: 1.5 }}><Typography variant="subtitle2">Applied receptor and binding site</Typography><Typography variant="body2">{receptor?.display_name || 'No receptor'} · {receptor?.docking_ready ? 'Prepared PDBQT ready' : 'Preparation required'}</Typography><Typography variant="caption" color="text.secondary">{appliedSearchSpace.status === 'valid' ? `${appliedSearchSpace.center} · ${appliedSearchSpace.size}` : appliedSearchSpace.message}</Typography></Paper>
        <NumericGrid values={draft.advanced} setValues={updateDraftAdvanced} fields={[["exhaustiveness", "Exhaustiveness"], ["workerCount", "Workers"], ["numModes", "Number of modes"], ["energyRange", "Energy range (kcal/mol)"], ["seed", "Random seed"]]} />
        <Alert severity="info">These are the currently implemented MolOptima Vina settings. Applying them does not alter receptor preparation or search-box coordinates.</Alert>
      </ScientificSetupDialog>

      {confirmed ? <Alert severity="success">Docking configuration saved: {confirmed.configuration_id}</Alert> : null}
      {receptor?.preparation_status === 'valid' && receptor.receptor_source === 'moloptima_prepared' ? <Alert severity="success">Prepared receptor ready · PDBQT saved · SHA-256 {receptor.docking_receptor_sha256?.slice(0, 12)}… · Meeko {receptor.preparation_details?.meeko_version}.</Alert> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
    </Stack>
  );
}

function NumericGrid({ title = '', values, setValues, fields, compact = false }) {
  return <Stack spacing={0.6}>{title ? <Typography variant="caption" sx={{ fontWeight: 700 }}>{title}</Typography> : null}<Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: `repeat(${Math.min(fields.length, compact ? 5 : 3)}, minmax(0, 1fr))` }, gap: 0.75 }}>
    {fields.map(([key, label]) => <TextField size={compact ? 'small' : 'medium'} key={key} label={label} type="number" value={values[key]} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} inputProps={{ step: 'any' }} />)}
  </Box></Stack>;
}

function numericOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const numeric = Number(value); return Number.isFinite(numeric) ? numeric : null;
}
function formatCoordinate(value) { return Number(value).toFixed(3).replace(/\.000$/, ''); }
function formatBoxInput(value) { return Number(value).toFixed(4).replace(/0+$/, '').replace(/\.$/, ''); }
export function summarizeHetero(groups = [], choices = {}, action) {
  const selected = groups.filter((group) => choices[group.group_id] === action);
  return selected.length
    ? selected.map((group) => `${group.residue_name} ${group.chain || '–'} ${group.residue_number}${group.insertion_code || ''}`).join(', ')
    : 'none';
}
async function decodeResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || `Request failed (${response.status}).`);
  return payload;
}
