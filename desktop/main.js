const { app, BrowserWindow, dialog, Menu } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
  classifyBackendTermination,
  createSafeLogger,
  stopChildProcess,
} = require('./lifecycle.js');

const examplePythonPath = 'C:\\path\\to\\conda-env\\python.exe';
const backendUrl = process.env.MOLOPTIMA_BACKEND_URL || 'http://127.0.0.1:8000';
const frontendUrl = process.env.MOLOPTIMA_FRONTEND_URL || 'http://127.0.0.1:5173';
const startFrontend =
  !app.isPackaged && process.env.MOLOPTIMA_START_FRONTEND !== '0' && !process.env.MOLOPTIMA_FRONTEND_URL;

let backendProcess = null;
let frontendProcess = null;
let mainWindow = null;
let frontendLoaded = false;
let backendShutdownExpected = false;
let lastBackendStderr = '';
let backendLifecycle = {
  status: 'not_started', expected: false, code: null, signal: null, summary: 'backend not started',
};
const lifecycleLog = createSafeLogger();

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

function getBundledPythonPath() {
  const executableName = process.platform === 'win32' ? 'python.exe' : 'python';
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'runtime', 'python', executableName);
  }
  return path.join(__dirname, 'runtime', 'python', executableName);
}

function resolvePythonRuntime() {
  const envPython = process.env.MOLOPTIMA_PYTHON?.trim();
  const bundledPython = getBundledPythonPath();

  if (envPython) {
    return {
      executable: envPython,
      source: 'environment variable',
      envOverridesBundled: fs.existsSync(bundledPython) ? 'yes' : 'no bundled runtime present',
      bundledPath: bundledPython,
      bundledExists: fs.existsSync(bundledPython),
      available: fs.existsSync(envPython),
      commandPreview: `${envPython} -m uvicorn backend.main:app --host 127.0.0.1 --port 8000`,
      error: fs.existsSync(envPython) ? '' : `MOLOPTIMA_PYTHON does not exist: ${envPython}`,
    };
  }

  if (fs.existsSync(bundledPython)) {
    return {
      executable: bundledPython,
      source: 'bundled runtime',
      envOverridesBundled: 'not overridden',
      bundledPath: bundledPython,
      bundledExists: true,
      available: true,
      commandPreview: `${bundledPython} -m uvicorn backend.main:app --host 127.0.0.1 --port 8000`,
      error: '',
    };
  }

  if (!app.isPackaged) {
    return {
      executable: 'python',
      source: 'PATH fallback',
      envOverridesBundled: 'not overridden',
      bundledPath: bundledPython,
      bundledExists: false,
      available: true,
      commandPreview: 'python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000',
      error: '',
    };
  }

  return {
    executable: '',
    source: 'unavailable',
    envOverridesBundled: 'not overridden',
    bundledPath: bundledPython,
    bundledExists: false,
    available: false,
    commandPreview: '(unavailable) -m uvicorn backend.main:app --host 127.0.0.1 --port 8000',
    error: 'No Python runtime is available. Set MOLOPTIMA_PYTHON or provide a bundled runtime.',
  };
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
  const pythonRuntime = resolvePythonRuntime();
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
    backendLifecycle: backendLifecycle.summary,
    lastBackendStderr: lastBackendStderr || 'none recorded',
    pythonSource: pythonRuntime.source,
    pythonPath: pythonRuntime.executable || 'unavailable',
    pythonPathExists: pythonConfigured ? (pythonExists ? 'yes' : 'no') : 'not set',
    bundledRuntimePath: pythonRuntime.bundledPath,
    bundledRuntimeExists: pythonRuntime.bundledExists ? 'yes' : 'no',
    moloptimaPythonOverridesBundled: pythonRuntime.envOverridesBundled,
    backendStartupCommand: pythonRuntime.commandPreview,
    projectRoot: getProjectRoot(),
    backendUrl,
    frontendUrl: process.env.MOLOPTIMA_FRONTEND_URL || (app.isPackaged ? packagedFrontendPath : frontendUrl),
    appDataFolders: appDataFolders.map((folderPath) => `${folderPath}: ${pathStatus(folderPath)}`),
    bbbCachePath: getBbbCacheRoot(),
    bbbCacheStatus: pathStatus(getBbbCacheRoot()),
    recentLifecycleLogs: lifecycleLog.recent().slice(-20),
  };
}

