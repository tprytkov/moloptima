import React, { useDeferredValue, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  Alert,
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  CssBaseline,
  Divider,
  Drawer,
  FormControlLabel,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ThemeProvider,
  Tabs,
  Toolbar,
  Typography,
  createTheme,
} from '@mui/material';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import CloudQueueOutlinedIcon from '@mui/icons-material/CloudQueueOutlined';
import CloseIcon from '@mui/icons-material/Close';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';
import MedicationOutlinedIcon from '@mui/icons-material/MedicationOutlined';
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import moloptimaLogo from './assets/moloptima-logo.png';
import AdmetResultsSection, {
  aggregateAdmetFamilyStatus,
  deriveAdmetFamilyStatuses,
} from './AdmetResultsSection.jsx';
import AdmetPropertyTable, { AdmetFilterPanel } from './AdmetPropertyTable.jsx';
import AdmetPlots from './AdmetPlots.jsx';
import AdmetComparison from './AdmetComparison.jsx';
import AdmetExportActions from './AdmetExportActions.jsx';
import ChemicalSpaceWorkspace from './ChemicalSpaceWorkspace.jsx';
import ExperimentalDataWorkspace from './ExperimentalDataWorkspace.jsx';
import CompoundProfileIntegration from './CompoundProfileIntegration.jsx';
import AdmetModelInfo from './AdmetModelInfo.jsx';
import { normalizeAdmetAnalysis, searchAdmetMolecules } from './admetAnalysisData.js';
import { endpointMetadataFromMolecules } from './admetModelMetadata.js';
import { admetTableStateReducer, createEmptyAdmetFilters, filterAdmetMolecules } from './admetFilters.js';
import { addAdmetComparisonId, clearAdmetComparison, removeAdmetComparisonId } from './admetComparison.js';
import DockingResultsSection, { dockingStatusLabel } from './DockingResultsSection.jsx';
import DockingSetup from './DockingSetup.jsx';
import PrioritizationExplanationSection from './PrioritizationExplanationSection.jsx';
import PrioritizationAnalysisPanel from './PrioritizationAnalysisPanel.jsx';
import PrioritizationSettings from './PrioritizationSettings.jsx';
import MoleculeInputPanel from './MoleculeInputPanel.jsx';
import {
  applyMoleculeSelectionUpdate,
  filesForMoleculeValidation,
  pendingSelectionLimitError,
} from './moleculeSelection.js';
import {
  cleanupMoleculeImportJob,
  IMPORT_CHUNK_SIZE,
  importFailureState,
  runMoleculeImport,
} from './moleculeImportWorkflow.js';
import ResultsPackageDownloads from './ResultsPackageDownloads.jsx';
import {
  TERMINAL_JOB_STATUSES,
  mergeJobIntoHistory,
  pollJobUntilTerminal,
} from './jobWorkflow.js';
import { startBackendHealthPolling } from './backendHealth.js';

const drawerWidth = 216;
const apiBaseUrl = 'http://localhost:8000';
export const READABLE_CONTENT_MAX_WIDTH = 1440;
export const SUMMARY_CONTENT_MAX_WIDTH = 1200;

const SCIENTIFIC_VALUE_LABELS = {
  legacy_v1: 'Legacy v1 compatibility scoring',
  not_requested: 'Not requested',
  not_used: 'Not used',
  not_run: 'Not run',
  not_provided: 'Not provided',
  not_run_invalid_molecule: 'Not run — invalid molecule',
  unavailable: 'Unavailable',
  model_unavailable: 'Model unavailable',
  model_available: 'Model available',
  available: 'Available',
  checking: 'Checking',
  completed: 'Completed',
  failed: 'Failed',
  success: 'Successful',
  incompatible: 'Incompatible',
  error: 'Error',
  valid: 'Valid',
  invalid: 'Invalid',
  lookup_failed: 'Lookup failed',
  exact_match: 'Exact match',
  no_exact_match: 'No exact match',
  similarity_match: 'Similarity match',
  match_found: 'Match found',
  no_match: 'No match',
  closest_match_found: 'Closest match found',
  fresh_lookup: 'Fresh lookup',
  cache_hit: 'Cache hit',
  cache_miss: 'Cache miss',
  local_reference: 'Local reference',
  local_curated: 'Local curated reference',
  local: 'Local reference',
  user_supplied_pdbqt: 'User-supplied PDBQT',
  moloptima_prepared: 'Prepared by MolOptima',
  completed_with_warnings: 'Completed with warnings',
  heuristic_synthetic_accessibility: 'Heuristic synthetic accessibility',
};

const RUNTIME_SOURCE_LABELS = {
  application_process: 'Current application process',
  packaged: 'Packaged scientific runtime',
  explicit_override: 'Explicit runtime override',
  pending: 'Qualification pending',
  unavailable: 'Unavailable',
  test: 'Test runtime',
};

function humanizeIdentifier(value) {
  const text = String(value ?? '').trim();
  if (!text) return 'Not available';
  const words = text.replace(/[_-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function formatScientificPresentationValue(value) {
  if (value === null || value === undefined || value === '') return 'Not available';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return SCIENTIFIC_VALUE_LABELS[value] ?? String(value);
}

export function formatRuntimeSource(value) {
  if (value === null || value === undefined || value === '') return 'Not available';
  return RUNTIME_SOURCE_LABELS[value] ?? humanizeIdentifier(value);
}

export function resetPrimaryPageScroll(scrollContainer = globalThis.document?.scrollingElement) {
  scrollContainer?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
}

export function compactJobId(jobId, visibleLength = 8) {
  const value = String(jobId ?? '');
  return value.length > visibleLength ? `${value.slice(0, visibleLength)}…` : value;
}

export function compactLocalPath(value) {
  const path = String(value ?? '');
  return path.split(/[\\/]/).filter(Boolean).pop() || 'Not available';
}

export function currentJobStatusLabel(job) {
  const value = String(job?.status || job?.stage || 'Status unavailable').replace(/[_-]+/g, ' ');
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function revealCompoundDetail(detailElement) {
  if (!detailElement) return;
  detailElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
  detailElement.focus({ preventScroll: true });
}

export const PRIMARY_NAVIGATION = [
  {
    section: '', items: [
      { label: 'New Calculation', icon: AddCircleOutlineIcon },
    ],
  },
  {
    section: 'WORKFLOW', items: [
      { label: 'Molecules', step: 1, icon: UploadFileOutlinedIcon },
      { label: 'Experimental Data', step: 2, icon: ScienceOutlinedIcon },
      { label: 'Receptor & Docking', step: 3, icon: HubOutlinedIcon },
      { label: 'ADMET', step: 4, icon: MedicationOutlinedIcon },
      { label: 'Chemical Space', step: 5, icon: InsightsOutlinedIcon },
      { label: 'Prioritization', step: 6, icon: ScienceOutlinedIcon },
      { label: 'Results', step: 7, icon: FactCheckOutlinedIcon },
    ],
  },
  {
    section: 'ANALYSIS', items: [
      { label: 'Analysis', step: 8, icon: InsightsOutlinedIcon },
    ],
  },
  {
    section: 'SYSTEM', items: [
      { label: 'Settings', step: 9, icon: SettingsOutlinedIcon },
    ],
  },
];

const EMPTY_UPLOAD_STATE = Object.freeze({
  smilesText: '', selectedFiles: [], selectedStructureColumn: '', upload: null,
  loading: false, error: '', fileInputResetKey: 0, importProgress: null,
});
const EMPTY_PRIORITIZATION_STATE = Object.freeze({
  job: null, result: null, loading: false, error: '',
});
const EMPTY_TARGET_CONTEXT = Object.freeze({
  target_name: '', target_gene_symbol: '', target_uniprot_id: '', target_chembl_id: '',
  pdb_id: '', organism: '', disease_context: '', mechanism_context: '',
  docking_protocol_notes: '', binding_site_notes: '', enable_docking: true,
  receptor_id: '', docking_configuration_id: '', docking_center_x: '',
  docking_center_y: '', docking_center_z: '', docking_size_x: '', docking_size_y: '',
  docking_size_z: '', docking_exhaustiveness: '', docking_num_modes: '',
  docking_energy_range: '', docking_seed: '', docking_worker_count: '',
});

export function csvMoleculePreview(csvText, limit = 5) {
  const rows = String(csvText || '').split(/\r?\n/).filter((line) => line.trim());
  if (rows.length < 2) return [];
  const parse = (line) => {
    const values = [];
    let value = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === '"' && quoted && line[index + 1] === '"') {
        value += '"'; index += 1;
      } else if (character === '"') quoted = !quoted;
      else if (character === ',' && !quoted) { values.push(value.trim()); value = ''; }
      else value += character;
    }
    values.push(value.trim());
    return values;
  };
  const headers = parse(rows[0]).map((header) => header.toLowerCase());
  const moleculeIndex = headers.indexOf('molecule_id');
  const smilesIndex = headers.indexOf('smiles');
  return rows.slice(1, limit + 1).map((line, index) => {
    const values = parse(line);
    return {
      moleculeId: moleculeIndex >= 0 ? values[moleculeIndex] : String(index + 1),
      smiles: smilesIndex >= 0 ? values[smilesIndex] : '',
    };
  });
}

export function deriveWorkflowStatuses({ uploadState, targetContext, prioritizationState }) {
  const terminal = TERMINAL_JOB_STATUSES.has(prioritizationState.job?.status);
  const completed = Boolean(prioritizationState.result);
  const running = Boolean(prioritizationState.loading && !terminal);
  const failed = Boolean(terminal && !completed && prioritizationState.error);
  const uploaded = validatedMoleculeCount(uploadState.upload) > 0;
  const dockingConfigured = Boolean(targetContext.docking_configuration_id);
  const stage = String(prioritizationState.job?.stage || '').toLowerCase();
  const admetPresent = Boolean(prioritizationState.result?.results?.some((row) => (
    row.admet_model_status || row.bbb_model_status || row.admet_regression
  )));
  const dockingPresent = Boolean(prioritizationState.result?.results?.some((row) => row.docking_result));
  return {
    Molecules: uploaded || completed ? 'Complete'
      : uploadState.selectedFiles?.length || uploadState.smilesText?.trim() ? 'Ready' : 'Not started',
    'Receptor & Docking': dockingPresent ? 'Complete' : running && stage.includes('dock')
      ? 'Running' : dockingConfigured ? 'Ready' : uploaded ? 'Needs attention' : 'Not started',
    ADMET: admetPresent ? 'Complete' : running && stage.includes('admet')
      ? 'Running' : uploaded ? 'Ready' : 'Not started',
    Prioritization: completed ? 'Complete' : running ? 'Running' : failed
      ? 'Needs attention' : uploaded ? 'Ready' : 'Not started',
    Results: completed ? 'Complete' : running ? 'Running' : failed ? 'Needs attention' : 'Not started',
    Analysis: completed ? 'Ready' : 'Not started',
  };
}

export function validatedMoleculeCount(upload) {
  const count = Number(upload?.valid_count);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

const theme = createTheme({
  palette: {
    mode: 'light',
    background: {
      default: '#f6f8fb',
      paper: '#ffffff',
    },
    primary: {
      main: '#145f74',
    },
    secondary: {
      main: '#2f8f6f',
    },
    text: {
      primary: '#18232f',
      secondary: '#5b6777',
    },
    divider: '#d9e2ea',
  },
  shape: {
    borderRadius: 8,
  },
  typography: {
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h1: {
      fontSize: '1.55rem',
      fontWeight: 700,
      lineHeight: 1.2,
      letterSpacing: 0,
    },
    h2: {
      fontSize: '1.1rem',
      fontWeight: 700,
      lineHeight: 1.3,
      letterSpacing: 0,
    },
    body1: {
      fontSize: '0.9rem',
      lineHeight: 1.5,
    },
    button: {
      textTransform: 'none',
      fontWeight: 650,
    },
  },
  components: {
    MuiToolbar: { styleOverrides: { root: { minHeight: 52 } } },
    MuiTableCell: { styleOverrides: { root: { paddingTop: 7, paddingBottom: 7, fontSize: '0.78rem' } } },
    MuiButton: { defaultProps: { size: 'small' } },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiChip: { defaultProps: { size: 'small' } },
  },
});

function App() {
  const [activeItem, setActiveItem] = useState('New Calculation');
  const previousActiveItem = useRef(activeItem);
  const [uploadState, setUploadState] = useState({ ...EMPTY_UPLOAD_STATE });
  const activeImportRef = useRef(null);
  const [prioritizationState, setPrioritizationState] = useState({ ...EMPTY_PRIORITIZATION_STATE });
  const [latestRunState, setLatestRunState] = useState({
    job: null,
    result: null,
    loading: true,
    error: '',
  });
  const [sourceStatusState, setSourceStatusState] = useState({
    payload: null,
    loading: false,
    error: '',
  });
  const [runHistoryState, setRunHistoryState] = useState({
    jobs: [],
    loading: true,
    error: '',
    selectedJobId: '',
  });
  const [annotationsState, setAnnotationsState] = useState({
    jobId: '',
    annotations: {},
    loading: false,
    saving: false,
    error: '',
    updatedAt: null,
  });
  const [pubchemLookupEnabled, setPubchemLookupEnabled] = useState(false);
  const [chemblLookupEnabled, setChemblLookupEnabled] = useState(false);
  const [patentLookupEnabled, setPatentLookupEnabled] = useState(false);
  const [targetReferenceEnabled, setTargetReferenceEnabled] = useState(false);
  const [prioritizationSettings, setPrioritizationSettings] = useState({
    method: 'legacy_v1', profile: null, validation: null,
  });
  const [targetContext, setTargetContext] = useState({ ...EMPTY_TARGET_CONTEXT });
  const health = useBackendHealth();
  const healthRef = useRef(health);
  healthRef.current = health;
  const annotatedPrioritizationState = useMemo(
    () => annotateAnalysisState(prioritizationState, annotationsState),
    [prioritizationState, annotationsState],
  );
  const annotatedLatestRunState = useMemo(
    () => annotateAnalysisState(latestRunState, annotationsState),
    [latestRunState, annotationsState],
  );

  useEffect(() => {
    let isMounted = true;

    async function loadLatestRun() {
      try {
        const payload = await apiRequest('/api/jobs/latest');
        if (!isMounted) {
          return;
        }
        if (payload.job) {
          const completeMetadata = payload.job.job_id
            ? await apiRequest(`/api/jobs/${payload.job.job_id}`).catch(() => ({}))
            : {};
          if (!isMounted) return;
          const hydratedJob = { ...payload.job, ...completeMetadata, results: payload.job.results };
          const latestJob = latestJobMetadata(hydratedJob);
          setLatestRunState({
            job: latestJob,
            result: hydratedJob,
            loading: false,
            error: '',
          });
          setPrioritizationState({
            job: latestJob,
            result: hydratedJob,
            loading: false,
            error: '',
          });
          setRunHistoryState((current) => ({ ...current, selectedJobId: latestJob.job_id }));
          await loadAnnotationsForJob(latestJob.job_id);
        } else {
          setLatestRunState({ job: null, result: null, loading: false, error: '' });
        }
      } catch (error) {
        if (isMounted) {
          setLatestRunState({
            job: null,
            result: null,
            loading: false,
            error: readableError(error),
          });
        }
      }
    }

    loadLatestRun();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadRunHistory() {
      try {
        const payload = await apiRequest('/api/jobs/history');
        if (isMounted) {
          setRunHistoryState((current) => ({
            ...current,
            jobs: payload.jobs ?? [],
            loading: false,
            error: '',
          }));
        }
      } catch (error) {
        if (isMounted) {
          setRunHistoryState((current) => ({
            ...current,
            loading: false,
            error: readableError(error),
          }));
        }
      }
    }

    loadRunHistory();
    return () => {
      isMounted = false;
    };
  }, []);

  async function handleUpload() {
    const uploadableFiles = filesForMoleculeValidation(uploadState.selectedFiles);
    const selectionError = pendingSelectionLimitError(uploadState.selectedFiles, uploadState.smilesText);
    if (health.status !== 'online') {
      setUploadState((current) => ({ ...current, error: 'Validation requires the MolOptima backend. Your selected files are preserved.' }));
      return;
    }
    if (!uploadState.smilesText?.trim() && !uploadableFiles.length) {
      setUploadState((current) => ({ ...current, error: 'Enter SMILES or select molecule files before validating.' }));
      return;
    }
    if (selectionError) {
      setUploadState((current) => ({ ...current, error: selectionError }));
      return;
    }

    const activeImport = {
      controller: new AbortController(), importJobId: '', progress: null, cancelled: false,
    };
    activeImportRef.current = activeImport;
    setUploadState((current) => ({ ...current, loading: true, error: '', importProgress: null }));

    try {
      const payload = await runMoleculeImport({
        files: uploadableFiles,
        smilesText: uploadState.smilesText ?? '',
        selectedStructureColumn: uploadState.selectedStructureColumn ?? '',
        request: apiRequest,
        isOnline: () => healthRef.current.status === 'online',
        signal: activeImport.controller.signal,
        onJobCreated: (importJobId) => {
          activeImport.importJobId = importJobId;
          const progress = {
            mode: 'chunked', status: 'running', processedFiles: 0,
            totalFiles: uploadableFiles.length, parsedRecords: 0, batchNumber: 0,
            totalBatches: Math.ceil(uploadableFiles.length / IMPORT_CHUNK_SIZE),
          };
          activeImport.progress = progress;
          setUploadState((current) => ({ ...current, importProgress: progress }));
        },
        onProgress: (progress) => {
          activeImport.progress = progress;
          setUploadState((current) => ({ ...current, importProgress: progress }));
        },
      });
      setPrioritizationState({ job: null, result: null, loading: false, error: '' });
      setUploadState((current) => ({
        ...current,
        upload: payload,
        loading: false,
        error: '',
        importProgress: null,
      }));
    } catch (error) {
      await cleanupMoleculeImportJob(activeImport.importJobId, apiRequest);
      const prefix = activeImport.progress
        ? `Import stopped after ${activeImport.progress.processedFiles.toLocaleString()} / ${activeImport.progress.totalFiles.toLocaleString()} files. `
        : '';
      const message = activeImport.cancelled ? `${prefix}Import cancelled.` : `${prefix}${readableError(error)}`;
      setUploadState((current) => importFailureState(current, message, activeImport.progress));
    } finally {
      if (activeImportRef.current === activeImport) activeImportRef.current = null;
    }
  }

  function handleCancelMoleculeImport() {
    const activeImport = activeImportRef.current;
    if (!activeImport || activeImport.progress?.status === 'finalizing') return;
    activeImport.cancelled = true;
    activeImport.controller.abort();
  }

  function handleMoleculeInputChange(update) {
    setUploadState((current) => applyMoleculeSelectionUpdate(current, update));
  }

  function handleNewCalculation() {
    setUploadState({ ...EMPTY_UPLOAD_STATE });
    setPrioritizationState({ ...EMPTY_PRIORITIZATION_STATE });
    setTargetContext({ ...EMPTY_TARGET_CONTEXT });
    setPrioritizationSettings({ method: 'legacy_v1', profile: null, validation: null });
    setPubchemLookupEnabled(false);
    setChemblLookupEnabled(false);
    setPatentLookupEnabled(false);
    setTargetReferenceEnabled(false);
    setActiveItem('Molecules');
  }

  function handleDockingSetupConfirmed({ receptor, configuration }) {
    setTargetContext((current) => ({
      ...current,
      receptor_id: receptor.receptor_id,
      docking_configuration_id: configuration.configuration_id,
      docking_center_x: configuration.center_x,
      docking_center_y: configuration.center_y,
      docking_center_z: configuration.center_z,
      docking_size_x: configuration.size_x,
      docking_size_y: configuration.size_y,
      docking_size_z: configuration.size_z,
      docking_exhaustiveness: configuration.exhaustiveness,
      docking_num_modes: configuration.num_modes,
      docking_energy_range: configuration.energy_range ?? '',
      docking_seed: configuration.seed,
      docking_worker_count: configuration.worker_count,
    }));
  }

  async function handleStartPrioritization() {
    const uploadId = uploadState.upload?.upload_id;
    if (!uploadId || validatedMoleculeCount(uploadState.upload) === 0) {
      setPrioritizationState((current) => ({
        ...current,
        error: 'Load at least one valid molecule before starting prioritization.',
      }));
      return;
    }
    if (prioritizationSettings.method === 'v2' && !prioritizationSettings.validation?.scoreable) {
      setPrioritizationState((current) => ({
        ...current,
        error: 'Prioritization v2 requires a complete profile that passes backend scoring validation.',
      }));
      return;
    }

    setPrioritizationState({ job: null, result: null, loading: true, error: '' });

    try {
      const job = await apiRequest('/api/jobs/prioritization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          upload_id: uploadId,
          prioritization_method: prioritizationSettings.method,
          prioritization_profile: prioritizationSettings.method === 'v2'
            ? prioritizationSettings.profile
            : null,
          enable_pubchem_lookup: pubchemLookupEnabled,
          enable_chembl_lookup: chemblLookupEnabled,
          enable_patent_lookup: patentLookupEnabled,
          enable_target_reference_discovery: targetReferenceEnabled,
          ...targetContext,
          ...normalizedDockingRequest(targetContext),
        }),
      });
      setPrioritizationState({ job, result: null, loading: true, error: '' });
      setRunHistoryState((current) => ({
        ...current,
        selectedJobId: job.job_id,
        jobs: mergeJobIntoHistory(current.jobs, job),
      }));
      const terminalJob = await pollJobUntilTerminal(job.job_id, {
        request: apiRequest,
        onUpdate: (currentJob) => {
          setPrioritizationState((current) => ({ ...current, job: currentJob }));
          setRunHistoryState((current) => ({
            ...current,
            selectedJobId: currentJob.job_id,
            jobs: mergeJobIntoHistory(current.jobs, currentJob),
          }));
        },
      });
      if (terminalJob.status === 'completed' || terminalJob.status === 'completed_with_warnings') {
        const [result, sourceStatus] = await Promise.all([
          apiRequest(`/api/results/${job.job_id}`),
          apiRequest('/api/model-sources/status'),
        ]);
        setPrioritizationState({ job: terminalJob, result, loading: false, error: '' });
        setLatestRunState({ job: terminalJob, result, loading: false, error: '' });
        await loadAnnotationsForJob(job.job_id);
        setSourceStatusState({ payload: sourceStatus, loading: false, error: '' });
      } else {
        setPrioritizationState({
          job: terminalJob,
          result: null,
          loading: false,
          error: terminalJob.error_message || `Job ${terminalJob.status}.`,
        });
      }
    } catch (error) {
      setPrioritizationState((current) => ({
        ...current,
        loading: false,
        error: readableError(error),
      }));
    }
  }

  async function handleCancelPrioritization() {
    const jobId = prioritizationState.job?.job_id;
    if (!jobId || TERMINAL_JOB_STATUSES.has(prioritizationState.job.status)) {
      return;
    }
    try {
      const job = await apiRequest(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
      setPrioritizationState((current) => ({ ...current, job }));
      setRunHistoryState((current) => ({
        ...current,
        jobs: mergeJobIntoHistory(current.jobs, job),
      }));
    } catch (error) {
      setPrioritizationState((current) => ({ ...current, error: readableError(error) }));
    }
  }

  async function handleLoadHistoricalRun(jobId) {
    if (!jobId) {
      return;
    }
    setRunHistoryState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const result = await apiRequest(`/api/results/${jobId}`);
      const job = latestJobMetadata(result);
      setPrioritizationState({ job, result, loading: false, error: '' });
      setLatestRunState({ job, result, loading: false, error: '' });
      await loadAnnotationsForJob(jobId);
      setRunHistoryState((current) => ({
        ...current,
        selectedJobId: jobId,
        loading: false,
        error: '',
        jobs: mergeJobIntoHistory(current.jobs, job),
      }));
      setActiveItem('Molecular Prioritization');
    } catch (error) {
      setRunHistoryState((current) => ({
        ...current,
        loading: false,
        error: readableError(error),
      }));
    }
  }

  async function loadAnnotationsForJob(jobId) {
    if (!jobId) {
      setAnnotationsState({
        jobId: '',
        annotations: {},
        loading: false,
        saving: false,
        error: '',
        updatedAt: null,
      });
      return;
    }
    setAnnotationsState((current) => ({
      ...current,
      jobId,
      loading: true,
      error: '',
    }));
    try {
      const payload = await apiRequest(`/api/jobs/${jobId}/annotations`);
      setAnnotationsState({
        jobId,
        annotations: payload.annotations ?? {},
        loading: false,
        saving: false,
        error: '',
        updatedAt: payload.updated_at ?? null,
      });
    } catch (error) {
      setAnnotationsState({
        jobId,
        annotations: {},
        loading: false,
        saving: false,
        error: readableError(error),
        updatedAt: null,
      });
    }
  }

  async function handleSaveReviewAnnotation(annotationKey, annotation) {
    const jobId = annotatedLatestRunState.job?.job_id ?? annotatedPrioritizationState.job?.job_id ?? '';
    if (!jobId || !annotationKey) {
      return;
    }
    const nextAnnotations = {
      ...annotationsState.annotations,
      [annotationKey]: {
        review_status: annotation.review_status || 'unreviewed',
        review_note: annotation.review_note || '',
      },
    };
    setAnnotationsState((current) => ({
      ...current,
      jobId,
      annotations: nextAnnotations,
      saving: true,
      error: '',
    }));
    try {
      const payload = await apiRequest(`/api/jobs/${jobId}/annotations`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotations: nextAnnotations }),
      });
      setAnnotationsState({
        jobId,
        annotations: payload.annotations ?? {},
        loading: false,
        saving: false,
        error: '',
        updatedAt: payload.updated_at ?? null,
      });
    } catch (error) {
      setAnnotationsState((current) => ({
        ...current,
        saving: false,
        error: readableError(error),
      }));
    }
  }

  async function handleRefreshRunHistory() {
    setRunHistoryState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const payload = await apiRequest('/api/jobs/history');
      setRunHistoryState((current) => ({
        ...current,
        jobs: payload.jobs ?? [],
        loading: false,
        error: '',
      }));
    } catch (error) {
      setRunHistoryState((current) => ({
        ...current,
        loading: false,
        error: readableError(error),
      }));
    }
  }

  async function handleCheckLocalModelCache() {
    setSourceStatusState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const payload = await apiRequest('/api/model-sources/status');
      setSourceStatusState({ payload, loading: false, error: '' });
    } catch (error) {
      setSourceStatusState((current) => ({
        ...current,
        loading: false,
        error: readableError(error),
      }));
    }
  }

  async function handleRefreshSourceStatus() {
    setSourceStatusState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const payload = await apiRequest('/api/model-sources/refresh', { method: 'POST' });
      setSourceStatusState({ payload, loading: false, error: '' });
    } catch (error) {
      setSourceStatusState((current) => ({
        ...current,
        loading: false,
        error: readableError(error),
      }));
    }
  }

  const workflowStatuses = deriveWorkflowStatuses({ uploadState, targetContext, prioritizationState });

  useEffect(() => {
    if (previousActiveItem.current !== activeItem) {
      resetPrimaryPageScroll();
      previousActiveItem.current = activeItem;
    }
  }, [activeItem]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: '100vh', display: 'flex', bgcolor: 'background.default' }}>
        <Sidebar
          activeItem={activeItem}
          onSelect={setActiveItem}
          onNewCalculation={handleNewCalculation}
        />
        <Box component="main" sx={{ flexGrow: 1, minWidth: 0 }}>
          <AppHeader activeItem={activeItem} health={health} />
          <Box sx={{ px: { xs: 2, md: 3 }, py: 2.5, width: '100%' }}>
            <ActivePage
              activeItem={activeItem}
              health={health}
              uploadState={uploadState}
              setUploadState={setUploadState}
              prioritizationState={annotatedPrioritizationState}
              latestRunState={annotatedLatestRunState}
              runHistoryState={runHistoryState}
              annotationsState={annotationsState}
              sourceStatusState={sourceStatusState}
              onUpload={handleUpload}
              onCancelMoleculeImport={handleCancelMoleculeImport}
              onMoleculeInputChange={handleMoleculeInputChange}
              onDockingSetupConfirmed={handleDockingSetupConfirmed}
              onStartPrioritization={handleStartPrioritization}
              onCancelPrioritization={handleCancelPrioritization}
              onLoadHistoricalRun={handleLoadHistoricalRun}
              onRefreshRunHistory={handleRefreshRunHistory}
              pubchemLookupEnabled={pubchemLookupEnabled}
              setPubchemLookupEnabled={setPubchemLookupEnabled}
              chemblLookupEnabled={chemblLookupEnabled}
              setChemblLookupEnabled={setChemblLookupEnabled}
              patentLookupEnabled={patentLookupEnabled}
              setPatentLookupEnabled={setPatentLookupEnabled}
              targetReferenceEnabled={targetReferenceEnabled}
              setTargetReferenceEnabled={setTargetReferenceEnabled}
              targetContext={targetContext}
              setTargetContext={setTargetContext}
              prioritizationSettings={prioritizationSettings}
              setPrioritizationSettings={setPrioritizationSettings}
              onCheckLocalModelCache={handleCheckLocalModelCache}
              onRefreshSourceStatus={handleRefreshSourceStatus}
              onSaveReviewAnnotation={handleSaveReviewAnnotation}
              onNavigate={setActiveItem}
              onNewCalculation={handleNewCalculation}
              workflowStatuses={workflowStatuses}
            />
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  );
}

