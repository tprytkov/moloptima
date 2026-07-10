const { app, BrowserWindow, dialog, Menu } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const examplePythonPath = 'C:\\Users\\tpryt\\miniconda3\\envs\\molecule-intelligence\\python.exe';
const backendUrl = process.env.MOLOPTIMA_BACKEND_URL || 'http://127.0.0.1:8000';
const frontendUrl = process.env.MOLOPTIMA_FRONTEND_URL || 'http://127.0.0.1:5173';
const pythonExecutable = process.env.MOLOPTIMA_PYTHON || 'python';
const startFrontend =
  !app.isPackaged && process.env.MOLOPTIMA_START_FRONTEND !== '0' && !process.env.MOLOPTIMA_FRONTEND_URL;

let backendProcess = null;
let frontendProcess = null;
let mainWindow = null;
let frontendLoaded = false;

function getProjectRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'moloptima-app');
  }
  return path.resolve(__dirname, '..');
}

function getFrontendIndexPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'frontend-dist', 'index.html');
  }
  return path.join(getProjectRoot(), 'frontend', 'dist', 'index.html');
}

function getBbbCacheRoot() {
  return process.env.MOLOPTIMA_BBB_MODEL_CACHE || path.join(getProjectRoot(), 'app_data', 'model_cache', 'huggingface');
}

function pathStatus(targetPath) {
  if (!targetPath) {
    return 'not configured';
  }
  if (!fs.existsSync(targetPath)) {
    return 'missing';
  }
  try {
    fs.accessSync(targetPath, fs.constants.R_OK | fs.constants.W_OK);
    return 'exists and writable';
  } catch (error) {
    return `exists but is not writable: ${error.message}`;
  }
}

async function checkBackendHealth() {
  try {
    const response = await fetch(`${backendUrl}/health`);
    if (!response.ok) {
      return `failed: HTTP ${response.status}`;
    }
    const payload = await response.json().catch(() => ({}));
    return `ok${payload.service ? ` (${payload.service})` : ''}`;
  } catch (error) {
    return `failed: ${error.message}`;
  }
}

async function collectDiagnostics() {
  const appDataPath = path.join(getProjectRoot(), 'app_data');
  const appDataFolders = [
    appDataPath,
    path.join(appDataPath, 'model_cache'),
    path.join(appDataPath, 'model_cache', 'huggingface'),
    path.join(appDataPath, 'public_lookup_cache'),
    path.join(appDataPath, 'manifests'),
  ];

  const pythonConfigured = Boolean(process.env.MOLOPTIMA_PYTHON);
  const pythonExists = pythonConfigured ? fs.existsSync(process.env.MOLOPTIMA_PYTHON) : false;
  const packagedFrontendPath = getFrontendIndexPath();

  return {
    packageMode: app.isPackaged ? 'packaged' : 'development',
    frontendMode:
      app.isPackaged && !process.env.MOLOPTIMA_FRONTEND_URL
        ? `built frontend (${packagedFrontendPath})`
        : `URL frontend (${frontendUrl})`,
    frontendLoaded: frontendLoaded ? 'yes' : 'no',
    backendHealth: await checkBackendHealth(),
    backendProcess: backendProcess && !backendProcess.killed ? `started (pid ${backendProcess.pid})` : 'not running',
    pythonPath: process.env.MOLOPTIMA_PYTHON || 'not set; using python on PATH for development mode',
    pythonPathExists: pythonConfigured ? (pythonExists ? 'yes' : 'no') : 'not set',
    projectRoot: getProjectRoot(),
    backendUrl,
    frontendUrl: process.env.MOLOPTIMA_FRONTEND_URL || (app.isPackaged ? packagedFrontendPath : frontendUrl),
    appDataFolders: appDataFolders.map((folderPath) => `${folderPath}: ${pathStatus(folderPath)}`),
    bbbCachePath: getBbbCacheRoot(),
    bbbCacheStatus: pathStatus(getBbbCacheRoot()),
  };
}

function formatDiagnostics(diagnostics) {
  return [
    `Package mode: ${diagnostics.packageMode}`,
    `Frontend mode: ${diagnostics.frontendMode}`,
    `Frontend loaded: ${diagnostics.frontendLoaded}`,
    `Backend health: ${diagnostics.backendHealth}`,
    `Backend process: ${diagnostics.backendProcess}`,
    `Python path: ${diagnostics.pythonPath}`,
    `Python path exists: ${diagnostics.pythonPathExists}`,
    `Project root: ${diagnostics.projectRoot}`,
    `Backend URL: ${diagnostics.backendUrl}`,
    `Frontend target: ${diagnostics.frontendUrl}`,
    '',
    'App data folders:',
    ...diagnostics.appDataFolders.map((line) => `- ${line}`),
    '',
    `BBB cache path: ${diagnostics.bbbCachePath}`,
    `BBB cache status: ${diagnostics.bbbCacheStatus}`,
  ].join('\n');
}

