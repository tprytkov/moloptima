import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  CssBaseline,
  Divider,
  Drawer,
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
  const [sourceStatusState, setSourceStatusState] = useState({
    payload: null,
    loading: false,
    error: '',
  });
  const health = useBackendHealth();

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
        body: JSON.stringify({ upload_id: uploadId }),
      });
      const result = await apiRequest(`/api/results/${job.job_id}`);
      const sourceStatus = await apiRequest('/api/model-sources/status');
      setPrioritizationState({ job, result, loading: false, error: '' });
      setSourceStatusState({ payload: sourceStatus, loading: false, error: '' });
    } catch (error) {
      setPrioritizationState((current) => ({
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
              prioritizationState={prioritizationState}
              sourceStatusState={sourceStatusState}
              onUpload={handleUpload}
              onStartPrioritization={handleStartPrioritization}
              onCheckLocalModelCache={handleCheckLocalModelCache}
              onRefreshSourceStatus={handleRefreshSourceStatus}
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
  sourceStatusState,
  onUpload,
  onStartPrioritization,
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

  return <DashboardPage health={health} activeItem={activeItem} prioritizationState={prioritizationState} />;
}

function DashboardPage({ health, activeItem, prioritizationState }) {
  const isDashboard = activeItem === 'Dashboard';
  const latestRunSummary = buildLatestRunSummary(prioritizationState);

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
                  {latestRunSummary
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
            ) : (
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

function buildLatestRunSummary(prioritizationState) {
  const result = prioritizationState.result;
  const rows = result?.results ?? [];

  if (!result || rows.length === 0) {
    return null;
  }

  const totalMolecules = Number(result.row_count ?? rows.length);
  const validMolecules = rows.filter((row) => row.valid_molecule === true).length;
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

function PrioritizationPage({ uploadState, prioritizationState, onStartPrioritization }) {
  const resultRows = prioritizationState.result?.results ?? [];
  const [selectedCompoundKey, setSelectedCompoundKey] = useState(null);
  const selectedCompound =
    resultRows.find((row, index) => compoundRowKey(row, index) === selectedCompoundKey) ?? null;

  useEffect(() => {
    setSelectedCompoundKey(null);
  }, [prioritizationState.result?.output_file]);

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
            <Button
              variant="contained"
              onClick={onStartPrioritization}
              disabled={!uploadState.upload || prioritizationState.loading}
              startIcon={prioritizationState.loading ? <CircularProgress size={18} color="inherit" /> : null}
            >
              {prioritizationState.loading ? 'Running' : 'Start prioritization'}
            </Button>
          </Stack>

          {prioritizationState.error && <Alert severity="error">{prioritizationState.error}</Alert>}

          {prioritizationState.job && (
            <MetadataPanel
              rows={[
                ['Status', prioritizationState.job.status],
                ['Job ID', prioritizationState.job.job_id],
                ['Rows', prioritizationState.job.row_count],
                ['Output file', prioritizationState.job.output_file],
                ['Completed at', prioritizationState.job.completed_at ?? ''],
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
                label={`${prioritizationState.result.row_count} rows`}
                color={prioritizationState.result.status === 'completed' ? 'success' : 'warning'}
                variant="outlined"
              />
            </Stack>
            <Typography color="text.secondary">
              Result file: {prioritizationState.result.output_file}
            </Typography>
            {resultRows.length > 0 ? (
              <ResultPreview
                rows={resultRows.slice(0, 5)}
                selectedCompoundKey={selectedCompoundKey}
                onSelectCompound={setSelectedCompoundKey}
              />
            ) : (
              <Alert severity="info">No result rows were returned for this job.</Alert>
            )}
          </Stack>
        </Paper>
      )}

      {selectedCompound && <CompoundDetailPanel compound={selectedCompound} />}
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

function ResultPreview({ rows, selectedCompoundKey, onSelectCompound }) {
  const hasSyntheticAccessibility = rows.some(
    (row) => row.sa_score !== undefined || row.synthetic_feasibility_category !== undefined,
  );
  const hasDockingScore = rows.some(
    (row) => row.docking_score !== undefined && row.docking_status !== 'not_provided',
  );

  return (
    <Box sx={{ overflowX: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Table size="small" aria-label="Prioritization result preview">
        <TableHead>
          <TableRow>
            <TableCell>Molecule</TableCell>
            <TableCell>Valid</TableCell>
            <TableCell>Score</TableCell>
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

function CompoundDetailPanel({ compound }) {
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
            <Chip
              label={compound.valid_molecule === false ? 'Invalid molecule' : 'Valid molecule'}
              color={compound.valid_molecule === false ? 'warning' : 'success'}
              variant="outlined"
            />
          </Stack>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' },
              gap: 2,
            }}
          >
            <DetailTable
              title="Identity and Score"
              rows={[
                ['Molecule ID', compound.molecule_id],
                ['Input SMILES', compound.input_smiles],
                ['Canonical SMILES', compound.canonical_smiles],
                ['Valid molecule', compound.valid_molecule],
                ['Priority score', compound.priority_score],
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
        description="Inspect the app-managed BBB model cache, latest run model status, and planned public lookup source state."
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
            PubChem, ChEMBL, and SureChEMBL are planned, not active, in this MolOptima build.
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

function readableError(error) {
  if (error instanceof TypeError) {
    return 'Could not reach the FastAPI backend at http://localhost:8000.';
  }
  return error instanceof Error ? error.message : 'Request failed.';
}

export default App;
