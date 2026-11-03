import React, { useMemo, useState } from 'react';
import {
  Box, Button, Chip, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import { atomIdentity, selectionSummary } from './molecularSelection.js';

function valueOrUnavailable(value) {
  return value === '' || value === null || value === undefined ? 'Unavailable' : String(value);
}

function coordinate(value) {
  return Number.isFinite(value) ? value.toFixed(3) : 'Unavailable';
}

export default function MolecularSelectionPanel({
  selectionAtoms = [], clickedAtom = null, pickMode, selectionAction,
  representation, color, detectedLigand = null,
  onPickModeChange, onSelectionActionChange, onClear, onSelectAll, onRemoveResidue,
  onRepresentationChange, onColorChange, onApplyRepresentation, onApplyColor,
  onResetDisplay, onFocusSelection, onUseForBindingSite, onCommand,
}) {
  const summary = useMemo(() => selectionSummary(selectionAtoms), [selectionAtoms]);
  const atom = clickedAtom ? atomIdentity(clickedAtom) : null;
  const [command, setCommand] = useState('');
  const [log, setLog] = useState([]);
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  function runCommand() {
    const input = command.trim();
    if (!input) return;
    const message = onCommand(input);
    setLog((current) => [...current.slice(-7), `> ${input}`, message]);
    setHistory((current) => [...current, input]);
    setHistoryIndex(-1);
    setCommand('');
  }

  function handleCommandKey(event) {
    if (event.key === 'Enter') { event.preventDefault(); runCommand(); return; }
    if (event.key === 'ArrowUp' && history.length) {
      event.preventDefault();
      const next = historyIndex < 0 ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(next); setCommand(history[next]);
    }
    if (event.key === 'ArrowDown' && history.length) {
      event.preventDefault();
      const next = historyIndex < 0 ? -1 : Math.min(history.length, historyIndex + 1);
      setHistoryIndex(next); setCommand(next === history.length ? '' : history[next]);
    }
  }

  return (
    <Box sx={{ px: 1.25, py: 1, bgcolor: '#f7f9fb', border: '1px solid', borderColor: 'divider', borderRadius: 1, minWidth: 0 }}>
      <Stack spacing={1}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={1}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2">Current molecular selection</Typography>
            {summary.atomCount ? <Typography variant="body2">{summary.atomCount} atoms · {summary.residueCount} {summary.residueCount === 1 ? 'residue' : 'residues'}</Typography> : <Typography variant="body2" color="text.secondary">No active molecular selection</Typography>}
          </Box>
          <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
            <Button size="small" variant="outlined" disabled={!selectionAtoms.length} onClick={onFocusSelection}>Focus Selection</Button>
            <Button size="small" variant="outlined" disabled={!selectionAtoms.length} onClick={onUseForBindingSite}>Use Selection for Binding Site</Button>
            <Button size="small" variant="text" disabled={!selectionAtoms.length} onClick={onClear}>Clear Selection</Button>
          </Stack>
        </Stack>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(140px, 1fr))' }, gap: 0.75 }}>
          <TextField select size="small" label="Click selects" value={pickMode} onChange={(event) => onPickModeChange(event.target.value)}><MenuItem value="atom">Atom</MenuItem><MenuItem value="residue">Residue</MenuItem><MenuItem value="molecule">Molecule / ligand</MenuItem></TextField>
          <TextField select size="small" label="Selection action" value={selectionAction} onChange={(event) => onSelectionActionChange(event.target.value)}><MenuItem value="replace">Replace</MenuItem><MenuItem value="add">Add</MenuItem><MenuItem value="remove">Remove</MenuItem></TextField>
          <Button size="small" variant="outlined" onClick={onSelectAll}>Select All</Button>
          <Button size="small" variant="outlined" disabled={!selectionAtoms.length} onClick={onClear}>Select None</Button>
        </Box>

        {summary.residues.length ? <Box component="details"><Typography component="summary" variant="caption" sx={{ cursor: 'pointer', fontWeight: 700 }}>Selected residues ({summary.residueCount})</Typography><Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ mt: 0.5 }}>{summary.residues.map((residue) => <Chip size="small" key={residue.key} label={`${residue.residueName || 'Unavailable'}${valueOrUnavailable(residue.residueNumber)}:${residue.chain || '(blank)'}`} onDelete={() => onRemoveResidue(residue.key)} />)}</Stack></Box> : null}

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' }, gap: 1 }}>
          <Box>
            <Typography variant="subtitle2">Selected atom</Typography>
            {atom ? <><Typography variant="body2">{atom.residueName || 'Unavailable'} {valueOrUnavailable(atom.residueNumber)} · Chain {atom.chain || '(blank)'}</Typography><Typography variant="caption" display="block">Atom {atom.atomName || 'Unavailable'} · {atom.elementName}</Typography><Typography variant="caption" display="block">Serial {valueOrUnavailable(atom.serial)} · Index {valueOrUnavailable(atom.index)}</Typography><Typography variant="caption" display="block">X {coordinate(atom.x)} · Y {coordinate(atom.y)} · Z {coordinate(atom.z)}</Typography><Typography variant="caption" color="text.secondary">{atom.category}</Typography></> : <Typography variant="caption" color="text.secondary">Click an atom to inspect its authoritative identity and coordinates.</Typography>}
            {detectedLigand ? <Typography variant="caption" display="block" sx={{ mt: 0.5, fontWeight: 700 }}>Matches detected bound ligand: {detectedLigand.residue_name} {detectedLigand.chain || '(blank)'} {detectedLigand.residue_number} · {detectedLigand.atom_count} atoms</Typography> : null}
          </Box>
          <Box>
            <Typography variant="subtitle2">Display selected atoms</Typography>
            <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mt: 0.5 }}>
              <TextField select size="small" label="Representation" value={representation} onChange={(event) => onRepresentationChange(event.target.value)} sx={{ minWidth: 150 }}><MenuItem value="wireframe">Lines / Wireframe</MenuItem><MenuItem value="sticks">Sticks</MenuItem><MenuItem value="ball_stick">Ball &amp; Stick</MenuItem><MenuItem value="spacefill">Spacefill</MenuItem><MenuItem value="cartoon">Cartoon</MenuItem><MenuItem value="hide">Hide</MenuItem><MenuItem value="default">Show / Default</MenuItem></TextField>
              <Button size="small" variant="outlined" disabled={!selectionAtoms.length} onClick={onApplyRepresentation}>Apply representation</Button>
              <TextField select size="small" label="Color" value={color} onChange={(event) => onColorChange(event.target.value)} sx={{ minWidth: 130 }}><MenuItem value="cpk">By element / CPK</MenuItem><MenuItem value="chain">By chain</MenuItem>{['green', 'red', 'blue', 'yellow', 'orange', 'cyan', 'magenta'].map((name) => <MenuItem key={name} value={name}>{name[0].toUpperCase() + name.slice(1)}</MenuItem>)}<MenuItem value="default">Default / Reset</MenuItem></TextField>
              <Button size="small" variant="outlined" disabled={!selectionAtoms.length} onClick={onApplyColor}>Apply color</Button>
              <Button size="small" variant="text" onClick={onResetDisplay}>Reset Display</Button>
            </Stack>
          </Box>
        </Box>

        <Box component="details">
          <Typography component="summary" variant="subtitle2" sx={{ cursor: 'pointer' }}>Molecular Command Console</Typography>
          <Typography variant="caption" color="text.secondary">RasMol-inspired allowlisted selection and display commands; not full RasMol compatibility.</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.75} sx={{ mt: 0.75 }}><TextField fullWidth size="small" label="Molecular command" value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={handleCommandKey} inputProps={{ 'aria-label': 'Molecular command' }} /><Button variant="outlined" onClick={runCommand}>Run</Button></Stack>
          {log.length ? <Box aria-live="polite" sx={{ mt: 0.75, p: 1, maxHeight: 150, overflowY: 'auto', bgcolor: '#fff', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>{log.map((line, index) => <Typography key={`${index}-${line}`} component="div" variant="caption" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{line}</Typography>)}</Box> : null}
        </Box>
      </Stack>
    </Box>
  );
}
