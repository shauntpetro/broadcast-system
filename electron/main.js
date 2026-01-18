const { app, BrowserWindow, Menu, Tray, shell, dialog, nativeImage } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

// Keep references to prevent garbage collection
let mainWindow = null;
let tray = null;
let serverProcess = null;
let isQuitting = false;

// Server port
const PORT = 8888;
const SERVER_URL = `http://localhost:${PORT}`;

// Get the correct path for resources in dev vs production
function getResourcePath(relativePath) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, relativePath);
  }
  return path.join(__dirname, '..', relativePath);
}

// Get the app root path
function getAppPath() {
  if (app.isPackaged) {
    return path.dirname(app.getPath('exe'));
  }
  return path.join(__dirname, '..');
}

// Check if server is already running
function checkServerRunning() {
  return new Promise((resolve) => {
    const http = require('http');
    const options = {
      hostname: 'localhost',
      port: PORT,
      path: '/api/health',
      method: 'GET',
      timeout: 2000
    };

    const req = http.request(options, (res) => {
      console.log('[Electron] Health check response:', res.statusCode);
      resolve(res.statusCode === 200);
    });

    req.on('error', (err) => {
      console.log('[Electron] Health check error:', err.code);
      resolve(false);
    });

    req.on('timeout', () => {
      console.log('[Electron] Health check timeout');
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

// Start the embedded server
function startServer() {
  return new Promise(async (resolve, reject) => {
    // First check if server is already running
    const alreadyRunning = await checkServerRunning();
    if (alreadyRunning) {
      console.log('[Electron] Server already running on port', PORT);
      resolve();
      return;
    }

    const serverPath = app.isPackaged
      ? path.join(process.resourcesPath, 'app', 'server.js')
      : path.join(__dirname, '..', 'server.js');

    // Set working directory for uploads
    const cwd = app.isPackaged
      ? path.join(process.resourcesPath, 'app')
      : path.join(__dirname, '..');

    console.log('[Electron] Starting server from:', serverPath);
    console.log('[Electron] Working directory:', cwd);

    serverProcess = spawn('node', [serverPath], {
      cwd: cwd,
      env: { ...process.env, PORT: PORT.toString() },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let serverStarted = false;

    serverProcess.stdout.on('data', (data) => {
      console.log('[Server]', data.toString().trim());
      if (!serverStarted && (data.toString().includes('Server Started') || data.toString().includes(`${PORT}`))) {
        serverStarted = true;
        setTimeout(resolve, 500); // Give server time to fully initialize
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error('[Server Error]', data.toString().trim());
    });

    serverProcess.on('error', (err) => {
      console.error('[Electron] Failed to start server:', err);
      reject(err);
    });

    serverProcess.on('exit', (code) => {
      console.log('[Electron] Server exited with code:', code);
      if (!isQuitting && serverStarted) {
        // Restart server if it crashes (but not on initial startup failure)
        setTimeout(() => startServer(), 2000);
      }
    });

    // Timeout fallback
    setTimeout(() => {
      if (!serverStarted) {
        serverStarted = true;
        resolve();
      }
    }, 5000);
  });
}

// Create the main application window
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'SEMEEX Broadcast',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    },
    show: false, // Don't show until ready
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 15, y: 15 }
  });

  // Load the home page
  mainWindow.loadURL(`${SERVER_URL}/index.html`);

  // Show when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Handle window close - hide instead of quit on macOS
  mainWindow.on('close', (event) => {
    if (!isQuitting && process.platform === 'darwin') {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://localhost') || url.startsWith(`http://127.0.0.1`)) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Create the application menu
function createMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Home',
          accelerator: 'CmdOrCtrl+0',
          click: () => openPage('/index.html')
        },
        { type: 'separator' },
        {
          label: 'Control Panel',
          accelerator: 'CmdOrCtrl+1',
          click: () => openPage('/youtube_chat.html')
        },
        {
          label: 'Slideshow',
          accelerator: 'CmdOrCtrl+2',
          click: () => openPage('/slideshow_4.html')
        },
        {
          label: 'Sports Ticker',
          accelerator: 'CmdOrCtrl+3',
          click: () => openPage('/ticker_sports.html')
        },
        { type: 'separator' },
        {
          label: 'Copy OBS Ticker URL',
          click: () => {
            require('electron').clipboard.writeText(`${SERVER_URL}/ticker.html?style=sports`);
            dialog.showMessageBox({ message: 'OBS Ticker URL copied to clipboard!' });
          }
        },
        {
          label: 'Copy OBS Slideshow URL',
          click: () => {
            require('electron').clipboard.writeText(`${SERVER_URL}/slideshow_4.html?obs=1`);
            dialog.showMessageBox({ message: 'OBS Slideshow URL copied to clipboard!' });
          }
        },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin' ? [
          { type: 'separator' },
          { role: 'front' }
        ] : [
          { role: 'close' }
        ])
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'OBS Setup Guide',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: 'OBS Setup',
              message: 'OBS Browser Source Setup',
              detail: `1. Add a Browser Source in OBS\n2. Set URL to:\n   ${SERVER_URL}/ticker.html?style=sports\n   or\n   ${SERVER_URL}/slideshow_4.html?obs=1\n3. Set size to 1920x1080 for slideshow\n4. Check "Shutdown source when not visible"`
            });
          }
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Create system tray
function createTray() {
  // Create a simple tray icon (you can replace with actual icon)
  const iconPath = process.platform === 'darwin'
    ? path.join(__dirname, 'trayIconTemplate.png')
    : path.join(__dirname, 'trayIcon.png');

  // Use a default icon if custom icon doesn't exist
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) {
      throw new Error('Icon not found');
    }
  } catch (e) {
    // Create a simple colored icon as fallback
    trayIcon = nativeImage.createEmpty();
  }

  if (process.platform === 'darwin') {
    trayIcon = trayIcon.resize({ width: 16, height: 16 });
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('SEMEEX Broadcast');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Window',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createMainWindow();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Home',
      click: () => openPage('/index.html')
    },
    {
      label: 'Control Panel',
      click: () => openPage('/youtube_chat.html')
    },
    {
      label: 'Slideshow',
      click: () => openPage('/slideshow_4.html')
    },
    {
      label: 'Sports Ticker',
      click: () => openPage('/ticker_sports.html')
    },
    { type: 'separator' },
    {
      label: `Server: localhost:${PORT}`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    } else {
      createMainWindow();
    }
  });
}

// Open a page in the main window
function openPage(pagePath) {
  if (mainWindow) {
    mainWindow.loadURL(`${SERVER_URL}${pagePath}`);
    mainWindow.show();
    mainWindow.focus();
  } else {
    createMainWindow();
    mainWindow.once('ready-to-show', () => {
      mainWindow.loadURL(`${SERVER_URL}${pagePath}`);
    });
  }
}

// App lifecycle
app.whenReady().then(async () => {
  console.log('[Electron] App ready, starting server...');

  try {
    await startServer();
    console.log('[Electron] Server started successfully');

    createMenu();
    createMainWindow();

    // Create tray after a short delay (helps with icon loading)
    setTimeout(createTray, 1000);
  } catch (err) {
    console.error('[Electron] Failed to start:', err);
    dialog.showErrorBox('Startup Error', `Failed to start server: ${err.message}`);
    app.quit();
  }
});

app.on('activate', () => {
  // macOS: re-create window when dock icon clicked
  if (mainWindow === null) {
    createMainWindow();
  } else {
    mainWindow.show();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  // Kill the server process
  if (serverProcess) {
    console.log('[Electron] Stopping server...');
    serverProcess.kill();
  }
});

app.on('window-all-closed', () => {
  // On macOS, keep app running in tray
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