function Sidebar({ activeItem, onSelect, onNewCalculation }) {
  return (
    <Drawer
      variant="permanent"
      sx={{
        width: drawerWidth,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: drawerWidth,
          boxSizing: 'border-box',
          borderRightColor: 'divider',
          bgcolor: '#ffffff',
        },
      }}
    >
      <Toolbar sx={{ alignItems: 'center', gap: 1.25, px: 2 }}>
        <Box
          component="img"
          src={moloptimaLogo}
          alt="MolOptima"
          sx={{ width: '100%', maxWidth: 180, height: 'auto', display: 'block' }}
        />
      </Toolbar>
      <Divider />
      <Box sx={{ px: 1, py: 1.25 }}>
        {PRIMARY_NAVIGATION.map((group) => (
          <Box key={group.section || 'primary'} sx={{ mb: group.section ? 1.25 : 1.5 }}>
            {group.section ? (
              <Typography variant="overline" color="text.secondary" sx={{ px: 1.25, fontSize: 10, letterSpacing: '0.09em' }}>
                {group.section}
              </Typography>
            ) : null}
            <List disablePadding>
              {group.items.map(({ label, step, icon: Icon }) => (
                <ListItemButton
                  key={label}
                  selected={activeItem === label}
                  onClick={() => label === 'New Calculation' ? onNewCalculation() : onSelect(label)}
                  sx={{
                    mb: 0.25, px: 1.25, borderRadius: 1, minHeight: 38,
                    '&.Mui-selected': { bgcolor: 'rgba(20, 95, 116, 0.1)', color: 'primary.main' },
                    '&.Mui-selected:hover': { bgcolor: 'rgba(20, 95, 116, 0.14)' },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 32, color: 'inherit' }}><Icon sx={{ fontSize: 19 }} /></ListItemIcon>
                  <ListItemText
                    primary={`${step ? `${step}. ` : ''}${label}`}
                    primaryTypographyProps={{ fontSize: 12.5, fontWeight: activeItem === label ? 700 : 550 }}
                  />
                </ListItemButton>
              ))}
            </List>
          </Box>
        ))}
      </Box>
    </Drawer>
  );
}

function AppHeader({ activeItem, health }) {
  return (
    <AppBar
      position="sticky"
      color="inherit"
      elevation={0}
      sx={{ borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}
    >
      <Toolbar sx={{ justifyContent: 'space-between', px: { xs: 2, md: 3 } }}>
        <Typography variant="h2">{activeItem}</Typography>
        <HealthChip health={health} />
      </Toolbar>
    </AppBar>
  );
}

function ActivePage({
  activeItem,
  health,
  uploadState,
  setUploadState,
  prioritizationState,
  latestRunState,
  runHistoryState,
  annotationsState,
  sourceStatusState,
  onUpload,
  onCancelMoleculeImport,
  onMoleculeInputChange,
  onDockingSetupConfirmed,
  onStartPrioritization,
  onCancelPrioritization,
  onLoadHistoricalRun,
  onRefreshRunHistory,
  onSaveReviewAnnotation,
  pubchemLookupEnabled,
  setPubchemLookupEnabled,
  chemblLookupEnabled,
  setChemblLookupEnabled,
  patentLookupEnabled,
  setPatentLookupEnabled,
  targetReferenceEnabled,
  setTargetReferenceEnabled,
  targetContext,
  setTargetContext,
  prioritizationSettings,
  setPrioritizationSettings,
  onCheckLocalModelCache,
  onRefreshSourceStatus,
  onNavigate,
  onNewCalculation,
  workflowStatuses,
}) {
  if (activeItem === 'New Calculation') {
    return (
      <NewCalculationPage
        workflowStatuses={workflowStatuses}
        onStart={onNewCalculation}
        currentJob={prioritizationState.job}
        analysisMode={uploadState.upload?.analysis_mode}
      />
    );
  }

  if (activeItem === 'Molecules' || activeItem === 'Upload Molecules') {
    return (
      <UploadMoleculesPage
        backendHealth={health}
        uploadState={uploadState}
        onUpload={onUpload}
        onCancelImport={onCancelMoleculeImport}
        onChange={onMoleculeInputChange}
        onContinue={() => onNavigate('Receptor & Docking')}
      />
    );
  }

  if (activeItem === 'Receptor & Docking') {
    return (
      <DockingWorkflowPage
        uploadState={uploadState}
        prioritizationState={prioritizationState}
        targetContext={targetContext}
        onDockingSetupConfirmed={onDockingSetupConfirmed}
        onRunDocking={onStartPrioritization}
        onNavigate={onNavigate}
      />
    );
  }

  if (activeItem === 'Experimental Data') {
    return <ExperimentalDataWorkspace upload={uploadState.upload} baseUrl={apiBaseUrl} />;
  }

  if (activeItem === 'ADMET') {
    return (
      <AdmetWorkflowPage
        prioritizationState={prioritizationState}
        sourceStatusState={sourceStatusState}
        onNavigate={onNavigate}
      />
    );
  }

  if (activeItem === 'Chemical Space') {
    return <ChemicalSpaceWorkspace upload={uploadState.upload} admetRows={prioritizationState.result?.results ?? []} baseUrl={apiBaseUrl} />;
  }

  if (activeItem === 'Prioritization' || activeItem === 'Molecular Prioritization') {
    return (
      <PrioritizationPage
        uploadState={uploadState}
        prioritizationState={prioritizationState}
        onStartPrioritization={onStartPrioritization}
        onCancelPrioritization={onCancelPrioritization}
        onDockingSetupConfirmed={onDockingSetupConfirmed}
        pubchemLookupEnabled={pubchemLookupEnabled}
        setPubchemLookupEnabled={setPubchemLookupEnabled}
        chemblLookupEnabled={chemblLookupEnabled}
        setChemblLookupEnabled={setChemblLookupEnabled}
        patentLookupEnabled={patentLookupEnabled}
        setPatentLookupEnabled={setPatentLookupEnabled}
        targetReferenceEnabled={targetReferenceEnabled}
        setTargetReferenceEnabled={setTargetReferenceEnabled}
        targetContext={targetContext}
        setTargetContext={setTargetContext}
        prioritizationSettings={prioritizationSettings}
        setPrioritizationSettings={setPrioritizationSettings}
        annotationsState={annotationsState}
        onSaveReviewAnnotation={onSaveReviewAnnotation}
        onNavigate={onNavigate}
      />
    );
  }

  if (activeItem === 'Results') {
    return (
      <ResultsWorkflowPage
        prioritizationState={prioritizationState}
        upload={uploadState.upload}
        annotationsState={annotationsState}
        onSaveReviewAnnotation={onSaveReviewAnnotation}
      />
    );
  }

  if (activeItem === 'Analysis') {
    return (
      <AnalysisWorkflowPage
        currentRunState={prioritizationState}
        annotationsState={annotationsState}
        onSaveReviewAnnotation={onSaveReviewAnnotation}
        prioritizationSettings={prioritizationSettings}
      />
    );
  }

  if (activeItem === 'Biopharma Intelligence') {
    return (
      <BiopharmaIntelligencePage
        latestRunState={latestRunState}
        annotationsState={annotationsState}
        onSaveReviewAnnotation={onSaveReviewAnnotation}
      />
    );
  }

  if (activeItem === 'Run History') {
    return (
      <RunHistoryPage
        runHistoryState={runHistoryState}
        loadedJobId={latestRunState.job?.job_id ?? prioritizationState.job?.job_id ?? ''}
        onLoadHistoricalRun={onLoadHistoricalRun}
        onRefreshRunHistory={onRefreshRunHistory}
      />
    );
  }

  if (activeItem === 'Run Comparison') {
    return (
      <RunComparisonPage
        runHistoryState={runHistoryState}
        onRefreshRunHistory={onRefreshRunHistory}
      />
    );
  }

  if (activeItem === 'Reports') {
    return (
      <ReportsPage
        latestRunState={latestRunState}
        annotationsState={annotationsState}
        onSaveReviewAnnotation={onSaveReviewAnnotation}
      />
    );
  }

  if (activeItem === 'Settings') {
    return (
      <ModelDataSourcesPage
        sourceStatusState={sourceStatusState}
        onCheckLocalModelCache={onCheckLocalModelCache}
        onRefreshSourceStatus={onRefreshSourceStatus}
      />
    );
  }

  return <DashboardPage health={health} activeItem={activeItem} latestRunState={latestRunState} />;
}

const WORKFLOW_STEPS = ['Molecules', 'Receptor & Docking', 'ADMET', 'Prioritization', 'Results', 'Analysis'];

function WorkflowStatusChip({ status }) {
  const color = status === 'Complete' ? 'success' : status === 'Running' ? 'primary'
    : status === 'Needs attention' ? 'warning' : 'default';
  return <Chip label={status} color={color} variant={status === 'Not started' ? 'outlined' : 'filled'} />;
}

export function NewCalculationPage({ workflowStatuses, onStart, currentJob, analysisMode }) {
  const single = analysisMode === 'single_compound';
  const steps = single
    ? ['Molecule', 'Receptor & Docking', 'ADMET', 'Compound Assessment', 'Results']
    : WORKFLOW_STEPS;
  return (
    <Stack spacing={2} sx={{ width: '100%', maxWidth: READABLE_CONTENT_MAX_WIDTH, mx: 'auto' }}>
      <PageIntro
        title="New Calculation"
        description="Integrated molecular docking, ADMET prediction, and multiparameter molecular prioritization."
      />
      <Paper elevation={0} sx={{ p: 2.5, border: '1px solid', borderColor: 'divider' }}>
        <Stack spacing={2.5}>
          <Box>
            <Typography variant="h2">Scientific workflow</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              {single
                ? 'One valid compound loaded: molecular properties, ADMET, optional docking, and profile interpretation are available without library ranking.'
                : 'Begin with molecules, configure receptor-specific docking, then run the existing local scientific pipeline.'}
            </Typography>
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(6, minmax(0, 1fr))' }, gap: 1 }}>
            {steps.map((step, index) => (
              <Box key={step} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1, minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary">Step {index + 1}</Typography>
                <Typography sx={{ fontWeight: 700, my: 0.75, fontSize: 13 }}>{step}</Typography>
                <WorkflowStatusChip status={workflowStatuses[step === 'Molecule' ? 'Molecules' : step === 'Compound Assessment' ? 'Prioritization' : step] || 'Not started'} />
              </Box>
            ))}
          </Box>
          {currentJob ? (
            <Typography variant="caption" color="text.secondary">
              Current job:{' '}
              <Box
                component="span"
                title={`Full job ID: ${currentJob.job_id}`}
                sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace' }}
              >
                {compactJobId(currentJob.job_id)}
              </Box>
              {' · '}{currentJobStatusLabel(currentJob)}
            </Typography>
          ) : null}
          <Box><Button variant="contained" onClick={onStart}>Start New Calculation</Button></Box>
        </Stack>
      </Paper>
    </Stack>
  );
}

export function DockingWorkflowPage({
  uploadState, prioritizationState, targetContext, onDockingSetupConfirmed, onRunDocking, onNavigate,
}) {
  const rows = prioritizationState.result?.results ?? [];
  const dockedRows = rows.filter((row) => row.docking_result);
  const [selectedKey, setSelectedKey] = useState('');
  const selected = dockedRows.find((row, index) => compoundRowKey(row, index) === selectedKey) ?? null;
  const validMoleculeCount = validatedMoleculeCount(uploadState.upload);
  const submittedMoleculeCount = Number(uploadState.upload?.submitted_count ?? uploadState.upload?.rows ?? 0);
  const hasValidMolecules = validMoleculeCount > 0;
  const ready = Boolean(hasValidMolecules && targetContext.docking_configuration_id);
  const successfulDocking = dockedRows.filter((row) => row.docking_result?.status === 'success').length;
  const vinaVersion = dockedRows.find((row) => row.docking_result?.vina_version)?.docking_result?.vina_version;
  const single = uploadState.upload?.analysis_mode === 'single_compound';
  return (
    <Stack spacing={2}>
      <PageIntro title="Receptor & Docking" description="Inspect the visualization structure, attach a prepared receptor, define an explicit binding-site box, and run the existing Vina workflow." />
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.65fr) minmax(300px, 0.75fr)' }, gap: 2, alignItems: 'start' }}>
        <DockingSetup apiBaseUrl={apiBaseUrl} onConfirmed={onDockingSetupConfirmed} />
        <Paper elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
          <Stack spacing={1.5}>
            <Typography variant="h2">Docking run</Typography>
            <WorkflowStatusChip status={ready ? 'Ready' : uploadState.upload ? 'Needs attention' : 'Not started'} />
            <Typography color="text.secondary">
              {uploadState.upload
                ? `${submittedMoleculeCount} submitted; ${validMoleculeCount} valid molecule${validMoleculeCount === 1 ? '' : 's'} available.`
                : 'Upload molecules before docking.'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Run Docking starts the existing combined local calculation; ADMET and {single ? 'compound assessment' : 'prioritization'} continue in the same auditable job.
            </Typography>
            <Typography component="div" variant="caption" color="text.secondary">Ligand preparation: RDKit 3D → Open Babel PDBQT</Typography>
            <Typography component="div" variant="caption" color="text.secondary">Vina runtime: {vinaVersion ? `available · ${vinaVersion}` : 'not yet verified for this calculation'}</Typography>
            <Typography component="div" variant="caption" color="text.secondary">Receptor: validated prepared PDBQT required</Typography>
            <Button variant="contained" disabled={!ready || prioritizationState.loading} onClick={onRunDocking}>
              {prioritizationState.loading ? 'Calculation running' : 'Run Docking'}
            </Button>
            <Button data-testid="continue-to-admet" variant="outlined" disabled={!hasValidMolecules} onClick={() => onNavigate('ADMET')}>Continue to ADMET</Button>
            {prioritizationState.error ? <Alert severity="error">{prioritizationState.error}</Alert> : null}
          </Stack>
        </Paper>
      </Box>
      {dockedRows.length ? (
        <Paper elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1} sx={{ mb: 1 }}><Box><Typography variant="h2">Current docking results</Typography><Typography variant="caption" color="text.secondary">Successful: {successfulDocking} / {dockedRows.length}</Typography></Box><Button variant="outlined" disabled={!dockedRows.length} onClick={() => setSelectedKey(compoundRowKey(dockedRows[0], 0))}>View Docking Results</Button></Stack>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" aria-label="Current docking results" sx={{ minWidth: 760 }}><TableHead><TableRow><TableCell>Molecule</TableCell><TableCell>Best affinity (kcal/mol)</TableCell><TableCell>Best mode</TableCell><TableCell>Modes returned</TableCell><TableCell>Status</TableCell><TableCell align="right">Action</TableCell></TableRow></TableHead>
              <TableBody>{dockedRows.map((row, index) => {
                const result = row.docking_result || {};
                const key = compoundRowKey(row, index);
                const moleculeLabel = row.molecule_id || row.canonical_smiles || `Molecule ${index + 1}`;
                return <TableRow hover selected={selectedKey === key} key={key}>
                  <TableCell sx={{ maxWidth: 280, overflowWrap: 'anywhere' }}>{moleculeLabel}</TableCell>
                  <TableCell>{formatDetailValue(result.best_vina_affinity_kcal_mol ?? result.best_affinity_kcal_mol)}</TableCell>
                  <TableCell>{formatDetailValue(result.best_mode)}</TableCell>
                  <TableCell>{formatDetailValue(result.returned_mode_count ?? result.mode_count ?? result.modes?.length)}</TableCell>
                  <TableCell>{dockingStatusLabel(result.status || row.docking_status)}</TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      variant={selectedKey === key ? 'contained' : 'text'}
                      aria-label={`View docking result for ${moleculeLabel}`}
                      onClick={() => setSelectedKey(key)}
                    >
                      {selectedKey === key ? 'Selected' : 'View'}
                    </Button>
                  </TableCell>
                </TableRow>;
              })}</TableBody>
            </Table>
          </Box>
        </Paper>
      ) : <Alert severity="info">No docking results are available for the current calculation.</Alert>}
      {selected ? <DockingResultsSection compound={selected} jobId={prioritizationState.job?.job_id} apiBaseUrl={apiBaseUrl} /> : null}
    </Stack>
  );
}

const ADMET_MODEL_GROUPS = [
  ['chemberta', 'ChemBERTa classification', '9 public classification endpoints'],
  ['gmc_mpnn_bbb', 'GMC-MPNN BBB', 'Raw five-seed ensemble; threshold policy provisional'],
  ['chemprop_regression', 'Chemprop regression', '5 regression endpoints'],
];
const EMPTY_ADMET_RUNTIME_IDENTITIES = Object.freeze([]);

export function AdmetWorkflowPage({
  prioritizationState,
  sourceStatusState,
  onNavigate,
  initialWorkspaceTab = 0,
  initialAdmetViewState = null,
  initialComparisonIds = [],
}) {
  const rows = prioritizationState.result?.results ?? [];
  const overviewRows = rows.slice(0, 50);
  const [workspaceTab, setWorkspaceTab] = useState(initialWorkspaceTab);
  const [comparisonIds, setComparisonIds] = useState(initialComparisonIds);
  const runtimeIdentities = prioritizationState.job?.admet_runtime_identities
    ?? prioritizationState.result?.admet_runtime_identities
    ?? EMPTY_ADMET_RUNTIME_IDENTITIES;
  const normalizedAdmet = useMemo(
    () => normalizeAdmetAnalysis(rows, runtimeIdentities),
    [rows, runtimeIdentities],
  );
  const [admetViewState, admetDispatch] = useReducer(admetTableStateReducer, undefined, () => initialAdmetViewState || ({
    query: '', filters: createEmptyAdmetFilters(), sortKey: 'compound', sortDirection: 'asc', page: 0, pageSize: 50,
  }));
  const deferredAdmetQuery = useDeferredValue(admetViewState.query);
  const searchedAdmetMolecules = useMemo(
    () => searchAdmetMolecules(normalizedAdmet.molecules, deferredAdmetQuery),
    [deferredAdmetQuery, normalizedAdmet.molecules],
  );
  const filteredAdmetMolecules = useMemo(
    () => filterAdmetMolecules(searchedAdmetMolecules, admetViewState.filters),
    [admetViewState.filters, searchedAdmetMolecules],
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = rows[selectedIndex] ?? null;
  const rowStatuses = rows.map(deriveAdmetFamilyStatuses);
  const familyResults = rowStatuses.flatMap((statuses) => Object.values(statuses));
  const completed = familyResults.filter((family) => family.code === 'available').length;
  const failures = familyResults.filter((family) => ['failed', 'model_unavailable'].includes(family.code)).length;
  const warnings = rows.filter((row) => row.admet_warning || row.bbb_result?.warning || row.admet_regression?.warning).length;
  const familyStatuses = Object.fromEntries(ADMET_MODEL_GROUPS.map(([key]) => [
    key,
    aggregateAdmetFamilyStatus(rows, key, prioritizationState.loading),
  ]));
  const single = prioritizationState.job?.analysis_mode === 'single_compound'
    || prioritizationState.result?.analysis_mode === 'single_compound';
  return (
    <Stack spacing={2}>
      <PageIntro title="ADMET" description="Review the existing ChemBERTa classification, GMC-MPNN BBB, and Chemprop regression outputs for the current calculation." />
      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
        <Tabs value={workspaceTab} onChange={(_, value) => setWorkspaceTab(value)} aria-label="ADMET workspace views">
          <Tab label="Overview" id="admet-tab-overview" aria-controls="admet-panel-overview" />
          <Tab label="Property Table" id="admet-tab-property-table" aria-controls="admet-panel-property-table" />
          <Tab label="Plots" id="admet-tab-plots" aria-controls="admet-panel-plots" />
          <Tab label="Compare" id="admet-tab-compare" aria-controls="admet-panel-compare" />
        </Tabs>
      </Paper>
      {sourceStatusState.error ? <Alert severity="warning">{sourceStatusState.error}</Alert> : null}
      {workspaceTab > 0 ? (
        <Paper elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
          <Stack spacing={1.5}>
            <TextField
              label="Search compounds"
              value={admetViewState.query}
              onChange={(event) => admetDispatch({ type: 'set-query', query: event.target.value })}
              placeholder="Molecule name, ID, SMILES, or source file"
              size="small"
              sx={{ maxWidth: 440 }}
              inputProps={{ 'aria-label': 'Search ADMET compounds' }}
            />
            <AdmetFilterPanel
              filters={admetViewState.filters}
              onChange={(filters) => admetDispatch({ type: 'set-filters', filters })}
              matchedCount={filteredAdmetMolecules.length}
              totalCount={normalizedAdmet.molecules.length}
            />
          </Stack>
        </Paper>
      ) : null}
      {workspaceTab === 0 ? <Box id="admet-panel-overview" role="tabpanel" aria-labelledby="admet-tab-overview"><Stack spacing={2}>
        <Typography variant="h2">Models used</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5 }}>
          {ADMET_MODEL_GROUPS.map(([key, name, detail]) => (
            <Paper key={name} elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
              <Stack spacing={0.75}><Typography sx={{ fontWeight: 700 }}>{name}</Typography><Typography variant="caption" color="text.secondary">{detail}</Typography>
                <Chip label={familyStatuses[key].label} color={familyStatuses[key].color} variant="outlined" />
                <AdmetModelInfo
                  label="Runtime details"
                  metadata={endpointMetadataFromMolecules(
                    normalizedAdmet.molecules,
                    normalizedAdmet.endpoints.find((endpoint) => endpoint.modelFamily === key),
                  )}
                  compact
                />
              </Stack>
            </Paper>
          ))}
        </Box>
        {rows.length ? (
        <Paper elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
          <Stack spacing={1.5}>
            <MetadataPanel rows={[["Molecules submitted", rows.length], ["Available molecule-family results", completed], ["Unavailable / failed molecule-family results", failures], ["Warnings", warnings]]} />
            <Typography variant="h2">Molecule results</Typography>
            {rows.length > overviewRows.length ? <Alert severity="info">Overview shows the first 50 molecules. Use Property Table to search, sort, and page through the complete library.</Alert> : null}
            <Table size="small"><TableHead><TableRow><TableCell>Molecule</TableCell><TableCell>ChemBERTa</TableCell><TableCell>GMC BBB</TableCell><TableCell>Chemprop regression</TableCell></TableRow></TableHead><TableBody>{overviewRows.map((row, index) => {
              const statuses = rowStatuses[index];
              return <TableRow key={compoundRowKey(row, index)}><TableCell>{row.molecule_id || row.canonical_smiles || `Molecule ${index + 1}`}</TableCell><TableCell>{statuses.chemberta.label}</TableCell><TableCell>{statuses.gmc_mpnn_bbb.label}</TableCell><TableCell>{statuses.chemprop_regression.label}</TableCell></TableRow>;
            })}</TableBody></Table>
            <TextField select label="Molecule" value={selectedIndex} onChange={(event) => setSelectedIndex(Number(event.target.value))} sx={{ maxWidth: 420 }}>
              {overviewRows.map((row, index) => <MenuItem key={compoundRowKey(row, index)} value={index}>{row.molecule_id || row.canonical_smiles || `Molecule ${index + 1}`}</MenuItem>)}
            </TextField>
            <AdmetResultsSection compound={selected} />
          </Stack>
        </Paper>
        ) : <Alert severity="info">No ADMET predictions are available for the current calculation.</Alert>}
      </Stack></Box> : null}
      {workspaceTab === 1 ? <Box id="admet-panel-property-table" role="tabpanel" aria-labelledby="admet-tab-property-table"><Stack spacing={1.5}><AdmetExportActions molecules={filteredAdmetMolecules} allMolecules={normalizedAdmet.molecules} selectedIds={comparisonIds} viewState={admetViewState} /><AdmetPropertyTable molecules={filteredAdmetMolecules} totalCount={normalizedAdmet.molecules.length} viewState={admetViewState} dispatch={admetDispatch} selectedComparisonIds={comparisonIds} onAddToComparison={(id) => setComparisonIds((current) => addAdmetComparisonId(current, id))} onRemoveFromComparison={(id) => setComparisonIds((current) => removeAdmetComparisonId(current, id))} /></Stack></Box> : null}
      {workspaceTab === 2 ? <Box id="admet-panel-plots" role="tabpanel" aria-labelledby="admet-tab-plots"><AdmetPlots molecules={filteredAdmetMolecules} selectedComparisonIds={comparisonIds} onAddToComparison={(id) => setComparisonIds((current) => addAdmetComparisonId(current, id))} /></Box> : null}
      {workspaceTab === 3 ? <Box id="admet-panel-compare" role="tabpanel" aria-labelledby="admet-tab-compare"><Stack spacing={1.5}><AdmetExportActions mode="comparison" molecules={filteredAdmetMolecules} allMolecules={normalizedAdmet.molecules} selectedIds={comparisonIds} viewState={admetViewState} /><AdmetComparison molecules={normalizedAdmet.molecules} filteredMolecules={filteredAdmetMolecules} selectedIds={comparisonIds} onAdd={(id) => setComparisonIds((current) => addAdmetComparisonId(current, id))} onRemove={(id) => setComparisonIds((current) => removeAdmetComparisonId(current, id))} onClear={() => setComparisonIds(clearAdmetComparison())} /></Stack></Box> : null}
      <Box><Button variant="contained" onClick={() => onNavigate('Prioritization')}>Continue to {single ? 'Compound Assessment' : 'Prioritization'}</Button></Box>
    </Stack>
  );
}

