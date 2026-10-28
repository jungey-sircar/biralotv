const { app, BrowserWindow, Menu, shell, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./server.cjs');

const WEB_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'desktop-web')
  : path.join(__dirname, '..', 'desktop-web');

const ICON = app.isPackaged
  ? path.join(process.resourcesPath, 'app-icon.ico')
  : path.join(__dirname, 'build', 'icon.ico');

function buildMenu(win) {
  const template = [
    {
      label: 'Playback',
      submenu: [
        { label: 'Home', accelerator: 'CmdOrCtrl+H', click: () => win.loadURL(win.__url) },
        { label: 'Back', accelerator: 'Alt+Left', click: () => win.webContents.goBack() },
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => win.reload() },
        { type: 'separator' },
        { role: 'quit', label: 'Quit biralotv' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen', label: 'Full screen' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  if (!fs.existsSync(path.join(WEB_ROOT, 'index.html'))) {
    console.error(`No web build at ${WEB_ROOT}. Run: npm run desktop:export`);
    app.quit();
    return;
  }
  const server = await startServer(WEB_ROOT);
  console.log(`biralotv desktop -> ${server.url}`);

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 880,
    minHeight: 520,
    backgroundColor: '#08080a',
    icon: fs.existsSync(ICON) ? ICON : undefined,
    title: 'biralotv',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.__url = server.url;
  buildMenu(win);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(server.url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(server.url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  await win.loadURL(server.url);
  app.on('before-quit', () => void server.close());
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  // streams start without a click, and Pluto's catalogue API expects a web origin
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

  app
    .whenReady()
    .then(() => {
      session.defaultSession.webRequest.onBeforeSendHeaders(
        { urls: ['*://*.pluto.tv/*'] },
        (details, callback) => {
          details.requestHeaders.Origin = 'https://pluto.tv';
          details.requestHeaders.Referer = 'https://pluto.tv/';
          callback({ requestHeaders: details.requestHeaders });
        }
      );
      return createWindow();
    })
    .catch(err => {
      console.error('desktop startup failed:', err);
      app.quit();
    });

  app.on('window-all-closed', () => app.quit());
}
