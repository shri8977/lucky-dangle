// main.js
//
// Electron main process for Lucky Dangle.
//
// Creates a transparent, frameless, always-on-top, click-through
// window that spans the top of one display. Only the dangle charm
// itself (drawn by the renderer) intercepts mouse input — everything
// else passes straight through to whatever is beneath it.

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  screen,
  dialog,
  nativeImage,
  shell
} = require('electron');
const path = require('path');
const store = require('./config/store');

// ---------------------------------------------------------------------------
// Single instance lock — don't allow two dangles to run at once.
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let win = null;
let tray = null;
let isQuitting = false;

// ---------------------------------------------------------------------------
// Display helpers (basic multi-monitor support)
// ---------------------------------------------------------------------------
function getTargetDisplay() {
  const displays = screen.getAllDisplays();
  const savedId = store.get('displayId');

  const remembered = displays.find((d) => d.id === savedId);
  if (remembered) return remembered;

  // No saved display (first run) or it's no longer connected —
  // use whichever display the cursor is currently on, else primary.
  const atCursor = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  return atCursor || screen.getPrimaryDisplay();
}

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------
function createWindow() {
  const display = getTargetDisplay();
  const { x, y, width } = display.bounds;

  win = new BrowserWindow({
    x,
    y,
    width,
    height: display.bounds.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false
    }
  });

  // 'screen-saver' level keeps it above nearly everything, including
  // most fullscreen apps, without behaving like a kiosk window.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setSkipTaskbar(true);

  // Start fully click-through. The renderer will tell us (via IPC)
  // the moment the cursor is over the charm, and we'll flip this
  // off just long enough to handle that interaction.
  win.setIgnoreMouseEvents(true, { forward: true });

  win.loadFile('index.html');

  win.webContents.on('did-finish-load', () => {
    win.webContents.send('init-state', {
      theme: store.get('theme'),
      xPercent: store.get('xPercent'),
      chainLength: store.get('chainLength'),
      displayWidth: width,
      swingEnabled: store.get('swingEnabled'),
      alwaysOnTop: store.get('alwaysOnTop')
    });
    win.showInactive();
  });

  win.on('closed', () => {
    win = null;
  });

  store.set('displayId', display.id);
}

function recreateWindowOnDisplayChange() {
  if (!win) return;
  const savedId = store.get('displayId');
  const stillExists = screen.getAllDisplays().some((d) => d.id === savedId);
  if (!stillExists) {
    win.close();
    createWindow();
  }
}

// ---------------------------------------------------------------------------
// Tray + context menu (shared template)
// ---------------------------------------------------------------------------
function buildMenuTemplate() {
  const theme = store.get('theme');
  const alwaysOnTop = store.get('alwaysOnTop');
  const swingEnabled = store.get('swingEnabled');
  const launchAtStartup = store.get('launchAtStartup');

  return [
    {
      label: 'Sakthiman',
      type: 'radio',
      checked: theme === 'sakthiman',
      click: () => setTheme('sakthiman')
    },
    {
      label: 'Vinayak',
      type: 'radio',
      checked: theme === 'vinayak',
      click: () => setTheme('vinayak')
    },
    { type: 'separator' },
    {
      label: 'Swing',
      click: () => {
        store.set('swingEnabled', true);
        win?.webContents.send('swing-enabled-changed', true);
        win?.webContents.send('trigger-swing');
      }
    },
    {
      label: 'Stop Swing',
      click: () => {
        store.set('swingEnabled', false);
        win?.webContents.send('swing-enabled-changed', false);
      }
    },
    { type: 'separator' },
    {
      label: 'Launch at Startup',
      type: 'checkbox',
      checked: launchAtStartup,
      click: (menuItem) => {
        store.set('launchAtStartup', menuItem.checked);
        applyLoginItemSetting(menuItem.checked);
      }
    },
    { type: 'separator' },
    {
      label: 'About Lucky Dangle',
      click: showAboutDialog
    },
    {
      label: 'Exit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ];
}

function refreshMenus() {
  if (tray) {
    tray.setContextMenu(Menu.buildFromTemplate(buildMenuTemplate()));
  }
}

function setTheme(theme) {
  store.set('theme', theme);
  win?.webContents.send('theme-changed', theme);
  refreshMenus();
}

function showAboutDialog() {
  dialog.showMessageBox(win, {
    type: 'info',
    title: 'About Lucky Dangle',
    message: 'Lucky Dangle',
    detail:
      'A small devotional charm that hangs from the top of your screen.\n\n' +
      'Version 1.0.0\n' +
      'Right-click the dangle (or the tray icon) any time to change deity, ' +
      'toggle swinging, or adjust settings.',
    buttons: ['OK']
  });
}

function applyLoginItemSetting(enabled) {
  if (process.platform !== 'win32') return;
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args: []
  });
}

function createTray() {
  const trayIconPath = path.join(__dirname, 'assets', 'icons', 'tray-icon.png');
  let image = nativeImage.createFromPath(trayIconPath);
  if (image.isEmpty()) {
    // Fallback so the app never crashes even if the icon is missing.
    image = nativeImage.createEmpty();
  }
  tray = new Tray(image.resize({ width: 16, height: 16 }));
  tray.setToolTip('Lucky Dangle');
  tray.setContextMenu(Menu.buildFromTemplate(buildMenuTemplate()));

  // Left-click on the tray icon also opens the menu (Windows convention).
  tray.on('click', () => {
    tray.popUpContextMenu();
  });
}

// ---------------------------------------------------------------------------
// IPC handlers (renderer <-> main)
// ---------------------------------------------------------------------------
ipcMain.on('set-ignore-mouse-events', (event, ignore) => {
  if (!win) return;
  win.setIgnoreMouseEvents(ignore, { forward: true });
});

ipcMain.on('update-position', (event, xPercent) => {
  const clamped = Math.max(0, Math.min(100, xPercent));
  store.set('xPercent', clamped);
});

ipcMain.on('update-chain-length', (event, chainLength) => {
  const clamped = Math.max(20, Math.min(2000, chainLength));
  store.set('chainLength', clamped);
});

ipcMain.on('show-context-menu', () => {
  if (!win) return;
  Menu.buildFromTemplate(buildMenuTemplate()).popup({ window: win });
});

ipcMain.handle('get-state', () => ({
  theme: store.get('theme'),
  xPercent: store.get('xPercent'),
  chainLength: store.get('chainLength'),
  swingEnabled: store.get('swingEnabled'),
  alwaysOnTop: store.get('alwaysOnTop')
}));

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.on('second-instance', () => {
  // Someone tried to launch a second copy — just bring the dangle
  // to the front by briefly toggling always-on-top.
  if (win) {
    win.setAlwaysOnTop(true, 'screen-saver');
  }
});

app.whenReady().then(() => {
  createWindow();
  createTray();
  applyLoginItemSetting(store.get('launchAtStartup'));

  screen.on('display-added', recreateWindowOnDisplayChange);
  screen.on('display-removed', recreateWindowOnDisplayChange);
  screen.on('display-metrics-changed', recreateWindowOnDisplayChange);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Keep the app alive in the tray on Windows/Linux even if the
  // window is closed for some reason; only fully quit via the
  // tray/context menu "Exit" item.
  if (process.platform !== 'darwin' && isQuitting) {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});