export function ResultsWorkflowPage({ prioritizationState, upload, annotationsState, onSaveReviewAnnotation }) {
  const rows = prioritizationState.result?.results ?? [];
  const [filters, setFilters] = useState(defaultEvidenceFilters);
  const filtered = useMemo(() => applyEvidenceFilters(rows, filters), [rows, filters]);
  const [selectedKey, setSelectedKey] = useState('');
  const detailRef = useRef(null);
  const selected = filtered.find((row, index) => compoundRowKey(row, index) === selectedKey) ?? null;
  const admetCompleted = rows.filter((row) => row.admet_model_status === 'model_available').length;
  const dockingCompleted = rows.filter((row) => row.docking_result?.status === 'success').length;
  const validCount = rows.filter((row) => isTrueValue(row.valid_molecule)).length;
  const single = prioritizationState.result?.analysis_mode === 'single_compound'
    || prioritizationState.job?.analysis_mode === 'single_compound';
  const profile = prioritizationState.result?.prioritization_profile
    || prioritizationState.job?.prioritization_profile;
  const profileIdentity = profile
    ? `${profile.profile_id || 'unknown'} / ${profile.profile_version || 'unknown'} / ${formatScientificPresentationValue(profile.status || 'status unavailable')} / ${prioritizationState.result?.prioritization_profile_sha256 || prioritizationState.job?.prioritization_profile_sha256 || 'SHA unavailable'}`
    : 'Not used or unavailable';
  const profileUpload = upload || (prioritizationState.job?.upload_id ? { upload_id: prioritizationState.job.upload_id } : null);
  const hasPartialFailures = rows.length > 0 && (
    validCount < rows.length
    || admetCompleted < validCount
    || (prioritizationState.job?.docking_requested && dockingCompleted < validCount)
  );

  useEffect(() => {
    if (selectedKey) revealCompoundDetail(detailRef.current);
  }, [selectedKey]);

  return (
    <Stack spacing={2}>
      <PageIntro
        title={single ? 'Single Compound Assessment' : 'Library Prioritization Results'}
        description={single ? 'Review and export the compound-level computational assessment.' : 'Inspect, filter, annotate, and export the current library prioritization outputs.'}
      />
      {prioritizationState.job ? <MetadataPanel rows={[
        ['Calculation', formatScientificPresentationValue(prioritizationState.job.status)], ['Total compounds', rows.length],
        ['Chemically valid', validCount],
        ['ADMET completed', admetCompleted], ['Docking completed', dockingCompleted],
        [single ? 'Library prioritization' : 'Prioritized', single ? 'Not applicable' : prioritizationState.job.ranked_count ?? 0], ['Warnings / invalid source records', `${prioritizationState.job.warning_count ?? 0} / ${rows.length - validCount}`],
        ['Method', formatScientificPresentationValue(prioritizationState.result?.prioritization_method)],
      ]} /> : null}
      {prioritizationState.job ? (
        <Box component="details" sx={{ '& > summary': { cursor: 'pointer' } }}>
          <Box component="summary" sx={{ fontWeight: 700, color: 'text.secondary', mb: 1 }}>
            Run provenance and identifiers
          </Box>
          <MetadataPanel rows={[
            ['Profile identity', profileIdentity],
            ['Receptor source', formatScientificPresentationValue(prioritizationState.result?.receptor_source || prioritizationState.job?.receptor_source || 'not_used')],
            ['Full job ID', prioritizationState.job.job_id],
          ]} />
        </Box>
      ) : null}
      {hasPartialFailures ? <Alert severity="warning">This calculation contains partial failures or unavailable scientific outputs. Exported all-compound results retain affected source records and their status.</Alert> : null}
      {rows.length && single ? <SingleCompoundAssessment
        compound={rows.find((row) => isTrueValue(row.valid_molecule)) ?? rows[0]}
        profile={profile}
        profileSha256={prioritizationState.result?.prioritization_profile_sha256 || prioritizationState.job?.prioritization_profile_sha256}
        jobId={prioritizationState.job?.job_id}
      /> : null}
      {rows.length && !single ? <>
        <EvidenceFilterPanel rows={rows} filteredRows={filtered} filters={filters} onChange={setFilters} onReset={() => setFilters(defaultEvidenceFilters)} exportFilename="moloptima-results.csv" />
        <ResultPreview rows={filtered} selectedCompoundKey={selectedKey} onSelectCompound={setSelectedKey} />
        <CandidateExportPanel rows={filtered} />
      </> : null}
      {!rows.length ? <Alert severity="info">No result rows are available for the current calculation.</Alert> : null}
      {selected ? <CompoundDetailPanel compound={selected} upload={profileUpload} jobId={prioritizationState.job?.job_id} annotationsState={annotationsState} onSaveReviewAnnotation={onSaveReviewAnnotation} onClose={() => setSelectedKey('')} containerRef={detailRef} /> : null}
      {prioritizationState.job ? <ResultsPackageDownloads apiBaseUrl={apiBaseUrl} jobId={prioritizationState.job.job_id} analysisMode={single ? 'single_compound' : 'library'} /> : null}
    </Stack>
  );
}

export function SingleCompoundAssessment({ compound, profile, profileSha256, jobId }) {
  const interpretation = compound.prioritization_v2 || {};
  const provenance = interpretation.provenance || {};
  return (
    <Stack spacing={2}>
      <Alert severity="info">
        Single Compound Assessment — this report does not assign a final library rank or library-relative docking percentile.
      </Alert>
      <Paper elevation={0} sx={{ p: 2.5, border: '1px solid', borderColor: 'divider' }}>
        <Stack spacing={2.5}>
          <Box><Typography variant="h2">Compound Identity</Typography><Typography color="text.secondary">{compound.molecule_id}</Typography></Box>
          <StructurePreview compound={compound} />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
            <DetailTable title="Molecular Properties" rows={[
              ['Canonical SMILES', compound.canonical_smiles], ['Molecular weight', compound.mw],
              ['TPSA', compound.tpsa], ['H-bond donors', compound.hbd], ['H-bond acceptors', compound.hba],
              ['Rotatable bonds', compound.rotatable_bonds], ['QED', compound.qed], ['SA', compound.sa_score],
              ['Structural alerts', formatStructuralAlertStatus(compound)],
            ]} />
            <DetailTable title="Structure Provenance" rows={[
              ['Source type', compound.source_type], ['Source filename', compound.source_filename],
              ['Source record', compound.source_record], ['Input coordinates', compound.coordinate_status],
              ['Input has 3D', compound.input_has_3d], ['Validation status', compound.validation_status],
              ['Original structure SHA256', compound.original_structure_sha256],
            ]} />
          </Box>
          <Box><Typography variant="h2" sx={{ mb: 1 }}>ADMET</Typography><AdmetResultsSection compound={compound} /></Box>
          <Box><Typography variant="h2" sx={{ mb: 1 }}>Docking</Typography><DockingResultsSection compound={compound} jobId={jobId} apiBaseUrl={apiBaseUrl} /></Box>
          <Box><Typography variant="h2" sx={{ mb: 1 }}>Profile Interpretation</Typography>
            <DetailTable title="Selected profile context" rows={[
              ['Profile ID', provenance.profile_id || profile?.profile_id],
              ['Profile name', profile?.name],
              ['Profile version', provenance.profile_version || profile?.profile_version],
              ['Profile status', provenance.profile_status || profile?.status],
              ['Profile SHA256', provenance.profile_sha256 || profileSha256],
              ['Target mode', profile?.target_mode],
              ['Endpoint desirabilities', formatStructuredDetail(interpretation.endpoint_scoring)],
              ['Liability summary', formatStructuredDetail(interpretation.liabilities)], ['Interpretation warnings', interpretation.warnings],
            ]} />
            <Alert severity="info" sx={{ mt: 1 }}>Endpoint values, liabilities, warnings, and selected profile context are interpretive. Library-relative docking normalization and a final library score are not calculated.</Alert>
          </Box>
          <Box><Typography variant="h2" sx={{ mb: 1 }}>Warnings / Limitations</Typography><Typography color="text.secondary">{formatDetailValue(compound.source_warnings || compound.failure_reason || 'No input-specific warning recorded.')}</Typography></Box>
        </Stack>
      </Paper>
    </Stack>
  );
}

export function AnalysisWorkflowPage({ currentRunState, annotationsState, onSaveReviewAnnotation, prioritizationSettings }) {
  const [tab, setTab] = useState(0);
  const rows = currentRunState.result?.results ?? [];
  const profileMatches = Boolean(prioritizationSettings.validation?.scoreable
    && prioritizationSettings.validation?.profile_sha256 === currentRunState.result?.prioritization_profile_sha256);
  const single = currentRunState.result?.analysis_mode === 'single_compound'
    || currentRunState.job?.analysis_mode === 'single_compound';
  if (single) {
    return <Stack spacing={2}><PageIntro title="Analysis" description="Library-relative analyses are intentionally disabled for a single compound." /><Alert severity="info">Not applicable for Single Compound Analysis: Library Prioritization, Pareto Analysis, Rank Sensitivity, top-N candidate frequency, and library rank stability.</Alert></Stack>;
  }
  return (
    <Stack spacing={2}>
      <PageIntro title="Analysis" description="Explore current calculation outputs without changing the underlying scientific priority score." />
      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
        <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" scrollButtons="auto" aria-label="Analysis views">
          <Tab label="Chemical Space" /><Tab label="Pareto & Sensitivity" /><Tab label="Biopharma Intelligence" />
        </Tabs>
      </Paper>
      {!rows.length ? <Alert severity="info">No current calculation results are available for analysis.</Alert> : null}
      {tab === 0 ? <ChemicalSpacePage latestRunState={currentRunState} annotationsState={annotationsState} onSaveReviewAnnotation={onSaveReviewAnnotation} /> : null}
      {tab === 1 ? (
        currentRunState.result?.prioritization_method === 'v2'
          ? <PrioritizationAnalysisPanel apiBaseUrl={apiBaseUrl} jobId={currentRunState.job?.job_id || ''} results={rows} profile={profileMatches ? prioritizationSettings.profile : null} profileScoreable={profileMatches} />
          : <Alert severity="info">Pareto and sensitivity analysis require current Prioritization v2 results. Analysis has not been run.</Alert>
      ) : null}
      {tab === 2 ? <BiopharmaIntelligencePage latestRunState={currentRunState} annotationsState={annotationsState} onSaveReviewAnnotation={onSaveReviewAnnotation} /> : null}
    </Stack>
  );
}

function DashboardPage({ health, activeItem, latestRunState }) {
  const isDashboard = activeItem === 'Dashboard';
  const latestRunSummary = buildLatestRunSummary(latestRunState);

  return (
    <Stack spacing={3} sx={{ width: '100%', maxWidth: READABLE_CONTENT_MAX_WIDTH, mx: 'auto' }}>
      <Paper elevation={0} sx={{ p: { xs: 2.5, md: 3 }, border: '1px solid', borderColor: 'divider' }}>
        <Stack spacing={1.25} sx={{ maxWidth: 760 }}>
          <Typography component="h1" variant="h1">
            MolOptima
          </Typography>
          <Typography color="text.secondary">
            Integrated molecular docking, ADMET prediction, and multiparameter molecular prioritization.
          </Typography>
        </Stack>
      </Paper>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1.2fr 1fr' },
          gap: 3,
        }}
      >
        <Paper elevation={0} sx={{ p: 3, border: '1px solid', borderColor: 'divider' }}>
          <Stack spacing={2}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
              <Typography variant="h2">Backend Health</Typography>
              <HealthChip health={health} />
            </Stack>
            <Typography color="text.secondary">
              The frontend checks <code>GET http://localhost:8000/health</code> and reports
              whether the FastAPI backend is reachable.
            </Typography>
            <Box
              sx={{
                p: 2,
                borderRadius: 1,
                bgcolor: '#f7fafc',
                border: '1px solid',
                borderColor: 'divider',
                fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
                fontSize: 13,
                color: 'text.secondary',
                overflowWrap: 'anywhere',
              }}
            >
              {health.message}
            </Box>
          </Stack>
        </Paper>

        <Paper elevation={0} sx={{ p: 3, border: '1px solid', borderColor: 'divider' }}>
          <Stack spacing={2}>
            <Typography variant="h2">Current Workspace</Typography>
            {[
              ['Workflow', 'Docking, ADMET, and prioritization'],
              ['Backend', 'FastAPI local service'],
              ['Storage', 'Local calculation and result files'],
            ].map(([label, value]) => (
              <Stack key={label} direction="row" justifyContent="space-between" gap={2}>
                <Typography color="text.secondary">{label}</Typography>
                <Typography sx={{ fontWeight: 650, textAlign: 'right' }}>{value}</Typography>
              </Stack>
            ))}
          </Stack>
        </Paper>
      </Box>

      {isDashboard && (
        <Paper elevation={0} sx={{ p: 3, border: '1px solid', borderColor: 'divider' }}>
          <Stack spacing={2.5}>
            <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={1.5}>
              <Stack spacing={0.75}>
                <Typography variant="h2">Latest Prioritization Run</Typography>
                <Typography color="text.secondary">
                  {latestRunState.loading
                    ? 'Loading latest completed prioritization run...'
                    : latestRunSummary
                    ? `Completed ${formatDetailValue(latestRunSummary.completedAt)}`
                    : 'Run molecular prioritization to populate dashboard metrics.'}
                </Typography>
              </Stack>
              {latestRunSummary && (
                <Chip
                  label={`${latestRunSummary.totalMolecules} molecules`}
                  color="secondary"
                  variant="outlined"
                />
              )}
            </Stack>

            {latestRunState.error && <Alert severity="warning">{latestRunState.error}</Alert>}

            {latestRunSummary ? (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' },
                  gap: 1.5,
                }}
              >
                <RunSummaryCard label="Total molecules" value={latestRunSummary.totalMolecules} />
                <RunSummaryCard label="Valid molecules" value={latestRunSummary.validMolecules} />
                <RunSummaryCard
                  label="High-priority molecules"
                  value={latestRunSummary.highPriorityMolecules}
                  detail="Score >= 0.75"
                />
                <RunSummaryCard
                  label="BBB model"
                  value={latestRunSummary.bbbModelSummary}
                  detail={latestRunSummary.bbbModelDetail}
                />
                <RunSummaryCard
                  label="Docking scores"
                  value={latestRunSummary.dockingSummary}
                  detail={latestRunSummary.dockingDetail}
                />
                <RunSummaryCard
                  label="Synthetic feasibility"
                  value={latestRunSummary.syntheticSummary}
                  detail={latestRunSummary.syntheticDetail}
                />
              </Box>
            ) : !latestRunState.loading && (
              <Alert severity="info">
                No prioritization run is available in this session yet.
              </Alert>
            )}
          </Stack>
        </Paper>
      )}

      {!isDashboard && (
        <Paper elevation={0} sx={{ p: 3, border: '1px solid', borderColor: 'divider' }}>
          <Typography variant="h2">{activeItem}</Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            Select New Calculation to begin the scientific workflow.
          </Typography>
        </Paper>
      )}
    </Stack>
  );
}

