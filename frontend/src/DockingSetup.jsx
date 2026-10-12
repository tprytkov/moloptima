import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, FormControl, FormControlLabel, FormLabel, MenuItem,
  Radio, RadioGroup, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import ReceptorViewer from './ReceptorViewer.jsx';

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

export default function DockingSetup({ apiBaseUrl, onConfirmed }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [receptor, setReceptor] = useState(null);
  const [structure, setStructure] = useState(null);
  const [padding, setPadding] = useState('4');
  const [advanced, setAdvanced] = useState(DEFAULT_VINA_SETTINGS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preparationRuntime, setPreparationRuntime] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const [showBox, setShowBox] = useState(true);
  const [receptorState, setReceptorState] = useState(() => createReceptorScopedState());
  const {
    method, selectedAtom, selectedResidues, selectedLigandId, box, confirmed,
    selectedChains, heteroChoices, altlocChoices, pocketGroupId, ligandRemovalIds,
  } = receptorState;
  const setReceptorField = (field, value) => setReceptorState((current) => ({
    ...current,
    [field]: typeof value === 'function' ? value(current[field]) : value,
  }));
  const setMethod = (value) => setReceptorField('method', value);
  const setSelectedAtom = (value) => setReceptorField('selectedAtom', value);
  const setSelectedResidues = (value) => setReceptorField('selectedResidues', value);
  const setSelectedLigandId = (value) => setReceptorField('selectedLigandId', value);
  const setBox = (value) => setReceptorField('box', value);
  const setConfirmed = (value) => setReceptorField('confirmed', value);
  const setSelectedChains = (value) => setReceptorField('selectedChains', value);
  const setAltlocChoices = (value) => setReceptorField('altlocChoices', value);
  const setPocketGroupId = (value) => setReceptorField('pocketGroupId', value);
  const setLigandRemovalIds = (value) => setReceptorField('ligandRemovalIds', value);
  const viewerRef = useRef(null);
  const receptorRef = useRef(null);
  const requestGuardRef = useRef(null);
  if (!requestGuardRef.current) requestGuardRef.current = createLatestRequestGuard();

  useEffect(() => {
    let active = true;
    fetchReceptorPreparationRuntime(apiBaseUrl)
      .then((status) => { if (active) setPreparationRuntime(status); })
      .catch((runtimeError) => { if (active) setPreparationRuntime({ available: false, status: 'unavailable', reason: runtimeError.message }); });
    return () => { active = false; };
  }, [apiBaseUrl]);

  useEffect(() => () => requestGuardRef.current?.invalidate(), []);

  function commitLoadedReceptor(metadata, nextStructure) {
    const previousReceptor = receptorRef.current;
    setReceptorState((current) => transitionReceptorScopedState(current, previousReceptor, metadata));
    receptorRef.current = metadata;
    setReceptor(metadata);
    setStructure(nextStructure);
  }

  async function handleUpload() {
    if (!selectedFile) return;
    const request = requestGuardRef.current.start();
    const file = selectedFile;
    setPreparing(false); setLoading(true); setError('');
    try {
      const associationId = receptorRef.current && file.name.toLowerCase().endsWith('.pdbqt')
        ? receptorRef.current.receptor_id : '';
      const metadata = await uploadDockingReceptor(apiBaseUrl, file, associationId, request.signal);
      if (!request.isCurrent()) return;
      const nextStructure = await fetchReceptorStructure(apiBaseUrl, metadata, request.signal);
      if (!request.isCurrent()) return;
      commitLoadedReceptor(metadata, nextStructure);
      setSelectedFile(null);
    } catch (uploadError) {
      if (request.isCurrent() && uploadError.name !== 'AbortError') setError(uploadError.message ?? String(uploadError));
    } finally { if (request.isCurrent()) setLoading(false); }
  }

  const boundLigands = receptor?.bound_ligands ?? [];
  const inventory = receptor?.structure_inventory ?? null;
  const selectedLigand = selectedLigandForId(boundLigands, selectedLigandId);
  const matchingLigands = selectedLigand
    ? boundLigands.filter((ligand) => ligand.residue_name === selectedLigand.residue_name && ligand.residue_number === selectedLigand.residue_number)
    : [];
  const selectedRegionAtoms = useMemo(() => {
    const viewer = viewerRef.current;
    if (!viewer) return [];
    return selectedResidues.flatMap((residue) => viewer.selectedAtoms({ chain: residue.chain, resi: residue.residueNumber, resn: residue.residueName }));
  }, [selectedResidues]);
  const readiness = dockingReadiness(receptor, box);
  const searchSpace = searchSpacePresentation(box);
  const ready = Object.values(readiness).every(Boolean);
  const preparationReady = preparationSelectionReady(inventory, selectedChains, heteroChoices, altlocChoices)
    && searchSpace.status === 'valid'
    && ['reference_ligand', 'manual'].includes(method)
    && (method !== 'reference_ligand' || (pocketGroupId && ligandRemovalIds.includes(pocketGroupId)));

  function setCenter(coordinates) {
    if (!coordinates) return;
    setBox((current) => ({ ...current, centerX: formatCoordinate(coordinates.x), centerY: formatCoordinate(coordinates.y), centerZ: formatCoordinate(coordinates.z) }));
  }

  function addSelectedResidue() {
    if (!selectedAtom) return;
    const key = `${selectedAtom.chain}:${selectedAtom.residueName}:${selectedAtom.residueNumber}`;
    setSelectedResidues((current) => current.some((item) => item.key === key) ? current
      : [...current, { key, chain: selectedAtom.chain, residueName: selectedAtom.residueName, residueNumber: selectedAtom.residueNumber }]);
  }

  function selectLigand(ligand) {
    setSelectedLigandId(ligand.ligand_id);
    setPocketGroupId(ligand.ligand_id);
    setLigandRemovalIds((current) => current.includes(ligand.ligand_id) ? current : [...current, ligand.ligand_id]);
    const defaults = ligand.default_box;
    setBox(defaults ? {
      centerX: formatBoxInput(defaults.center_x), centerY: formatBoxInput(defaults.center_y), centerZ: formatBoxInput(defaults.center_z),
      sizeX: formatBoxInput(defaults.size_x), sizeY: formatBoxInput(defaults.size_y), sizeZ: formatBoxInput(defaults.size_z),
    } : (current) => ({ ...current, ...ligandCentroid(ligand) }));
  }

  function fitSelection(atoms) {
    const fitted = fitBoxToAtoms(atoms, padding);
    if (!fitted) { setError('A valid atom selection and non-negative padding are required to fit the docking box.'); return; }
    setBox(fitted); setError('');
  }

  function ligandAtoms() {
    const viewer = viewerRef.current;
    if (!viewer || !selectedLigand) return [];
    return viewer.selectedAtoms({ chain: selectedLigand.chain, resi: selectedLigand.residue_number, resn: selectedLigand.residue_name });
  }

  function toggleChain(chain) {
    setSelectedChains((current) => current.includes(chain)
      ? current.filter((item) => item !== chain) : [...current, chain]);
  }

  function useHeteroForPocket(group, checked) {
    if (!checked) { setPocketGroupId((current) => current === group.group_id ? '' : current); return; }
    setPocketGroupId(group.group_id);
    setMethod('selected_region');
    setCenter({ x: group.centroid.center_x, y: group.centroid.center_y, z: group.centroid.center_z });
    const ligand = boundLigands.find((item) => item.ligand_id === group.group_id);
    setSelectedLigandId(ligand?.ligand_id ?? '');
  }

  function setHeteroAction(groupId, action) {
    setReceptorState((current) => updateHeteroChoice(current, groupId, action));
  }

  async function handlePrepare() {
    if (!receptor || !preparationReady || !preparationRuntime?.available) return;
    const request = requestGuardRef.current.start();
    setLoading(false); setPreparing(true); setError('');
    try {
      const metadata = await prepareDockingReceptor(
        apiBaseUrl,
        receptor.receptor_id,
        preparationPayload(selectedChains, heteroChoices, altlocChoices, pocketGroupId, method, ligandRemovalIds, box, padding),
        request.signal,
      );
      if (!request.isCurrent()) return;
      const nextStructure = await fetchReceptorStructure(apiBaseUrl, metadata, request.signal);
      if (!request.isCurrent()) return;
      commitLoadedReceptor(metadata, nextStructure);
    } catch (preparationError) {
      if (request.isCurrent() && preparationError.name !== 'AbortError') setError(preparationError.message ?? String(preparationError));
    } finally { if (request.isCurrent()) setPreparing(false); }
  }

  async function handleConfirm() {
    if (!ready) { setError('Docking setup is not ready. A prepared PDBQT, finite center, and positive box dimensions are required.'); return; }
    setLoading(true); setError('');
    try {
      const configuration = await submitDockingConfiguration(apiBaseUrl, configurationPayload(receptor.receptor_id, method, selectedLigandId, box, { ...advanced, padding }));
      setConfirmed(configuration); onConfirmed?.({ receptor, configuration });
    } catch (configurationError) { setError(configurationError.message ?? String(configurationError)); }
    finally { setLoading(false); }
  }

  return (
    <Box component="section" aria-label="Docking setup" sx={{ width: '100%', border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper', overflow: 'hidden' }}>
      <Box sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', gap: 1, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h2">Receptor workspace</Typography>
          <Typography variant="caption" color="text.secondary">
            {receptor ? `${receptor.display_name} · ${receptor.original_filename}` : 'Load a receptor structure to begin'}
          </Typography>
        </Box>
        <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
          <Button size="small" aria-label="Select PDB for visualization" variant="outlined" component="label" startIcon={<UploadFileOutlinedIcon />}>Select PDB<input hidden type="file" accept=".pdb" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} /></Button>
          <Typography variant="caption" sx={{ maxWidth: 220, overflowWrap: 'anywhere' }}>{selectedFile?.name ?? 'No receptor selected'}</Typography>
          <Button size="small" variant="contained" disabled={!selectedFile || loading} onClick={handleUpload}>{loading ? 'Processing' : 'Upload receptor'}</Button>
        </Stack>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(320px, .72fr) minmax(0, 1.45fr)' }, minHeight: 540 }}>
        <Box sx={{ p: 1.25, borderRight: { md: '1px solid' }, borderBottom: { xs: '1px solid', md: 0 }, borderColor: 'divider', maxHeight: { md: 650 }, overflowY: { md: 'auto' } }}>
          <Stack spacing={1.25}>
            <Box sx={{ p: 1.25, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              <Stack spacing={1}>
                <Stack direction="row" justifyContent="space-between" gap={1} alignItems="baseline">
                  <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>Receptor setup</Typography>
                  <Typography variant="caption" color={receptor?.docking_ready ? 'success.dark' : 'text.secondary'}>
                    {receptor?.docking_ready ? 'PDBQT ready' : 'Preparation required'}
                  </Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  Receptor preparation runtime: {preparationRuntime?.available ? `PDBFixer/OpenMM + Meeko ${preparationRuntime.version} available` : (preparationRuntime?.reason || 'checking availability')}.
                </Typography>
                <Box component="details"><Typography component="summary" variant="caption" sx={{ cursor: 'pointer', fontWeight: 700 }}>Receptor Preparation policy</Typography><Stack spacing={0.5} sx={{ mt: 0.75 }}>
                  <Typography variant="caption" color="text.secondary">Hydrogen optimization and pH-dependent protonation are not performed. Missing residues and terminal completion remain fail-closed.</Typography>
                  <Typography variant="caption" color="text.secondary">MolOptima uses Meeko to prepare the AutoDock/Vina receptor representation. The final PDBQT retains the explicit polar/donor hydrogens required by the AutoDock atom representation; nonpolar hydrogens are not retained as independent docking atoms.</Typography>
                </Stack></Box>
                {inventory ? <>
                  <Box><Typography variant="caption" sx={{ fontWeight: 700 }}>Protein chains</Typography><Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                    {(inventory.protein?.chains ?? []).map((item) => <FormControlLabel key={item.chain || '_blank'} sx={{ mr: 0 }} control={<Checkbox size="small" checked={selectedChains.includes(item.chain)} onChange={() => toggleChain(item.chain)} />} label={`${item.chain || '(blank)'} · ${item.residue_count}`} />)}
                  </Stack></Box>
                  <Typography variant="caption">Waters: remove all ({inventory.waters?.count ?? 0} detected)</Typography>
                  <Box component="details">
                    <Typography component="summary" variant="subtitle2" sx={{ cursor: 'pointer' }}>Preparation choices and provenance</Typography>
                    <Stack spacing={1} sx={{ mt: 1 }}>
                      <Typography variant="caption" color="text.secondary">How do you want MolOptima to prepare the receptor? New heterogroups default to Exclude; pocket use remains a separate choice.</Typography>
                      <Stack direction="row" alignItems="center" justifyContent="space-between"><Typography variant="subtitle2">Hetero groups</Typography><Button size="small" variant="text" disabled={!(inventory.hetero_groups ?? []).length} onClick={() => setReceptorState((current) => excludeAllHeteroGroups(current, inventory.hetero_groups))}>Exclude all</Button></Stack>
                      <Box sx={{ maxWidth: '100%', overflowX: 'auto' }}>
                        {(inventory.hetero_groups ?? []).length ? <Table size="small" aria-label="Receptor hetero groups" sx={{ minWidth: 620 }}><TableHead><TableRow><TableCell>Receptor action</TableCell><TableCell>Use for pocket</TableCell><TableCell>Type</TableCell><TableCell>Residue</TableCell><TableCell>Chain</TableCell><TableCell>Number</TableCell><TableCell align="right">Atoms</TableCell></TableRow></TableHead><TableBody>
                          {inventory.hetero_groups.map((group) => <TableRow key={group.group_id}><TableCell><TextField select size="small" aria-label={`Receptor action ${group.group_id}`} value={heteroChoices[group.group_id] ?? 'exclude'} onChange={(event) => setHeteroAction(group.group_id, event.target.value)} sx={{ minWidth: 105 }}><MenuItem value="keep">Keep</MenuItem><MenuItem value="exclude">Exclude</MenuItem></TextField></TableCell><TableCell><Checkbox size="small" aria-label={`Use ${group.group_id} for pocket definition`} checked={pocketGroupId === group.group_id} onChange={(event) => useHeteroForPocket(group, event.target.checked)} /></TableCell><TableCell>{group.type.replace('_', ' ')}</TableCell><TableCell>{group.residue_name}</TableCell><TableCell>{group.chain || '–'}</TableCell><TableCell>{group.residue_number}{group.insertion_code}</TableCell><TableCell align="right">{group.atom_count}</TableCell></TableRow>)}
                        </TableBody></Table> : <Typography variant="caption" color="text.secondary">No non-water hetero groups detected.</Typography>}
                      </Box>
                      {(inventory.alternate_locations ?? []).length ? <Stack spacing={0.75}><Typography variant="subtitle2">Alternate locations</Typography>{inventory.alternate_locations.map((item) => <TextField key={item.residue_key} select size="small" label={`Conformer for ${item.residue_key}`} value={altlocChoices[item.residue_key] ?? ''} onChange={(event) => setAltlocChoices((current) => ({ ...current, [item.residue_key]: event.target.value }))}><MenuItem value=""><em>Choose explicitly</em></MenuItem>{item.choices.map((choice) => <MenuItem key={choice} value={choice}>{choice}</MenuItem>)}</TextField>)}</Stack> : null}
                      <Box sx={{ bgcolor: '#f7f9fb', p: 1 }}><Typography variant="subtitle2">Preparation Summary</Typography>
                        <Typography variant="caption" display="block">Input: {receptor.original_filename}</Typography>
                        <Typography variant="caption" display="block">Protein chains: {selectedChains.length ? selectedChains.map((chain) => chain || '(blank)').join(', ') : 'none selected'}</Typography>
                        <Typography variant="caption" display="block">Waters: remove {inventory.waters?.count ?? 0}</Typography>
                        <Typography variant="caption" display="block">Retained hetero groups: {summarizeHetero(inventory.hetero_groups, heteroChoices, 'keep')}</Typography>
                        <Typography variant="caption" display="block">Excluded hetero groups: {summarizeHetero(inventory.hetero_groups, heteroChoices, 'exclude')}</Typography>
                        <Typography variant="caption" display="block">Pocket-definition group: {pocketGroupId || 'none selected'}</Typography>
                        <Typography variant="caption" display="block">Ligand copies removed before repair: {ligandRemovalIds.length ? ligandRemovalIds.join(', ') : 'none'}</Typography>
                        <Typography variant="caption" display="block">Repair policy: missing side-chain heavy atoms only; stop on missing backbone or residue blocks</Typography>
                        <Typography variant="caption" display="block">Hydrogen handling: Meeko/RDKit residue-template completion; no Reduce2 optimization or resolved pH policy</Typography>
                        <Typography variant="caption" display="block">Receptor preparation: Meeko {preparationRuntime?.version ?? 'unavailable'}</Typography>
                      </Box>
                    </Stack>
                  </Box>
                  <Button size="small" variant="contained" disabled={!preparationRuntime?.available || !preparationReady || preparing} onClick={handlePrepare}>{preparing ? 'Preparing receptor…' : 'Prepare Receptor'}</Button>
                  {!preparationReady ? <Typography variant="caption" color="warning.main">Select at least one protein chain and complete every hetero/alternate-location choice.</Typography> : null}
                  {receptor.preparation_status === 'valid' && receptor.receptor_source === 'moloptima_prepared' ? <Alert severity="success" sx={{ py: 0 }}>
                    Prepared receptor ready · PDBQT saved · SHA-256 {receptor.docking_receptor_sha256?.slice(0, 12)}… · Meeko {receptor.preparation_details?.meeko_version}. Repair PASS: {receptor.preparation_details?.repair_audit?.added_atom_count ?? 0} heavy atoms added across {receptor.preparation_details?.repair_validation?.repaired_residue_count ?? 0} residues; max displacement {Number(receptor.preparation_details?.repair_validation?.coordinate_preservation?.maximum_displacement_A ?? 0).toFixed(3)} Å; severe clashes {receptor.preparation_details?.repair_validation?.severe_clash_count ?? 0}.
                  </Alert> : null}
                </> : <Typography variant="caption" color="text.secondary">Upload a PDB to inspect chains, waters, hetero groups, and alternate locations.</Typography>}
                <Box component="details"><Typography component="summary" variant="caption" sx={{ cursor: 'pointer', fontWeight: 700 }}>Advanced / reproducibility: prepared PDBQT</Typography><Stack sx={{ mt: 1 }} spacing={0.75}>
                  <Typography variant="caption" color="text.secondary">The uploaded PDBQT is preserved unchanged and validated through the same fail-closed receptor validator.</Typography>
                  <Button size="small" aria-label="Select prepared PDBQT" variant="outlined" component="label" startIcon={<UploadFileOutlinedIcon />}>Select prepared PDBQT<input hidden type="file" accept=".pdbqt" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} /></Button>
                </Stack></Box>
              </Stack>
            </Box>

            <Box sx={{ p: 1.25, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              <Stack spacing={1}>
                <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>Pocket definition</Typography>
                <FormControl><FormLabel>How do you want to define the docking pocket?</FormLabel><RadioGroup value={method} onChange={(event) => setMethod(event.target.value)}>
                  <FormControlLabel value="reference_ligand" control={<Radio size="small" />} label="Bound reference ligand" disabled={!boundLigands.length} />
                  <FormControlLabel value="manual" control={<Radio size="small" />} label="Manual box coordinates" />
                </RadioGroup></FormControl>
                {boundLigands.length ? <TextField select size="small" label="Detected bound ligand" value={selectedLigandId} onChange={(event) => {
                  const ligand = selectedLigandForId(boundLigands, event.target.value);
                  if (!ligand) { setSelectedLigandId(''); return; }
                  setMethod('reference_ligand'); selectLigand(ligand);
                }}><MenuItem value=""><em>Select a ligand</em></MenuItem>{boundLigands.map((ligand) => <MenuItem key={ligand.ligand_id} value={ligand.ligand_id}>{ligand.residue_name} {ligand.chain || '–'} {ligand.residue_number} ({ligand.atom_count} atoms)</MenuItem>)}</TextField>
                  : <Alert severity="info" sx={{ py: 0 }}>No plausible non-water bound ligand was identified.</Alert>}
                <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
                  <TextField size="small" label="Fit padding (Å)" type="number" value={padding} onChange={(event) => setPadding(event.target.value)} inputProps={{ min: 0, step: 0.5 }} sx={{ width: 130 }} />
                  <Button size="small" variant="outlined" disabled={!selectedLigand} onClick={() => fitSelection(ligandAtoms())}>Fit ligand + padding</Button>
                  <Button size="small" variant="text" disabled={!selectedLigand} onClick={() => { selectLigand(selectedLigand); setPadding('4'); }}>Reset 4 Å</Button>
                </Stack>
                {boundLigands.length ? <Box><Typography variant="caption" sx={{ fontWeight: 700 }}>Ligand copies removed before repair</Typography>
                  {selectedLigand ? <Stack direction="row" spacing={0.5} sx={{ my: 0.5 }} useFlexGap flexWrap="wrap"><Button size="small" variant="outlined" onClick={() => setLigandRemovalIds([selectedLigand.ligand_id])}>Selected copy only</Button><Button size="small" variant="outlined" onClick={() => setLigandRemovalIds(matchingLigands.map((ligand) => ligand.ligand_id))}>All {matchingLigands.length} matching copies</Button></Stack> : null}
                  <Stack direction="row" useFlexGap flexWrap="wrap">{boundLigands.map((ligand) => <FormControlLabel key={ligand.ligand_id} sx={{ mr: 1 }} control={<Checkbox size="small" checked={ligandRemovalIds.includes(ligand.ligand_id)} onChange={(event) => setLigandRemovalIds((current) => event.target.checked ? [...new Set([...current, ligand.ligand_id])] : current.filter((id) => id !== ligand.ligand_id))} />} label={ligand.ligand_id} />)}</Stack></Box> : null}
                <Typography variant="subtitle2">Vina Search Box</Typography>
                <NumericGrid title="Center (Å)" compact values={box} setValues={setBox} fields={[["centerX", "Center X"], ["centerY", "Center Y"], ["centerZ", "Center Z"]]} />
                <NumericGrid title="Box size (Å)" compact values={box} setValues={setBox} fields={[["sizeX", "Size X"], ["sizeY", "Size Y"], ["sizeZ", "Size Z"]]} />
                <Typography variant="caption" color="text.secondary">The translucent box updates immediately when center or dimensions change.</Typography>
                <Box aria-live="polite" sx={{ p: 1, bgcolor: '#f7f9fb', borderRadius: 1 }}>
                  {searchSpace.status === 'valid' ? <><Typography variant="caption" display="block">{searchSpace.center}</Typography><Typography variant="caption" display="block">{searchSpace.size}</Typography>{!showBox ? <Typography variant="caption" color="text.secondary">Search box hidden in viewer.</Typography> : null}</> : <Typography variant="caption" color={searchSpace.status === 'incomplete' ? 'text.secondary' : 'warning.main'}>{searchSpace.message} The numeric inputs remain editable.</Typography>}
                </Box>
                <Box component="details"><Typography component="summary" variant="caption" sx={{ cursor: 'pointer', fontWeight: 700 }}>Atom / residue pocket tools</Typography><Stack spacing={0.75} sx={{ mt: 0.75 }}>
                  <Button size="small" variant="outlined" disabled={!selectedRegionAtoms.length} onClick={() => { setMethod('selected_region'); setCenter(centroidForAtoms(selectedRegionAtoms)); }}>Use region centroid</Button>
                  <Button size="small" variant="outlined" disabled={!selectedRegionAtoms.length} onClick={() => fitSelection(selectedRegionAtoms)}>Fit box to region + padding</Button>
                </Stack></Box>
              </Stack>
            </Box>
          </Stack>
        </Box>

        <Box sx={{ p: 1.25, minWidth: 0 }}>
          <Stack spacing={1}>
            <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
              <Button size="small" variant="outlined" aria-pressed={showBox} onClick={() => setShowBox((current) => !current)}>{showBox ? 'Hide search box' : 'Show search box'}</Button>
              <Button size="small" variant="outlined" disabled={!structure || searchSpace.status !== 'valid'} onClick={() => viewerRef.current?.focusBox()}>Focus search box</Button>
              <Button size="small" variant="outlined" disabled={!structure} onClick={() => viewerRef.current?.resetView()}>Reset view</Button>
            </Stack>
            <ReceptorViewer ref={viewerRef} structure={structure} box={box} showBox={showBox} selectedResidues={selectedResidues} selectedLigand={selectedLigand} onAtomSelect={(atom) => setSelectedAtom(atomDetails(atom))} onError={(viewerError) => setError(`Interactive receptor viewer unavailable: ${viewerError.message ?? viewerError}`)} />
            <Box sx={{ px: 1.25, py: 1, bgcolor: '#f7f9fb', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              <Stack spacing={0.5}><Typography variant="subtitle2">Selected atom / pocket region</Typography>
                {selectedAtom ? <><Typography variant="body2">Chain {selectedAtom.chain || '–'} · {selectedAtom.residueName || '–'} {selectedAtom.residueNumber || '–'} · {selectedAtom.atomName || '–'} · x {formatCoordinate(selectedAtom.x)} · y {formatCoordinate(selectedAtom.y)} · z {formatCoordinate(selectedAtom.z)}</Typography><Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap"><Button size="small" variant="outlined" onClick={() => { setMethod('selected_atom'); setCenter(selectedAtom); }}>Set box center here</Button><Button size="small" variant="outlined" onClick={addSelectedResidue}>Add residue</Button><Button size="small" variant="text" onClick={() => setSelectedAtom(null)}>Clear</Button></Stack></> : <Typography variant="caption" color="text.secondary">Click an atom in the receptor viewer to inspect identity and coordinates.</Typography>}
                {selectedResidues.length ? <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">{selectedResidues.map((residue) => <Chip size="small" key={residue.key} label={`${residue.chain || '–'} ${residue.residueName} ${residue.residueNumber}`} onDelete={() => setSelectedResidues((current) => current.filter((item) => item.key !== residue.key))} />)}<Button size="small" variant="text" onClick={() => setSelectedResidues([])}>Clear pocket selection</Button></Stack> : null}
              </Stack>
            </Box>
          </Stack>
        </Box>
      </Box>

      <Box sx={{ px: 1.5, py: 1, borderTop: '1px solid', borderColor: 'divider', display: 'flex', gap: 1, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" alignItems="center">
          <Typography variant="subtitle2">Docking setup</Typography>
          {Object.entries({ 'Protein visualization': readiness.receptorLoaded, 'Prepared PDBQT': readiness.preparedReceptor, 'Box center': readiness.centerDefined, 'Box size': readiness.positiveDimensions }).map(([label, value]) => <Chip size="small" key={label} label={`${label}: ${value ? 'ready' : 'required'}`} color={value ? 'success' : 'warning'} variant="outlined" />)}
          <Chip size="small" label={`Detected ligands: ${boundLigands.length}`} variant="outlined" />
        </Stack>
        <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
          <Box component="details"><Typography component="summary" variant="caption" sx={{ cursor: 'pointer', fontWeight: 700 }}>Advanced Vina settings</Typography><Box sx={{ mt: 1, minWidth: { sm: 560 } }}><NumericGrid compact values={advanced} setValues={setAdvanced} fields={[["exhaustiveness", "Exhaustiveness"], ["workerCount", "Workers"], ["numModes", "Number of modes"], ["energyRange", "Energy range (kcal/mol)"], ["seed", "Random seed"]]} /></Box></Box>
          <Button size="small" variant="contained" disabled={loading || !ready} onClick={handleConfirm}>Confirm Docking Setup</Button>
        </Stack>
      </Box>
      {confirmed ? <Alert severity="success" sx={{ borderRadius: 0 }}>Docking configuration saved: {confirmed.configuration_id}</Alert> : null}
      {error ? <Alert severity="error" sx={{ borderRadius: 0 }}>{error}</Alert> : null}
    </Box>
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
