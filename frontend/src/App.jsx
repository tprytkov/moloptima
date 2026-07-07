import { useEffect, useMemo, useState } from 'react';
import {
  AppBar,
  Box,
  Chip,
  CssBaseline,
  Divider,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
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
  const health = useBackendHealth();

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: '100vh', display: 'flex', bgcolor: 'background.default' }}>
        <Sidebar activeItem={activeItem} onSelect={setActiveItem} />
        <Box component="main" sx={{ flexGrow: 1, minWidth: 0 }}>
          <AppHeader />
          <Box sx={{ px: { xs: 2, md: 4 }, py: 3, maxWidth: 1180 }}>
            <DashboardPage health={health} activeItem={activeItem} />
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

function DashboardPage({ health, activeItem }) {
  const isDashboard = activeItem === 'Dashboard';

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
        const response = await fetch('http://localhost:8000/health');
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

export default App;