function RunSummaryCard({ label, value, detail }) {
  return (
    <Card elevation={0} sx={{ border: '1px solid', borderColor: 'divider', height: '100%' }}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Stack spacing={0.75}>
          <Typography variant="caption" color="text.secondary">
            {label}
          </Typography>
          <Typography variant="h2" sx={{ overflowWrap: 'anywhere' }}>
            {formatDetailValue(value)}
          </Typography>
          {detail && (
            <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
              {detail}
            </Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

const highSimilarityThreshold = 0.7;
const reviewStatuses = ['unreviewed', 'selected', 'watchlist', 'deprioritized', 'rejected'];
const reviewStatusLabels = {
  unreviewed: 'Unreviewed',
  selected: 'Selected',
  watchlist: 'Watchlist',
  deprioritized: 'Deprioritized',
  rejected: 'Rejected',
};

function BiopharmaIntelligencePage({ latestRunState, annotationsState, onSaveReviewAnnotation }) {
  const rows = latestRunState.result?.results ?? [];
  const [filters, setFilters] = useState(defaultEvidenceFilters);
  const filteredRows = useMemo(() => applyEvidenceFilters(rows, filters), [rows, filters]);
  const summary = buildBiopharmaSummary(rows);
  const targetReferences = latestRunState.result?.target_references ?? {};
  const [selectedCompoundKey, setSelectedCompoundKey] = useState('');
  const selectedCompound =
    filteredRows.find((row, index) => compoundRowKey(row, index) === selectedCompoundKey) ?? filteredRows[0] ?? null;

  useEffect(() => {
    setSelectedCompoundKey('');
  }, [latestRunState.result?.output_file, filters]);

  return (
    <Stack spacing={3}>
      <PageIntro
        title="Biopharma Intelligence"
        description="Summarize computational screening evidence from local identity, local similarity, and optional public database signals for the latest completed prioritization run."
      />

      <Paper elevation={0} sx={{ p: 3, border: '1px solid', borderColor: 'divider' }}>
        <Stack spacing={2.5}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={1.5}>
            <Stack spacing={0.75}>
              <Typography variant="h2">Latest Run Biopharma Context</Typography>
              <Typography color="text.secondary">
                {latestRunState.loading
                  ? 'Loading latest completed prioritization run...'
                  : rows.length > 0
                  ? `Showing ${filteredRows.length} of ${rows.length} molecules from the latest completed run.`
                  : 'Run molecular prioritization to populate biopharma context.'}
              </Typography>
            </Stack>
            {rows.length > 0 && (
              <Chip
                label={`${summary.highSimilarityCompounds} high similarity`}
                color={summary.highSimilarityCompounds > 0 ? 'secondary' : 'default'}
                variant="outlined"
              />
            )}
          </Stack>

          {latestRunState.error && <Alert severity="warning">{latestRunState.error}</Alert>}

          {rows.length > 0 ? (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
                gap: 1.5,
              }}
            >
              <RunSummaryCard label="Exact known-compound matches" value={summary.exactMatches} />
              <RunSummaryCard
                label="Candidate shortlist"
                value={summary.reviewSummary}
                detail="Local review status counts"
              />
              <RunSummaryCard
                label="Evidence summary"
                value={summary.evidenceSummaryTopCategory}
                detail={summary.evidenceSummaryDetail}
              />
              <RunSummaryCard
                label="PubChem exact matches"
                value={summary.pubchemExactMatches}
                detail={summary.pubchemLookupDetail}
              />
              <RunSummaryCard
                label="ChEMBL matches"
                value={summary.chemblMatches}
                detail={summary.chemblLookupDetail}
              />
              <RunSummaryCard
                label="Patent-context signals"
                value={summary.patentSignals}
                detail={summary.patentLookupDetail}
              />
              <RunSummaryCard
                label="Structural alerts"
                value={summary.structuralAlertCount}
                detail={`${summary.painsAlertCount} PAINS, ${summary.brenkAlertCount} Brenk`}
              />
              <RunSummaryCard label="No exact matches" value={summary.noExactMatches} />
              <RunSummaryCard
                label="Avg closest-known similarity"
                value={summary.averageClosestSimilarity}
                detail={`${summary.similarityCount} molecules with similarity values`}
              />
              <RunSummaryCard
                label="High-similarity compounds"
                value={summary.highSimilarityCompounds}
                detail={`Threshold >= ${highSimilarityThreshold.toFixed(2)}`}
              />
              <RunSummaryCard
                label="Chemical diversity"
                value={`${summary.diversityClusterCount} clusters`}
                detail={`Largest cluster: ${summary.largestDiversityClusterSize}`}
              />
              <RunSummaryCard
                label="Target reference set"
                value={`${targetReferences.reference_count ?? 0} references`}
                detail={`${formatScientificPresentationValue(targetReferences.source ?? 'not_used')}; ${formatScientificPresentationValue(targetReferences.lookup_status ?? 'not_requested')}`}
              />
            </Box>
          ) : !latestRunState.loading && (
            <Alert severity="info">No latest result rows are available for Biopharma Intelligence yet.</Alert>
          )}
        </Stack>
      </Paper>

      {rows.length > 0 && (
        <Paper elevation={0} sx={{ p: 3, border: '1px solid', borderColor: 'divider' }}>
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={1.5}>
              <Typography variant="h2">Local Reference Context</Typography>
              <Chip label={`Showing ${filteredRows.length} of ${rows.length} molecules`} variant="outlined" />
            </Stack>
            <Alert severity="info">
              Target-reference overlap is a fingerprint-based screening signal only. It is not a biological activity, clinical, or legal conclusion.
            </Alert>
            <EvidenceFilterPanel
              rows={rows}
              filteredRows={filteredRows}
              filters={filters}
              onChange={setFilters}
              onReset={() => setFilters(defaultEvidenceFilters)}
              exportFilename="moloptima-biopharma-filtered.csv"
            />
            <BiopharmaResultTable
              rows={filteredRows}
              selectedCompoundKey={selectedCompound ? compoundRowKey(selectedCompound, filteredRows.indexOf(selectedCompound)) : ''}
              onSelectCompound={setSelectedCompoundKey}
            />
          </Stack>
        </Paper>
      )}

      {selectedCompound && (
        <BiopharmaInterpretationPanel
          compound={selectedCompound}
          annotationsState={annotationsState}
          onSaveReviewAnnotation={onSaveReviewAnnotation}
        />
      )}
    </Stack>
  );
}

function BiopharmaResultTable({ rows, selectedCompoundKey, onSelectCompound }) {
  return (
    <Box sx={{ overflowX: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Table size="small" aria-label="Biopharma local reference context">
        <TableHead>
          <TableRow>
            {['Molecule', 'Review status', 'Review note', 'Evidence summary', 'Biopharma context',
              'Structural alerts', 'PAINS alert', 'Brenk alert', 'Diversity cluster', 'Cluster representative',
              'Nearest-neighbor similarity', 'Combined candidate score', 'Docking priority signal',
              'Active-neighborhood signal', 'Nearest active reference', 'Nearest active similarity',
              'Known-compound match', 'Known-compound name', 'PubChem exact match', 'PubChem CID',
              'PubChem lookup status', 'ChEMBL lookup status', 'ChEMBL molecule ID', 'ChEMBL activity records',
              'ChEMBL target summary', 'Patent lookup status', 'SureChEMBL returned records', 'Top patent record ID',
              'Closest known compound', 'Closest-known similarity', 'Identity status', 'Similarity status',
              'Recommended review focus'].map((label) => <TableCell key={label}>{label}</TableCell>)}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, index) => {
            const rowKey = compoundRowKey(row, index);
            return (
              <TableRow
                hover
                key={rowKey}
                selected={selectedCompoundKey === rowKey}
                onClick={() => onSelectCompound(rowKey)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectCompound(rowKey);
                  }
                }}
                tabIndex={0}
                sx={{ cursor: 'pointer' }}
              >
                <TableCell>{formatDetailValue(row.molecule_id)}</TableCell>
                <TableCell>{formatReviewStatus(row.review_status)}</TableCell>
                <TableCell>{formatDetailValue(row.review_note)}</TableCell>
                <TableCell>{formatEvidenceCategory(row.evidence_summary_category)}</TableCell>
                <TableCell>{formatEvidenceCategory(row.biopharma_context_level)}</TableCell>
                <TableCell>{formatStructuralAlertStatus(row)}</TableCell>
                <TableCell>{formatBooleanLabel(row.pains_alert)}</TableCell>
                <TableCell>{formatBooleanLabel(row.brenk_alert)}</TableCell>
                <TableCell>{formatDiversityCluster(row)}</TableCell>
                <TableCell>{formatBooleanLabel(row.diversity_representative)}</TableCell>
                <TableCell>{formatNearestNeighbor(row)}</TableCell>
                <TableCell>{formatDetailValue(row.combined_candidate_score)}</TableCell>
                <TableCell>{formatEvidenceCategory(row.docking_priority_signal)}</TableCell>
                <TableCell>{formatEvidenceCategory(row.active_neighborhood_signal)}</TableCell>
                <TableCell>{formatDetailValue(row.nearest_active_compound_name)}</TableCell>
                <TableCell>{formatDetailValue(row.nearest_active_similarity)}</TableCell>
                <TableCell>{formatBooleanLabel(row.known_compound_match)}</TableCell>
                <TableCell>{formatDetailValue(row.known_compound_name)}</TableCell>
                <TableCell>{formatBooleanLabel(row.pubchem_exact_match)}</TableCell>
                <TableCell>{formatDetailValue(row.pubchem_cid)}</TableCell>
                <TableCell>{formatScientificPresentationValue(row.pubchem_lookup_status)}</TableCell>
                <TableCell>{formatScientificPresentationValue(row.chembl_lookup_status)}</TableCell>
                <TableCell>{formatDetailValue(row.chembl_molecule_id || row.chembl_similarity_molecule_id)}</TableCell>
                <TableCell>{formatDetailValue(row.chembl_activity_count)}</TableCell>
                <TableCell>{formatDetailValue(row.chembl_target_summary)}</TableCell>
                <TableCell>{formatScientificPresentationValue(row.patent_lookup_status)}</TableCell>
                <TableCell>{formatDetailValue(row.patent_record_count)}</TableCell>
                <TableCell>{formatDetailValue(row.patent_top_record_id)}</TableCell>
                <TableCell>{formatDetailValue(row.closest_known_compound_name)}</TableCell>
                <TableCell>{formatDetailValue(row.closest_known_compound_similarity)}</TableCell>
                <TableCell>{formatScientificPresentationValue(row.identity_check_status)}</TableCell>
                <TableCell>{formatScientificPresentationValue(row.similarity_check_status)}</TableCell>
                <TableCell>{formatEvidenceCategory(row.recommended_review_focus)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  );
}

export function biopharmaEvidenceRows(compound) {
  return [
    ['Review status', formatReviewStatus(compound.review_status)],
    ['Review note', compound.review_note],
    ['Evidence summary category', formatEvidenceCategory(compound.evidence_summary_category)],
    ['Public identity signal', formatEvidenceCategory(compound.public_identity_signal)],
    ['Public bioactivity signal', formatEvidenceCategory(compound.public_bioactivity_signal)],
    ['Patent-context signal', formatEvidenceCategory(compound.patent_context_signal)],
    ['Local similarity signal', formatEvidenceCategory(compound.local_similarity_signal)],
    ['Nearest active/reference compound', compound.nearest_active_compound_name],
    ['Nearest active/reference similarity', compound.nearest_active_similarity],
    ['Active-neighborhood signal', formatEvidenceCategory(compound.active_neighborhood_signal)],
    ['Reference activity', formatTargetReferenceActivity(compound)],
    ['Reference mechanism class', compound.nearest_active_mechanism_class],
    ['Biopharma context level', formatEvidenceCategory(compound.biopharma_context_level)],
    ['Recommended review focus', compound.recommended_review_focus],
    ['Combined candidate score', compound.combined_candidate_score],
    ['Docking priority signal', formatEvidenceCategory(compound.docking_priority_signal)],
    ['Docking rank', compound.docking_rank_within_run],
    ['Docking percentile', compound.docking_percentile_within_run],
    ['Protocol-dependent docking signal', compound.combined_score_explanation],
    ['Structural alerts', formatStructuralAlertStatus(compound)],
    ['PAINS alert', formatBooleanLabel(compound.pains_alert)],
    ['Brenk alert', formatBooleanLabel(compound.brenk_alert)],
    ['Potential liability signal', compound.medchem_alert_summary],
    ['Diversity cluster', formatDiversityCluster(compound)],
    ['Cluster representative', formatBooleanLabel(compound.diversity_representative)],
    ['Nearest neighbor similarity', formatNearestNeighbor(compound)],
    ['Diversity status', formatEvidenceCategory(compound.diversity_status)],
    ['Chemical-space X', compound.chemical_space_x],
    ['Chemical-space Y', compound.chemical_space_y],
    ['Chemical-space method', compound.chemical_space_method],
    ['Chemical-space status', formatEvidenceCategory(compound.chemical_space_status)],
    ['Exact known compound', compound.known_compound_name],
    ['PubChem exact match', formatPubChemMatch(compound)],
    ['PubChem lookup status', formatScientificPresentationValue(compound.pubchem_lookup_status)],
    ['ChEMBL match', formatChEMBLMatch(compound)],
    ['ChEMBL lookup status', formatScientificPresentationValue(compound.chembl_lookup_status)],
    ['Known public bioactivity records', compound.chembl_activity_count],
    ['Associated public targets', compound.chembl_target_count],
    ['ChEMBL target summary', compound.chembl_target_summary],
    ['Patent-context evidence', formatPatentSignal(compound)],
    ['Patent lookup status', formatScientificPresentationValue(compound.patent_lookup_status)],
    ['SureChEMBL returned records for this structure/query', compound.patent_record_count],
    ['Top patent record ID', compound.patent_top_record_id],
    ['Top patent record title', compound.patent_top_record_title],
    ['Closest known compound', compound.closest_known_compound_name],
    ['Closest similarity', compound.closest_known_compound_similarity],
    ['Identity status', formatScientificPresentationValue(compound.identity_check_status)],
    ['Similarity status', formatScientificPresentationValue(compound.similarity_check_status)],
  ];
}

export function biopharmaProvenanceRows(compound) {
  return [
    ['Reference source', formatScientificPresentationValue(compound.target_reference_source)],
    ['PubChem cache status', formatScientificPresentationValue(compound.pubchem_cache_status)],
    ['ChEMBL cache status', formatScientificPresentationValue(compound.chembl_cache_status)],
    ['Patent cache status', formatScientificPresentationValue(compound.patent_cache_status)],
    ['Patent source', formatScientificPresentationValue(compound.patent_source)],
    ['Patent query identifier', compound.patent_query_identifier],
  ];
}

export function BiopharmaInterpretationPanel({ compound, annotationsState, onSaveReviewAnnotation }) {
  const interpretation = interpretBiopharmaCompound(compound);

  return (
    <Card elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
      <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={1.5}>
            <Stack spacing={0.5}>
              <Typography variant="h2">Evidence summary</Typography>
              <Typography color="text.secondary">{formatDetailValue(compound.molecule_id)}</Typography>
            </Stack>
            <Chip label={interpretation.label} color={interpretation.color} variant="outlined" />
          </Stack>
          <Typography>{interpretation.message}</Typography>
          <ReviewAnnotationControls
            compound={compound}
            annotationsState={annotationsState}
            onSaveReviewAnnotation={onSaveReviewAnnotation}
          />
          <StructurePreview compound={compound} />
          <MetadataPanel
            rows={biopharmaEvidenceRows(compound)}
          />
          <Box component="details" sx={{ '& > summary': { cursor: 'pointer' } }}>
            <Box component="summary" sx={{ fontWeight: 700, color: 'text.secondary', mb: 1 }}>
              Evidence provenance and diagnostics
            </Box>
            <MetadataPanel rows={biopharmaProvenanceRows(compound)} />
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

function buildBiopharmaSummary(rows) {
  const similarities = rows
    .map((row) => numericValue(row.closest_known_compound_similarity))
    .filter((value) => value !== null);
  const exactMatches = rows.filter((row) => isTrueValue(row.known_compound_match)).length;
  const pubchemExactMatches = rows.filter((row) => isTrueValue(row.pubchem_exact_match)).length;
  const pubchemStatusCounts = countValues(rows.map((row) => row.pubchem_lookup_status).filter(Boolean));
  const chemblMatches = rows.filter(
    (row) => isTrueValue(row.chembl_exact_match) || isTrueValue(row.chembl_similarity_match),
  ).length;
  const chemblStatusCounts = countValues(rows.map((row) => row.chembl_lookup_status).filter(Boolean));
  const patentSignals = rows.filter((row) => isTrueValue(row.patent_public_evidence_match)).length;
  const patentStatusCounts = countValues(rows.map((row) => row.patent_lookup_status).filter(Boolean));
  const evidenceCategoryCounts = countValues(rows.map((row) => row.evidence_summary_category).filter(Boolean));
  const topEvidenceCategory = topCountLabel(evidenceCategoryCounts);
  const reviewSummary = formatReviewCounts(rows);
  const diversitySummary = buildDiversitySummary(rows);
  const structuralAlertSummary = buildStructuralAlertSummary(rows);
  const highSimilarityCompounds = similarities.filter((value) => value >= highSimilarityThreshold).length;
  const averageSimilarity =
    similarities.length > 0
      ? similarities.reduce((total, value) => total + value, 0) / similarities.length
      : null;

  return {
    exactMatches,
    pubchemExactMatches,
    pubchemLookupDetail: formatCounts(pubchemStatusCounts) || 'Public lookup not run',
    chemblMatches,
    chemblLookupDetail: formatCounts(chemblStatusCounts) || 'ChEMBL lookup not run',
    patentSignals,
    patentLookupDetail: formatCounts(patentStatusCounts) || 'Patent-context lookup not run',
    reviewSummary,
    structuralAlertCount: structuralAlertSummary.alertMoleculeCount,
    painsAlertCount: structuralAlertSummary.painsAlertCount,
    brenkAlertCount: structuralAlertSummary.brenkAlertCount,
    diversityClusterCount: diversitySummary.clusterCount,
    largestDiversityClusterSize: diversitySummary.largestClusterSize,
    evidenceSummaryTopCategory: topEvidenceCategory ? formatEvidenceCategory(topEvidenceCategory) : 'Not available',
    evidenceSummaryDetail: formatCounts(evidenceCategoryCounts) || 'No evidence synthesis available',
    noExactMatches: rows.length - exactMatches,
    averageClosestSimilarity: averageSimilarity === null ? 'Not available' : averageSimilarity.toFixed(3),
    highSimilarityCompounds,
    similarityCount: similarities.length,
  };
}

function interpretBiopharmaCompound(compound) {
  if (compound.evidence_summary_category || compound.evidence_summary_notes) {
    return {
      label: formatEvidenceCategory(compound.evidence_summary_category || 'computational_screening_summary'),
      color: evidenceSummaryColor(compound),
      message: compound.evidence_summary_notes || 'Computational screening summary is not available for this row.',
    };
  }

  if (
    compound.valid_molecule === false ||
    compound.similarity_check_status === 'not_run_invalid_molecule' ||
    compound.identity_check_status === 'not_run_invalid_molecule'
  ) {
    return {
      label: 'Invalid molecule',
      color: 'warning',
      message: 'Invalid molecule: local identity and similarity context were not run for this row.',
    };
  }

  if (isTrueValue(compound.known_compound_match)) {
    return {
      label: 'Exact known compound',
      color: 'success',
      message: `Exact known compound: this molecule matches ${formatDetailValue(
        compound.known_compound_name,
      )} in the local reference table.`,
    };
  }

  if (isTrueValue(compound.pubchem_exact_match)) {
    return {
      label: 'Public compound match',
      color: 'success',
      message: `PubChem exact match: this molecule matched ${formatDetailValue(
        compound.pubchem_preferred_name,
      )} with CID ${formatDetailValue(compound.pubchem_cid)}. This is a public identity signal only, not a legal conclusion.`,
    };
  }

  if (isTrueValue(compound.chembl_exact_match) || isTrueValue(compound.chembl_similarity_match)) {
    return {
      label: 'Public bioactivity context',
      color: 'secondary',
      message: `ChEMBL match: ${formatChEMBLMatch(
        compound,
      )}. This is a public database signal, not a clinical conclusion.`,
    };
  }

  if (isTrueValue(compound.patent_public_evidence_match)) {
    return {
      label: 'Patent-context signal',
      color: 'secondary',
      message: `Public patent-associated evidence: ${formatPatentSignal(
        compound,
      )}. Record counts may include broad or indirect public document associations. This is a public database signal only, not a legal conclusion.`,
    };
  }

  const similarity = numericValue(compound.closest_known_compound_similarity);
  if (similarity !== null && similarity >= highSimilarityThreshold) {
    return {
      label: 'Close analog signal',
      color: 'secondary',
      message: `Close analog signal: the closest local reference is ${formatDetailValue(
        compound.closest_known_compound_name,
      )} with similarity ${similarity.toFixed(3)}.`,
    };
  }

  return {
    label: 'No close local-reference match',
    color: 'default',
    message: 'No close local-reference match: this row has no exact match and no closest-known similarity above the configured threshold.',
  };
}

function RunHistoryPage({ runHistoryState, loadedJobId, onLoadHistoricalRun, onRefreshRunHistory }) {
  const jobs = runHistoryState.jobs ?? [];

  return (
    <Stack spacing={3}>
      <PageIntro
        title="Run History"
        description="Review local prioritization jobs in every state and reload completed result rows into the MolOptima analysis views."
      />

      <Paper elevation={0} sx={{ p: 3, border: '1px solid', borderColor: 'divider' }}>
        <Stack spacing={2.5}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={1.5}>
            <Stack spacing={0.75}>
              <Typography variant="h2">Saved Analyses</Typography>
              <Typography color="text.secondary">
                {runHistoryState.loading
                  ? 'Loading saved analyses...'
                  : jobs.length > 0
                  ? `${jobs.length} analysis jobs are available locally.`
                  : 'No analysis jobs are available yet.'}
              </Typography>
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
              {loadedJobId && <Chip title={`Full job ID: ${loadedJobId}`} label={`Loaded run: ${compactJobId(loadedJobId)}`} color="secondary" variant="outlined" />}
              <Button variant="outlined" onClick={onRefreshRunHistory} disabled={runHistoryState.loading}>
                Refresh history
              </Button>
            </Stack>
          </Stack>

          {runHistoryState.error && <Alert severity="error">{runHistoryState.error}</Alert>}
          {runHistoryState.loading && <Alert severity="info">Loading saved analyses...</Alert>}

          {jobs.length > 0 ? (
            <Box sx={{ overflowX: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              <Table size="small" aria-label="Saved analysis run history">
                <TableHead>
                  <TableRow>
                    <TableCell>Job ID</TableCell>
                    <TableCell>Completed at</TableCell>
                    <TableCell>Rows</TableCell>
                    <TableCell>Lookup sources</TableCell>
                    <TableCell>Input file</TableCell>
                    <TableCell>Output file</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Stage</TableCell>
                    <TableCell>Load</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {jobs.map((job) => {
                    const isLoaded = loadedJobId === job.job_id;
                    return (
                      <TableRow key={job.job_id} selected={isLoaded}>
                        <TableCell sx={{ fontFamily: 'ui-monospace, Consolas, monospace' }}>
                          <Box component="span" title={`Full job ID: ${job.job_id}`}>{compactJobId(job.job_id)}</Box>
                        </TableCell>
                        <TableCell>{formatDetailValue(job.completed_at)}</TableCell>
                        <TableCell>{formatDetailValue(job.row_count)}</TableCell>
                        <TableCell>{formatLookupSources(job)}</TableCell>
                        <TableCell title={job.input_file || undefined}>{compactLocalPath(job.input_file)}</TableCell>
                        <TableCell title={job.output_file || undefined}>{compactLocalPath(job.output_file)}</TableCell>
                        <TableCell>{formatScientificPresentationValue(job.status)}</TableCell>
                        <TableCell>{formatScientificPresentationValue(job.stage)}</TableCell>
                        <TableCell>
                          <Button
                            size="small"
                            variant={isLoaded ? 'contained' : 'outlined'}
                            disabled={
                              runHistoryState.loading
                              || !['completed', 'completed_with_warnings'].includes(job.status)
                            }
                            onClick={() => onLoadHistoricalRun(job.job_id)}
                          >
                            {isLoaded ? 'Loaded' : 'Load run'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          ) : !runHistoryState.loading && (
            <Alert severity="info">
              Run molecular prioritization to create saved local analyses.
            </Alert>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}

function RunComparisonPage({ runHistoryState, onRefreshRunHistory }) {
  const jobs = (runHistoryState.jobs ?? []).filter((job) =>
    ['completed', 'completed_with_warnings'].includes(job.status),
  );
  const [runAId, setRunAId] = useState('');
  const [runBId, setRunBId] = useState('');
  const [comparisonState, setComparisonState] = useState({
    loading: false,
    error: '',
    runA: null,
    runB: null,
    rows: [],
    summary: null,
  });

  useEffect(() => {
    if (!runAId && jobs[0]?.job_id) {
      setRunAId(jobs[0].job_id);
    }
    if (!runBId && jobs[1]?.job_id) {
      setRunBId(jobs[1].job_id);
    }
  }, [jobs, runAId, runBId]);

  async function handleCompareRuns() {
    if (!runAId || !runBId || runAId === runBId) {
      setComparisonState((current) => ({
        ...current,
        error: 'Choose two different completed runs to compare.',
      }));
      return;
    }
    setComparisonState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const [runAResult, runBResult, runAAnnotations, runBAnnotations] = await Promise.all([
        apiRequest(`/api/results/${runAId}`),
        apiRequest(`/api/results/${runBId}`),
        apiRequest(`/api/jobs/${runAId}/annotations`).catch(() => ({ annotations: {} })),
        apiRequest(`/api/jobs/${runBId}/annotations`).catch(() => ({ annotations: {} })),
      ]);
      const runA = annotateComparisonResult(runAResult, runAAnnotations.annotations ?? {});
      const runB = annotateComparisonResult(runBResult, runBAnnotations.annotations ?? {});
      const comparison = compareSavedRuns(runA, runB);
      setComparisonState({
        loading: false,
        error: '',
        runA,
        runB,
        rows: comparison.rows,
        summary: comparison.summary,
      });
    } catch (error) {
      setComparisonState((current) => ({
        ...current,
        loading: false,
        error: readableError(error),
      }));
    }
  }

  const summary = comparisonState.summary ?? emptyRunComparisonSummary();
  const largestPriorityChanges = comparisonState.rows
    .filter((row) => row.presence === 'both' && row.priority_score_change !== '')
    .slice()
    .sort((left, right) => Math.abs(Number(right.priority_score_change)) - Math.abs(Number(left.priority_score_change)))
    .slice(0, 5);

  return (
    <Stack spacing={3}>
      <PageIntro
        title="Run Comparison"
        description="Compare saved completed analyses to inspect ranking changes, evidence synthesis shifts, public lookup signals, and local review annotations."
      />

      <Paper elevation={0} sx={{ p: 3, border: '1px solid', borderColor: 'divider' }}>
        <Stack spacing={2.5}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={1.5}>
            <Stack spacing={0.75}>
              <Typography variant="h2">Compare Saved Runs</Typography>
              <Typography color="text.secondary">
                Select two completed runs from Run History. Comparison is computed locally from saved result CSVs and annotation JSON.
              </Typography>
            </Stack>
            <Button variant="outlined" onClick={onRefreshRunHistory} disabled={runHistoryState.loading}>
              Refresh history
            </Button>
          </Stack>

          {runHistoryState.error && <Alert severity="error">{runHistoryState.error}</Alert>}
          {comparisonState.error && <Alert severity="error">{comparisonState.error}</Alert>}

          {jobs.length >= 2 ? (
            <Stack spacing={2}>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
                  gap: 1.5,
                }}
              >
                <FilterSelect
                  label="Run A"
                  value={runAId}
                  options={jobs.map((job) => [job.job_id, runOptionLabel(job)])}
                  onChange={setRunAId}
                />
                <FilterSelect
                  label="Run B"
                  value={runBId}
                  options={jobs.map((job) => [job.job_id, runOptionLabel(job)])}
                  onChange={setRunBId}
                />
              </Box>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                <Button
                  variant="contained"
                  disabled={comparisonState.loading || !runAId || !runBId || runAId === runBId}
                  onClick={handleCompareRuns}
                >
                  Compare saved runs
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<DownloadOutlinedIcon />}
                  disabled={comparisonState.rows.length === 0}
                  onClick={() => downloadRunComparisonCsv(comparisonState.rows, 'moloptima-run-comparison.csv')}
                >
                  Export comparison CSV
                </Button>
              </Stack>
            </Stack>
          ) : (
            <Alert severity="info">
              At least two completed saved runs are needed for comparison.
            </Alert>
          )}
        </Stack>
      </Paper>

      {comparisonState.loading && <Alert severity="info">Loading and comparing saved runs...</Alert>}

      {comparisonState.rows.length > 0 && (
        <>
          <Paper elevation={0} sx={{ p: 3, border: '1px solid', borderColor: 'divider' }}>
            <Stack spacing={2}>
              <Stack spacing={0.5}>
                <Typography variant="h2">Comparison Summary</Typography>
                <Typography color="text.secondary">
                  Run A: {formatDetailValue(runAId)} | Run B: {formatDetailValue(runBId)}
                </Typography>
              </Stack>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
                  gap: 1.5,
                }}
              >
                <RunSummaryCard label="Shared molecules" value={summary.sharedMolecules} />
                <RunSummaryCard label="Only in Run A" value={summary.onlyInRunA} />
                <RunSummaryCard label="Only in Run B" value={summary.onlyInRunB} />
                <RunSummaryCard label="Changed evidence" value={summary.changedEvidence} />
                <RunSummaryCard label="Changed review status" value={summary.changedReviewStatus} />
                <RunSummaryCard label="Changed BBB prediction" value={summary.changedBbbPrediction} />
                <RunSummaryCard label="Changed public signals" value={summary.changedPublicSignals} />
                <RunSummaryCard label="Compared rows" value={summary.totalRows} />
              </Box>
              {largestPriorityChanges.length > 0 && (
                <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2 }}>
                  <Typography variant="h2" sx={{ mb: 1 }}>
                    Largest Priority Score Changes
                  </Typography>
                  <Stack spacing={0.75}>
                    {largestPriorityChanges.map((row) => (
                      <Typography key={row.comparison_key} color="text.secondary">
                        {formatDetailValue(row.molecule_id)}: {formatDetailValue(row.priority_score_a)} to{' '}
                        {formatDetailValue(row.priority_score_b)} ({formatSignedNumber(row.priority_score_change)})
                      </Typography>
                    ))}
                  </Stack>
                </Box>
              )}
            </Stack>
          </Paper>

          <Paper elevation={0} sx={{ p: 3, border: '1px solid', borderColor: 'divider' }}>
            <Stack spacing={2}>
              <Stack spacing={0.5}>
                <Typography variant="h2">Run Comparison Table</Typography>
                <Typography color="text.secondary">
                  Shared molecules, run-specific molecules, changed evidence, review annotation differences, and priority score change.
                </Typography>
              </Stack>
              <RunComparisonTable rows={comparisonState.rows} />
            </Stack>
          </Paper>
        </>
      )}
    </Stack>
  );
}

function RunComparisonTable({ rows }) {
  return (
    <Box sx={{ overflowX: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Table size="small" aria-label="Run comparison table">
        <TableHead>
          <TableRow>
            {['Molecule', '2D structure', 'Run presence', 'Priority score · run A', 'Priority score · run B',
              'Priority score change', 'Evidence · run A', 'Evidence · run B', 'Biopharma context · run A',
              'Biopharma context · run B', 'Public identity · run A', 'Public identity · run B',
              'Public bioactivity · run A', 'Public bioactivity · run B', 'Patent context · run A',
              'Patent context · run B', 'Local similarity · run A', 'Local similarity · run B',
              'BBB · run A', 'BBB · run B', 'Review status · run A', 'Review status · run B',
              'Review note · run A', 'Review note · run B'].map((label) => <TableCell key={label}>{label}</TableCell>)}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.comparison_key}>
              <TableCell>{formatDetailValue(row.molecule_id)}</TableCell>
              <TableCell>
                <StructureThumbnail smiles={row.canonical_smiles_a || row.canonical_smiles_b || row.input_smiles_a || row.input_smiles_b} />
              </TableCell>
              <TableCell>{formatEvidenceCategory(row.presence)}</TableCell>
              <TableCell>{formatDetailValue(row.priority_score_a)}</TableCell>
              <TableCell>{formatDetailValue(row.priority_score_b)}</TableCell>
              <TableCell>{formatSignedNumber(row.priority_score_change)}</TableCell>
              <TableCell>{formatEvidenceCategory(row.evidence_summary_category_a)}</TableCell>
              <TableCell>{formatEvidenceCategory(row.evidence_summary_category_b)}</TableCell>
              <TableCell>{formatEvidenceCategory(row.biopharma_context_level_a)}</TableCell>
              <TableCell>{formatEvidenceCategory(row.biopharma_context_level_b)}</TableCell>
              <TableCell>{formatEvidenceCategory(row.public_identity_signal_a)}</TableCell>
              <TableCell>{formatEvidenceCategory(row.public_identity_signal_b)}</TableCell>
              <TableCell>{formatEvidenceCategory(row.public_bioactivity_signal_a)}</TableCell>
              <TableCell>{formatEvidenceCategory(row.public_bioactivity_signal_b)}</TableCell>
              <TableCell>{formatEvidenceCategory(row.patent_context_signal_a)}</TableCell>
              <TableCell>{formatEvidenceCategory(row.patent_context_signal_b)}</TableCell>
              <TableCell>{formatEvidenceCategory(row.local_similarity_signal_a)}</TableCell>
              <TableCell>{formatEvidenceCategory(row.local_similarity_signal_b)}</TableCell>
              <TableCell>{formatBbbComparison(row, 'a')}</TableCell>
              <TableCell>{formatBbbComparison(row, 'b')}</TableCell>
              <TableCell>{formatComparisonReviewStatus(row.review_status_a)}</TableCell>
              <TableCell>{formatComparisonReviewStatus(row.review_status_b)}</TableCell>
              <TableCell>{formatDetailValue(row.review_note_a)}</TableCell>
              <TableCell>{formatDetailValue(row.review_note_b)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

function ChemicalSpacePage({ latestRunState, annotationsState, onSaveReviewAnnotation }) {
  const rows = latestRunState.result?.results ?? [];
  const plottedRows = rows.filter(
    (row) => numericValue(row.chemical_space_x) !== null && numericValue(row.chemical_space_y) !== null,
  );
  const targetReferences = latestRunState.result?.target_references?.references ?? [];
  const plottedReferences = targetReferences.filter(
    (row) => numericValue(row.chemical_space_x) !== null && numericValue(row.chemical_space_y) !== null,
  );
  const skippedRows = rows.filter((row) => row.chemical_space_status === 'not_run_invalid_molecule').length;
  const summary = buildChemicalSpaceSummary(rows);
  const [selectedCompoundKey, setSelectedCompoundKey] = useState('');
  const selectedCompound =
    plottedRows.find((row, index) => compoundRowKey(row, index) === selectedCompoundKey) ?? plottedRows[0] ?? null;

  useEffect(() => {
    setSelectedCompoundKey('');
  }, [latestRunState.result?.output_file]);

  return (
    <Stack spacing={3}>
      <PageIntro
        title="Chemical Space"
        description="Inspect a 2D structural diversity map generated from Morgan fingerprints. This visualization is a cheminformatics triage view, not a biological activity map, clinical prediction, or legal conclusion."
      />

      <Paper elevation={0} sx={{ p: 3, border: '1px solid', borderColor: 'divider' }}>
        <Stack spacing={2.5}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={1.5}>
            <Stack spacing={0.75}>
              <Typography variant="h2">Structural Diversity Map</Typography>
              <Typography color="text.secondary">
                {latestRunState.loading
                  ? 'Loading latest completed prioritization run...'
                  : rows.length > 0
                  ? `${plottedRows.length} molecules plotted from the loaded run.`
                  : 'Run molecular prioritization or load a saved run to generate a chemical-space map.'}
              </Typography>
            </Stack>
            {latestRunState.job?.job_id && (
              <Chip title={`Full job ID: ${latestRunState.job.job_id}`} label={`Loaded run: ${compactJobId(latestRunState.job.job_id)}`} color="secondary" variant="outlined" />
            )}
          </Stack>

          {latestRunState.error && <Alert severity="warning">{latestRunState.error}</Alert>}

          {rows.length > 0 ? (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
                gap: 1.5,
              }}
            >
              <RunSummaryCard label="Plotted molecules" value={summary.plottedCount} />
              <RunSummaryCard label="Target references" value={plottedReferences.length} detail={formatScientificPresentationValue(latestRunState.result?.target_references?.source ?? 'not_used')} />
              <RunSummaryCard label="Skipped molecules" value={summary.skippedCount} detail="Invalid or unavailable structures" />
              <RunSummaryCard label="Diversity clusters" value={summary.clusterCount} />
              <RunSummaryCard label="Selected candidates" value={summary.selectedCount} detail="Selected or watchlist" />
            </Box>
          ) : !latestRunState.loading && (
            <Alert severity="info">No loaded result rows are available for chemical-space visualization.</Alert>
          )}
        </Stack>
      </Paper>

      {rows.length > 0 && (
        <Paper elevation={0} sx={{ p: 3, border: '1px solid', borderColor: 'divider' }}>
          <Stack spacing={2}>
            <Stack spacing={0.5}>
              <Typography variant="h2">Morgan Fingerprint PCA Map</Typography>
              <Typography color="text.secondary">
                Point color follows diversity cluster, point size follows priority score, and outlined points mark selected/watchlist candidates. Generated from Morgan fingerprints.
                Target references are plotted in the same projection when target-reference discovery was enabled.
              </Typography>
            </Stack>
            {plottedRows.length > 0 || plottedReferences.length > 0 ? (
              <ChemicalSpacePlot
                rows={plottedRows}
                references={plottedReferences}
                selectedCompoundKey={selectedCompound ? compoundRowKey(selectedCompound, plottedRows.indexOf(selectedCompound)) : ''}
                onSelectCompound={setSelectedCompoundKey}
              />
            ) : (
              <Alert severity="info">
                No valid molecules have chemical-space coordinates. Invalid molecules were skipped.
              </Alert>
            )}
            <Typography variant="caption" color="text.secondary">
              Plotted {plottedRows.length} molecules and {plottedReferences.length} target references, skipped {skippedRows}. Coordinates are a 2D PCA projection of fingerprint bits.
            </Typography>
          </Stack>
        </Paper>
      )}

      {selectedCompound && (
        <CompoundDetailPanel
          compound={selectedCompound}
          jobId={latestRunState.job?.job_id}
          annotationsState={annotationsState}
          onSaveReviewAnnotation={onSaveReviewAnnotation}
        />
      )}
    </Stack>
  );
}

function ChemicalSpacePlot({ rows, references = [], selectedCompoundKey, onSelectCompound }) {
  const width = 760;
  const height = 430;
  const padding = 42;
  const allPoints = [...rows, ...references];
  const xValues = allPoints.map((row) => numericValue(row.chemical_space_x)).filter((value) => value !== null);
  const yValues = allPoints.map((row) => numericValue(row.chemical_space_y)).filter((value) => value !== null);
  const xDomain = paddedDomain(xValues);
  const yDomain = paddedDomain(yValues);

  return (
    <Box sx={{ overflowX: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: '#ffffff' }}>
      <Box
        component="svg"
        role="img"
        aria-label="Chemical-space scatter plot"
        viewBox={`0 0 ${width} ${height}`}
        sx={{ display: 'block', minWidth: 680, width: '100%', height: 'auto' }}
      >
        <rect x="0" y="0" width={width} height={height} fill="#ffffff" />
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#d9e2ea" />
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#d9e2ea" />
        <text x={padding} y={24} fill="#5b6777" fontSize="13">
          Chemical space: Morgan fingerprint PCA
        </text>
        {rows.map((row, index) => {
          const rowKey = compoundRowKey(row, index);
          const xValue = numericValue(row.chemical_space_x) ?? 0;
          const yValue = numericValue(row.chemical_space_y) ?? 0;
          const priorityScore = numericValue(row.priority_score) ?? 0;
          const x = scaleLinear(xValue, xDomain, [padding, width - padding]);
          const y = scaleLinear(yValue, yDomain, [height - padding, padding]);
          const radius = 5 + priorityScore * 7;
          const selected = selectedCompoundKey === rowKey;
          const candidateReviewed = row.review_status === 'selected' || row.review_status === 'watchlist';
          return (
            <g key={rowKey}>
              <circle
                cx={x}
                cy={y}
                r={selected ? radius + 3 : radius}
                fill={chemicalClusterColor(row.diversity_cluster_id)}
                stroke={candidateReviewed ? '#18232f' : selected ? '#145f74' : '#ffffff'}
                strokeWidth={candidateReviewed || selected ? 2.5 : 1}
                opacity={0.86}
                tabIndex={0}
                role="button"
                onClick={() => onSelectCompound(rowKey)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectCompound(rowKey);
                  }
                }}
                style={{ cursor: 'pointer' }}
              >
                <title>{chemicalSpaceTooltip(row)}</title>
              </circle>
              {row.diversity_representative === true && (
                <text x={x + radius + 3} y={y - radius - 3} fill="#18232f" fontSize="12" fontWeight="700">
                  R
                </text>
              )}
            </g>
          );
        })}
        {references.map((reference, index) => {
          const xValue = numericValue(reference.chemical_space_x) ?? 0;
          const yValue = numericValue(reference.chemical_space_y) ?? 0;
          const x = scaleLinear(xValue, xDomain, [padding, width - padding]);
          const y = scaleLinear(yValue, yDomain, [height - padding, padding]);
          const label = reference.compound_name || reference.reference_id || `reference_${index + 1}`;
          return (
            <g key={`reference-${reference.reference_id || index}`}>
              <path
                d={`M ${x} ${y - 8} L ${x + 8} ${y} L ${x} ${y + 8} L ${x - 8} ${y} Z`}
                fill="#b85c00"
                stroke="#ffffff"
                strokeWidth="1.5"
                opacity="0.92"
              >
                <title>{targetReferenceTooltip(reference)}</title>
              </path>
              <text x={x + 10} y={y + 4} fill="#5b3b12" fontSize="11">
                {label.slice(0, 18)}
              </text>
            </g>
          );
        })}
        <text x={width - padding - 116} y={height - 14} fill="#5b6777" fontSize="12">
          priority = point size
        </text>
      </Box>
    </Box>
  );
}

function ReportsPage({ latestRunState, annotationsState, onSaveReviewAnnotation }) {
  const rows = latestRunState.result?.results ?? [];
  const [filters, setFilters] = useState(defaultEvidenceFilters);
  const filteredRows = useMemo(() => applyEvidenceFilters(rows, filters), [rows, filters]);
  const summary = buildReportsSummary(latestRunState);
  const [selectedCompoundKey, setSelectedCompoundKey] = useState('');
  const selectedCompound =
    filteredRows.find((row, index) => compoundRowKey(row, index) === selectedCompoundKey) ?? filteredRows[0] ?? null;

  useEffect(() => {
    setSelectedCompoundKey('');
  }, [latestRunState.result?.output_file, filters]);

  return (
    <Stack spacing={3}>
      <PageIntro
        title="Reports"
        description="Review available local export options for the latest completed prioritization run and download selected compound summaries."
      />

      <Paper elevation={0} sx={{ p: 3, border: '1px solid', borderColor: 'divider' }}>
        <Stack spacing={2.5}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={1.5}>
            <Stack spacing={0.75}>
              <Typography variant="h2">Latest Run Report Options</Typography>
              <Typography color="text.secondary">
                {latestRunState.loading
                  ? 'Loading latest completed prioritization run...'
                  : rows.length > 0
                  ? `Showing ${filteredRows.length} of ${rows.length} molecules. Markdown compound reports are available for the latest completed run.`
                  : 'Upload molecules and run prioritization first to generate report options.'}
              </Typography>
            </Stack>
            {rows.length > 0 && (
              <Chip label={`${summary.totalRows} compounds`} color="secondary" variant="outlined" />
            )}
          </Stack>

          {latestRunState.error && <Alert severity="warning">{latestRunState.error}</Alert>}

          {rows.length > 0 ? (
            <Stack spacing={2.5}>
              <MetadataPanel
                rows={[
                  ['Latest job ID', summary.jobId],
                  ['Result rows', summary.totalRows],
                ]}
              />
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
                  gap: 1.5,
                }}
              >
                <RunSummaryCard label="Valid molecules" value={summary.validMolecules} />
                <RunSummaryCard
                  label="High-priority molecules"
                  value={summary.highPriorityMolecules}
                  detail="priority_score >= 0.75"
                />
                <RunSummaryCard
                  label="Known-compound exact matches"
                  value={summary.knownCompoundMatches}
                />
                <RunSummaryCard
                  label="Candidate shortlist"
                  value={summary.reviewSummary}
                  detail="Local review status counts"
                />
                <RunSummaryCard
                  label="Evidence summary"
                  value={summary.evidenceSummaryTopCategory}
                  detail={summary.evidenceSummaryDetail}
                />
                <RunSummaryCard
                  label="PubChem exact matches"
                  value={summary.pubchemExactMatches}
                  detail={summary.pubchemLookupDetail}
                />
                <RunSummaryCard
                  label="ChEMBL matches"
                  value={summary.chemblMatches}
                  detail={summary.chemblLookupDetail}
                />
                <RunSummaryCard
                  label="Patent-context signals"
                  value={summary.patentSignals}
                  detail={summary.patentLookupDetail}
                />
                <RunSummaryCard
                  label="Structural alerts"
                  value={summary.structuralAlertCount}
                  detail={`${summary.painsAlertCount} PAINS, ${summary.brenkAlertCount} Brenk`}
                />
                <RunSummaryCard
                  label="High-similarity compounds"
                  value={summary.highSimilarityCompounds}
                  detail={`Threshold >= ${highSimilarityThreshold.toFixed(2)}`}
                />
                <RunSummaryCard
                  label="Chemical diversity"
                  value={`${summary.diversityClusterCount} clusters`}
                  detail={`Largest cluster: ${summary.largestDiversityClusterSize}`}
                />
              </Box>
            </Stack>
          ) : !latestRunState.loading && (
            <Alert severity="info">
              No completed run is available yet. Upload molecules and run prioritization first.
            </Alert>
          )}
        </Stack>
      </Paper>

      {rows.length > 0 && (
        <Paper elevation={0} sx={{ p: 3, border: '1px solid', borderColor: 'divider' }}>
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={1.5}>
              <Stack spacing={0.75}>
                <Typography variant="h2">Compounds Available for Export</Typography>
                <Typography color="text.secondary">
                  Select a compound row, download its Markdown report, or export the currently filtered rows.
                </Typography>
              </Stack>
              {selectedCompound && (
                <Button
                  variant="contained"
                  startIcon={<DownloadOutlinedIcon />}
                  onClick={() => downloadCompoundMarkdownReport(selectedCompound)}
                >
                  Download selected
                </Button>
              )}
            </Stack>
            <EvidenceFilterPanel
              rows={rows}
              filteredRows={filteredRows}
              filters={filters}
              onChange={setFilters}
              onReset={() => setFilters(defaultEvidenceFilters)}
              exportFilename="moloptima-reports-filtered.csv"
            />
            <CandidateExportPanel rows={filteredRows} />
            {selectedCompound && (
              <Stack spacing={2}>
                <StructurePreview compound={selectedCompound} />
                <ReviewAnnotationControls
                  compound={selectedCompound}
                  annotationsState={annotationsState}
                  onSaveReviewAnnotation={onSaveReviewAnnotation}
                />
              </Stack>
            )}
            <ReportsCompoundTable
              rows={filteredRows}
              selectedCompoundKey={selectedCompound ? compoundRowKey(selectedCompound, filteredRows.indexOf(selectedCompound)) : ''}
              onSelectCompound={setSelectedCompoundKey}
            />
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}

function ReportsCompoundTable({ rows, selectedCompoundKey, onSelectCompound }) {
  return (
    <Box sx={{ overflowX: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Table size="small" aria-label="Compounds available for Markdown report export">
        <TableHead>
          <TableRow>
            {['Molecule', 'Priority score', 'Valid molecule', 'Review status', 'Review note', 'Evidence summary',
              'Structural alerts', 'PAINS alert', 'Brenk alert', 'Diversity cluster', 'Cluster representative',
              'Nearest-neighbor similarity', 'Combined candidate score', 'Docking priority signal',
              'Known compound', 'PubChem lookup status', 'ChEMBL lookup status', 'ChEMBL activity records',
              'Patent lookup status', 'SureChEMBL returned records', 'Closest-known similarity', 'BBB prediction']
              .map((label) => <TableCell key={label}>{label}</TableCell>)}
            <TableCell>Export</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, index) => {
            const rowKey = compoundRowKey(row, index);
            return (
              <TableRow
                hover
                key={rowKey}
                selected={selectedCompoundKey === rowKey}
                onClick={() => onSelectCompound(rowKey)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectCompound(rowKey);
                  }
                }}
                tabIndex={0}
                sx={{ cursor: 'pointer' }}
              >
                <TableCell>{formatDetailValue(row.molecule_id)}</TableCell>
                <TableCell>{formatDetailValue(row.priority_score)}</TableCell>
                <TableCell>{formatBooleanLabel(row.valid_molecule)}</TableCell>
                <TableCell>{formatReviewStatus(row.review_status)}</TableCell>
                <TableCell>{formatDetailValue(row.review_note)}</TableCell>
                <TableCell>{formatEvidenceCategory(row.evidence_summary_category)}</TableCell>
                <TableCell>{formatStructuralAlertStatus(row)}</TableCell>
                <TableCell>{formatBooleanLabel(row.pains_alert)}</TableCell>
                <TableCell>{formatBooleanLabel(row.brenk_alert)}</TableCell>
                <TableCell>{formatDiversityCluster(row)}</TableCell>
                <TableCell>{formatBooleanLabel(row.diversity_representative)}</TableCell>
                <TableCell>{formatNearestNeighbor(row)}</TableCell>
                <TableCell>{formatDetailValue(row.combined_candidate_score)}</TableCell>
                <TableCell>{formatEvidenceCategory(row.docking_priority_signal)}</TableCell>
                <TableCell>{formatDetailValue(row.known_compound_name)}</TableCell>
                <TableCell>{formatScientificPresentationValue(row.pubchem_lookup_status)}</TableCell>
                <TableCell>{formatScientificPresentationValue(row.chembl_lookup_status)}</TableCell>
                <TableCell>{formatDetailValue(row.chembl_activity_count)}</TableCell>
                <TableCell>{formatScientificPresentationValue(row.patent_lookup_status)}</TableCell>
                <TableCell>{formatDetailValue(row.patent_record_count)}</TableCell>
                <TableCell>{formatDetailValue(row.closest_known_compound_similarity)}</TableCell>
                <TableCell>{formatEvidenceCategory(row.bbb_prediction)}</TableCell>
                <TableCell>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<DownloadOutlinedIcon />}
                    onClick={(event) => {
                      event.stopPropagation();
                      downloadCompoundMarkdownReport(row);
                    }}
                  >
                    Markdown
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  );
}

function buildReportsSummary(latestRunState) {
  const rows = latestRunState.result?.results ?? [];
  const evidenceCategoryCounts = countValues(rows.map((row) => row.evidence_summary_category).filter(Boolean));
  const topEvidenceCategory = topCountLabel(evidenceCategoryCounts);
  const reviewSummary = formatReviewCounts(rows);
  const diversitySummary = buildDiversitySummary(rows);
  const structuralAlertSummary = buildStructuralAlertSummary(rows);

  return {
    jobId: latestRunState.job?.job_id ?? latestRunState.result?.job_id ?? 'Not available',
    totalRows: Number(latestRunState.result?.row_count ?? rows.length),
    validMolecules: rows.filter((row) => isTrueValue(row.valid_molecule)).length,
    highPriorityMolecules: rows.filter((row) => Number(row.priority_score ?? 0) >= 0.75).length,
    knownCompoundMatches: rows.filter((row) => isTrueValue(row.known_compound_match)).length,
    pubchemExactMatches: rows.filter((row) => isTrueValue(row.pubchem_exact_match)).length,
    pubchemLookupDetail: formatCounts(countValues(rows.map((row) => row.pubchem_lookup_status).filter(Boolean))) || 'Public lookup not run',
    chemblMatches: rows.filter(
      (row) => isTrueValue(row.chembl_exact_match) || isTrueValue(row.chembl_similarity_match),
    ).length,
    chemblLookupDetail: formatCounts(countValues(rows.map((row) => row.chembl_lookup_status).filter(Boolean))) || 'ChEMBL lookup not run',
    patentSignals: rows.filter((row) => isTrueValue(row.patent_public_evidence_match)).length,
    patentLookupDetail: formatCounts(countValues(rows.map((row) => row.patent_lookup_status).filter(Boolean))) || 'Patent-context lookup not run',
    reviewSummary,
    structuralAlertCount: structuralAlertSummary.alertMoleculeCount,
    painsAlertCount: structuralAlertSummary.painsAlertCount,
    brenkAlertCount: structuralAlertSummary.brenkAlertCount,
    diversityClusterCount: diversitySummary.clusterCount,
    largestDiversityClusterSize: diversitySummary.largestClusterSize,
    evidenceSummaryTopCategory: topEvidenceCategory ? formatEvidenceCategory(topEvidenceCategory) : 'Not available',
    evidenceSummaryDetail: formatCounts(evidenceCategoryCounts) || 'No evidence synthesis available',
    highSimilarityCompounds: rows.filter((row) => {
      const similarity = numericValue(row.closest_known_compound_similarity);
      return similarity !== null && similarity >= highSimilarityThreshold;
    }).length,
  };
}

function buildLatestRunSummary(prioritizationState) {
  const result = prioritizationState.result;
  const rows = result?.results ?? [];

  if (!result || rows.length === 0) {
    return null;
  }

  const totalMolecules = Number(result.row_count ?? rows.length);
  const validMolecules = rows.filter((row) => isTrueValue(row.valid_molecule)).length;
  const highPriorityMolecules = rows.filter((row) => Number(row.priority_score ?? 0) >= 0.75).length;
  const bbbAvailable = rows.filter((row) => row.bbb_model_status === 'model_available').length;
  const bbbUnavailable = rows.length - bbbAvailable;
  const dockingProvided = rows.filter((row) => row.docking_status === 'provided').length;
  const dockingInvalid = rows.filter((row) => row.docking_status === 'invalid_docking_score').length;
  const dockingNotProvided = rows.length - dockingProvided - dockingInvalid;
  const syntheticCounts = countValues(
    rows
      .map((row) => row.synthetic_feasibility_category)
      .filter((category) => category && category !== 'not_available'),
  );
  const syntheticSummary = formatCounts(syntheticCounts) || 'Not available';
  const syntheticDetail =
    syntheticSummary === 'Not available' ? 'No synthetic feasibility categories in latest result' : '';

  return {
    totalMolecules,
    validMolecules,
    highPriorityMolecules,
    completedAt: prioritizationState.job?.completed_at ?? '',
    bbbModelSummary: bbbAvailable > 0 ? 'Available' : 'Unavailable',
    bbbModelDetail: `${bbbAvailable} available, ${bbbUnavailable} unavailable`,
    dockingSummary: `${dockingProvided} provided`,
    dockingDetail: `${dockingNotProvided} not provided, ${dockingInvalid} invalid`,
    syntheticSummary,
    syntheticDetail,
  };
}

function countValues(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function formatCounts(counts) {
  return Object.entries(counts)
    .map(([label, count]) => `${formatScientificPresentationValue(label)}: ${count}`)
    .join(', ');
}

function UploadMoleculesPage({ uploadState, backendHealth, onUpload, onCancelImport, onChange, onContinue }) {
  return <MoleculeInputPanel uploadState={uploadState} backendHealth={backendHealth} onImport={onUpload} onCancelImport={onCancelImport} onChange={onChange} onContinue={onContinue} />;
}

export function CandidateExportPanel({ rows }) {
  const [sdfExportState, setSdfExportState] = useState({ loading: false, message: '', error: '' });
  const selectedRows = candidateRowsForStatuses(rows, ['selected']);
  const watchlistRows = candidateRowsForStatuses(rows, ['watchlist']);
  const combinedRows = candidateRowsForStatuses(rows, ['selected', 'watchlist']);

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2 }}>
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={1.5}>
          <Stack spacing={0.25}>
            <Typography variant="h2">Candidate Export</Typography>
            <Typography color="text.secondary">
              Scientific handoff package for reviewed candidates. Review status and notes included.
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Available in current view: Selected {selectedRows.length}, Watchlist {watchlistRows.length}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Chemical diversity: {formatDiversitySummary(combinedRows)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Medicinal chemistry alerts: {formatStructuralAlertSummary(combinedRows)}
            </Typography>
          </Stack>
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} flexWrap="wrap" useFlexGap>
          <Button
            variant="outlined"
            startIcon={<DownloadOutlinedIcon />}
            disabled={selectedRows.length === 0}
            onClick={() => downloadCandidatePackageCsv(selectedRows, 'moloptima-selected-candidates.csv')}
          >
            Export selected candidates
          </Button>
          <Button
            variant="outlined"
            startIcon={<DownloadOutlinedIcon />}
            disabled={watchlistRows.length === 0}
            onClick={() => downloadCandidatePackageCsv(watchlistRows, 'moloptima-watchlist-candidates.csv')}
          >
            Export watchlist
          </Button>
          <Button
            variant="contained"
            startIcon={<DownloadOutlinedIcon />}
            disabled={combinedRows.length === 0}
            onClick={() => downloadCandidatePackageCsv(combinedRows, 'moloptima-selected-watchlist-candidates.csv')}
          >
            Export selected + watchlist candidates
          </Button>
          <Button
            variant="outlined"
            startIcon={<DownloadOutlinedIcon />}
            disabled={combinedRows.length === 0}
            onClick={() => downloadCandidatePackageMarkdown(combinedRows, 'moloptima-candidate-handoff-summary.md')}
          >
            Markdown handoff summary
          </Button>
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} flexWrap="wrap" useFlexGap>
          <Button
            variant="outlined"
            startIcon={<DownloadOutlinedIcon />}
            disabled={sdfExportState.loading || selectedRows.length === 0}
            onClick={() => downloadCandidatePackageSdf(selectedRows, 'moloptima-selected-candidates.sdf', setSdfExportState)}
          >
            Export selected candidates as SDF
          </Button>
          <Button
            variant="outlined"
            startIcon={<DownloadOutlinedIcon />}
            disabled={sdfExportState.loading || watchlistRows.length === 0}
            onClick={() => downloadCandidatePackageSdf(watchlistRows, 'moloptima-watchlist-candidates.sdf', setSdfExportState)}
          >
            Export watchlist candidates as SDF
          </Button>
          <Button
            variant="contained"
            startIcon={<DownloadOutlinedIcon />}
            disabled={sdfExportState.loading || combinedRows.length === 0}
            onClick={() => downloadCandidatePackageSdf(combinedRows, 'moloptima-selected-watchlist-candidates.sdf', setSdfExportState)}
          >
            Export selected + watchlist as SDF
          </Button>
        </Stack>
        {sdfExportState.message && <Alert severity="success">{sdfExportState.message}</Alert>}
        {sdfExportState.error && <Alert severity="warning">{sdfExportState.error}</Alert>}
        {combinedRows.length === 0 && (
          <Alert severity="info">
            Mark molecules as Selected or Watchlist to create a candidate handoff package.
          </Alert>
        )}
      </Stack>
    </Box>
  );
}

export function PrioritizationPage({
  uploadState,
  prioritizationState,
  onStartPrioritization,
  onCancelPrioritization,
  pubchemLookupEnabled,
  setPubchemLookupEnabled,
  chemblLookupEnabled,
  setChemblLookupEnabled,
  patentLookupEnabled,
  setPatentLookupEnabled,
  targetReferenceEnabled,
  setTargetReferenceEnabled,
  targetContext,
  setTargetContext,
  prioritizationSettings,
  setPrioritizationSettings,
  annotationsState,
  onSaveReviewAnnotation,
  onNavigate,
}) {
  const resultRows = prioritizationState.result?.results ?? [];
  const summary = normalizePrioritizationSummary(prioritizationState);
  const single = uploadState.upload?.analysis_mode === 'single_compound'
    || prioritizationState.job?.analysis_mode === 'single_compound';

  return (
    <Stack spacing={3}>
      <PageIntro
        title={single ? 'Compound Assessment' : 'Prioritization'}
        description={single
          ? 'Run molecular properties, ADMET, optional docking, and profile interpretation without fabricating library-relative scores or rank.'
          : 'Choose the scoring method and profile, inspect scoring readiness, and run the existing auditable library prioritization pipeline.'}
      />

      {single ? <Alert severity="info">Available: Molecular Properties, ADMET, Docking, and Profile Interpretation. Not applicable: Library Prioritization, Pareto Analysis, and Rank Sensitivity.</Alert> : null}

      <PrioritizationSettings
        apiBaseUrl={apiBaseUrl}
        value={prioritizationSettings}
        onChange={setPrioritizationSettings}
      />

      <Paper elevation={0} sx={{ p: 3, border: '1px solid', borderColor: 'divider' }}>
        <Stack spacing={2.5}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={2}>
            <Stack spacing={0.75}>
              <Typography variant="h2">{single ? 'Single Compound Analysis' : 'Prioritization Job'}</Typography>
              <Typography color="text.secondary">
                {uploadState.upload
                  ? `Ready to run upload_id ${uploadState.upload.upload_id}`
                  : 'Load one or more valid compounds before starting a calculation.'}
              </Typography>
            </Stack>
            <Stack spacing={1.25} alignItems={{ xs: 'stretch', md: 'flex-end' }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={pubchemLookupEnabled}
                    onChange={(event) => setPubchemLookupEnabled(event.target.checked)}
                  />
                }
                label="Enable PubChem exact identity check"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={chemblLookupEnabled}
                    onChange={(event) => setChemblLookupEnabled(event.target.checked)}
                  />
                }
                label="Enable ChEMBL public bioactivity context"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={patentLookupEnabled}
                    onChange={(event) => setPatentLookupEnabled(event.target.checked)}
                  />
                }
                label="Enable SureChEMBL patent-context signal"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={targetReferenceEnabled}
                    onChange={(event) => setTargetReferenceEnabled(event.target.checked)}
                  />
                }
                label="Enable target reference discovery"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={Boolean(targetContext.enable_docking)}
                    onChange={(event) => setTargetContext({ ...targetContext, enable_docking: event.target.checked })}
                  />
                }
                label="Enable local Vina docking"
              />
              {targetContext.enable_docking && (
                <Typography variant="caption" color="text.secondary">
                  Docking configuration: {targetContext.docking_configuration_id || 'not configured on Receptor & Docking page'}
                </Typography>
              )}
              {targetReferenceEnabled && (
                <TargetContextFields targetContext={targetContext} setTargetContext={setTargetContext} />
              )}
              <Button
                variant="contained"
                onClick={onStartPrioritization}
                disabled={
                  validatedMoleculeCount(uploadState.upload) === 0
                  || prioritizationState.loading
                  || (prioritizationSettings.method === 'v2'
                    && !prioritizationSettings.validation?.scoreable)
                }
                startIcon={prioritizationState.loading ? <CircularProgress size={18} color="inherit" /> : null}
              >
                {prioritizationState.loading ? 'Running' : single ? 'Start compound assessment' : 'Start prioritization'}
              </Button>
              {prioritizationState.job
                && !TERMINAL_JOB_STATUSES.has(prioritizationState.job.status) ? (
                  <Button variant="outlined" color="warning" onClick={onCancelPrioritization}>
                    Request cancellation
                  </Button>
                ) : null}
            </Stack>
          </Stack>

          <Alert severity={pubchemLookupEnabled || chemblLookupEnabled || patentLookupEnabled || targetReferenceEnabled ? 'warning' : 'info'}>
            {pubchemLookupEnabled || chemblLookupEnabled || patentLookupEnabled || targetReferenceEnabled
              ? 'Selected public lookups may use the network. PubChem, ChEMBL, SureChEMBL, and target-reference results are cached locally and reported as research signals only.'
              : 'Public compound lookup is off. Output rows will mark PubChem, ChEMBL, and patent-context lookup as Not requested.'}
          </Alert>

          {prioritizationState.error && <Alert severity="error">{prioritizationState.error}</Alert>}

          {prioritizationState.job && (
            <MetadataPanel
              rows={[
                ['Status', prioritizationState.job.status],
                ['Stage', prioritizationState.job.stage],
                ['Job ID', prioritizationState.job.job_id],
                ['Submitted', summary.submittedCount],
                ['Processed', `${summary.processedCount} / ${summary.totalCount}`],
                ['Docking successes', prioritizationState.job.docking_success_count ?? 0],
                ['Docking failures', prioritizationState.job.docking_failure_count ?? 0],
                ['Valid molecules', summary.validCount],
                [single ? 'Library score' : 'Fully scored', single ? 'Not applicable' : summary.fullyScoredCount],
                [single ? 'Library rank' : 'Partially scored', single ? 'Not applicable' : summary.partiallyScoredCount],
                ['Unscorable / invalid', summary.unscorableCount],
                ['Scientifically ranked', single ? 'Not applicable' : summary.rankedCount],
                ['Eligible for final ranking', single ? 'Not applicable' : summary.eligibleForRankingCount],
                ['Awaiting / missing docking', summary.awaitingOrMissingDockingCount],
                ['Docking failed / unavailable', summary.dockingFailedOrUnavailableCount],
                ['Warnings', prioritizationState.job.warning_count],
                ['Cancellation requested', prioritizationState.job.cancellation_requested ? 'yes' : 'no'],
                ['Output file', prioritizationState.job.output_file],
                ['Completed at', prioritizationState.job.completed_at ?? ''],
                ['Candidate shortlist', single ? 'Not applicable' : formatReviewCounts(resultRows)],
                ['Chemical diversity', single ? 'Not applicable' : formatDiversitySummary(resultRows)],
                ['Target reference set', formatTargetReferenceSet(prioritizationState.result?.target_references)],
              ]}
            />
          )}
        </Stack>
      </Paper>

      {prioritizationState.result && (
        <Paper elevation={0} sx={{ p: 3, border: '1px solid', borderColor: 'divider' }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} justifyContent="space-between">
            <Box><Typography variant="h2">{summary.completionTitle(single)}</Typography><Typography color="text.secondary">{summary.completionMessage}</Typography></Box>
            <Button variant="contained" onClick={() => onNavigate('Results')}>Open Results</Button>
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}

export function normalizePrioritizationSummary(prioritizationState) {
  const job = prioritizationState?.job ?? {};
  const result = prioritizationState?.result ?? null;
  const rows = result?.results ?? [];
  const completed = job.status === 'completed';
  const failed = job.status === 'failed';
  const method = result?.prioritization_method ?? job.prioritization_method ?? 'legacy_v1';
  const currentFormat = ['v2', 'profile_v2'].includes(method);
  const validRows = rows.filter((row) => isTrueValue(row.valid_molecule));
  const invalidRows = rows.filter((row) => isFalseValue(row.valid_molecule));
  const statusRows = rows.filter((row) => row.prioritization_status);
  const explicitRankedRows = rows.filter((row) => (
    row.scientific_rank !== null && row.scientific_rank !== undefined && row.scientific_rank !== ''
  ) || (
    row.v2_rank !== null && row.v2_rank !== undefined && row.v2_rank !== ''
  ));
  const resultCount = rows.length;
  const submittedCount = Number(job.submitted_count ?? result?.submitted_count ?? result?.row_count ?? resultCount);
  const totalCount = Number(job.total_count ?? submittedCount ?? resultCount);
  const processedCount = result ? resultCount : Number(job.processed_count ?? 0);
  const unavailable = 'Not available';
  const rowDerivedOrUnavailable = (status, fallback) => statusRows.length
    ? statusRows.filter((row) => row.prioritization_status === status).length
    : fallback ?? unavailable;

  let completionMessage;
  if (failed) completionMessage = job.error_message || 'The calculation did not complete.';
  else if (!completed) completionMessage = `Calculation ${job.status || 'is incomplete'}; ${resultCount} result row${resultCount === 1 ? ' is' : 's are'} currently available.`;
  else if (resultCount === 0) completionMessage = 'Calculation completed with no result rows.';
  else completionMessage = `${resultCount} result row${resultCount === 1 ? ' is' : 's are'} ready for inspection.`;

  return {
    submittedCount,
    totalCount,
    processedCount,
    resultCount,
    validCount: result ? validRows.length : Number(job.valid_count ?? job.eligible_count ?? 0),
    invalidCount: result ? invalidRows.length : Number(job.invalid_count ?? 0),
    fullyScoredCount: currentFormat ? rowDerivedOrUnavailable('fully_scored', job.fully_scored_count) : unavailable,
    partiallyScoredCount: currentFormat ? rowDerivedOrUnavailable('partially_scored', job.partially_scored_count) : unavailable,
    unscorableCount: statusRows.length
      ? statusRows.filter((row) => row.prioritization_status === 'unscorable').length
      : result ? invalidRows.length : Number(job.unscorable_count ?? 0),
    rankedCount: currentFormat
      ? (rows.length ? explicitRankedRows.length : Number(job.ranked_count ?? 0))
      : explicitRankedRows.length || unavailable,
    eligibleForRankingCount: currentFormat
      ? (rows.some((row) => row.rank_eligible !== undefined)
        ? rows.filter((row) => isTrueValue(row.rank_eligible)).length
        : Number(job.eligible_for_ranking_count ?? 0))
      : unavailable,
    awaitingOrMissingDockingCount: currentFormat
      ? rowDerivedOrUnavailable('awaiting_docking', job.awaiting_or_missing_docking_count)
      : unavailable,
    dockingFailedOrUnavailableCount: currentFormat
      ? (statusRows.length
        ? statusRows.filter((row) => ['docking_failed', 'docking_unavailable'].includes(row.prioritization_status)).length
        : Number(job.docking_failed_or_unavailable_count ?? 0))
      : unavailable,
    completionMessage,
    completionTitle: (single) => {
      if (failed) return 'Calculation failed';
      if (!completed) return 'Calculation incomplete';
      return single ? 'Single Compound Assessment complete' : 'Prioritization complete';
    },
  };
}

function PageIntro({ title, description }) {
  return (
    <Paper elevation={0} sx={{ width: '100%', maxWidth: READABLE_CONTENT_MAX_WIDTH, mx: 'auto', p: { xs: 2.5, md: 3 }, border: '1px solid', borderColor: 'divider' }}>
      <Stack spacing={1.25} sx={{ maxWidth: 780 }}>
        <Typography component="h1" variant="h1">
          {title}
        </Typography>
        <Typography color="text.secondary">{description}</Typography>
      </Stack>
    </Paper>
  );
}

function TargetContextFields({ targetContext, setTargetContext }) {
  const updateTargetContext = (key, value) => {
    setTargetContext({ ...targetContext, [key]: value });
  };
  const fields = [
    ['target_name', 'Target name'],
    ['target_gene_symbol', 'Gene symbol'],
    ['target_chembl_id', 'ChEMBL target ID'],
    ['target_uniprot_id', 'UniProt ID'],
    ['pdb_id', 'PDB ID'],
    ['organism', 'Organism'],
    ['disease_context', 'Disease context'],
    ['mechanism_context', 'Mechanism context'],
  ];

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
        gap: 1,
        minWidth: { md: 460 },
      }}
    >
      {fields.map(([key, label]) => (
        <TextField
          key={key}
          label={label}
          size="small"
          value={targetContext[key] ?? ''}
          onChange={(event) => updateTargetContext(key, event.target.value)}
        />
      ))}
      <TextField
        label="Docking protocol notes"
        size="small"
        value={targetContext.docking_protocol_notes ?? ''}
        onChange={(event) => updateTargetContext('docking_protocol_notes', event.target.value)}
        sx={{ gridColumn: { md: '1 / -1' } }}
      />
      <TextField
        label="Binding site notes"
        size="small"
        value={targetContext.binding_site_notes ?? ''}
        onChange={(event) => updateTargetContext('binding_site_notes', event.target.value)}
        sx={{ gridColumn: { md: '1 / -1' } }}
      />
    </Box>
  );
}

const DOCKING_REQUEST_NUMERIC_FIELDS = [
  'docking_center_x', 'docking_center_y', 'docking_center_z',
  'docking_size_x', 'docking_size_y', 'docking_size_z',
  'docking_exhaustiveness', 'docking_num_modes', 'docking_energy_range',
  'docking_seed', 'docking_worker_count',
];

function normalizedDockingRequest(targetContext) {
  return Object.fromEntries(DOCKING_REQUEST_NUMERIC_FIELDS.map((key) => [
    key,
    targetContext[key] === '' || targetContext[key] === null || targetContext[key] === undefined
      ? null
      : Number(targetContext[key]),
  ]));
}

function MetadataPanel({ rows }) {
  return (
    <Box
      sx={{
        width: '100%',
        maxWidth: SUMMARY_CONTENT_MAX_WIDTH,
        mx: 'auto',
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
        gap: 1.5,
      }}
    >
      {rows.map(([label, value]) => (
        <Box
          key={label}
          sx={{
            p: 1.5,
            borderRadius: 1,
            bgcolor: '#f7fafc',
            border: '1px solid',
            borderColor: 'divider',
            minWidth: 0,
          }}
        >
          <Typography variant="caption" color="text.secondary">
            {label}
          </Typography>
          <Typography sx={{ fontWeight: 650, overflowWrap: 'anywhere' }}>{String(value ?? '')}</Typography>
        </Box>
      ))}
    </Box>
  );
}

const defaultEvidenceFilters = {
  evidence_summary_category: '',
  biopharma_context_level: '',
  public_identity_signal: '',
  public_bioactivity_signal: '',
  patent_context_signal: '',
  local_similarity_signal: '',
  active_neighborhood_signal: '',
  structural_alert_status: '',
  pains_alert: '',
  brenk_alert: '',
  docking_priority_signal: '',
  priority_score_min: '',
  combined_candidate_score_min: '',
  bbb_prediction: '',
  bbb_model_status: '',
  valid_molecule: '',
  review_status: '',
  diversity_representative: '',
};

const evidenceFilterFields = [
  ['evidence_summary_category', 'Evidence summary'],
  ['biopharma_context_level', 'Biopharma context level'],
  ['public_identity_signal', 'Public identity signal'],
  ['public_bioactivity_signal', 'Public bioactivity signal'],
  ['patent_context_signal', 'Patent-context signal'],
  ['local_similarity_signal', 'Local similarity signal'],
  ['active_neighborhood_signal', 'Active-neighborhood signal'],
  ['structural_alert_status', 'Structural alerts'],
  ['pains_alert', 'PAINS alert'],
  ['brenk_alert', 'Brenk alert'],
  ['docking_priority_signal', 'Docking priority signal'],
  ['bbb_prediction', 'BBB prediction'],
  ['bbb_model_status', 'BBB status'],
  ['review_status', 'Review status'],
  ['diversity_representative', 'Cluster representative'],
];

export function EvidenceFilterPanel({ rows, filteredRows, filters, onChange, onReset, exportFilename }) {
  const updateFilter = (key, value) => {
    onChange({ ...filters, [key]: value });
  };

  return (
    <Box sx={{ width: '100%', maxWidth: READABLE_CONTENT_MAX_WIDTH, mx: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2 }}>
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ xs: 'stretch', md: 'flex-start' }} justifyContent="space-between" gap={1.5}>
          <Stack spacing={0.25}>
            <Typography variant="h2">Evidence Filters</Typography>
            <Typography color="text.secondary">
              Showing {filteredRows.length} of {rows.length} molecules
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Candidate shortlist: {formatReviewCounts(rows)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Chemical diversity: {formatDiversitySummary(rows)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Medicinal chemistry alerts: {formatStructuralAlertSummary(rows)}
            </Typography>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} sx={{ flexShrink: 0 }}>
            <Button variant="outlined" onClick={onReset}>
              Clear filters
            </Button>
            <Button
              variant="contained"
              aria-label="Export filtered results as CSV"
              startIcon={<DownloadOutlinedIcon />}
              disabled={filteredRows.length === 0}
              onClick={() => downloadRowsCsv(filteredRows, exportFilename)}
            >
              Export filtered CSV
            </Button>
          </Stack>
        </Stack>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
            gap: 1.5,
          }}
        >
          {evidenceFilterFields.map(([key, label]) => (
            <FilterSelect
              key={key}
              label={label}
              value={filters[key]}
              options={filterOptions(rows, key)}
              onChange={(value) => updateFilter(key, value)}
            />
          ))}
          <FilterNumberInput
            label="Minimum priority score"
            value={filters.priority_score_min}
            onChange={(value) => updateFilter('priority_score_min', value)}
          />
          <FilterNumberInput
            label="Minimum combined candidate score"
            value={filters.combined_candidate_score_min}
            onChange={(value) => updateFilter('combined_candidate_score_min', value)}
          />
          <FilterSelect
            label="Molecule status"
            value={filters.valid_molecule}
            options={[
              ['valid', 'Valid molecules'],
              ['invalid', 'Invalid molecules'],
            ]}
            onChange={(value) => updateFilter('valid_molecule', value)}
          />
        </Box>

        {rows.length > 0 && filteredRows.length === 0 && (
          <Alert severity="info">No molecules match the current filters.</Alert>
        )}
      </Stack>
    </Box>
  );
}