function formatDiagnostics(diagnostics) {
  return [
    `Package mode: ${diagnostics.packageMode}`,
    `Frontend mode: ${diagnostics.frontendMode}`,
    `Frontend loaded: ${diagnostics.frontendLoaded}`,
    `Backend health: ${diagnostics.backendHealth}`,
    `Backend process: ${diagnostics.backendProcess}`,
    `Backend lifecycle: ${diagnostics.backendLifecycle}`,
    `Last backend stderr: ${diagnostics.lastBackendStderr}`,
    `Python source selected: ${diagnostics.pythonSource}`,
    `Python path: ${diagnostics.pythonPath}`,
    `Python path exists: ${diagnostics.pythonPathExists}`,
    `Bundled runtime path checked: ${diagnostics.bundledRuntimePath}`,
    `Bundled runtime exists: ${diagnostics.bundledRuntimeExists}`,
    `MOLOPTIMA_PYTHON overrides bundled runtime: ${diagnostics.moloptimaPythonOverridesBundled}`,
    `Backend startup command: ${diagnostics.backendStartupCommand}`,
    `Project root: ${diagnostics.projectRoot}`,
    `Backend URL: ${diagnostics.backendUrl}`,
    `Frontend target: ${diagnostics.frontendUrl}`,
    '',
    'App data folders:',
    ...diagnostics.appDataFolders.map((line) => `- ${line}`),
    '',
    `BBB cache path: ${diagnostics.bbbCachePath}`,
    `BBB cache status: ${diagnostics.bbbCacheStatus}`,
    '',
    'Recent lifecycle logs:',
    ...diagnostics.recentLifecycleLogs.map((entry) => `- ${entry.level}: ${entry.message}`),
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
    'MolOptima requires a Python/RDKit runtime for the FastAPI backend.',
    '',
    'Resolution order: MOLOPTIMA_PYTHON, bundled runtime, then PATH fallback in development mode.',
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
  const { onStdout, onStderr, onError, ...spawnOptions } = options;
  const child = spawn(command, args, {
    cwd: getProjectRoot(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    ...spawnOptions,
  });

  child.stdout.on('data', (data) => {
    const message = data.toString().trimEnd();
    onStdout?.(message);
    lifecycleLog.info(`[${command}] ${message}`);
  });
  child.stderr.on('data', (data) => {
    const message = data.toString().trimEnd();
    onStderr?.(message);
    lifecycleLog.error(`[${command}] ${message}`);
  });
  child.on('error', (error) => {
    onError?.(error);
    lifecycleLog.error(`Failed to run ${command}: ${error.stack || error.message}`);
  });

  return child;
}

function startBackend() {
  const pythonRuntime = resolvePythonRuntime();
  if (!pythonRuntime.available) {
    throw new Error(pythonRuntime.error);
  }

  backendShutdownExpected = false;
  backendLifecycle = {
    status: 'starting', expected: false, code: null, signal: null, summary: 'backend starting',
  };
  const child = spawnProcess(pythonRuntime.executable, [
    '-m',
    'uvicorn',
    'backend.main:app',
    '--host',
    '127.0.0.1',
    '--port',
    '8000',
  ], {
    onStderr: (message) => {
      lastBackendStderr = message.slice(-2000);
    },
    onError: (error) => {
      backendLifecycle = {
        status: 'failed_to_start', expected: false, code: error.code || null, signal: null,
        summary: `backend process error; code=${error.code || null}; message=${error.message}`,
      };
    },
  });
  backendProcess = child;
  backendLifecycle = {
    status: 'running', expected: false, code: null, signal: null,
    summary: `backend running; pid=${child.pid}`,
  };

  child.once('exit', (code, signal) => {
    const expected = backendShutdownExpected || Boolean(app.isQuitting);
    backendLifecycle = classifyBackendTermination({ code, signal, expected });
    if (backendProcess === child) {
      backendProcess = null;
    }
    if (!expected) {
      lifecycleLog.error(`MolOptima backend exited unexpectedly. code=${code} signal=${signal}`);
    } else {
      lifecycleLog.info(`MolOptima backend stopped during application shutdown. code=${code} signal=${signal}`);
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
    lifecycleLog.error(error);
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
  backendShutdownExpected = true;
  stopChildProcess(backendProcess);
  stopChildProcess(frontendProcess);
});

app.on('window-all-closed', () => {
  app.quit();
});