async function showDiagnosticsDialog() {
  const diagnostics = await collectDiagnostics();
  dialog.showMessageBox(mainWindow, {
    type: diagnostics.backendHealth.startsWith('ok') ? 'info' : 'warning',
    title: 'MolOptima Runtime Diagnostics',
    message: 'MolOptima runtime diagnostics',
    detail: formatDiagnostics(diagnostics),
    buttons: ['OK'],
  });
}

function buildStartupErrorMessage(error, diagnostics) {
  return [
    `Failure: ${error.message}`,
    '',
    'Packaged MolOptima requires a local Conda/Python environment for the FastAPI backend.',
    '',
    'Set MOLOPTIMA_PYTHON to the MolOptima environment python.exe before launching:',
    `set MOLOPTIMA_PYTHON=${examplePythonPath}`,
    '',
    'PowerShell:',
    `$env:MOLOPTIMA_PYTHON = "${examplePythonPath}"`,
    '',
    'Manual backend test:',
    `${process.env.MOLOPTIMA_PYTHON || examplePythonPath} -m uvicorn backend.main:app --host 127.0.0.1 --port 8000`,
    '',
    'Diagnostics:',
    formatDiagnostics(diagnostics),
  ].join('\n');
}

function installMenu() {
  const template = [
    {
      label: 'MolOptima',
      submenu: [
        {
          label: 'Runtime Diagnostics',
          click: () => {
            showDiagnosticsDialog();
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function spawnProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: getProjectRoot(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    ...options,
  });

  child.stdout.on('data', (data) => {
    console.log(`[${command}] ${data.toString().trimEnd()}`);
  });
  child.stderr.on('data', (data) => {
    console.error(`[${command}] ${data.toString().trimEnd()}`);
  });

  return child;
}

function startBackend() {
  if (app.isPackaged && !process.env.MOLOPTIMA_PYTHON) {
    throw new Error(
      'MOLOPTIMA_PYTHON is required for the packaged desktop app. Set it to the MolOptima Conda environment python.exe.',
    );
  }
  if (process.env.MOLOPTIMA_PYTHON && !fs.existsSync(process.env.MOLOPTIMA_PYTHON)) {
    throw new Error(`MOLOPTIMA_PYTHON does not exist: ${process.env.MOLOPTIMA_PYTHON}`);
  }

  backendProcess = spawnProcess(pythonExecutable, [
    '-m',
    'uvicorn',
    'backend.main:app',
    '--host',
    '127.0.0.1',
    '--port',
    '8000',
  ]);

  backendProcess.once('exit', (code, signal) => {
    if (!app.isQuitting) {
      console.error(`MolOptima backend exited unexpectedly. code=${code} signal=${signal}`);
    }
  });
}

function startFrontendDevServer() {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  frontendProcess = spawnProcess(npmCommand, ['run', 'dev', '--', '--host', '127.0.0.1'], {
    cwd: path.join(getProjectRoot(), 'frontend'),
    shell: process.platform === 'win32',
  });
}

async function waitForUrl(url, { timeoutMs = 45000, label = 'service' } = {}) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`${label} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  throw new Error(`${label} did not become available at ${url}. ${lastError?.message || ''}`.trim());
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    title: 'MolOptima',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.once('did-finish-load', () => {
    frontendLoaded = true;
  });

  if (app.isPackaged && !process.env.MOLOPTIMA_FRONTEND_URL) {
    await mainWindow.loadFile(getFrontendIndexPath());
    return;
  }

  await mainWindow.loadURL(frontendUrl);
}

function stopChildProcess(child) {
  if (!child || child.killed) {
    return;
  }

  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }

  child.kill('SIGTERM');
}

async function startMolOptima() {
  startBackend();
  if (startFrontend) {
    startFrontendDevServer();
  }

  await waitForUrl(`${backendUrl}/health`, {
    timeoutMs: Number(process.env.MOLOPTIMA_BACKEND_TIMEOUT_MS || 45000),
    label: 'FastAPI backend',
  });

  if (!app.isPackaged || process.env.MOLOPTIMA_FRONTEND_URL) {
    await waitForUrl(frontendUrl, {
      timeoutMs: Number(process.env.MOLOPTIMA_FRONTEND_TIMEOUT_MS || 45000),
      label: 'React frontend',
    });
  } else if (!fs.existsSync(getFrontendIndexPath())) {
    throw new Error(`Built frontend was not found at ${getFrontendIndexPath()}`);
  }

  await createWindow();
}

app.whenReady().then(async () => {
  installMenu();
  try {
    await startMolOptima();
  } catch (error) {
    console.error(error);
    const diagnostics = await collectDiagnostics();
    dialog.showErrorBox(
      'MolOptima could not start',
      buildStartupErrorMessage(error, diagnostics),
    );
    app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopChildProcess(backendProcess);
  stopChildProcess(frontendProcess);
});

app.on('window-all-closed', () => {
  app.quit();
});
