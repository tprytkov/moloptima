import React, { useEffect, useMemo, useState } from 'react';
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
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  ThemeProvider,
  Toolbar,
  Typography,
  createTheme,
} from '@mui/material';
import AssessmentOutlinedIcon from '@mui/icons-material/AssessmentOutlined';
import CloudQueueOutlinedIcon from '@mui/icons-material/CloudQueueOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';

const drawerWidth = 256;
const apiBaseUrl = 'http://localhost:8000';

const navigationItems = [
  { label: 'Dashboard', icon: AssessmentOutlinedIcon },
  { label: 'Upload Molecules', icon: UploadFileOutlinedIcon },
  { label: 'Molecular Prioritization', icon: ScienceOutlinedIcon },
  { label: 'Run History', icon: AssessmentOutlinedIcon },
  { label: 'Run Comparison', icon: AssessmentOutlinedIcon },
  { label: 'Biopharma Intelligence', icon: InsightsOutlinedIcon },
  { label: 'Reports', icon: DescriptionOutlinedIcon },
  { label: 'Settings', icon: SettingsOutlinedIcon },
];

const summaryItems = [
  ['Pipeline', 'Phase 1 molecular prioritization'],
  ['Backend', 'FastAPI local service'],
  ['Storage', 'Local upload and result files'],
];

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
      fontSize: '2rem',
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
      lineHeight: 1.65,
    },
    button: {
      textTransform: 'none',
      fontWeight: 650,
    },
  },
});

function App() {
  const [activeItem, setActiveItem] = useState('Dashboard');
  const [uploadState, setUploadState] = useState({
    selectedFile: null,
    upload: null,
    loading: false,
    error: '',
  });
  const [prioritizationState, setPrioritizationState] = useState({
    job: null,
    result: null,
    loading: false,
    error: '',
  });
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
  const health = useBackendHealth();
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
          const latestJob = latestJobMetadata(payload.job);
          setLatestRunState({
            job: latestJob,
            result: payload.job,
            loading: false,
            error: '',
          });
          setPrioritizationState({
            job: latestJob,
            result: payload.job,
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
    if (!uploadState.selectedFile) {
      setUploadState((current) => ({ ...current, error: 'Select a CSV file before uploading.' }));
      return;
    }

    setUploadState((current) => ({ ...current, loading: true, error: '' }));
    setPrioritizationState({ job: null, result: null, loading: false, error: '' });

    const formData = new FormData();
    formData.append('file', uploadState.selectedFile);

    try {
      const payload = await apiRequest('/api/molecules/upload', {
        method: 'POST',
        body: formData,
      });
      setUploadState((current) => ({
        ...current,
        upload: payload,
        loading: false,
        error: '',
      }));
      setActiveItem('Molecular Prioritization');
    } catch (error) {
      setUploadState((current) => ({
        ...current,
        upload: null,
        loading: false,
        error: readableError(error),
      }));
    }
  }

  async function handleStartPrioritization() {
    const uploadId = uploadState.upload?.upload_id;
    if (!uploadId) {
      setPrioritizationState((current) => ({
        ...current,
        error: 'Upload a molecule CSV before starting prioritization.',
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
          enable_pubchem_lookup: pubchemLookupEnabled,
          enable_chembl_lookup: chemblLookupEnabled,
          enable_patent_lookup: patentLookupEnabled,
        }),
      });
      const result = await apiRequest(`/api/results/${job.job_id}`);
      const sourceStatus = await apiRequest('/api/model-sources/status');
      setPrioritizationState({ job, result, loading: false, error: '' });
      setLatestRunState({ job, result, loading: false, error: '' });
      setRunHistoryState((current) => ({
        ...current,
        selectedJobId: job.job_id,
        jobs: mergeHistoryJob(current.jobs, job),
      }));
      await loadAnnotationsForJob(job.job_id);
      setSourceStatusState({ payload: sourceStatus, loading: false, error: '' });
    } catch (error) {
      setPrioritizationState((current) => ({
        ...current,
        loading: false,
        error: readableError(error),
      }));
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
        jobs: mergeHistoryJob(current.jobs, job),
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

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: '100vh', display: 'flex', bgcolor: 'background.default' }}>
        <Sidebar activeItem={activeItem} onSelect={setActiveItem} />
        <Box component="main" sx={{ flexGrow: 1, minWidth: 0 }}>
          <AppHeader />
          <Box sx={{ px: { xs: 2, md: 4 }, py: 3, maxWidth: 1180 }}>
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
              onStartPrioritization={handleStartPrioritization}
              onLoadHistoricalRun={handleLoadHistoricalRun}
              onRefreshRunHistory={handleRefreshRunHistory}
              pubchemLookupEnabled={pubchemLookupEnabled}
              setPubchemLookupEnabled={setPubchemLookupEnabled}
              chemblLookupEnabled={chemblLookupEnabled}
              setChemblLookupEnabled={setChemblLookupEnabled}
              patentLookupEnabled={patentLookupEnabled}
              setPatentLookupEnabled={setPatentLookupEnabled}
              onCheckLocalModelCache={handleCheckLocalModelCache}
              onRefreshSourceStatus={handleRefreshSourceStatus}
              onSaveReviewAnnotation={handleSaveReviewAnnotation}
            />
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  );
}

