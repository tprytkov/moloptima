import React, { useRef } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Table, TableBody,
  TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import {
  FILE_PREVIEW_LIMIT,
  LARGE_SELECTION_THRESHOLD,
  classifyPendingMoleculeFiles,
  pendingSelectionLimitError,
} from './moleculeSelection.js';

const PDB_WARNING = 'SDF is preferred for small-molecule structure files because it preserves bond orders and formal charges more reliably than PDB.';

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

export default function MoleculeInputPanel({ uploadState, backendHealth, onChange, onImport, onCancelImport, onContinue }) {
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
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h1">Molecules</Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          Add one compound or assemble a library. Analysis mode is determined only after chemical validation.
        </Typography>
      </Box>

      <Paper elevation={0} sx={{ p: 3, border: '1px solid', borderColor: 'divider' }}>
        <Stack spacing={2.5}>
          <Box>
            <Typography variant="h2">Add Molecules</Typography>
            <Typography variant="caption" color="text.secondary">One molecule per SDF or ligand PDB file. Multi-record SDF files are not supported.</Typography>
          </Box>
          <TextField
            label="Enter / Paste SMILES" multiline minRows={5}
            placeholder={'CCO\ncmpd_002    CCN\nc1ccccc1'}
            value={uploadState.smilesText ?? ''}
            onChange={(event) => onChange({ smilesText: event.target.value, error: '' })}
            helperText="One molecule per line: SMILES only, or molecule_id followed by SMILES. Blank lines are ignored."
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} useFlexGap flexWrap="wrap">
            <FileButton resetKey={uploadState.fileInputResetKey} label="Upload CSV / TSV" accept=".csv,.tsv,text/csv,text/tab-separated-values" multiple onFiles={(files) => onChange({ addFiles: files })} />
            <FileButton resetKey={uploadState.fileInputResetKey} label="Upload SDF" accept=".sdf,chemical/x-mdl-sdfile" multiple onFiles={(files) => onChange({ addFiles: files })} />
            <FileButton resetKey={uploadState.fileInputResetKey} label="Upload Ligand PDB" accept=".pdb,chemical/x-pdb" multiple onFiles={(files) => onChange({ addFiles: files })} />
            <FileButton resetKey={uploadState.fileInputResetKey} label="Select Structure Files" accept=".sdf,.pdb" multiple onFiles={(files) => onChange({ addFiles: files })} />
            <FileButton resetKey={uploadState.fileInputResetKey} label="Select Folder · SDF library" accept=".sdf" folder onFiles={(files) => onChange({ addFiles: files })} />
            <FileButton resetKey={uploadState.fileInputResetKey} label="Select Folder · PDB library" accept=".pdb" folder onFiles={(files) => onChange({ addFiles: files })} />
          </Stack>
          <Alert severity="info">{PDB_WARNING}</Alert>
          <TextField
            label="Explicit CSV/TSV structure column (when ambiguous)"
            placeholder="smiles or canonical_smiles"
            value={uploadState.selectedStructureColumn ?? ''}
            onChange={(event) => onChange({ selectedStructureColumn: event.target.value, error: '' })}
            helperText="Leave blank when the file has exactly one supported structure column. MolOptima will not guess between multiple plausible columns."
          />
          <Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} gap={1}>
              <Box>
                <Typography variant="subtitle2">Pending collection</Typography>
                <Typography color="text.secondary">
                  Selected files: {selection.total} · Supported: {selection.supported.length} · Unsupported: {selection.unsupported.length}
                  {uploadState.smilesText?.trim() ? ' · entered SMILES included' : ''}
                </Typography>
              </Box>
              <Button
                variant="text"
                type="button"
                disabled={!selection.total}
                onClick={() => onChange({ clearSelectedFiles: true })}
              >
                Clear selected files
              </Button>
            </Stack>
            {selection.total ? <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
              {visibleFiles.map((file) => <Chip key={file.webkitRelativePath || `${file.name}-${file.size}-${file.lastModified}`} label={file.webkitRelativePath || file.name} variant="outlined" />)}
              {hiddenFileCount > 0 ? <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>+ {hiddenFileCount} more</Typography> : null}
            </Stack> : null}
          </Box>
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
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant="contained" disabled={!canSubmit || uploadState.loading} onClick={onImport} startIcon={uploadState.loading ? <CircularProgress size={18} color="inherit" /> : null}>
              {uploadState.loading ? (progress?.status === 'finalizing' ? 'Finalizing import' : progress ? 'Importing molecules' : 'Validating collection') : 'Validate and load molecules'}
            </Button>
            {uploadState.loading && progress?.status === 'running' ? <Button variant="outlined" color="inherit" onClick={onCancelImport}>Cancel import</Button> : null}
          </Box>
        </Stack>
      </Paper>

      {upload ? <Paper elevation={0} sx={{ p: 3, border: '1px solid', borderColor: 'divider' }}>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={2}>
            <Box><Typography variant="h2">Input Summary</Typography><Typography color="text.secondary">{upload.filename}</Typography></Box>
            <Chip label={analysisModeLabel(upload.analysis_mode)} color={valid ? 'primary' : 'warning'} />
          </Stack>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(6, 1fr)' }, gap: 1 }}>
            {[
              ['Submitted', upload.submitted_count], ['Valid', upload.valid_count], ['Invalid', upload.invalid_count],
              ['Unresolved PDB', upload.unresolved_pdb_count], ['Duplicates', upload.duplicate_count], ['Ignored files', upload.ignored_file_count],
            ].map(([label, value]) => <Box key={label} sx={{ p: 1.25, bgcolor: '#f7f9fb', borderRadius: 1 }}><Typography variant="caption" color="text.secondary">{label}</Typography><Typography sx={{ fontWeight: 750, fontSize: 18 }}>{value ?? 0}</Typography></Box>)}
          </Box>
          <Alert severity={valid ? 'success' : 'warning'}>
            {valid ? `${valid} valid compound${valid === 1 ? '' : 's'} loaded. Mode: ${analysisModeLabel(upload.analysis_mode)}.` : 'No chemically valid compounds are available. Correct the input before continuing.'}
          </Alert>
          {upload.multi_record_sdf_count ? <Alert severity="error">MolOptima accepts one molecule per SDF file. For a molecular library, place individual SDF files in a folder or select multiple SDF files.</Alert> : null}
          {preview.length ? <Box sx={{ overflowX: 'auto' }}>
            <Typography variant="subtitle2" sx={{ mb: 0.75 }}>Actual-data preview</Typography>
            <Table size="small" aria-label="Molecule input preview" sx={{ minWidth: 1080 }}><TableHead><TableRow>
              <TableCell>molecule_id</TableCell><TableCell>source</TableCell><TableCell>filename</TableCell><TableCell>canonical_smiles</TableCell><TableCell>structure_status</TableCell><TableCell>coordinates</TableCell><TableCell>warnings</TableCell>
            </TableRow></TableHead><TableBody>{preview.map((row, index) => <TableRow key={`${row.molecule_id}-${index}`}>
              <TableCell>{row.molecule_id}</TableCell><TableCell>{row.source_type}</TableCell><TableCell>{row.source_filename || '—'}</TableCell>
              <TableCell sx={{ fontFamily: 'monospace', minWidth: 180 }}>{row.canonical_smiles || '—'}</TableCell><TableCell>{row.structure_status}</TableCell>
              <TableCell>{row.coordinate_status}</TableCell><TableCell sx={{ minWidth: 340 }}>{[...(row.warnings ?? []), row.failure_reason].filter(Boolean).join(' · ') || '—'}</TableCell>
            </TableRow>)}</TableBody></Table>
          </Box> : null}
          <Box><Button variant="contained" disabled={!valid} onClick={onContinue}>Continue to Receptor & Docking</Button></Box>
        </Stack>
      </Paper> : null}
    </Stack>
  );
}
