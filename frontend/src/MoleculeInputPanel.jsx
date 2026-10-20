import React, { useRef, useState } from 'react';
import {
  Alert, Box, Button, ButtonBase, Chip, CircularProgress, Divider, IconButton, Paper, Stack, Table, TableBody,
  TableCell, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import MoleculeStructureThumbnail from './MoleculeStructureThumbnail.jsx';
import {
  FILE_PREVIEW_LIMIT,
  LARGE_SELECTION_THRESHOLD,
  classifyPendingMoleculeFiles,
  pendingSelectionLimitError,
} from './moleculeSelection.js';

const PDB_WARNING = 'SDF is preferred for small-molecule structure files because it preserves bond orders and formal charges more reliably than PDB.';

export function moleculeImportWarnings(row) {
  return (Array.isArray(row.warnings) ? row.warnings : [])
    .map((warning) => String(warning).trim())
    .filter(Boolean);
}

export function moleculeImportWarning(row) {
  return moleculeImportWarnings(row).join(' · ');
}

export function analysisModeLabel(mode) {
  if (mode === 'single_compound') return 'Single Compound Analysis';
  if (mode === 'library') return 'Library Prioritization';
  return 'Not available';
}

export function topLevelFolderFiles(fileList) {
  return Array.from(fileList ?? []).filter((file) => {
    const path = file.webkitRelativePath || '';
    return !path || path.split('/').length === 2;
  });
}

function FileButton({ label, accept, multiple = false, folder = false, onFiles, resetKey = 0 }) {
  const inputRef = useRef(null);
  return (
    <>
      <Button
        variant="outlined"
        type="button"
        aria-label={label}
        startIcon={folder ? <FolderOpenOutlinedIcon /> : <UploadFileOutlinedIcon />}
        onClick={() => inputRef.current?.click()}
      >
      {label}
      </Button>
      <input
        key={resetKey}
        ref={inputRef}
        hidden
        type="file"
        accept={accept}
        multiple={multiple || folder}
        webkitdirectory={folder ? '' : undefined}
        onChange={(event) => {
          const files = folder ? topLevelFolderFiles(event.target.files) : Array.from(event.target.files ?? []);
          onFiles(files);
          event.target.value = '';
        }}
      />
    </>
  );
}

function ValidationState({ row }) {
  const valid = row.validation_status === 'valid';
  const Icon = valid ? CheckCircleOutlineIcon : ErrorOutlineIcon;
  return (
    <Stack direction="row" spacing={0.6} alignItems="center">
      <Icon aria-hidden="true" sx={{ fontSize: 17, color: valid ? 'success.dark' : 'error.main' }} />
      <Typography variant="caption" sx={{ fontWeight: 700 }}>{valid ? 'Valid' : 'Invalid'}</Typography>
    </Stack>
  );
}

function CollectionMetric({ label, value, emphasis = false }) {
  return (
    <Box sx={{ minWidth: 74 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography sx={{ mt: 0.15, fontWeight: 750, fontSize: 14, color: emphasis ? 'primary.main' : 'text.primary' }}>{value ?? 0}</Typography>
    </Box>
  );
}

function DetailField({ label, value, mono = false }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography sx={{ mt: 0.15, fontSize: 12.5, fontFamily: mono ? 'ui-monospace, SFMono-Regular, Consolas, monospace' : undefined, overflowWrap: 'anywhere' }}>
        {value || 'Not available'}
      </Typography>
    </Box>
  );
}

function FocusedCompoundInspector({ row, uploadId }) {
  const warnings = moleculeImportWarnings(row);
  return (
    <Box sx={{ borderTop: '1px solid', borderColor: 'divider', bgcolor: '#fbfcfd' }}>
      <Box sx={{ px: 1.5, py: 0.9, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="subtitle2">Selected compound: {row.molecule_id}</Typography>
      </Box>
      <Box sx={{ p: 1.5, display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) minmax(0, 1fr)' }, gap: 2 }}>
        <Box>
          <Typography variant="caption" sx={{ fontWeight: 750, color: 'text.secondary' }}>IDENTITY</Typography>
          <Box sx={{ mt: 0.75, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'minmax(120px, .45fr) minmax(0, 1.55fr)' }, gap: 1 }}>
            <DetailField label="Molecule ID" value={row.molecule_id} />
            <DetailField label="Canonical SMILES" value={row.canonical_smiles || row.input_smiles} mono />
            <DetailField label="Original molecule ID" value={row.original_molecule_id} />
            <DetailField label="Validation" value={row.validation_status === 'valid' ? 'Valid' : 'Invalid'} />
          </Box>
        </Box>
        <Box>
          <Typography variant="caption" sx={{ fontWeight: 750, color: 'text.secondary' }}>VALIDATION / PROVENANCE</Typography>
          <Box sx={{ mt: 0.75, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1 }}>
            <DetailField label="Source" value={[row.source_type, row.source_filename].filter(Boolean).join(' · ')} />
            <DetailField label="Structure status" value={row.structure_status} />
            <DetailField label="Coordinates" value={row.coordinate_status} />
            <DetailField label="Duplicate structure" value={row.duplicate_structure ? 'Yes' : 'No'} />
            <DetailField label="Upload ID" value={uploadId} mono />
            <DetailField label="Validation error" value={row.failure_reason || 'No validation error recorded'} />
            <Box sx={{ gridColumn: '1 / -1', minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary">Import warnings ({warnings.length})</Typography>
              {warnings.length ? <Box component="ul" sx={{ my: 0.35, pl: 2.25 }}>{warnings.map((warning) => <Typography component="li" key={warning} sx={{ fontSize: 12.5 }}>{warning}</Typography>)}</Box>
                : <Typography sx={{ mt: 0.15, fontSize: 12.5 }}>No import warnings recorded</Typography>}
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

export default function MoleculeInputPanel({ uploadState, backendHealth, baseUrl = 'http://localhost:8000', onChange, onImport, onCancelImport, onContinue }) {
  const upload = uploadState.upload;
  const preview = upload?.preview ?? [];
  const valid = upload?.valid_count ?? 0;
  const selectedFiles = uploadState.selectedFiles ?? [];
  const selection = classifyPendingMoleculeFiles(selectedFiles);
  const blockingSelectionError = pendingSelectionLimitError(selectedFiles, uploadState.smilesText);
  const hasSupportedPendingInput = Boolean(uploadState.smilesText?.trim() || selection.supported.length);
  const backendOnline = backendHealth?.status === 'online';
  const canSubmit = backendOnline && hasSupportedPendingInput && !blockingSelectionError;
  const visibleFiles = selection.total > LARGE_SELECTION_THRESHOLD
    ? selectedFiles.slice(0, FILE_PREVIEW_LIMIT)
    : selectedFiles;
  const hiddenFileCount = selection.total - visibleFiles.length;
  const progress = uploadState.importProgress;
  const [focusedMoleculeId, setFocusedMoleculeId] = useState('');
  const focusedRow = preview.find((row) => row.molecule_id === focusedMoleculeId) ?? preview[0] ?? null;
  return (
    <Stack spacing={1.5}>
      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ px: 1.75, py: 1.1, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography variant="h2">Add compounds</Typography>
        </Box>
        <Box sx={{ p: 1.5, display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(260px, .75fr) minmax(0, 1.5fr)' }, gap: 1.5, alignItems: 'start' }}>
          <TextField
            label="Enter / Paste SMILES" multiline minRows={2}
            placeholder={'CCO\ncmpd_002    CCN\nc1ccccc1'}
            value={uploadState.smilesText ?? ''}
            onChange={(event) => onChange({ smilesText: event.target.value, error: '' })}
            helperText="One molecule per line: SMILES, or molecule ID followed by SMILES."
          />
          <Stack spacing={1.25}>
            <Box>
              <Stack direction="row" spacing={0.35} alignItems="center" sx={{ mb: 0.65 }}>
                <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>IMPORT FROM FILES</Typography>
                <Tooltip title={PDB_WARNING} arrow enterTouchDelay={0}>
                  <IconButton size="small" aria-label={`Structure-file guidance: ${PDB_WARNING}`} sx={{ p: 0.25 }}><InfoOutlinedIcon sx={{ fontSize: 16 }} /></IconButton>
                </Tooltip>
                <Typography variant="caption" color="text.secondary">One molecule per SDF or ligand PDB file; Multi-record SDF files are not supported.</Typography>
              </Stack>
              <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                <FileButton resetKey={uploadState.fileInputResetKey} label="Upload CSV / TSV" accept=".csv,.tsv,text/csv,text/tab-separated-values" multiple onFiles={(files) => onChange({ addFiles: files })} />
                <FileButton resetKey={uploadState.fileInputResetKey} label="Upload SDF" accept=".sdf,chemical/x-mdl-sdfile" multiple onFiles={(files) => onChange({ addFiles: files })} />
                <FileButton resetKey={uploadState.fileInputResetKey} label="Upload Ligand PDB" accept=".pdb,chemical/x-pdb" multiple onFiles={(files) => onChange({ addFiles: files })} />
                <FileButton resetKey={uploadState.fileInputResetKey} label="Select Structure Files" accept=".sdf,.pdb" multiple onFiles={(files) => onChange({ addFiles: files })} />
                <FileButton resetKey={uploadState.fileInputResetKey} label="Select Folder · SDF library" accept=".sdf" folder onFiles={(files) => onChange({ addFiles: files })} />
                <FileButton resetKey={uploadState.fileInputResetKey} label="Select Folder · PDB library" accept=".pdb" folder onFiles={(files) => onChange({ addFiles: files })} />
              </Stack>
            </Box>
            <TextField
              label="Explicit CSV/TSV structure column"
              placeholder="smiles or canonical_smiles"
              value={uploadState.selectedStructureColumn ?? ''}
              onChange={(event) => onChange({ selectedStructureColumn: event.target.value, error: '' })}
              helperText="Only needed when more than one plausible structure column exists."
            />
          </Stack>
        </Box>
        <Divider />
        <Box sx={{ px: 1.5, py: 1, display: 'flex', gap: 1.25, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2">Pending collection</Typography>
            <Typography variant="caption" color="text.secondary">
              Selected files: {selection.total} · Supported: {selection.supported.length} · Unsupported: {selection.unsupported.length}
              {uploadState.smilesText?.trim() ? ' · entered SMILES included' : ''}
            </Typography>
            {selection.total ? <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ mt: 0.6 }}>
              {visibleFiles.map((file) => <Chip key={file.webkitRelativePath || `${file.name}-${file.size}-${file.lastModified}`} label={file.webkitRelativePath || file.name} variant="outlined" />)}
              {hiddenFileCount > 0 ? <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>+ {hiddenFileCount} more</Typography> : null}
            </Stack> : null}
          </Box>
          <Stack direction="row" spacing={0.75}>
            <Button variant="text" type="button" disabled={!selection.total} onClick={() => onChange({ clearSelectedFiles: true })}>Clear files</Button>
            <Button variant="contained" disabled={!canSubmit || uploadState.loading} onClick={onImport} startIcon={uploadState.loading ? <CircularProgress size={18} color="inherit" /> : null}>
              {uploadState.loading ? (progress?.status === 'finalizing' ? 'Finalizing import' : progress ? 'Importing molecules' : 'Validating collection') : 'Validate and load molecules'}
            </Button>
            {uploadState.loading && progress?.status === 'running' ? <Button variant="outlined" color="inherit" onClick={onCancelImport}>Cancel import</Button> : null}
          </Stack>
        </Box>
        <Box sx={{ px: 1.5, pb: selection.unsupported.length || backendHealth?.status === 'offline' || blockingSelectionError || uploadState.error || progress ? 1.25 : 0 }}>
          {selection.unsupported.length ? <Alert severity="warning">{selection.unsupported.length} unsupported file{selection.unsupported.length === 1 ? '' : 's'} will be ignored. Supported formats: CSV, TSV, SDF, and ligand PDB.</Alert> : null}
          {backendHealth?.status === 'offline' && hasSupportedPendingInput ? <Alert severity="warning">Validation requires the MolOptima backend. Your selected files are preserved.</Alert> : null}
          {blockingSelectionError ? <Alert severity="error">{blockingSelectionError}</Alert> : null}
          {uploadState.error ? <Alert severity="error">{uploadState.error}</Alert> : null}
          {progress ? <Alert severity={progress.status === 'failed' ? 'warning' : 'info'}>
            <Typography sx={{ fontWeight: 700 }}>
              {progress.status === 'failed' ? 'Import stopped' : progress.status === 'finalizing' ? 'Finalizing molecule import' : 'Importing molecules'}
            </Typography>
            <Typography>
              {progress.processedFiles.toLocaleString()} / {progress.totalFiles.toLocaleString()} files processed
              {' · '}{progress.batchNumber > 0 ? `Batch ${progress.batchNumber} of ${progress.totalBatches}` : `Preparing batch 1 of ${progress.totalBatches}`}
            </Typography>
            <Typography variant="caption">{progress.parsedRecords.toLocaleString()} molecule records parsed in acknowledged batches</Typography>
          </Alert> : null}
        </Box>
      </Paper>

      {upload ? <Stack spacing={1.5}>
        <Paper elevation={0} sx={{ px: 1.5, py: 1.15, border: '1px solid', borderColor: 'divider', display: 'flex', gap: 2, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <Box sx={{ minWidth: 210 }}>
            <Stack direction="row" spacing={1} alignItems="baseline" flexWrap="wrap">
              <Typography variant="h2">Validated collection</Typography>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>{upload.submitted_count ?? 0} imported / {valid} valid</Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary">{upload.filename} · {analysisModeLabel(upload.analysis_mode)} · Upload {upload.upload_id}</Typography>
          </Box>
          <Stack direction="row" spacing={{ xs: 1.5, md: 2.5 }} useFlexGap flexWrap="wrap">
            <CollectionMetric label="Submitted" value={upload.submitted_count} />
            <CollectionMetric label="Valid" value={upload.valid_count} emphasis />
            <CollectionMetric label="Invalid" value={upload.invalid_count} />
            <CollectionMetric label="Unresolved PDB" value={upload.unresolved_pdb_count} />
            <CollectionMetric label="Duplicates" value={upload.duplicate_count} />
            <CollectionMetric label="Ignored files" value={upload.ignored_file_count} />
          </Stack>
        </Paper>
        {valid ? null : <Alert severity="warning">No chemically valid compounds are available. Correct the input before continuing.</Alert>}
          {upload.multi_record_sdf_count ? <Alert severity="error">MolOptima accepts one molecule per SDF file. For a molecular library, place individual SDF files in a folder or select multiple SDF files.</Alert> : null}
          {preview.length ? <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
            <Box sx={{ px: 1.5, py: 0.9, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'baseline' }}>
              <Typography variant="h2">Actual-data preview</Typography>
              <Typography variant="caption" color="text.secondary">Showing {preview.length} of {upload.submitted_count ?? preview.length} records</Typography>
            </Box>
            <Box sx={{ maxWidth: '100%', maxHeight: 300, overflow: 'auto' }}>
            <Table stickyHeader size="small" aria-label="Molecule input preview" sx={{ minWidth: 900, tableLayout: 'fixed', '& .MuiTableCell-root': { px: 0.75 }, '& .MuiTableCell-head': { fontSize: '0.72rem', bgcolor: '#f4f7f9' } }}><TableHead><TableRow>
              <TableCell scope="col" sx={{ width: 136 }}>Structure</TableCell><TableCell scope="col" sx={{ width: 164 }}>Molecule ID</TableCell><TableCell scope="col" sx={{ width: 216 }}>Canonical SMILES</TableCell><TableCell scope="col" sx={{ width: 92 }}>Validity</TableCell><TableCell scope="col" sx={{ width: 170 }}>Source</TableCell><TableCell scope="col" sx={{ width: 110 }}>Coordinates</TableCell>
            </TableRow></TableHead><TableBody>{preview.map((row, index) => {
              const warnings = moleculeImportWarnings(row);
              const warning = warnings.join(' · ');
              const focused = focusedRow === row;
              return <TableRow key={`${row.molecule_id}-${index}`} selected={focused} sx={{ '&.Mui-selected': { bgcolor: 'rgba(20, 95, 116, 0.075)' }, '&.Mui-selected:hover': { bgcolor: 'rgba(20, 95, 116, 0.09)' } }}>
                <TableCell><ButtonBase aria-label={`Inspect ${row.molecule_id}`} aria-pressed={focused} onClick={() => setFocusedMoleculeId(row.molecule_id)} sx={{ borderRadius: 1, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 } }}><MoleculeStructureThumbnail baseUrl={baseUrl} moleculeId={row.molecule_id} smiles={row.canonical_smiles} /></ButtonBase></TableCell>
                <TableCell sx={{ overflowWrap: 'anywhere' }}><Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" alignItems="center"><Box component="span">{row.molecule_id}</Box>{warnings.length ? <Tooltip title={<Box><Typography variant="caption" fontWeight={700}>{warnings.length === 1 ? 'Import warning' : `${warnings.length} import warnings`}</Typography><Box component="ul" sx={{ my: 0.25, pl: 2 }}>{warnings.map((message) => <li key={message}>{message}</li>)}</Box></Box>} arrow enterTouchDelay={0}><Button size="small" color="warning" variant="text" startIcon={<WarningAmberRoundedIcon fontSize="small" />} aria-label={`${warnings.length} import warning${warnings.length === 1 ? '' : 's'} for ${row.molecule_id}: ${warning}`} sx={{ minWidth: 0, px: 0.5, py: 0.1, fontSize: '0.68rem', lineHeight: 1.25 }}>{warnings.length === 1 ? 'Warning' : `${warnings.length} warnings`}</Button></Tooltip> : null}</Stack></TableCell>
                <TableCell sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>{row.canonical_smiles || row.input_smiles || '—'}</TableCell>
                <TableCell><ValidationState row={row} /></TableCell>
                <TableCell sx={{ overflowWrap: 'anywhere' }}><Typography variant="caption" sx={{ display: 'block', fontWeight: 700 }}>{row.source_type || 'Not available'}</Typography><Typography variant="caption" color="text.secondary">{row.source_filename || '—'}</Typography></TableCell>
                <TableCell>{row.coordinate_status}</TableCell>
              </TableRow>;
            })}</TableBody></Table>
            </Box>
            {focusedRow ? <FocusedCompoundInspector row={focusedRow} uploadId={upload.upload_id} /> : null}
          </Paper> : null}
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}><Button variant="contained" disabled={!valid} onClick={onContinue}>Continue to Receptor & Docking</Button></Box>
      </Stack> : <Box sx={{ px: 0.25, py: 1 }}><Typography variant="h2">No compounds loaded</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 0.4 }}>Upload an SDF, CSV, TSV, or ligand PDB file, or paste SMILES above to begin.</Typography></Box>}
    </Stack>
  );
}
