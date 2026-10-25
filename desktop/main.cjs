const { app, BrowserWindow, ipcMain, Menu, nativeImage, powerMonitor, screen, session, shell, Tray } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { DEFAULT_SETTINGS, validateSettings, idleAction } = require('./idle.cjs');
const { loadEdition, editionIdentity, editionQuery, isEditionPage } = require('./edition.cjs');

const edition = loadEdition({ isPackaged: app.isPackaged, desktopDirectory: __dirname });
const identity = editionIdentity(edition, app.getPath('appData'));
// Set all edition-specific paths before Chromium initializes or the singleton lock
// is acquired, so two asset editions keep independent sessions and preferences.
app.setName(identity.productName);
fs.mkdirSync(identity.sessionData, { recursive: true });
app.setPath('userData', identity.userData);
app.setPath('sessionData', identity.sessionData);
if (process.platform === 'win32') app.setAppUserModelId(identity.appId);

const index = path.join(__dirname, '../dist/index.html');
const pageURL = pathToFileURL(index).href;
const allowedOrigins = new Set(['https://bloxwap.app', 'https://github.com', 'https://bloxwap.github.io']);
let settings = { ...DEFAULT_SETTINGS };
let mainWindow = null;
let tray = null;
let idleWindows = [];
let previewing = false;
let quitting = false;
let locked = false;
let cooldownUntil = 0;
let timer;

function settingsFile() { return path.join(app.getPath('userData'), 'preferences.json'); }
function trusted(event) { return Boolean(event.senderFrame) && event.senderFrame === event.sender.mainFrame && isEditionPage(event.senderFrame.url, pageURL, edition); }

function openExternal(url) {
  try {
    const parsed = new URL(url);
    if (allowedOrigins.has(parsed.origin)) void shell.openExternal(parsed.href);
  } catch { /* Ignore malformed navigation. */ }
}

function makeWindow(options = {}) {
  const window = new BrowserWindow({
    width: 1440, height: 900, minWidth: 360, minHeight: 580,
    backgroundColor: '#0a0a0a', title: identity.productName, show: false,
    autoHideMenuBar: true,
    ...options,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isEditionPage(url, pageURL, edition)) { event.preventDefault(); openExternal(url); }
  });
  return window;
}

function showMain() {
  dismissIdle();
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); return; }
  mainWindow = makeWindow();
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('close', (event) => {
    if (!quitting && settings.idleEnabled && tray) { event.preventDefault(); mainWindow.hide(); }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  void mainWindow.loadFile(index, { query: editionQuery(edition) });
}

function dismissIdle() {
  if (!idleWindows.length) return;
  const closing = idleWindows;
  idleWindows = [];
  previewing = false;
  cooldownUntil = Date.now() + 10_000;
  closing.forEach((window) => { if (!window.isDestroyed()) window.destroy(); });
}

function startIdle(preview = false) {
  if (locked || idleWindows.length) return;
  previewing = preview;
  for (const display of screen.getAllDisplays()) {
    const window = makeWindow({ ...display.bounds, minWidth: 0, minHeight: 0, frame: false, fullscreen: true, skipTaskbar: true });
    idleWindows.push(window);
    window.once('ready-to-show', () => { if (!window.isDestroyed() && !locked) window.show(); });
    window.on('close', () => { if (!quitting) setImmediate(dismissIdle); });
    void window.loadFile(index, { query: editionQuery(edition, true) });
  }
}

function updateTray() {
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: `Open ${identity.productName}`, click: showMain },
    { label: `Preview ${edition.name}`, click: () => startIdle(true) },
    { type: 'separator' },
    { label: `Start after ${settings.idleMinutes} minutes idle`, type: 'checkbox', checked: settings.idleEnabled, click: (item) => {
      try { saveSettings({ ...settings, idleEnabled: item.checked }); } catch { showMain(); }
    } },
    { label: 'Preferences…', click: showMain },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

function saveSettings(next) {
  const validated = validateSettings(next);
  if (validated.idleEnabled && !tray) throw new Error('A system tray is required for automatic activation');
  const file = settingsFile();
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(validated), { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
  settings = validated;
  if (!settings.idleEnabled) dismissIdle();
  updateTray();
  return { ...settings };
}

if (!app.requestSingleInstanceLock({ asset: edition.symbol })) app.quit();
else {
  app.on('second-instance', showMain);
  app.whenReady().then(() => {
    try { settings = validateSettings(JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))); } catch { /* First launch uses defaults. */ }
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
      callback(permission === 'screen-wake-lock' && isEditionPage(contents.getURL(), pageURL, edition));
    });
    session.defaultSession.setPermissionCheckHandler((contents, permission) => permission === 'screen-wake-lock' && Boolean(contents) && isEditionPage(contents.getURL(), pageURL, edition));
    try {
      const icon = nativeImage.createFromPath(path.join(__dirname, '../dist/trayTemplate.png'));
      if (process.platform === 'darwin') icon.setTemplateImage(true);
      tray = new Tray(icon);
      tray.setToolTip(identity.productName);
      tray.on('double-click', showMain);
      updateTray();
    } catch { settings.idleEnabled = false; }

    ipcMain.handle('screensaver:get-settings', (event) => {
      if (!trusted(event)) throw new Error('Untrusted window');
      return { ...settings };
    });
    ipcMain.handle('screensaver:set-settings', (event, next) => {
      if (!trusted(event)) throw new Error('Untrusted window');
      return saveSettings(next);
    });
    ipcMain.on('screensaver:dismiss', (event) => { if (trusted(event)) dismissIdle(); });

    timer = setInterval(() => {
      if (previewing) return;
      const action = idleAction({ enabled: settings.idleEnabled, active: idleWindows.length > 0, locked,
        idleState: powerMonitor.getSystemIdleState(settings.idleMinutes * 60), idleSeconds: powerMonitor.getSystemIdleTime(),
        threshold: settings.idleMinutes * 60, cooldown: Date.now() < cooldownUntil });
      if (action === 'start') startIdle();
      else if (action === 'dismiss') dismissIdle();
    }, 1_000);
    powerMonitor.on('lock-screen', () => { locked = true; dismissIdle(); });
    powerMonitor.on('unlock-screen', () => { locked = false; cooldownUntil = Date.now() + 10_000; });
    powerMonitor.on('suspend', () => { locked = true; dismissIdle(); });
    powerMonitor.on('resume', () => { locked = false; cooldownUntil = Date.now() + 10_000; });
    screen.on('display-removed', dismissIdle);
    app.on('activate', showMain);
    showMain();
  });
  app.on('window-all-closed', () => { if (!settings.idleEnabled || !tray) app.quit(); });
  app.on('before-quit', () => { quitting = true; clearInterval(timer); dismissIdle(); tray?.destroy(); });
}