function Sidebar({ activeItem, onSelect }) {
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
      <Toolbar sx={{ alignItems: 'center', gap: 1.5, px: 2.5 }}>
        <Box
          aria-hidden="true"
          sx={{
            width: 34,
            height: 34,
            borderRadius: 1.5,
            bgcolor: 'primary.main',
            display: 'grid',
            placeItems: 'center',
            color: '#ffffff',
            fontWeight: 800,
          }}
        >
          M
        </Box>
        <Box>
          <Typography variant="h2" sx={{ lineHeight: 1.05 }}>
            MolOptima
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Phase 1 workspace
          </Typography>
        </Box>
      </Toolbar>
      <Divider />
      <List sx={{ px: 1.25, py: 1.5 }}>
        {navigationItems.map(({ label, icon: Icon }) => (
          <ListItemButton
            key={label}
            selected={activeItem === label}
            onClick={() => onSelect(label)}
            sx={{
              mb: 0.5,
              borderRadius: 1,
              minHeight: 44,
              '&.Mui-selected': {
                bgcolor: 'rgba(20, 95, 116, 0.1)',
                color: 'primary.main',
              },
              '&.Mui-selected:hover': {
                bgcolor: 'rgba(20, 95, 116, 0.14)',
              },
            }}
          >
            <ListItemIcon sx={{ minWidth: 38, color: 'inherit' }}>
              <Icon fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary={label}
              primaryTypographyProps={{ fontSize: 14, fontWeight: activeItem === label ? 700 : 550 }}
            />
          </ListItemButton>
        ))}
      </List>
    </Drawer>
  );
}

