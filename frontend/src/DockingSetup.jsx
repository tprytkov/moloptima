import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, FormControl, FormControlLabel, FormLabel, MenuItem,
  Radio, RadioGroup, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';

export const DEFAULT_VINA_SETTINGS = Object.freeze({
  exhaustiveness: '8', numModes: '9', energyRange: '', seed: '2025', workerCount: '4',
});
const EMPTY_BOX = Object.freeze({ centerX: '', centerY: '', centerZ: '', sizeX: '', sizeY: '', sizeZ: '' });

export async function uploadDockingReceptor(apiBaseUrl, file, receptorId = '') {
  const formData = new FormData();
  formData.append('file', file);
  const query = new URLSearchParams();
  if (receptorId) query.set('receptor_id', receptorId);
  return decodeResponse(await fetch(`${apiBaseUrl}/api/docking/receptors?${query}`, { method: 'POST', body: formData }));
}

export async function submitDockingConfiguration(apiBaseUrl, payload) {
  return decodeResponse(await fetch(`${apiBaseUrl}/api/docking/configurations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }));
}

export async function fetchReceptorPreparationRuntime(apiBaseUrl) {
  return decodeResponse(await fetch(`${apiBaseUrl}/api/docking/receptor-preparation/runtime`));
}

export async function prepareDockingReceptor(apiBaseUrl, receptorId, payload) {
  return decodeResponse(await fetch(`${apiBaseUrl}/api/docking/receptors/${receptorId}/prepare`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }));
}

export function preparationPayload(selectedChains, heteroChoices, altlocChoices, pocketGroupId = '') {
  return {
    selected_chains: selectedChains,
    water_policy: 'remove_all',
    hetero_choices: Object.fromEntries(Object.entries(heteroChoices).map(([key, value]) => [key, value === 'keep'])),
    altloc_choices: altlocChoices,
    bound_ligand_id: pocketGroupId,
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

export function configurationPayload(receptorId, method, selectedLigandId, box, advanced) {
  const energyRange = numericOrNull(advanced.energyRange);
  const centerMethod = ['selected_atom', 'selected_region'].includes(method) ? 'atom_or_residue' : method;
  return {
    receptor_id: receptorId, center_method: centerMethod,
    selected_ligand_id: method === 'bound_ligand' ? selectedLigandId : '',
    center_x: numericOrNull(box.centerX), center_y: numericOrNull(box.centerY), center_z: numericOrNull(box.centerZ),
    size_x: numericOrNull(box.sizeX), size_y: numericOrNull(box.sizeY), size_z: numericOrNull(box.sizeZ),
    exhaustiveness: numericOrNull(advanced.exhaustiveness), num_modes: numericOrNull(advanced.numModes),
    ...(energyRange === null ? {} : { energy_range: energyRange }),
    seed: numericOrNull(advanced.seed), worker_count: numericOrNull(advanced.workerCount),
  };
}

export default function DockingSetup({ apiBaseUrl, onConfirmed }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [receptor, setReceptor] = useState(null);
  const [structure, setStructure] = useState(null);
  const [method, setMethod] = useState('manual');
  const [selectedAtom, setSelectedAtom] = useState(null);
  const [selectedResidues, setSelectedResidues] = useState([]);
  const [selectedLigandId, setSelectedLigandId] = useState('');
  const [padding, setPadding] = useState('4');
  const [box, setBox] = useState(EMPTY_BOX);
  const [advanced, setAdvanced] = useState(DEFAULT_VINA_SETTINGS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(null);
  const [preparationRuntime, setPreparationRuntime] = useState(null);
  const [selectedChains, setSelectedChains] = useState([]);
  const [heteroChoices, setHeteroChoices] = useState({});
  const [altlocChoices, setAltlocChoices] = useState({});
  const [pocketGroupId, setPocketGroupId] = useState('');
  const [preparing, setPreparing] = useState(false);
  const viewerHostRef = useRef(null);
  const viewerRef = useRef(null);
  const boxShapeRef = useRef(null);

  useEffect(() => {
    let active = true;
    fetchReceptorPreparationRuntime(apiBaseUrl)
      .then((status) => { if (active) setPreparationRuntime(status); })
      .catch((runtimeError) => { if (active) setPreparationRuntime({ available: false, status: 'unavailable', reason: runtimeError.message }); });
    return () => { active = false; };
  }, [apiBaseUrl]);

  useEffect(() => {
    if (!structure || !viewerHostRef.current) return undefined;
    let disposed = false;
    let viewer;
    async function initializeViewer() {
      try {
        const { createViewer } = await import('3dmol/build/3Dmol.es6.js');
        if (disposed || !viewerHostRef.current) return;
        viewer = createViewer(viewerHostRef.current, { backgroundColor: '#f7f9fb' });
        viewer.addModel(structure.text, structure.format);
        viewer.setStyle({}, { cartoon: { color: 'spectrum' } });
        viewer.addStyle({ hetflag: true }, { stick: { radius: 0.22, colorscheme: 'Jmol' } });
        viewer.setClickable({}, true, (atom) => setSelectedAtom(atomDetails(atom)));
        viewer.zoomTo(); viewer.render(); viewerRef.current = viewer;
      } catch (viewerError) { setError(`Interactive receptor viewer unavailable: ${viewerError.message ?? viewerError}`); }
    }
    initializeViewer();
    return () => { disposed = true; if (viewer) viewer.clear(); viewerRef.current = null; };
  }, [structure]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (boxShapeRef.current) viewer.removeShape(boxShapeRef.current);
    boxShapeRef.current = null;
    const values = [box.centerX, box.centerY, box.centerZ, box.sizeX, box.sizeY, box.sizeZ].map(Number);
    if (values.every(Number.isFinite) && values.slice(3).every((value) => value > 0)) {
      boxShapeRef.current = viewer.addBox({
        center: { x: values[0], y: values[1], z: values[2] }, dimensions: { w: values[3], h: values[4], d: values[5] },
        color: '#df6c3b', opacity: 0.22, wireframe: true,
      });
    }
    selectedResidues.forEach((residue) => viewer.addStyle(
      { chain: residue.chain, resi: residue.residueNumber, resn: residue.residueName },
      { stick: { radius: 0.28, color: '#df6c3b' } },
    ));
    viewer.render();
  }, [box, selectedResidues]);

  async function handleUpload() {
    if (!selectedFile) return;
    setLoading(true); setError('');
    try {
      const associationId = receptor && selectedFile.name.toLowerCase().endsWith('.pdbqt') ? receptor.receptor_id : '';
      const metadata = await uploadDockingReceptor(apiBaseUrl, selectedFile, associationId);
      const response = await fetch(`${apiBaseUrl}/api/docking/receptors/${metadata.receptor_id}/structure`);
      if (!response.ok) throw new Error(await response.text());
      setReceptor(metadata);
      setStructure({ text: await response.text(), format: response.headers.get('X-MolOptima-Structure-Format') || 'pdb' });
      const chains = metadata.structure_inventory?.protein?.chains ?? [];
      setSelectedChains(chains.map((item) => item.chain));
      setHeteroChoices({});
      setAltlocChoices({});
      setPocketGroupId('');
      setConfirmed(null); setSelectedFile(null);
    } catch (uploadError) { setError(uploadError.message ?? String(uploadError)); }
    finally { setLoading(false); }
  }

  const boundLigands = receptor?.bound_ligands ?? [];
  const inventory = receptor?.structure_inventory ?? null;
  const selectedLigand = boundLigands.find((ligand) => ligand.ligand_id === selectedLigandId);
  const selectedRegionAtoms = useMemo(() => {
    const viewer = viewerRef.current;
    if (!viewer) return [];
    return selectedResidues.flatMap((residue) => viewer.selectedAtoms({ chain: residue.chain, resi: residue.residueNumber, resn: residue.residueName }));
  }, [selectedResidues]);
  const readiness = dockingReadiness(receptor, box);
  const ready = Object.values(readiness).every(Boolean);
  const preparationReady = preparationSelectionReady(inventory, selectedChains, heteroChoices, altlocChoices);

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
    setBox((current) => ({ ...current, ...ligandCentroid(ligand) }));
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

  async function handlePrepare() {
    if (!receptor || !preparationReady || !preparationRuntime?.available) return;
    setPreparing(true); setError('');
    try {
      const metadata = await prepareDockingReceptor(
        apiBaseUrl,
        receptor.receptor_id,
        preparationPayload(selectedChains, heteroChoices, altlocChoices, pocketGroupId),
      );
      setReceptor(metadata);
      setConfirmed(null);
    } catch (preparationError) { setError(preparationError.message ?? String(preparationError)); }
    finally { setPreparing(false); }
  }

  async function handleConfirm() {
    if (!ready) { setError('Docking setup is not ready. A prepared PDBQT, finite center, and positive box dimensions are required.'); return; }
    setLoading(true); setError('');
    try {
      const configuration = await submitDockingConfiguration(apiBaseUrl, configurationPayload(receptor.receptor_id, method, selectedLigandId, box, advanced));
      setConfirmed(configuration); onConfirmed?.({ receptor, configuration });
    } catch (configurationError) { setError(configurationError.message ?? String(configurationError)); }
    finally { setLoading(false); }
  }

  return (
    <Box component="section" aria-label="Docking setup" sx={{ width: '100%', p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper' }}>
      <Stack spacing={1.5}>
        <Box><Typography variant="h2">Receptor workspace</Typography><Typography variant="caption" color="text.secondary">
          PDB is retained for visualization and scientific selection. MolOptima can generate a rigid docking receptor with Meeko; it does not repair missing residues or determine biologically correct protonation.
        </Typography></Box>
        <Box>
          <Button aria-label="Select PDB for visualization" variant="outlined" component="label" startIcon={<UploadFileOutlinedIcon />}>Select PDB for visualization<input hidden type="file" accept=".pdb" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} /></Button>
        </Box>
        <Box component="details"><Typography component="summary" variant="subtitle2" sx={{ cursor: 'pointer' }}>Advanced / reproducibility: already have a prepared docking receptor?</Typography><Stack sx={{ mt: 1 }} spacing={0.75}>
          <Typography variant="caption" color="text.secondary">The uploaded PDBQT is preserved unchanged and validated through the same fail-closed receptor validator.</Typography>
          <Button aria-label="Select prepared PDBQT" variant="outlined" component="label" startIcon={<UploadFileOutlinedIcon />}>Select prepared PDBQT<input hidden type="file" accept=".pdbqt" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} /></Button>
        </Stack></Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
          <Typography variant="caption" sx={{ flex: 1 }}>{selectedFile?.name ?? 'No receptor artifact selected'}</Typography>
          <Button variant="contained" disabled={!selectedFile || loading} onClick={handleUpload}>{loading ? 'Processing' : 'Upload selected artifact'}</Button>
        </Stack>
        {receptor ? <Alert severity={receptor.docking_ready ? 'success' : 'info'}>
          {receptor.display_name} · PDB visualization: {receptor.visualization_available ? 'available' : 'unavailable'} · prepared PDBQT: {receptor.docking_ready ? `validated (${receptor.receptor_source === 'moloptima_prepared' ? 'prepared by MolOptima' : 'user supplied'})` : 'required'}
        </Alert> : null}

        <Box sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          <Stack spacing={1.25}>
            <Box><Typography variant="h2">Receptor Preparation</Typography><Typography variant="caption" color="text.secondary">
              Structure: {receptor?.original_filename ?? 'Load a PDB to inspect preparation choices'}
            </Typography></Box>
            <Alert severity={preparationRuntime?.available ? 'success' : 'warning'}>
              Receptor preparation runtime: {preparationRuntime?.available ? `Meeko ${preparationRuntime.version} available` : (preparationRuntime?.reason || 'checking availability')}. Hydrogen optimization and pH-dependent protonation are not performed.
            </Alert>
            <Typography variant="body2">MolOptima uses Meeko to prepare the AutoDock/Vina receptor representation. The final PDBQT retains the explicit polar/donor hydrogens required by the AutoDock atom representation; nonpolar hydrogens are not retained as independent docking atoms.</Typography>
            {inventory ? <>
              <Box><Typography variant="subtitle2">Protein chains</Typography><Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                {(inventory.protein?.chains ?? []).map((item) => <FormControlLabel key={item.chain || '_blank'} control={<Checkbox checked={selectedChains.includes(item.chain)} onChange={() => toggleChain(item.chain)} />} label={`${item.chain || '(blank)'} · ${item.residue_count} residues`} />)}
              </Stack></Box>
              <Box><Typography variant="subtitle2">Waters</Typography><FormControlLabel control={<Radio checked readOnly />} label={`Remove all waters (${inventory.waters?.count ?? 0} detected)`} /><Typography variant="caption" color="text.secondary" display="block">Selected-water retention is not supported safely in Stage 1; removal is explicit and recorded, not presented as universally optimal.</Typography></Box>
              <Box><Typography variant="subtitle2" sx={{ mb: 0.5 }}>Hetero groups</Typography>
                {(inventory.hetero_groups ?? []).length ? <Table size="small" aria-label="Receptor hetero groups"><TableHead><TableRow><TableCell>Receptor action</TableCell><TableCell>Use for pocket</TableCell><TableCell>Type</TableCell><TableCell>Residue</TableCell><TableCell>Chain</TableCell><TableCell>Number</TableCell><TableCell align="right">Atoms</TableCell></TableRow></TableHead><TableBody>
                  {inventory.hetero_groups.map((group) => <TableRow key={group.group_id}><TableCell><TextField select size="small" aria-label={`Receptor action ${group.group_id}`} value={heteroChoices[group.group_id] ?? ''} onChange={(event) => setHeteroChoices((current) => ({ ...current, [group.group_id]: event.target.value }))} sx={{ minWidth: 110 }}><MenuItem value=""><em>Choose</em></MenuItem><MenuItem value="keep">Keep</MenuItem><MenuItem value="exclude">Exclude</MenuItem></TextField></TableCell><TableCell><Checkbox aria-label={`Use ${group.group_id} for pocket definition`} checked={pocketGroupId === group.group_id} onChange={(event) => useHeteroForPocket(group, event.target.checked)} /></TableCell><TableCell>{group.type.replace('_', ' ')}</TableCell><TableCell>{group.residue_name}</TableCell><TableCell>{group.chain || '–'}</TableCell><TableCell>{group.residue_number}{group.insertion_code}</TableCell><TableCell align="right">{group.atom_count}</TableCell></TableRow>)}
                </TableBody></Table> : <Typography variant="caption" color="text.secondary">No non-water hetero groups detected.</Typography>}
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>Every group requires an explicit Keep or Exclude choice. Unsupported retained cofactors, ions, or hetero residues fail preparation; they are never silently dropped.</Typography>
              </Box>
              {(inventory.alternate_locations ?? []).length ? <Box><Typography variant="subtitle2">Alternate locations</Typography><Stack spacing={0.75}>{inventory.alternate_locations.map((item) => <TextField key={item.residue_key} select size="small" label={`Conformer for ${item.residue_key}`} value={altlocChoices[item.residue_key] ?? ''} onChange={(event) => setAltlocChoices((current) => ({ ...current, [item.residue_key]: event.target.value }))}><MenuItem value=""><em>Choose explicitly</em></MenuItem>{item.choices.map((choice) => <MenuItem key={choice} value={choice}>{choice}</MenuItem>)}</TextField>)}</Stack></Box> : null}
              <Box sx={{ bgcolor: '#f7f9fb', p: 1.25, borderRadius: 1 }}><Typography variant="subtitle2">Preparation Summary</Typography>
                <Typography variant="body2">Input: {receptor.original_filename}</Typography>
                <Typography variant="body2">Protein chains: {selectedChains.length ? selectedChains.map((chain) => chain || '(blank)').join(', ') : 'none selected'}</Typography>
                <Typography variant="body2">Waters: remove {inventory.waters?.count ?? 0}</Typography>
                <Typography variant="body2">Retained hetero groups: {summarizeHetero(inventory.hetero_groups, heteroChoices, 'keep')}</Typography>
                <Typography variant="body2">Excluded hetero groups: {summarizeHetero(inventory.hetero_groups, heteroChoices, 'exclude')}</Typography>
                <Typography variant="body2">Pocket-definition group: {pocketGroupId || 'none selected'}</Typography>
                <Typography variant="body2">Hydrogen handling: Meeko/RDKit residue-template completion; no Reduce2 optimization or resolved pH policy</Typography>
                <Typography variant="body2">Receptor preparation: Meeko {preparationRuntime?.version ?? 'unavailable'}</Typography>
              </Box>
              <Button variant="contained" disabled={!preparationRuntime?.available || !preparationReady || preparing} onClick={handlePrepare}>{preparing ? 'Preparing receptor…' : 'Prepare Receptor'}</Button>
              {!preparationReady ? <Typography variant="caption" color="warning.main">Select at least one protein chain and complete every hetero/alternate-location choice.</Typography> : null}
              {receptor.preparation_status === 'valid' && receptor.receptor_source === 'moloptima_prepared' ? <Alert severity="success">Prepared docking receptor: valid · existing MolOptima PDBQT validator passed · original visualization and binding-site selections retained.</Alert> : null}
            </> : <Typography variant="body2" color="text.secondary">Upload a PDB to display chains, waters, hetero groups, and alternate locations.</Typography>}
          </Stack>
        </Box>

        <Box sx={{ position: 'relative' }}>
          <Box ref={viewerHostRef} data-testid="receptor-viewer" sx={{ height: 430, border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', bgcolor: '#f7f9fb' }} />
          {!structure ? <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}><Typography color="text.secondary">Upload a PDB or prepared PDBQT to view the receptor.</Typography></Box> : null}
        </Box>

        <Box sx={{ p: 1.5, bgcolor: '#f7f9fb', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          <Stack spacing={1}><Typography variant="subtitle2">Selected atom</Typography>
            {selectedAtom ? <>
              <Typography variant="body2">Chain {selectedAtom.chain || '–'} · {selectedAtom.residueName || '–'} {selectedAtom.residueNumber || '–'} · {selectedAtom.atomName || '–'}</Typography>
              <Typography variant="caption" color="text.secondary">x {formatCoordinate(selectedAtom.x)} · y {formatCoordinate(selectedAtom.y)} · z {formatCoordinate(selectedAtom.z)}</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap><Button variant="outlined" onClick={() => { setMethod('selected_atom'); setCenter(selectedAtom); }}>Set box center here</Button><Button variant="outlined" onClick={addSelectedResidue}>Add residue to pocket selection</Button><Button variant="text" onClick={() => setSelectedAtom(null)}>Clear selection</Button></Stack>
            </> : <Typography variant="caption" color="text.secondary">Click an atom in the receptor viewer to inspect its identity and coordinates.</Typography>}
            {selectedResidues.length ? <><Typography variant="caption" color="text.secondary">Selected pocket region</Typography><Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">{selectedResidues.map((residue) => <Chip key={residue.key} label={`${residue.chain || '–'} ${residue.residueName} ${residue.residueNumber}`} onDelete={() => setSelectedResidues((current) => current.filter((item) => item.key !== residue.key))} />)}<Button variant="text" onClick={() => setSelectedResidues([])}>Clear pocket selection</Button></Stack></> : null}
          </Stack>
        </Box>

        <FormControl><FormLabel>Binding-site definition</FormLabel><RadioGroup row value={method} onChange={(event) => setMethod(event.target.value)}>
          <FormControlLabel value="bound_ligand" control={<Radio />} label="Bound ligand" disabled={!boundLigands.length} />
          <FormControlLabel value="selected_atom" control={<Radio />} label="Selected atom" disabled={!selectedAtom} />
          <FormControlLabel value="selected_region" control={<Radio />} label="Selected residue region" disabled={!selectedResidues.length} />
          <FormControlLabel value="manual" control={<Radio />} label="Manual coordinates" />
        </RadioGroup></FormControl>

        {boundLigands.length ? <TextField select label="Detected bound ligand" value={selectedLigandId} onChange={(event) => {
          const ligand = boundLigands.find((item) => item.ligand_id === event.target.value); if (ligand) { setMethod('bound_ligand'); selectLigand(ligand); }
        }}><MenuItem value=""><em>Select a ligand</em></MenuItem>{boundLigands.map((ligand) => <MenuItem key={ligand.ligand_id} value={ligand.ligand_id}>{ligand.residue_name} {ligand.chain || '–'} {ligand.residue_number} ({ligand.atom_count} atoms)</MenuItem>)}</TextField>
          : <Alert severity="info">No plausible non-water bound ligand was identified. Bound-ligand mode is unavailable.</Alert>}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
          <TextField label="Fit padding (Å)" type="number" value={padding} onChange={(event) => setPadding(event.target.value)} inputProps={{ min: 0, step: 0.5 }} sx={{ width: 150 }} />
          <Button variant="outlined" disabled={!selectedRegionAtoms.length} onClick={() => { setMethod('selected_region'); setCenter(centroidForAtoms(selectedRegionAtoms)); }}>Use region centroid</Button>
          <Button variant="outlined" disabled={!selectedRegionAtoms.length} onClick={() => fitSelection(selectedRegionAtoms)}>Fit box to region + padding</Button>
          <Button variant="outlined" disabled={!selectedLigand} onClick={() => fitSelection(ligandAtoms())}>Fit box to ligand + padding</Button>
        </Stack>

        <Typography variant="h2">Vina Search Box</Typography>
        <NumericGrid title="Center (Å)" values={box} setValues={setBox} fields={[["centerX", "Center X"], ["centerY", "Center Y"], ["centerZ", "Center Z"]]} />
        <NumericGrid title="Box size (Å)" values={box} setValues={setBox} fields={[["sizeX", "Size X"], ["sizeY", "Size Y"], ["sizeZ", "Size Z"]]} />
        <Typography variant="caption" color="text.secondary">The translucent box updates immediately when center or dimensions change.</Typography>

        <Box component="details"><Typography component="summary" variant="subtitle2" sx={{ cursor: 'pointer' }}>Advanced Vina settings</Typography><Box sx={{ mt: 1 }}>
          <NumericGrid values={advanced} setValues={setAdvanced} fields={[["exhaustiveness", "Exhaustiveness"], ["workerCount", "Workers"], ["numModes", "Number of modes"], ["energyRange", "Energy range (kcal/mol)"], ["seed", "Random seed"]]} />
        </Box></Box>

        <Box><Typography variant="subtitle2" sx={{ mb: 0.75 }}>Readiness</Typography><Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
          {Object.entries({ 'Protein visualization': readiness.receptorLoaded, 'Prepared receptor PDBQT': readiness.preparedReceptor, 'Search-box center': readiness.centerDefined, 'Search-box size': readiness.positiveDimensions }).map(([label, value]) => <Chip key={label} label={`${label}: ${value ? 'ready' : 'required'}`} color={value ? 'success' : 'warning'} variant="outlined" />)}
          {receptor?.docking_ready ? <Chip label={`Receptor source: ${receptor.receptor_source === 'moloptima_prepared' ? 'MolOptima prepared' : 'user supplied / validated'}`} color="success" variant="outlined" /> : null}
          <Chip label={`Detected ligands: ${boundLigands.length}`} variant="outlined" />
        </Stack></Box>
        <Button variant="contained" disabled={loading || !ready} onClick={handleConfirm}>Confirm Docking Setup</Button>
        {confirmed ? <Alert severity="success">Docking configuration saved: {confirmed.configuration_id}</Alert> : null}
        {error ? <Alert severity="error">{error}</Alert> : null}
      </Stack>
    </Box>
  );
}

function NumericGrid({ title = '', values, setValues, fields }) {
  return <Stack spacing={0.75}>{title ? <Typography variant="subtitle2">{title}</Typography> : null}<Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 1 }}>
    {fields.map(([key, label]) => <TextField key={key} label={label} type="number" value={values[key]} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} inputProps={{ step: 'any' }} />)}
  </Box></Stack>;
}

function numericOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const numeric = Number(value); return Number.isFinite(numeric) ? numeric : null;
}
function formatCoordinate(value) { return Number(value).toFixed(3).replace(/\.000$/, ''); }
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