function FilterSelect({ label, value, options, onChange }) {
  return (
    <Box component="label" sx={{ display: 'grid', gap: 0.5 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Box
        component="select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        sx={{
          width: '100%',
          minHeight: 38,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          bgcolor: 'background.paper',
          color: 'text.primary',
          px: 1,
        }}
      >
        <option value="">All</option>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </Box>
    </Box>
  );
}

function FilterNumberInput({ label, value, onChange }) {
  return (
    <Box component="label" sx={{ display: 'grid', gap: 0.5 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Box
        component="input"
        type="number"
        min="0"
        max="1"
        step="0.01"
        value={value}
        placeholder="All"
        onChange={(event) => onChange(event.target.value)}
        sx={{
          width: '100%',
          minHeight: 38,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          bgcolor: 'background.paper',
          color: 'text.primary',
          px: 1,
          boxSizing: 'border-box',
        }}
      />
    </Box>
  );
}

function ReviewAnnotationControls({ compound, annotationsState, onSaveReviewAnnotation }) {
  const [draftStatus, setDraftStatus] = useState(compound.review_status ?? 'unreviewed');
  const [draftNote, setDraftNote] = useState(compound.review_note ?? '');

  useEffect(() => {
    setDraftStatus(compound.review_status ?? 'unreviewed');
    setDraftNote(compound.review_note ?? '');
  }, [compound.review_annotation_key, compound.review_status, compound.review_note]);

  const annotationChanged =
    draftStatus !== (compound.review_status ?? 'unreviewed') ||
    draftNote !== (compound.review_note ?? '');

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2 }}>
      <Stack spacing={1.5}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={1.5}>
          <Stack spacing={0.25}>
            <Typography variant="h2">Candidate shortlist</Typography>
            <Typography color="text.secondary">
              Assign a local review status and short note for this loaded run.
            </Typography>
          </Stack>
          <Chip
            label={formatReviewStatus(compound.review_status)}
            color={reviewStatusColor(compound.review_status)}
            variant="outlined"
          />
        </Stack>
        {annotationsState?.error && <Alert severity="warning">{annotationsState.error}</Alert>}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '220px minmax(0, 1fr) auto' },
            gap: 1.5,
            alignItems: 'end',
          }}
        >
          <FilterSelect
            label="Review status"
            value={draftStatus}
            options={reviewStatuses.map((statusValue) => [statusValue, reviewStatusLabels[statusValue]])}
            onChange={setDraftStatus}
          />
          <FilterTextInput
            label="Review note"
            value={draftNote}
            maxLength={500}
            onChange={setDraftNote}
          />
          <Button
            variant="contained"
            disabled={!annotationChanged || annotationsState?.saving}
            onClick={() =>
              onSaveReviewAnnotation(compound.review_annotation_key, {
                review_status: draftStatus,
                review_note: draftNote,
              })
            }
          >
            {annotationsState?.saving ? 'Saving' : 'Save note'}
          </Button>
        </Box>
      </Stack>
    </Box>
  );
}

