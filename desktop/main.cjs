const { app, BrowserWindow, Menu, shell, session } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { startServer } = require('./server.cjs');

const WEB_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'desktop-web')
  : path.join(__dirname, '..', 'desktop-web');

const ICON = app.isPackaged
  ? path.join(process.resourcesPath, 'app-icon.ico')
  : path.join(__dirname, 'build', 'icon.ico');

const SCRAPER_BIN = app.isPackaged
  ? path.join(process.resourcesPath, process.platform === 'win32' ? 'stream-scraper.exe' : 'stream-scraper')
  : path.join(
      __dirname,
      '..',
      'stream-scraper',
      process.platform === 'win32' ? 'stream-scraper-windows-amd64.exe' : 'stream-scraper',
    );

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address();
      probe.close(err => (err ? reject(err) : resolve(addr.port)));
    });
  });
}

function probeHealth(url) {
  return new Promise(resolve => {
    const req = http.get(`${url}/healthz`, { timeout: 600 }, res => {
      let body = '';
      res.on('data', chunk => {
        body += chunk;
      });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          resolve(false);
          return;
        }
        try {
          const parsed = JSON.parse(body);
          resolve(parsed && parsed.status === 'ok');
        } catch {
          resolve(false);
        }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function startScraper() {
  if (!fs.existsSync(SCRAPER_BIN)) {
    console.warn(`stream-scraper binary not found at ${SCRAPER_BIN}`);
    return null;
  }
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let exited = false;

  const child = spawn(SCRAPER_BIN, [], {
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      PUBLIC_BASE_URL: baseUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout?.on('data', chunk => {
    const text = chunk.toString().trim();
    if (text) console.log(`[stream-scraper] ${text}`);
  });
  child.stderr?.on('data', chunk => {
    const text = chunk.toString().trim();
    if (text) console.warn(`[stream-scraper] ${text}`);
  });
  child.on('exit', (code, signal) => {
    exited = true;
    if (code !== null && code !== 0) {
      console.warn(`[stream-scraper] exited with code ${code} (${signal ?? 'none'})`);
    }
  });

  const stop = () => {
    if (!exited && !child.killed) {
      try {
        child.kill();
      } catch {}
    }
  };

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && !exited) {
    if (await probeHealth(baseUrl)) {
      console.log(`stream-scraper listening -> ${baseUrl}`);
      return { url: baseUrl, stop };
    }
    await new Promise(done => setTimeout(done, 150));
  }

  console.warn('stream-scraper did not become healthy before timeout');
  stop();
  return null;
}

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
  const scraper = await startScraper().catch(err => {
    console.warn('stream-scraper startup failed:', err);
    return null;
  });
  let server;
  try {
    server = await startServer(WEB_ROOT, { scraperUrl: scraper ? scraper.url : '' });
  } catch (err) {
    scraper?.stop();
    throw err;
  }
  console.log(`biralotv desktop -> ${server.url}`);

  app.on('before-quit', () => {
    scraper?.stop();
    void server.close();
  });

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
