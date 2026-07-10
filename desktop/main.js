const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const backendUrl = process.env.MOLOPTIMA_BACKEND_URL || 'http://127.0.0.1:8000';
const frontendUrl = process.env.MOLOPTIMA_FRONTEND_URL || 'http://127.0.0.1:5173';
const pythonExecutable = process.env.MOLOPTIMA_PYTHON || 'python';
const startFrontend =
  !app.isPackaged && process.env.MOLOPTIMA_START_FRONTEND !== '0' && !process.env.MOLOPTIMA_FRONTEND_URL;

let backendProcess = null;
let frontendProcess = null;
let mainWindow = null;

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
  try {
    await startMolOptima();
  } catch (error) {
    console.error(error);
    dialog.showErrorBox(
      'MolOptima could not start',
      `${error.message}\n\nCheck MOLOPTIMA_PYTHON, the Conda environment, and whether ports 8000 or 5173 are already in use.`,
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