function StructurePreview({ compound }) {
  const smiles = structurePreviewSmiles(compound);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [smiles]);

  if (!smiles || failed) {
    return <Alert severity="info">Invalid or unavailable structure.</Alert>;
  }

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2 }}>
      <Stack spacing={1.25}>
        <Stack spacing={0.25}>
          <Typography variant="h2">2D structure</Typography>
          <Typography variant="caption" color="text.secondary">
            Structure preview generated from SMILES.
          </Typography>
        </Stack>
        <Box
          sx={{
            bgcolor: '#fff',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            display: 'flex',
            justifyContent: 'center',
            minHeight: 220,
            p: 1,
          }}
        >
          <Box
            component="img"
            src={structureImageUrl(smiles, 360, 240)}
            alt="2D chemical structure generated from SMILES"
            onError={() => setFailed(true)}
            sx={{ maxWidth: '100%', height: 'auto' }}
          />
        </Box>
      </Stack>
    </Box>
  );
}

function StructureThumbnail({ smiles }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [smiles]);

  if (!smiles || failed) {
    return (
      <Typography variant="caption" color="text.secondary">
        Unavailable
      </Typography>
    );
  }

  return (
    <Box
      component="img"
      src={structureImageUrl(smiles, 140, 110)}
      alt="2D structure thumbnail"
      onError={() => setFailed(true)}
      sx={{
        bgcolor: '#fff',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        display: 'block',
        height: 'auto',
        maxWidth: '100%',
        width: 140,
      }}
    />
  );
}

function structurePreviewSmiles(compound) {
  return compound?.canonical_smiles || compound?.input_smiles || '';
}

function structureImageUrl(smiles, width, height) {
  const params = new URLSearchParams({
    smiles,
    width: String(width),
    height: String(height),
  });
  return `${apiBaseUrl}/api/molecules/structure?${params.toString()}`;
}

function FilterTextInput({ label, value, maxLength, onChange }) {
  return (
    <Box component="label" sx={{ display: 'grid', gap: 0.5 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Box
        component="input"
        type="text"
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        sx={{
          width: '100%',
          minHeight: 38,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          bgcolor: 'background.paper',
          color: 'text.primary',
          px: 1,
          boxSizing: 'border-box',
        }}
      />
    </Box>
  );
}

function applyEvidenceFilters(rows, filters) {
  const minimumPriority = numericValue(filters.priority_score_min);
  const minimumCombinedScore = numericValue(filters.combined_candidate_score_min);

  return rows.filter((row) => {
    for (const [key] of evidenceFilterFields) {
      if (filters[key] && normalizedFilterValue(row[key]) !== filters[key]) {
        return false;
      }
    }
    if (minimumPriority !== null) {
      const priorityScore = numericValue(row.priority_score);
      if (priorityScore === null || priorityScore < minimumPriority) {
        return false;
      }
    }
    if (minimumCombinedScore !== null) {
      const combinedScore = numericValue(row.combined_candidate_score);
      if (combinedScore === null || combinedScore < minimumCombinedScore) {
        return false;
      }
    }
    if (filters.valid_molecule === 'valid' && !isTrueValue(row.valid_molecule)) {
      return false;
    }
    if (filters.valid_molecule === 'invalid' && !isFalseValue(row.valid_molecule)) {
      return false;
    }
    return true;
  });
}

function filterOptions(rows, key) {
  const booleanField = key === 'pains_alert' || key === 'brenk_alert' || key === 'diversity_representative';
  return Array.from(
    new Set(
      rows
        .map((row) => normalizedFilterValue(row[key]))
        .filter(Boolean),
    ),
  )
    .sort((left, right) => left.localeCompare(right))
    .map((value) => [value, booleanField ? formatBooleanLabel(value) : formatEvidenceCategory(value)]);
}

function normalizedFilterValue(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  return String(value);
}

function ResultPreview({ rows, selectedCompoundKey, onSelectCompound }) {
  const hasSyntheticAccessibility = rows.some(
    (row) => row.sa_score !== undefined || row.synthetic_feasibility_category !== undefined,
  );
  const hasDockingScore = rows.some(
    (row) => row.docking_score !== undefined && row.docking_status !== 'not_provided',
  );
  const hasIdentityStatus = rows.some((row) => row.identity_check_status !== undefined);
  const hasSimilarityStatus = rows.some((row) => row.similarity_check_status !== undefined);
  const hasPublicIdentityStatus = rows.some((row) => row.pubchem_lookup_status !== undefined);
  const hasChEMBLStatus = rows.some((row) => row.chembl_lookup_status !== undefined);
  const hasPatentStatus = rows.some((row) => row.patent_lookup_status !== undefined);
  const hasEvidenceSynthesis = rows.some((row) => row.evidence_summary_category !== undefined);
  const hasDiversity = rows.some((row) => row.diversity_status !== undefined);
  const hasStructuralAlerts = rows.some((row) => row.structural_alert_status !== undefined);

  return (
    <Box sx={{ overflowX: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Table size="small" aria-label="Prioritization result preview">
        <TableHead>
          <TableRow>
            <TableCell>Molecule</TableCell>
            <TableCell>Valid</TableCell>
            <TableCell>Rank</TableCell>
            <TableCell>Score</TableCell>
            <TableCell>Review status</TableCell>
            <TableCell>Review note</TableCell>
            {hasEvidenceSynthesis && <TableCell>Evidence summary</TableCell>}
            {hasStructuralAlerts && <TableCell>Structural alerts</TableCell>}
            {hasStructuralAlerts && <TableCell>PAINS alert</TableCell>}
            {hasStructuralAlerts && <TableCell>Brenk alert</TableCell>}
            {hasDiversity && <TableCell>Diversity cluster</TableCell>}
            {hasDiversity && <TableCell>Nearest neighbor similarity</TableCell>}
            {hasIdentityStatus && <TableCell>Identity</TableCell>}
            {hasPublicIdentityStatus && <TableCell>Public compound match</TableCell>}
            {hasChEMBLStatus && <TableCell>Public bioactivity context</TableCell>}
            {hasPatentStatus && <TableCell>Patent-context signal</TableCell>}
            {hasSimilarityStatus && <TableCell>Closest known</TableCell>}
            {hasDockingScore && <TableCell>Docking score</TableCell>}
            {hasDockingScore && <TableCell>Docking-informed score</TableCell>}
            {hasDockingScore && <TableCell>Docking priority signal</TableCell>}
            {hasSyntheticAccessibility && <TableCell>SA score</TableCell>}
            {hasSyntheticAccessibility && <TableCell>Synthesis</TableCell>}
            <TableCell>BBB</TableCell>
            <TableCell>Canonical SMILES</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, index) => {
            const rowKey = compoundRowKey(row, index);
            return (
              <TableRow
                hover
                key={rowKey}
                selected={selectedCompoundKey === rowKey}
                onClick={() => onSelectCompound(rowKey)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectCompound(rowKey);
                  }
                }}
                tabIndex={0}
                sx={{ cursor: 'pointer' }}
              >
                <TableCell>{row.molecule_id}</TableCell>
                <TableCell>{formatDetailValue(row.valid_molecule)}</TableCell>
                <TableCell>{formatDetailValue(row.v2_rank ?? row.scientific_rank ?? row.prioritization?.ranking_position)}</TableCell>
                <TableCell>{formatDetailValue(row.v2_score ?? row.scientific_ranking_score ?? row.priority_score)}</TableCell>
                <TableCell>{formatReviewStatus(row.review_status)}</TableCell>
                <TableCell>{formatDetailValue(row.review_note)}</TableCell>
                {hasEvidenceSynthesis && (
                  <TableCell>{formatEvidenceCategory(row.evidence_summary_category)}</TableCell>
                )}
                {hasStructuralAlerts && (
                  <TableCell>{formatStructuralAlertStatus(row)}</TableCell>
                )}
                {hasStructuralAlerts && (
                  <TableCell>{formatBooleanLabel(row.pains_alert)}</TableCell>
                )}
                {hasStructuralAlerts && (
                  <TableCell>{formatBooleanLabel(row.brenk_alert)}</TableCell>
                )}
                {hasDiversity && (
                  <TableCell>{formatDiversityCluster(row)}</TableCell>
                )}
                {hasDiversity && (
                  <TableCell>{formatNearestNeighbor(row)}</TableCell>
                )}
                {hasIdentityStatus && (
                  <TableCell>{row.known_compound_match === true ? row.known_compound_name : formatScientificPresentationValue(row.identity_check_status)}</TableCell>
                )}
                {hasPublicIdentityStatus && (
                  <TableCell>{formatPubChemMatch(row)}</TableCell>
                )}
                {hasChEMBLStatus && (
                  <TableCell>{formatChEMBLMatch(row)}</TableCell>
                )}
                {hasPatentStatus && (
                  <TableCell>{formatPatentSignal(row)}</TableCell>
                )}
                {hasSimilarityStatus && (
                  <TableCell>
                    {formatClosestKnownCompound(row)}
                  </TableCell>
                )}
                {hasDockingScore && <TableCell>{row.docking_score ?? 'not available'}</TableCell>}
                {hasDockingScore && <TableCell>{formatDetailValue(row.combined_candidate_score)}</TableCell>}
                {hasDockingScore && <TableCell>{formatEvidenceCategory(row.docking_priority_signal)}</TableCell>}
                {hasSyntheticAccessibility && <TableCell>{row.sa_score ?? 'not available'}</TableCell>}
                {hasSyntheticAccessibility && (
                  <TableCell>{formatEvidenceCategory(row.synthetic_feasibility_category)}</TableCell>
                )}
                <TableCell>{formatEvidenceCategory(row.bbb_prediction)}</TableCell>
                <TableCell sx={{ fontFamily: 'ui-monospace, Consolas, monospace', maxWidth: 420 }}>
                  {row.canonical_smiles || row.input_smiles}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  );
}

export function compoundDetailSummarySections(compound) {
  return [
    {
      title: 'Molecule Identity',
      rows: [
        ['Molecule ID', compound.molecule_id],
        ['Canonical SMILES', compound.canonical_smiles || compound.input_smiles],
        ['Validation status', formatScientificPresentationValue(compound.validation_status)],
        ['Known-compound match', formatBooleanLabel(compound.known_compound_match)],
        ['Known compound', compound.known_compound_name],
        ['Identity status', formatScientificPresentationValue(compound.identity_check_status)],
      ],
    },
    {
      title: 'Prioritization and Evidence',
      rows: [
        ['Review status', formatReviewStatus(compound.review_status)],
        ['Priority score', compound.priority_score],
        ['Evidence summary', formatEvidenceCategory(compound.evidence_summary_category)],
        ['Biopharma context', formatEvidenceCategory(compound.biopharma_context_level)],
        ['Recommended review focus', formatEvidenceCategory(compound.recommended_review_focus)],
        ['Combined candidate score', compound.combined_candidate_score],
      ],
    },
    {
      title: 'Physicochemical Properties',
      rows: [
        ['Molecular weight', compound.mw],
        ['TPSA', compound.tpsa],
        ['H-bond acceptors', compound.hba],
        ['H-bond donors', compound.hbd],
        ['Rotatable bonds', compound.rotatable_bonds],
        ['QED', compound.qed],
        ['Lipinski assessment', formatPassFail(compound.lipinski_pass)],
      ],
    },
    {
      title: 'Model Outputs',
      rows: [
        ['BBB prediction', formatEvidenceCategory(compound.bbb_prediction)],
        ['BBB probability', compound.bbb_probability],
        ['BBB model status', formatScientificPresentationValue(compound.bbb_model_status)],
        ['SA score', compound.sa_score],
        ['Synthetic feasibility', formatEvidenceCategory(compound.synthetic_feasibility_category)],
        ['Synthetic feasibility status', formatScientificPresentationValue(compound.synthetic_feasibility_status)],
      ],
    },
    {
      title: 'Docking and Structural Context',
      rows: [
        ['Docking score', compound.docking_score],
        ['Docking status', formatScientificPresentationValue(compound.docking_status)],
        ['Docking priority signal', formatEvidenceCategory(compound.docking_priority_signal)],
        ['Structural alerts', formatStructuralAlertStatus(compound)],
        ['PAINS alert', formatBooleanLabel(compound.pains_alert)],
        ['Brenk alert', formatBooleanLabel(compound.brenk_alert)],
        ['Diversity cluster', formatDiversityCluster(compound)],
      ],
    },
    {
      title: 'Public Evidence Context',
      rows: [
        ['PubChem match', formatPubChemMatch(compound)],
        ['ChEMBL match', formatChEMBLMatch(compound)],
        ['Patent-context signal', formatPatentSignal(compound)],
        ['Closest known compound', formatClosestKnownCompound(compound)],
        ['Active-neighborhood signal', formatEvidenceCategory(compound.active_neighborhood_signal)],
      ],
    },
  ];
}

export function CompoundDetailPanel({ compound, upload, jobId, annotationsState, onSaveReviewAnnotation, onClose, containerRef }) {
  return (
    <Card
      ref={containerRef}
      elevation={0}
      tabIndex={-1}
      aria-labelledby="compound-detail-heading"
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        scrollMarginTop: 72,
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
      }}
    >
      <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
        <Stack spacing={2.5}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={1.5}>
            <Stack spacing={0.5}>
              <Typography id="compound-detail-heading" variant="h2">MolOptima Compound Profile</Typography>
              <Typography color="text.secondary">
                {formatDetailValue(compound.molecule_id)}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                Selected from {formatDetailValue(compound.source_filename || compound.source_type)}{compound.source_record ? ` · record ${compound.source_record}` : ''}
              </Typography>
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems={{ sm: 'center' }}>
              <Chip
                label={isFalseValue(compound.valid_molecule) ? 'Invalid molecule' : 'Valid molecule'}
                color={isFalseValue(compound.valid_molecule) ? 'warning' : 'success'}
                variant="outlined"
              />
              {onClose ? (
                <IconButton aria-label="Close compound detail" onClick={onClose}>
                  <CloseIcon />
                </IconButton>
              ) : null}
            </Stack>
          </Stack>
          <CompoundProfileIntegration compound={compound} upload={upload} baseUrl={apiBaseUrl}>
            <ReviewAnnotationControls
              compound={compound}
              annotationsState={annotationsState}
              onSaveReviewAnnotation={onSaveReviewAnnotation}
            />
            <Box component="section" aria-label="Selected compound identity and structure">
              <Typography variant="overline">Calculated</Typography>
              <StructurePreview compound={compound} />
            </Box>
            <Box component="section" aria-label="Predicted ADMET evidence">
              <Typography variant="overline">Predicted</Typography>
              <AdmetResultsSection compound={compound} />
            </Box>
            <Box component="section" aria-label="Structure-based computational evidence">
              <Typography variant="overline">Docking</Typography>
              {compound.docking_result ? <DockingResultsSection compound={compound} jobId={jobId} apiBaseUrl={apiBaseUrl} /> : <Alert severity="info">No docking result available. Missing evidence is not negative evidence.</Alert>}
            </Box>
            <Box component="section" aria-label="Prioritization evidence">
              <Typography variant="overline">Prioritization</Typography>
              {compound.prioritization || compound.prioritization_v2 ? <PrioritizationExplanationSection compound={compound} /> : <Alert severity="info">Prioritization result not available. Missing evidence is not negative evidence.</Alert>}
            </Box>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' },
              alignItems: 'start',
              gap: 2,
            }}
          >
            {compoundDetailSummarySections(compound).map((section) => (
              <DetailTable key={section.title} title={section.title} rows={section.rows} />
            ))}
          </Box>

          <Box component="details" sx={{ '& > summary': { cursor: 'pointer' } }}>
            <Box component="summary" sx={{ fontWeight: 700, color: 'text.secondary', mb: 1 }}>
              Complete provenance and diagnostic fields
            </Box>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' },
              alignItems: 'start',
              gap: 2,
            }}
          >
            <DetailTable
              title="Computational Screening Summary"
              rows={[
                ['Review status', formatReviewStatus(compound.review_status)],
                ['Review note', compound.review_note],
                ['Evidence summary', formatEvidenceCategory(compound.evidence_summary_category)],
                ['Summary notes', compound.evidence_summary_notes],
                ['Public identity signal', formatEvidenceCategory(compound.public_identity_signal)],
                ['Public bioactivity signal', formatEvidenceCategory(compound.public_bioactivity_signal)],
                ['Patent-context signal', formatEvidenceCategory(compound.patent_context_signal)],
                ['Local similarity signal', formatEvidenceCategory(compound.local_similarity_signal)],
                ['Biopharma context level', formatEvidenceCategory(compound.biopharma_context_level)],
                ['Recommended review focus', compound.recommended_review_focus],
                ['Combined candidate score', compound.combined_candidate_score],
                ['Docking priority signal', formatEvidenceCategory(compound.docking_priority_signal)],
                ['Docking rank', compound.docking_rank_within_run],
                ['Docking percentile', compound.docking_percentile_within_run],
                ['Protocol-dependent docking signal', compound.combined_score_explanation],
                ['Structural alerts', formatStructuralAlertStatus(compound)],
                ['PAINS alert', formatBooleanLabel(compound.pains_alert)],
                ['Brenk alert', formatBooleanLabel(compound.brenk_alert)],
                ['Potential liability signal', compound.medchem_alert_summary],
                ['Diversity cluster', formatDiversityCluster(compound)],
                ['Cluster representative', formatBooleanLabel(compound.diversity_representative)],
                ['Nearest neighbor similarity', formatNearestNeighbor(compound)],
                ['Diversity status', formatEvidenceCategory(compound.diversity_status)],
                ['Chemical-space X', compound.chemical_space_x],
                ['Chemical-space Y', compound.chemical_space_y],
                ['Chemical-space method', formatScientificPresentationValue(compound.chemical_space_method)],
                ['Chemical-space status', formatEvidenceCategory(compound.chemical_space_status)],
              ]}
            />
            <DetailTable
              title="Identity and Score"
              rows={[
                ['Molecule ID', compound.molecule_id],
                ['Input SMILES', compound.input_smiles],
                ['Canonical SMILES', compound.canonical_smiles],
                ['Valid molecule', formatBooleanLabel(compound.valid_molecule)],
                ['Priority score', compound.priority_score],
                ['Known compound match', formatBooleanLabel(compound.known_compound_match)],
                ['Known compound name', compound.known_compound_name],
                ['Known compound source', formatScientificPresentationValue(compound.known_compound_source)],
                ['Known compound ID', compound.known_compound_id],
                ['Identity check status', formatScientificPresentationValue(compound.identity_check_status)],
                ['PubChem exact match', formatBooleanLabel(compound.pubchem_exact_match)],
                ['PubChem CID', compound.pubchem_cid],
                ['PubChem preferred name', compound.pubchem_preferred_name],
                ['PubChem lookup status', formatScientificPresentationValue(compound.pubchem_lookup_status)],
                ['PubChem cache status', formatScientificPresentationValue(compound.pubchem_cache_status)],
                ['PubChem warning', compound.pubchem_warning],
                ['ChEMBL match', formatChEMBLMatch(compound)],
                ['ChEMBL molecule ID', compound.chembl_molecule_id],
                ['ChEMBL preferred name', compound.chembl_pref_name],
                ['ChEMBL lookup status', formatScientificPresentationValue(compound.chembl_lookup_status)],
                ['ChEMBL cache status', formatScientificPresentationValue(compound.chembl_cache_status)],
                ['ChEMBL warning', compound.chembl_warning],
                ['Known public bioactivity records', compound.chembl_activity_count],
                ['Associated public targets', compound.chembl_target_count],
                ['ChEMBL target summary', compound.chembl_target_summary],
                ['ChEMBL similarity match', formatBooleanLabel(compound.chembl_similarity_match)],
                ['ChEMBL similarity score', compound.chembl_similarity_score],
                ['ChEMBL similarity molecule ID', compound.chembl_similarity_molecule_id],
                ['ChEMBL similarity preferred name', compound.chembl_similarity_pref_name],
                ['ChEMBL similarity status', formatScientificPresentationValue(compound.chembl_similarity_status)],
                ['Patent-context signal', formatPatentSignal(compound)],
                ['Patent lookup status', formatScientificPresentationValue(compound.patent_lookup_status)],
                ['Patent cache status', formatScientificPresentationValue(compound.patent_cache_status)],
                ['Public patent-associated evidence', formatBooleanLabel(compound.patent_public_evidence_match)],
                ['Patent source', formatScientificPresentationValue(compound.patent_source)],
                ['SureChEMBL returned records for this structure/query', compound.patent_record_count],
                ['Top patent record ID', compound.patent_top_record_id],
                ['Top patent record title', compound.patent_top_record_title],
                ['Top patent record URL', compound.patent_top_record_url],
                ['Patent query identifier', compound.patent_query_identifier],
                ['Patent warning', compound.patent_warning],
                ['Closest known compound', compound.closest_known_compound_name],
                ['Closest known compound ID', compound.closest_known_compound_id],
                ['Closest known compound similarity', compound.closest_known_compound_similarity],
                ['Closest known compound source', formatScientificPresentationValue(compound.closest_known_compound_source)],
                ['Similarity check status', formatScientificPresentationValue(compound.similarity_check_status)],
                ['Docking score', compound.docking_score],
                ['Docking status', formatScientificPresentationValue(compound.docking_status)],
                ['Docking normalized score', compound.docking_score_normalized],
                ['Docking priority signal', formatEvidenceCategory(compound.docking_priority_signal)],
                ['Docking rank within run', compound.docking_rank_within_run],
                ['Docking percentile within run', compound.docking_percentile_within_run],
                ['Combined candidate score', compound.combined_candidate_score],
                ['Combined score status', formatEvidenceCategory(compound.combined_score_status)],
                ['Combined score explanation', compound.combined_score_explanation],
              ]}
            />
            <DetailTable
              title="Model Outputs"
              rows={[
                ['BBB prediction', compound.bbb_prediction],
                ['BBB probability', compound.bbb_probability],
                ['BBB model status', formatScientificPresentationValue(compound.bbb_model_status)],
                ['SA score', compound.sa_score],
                ['Synthetic feasibility category', formatEvidenceCategory(compound.synthetic_feasibility_category)],
                ['Synthetic feasibility status', formatScientificPresentationValue(compound.synthetic_feasibility_status)],
              ]}
            />
            <DetailTable
              title="Descriptors"
              rows={[
                ['MW', compound.mw],
                ['TPSA', compound.tpsa],
                ['HBA', compound.hba],
                ['HBD', compound.hbd],
                ['Rotatable bonds', compound.rotatable_bonds],
                ['QED', compound.qed],
                ['Lipinski pass/fail', formatPassFail(compound.lipinski_pass)],
              ]}
            />
          </Box>
          </Box>
          </CompoundProfileIntegration>
        </Stack>
      </CardContent>
    </Card>
  );
}