function AppHeader() {
  return (
    <AppBar
      position="sticky"
      color="inherit"
      elevation={0}
      sx={{ borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}
    >
      <Toolbar sx={{ justifyContent: 'space-between', px: { xs: 2, md: 4 } }}>
        <Typography variant="h2">Scientific Prioritization Dashboard</Typography>
        <Chip size="small" label="Local backend" color="secondary" variant="outlined" />
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
  onStartPrioritization,
  onLoadHistoricalRun,
  onRefreshRunHistory,
  onSaveReviewAnnotation,
  pubchemLookupEnabled,
  setPubchemLookupEnabled,
  chemblLookupEnabled,
  setChemblLookupEnabled,
  patentLookupEnabled,
  setPatentLookupEnabled,
  onCheckLocalModelCache,
  onRefreshSourceStatus,
}) {
  if (activeItem === 'Upload Molecules') {
    return (
      <UploadMoleculesPage
        uploadState={uploadState}
        setUploadState={setUploadState}
        onUpload={onUpload}
      />
    );
  }

  if (activeItem === 'Molecular Prioritization') {
    return (
      <PrioritizationPage
        uploadState={uploadState}
        prioritizationState={prioritizationState}
        onStartPrioritization={onStartPrioritization}
        pubchemLookupEnabled={pubchemLookupEnabled}
        setPubchemLookupEnabled={setPubchemLookupEnabled}
        chemblLookupEnabled={chemblLookupEnabled}
        setChemblLookupEnabled={setChemblLookupEnabled}
        patentLookupEnabled={patentLookupEnabled}
        setPatentLookupEnabled={setPatentLookupEnabled}
        annotationsState={annotationsState}
        onSaveReviewAnnotation={onSaveReviewAnnotation}
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

function DashboardPage({ health, activeItem, latestRunState }) {
  const isDashboard = activeItem === 'Dashboard';
  const latestRunSummary = buildLatestRunSummary(latestRunState);

  return (
    <Stack spacing={3}>
      <Paper elevation={0} sx={{ p: { xs: 2.5, md: 3 }, border: '1px solid', borderColor: 'divider' }}>
        <Stack spacing={1.25} sx={{ maxWidth: 760 }}>
          <Typography component="h1" variant="h1">
            MolOptima
          </Typography>
          <Typography color="text.secondary">
            A local scientific dashboard for validating, scoring, and ranking small molecules
            through the Phase 1 molecular prioritization pipeline.
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
            {summaryItems.map(([label, value]) => (
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
            This navigation area is reserved for the next MolOptima implementation phase.
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
            <TableCell>molecule_id</TableCell>
            <TableCell>review_status</TableCell>
            <TableCell>review_note</TableCell>
            <TableCell>evidence_summary_category</TableCell>
            <TableCell>biopharma_context_level</TableCell>
            <TableCell>diversity_cluster</TableCell>
            <TableCell>cluster_representative</TableCell>
            <TableCell>nearest_neighbor_similarity</TableCell>
            <TableCell>known_compound_match</TableCell>
            <TableCell>known_compound_name</TableCell>
            <TableCell>pubchem_exact_match</TableCell>
            <TableCell>pubchem_cid</TableCell>
            <TableCell>pubchem_lookup_status</TableCell>
            <TableCell>chembl_lookup_status</TableCell>
            <TableCell>chembl_molecule_id</TableCell>
            <TableCell>chembl_activity_count</TableCell>
            <TableCell>chembl_target_summary</TableCell>
            <TableCell>patent_lookup_status</TableCell>
            <TableCell>surechembl_returned_records</TableCell>
            <TableCell>patent_top_record_id</TableCell>
            <TableCell>closest_known_compound_name</TableCell>
            <TableCell>closest_known_compound_similarity</TableCell>
            <TableCell>identity_check_status</TableCell>
            <TableCell>similarity_check_status</TableCell>
            <TableCell>recommended_review_focus</TableCell>
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
                <TableCell>{formatDiversityCluster(row)}</TableCell>
                <TableCell>{formatBooleanLabel(row.diversity_representative)}</TableCell>
                <TableCell>{formatNearestNeighbor(row)}</TableCell>
                <TableCell>{formatDetailValue(row.known_compound_match)}</TableCell>
                <TableCell>{formatDetailValue(row.known_compound_name)}</TableCell>
                <TableCell>{formatDetailValue(row.pubchem_exact_match)}</TableCell>
                <TableCell>{formatDetailValue(row.pubchem_cid)}</TableCell>
                <TableCell>{formatDetailValue(row.pubchem_lookup_status)}</TableCell>
                <TableCell>{formatDetailValue(row.chembl_lookup_status)}</TableCell>
                <TableCell>{formatDetailValue(row.chembl_molecule_id || row.chembl_similarity_molecule_id)}</TableCell>
                <TableCell>{formatDetailValue(row.chembl_activity_count)}</TableCell>
                <TableCell>{formatDetailValue(row.chembl_target_summary)}</TableCell>
                <TableCell>{formatDetailValue(row.patent_lookup_status)}</TableCell>
                <TableCell>{formatDetailValue(row.patent_record_count)}</TableCell>
                <TableCell>{formatDetailValue(row.patent_top_record_id)}</TableCell>
                <TableCell>{formatDetailValue(row.closest_known_compound_name)}</TableCell>
                <TableCell>{formatDetailValue(row.closest_known_compound_similarity)}</TableCell>
                <TableCell>{formatDetailValue(row.identity_check_status)}</TableCell>
                <TableCell>{formatDetailValue(row.similarity_check_status)}</TableCell>
                <TableCell>{formatDetailValue(row.recommended_review_focus)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  );
}

function BiopharmaInterpretationPanel({ compound, annotationsState, onSaveReviewAnnotation }) {
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
            rows={[
              ['Review status', formatReviewStatus(compound.review_status)],
              ['Review note', compound.review_note],
              ['Evidence summary category', formatEvidenceCategory(compound.evidence_summary_category)],
              ['Public identity signal', formatEvidenceCategory(compound.public_identity_signal)],
              ['Public bioactivity signal', formatEvidenceCategory(compound.public_bioactivity_signal)],
              ['Patent-context signal', formatEvidenceCategory(compound.patent_context_signal)],
              ['Local similarity signal', formatEvidenceCategory(compound.local_similarity_signal)],
              ['Biopharma context level', formatEvidenceCategory(compound.biopharma_context_level)],
              ['Recommended review focus', compound.recommended_review_focus],
              ['Diversity cluster', formatDiversityCluster(compound)],
              ['Cluster representative', formatBooleanLabel(compound.diversity_representative)],
              ['Nearest neighbor similarity', formatNearestNeighbor(compound)],
              ['Diversity status', formatEvidenceCategory(compound.diversity_status)],
              ['Exact known compound', compound.known_compound_name],
              ['PubChem exact match', formatPubChemMatch(compound)],
              ['PubChem lookup status', compound.pubchem_lookup_status],
              ['PubChem cache status', compound.pubchem_cache_status],
              ['ChEMBL match', formatChEMBLMatch(compound)],
              ['ChEMBL lookup status', compound.chembl_lookup_status],
              ['ChEMBL cache status', compound.chembl_cache_status],
              ['Known public bioactivity records', compound.chembl_activity_count],
              ['Associated public targets', compound.chembl_target_count],
              ['ChEMBL target summary', compound.chembl_target_summary],
              ['Patent-context signal', formatPatentSignal(compound)],
              ['Patent lookup status', compound.patent_lookup_status],
              ['Patent source', compound.patent_source],
              ['SureChEMBL returned records for this structure/query', compound.patent_record_count],
              ['Top patent record ID', compound.patent_top_record_id],
              ['Top patent record title', compound.patent_top_record_title],
              ['Closest known compound', compound.closest_known_compound_name],
              ['Closest similarity', compound.closest_known_compound_similarity],
              ['Identity status', compound.identity_check_status],
              ['Similarity status', compound.similarity_check_status],
            ]}
          />
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
        description="Review previously completed local prioritization jobs and reload saved result rows into the MolOptima analysis views."
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
                  ? `${jobs.length} completed runs are available locally.`
                  : 'No completed runs are available yet.'}
              </Typography>
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
              {loadedJobId && <Chip label={`Loaded run: ${loadedJobId}`} color="secondary" variant="outlined" />}
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
                    <TableCell>job_id</TableCell>
                    <TableCell>completed_at</TableCell>
                    <TableCell>rows</TableCell>
                    <TableCell>lookup_sources</TableCell>
                    <TableCell>input_file</TableCell>
                    <TableCell>output_file</TableCell>
                    <TableCell>status</TableCell>
                    <TableCell>Load</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {jobs.map((job) => {
                    const isLoaded = loadedJobId === job.job_id;
                    return (
                      <TableRow key={job.job_id} selected={isLoaded}>
                        <TableCell sx={{ fontFamily: 'ui-monospace, Consolas, monospace' }}>
                          {formatDetailValue(job.job_id)}
                        </TableCell>
                        <TableCell>{formatDetailValue(job.completed_at)}</TableCell>
                        <TableCell>{formatDetailValue(job.row_count)}</TableCell>
                        <TableCell>{formatLookupSources(job)}</TableCell>
                        <TableCell>{formatDetailValue(job.input_file)}</TableCell>
                        <TableCell>{formatDetailValue(job.output_file)}</TableCell>
                        <TableCell>{formatDetailValue(job.status)}</TableCell>
                        <TableCell>
                          <Button
                            size="small"
                            variant={isLoaded ? 'contained' : 'outlined'}
                            disabled={runHistoryState.loading}
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
  const jobs = runHistoryState.jobs ?? [];
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
            <TableCell>molecule_id</TableCell>
            <TableCell>2D structure</TableCell>
            <TableCell>presence</TableCell>
            <TableCell>priority_score_a</TableCell>
            <TableCell>priority_score_b</TableCell>
            <TableCell>priority_score_change</TableCell>
            <TableCell>evidence_a</TableCell>
            <TableCell>evidence_b</TableCell>
            <TableCell>biopharma_context_a</TableCell>
            <TableCell>biopharma_context_b</TableCell>
            <TableCell>public_identity_a</TableCell>
            <TableCell>public_identity_b</TableCell>
            <TableCell>public_bioactivity_a</TableCell>
            <TableCell>public_bioactivity_b</TableCell>
            <TableCell>patent_context_a</TableCell>
            <TableCell>patent_context_b</TableCell>
            <TableCell>local_similarity_a</TableCell>
            <TableCell>local_similarity_b</TableCell>
            <TableCell>BBB_a</TableCell>
            <TableCell>BBB_b</TableCell>
            <TableCell>review_status_a</TableCell>
            <TableCell>review_status_b</TableCell>
            <TableCell>review_note_a</TableCell>
            <TableCell>review_note_b</TableCell>
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
            <TableCell>molecule_id</TableCell>
            <TableCell>priority_score</TableCell>
            <TableCell>valid_molecule</TableCell>
            <TableCell>review_status</TableCell>
            <TableCell>review_note</TableCell>
            <TableCell>evidence_summary_category</TableCell>
            <TableCell>diversity_cluster</TableCell>
            <TableCell>cluster_representative</TableCell>
            <TableCell>nearest_neighbor_similarity</TableCell>
            <TableCell>known_compound_name</TableCell>
            <TableCell>pubchem_lookup_status</TableCell>
            <TableCell>chembl_lookup_status</TableCell>
            <TableCell>chembl_activity_count</TableCell>
            <TableCell>patent_lookup_status</TableCell>
            <TableCell>surechembl_returned_records</TableCell>
            <TableCell>closest_known_compound_similarity</TableCell>
            <TableCell>bbb_prediction</TableCell>
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
                <TableCell>{formatDetailValue(row.valid_molecule)}</TableCell>
                <TableCell>{formatReviewStatus(row.review_status)}</TableCell>
                <TableCell>{formatDetailValue(row.review_note)}</TableCell>
                <TableCell>{formatEvidenceCategory(row.evidence_summary_category)}</TableCell>
                <TableCell>{formatDiversityCluster(row)}</TableCell>
                <TableCell>{formatBooleanLabel(row.diversity_representative)}</TableCell>
                <TableCell>{formatNearestNeighbor(row)}</TableCell>
                <TableCell>{formatDetailValue(row.known_compound_name)}</TableCell>
                <TableCell>{formatDetailValue(row.pubchem_lookup_status)}</TableCell>
                <TableCell>{formatDetailValue(row.chembl_lookup_status)}</TableCell>
                <TableCell>{formatDetailValue(row.chembl_activity_count)}</TableCell>
                <TableCell>{formatDetailValue(row.patent_lookup_status)}</TableCell>
                <TableCell>{formatDetailValue(row.patent_record_count)}</TableCell>
                <TableCell>{formatDetailValue(row.closest_known_compound_similarity)}</TableCell>
                <TableCell>{formatDetailValue(row.bbb_prediction)}</TableCell>
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
    .map(([label, count]) => `${label}: ${count}`)
    .join(', ');
}

function UploadMoleculesPage({ uploadState, setUploadState, onUpload }) {
  return (
    <Stack spacing={3}>
      <PageIntro
        title="Upload Molecules"
        description="Select a CSV file with molecule_id and smiles columns. The backend stores the upload locally and returns an upload identifier for prioritization."
      />

      <Paper elevation={0} sx={{ p: 3, border: '1px solid', borderColor: 'divider' }}>
        <Stack spacing={2.5}>
          <Stack spacing={1}>
            <Typography variant="h2">Molecule CSV</Typography>
            <Typography color="text.secondary">
              Upload only small demo or public-safe molecule tables for this Phase 1 workflow.
            </Typography>
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
            <Button variant="outlined" component="label" startIcon={<UploadFileOutlinedIcon />}>
              Select CSV
              <input
                hidden
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setUploadState((current) => ({
                    ...current,
                    selectedFile: file,
                    error: '',
                  }));
                }}
              />
            </Button>
            <Typography color="text.secondary">
              {uploadState.selectedFile?.name ?? 'No file selected'}
            </Typography>
          </Stack>

          {uploadState.error && <Alert severity="error">{uploadState.error}</Alert>}
          {uploadState.upload && (
            <Alert severity="success">
              Uploaded {uploadState.upload.filename} with upload_id {uploadState.upload.upload_id}
            </Alert>
          )}

          <Box>
            <Button
              variant="contained"
              onClick={onUpload}
              disabled={uploadState.loading}
              startIcon={uploadState.loading ? <CircularProgress size={18} color="inherit" /> : null}
            >
              {uploadState.loading ? 'Uploading' : 'Upload molecules'}
            </Button>
          </Box>

          {uploadState.upload && (
            <MetadataPanel
              rows={[
                ['Status', uploadState.upload.status],
                ['Upload ID', uploadState.upload.upload_id],
                ['Rows', uploadState.upload.rows],
                ['Stored path', uploadState.upload.path],
              ]}
            />
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}

function CandidateExportPanel({ rows }) {
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

function PrioritizationPage({
  uploadState,
  prioritizationState,
  onStartPrioritization,
  pubchemLookupEnabled,
  setPubchemLookupEnabled,
  chemblLookupEnabled,
  setChemblLookupEnabled,
  patentLookupEnabled,
  setPatentLookupEnabled,
  annotationsState,
  onSaveReviewAnnotation,
}) {
  const resultRows = prioritizationState.result?.results ?? [];
  const [filters, setFilters] = useState(defaultEvidenceFilters);
  const filteredRows = useMemo(() => applyEvidenceFilters(resultRows, filters), [resultRows, filters]);
  const [selectedCompoundKey, setSelectedCompoundKey] = useState(null);
  const selectedCompound =
    filteredRows.find((row, index) => compoundRowKey(row, index) === selectedCompoundKey) ?? null;

  useEffect(() => {
    setSelectedCompoundKey(null);
  }, [prioritizationState.result?.output_file, filters]);

  return (
    <Stack spacing={3}>
      <PageIntro
        title="Molecular Prioritization"
        description="Start the Phase 1 backend pipeline for the uploaded molecule CSV and inspect the returned job metadata and top ranked records."
      />

      <Paper elevation={0} sx={{ p: 3, border: '1px solid', borderColor: 'divider' }}>
        <Stack spacing={2.5}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={2}>
            <Stack spacing={0.75}>
              <Typography variant="h2">Prioritization Job</Typography>
              <Typography color="text.secondary">
                {uploadState.upload
                  ? `Ready to run upload_id ${uploadState.upload.upload_id}`
                  : 'Upload a molecule CSV before starting a prioritization job.'}
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
              <Button
                variant="contained"
                onClick={onStartPrioritization}
                disabled={!uploadState.upload || prioritizationState.loading}
                startIcon={prioritizationState.loading ? <CircularProgress size={18} color="inherit" /> : null}
              >
                {prioritizationState.loading ? 'Running' : 'Start prioritization'}
              </Button>
            </Stack>
          </Stack>

          <Alert severity={pubchemLookupEnabled || chemblLookupEnabled || patentLookupEnabled ? 'warning' : 'info'}>
            {pubchemLookupEnabled || chemblLookupEnabled || patentLookupEnabled
              ? 'Selected public lookups may use the network. PubChem, ChEMBL, and SureChEMBL patent-context results are cached locally and reported as research signals only.'
              : 'Public compound lookup is off. Output rows will mark PubChem, ChEMBL, and patent-context lookup as not_requested.'}
          </Alert>

          {prioritizationState.error && <Alert severity="error">{prioritizationState.error}</Alert>}

          {prioritizationState.job && (
            <MetadataPanel
              rows={[
                ['Status', prioritizationState.job.status],
                ['Job ID', prioritizationState.job.job_id],
                ['Rows', prioritizationState.job.row_count],
                ['Output file', prioritizationState.job.output_file],
                ['Completed at', prioritizationState.job.completed_at ?? ''],
                ['Candidate shortlist', formatReviewCounts(resultRows)],
                ['Chemical diversity', formatDiversitySummary(resultRows)],
              ]}
            />
          )}
        </Stack>
      </Paper>

      {prioritizationState.result && (
        <Paper elevation={0} sx={{ p: 3, border: '1px solid', borderColor: 'divider' }}>
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={1}>
              <Typography variant="h2">Result Preview</Typography>
              <Chip
                label={`Showing ${filteredRows.length} of ${resultRows.length} molecules`}
                color={prioritizationState.result.status === 'completed' ? 'success' : 'warning'}
                variant="outlined"
              />
            </Stack>
            <Typography color="text.secondary">
              Result file: {prioritizationState.result.output_file}
            </Typography>
            {resultRows.length > 0 ? (
              <>
                <EvidenceFilterPanel
                  rows={resultRows}
                  filteredRows={filteredRows}
                  filters={filters}
                  onChange={setFilters}
                  onReset={() => setFilters(defaultEvidenceFilters)}
                  exportFilename="moloptima-prioritization-filtered.csv"
                />
                <ResultPreview
                  rows={filteredRows.slice(0, 5)}
                  selectedCompoundKey={selectedCompoundKey}
                  onSelectCompound={setSelectedCompoundKey}
                />
                {filteredRows.length > 5 && (
                  <Typography variant="caption" color="text.secondary">
                    Preview shows the first 5 filtered molecules.
                  </Typography>
                )}
              </>
            ) : (
              <Alert severity="info">No result rows were returned for this job.</Alert>
            )}
          </Stack>
        </Paper>
      )}

      {selectedCompound && (
        <CompoundDetailPanel
          compound={selectedCompound}
          annotationsState={annotationsState}
          onSaveReviewAnnotation={onSaveReviewAnnotation}
        />
      )}
    </Stack>
  );
}

function PageIntro({ title, description }) {
  return (
    <Paper elevation={0} sx={{ p: { xs: 2.5, md: 3 }, border: '1px solid', borderColor: 'divider' }}>
      <Stack spacing={1.25} sx={{ maxWidth: 780 }}>
        <Typography component="h1" variant="h1">
          {title}
        </Typography>
        <Typography color="text.secondary">{description}</Typography>
      </Stack>
    </Paper>
  );
}

function MetadataPanel({ rows }) {
  return (
    <Box
      sx={{
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
  priority_score_min: '',
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
  ['bbb_prediction', 'BBB prediction'],
  ['bbb_model_status', 'BBB status'],
  ['review_status', 'Review status'],
  ['diversity_representative', 'Cluster representative'],
];

function EvidenceFilterPanel({ rows, filteredRows, filters, onChange, onReset, exportFilename }) {
  const updateFilter = (key, value) => {
    onChange({ ...filters, [key]: value });
  };

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2 }}>
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={1.5}>
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
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
            <Button variant="outlined" onClick={onReset}>
              Clear filters
            </Button>
            <Button
              variant="contained"
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
  return Array.from(
    new Set(
      rows
        .map((row) => normalizedFilterValue(row[key]))
        .filter(Boolean),
    ),
  )
    .sort((left, right) => left.localeCompare(right))
    .map((value) => [value, formatEvidenceCategory(value)]);
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

  return (
    <Box sx={{ overflowX: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Table size="small" aria-label="Prioritization result preview">
        <TableHead>
          <TableRow>
            <TableCell>Molecule</TableCell>
            <TableCell>Valid</TableCell>
            <TableCell>Score</TableCell>
            <TableCell>Review status</TableCell>
            <TableCell>Review note</TableCell>
            {hasEvidenceSynthesis && <TableCell>Evidence summary</TableCell>}
            {hasDiversity && <TableCell>Diversity cluster</TableCell>}
            {hasDiversity && <TableCell>Nearest neighbor similarity</TableCell>}
            {hasIdentityStatus && <TableCell>Identity</TableCell>}
            {hasPublicIdentityStatus && <TableCell>Public compound match</TableCell>}
            {hasChEMBLStatus && <TableCell>Public bioactivity context</TableCell>}
            {hasPatentStatus && <TableCell>Patent-context signal</TableCell>}
            {hasSimilarityStatus && <TableCell>Closest known</TableCell>}
            {hasDockingScore && <TableCell>Docking score</TableCell>}
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
                <TableCell>{row.valid_molecule}</TableCell>
                <TableCell>{row.priority_score}</TableCell>
                <TableCell>{formatReviewStatus(row.review_status)}</TableCell>
                <TableCell>{formatDetailValue(row.review_note)}</TableCell>
                {hasEvidenceSynthesis && (
                  <TableCell>{formatEvidenceCategory(row.evidence_summary_category)}</TableCell>
                )}
                {hasDiversity && (
                  <TableCell>{formatDiversityCluster(row)}</TableCell>
                )}
                {hasDiversity && (
                  <TableCell>{formatNearestNeighbor(row)}</TableCell>
                )}
                {hasIdentityStatus && (
                  <TableCell>{row.known_compound_match === true ? row.known_compound_name : row.identity_check_status}</TableCell>
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
                {hasSyntheticAccessibility && <TableCell>{row.sa_score ?? 'not available'}</TableCell>}
                {hasSyntheticAccessibility && (
                  <TableCell>{row.synthetic_feasibility_category ?? 'not available'}</TableCell>
                )}
                <TableCell>{row.bbb_prediction ?? 'unavailable'}</TableCell>
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

function CompoundDetailPanel({ compound, annotationsState, onSaveReviewAnnotation }) {
  return (
    <Card elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
      <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
        <Stack spacing={2.5}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={1.5}>
            <Stack spacing={0.5}>
              <Typography variant="h2">Compound Detail</Typography>
              <Typography color="text.secondary">
                {formatDetailValue(compound.molecule_id)}
              </Typography>
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems={{ sm: 'center' }}>
              <Button
                variant="outlined"
                startIcon={<DownloadOutlinedIcon />}
                onClick={() => downloadCompoundMarkdownReport(compound)}
              >
                Download Markdown Report
              </Button>
              <Chip
                label={isFalseValue(compound.valid_molecule) ? 'Invalid molecule' : 'Valid molecule'}
                color={isFalseValue(compound.valid_molecule) ? 'warning' : 'success'}
                variant="outlined"
              />
            </Stack>
          </Stack>
          <ReviewAnnotationControls
            compound={compound}
            annotationsState={annotationsState}
            onSaveReviewAnnotation={onSaveReviewAnnotation}
          />
          <StructurePreview compound={compound} />

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' },
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
                ['Diversity cluster', formatDiversityCluster(compound)],
                ['Cluster representative', formatBooleanLabel(compound.diversity_representative)],
                ['Nearest neighbor similarity', formatNearestNeighbor(compound)],
                ['Diversity status', formatEvidenceCategory(compound.diversity_status)],
              ]}
            />
            <DetailTable
              title="Identity and Score"
              rows={[
                ['Molecule ID', compound.molecule_id],
                ['Input SMILES', compound.input_smiles],
                ['Canonical SMILES', compound.canonical_smiles],
                ['Valid molecule', compound.valid_molecule],
                ['Priority score', compound.priority_score],
                ['Known compound match', compound.known_compound_match],
                ['Known compound name', compound.known_compound_name],
                ['Known compound source', compound.known_compound_source],
                ['Known compound ID', compound.known_compound_id],
                ['Identity check status', compound.identity_check_status],
                ['PubChem exact match', compound.pubchem_exact_match],
                ['PubChem CID', compound.pubchem_cid],
                ['PubChem preferred name', compound.pubchem_preferred_name],
                ['PubChem lookup status', compound.pubchem_lookup_status],
                ['PubChem cache status', compound.pubchem_cache_status],
                ['PubChem warning', compound.pubchem_warning],
                ['ChEMBL match', formatChEMBLMatch(compound)],
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
                ['Patent-context signal', formatPatentSignal(compound)],
                ['Patent lookup status', compound.patent_lookup_status],
                ['Patent cache status', compound.patent_cache_status],
                ['Public patent-associated evidence', compound.patent_public_evidence_match],
                ['Patent source', compound.patent_source],
                ['SureChEMBL returned records for this structure/query', compound.patent_record_count],
                ['Top patent record ID', compound.patent_top_record_id],
                ['Top patent record title', compound.patent_top_record_title],
                ['Top patent record URL', compound.patent_top_record_url],
                ['Patent query identifier', compound.patent_query_identifier],
                ['Patent warning', compound.patent_warning],
                ['Closest known compound', compound.closest_known_compound_name],
                ['Closest known compound ID', compound.closest_known_compound_id],
                ['Closest known compound similarity', compound.closest_known_compound_similarity],
                ['Closest known compound source', compound.closest_known_compound_source],
                ['Similarity check status', compound.similarity_check_status],
                ['Docking score', compound.docking_score],
                ['Docking status', compound.docking_status],
              ]}
            />
            <DetailTable
              title="Model Outputs"
              rows={[
                ['BBB prediction', compound.bbb_prediction],
                ['BBB probability', compound.bbb_probability],
                ['BBB model status', compound.bbb_model_status],
                ['SA score', compound.sa_score],
                ['Synthetic feasibility category', compound.synthetic_feasibility_category],
                ['Synthetic feasibility status', compound.synthetic_feasibility_status],
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
  if (value === true) {
    return 'Pass';
  }
  if (value === false) {
    return 'Fail';
  }
  return value;
}

function formatClosestKnownCompound(row) {
  if (!row.closest_known_compound_name) {
    return row.similarity_check_status ?? 'not available';
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
  return row.pubchem_lookup_status ?? 'not available';
}

function formatChEMBLMatch(row) {
  if (isTrueValue(row.chembl_exact_match)) {
    return `${row.chembl_pref_name || row.chembl_molecule_id || 'ChEMBL match'} (${formatDetailValue(row.chembl_activity_count)} activities)`;
  }
  if (isTrueValue(row.chembl_similarity_match)) {
    const score = row.chembl_similarity_score ? `, similarity ${row.chembl_similarity_score}` : '';
    return `${row.chembl_similarity_pref_name || row.chembl_similarity_molecule_id || 'ChEMBL analog'}${score}`;
  }
  return row.chembl_lookup_status ?? 'not available';
}

function formatPatentSignal(row) {
  if (isTrueValue(row.patent_public_evidence_match)) {
    const count = row.patent_record_count ? `${row.patent_record_count} returned records` : 'returned records';
    return `${row.patent_source || 'SureChEMBL'} returned ${count} for this structure/query`;
  }
  return row.patent_lookup_status ?? 'not available';
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

function mergeHistoryJob(jobs, job) {
  if (!job?.job_id) {
    return jobs;
  }
  const historyJob = {
    job_id: job.job_id,
    created_at: job.created_at,
    completed_at: job.completed_at,
    row_count: job.row_count,
    status: job.status,
    input_file: job.input_file,
    output_file: job.output_file,
    public_lookup_requested: job.public_lookup_requested,
    pubchem_lookup_requested: job.pubchem_lookup_requested,
    chembl_lookup_requested: job.chembl_lookup_requested,
    patent_lookup_requested: job.patent_lookup_requested,
  };
  const withoutCurrent = jobs.filter((item) => item.job_id !== job.job_id);
  return [historyJob, ...withoutCurrent].sort((left, right) =>
    String(right.completed_at ?? '').localeCompare(String(left.completed_at ?? '')),
  );
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
  'diversity_cluster_id',
  'diversity_cluster_size',
  'diversity_representative',
  'nearest_neighbor_molecule_id',
  'nearest_neighbor_similarity',
  'diversity_status',
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
        ['Diversity cluster', formatDiversityCluster(row)],
        ['Cluster representative', formatBooleanLabel(row.diversity_representative)],
        ['Nearest neighbor similarity', formatNearestNeighbor(row)],
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
      ['Diversity cluster', formatDiversityCluster(compound)],
      ['Cluster representative', formatBooleanLabel(compound.diversity_representative)],
      ['Nearest neighbor similarity', formatNearestNeighbor(compound)],
      ['Diversity status', formatEvidenceCategory(compound.diversity_status)],
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
    return value ? 'True' : 'False';
  }
  return String(value);
}

function ModelDataSourcesPage({ sourceStatusState, onCheckLocalModelCache, onRefreshSourceStatus }) {
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

  return (
    <Stack spacing={3}>
      <PageIntro
        title="Model and Data Sources"
        description="Inspect the app-managed BBB model cache, latest run model status, and public lookup source state."
      />

      <Paper elevation={0} sx={{ p: 3, border: '1px solid', borderColor: 'divider' }}>
        <Stack spacing={2.5}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={2}>
            <Stack spacing={0.75}>
              <Typography variant="h2">Local Model Cache</Typography>
              <Typography color="text.secondary">
                Model status is recorded in output CSVs and run manifests.
              </Typography>
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
              <Button variant="outlined" onClick={onCheckLocalModelCache} disabled={sourceStatusState.loading}>
                Check local model cache
              </Button>
              <Button variant="outlined" onClick={onRefreshSourceStatus} disabled={sourceStatusState.loading}>
                Refresh source status
              </Button>
            </Stack>
          </Stack>

          {sourceStatusState.loading && <Alert severity="info">Refreshing local status...</Alert>}
          {sourceStatusState.error && <Alert severity="error">{sourceStatusState.error}</Alert>}

          {cached ? (
            <Alert severity="success">BBB/ChemBERTa model is configured and cached.</Alert>
          ) : (
            <Alert severity="warning">BBB/ChemBERTa model is not cached or unavailable.</Alert>
          )}

          {latestRun && modelAvailable && (
            <Alert severity="success">This run used the local BBB/ChemBERTa model.</Alert>
          )}
          {latestRun && placeholderUsed && (
            <Alert severity="info">
              This run used placeholder BBB fields because the model was unavailable.
            </Alert>
          )}

          <MetadataPanel
            rows={[
              ['BBB model cache path', modelManifest.cache_root ?? bbbModel.cache_path ?? ''],
              ['Cached status', cached ? 'cached' : 'not cached'],
              ['Model status from latest check', bbbModel.status ?? 'not checked'],
              ['Actual model used or placeholder mode', latestRun?.actual_bbb_model_status ?? 'not run'],
              ['Latest run timestamp', latestRun?.timestamp ?? ''],
              ['Output file', latestRun?.output_file ?? ''],
              ['Rows', latestRun?.row_count ?? ''],
            ]}
          />
        </Stack>
      </Paper>

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
                      <TableCell>{source.status}</TableCell>
                      <TableCell>{source.last_checked}</TableCell>
                      <TableCell>{source.last_successful_lookup || 'not active'}</TableCell>
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
    let isMounted = true;

    async function checkHealth() {
      try {
        const response = await fetch(`${apiBaseUrl}/health`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        if (isMounted) {
          setState({
            status: 'online',
            label: 'Online',
            message: JSON.stringify(payload),
          });
        }
      } catch (error) {
        if (isMounted) {
          setState({
            status: 'offline',
            label: 'Offline',
            message: error instanceof Error ? error.message : 'Backend health check failed.',
          });
        }
      }
    }

    checkHealth();
    return () => {
      isMounted = false;
    };
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