function DetailTable({ title, rows }) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
      <Box sx={{ px: 2, py: 1.25, bgcolor: '#f7fafc', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="h2">{title}</Typography>
      </Box>
      <Table size="small" aria-label={`${title} compound detail`}>
        <TableBody>
          {rows.map(([label, value]) => (
            <TableRow key={label}>
              <TableCell sx={{ width: '42%', color: 'text.secondary' }}>{label}</TableCell>
              <TableCell sx={{ fontWeight: 650, overflowWrap: 'anywhere' }}>
                {formatDetailValue(value)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

function compoundRowKey(row, index) {
  return `${row.molecule_id ?? 'molecule'}-${row.canonical_smiles ?? row.input_smiles ?? index}-${index}`;
}

function formatPassFail(value) {
  if (isTrueValue(value)) {
    return 'Pass';
  }
  if (isFalseValue(value)) {
    return 'Fail';
  }
  return value;
}

function formatClosestKnownCompound(row) {
  if (!row.closest_known_compound_name) {
    return formatScientificPresentationValue(row.similarity_check_status);
  }
  const similarity = row.closest_known_compound_similarity;
  if (similarity === null || similarity === undefined || similarity === '') {
    return row.closest_known_compound_name;
  }
  return `${row.closest_known_compound_name} (${similarity})`;
}

function formatPubChemMatch(row) {
  if (isTrueValue(row.pubchem_exact_match)) {
    const cid = row.pubchem_cid ? `CID ${row.pubchem_cid}` : 'PubChem';
    return `${row.pubchem_preferred_name || 'PubChem exact match'} (${cid})`;
  }
  return formatScientificPresentationValue(row.pubchem_lookup_status);
}

function formatChEMBLMatch(row) {
  if (isTrueValue(row.chembl_exact_match)) {
    return `${row.chembl_pref_name || row.chembl_molecule_id || 'ChEMBL match'} (${formatDetailValue(row.chembl_activity_count)} activities)`;
  }
  if (isTrueValue(row.chembl_similarity_match)) {
    const score = row.chembl_similarity_score ? `, similarity ${row.chembl_similarity_score}` : '';
    return `${row.chembl_similarity_pref_name || row.chembl_similarity_molecule_id || 'ChEMBL analog'}${score}`;
  }
  return formatScientificPresentationValue(row.chembl_lookup_status);
}

function formatPatentSignal(row) {
  if (isTrueValue(row.patent_public_evidence_match)) {
    const count = row.patent_record_count ? `${row.patent_record_count} returned records` : 'returned records';
    return `${row.patent_source || 'SureChEMBL'} returned ${count} for this structure/query`;
  }
  return formatScientificPresentationValue(row.patent_lookup_status);
}

function formatLookupSources(job) {
  const sources = [];
  if (isTrueValue(job.pubchem_lookup_requested)) {
    sources.push('PubChem');
  }
  if (isTrueValue(job.chembl_lookup_requested)) {
    sources.push('ChEMBL');
  }
  if (isTrueValue(job.patent_lookup_requested)) {
    sources.push('SureChEMBL');
  }
  if (isTrueValue(job.target_reference_discovery_requested)) {
    sources.push('Target references');
  }
  return sources.length > 0 ? sources.join(', ') : 'None requested';
}

function formatReviewStatus(value) {
  return reviewStatusLabels[value] ?? reviewStatusLabels.unreviewed;
}

function formatComparisonReviewStatus(value) {
  if (value === null || value === undefined || value === '') {
    return 'Not available';
  }
  return formatReviewStatus(value);
}

function reviewStatusColor(value) {
  if (value === 'selected') {
    return 'success';
  }
  if (value === 'watchlist') {
    return 'secondary';
  }
  if (value === 'deprioritized') {
    return 'warning';
  }
  if (value === 'rejected') {
    return 'error';
  }
  return 'default';
}

function formatSignedNumber(value) {
  const numeric = numericValue(value);
  if (numeric === null) {
    return 'Not available';
  }
  return numeric > 0 ? `+${numeric.toFixed(3)}` : numeric.toFixed(3);
}

function formatBbbComparison(row, suffix) {
  const prediction = row[`bbb_prediction_${suffix}`];
  const probability = row[`bbb_probability_${suffix}`];
  if (prediction === null || prediction === undefined || prediction === '') {
    return 'Not available';
  }
  if (probability === null || probability === undefined || probability === '') {
    return prediction;
  }
  return `${prediction} (${probability})`;
}

function runOptionLabel(job) {
  const completedAt = job.completed_at ? ` | ${job.completed_at}` : '';
  const rowCount = job.row_count !== undefined ? ` | ${job.row_count} rows` : '';
  return `${job.job_id}${completedAt}${rowCount}`;
}

function formatBooleanLabel(value) {
  if (value === true || value === 'true' || value === 'True') {
    return 'Yes';
  }
  if (value === false || value === 'false' || value === 'False') {
    return 'No';
  }
  return 'Not available';
}

function formatReviewCounts(rows) {
  if (!rows || rows.length === 0) {
    return 'Not available';
  }
  const counts = countValues(rows.map((row) => row.review_status || 'unreviewed'));
  return reviewStatuses
    .map((statusValue) => `${reviewStatusLabels[statusValue]}: ${counts[statusValue] ?? 0}`)
    .join(', ');
}

function buildDiversitySummary(rows) {
  const clusterIds = new Set(
    (rows ?? [])
      .map((row) => row.diversity_cluster_id)
      .filter((value) => value !== null && value !== undefined && value !== ''),
  );
  const clusterSizes = (rows ?? [])
    .map((row) => numericValue(row.diversity_cluster_size))
    .filter((value) => value !== null);
  const representativeCount = (rows ?? []).filter((row) => isTrueValue(row.diversity_representative)).length;
  return {
    clusterCount: clusterIds.size,
    largestClusterSize: clusterSizes.length > 0 ? Math.max(...clusterSizes) : 0,
    representativeCount,
  };
}

function formatDiversitySummary(rows) {
  if (!rows || rows.length === 0) {
    return 'Not available';
  }
  const summary = buildDiversitySummary(rows);
  if (summary.clusterCount === 0) {
    return 'No diversity clusters available';
  }
  return `${summary.clusterCount} clusters, largest cluster ${summary.largestClusterSize}, ${summary.representativeCount} representatives`;
}

function buildStructuralAlertSummary(rows) {
  const alertRows = rows ?? [];
  return {
    alertMoleculeCount: alertRows.filter(
      (row) => row.structural_alert_status === 'alerts_detected' || numericValue(row.structural_alert_count) > 0,
    ).length,
    noAlertCount: alertRows.filter((row) => row.structural_alert_status === 'no_alerts').length,
    painsAlertCount: alertRows.filter((row) => isTrueValue(row.pains_alert)).length,
    brenkAlertCount: alertRows.filter((row) => isTrueValue(row.brenk_alert)).length,
  };
}

function formatStructuralAlertSummary(rows) {
  if (!rows || rows.length === 0) {
    return 'Not available';
  }
  const summary = buildStructuralAlertSummary(rows);
  return `${summary.alertMoleculeCount} with alerts, ${summary.noAlertCount} with no alerts, ${summary.painsAlertCount} PAINS, ${summary.brenkAlertCount} Brenk`;
}

function formatStructuralAlertStatus(row) {
  if (!row || row.structural_alert_status === null || row.structural_alert_status === undefined || row.structural_alert_status === '') {
    return 'Not available';
  }
  if (row.structural_alert_status === 'alerts_detected') {
    const categories = row.structural_alert_categories ? `: ${row.structural_alert_categories}` : '';
    return `${formatDetailValue(row.structural_alert_count)} alert(s)${categories}`;
  }
  return formatEvidenceCategory(row.structural_alert_status);
}

function formatDiversityCluster(row) {
  if (!row || row.diversity_status === 'not_run_invalid_molecule') {
    return 'Not run for invalid molecule';
  }
  if (row.diversity_cluster_id === null || row.diversity_cluster_id === undefined || row.diversity_cluster_id === '') {
    return formatEvidenceCategory(row?.diversity_status);
  }
  return `Cluster ${row.diversity_cluster_id} (${formatDetailValue(row.diversity_cluster_size)} molecules)`;
}

function formatNearestNeighbor(row) {
  if (!row || row.nearest_neighbor_similarity === null || row.nearest_neighbor_similarity === undefined || row.nearest_neighbor_similarity === '') {
    return 'Not available';
  }
  const neighbor = row.nearest_neighbor_molecule_id ? `${row.nearest_neighbor_molecule_id}: ` : '';
  return `${neighbor}${row.nearest_neighbor_similarity}`;
}

function formatTargetReferenceActivity(row) {
  if (!row) {
    return 'Not available';
  }
  const type = row.nearest_active_activity_type || 'activity';
  const value = row.nearest_active_activity_value;
  const units = row.nearest_active_activity_units;
  if (value === null || value === undefined || value === '') {
    return formatDetailValue(row.nearest_active_activity_class);
  }
  return `${type}: ${value}${units ? ` ${units}` : ''}`;
}

function formatTargetReferenceSet(targetReferences) {
  if (!targetReferences || !targetReferences.enabled) {
    return 'Not requested';
  }
  return `${targetReferences.reference_count ?? 0} references; ${formatScientificPresentationValue(targetReferences.source ?? 'unknown source')}; ${formatScientificPresentationValue(targetReferences.lookup_status)}`;
}

function buildChemicalSpaceSummary(rows) {
  const plottedRows = (rows ?? []).filter(
    (row) => numericValue(row.chemical_space_x) !== null && numericValue(row.chemical_space_y) !== null,
  );
  const skippedCount = (rows ?? []).filter((row) => row.chemical_space_status === 'not_run_invalid_molecule').length;
  const clusterIds = new Set(
    plottedRows
      .map((row) => row.diversity_cluster_id)
      .filter((value) => value !== null && value !== undefined && value !== ''),
  );
  const selectedCount = plottedRows.filter(
    (row) => row.review_status === 'selected' || row.review_status === 'watchlist',
  ).length;
  return {
    plottedCount: plottedRows.length,
    skippedCount,
    clusterCount: clusterIds.size,
    selectedCount,
  };
}

function paddedDomain(values) {
  if (!values || values.length === 0) {
    return [-1, 1];
  }
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  if (minValue === maxValue) {
    return [minValue - 1, maxValue + 1];
  }
  const padding = (maxValue - minValue) * 0.08;
  return [minValue - padding, maxValue + padding];
}

function scaleLinear(value, domain, range) {
  const [domainMin, domainMax] = domain;
  const [rangeMin, rangeMax] = range;
  if (domainMax === domainMin) {
    return (rangeMin + rangeMax) / 2;
  }
  return rangeMin + ((value - domainMin) / (domainMax - domainMin)) * (rangeMax - rangeMin);
}

function chemicalClusterColor(clusterId) {
  const palette = ['#145f74', '#2f8f6f', '#7c5cbd', '#c77d2f', '#b84a62', '#5c7899', '#638a3c', '#9d6b2f'];
  const numericCluster = Number(clusterId);
  if (!Number.isFinite(numericCluster) || numericCluster <= 0) {
    return '#8a97a8';
  }
  return palette[(numericCluster - 1) % palette.length];
}

function chemicalSpaceTooltip(row) {
  return [
    `Molecule: ${formatDetailValue(row.molecule_id)}`,
    `Priority score: ${formatDetailValue(row.priority_score)}`,
    `Diversity cluster: ${formatDiversityCluster(row)}`,
    `Evidence: ${formatEvidenceCategory(row.evidence_summary_category)}`,
    `Review status: ${formatReviewStatus(row.review_status)}`,
    `Nearest neighbor similarity: ${formatNearestNeighbor(row)}`,
    `Active-neighborhood signal: ${formatEvidenceCategory(row.active_neighborhood_signal)}`,
  ].join('\n');
}

function targetReferenceTooltip(reference) {
  return [
    `Reference: ${formatDetailValue(reference.compound_name || reference.reference_id)}`,
    `Source: ${formatDetailValue(reference.reference_source)}`,
    `Activity class: ${formatEvidenceCategory(reference.activity_class)}`,
    `Activity: ${formatDetailValue(reference.activity_type)} ${formatDetailValue(reference.activity_value)} ${formatDetailValue(reference.activity_units)}`,
    `Mechanism: ${formatEvidenceCategory(reference.mechanism_class)}`,
  ].join('\n');
}

function formatEvidenceCategory(value) {
  if (value === null || value === undefined || value === '') {
    return 'Not available';
  }
  return String(value)
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function evidenceSummaryColor(compound) {
  if (compound.evidence_summary_category === 'invalid_molecule') {
    return 'warning';
  }
  if (compound.biopharma_context_level === 'high_evidence_context') {
    return 'success';
  }
  if (compound.biopharma_context_level === 'moderate_evidence_context') {
    return 'secondary';
  }
  return 'default';
}

function topCountLabel(counts) {
  return Object.entries(counts).sort((left, right) => right[1] - left[1])[0]?.[0] ?? '';
}

function annotateAnalysisState(runState, annotationsState) {
  const rows = runState.result?.results ?? [];
  if (!runState.result || rows.length === 0) {
    return runState;
  }
  const annotations = annotationsState.jobId === runState.result.job_id ? annotationsState.annotations : {};
  return {
    ...runState,
    result: {
      ...runState.result,
      results: rows.map((row, index) => annotateResultRow(row, index, annotations)),
    },
  };
}

function annotateComparisonResult(result, annotations) {
  const rows = result?.results ?? [];
  return {
    ...result,
    results: rows.map((row, index) => annotateResultRow(row, index, annotations)),
  };
}

function annotateResultRow(row, index, annotations) {
  const annotationKey = moleculeAnnotationKey(row, index);
  const annotation = annotations[annotationKey] ?? {};
  return {
    ...row,
    review_annotation_key: annotationKey,
    review_status: annotation.review_status || 'unreviewed',
    review_note: annotation.review_note || '',
  };
}

function moleculeAnnotationKey(row, index) {
  const moleculeId = row.molecule_id === null || row.molecule_id === undefined ? '' : String(row.molecule_id).trim();
  return moleculeId || `row_${index}`;
}

function compareSavedRuns(runA, runB) {
  const runARows = runA?.results ?? [];
  const runBRows = runB?.results ?? [];
  const runAMap = comparisonRowMap(runARows);
  const runBMap = comparisonRowMap(runBRows);
  const keys = Array.from(new Set([...runAMap.keys(), ...runBMap.keys()])).sort((left, right) =>
    comparisonSortLabel(runAMap.get(left), runBMap.get(left)).localeCompare(
      comparisonSortLabel(runAMap.get(right), runBMap.get(right)),
    ),
  );
  const rows = keys.map((key) => buildComparisonRow(key, runAMap.get(key), runBMap.get(key)));
  return {
    rows,
    summary: summarizeRunComparison(rows),
  };
}

function comparisonRowMap(rows) {
  const rowMap = new Map();
  rows.forEach((row, index) => {
    const key = comparisonMoleculeKey(row, index);
    if (!rowMap.has(key)) {
      rowMap.set(key, row);
    }
  });
  return rowMap;
}

function comparisonMoleculeKey(row, index) {
  const moleculeId = normalizedCompareValue(row.molecule_id);
  if (moleculeId) {
    return `molecule:${moleculeId}`;
  }
  const canonicalSmiles = normalizedCompareValue(row.canonical_smiles);
  if (canonicalSmiles) {
    return `canonical:${canonicalSmiles}`;
  }
  const inputSmiles = normalizedCompareValue(row.input_smiles);
  return inputSmiles ? `input:${inputSmiles}` : `row:${index}`;
}

function comparisonSortLabel(rowA, rowB) {
  const row = rowA ?? rowB ?? {};
  return normalizedCompareValue(row.molecule_id) || normalizedCompareValue(row.canonical_smiles) || '';
}

function buildComparisonRow(key, rowA, rowB) {
  const priorityA = numericValue(rowA?.priority_score);
  const priorityB = numericValue(rowB?.priority_score);
  const priorityChange = priorityA !== null && priorityB !== null ? priorityB - priorityA : '';
  return {
    comparison_key: key,
    molecule_id: rowA?.molecule_id ?? rowB?.molecule_id ?? '',
    input_smiles_a: rowA?.input_smiles ?? '',
    input_smiles_b: rowB?.input_smiles ?? '',
    canonical_smiles_a: rowA?.canonical_smiles ?? '',
    canonical_smiles_b: rowB?.canonical_smiles ?? '',
    presence: rowA && rowB ? 'both' : rowA ? 'only_in_run_a' : 'only_in_run_b',
    priority_score_a: rowA?.priority_score ?? '',
    priority_score_b: rowB?.priority_score ?? '',
    priority_score_change: priorityChange === '' ? '' : Number(priorityChange.toFixed(6)),
    evidence_summary_category_a: rowA?.evidence_summary_category ?? '',
    evidence_summary_category_b: rowB?.evidence_summary_category ?? '',
    biopharma_context_level_a: rowA?.biopharma_context_level ?? '',
    biopharma_context_level_b: rowB?.biopharma_context_level ?? '',
    public_identity_signal_a: rowA?.public_identity_signal ?? '',
    public_identity_signal_b: rowB?.public_identity_signal ?? '',
    public_bioactivity_signal_a: rowA?.public_bioactivity_signal ?? '',
    public_bioactivity_signal_b: rowB?.public_bioactivity_signal ?? '',
    patent_context_signal_a: rowA?.patent_context_signal ?? '',
    patent_context_signal_b: rowB?.patent_context_signal ?? '',
    local_similarity_signal_a: rowA?.local_similarity_signal ?? '',
    local_similarity_signal_b: rowB?.local_similarity_signal ?? '',
    active_neighborhood_signal_a: rowA?.active_neighborhood_signal ?? '',
    active_neighborhood_signal_b: rowB?.active_neighborhood_signal ?? '',
    nearest_active_compound_name_a: rowA?.nearest_active_compound_name ?? '',
    nearest_active_compound_name_b: rowB?.nearest_active_compound_name ?? '',
    nearest_active_similarity_a: rowA?.nearest_active_similarity ?? '',
    nearest_active_similarity_b: rowB?.nearest_active_similarity ?? '',
    bbb_prediction_a: rowA?.bbb_prediction ?? '',
    bbb_prediction_b: rowB?.bbb_prediction ?? '',
    bbb_probability_a: rowA?.bbb_probability ?? '',
    bbb_probability_b: rowB?.bbb_probability ?? '',
    review_status_a: rowA?.review_status ?? '',
    review_status_b: rowB?.review_status ?? '',
    review_note_a: rowA?.review_note ?? '',
    review_note_b: rowB?.review_note ?? '',
    changed_evidence: rowA && rowB ? valuesDiffer(rowA.evidence_summary_category, rowB.evidence_summary_category) : false,
    changed_review_status: rowA && rowB ? valuesDiffer(rowA.review_status, rowB.review_status) : false,
    changed_public_signals: rowA && rowB
      ? valuesDiffer(rowA.public_identity_signal, rowB.public_identity_signal)
        || valuesDiffer(rowA.public_bioactivity_signal, rowB.public_bioactivity_signal)
        || valuesDiffer(rowA.patent_context_signal, rowB.patent_context_signal)
        || valuesDiffer(rowA.active_neighborhood_signal, rowB.active_neighborhood_signal)
      : false,
    changed_bbb_prediction: rowA && rowB ? valuesDiffer(rowA.bbb_prediction, rowB.bbb_prediction) : false,
  };
}

function summarizeRunComparison(rows) {
  return {
    totalRows: rows.length,
    sharedMolecules: rows.filter((row) => row.presence === 'both').length,
    onlyInRunA: rows.filter((row) => row.presence === 'only_in_run_a').length,
    onlyInRunB: rows.filter((row) => row.presence === 'only_in_run_b').length,
    changedEvidence: rows.filter((row) => row.changed_evidence).length,
    changedReviewStatus: rows.filter((row) => row.changed_review_status).length,
    changedPublicSignals: rows.filter((row) => row.changed_public_signals).length,
    changedBbbPrediction: rows.filter((row) => row.changed_bbb_prediction).length,
  };
}

function emptyRunComparisonSummary() {
  return {
    totalRows: 0,
    sharedMolecules: 0,
    onlyInRunA: 0,
    onlyInRunB: 0,
    changedEvidence: 0,
    changedReviewStatus: 0,
    changedPublicSignals: 0,
    changedBbbPrediction: 0,
  };
}

function normalizedCompareValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function valuesDiffer(left, right) {
  return normalizedCompareValue(left) !== normalizedCompareValue(right);
}

function downloadCompoundMarkdownReport(compound) {
  const markdown = buildCompoundMarkdownReport(compound);
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeFilename(compound.molecule_id ?? 'compound')}-moloptima-report.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadRowsCsv(rows, filename) {
  if (rows.length === 0) {
    return;
  }
  const columns = Array.from(
    rows.reduce((keys, row) => {
      Object.keys(row).forEach((key) => keys.add(key));
      return keys;
    }, new Set()),
  );
  const csvLines = [
    columns.map(csvCell).join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
  ];
  const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const runComparisonExportColumns = [
  'molecule_id',
  'presence',
  'priority_score_a',
  'priority_score_b',
  'priority_score_change',
  'evidence_summary_category_a',
  'evidence_summary_category_b',
  'biopharma_context_level_a',
  'biopharma_context_level_b',
  'public_identity_signal_a',
  'public_identity_signal_b',
  'public_bioactivity_signal_a',
  'public_bioactivity_signal_b',
  'patent_context_signal_a',
  'patent_context_signal_b',
  'local_similarity_signal_a',
  'local_similarity_signal_b',
  'active_neighborhood_signal_a',
  'active_neighborhood_signal_b',
  'nearest_active_compound_name_a',
  'nearest_active_compound_name_b',
  'nearest_active_similarity_a',
  'nearest_active_similarity_b',
  'bbb_prediction_a',
  'bbb_prediction_b',
  'bbb_probability_a',
  'bbb_probability_b',
  'review_status_a',
  'review_status_b',
  'review_note_a',
  'review_note_b',
  'input_smiles_a',
  'input_smiles_b',
  'canonical_smiles_a',
  'canonical_smiles_b',
  'changed_evidence',
  'changed_review_status',
  'changed_public_signals',
  'changed_bbb_prediction',
];

function downloadRunComparisonCsv(rows, filename) {
  if (rows.length === 0) {
    return;
  }
  const csvLines = [
    runComparisonExportColumns.map(csvCell).join(','),
    ...rows.map((row) => runComparisonExportColumns.map((column) => csvCell(row[column])).join(',')),
  ];
  downloadTextFile(csvLines.join('\n'), filename, 'text/csv;charset=utf-8');
}

const candidateExportColumns = [
  'molecule_id',
  'input_smiles',
  'canonical_smiles',
  'priority_score',
  'bbb_prediction',
  'bbb_probability',
  'bbb_model_status',
  'bbb_model_name',
  'mw',
  'logp',
  'hba',
  'hbd',
  'tpsa',
  'rotatable_bonds',
  'qed',
  'lipinski_pass',
  'sa_score',
  'synthetic_feasibility_category',
  'synthetic_feasibility_status',
  'docking_score',
  'docking_status',
  'docking_score_normalized',
  'docking_priority_signal',
  'docking_rank_within_run',
  'docking_percentile_within_run',
  'combined_candidate_score',
  'combined_score_explanation',
  'combined_score_status',
  'known_compound_match',
  'known_compound_name',
  'known_compound_id',
  'known_compound_source',
  'identity_check_status',
  'closest_known_compound_name',
  'closest_known_compound_id',
  'closest_known_compound_similarity',
  'closest_known_compound_source',
  'similarity_check_status',
  'pubchem_exact_match',
  'pubchem_cid',
  'pubchem_preferred_name',
  'pubchem_lookup_status',
  'pubchem_cache_status',
  'pubchem_warning',
  'chembl_exact_match',
  'chembl_molecule_id',
  'chembl_pref_name',
  'chembl_lookup_status',
  'chembl_cache_status',
  'chembl_warning',
  'chembl_activity_count',
  'chembl_target_count',
  'chembl_target_summary',
  'chembl_similarity_match',
  'chembl_similarity_score',
  'chembl_similarity_molecule_id',
  'chembl_similarity_pref_name',
  'chembl_similarity_status',
  'patent_public_evidence_match',
  'patent_source',
  'patent_lookup_status',
  'patent_cache_status',
  'patent_record_count',
  'patent_top_record_id',
  'patent_top_record_title',
  'patent_top_record_url',
  'patent_query_identifier',
  'patent_warning',
  'evidence_summary_category',
  'evidence_summary_notes',
  'public_identity_signal',
  'public_bioactivity_signal',
  'patent_context_signal',
  'local_similarity_signal',
  'biopharma_context_level',
  'recommended_review_focus',
  'target_reference_status',
  'target_reference_source',
  'target_reference_count',
  'nearest_active_reference_id',
  'nearest_active_compound_name',
  'nearest_active_similarity',
  'nearest_active_activity_class',
  'nearest_active_mechanism_class',
  'nearest_active_activity_type',
  'nearest_active_activity_value',
  'nearest_active_activity_units',
  'active_neighborhood_signal',
  'active_neighborhood_summary',
  'structural_alert_status',
  'structural_alert_count',
  'structural_alert_categories',
  'structural_alert_names',
  'pains_alert',
  'brenk_alert',
  'medchem_alert_summary',
  'diversity_cluster_id',
  'diversity_cluster_size',
  'diversity_representative',
  'nearest_neighbor_molecule_id',
  'nearest_neighbor_similarity',
  'diversity_status',
  'chemical_space_x',
  'chemical_space_y',
  'chemical_space_status',
  'chemical_space_method',
  'chemical_space_warning',
  'review_status',
  'review_note',
];

function candidateRowsForStatuses(rows, statuses) {
  const acceptedStatuses = new Set(statuses);
  return rows.filter((row) => acceptedStatuses.has(row.review_status || 'unreviewed'));
}

function downloadCandidatePackageCsv(rows, filename) {
  if (rows.length === 0) {
    return;
  }
  const csvLines = [
    candidateExportColumns.map(csvCell).join(','),
    ...rows.map((row) => candidateExportColumns.map((column) => csvCell(row[column])).join(',')),
  ];
  downloadTextFile(csvLines.join('\n'), filename, 'text/csv;charset=utf-8');
}

function downloadCandidatePackageMarkdown(rows, filename) {
  if (rows.length === 0) {
    return;
  }
  downloadTextFile(buildCandidatePackageMarkdown(rows), filename, 'text/markdown;charset=utf-8');
}

async function downloadCandidatePackageSdf(rows, filename, setSdfExportState) {
  if (rows.length === 0) {
    return;
  }
  setSdfExportState({ loading: true, message: '', error: '' });
  try {
    const response = await fetch(`${apiBaseUrl}/api/candidates/export-sdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidates: rows }),
    });
    const exported = response.headers.get('X-MolOptima-SDF-Exported') ?? '0';
    const skipped = response.headers.get('X-MolOptima-SDF-Skipped') ?? '0';
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail = payload.detail || `HTTP ${response.status}`;
      throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    }
    const blob = await response.blob();
    downloadBlob(blob, filename);
    setSdfExportState({
      loading: false,
      message: `SDF export complete: ${exported} structure(s) exported, ${skipped} row(s) skipped.`,
      error: '',
    });
  } catch (error) {
    setSdfExportState({
      loading: false,
      message: '',
      error: readableError(error),
    });
  }
}

function buildCandidatePackageMarkdown(rows) {
  const selectedCount = candidateRowsForStatuses(rows, ['selected']).length;
  const watchlistCount = candidateRowsForStatuses(rows, ['watchlist']).length;
  const lines = [
    '# MolOptima Candidate Handoff Package',
    '',
    'Computational screening summary for reviewed candidates. This package is not a clinical, legal, regulatory, safety, efficacy, ownership, commercialization, freedom-to-operate, patentability, or infringement conclusion.',
    '',
    '## Package summary',
    markdownRows([
      ['Candidate rows', rows.length],
      ['Selected', selectedCount],
      ['Watchlist', watchlistCount],
      ['Included review metadata', 'Review status and notes included'],
    ]),
    '',
  ];

  rows.forEach((row, index) => {
    lines.push(
      `## ${index + 1}. ${markdownValue(row.molecule_id)}`,
      markdownRows([
        ['Review status', formatReviewStatus(row.review_status)],
        ['Review note', row.review_note],
        ['Priority score', row.priority_score],
        ['Input SMILES', row.input_smiles],
        ['Canonical SMILES', row.canonical_smiles],
        ['BBB prediction', row.bbb_prediction],
        ['BBB probability', row.bbb_probability],
        ['Docking score', row.docking_score],
        ['Docking-informed score', row.combined_candidate_score],
        ['Docking priority signal', formatEvidenceCategory(row.docking_priority_signal)],
        ['Docking rank', row.docking_rank_within_run],
        ['Docking percentile', row.docking_percentile_within_run],
        ['Combined score status', formatEvidenceCategory(row.combined_score_status)],
        ['Protocol-dependent docking signal', row.combined_score_explanation],
        ['Molecular weight', row.mw],
        ['LogP', row.logp],
        ['TPSA', row.tpsa],
        ['QED', row.qed],
        ['Known compound match', row.known_compound_match],
        ['Closest known compound', formatClosestKnownCompound(row)],
        ['PubChem match', formatPubChemMatch(row)],
        ['ChEMBL context', formatChEMBLMatch(row)],
        ['Patent-context signal', formatPatentSignal(row)],
        ['Evidence summary', formatEvidenceCategory(row.evidence_summary_category)],
        ['Biopharma context level', formatEvidenceCategory(row.biopharma_context_level)],
        ['Recommended review focus', row.recommended_review_focus],
        ['Nearest active/reference compound', row.nearest_active_compound_name],
        ['Nearest active/reference similarity', row.nearest_active_similarity],
        ['Active-neighborhood signal', formatEvidenceCategory(row.active_neighborhood_signal)],
        ['Reference activity', formatTargetReferenceActivity(row)],
        ['Reference mechanism class', row.nearest_active_mechanism_class],
        ['Reference source', row.target_reference_source],
        ['Structural alerts', formatStructuralAlertStatus(row)],
        ['PAINS alert', formatBooleanLabel(row.pains_alert)],
        ['Brenk alert', formatBooleanLabel(row.brenk_alert)],
        ['Potential liability signal', row.medchem_alert_summary],
        ['Diversity cluster', formatDiversityCluster(row)],
        ['Cluster representative', formatBooleanLabel(row.diversity_representative)],
        ['Nearest neighbor similarity', formatNearestNeighbor(row)],
        ['Chemical-space X', row.chemical_space_x],
        ['Chemical-space Y', row.chemical_space_y],
        ['Chemical-space method', row.chemical_space_method],
      ]),
      '',
    );
  });

  return lines.join('\n');
}

function downloadTextFile(text, filename, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  downloadBlob(blob, filename);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replaceAll('"', '""').replaceAll('\n', ' ')}"`;
}

function buildCompoundMarkdownReport(compound) {
  const lines = [
    `# MolOptima Compound Report: ${markdownValue(compound.molecule_id)}`,
    '',
    '## Compound identity',
    markdownRows([
      ['Molecule ID', compound.molecule_id],
      ['Input SMILES', compound.input_smiles],
      ['Canonical SMILES', compound.canonical_smiles],
      ['Valid molecule', compound.valid_molecule],
    ]),
    '',
    '## Molecular prioritization',
    markdownRows([
      ['Priority score', compound.priority_score],
      ['Lipinski pass/fail', formatPassFail(compound.lipinski_pass)],
    ]),
    '',
    '## Computational screening summary',
    markdownRows([
      ['Review status', formatReviewStatus(compound.review_status)],
      ['Review note', compound.review_note],
      ['Evidence summary', formatEvidenceCategory(compound.evidence_summary_category)],
      ['Summary notes', compound.evidence_summary_notes],
      ['Public identity signal', formatEvidenceCategory(compound.public_identity_signal)],
      ['Public bioactivity signal', formatEvidenceCategory(compound.public_bioactivity_signal)],
      ['Patent-context signal', formatEvidenceCategory(compound.patent_context_signal)],
      ['Local similarity signal', formatEvidenceCategory(compound.local_similarity_signal)],
      ['Biopharma context level', formatEvidenceCategory(compound.biopharma_context_level)],
      ['Recommended review focus', compound.recommended_review_focus],
      ['Nearest active/reference compound', compound.nearest_active_compound_name],
      ['Nearest active/reference similarity', compound.nearest_active_similarity],
      ['Active-neighborhood signal', formatEvidenceCategory(compound.active_neighborhood_signal)],
      ['Reference activity', formatTargetReferenceActivity(compound)],
      ['Reference mechanism class', compound.nearest_active_mechanism_class],
      ['Reference source', compound.target_reference_source],
      ['Structural alerts', formatStructuralAlertStatus(compound)],
      ['PAINS alert', formatBooleanLabel(compound.pains_alert)],
      ['Brenk alert', formatBooleanLabel(compound.brenk_alert)],
      ['Potential liability signal', compound.medchem_alert_summary],
      ['Diversity cluster', formatDiversityCluster(compound)],
      ['Cluster representative', formatBooleanLabel(compound.diversity_representative)],
      ['Nearest neighbor similarity', formatNearestNeighbor(compound)],
      ['Diversity status', formatEvidenceCategory(compound.diversity_status)],
      ['Chemical-space X', compound.chemical_space_x],
      ['Chemical-space Y', compound.chemical_space_y],
      ['Chemical-space method', compound.chemical_space_method],
      ['Chemical-space status', formatEvidenceCategory(compound.chemical_space_status)],
    ]),
    '',
    '## BBB prediction',
    markdownRows([
      ['BBB prediction', compound.bbb_prediction],
      ['BBB probability', compound.bbb_probability],
      ['BBB model status', compound.bbb_model_status],
      ['BBB model name', compound.bbb_model_name],
    ]),
    '',
    '## RDKit descriptors',
    markdownRows([
      ['Molecular weight', compound.mw],
      ['TPSA', compound.tpsa],
      ['HBA', compound.hba],
      ['HBD', compound.hbd],
      ['Rotatable bonds', compound.rotatable_bonds],
      ['QED', compound.qed],
    ]),
  ];

  if (hasDockingScore(compound)) {
    lines.push(
      '',
      '## Docking score',
      markdownRows([
        ['Docking score', compound.docking_score],
        ['Docking status', compound.docking_status],
        ['Docking normalized score', compound.docking_score_normalized],
        ['Docking priority signal', formatEvidenceCategory(compound.docking_priority_signal)],
        ['Docking rank within run', compound.docking_rank_within_run],
        ['Docking percentile within run', compound.docking_percentile_within_run],
        ['Combined candidate score', compound.combined_candidate_score],
        ['Combined score status', formatEvidenceCategory(compound.combined_score_status)],
        ['Protocol-dependent docking signal', compound.combined_score_explanation],
      ]),
    );
  }

  lines.push(
    '',
    '## Synthetic feasibility',
    markdownRows([
      ['SA score', compound.sa_score],
      ['Synthetic feasibility category', compound.synthetic_feasibility_category],
      ['Synthetic feasibility status', compound.synthetic_feasibility_status],
    ]),
    '',
    '## Known-compound identity',
    markdownRows([
      ['Known compound match', compound.known_compound_match],
      ['Known compound name', compound.known_compound_name],
      ['Known compound ID', compound.known_compound_id],
      ['Known compound source', compound.known_compound_source],
      ['Identity check status', compound.identity_check_status],
    ]),
    '',
    '## Public compound match',
    markdownRows([
      ['PubChem exact match', compound.pubchem_exact_match],
      ['PubChem CID', compound.pubchem_cid],
      ['PubChem preferred name', compound.pubchem_preferred_name],
      ['PubChem lookup status', compound.pubchem_lookup_status],
      ['PubChem cache status', compound.pubchem_cache_status],
      ['PubChem warning', compound.pubchem_warning],
    ]),
    '',
    '## Public bioactivity context',
    markdownRows([
      ['ChEMBL exact match', compound.chembl_exact_match],
      ['ChEMBL molecule ID', compound.chembl_molecule_id],
      ['ChEMBL preferred name', compound.chembl_pref_name],
      ['ChEMBL lookup status', compound.chembl_lookup_status],
      ['ChEMBL cache status', compound.chembl_cache_status],
      ['ChEMBL warning', compound.chembl_warning],
      ['Known public bioactivity records', compound.chembl_activity_count],
      ['Associated public targets', compound.chembl_target_count],
      ['ChEMBL target summary', compound.chembl_target_summary],
      ['ChEMBL similarity match', compound.chembl_similarity_match],
      ['ChEMBL similarity score', compound.chembl_similarity_score],
      ['ChEMBL similarity molecule ID', compound.chembl_similarity_molecule_id],
      ['ChEMBL similarity preferred name', compound.chembl_similarity_pref_name],
      ['ChEMBL similarity status', compound.chembl_similarity_status],
    ]),
    '',
    '## Public patent-context evidence',
    markdownRows([
      ['Patent-context signal', formatPatentSignal(compound)],
      ['Patent lookup status', compound.patent_lookup_status],
      ['Patent cache status', compound.patent_cache_status],
      ['Public patent-associated evidence', compound.patent_public_evidence_match],
      ['Patent source', compound.patent_source],
      ['SureChEMBL returned records for this structure/query', compound.patent_record_count],
      ['Record-count interpretation', 'Counts may include broad or indirect public document associations.'],
      ['Top patent record ID', compound.patent_top_record_id],
      ['Top patent record title', compound.patent_top_record_title],
      ['Top patent record URL', compound.patent_top_record_url],
      ['Patent query identifier', compound.patent_query_identifier],
      ['Patent warning', compound.patent_warning],
    ]),
    '',
    '## Closest known compound similarity',
    markdownRows([
      ['Closest known compound', compound.closest_known_compound_name],
      ['Closest known compound ID', compound.closest_known_compound_id],
      ['Closest known compound similarity', compound.closest_known_compound_similarity],
      ['Closest known compound source', compound.closest_known_compound_source],
      ['Similarity check status', compound.similarity_check_status],
    ]),
    '',
    '## Notes/disclaimer',
    'This report is for computational screening only. It is not a clinical, legal, regulatory, safety, efficacy, ownership, commercialization, or other legal conclusion.',
    '',
  );

  return lines.join('\n');
}

function markdownRows(rows) {
  return rows
    .map(([label, value]) => `- **${label}:** ${markdownValue(value)}`)
    .join('\n');
}

function markdownValue(value) {
  return String(formatDetailValue(value)).replaceAll('\n', ' ');
}

function hasDockingScore(compound) {
  return (
    compound.docking_score !== null &&
    compound.docking_score !== undefined &&
    compound.docking_score !== '' &&
    compound.docking_status !== 'not_provided'
  );
}

function safeFilename(value) {
  return String(value)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'compound';
}

function isTrueValue(value) {
  return value === true || value === 1 || String(value).toLowerCase() === 'true';
}

function isFalseValue(value) {
  return value === false || value === 0 || String(value).toLowerCase() === 'false';
}

function numericValue(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function formatDetailValue(value) {
  if (value === null || value === undefined || value === '') {
    return 'Not available';
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  return String(value);
}

function formatStructuredDetail(value) {
  if (!value || typeof value !== 'object' || Object.keys(value).length === 0) return null;
  return JSON.stringify(value, null, 2);
}

export async function fetchScientificRuntimeStatus(baseUrl = apiBaseUrl, { refresh = false } = {}) {
  const response = await fetch(
    `${baseUrl}/api/scientific-runtime/${refresh ? 'refresh' : 'status'}`,
    refresh ? { method: 'POST' } : undefined,
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || `Scientific runtime status failed (HTTP ${response.status}).`);
  return payload;
}

export const SCIENTIFIC_RUNTIME_POLL_INTERVAL_MS = 3000;

export function scientificRuntimePollDelay(payload) {
  if (!payload) return null;
  if (payload.qualification_state === 'checking' || payload.refreshing) {
    return SCIENTIFIC_RUNTIME_POLL_INTERVAL_MS;
  }
  return Object.values(payload.components ?? {}).some(
    (component) => component?.status === 'checking' || component?.refreshing,
  ) ? SCIENTIFIC_RUNTIME_POLL_INTERVAL_MS : null;
}

function RuntimeStatusChip({ status }) {
  const normalized = String(status || 'unavailable').toLowerCase();
  const color = normalized === 'available' ? 'success' : normalized === 'incompatible' || normalized === 'error' ? 'error' : 'warning';
  return <Chip label={normalized[0].toUpperCase() + normalized.slice(1)} color={color} variant="outlined" />;
}

function RuntimeCard({ title, status, refreshing = false, children }) {
  return (
    <Paper elevation={0} sx={{ p: 2, border: '1px solid', borderColor: 'divider', height: '100%' }}>
      <Stack spacing={1}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
          <Typography variant="h6">{title}</Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            {refreshing ? <Typography variant="caption" color="text.secondary">Refreshing</Typography> : null}
            <RuntimeStatusChip status={status} />
          </Stack>
        </Stack>
        {children}
      </Stack>
    </Paper>
  );
}

export function ScientificRuntimePanel({ runtimeState, onRefresh }) {
  const components = runtimeState.payload?.components ?? {};
  const chemberta = components.chemberta ?? {};
  const gmc = components.gmc_mpnn_bbb ?? {};
  const chemprop = components.chemprop_regression ?? {};
  const receptor = components.receptor_preparation ?? {};
  const docking = components.docking ?? {};
  const vina = docking.vina ?? {};
  const openbabel = docking.openbabel ?? {};
  const sourceText = (value) => value || 'Not available';
  const dependencyText = (label, dependency) => dependency?.status === 'checking'
    ? `${label} · checking`
    : `${label} ${sourceText(dependency?.version)} · ${formatScientificPresentationValue(dependency?.status)}`;
  const nativeRuntimeText = (label, runtime) => runtime?.status === 'checking'
    ? `${label}: Checking...`
    : `${label}: ${sourceText(runtime?.identity)} · ${formatScientificPresentationValue(runtime?.status)}`;
  const pollPending = scientificRuntimePollDelay(runtimeState.payload) !== null;

  return (
    <Paper elevation={0} sx={{ p: 3, border: '1px solid', borderColor: 'divider' }}>
      <Stack spacing={2.5}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1.5}>
          <Stack spacing={0.5}>
            <Typography variant="h2">Scientific Runtime</Typography>
            <Typography color="text.secondary">
              Status comes from backend production runtime contract probes. Opening Settings does not run scientific inference.
            </Typography>
          </Stack>
          <Button variant="outlined" onClick={onRefresh} disabled={runtimeState.loading}>Refresh runtime status</Button>
        </Stack>
        {runtimeState.loading && !runtimeState.payload ? <Alert severity="info">Loading scientific runtime status...</Alert> : null}
        {pollPending ? (
          <Alert severity="info">
            Production runtime qualification is running in the background. Completed runtimes are shown as they finish.
          </Alert>
        ) : null}
        {runtimeState.error ? <Alert severity="error">{runtimeState.error}</Alert> : null}
        {!runtimeState.loading && !runtimeState.error && !runtimeState.payload ? (
          <Alert severity="info">Scientific runtime status has not been checked.</Alert>
        ) : null}
        {runtimeState.payload ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
            <RuntimeCard title="ChemBERTa classification" status={chemberta.status} refreshing={chemberta.refreshing}>
              <Typography variant="body2">{chemberta.public_endpoint_count ?? 9} public classification endpoints</Typography>
              <Typography variant="body2" color="text.secondary">Runtime source: {formatRuntimeSource(chemberta.runtime_source)}</Typography>
            </RuntimeCard>
            <RuntimeCard title="GMC-MPNN BBB" status={gmc.status} refreshing={gmc.refreshing}>
              <Typography variant="body2">5-seed ensemble · raw unweighted ensemble mean · population SD</Typography>
              <Typography variant="body2">Threshold 0.5 · provisional raw · calibration not frozen</Typography>
              <Typography variant="body2" color="text.secondary">Runtime source: {formatRuntimeSource(gmc.runtime_source)}</Typography>
            </RuntimeCard>
            <RuntimeCard title="Chemprop regression" status={chemprop.status} refreshing={chemprop.refreshing}>
              <Typography variant="body2">5 regression endpoints · 5-seed ensemble · sample SD</Typography>
              <Typography variant="body2" color="text.secondary">Runtime source: {formatRuntimeSource(chemprop.runtime_source)}</Typography>
            </RuntimeCard>
            <RuntimeCard title="Receptor Preparation" status={receptor.status} refreshing={receptor.refreshing}>
              <Typography variant="body2">{dependencyText('PDBFixer', receptor.pdbfixer)}</Typography>
              <Typography variant="body2">{dependencyText('OpenMM', receptor.openmm)}</Typography>
              <Typography variant="body2">{dependencyText('Meeko', receptor.meeko)}</Typography>
              <Typography variant="body2">{dependencyText('Gemmi', receptor.gemmi)}</Typography>
              <Typography variant="body2" color="text.secondary">Hydrogen completion does not establish pH-correct protonation.</Typography>
            </RuntimeCard>
            <RuntimeCard title="Docking" status={docking.status} refreshing={docking.refreshing}>
              <Typography variant="body2">{nativeRuntimeText('Vina', vina)}</Typography>
              <Typography variant="body2">{nativeRuntimeText('Open Babel', openbabel)}</Typography>
              <Typography variant="body2" color="text.secondary">Vina reports protocol-dependent docking scores/affinities, not binding free energy.</Typography>
            </RuntimeCard>
          </Box>
        ) : null}
      </Stack>
    </Paper>
  );
}

export function ModelDataSourcesPage({ sourceStatusState, onCheckLocalModelCache, onRefreshSourceStatus }) {
  const [runtimeState, setRuntimeState] = useState({ payload: null, loading: true, error: '' });
  const payload = sourceStatusState.payload ?? {};
  const modelManifest = payload.model_manifest ?? {};
  const publicManifest = payload.public_data_manifest ?? {};
  const runManifest = payload.run_manifest ?? {};
  const bbbModel = modelManifest.models?.bbb_chemberta ?? {};
  const latestRunId = runManifest.latest_run;
  const latestRun = latestRunId ? runManifest.runs?.[latestRunId] : null;
  const cached = Boolean(bbbModel.cached);
  const modelAvailable = latestRun?.actual_bbb_model_status === 'model_available';
  const placeholderUsed = Boolean(latestRun?.fallback_placeholder_used);
  const sources = Object.values(publicManifest.sources ?? {});

  async function refreshScientificRuntime() {
    setRuntimeState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const runtimePayload = await fetchScientificRuntimeStatus(apiBaseUrl, { refresh: true });
      setRuntimeState({ payload: runtimePayload, loading: false, error: '' });
    } catch (error) {
      setRuntimeState((current) => ({ ...current, loading: false, error: readableError(error) }));
    }
  }

  useEffect(() => {
    let active = true;
    fetchScientificRuntimeStatus().then(
      (runtimePayload) => active && setRuntimeState({ payload: runtimePayload, loading: false, error: '' }),
      (error) => active && setRuntimeState({ payload: null, loading: false, error: readableError(error) }),
    );
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const delay = scientificRuntimePollDelay(runtimeState.payload);
    if (delay === null) return undefined;
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const runtimePayload = await fetchScientificRuntimeStatus();
        if (active) setRuntimeState({ payload: runtimePayload, loading: false, error: '' });
      } catch (error) {
        if (active) setRuntimeState((current) => ({ ...current, loading: false, error: readableError(error) }));
      }
    }, delay);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [runtimeState.payload]);

  return (
    <Stack spacing={3}>
      <PageIntro
        title="Model and Data Sources"
        description="Inspect production scientific runtime compatibility and optional public data-source state."
      />

      <ScientificRuntimePanel runtimeState={runtimeState} onRefresh={refreshScientificRuntime} />

      <Box component="details" sx={{ '& > summary': { cursor: 'pointer' } }}>
        <Box component="summary" sx={{ fontWeight: 700, color: 'text.secondary', mb: 1 }}>
          Advanced diagnostics · legacy BBB cache and run manifests
        </Box>
        <Paper elevation={0} sx={{ p: 3, border: '1px solid', borderColor: 'divider' }}>
        <Stack spacing={2.5}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={2}>
            <Stack spacing={0.75}>
              <Typography variant="h2">Legacy BBB Cache Diagnostics</Typography>
              <Typography color="text.secondary">
                Compatibility-only diagnostics for the retired cache-backed BBB classifier. This does not describe current production ChemBERTa classification or GMC-MPNN BBB inference; both production runtimes are shown above.
              </Typography>
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
              <Button variant="outlined" onClick={onCheckLocalModelCache} disabled={sourceStatusState.loading}>
                Check legacy cache
              </Button>
              <Button variant="outlined" onClick={onRefreshSourceStatus} disabled={sourceStatusState.loading}>
                Refresh source status
              </Button>
            </Stack>
          </Stack>

          {sourceStatusState.loading && <Alert severity="info">Refreshing local status...</Alert>}
          {sourceStatusState.error && <Alert severity="error">{sourceStatusState.error}</Alert>}

          {cached ? (
            <Alert severity="success">The legacy BBB compatibility model is configured in the retired local cache.</Alert>
          ) : (
            <Alert severity="warning">The legacy BBB compatibility model is not present in the retired local cache or is unavailable.</Alert>
          )}

          {latestRun && modelAvailable && (
            <Alert severity="success">This legacy run used the cached BBB compatibility model.</Alert>
          )}
          {latestRun && placeholderUsed && (
            <Alert severity="info">
              This run used placeholder BBB fields because the model was unavailable.
            </Alert>
          )}

          <MetadataPanel
            rows={[
              ['BBB model cache path', modelManifest.cache_root ?? bbbModel.cache_path ?? ''],
              ['Cached status', cached ? 'Cached' : 'Not cached'],
              ['Model status from latest check', formatScientificPresentationValue(bbbModel.status ?? 'not checked')],
              ['Actual legacy model status or placeholder mode', formatScientificPresentationValue(latestRun?.actual_bbb_model_status ?? 'not_run')],
              ['Latest run timestamp', latestRun?.timestamp ?? ''],
              ['Output file', latestRun?.output_file ?? ''],
              ['Rows', latestRun?.row_count ?? ''],
            ]}
          />
        </Stack>
        </Paper>
      </Box>

      <Paper elevation={0} sx={{ p: 3, border: '1px solid', borderColor: 'divider' }}>
        <Stack spacing={2}>
          <Typography variant="h2">Public Lookup Sources</Typography>
          <Alert severity="info">
            PubChem exact identity, ChEMBL public bioactivity context, and SureChEMBL patent-context signals are available only when explicitly enabled for a run.
            SureChEMBL returned records may include broad or indirect public document associations; patent-context output is a public database signal only, not a legal conclusion.
          </Alert>
          {sources.length > 0 ? (
            <Box sx={{ overflowX: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              <Table size="small" aria-label="Public lookup source status">
                <TableHead>
                  <TableRow>
                    <TableCell>Source</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Last checked</TableCell>
                    <TableCell>Last successful lookup</TableCell>
                    <TableCell>Cache path</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sources.map((source) => (
                    <TableRow key={source.source_name}>
                      <TableCell>{source.source_name}</TableCell>
                      <TableCell>{formatScientificPresentationValue(source.status)}</TableCell>
                      <TableCell>{formatDetailValue(source.last_checked)}</TableCell>
                      <TableCell>{source.last_successful_lookup ? formatDetailValue(source.last_successful_lookup) : 'Not active'}</TableCell>
                      <TableCell>{source.cache_path}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          ) : (
            <Alert severity="info">Click Refresh source status to populate planned public source status.</Alert>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}

function HealthChip({ health }) {
  const color = health.status === 'online' ? 'success' : health.status === 'checking' ? 'default' : 'warning';
  return <Chip icon={<CloudQueueOutlinedIcon />} label={health.label} color={color} variant="outlined" />;
}

function useBackendHealth() {
  const [state, setState] = useState({
    status: 'checking',
    label: 'Checking',
    message: 'Checking backend health...',
  });

  useEffect(() => {
    const controller = startBackendHealthPolling({ apiBaseUrl, onState: setState });
    return () => controller.stop();
  }, []);

  return useMemo(() => state, [state]);
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload.detail || `HTTP ${response.status}`;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return payload;
}

function latestJobMetadata(job) {
  const { results, ...metadata } = job;
  return metadata;
}

function readableError(error) {
  if (error instanceof TypeError) {
    return 'Could not reach the FastAPI backend at http://localhost:8000.';
  }
  return error instanceof Error ? error.message : 'Request failed.';
}

export default App;
