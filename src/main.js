'use strict';

const { app, BrowserWindow, ipcMain, dialog, nativeTheme, shell } = require('electron');
const path = require('path');
const { listDrives, isWingetAvailable, getMachineInfo } = require('./lib/ps');
const { backup: doBackup, cancelBackup } = require('./lib/backup');
const {
  readBackup, verifyBackupPath, writeInstallerScript, startInstaller,
  restoreData, targetOsWarning, pickRestoreDefaults
} = require('./lib/restore');

let win = null;
let currentInstallChild = null;

function createWindow() {
  const isWin11 = process.platform === 'win32';
  win = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 860,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: isWin11
      ? { color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#ffffff' : '#1a1a1a', height: 44 }
      : false,
    backgroundMaterial: isWin11 ? 'mica' : undefined,
    backgroundColor: isWin11 ? '#00000000' : nativeTheme.shouldUseDarkColors ? '#1c1c1c' : '#f3f3f3',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });
  nativeTheme.on('updated', () => {
    if (win && !win.isDestroyed()) {
      win.setTitleBarOverlay({
        symbolColor: nativeTheme.shouldUseDarkColors ? '#ffffff' : '#1a1a1a'
      }).catch(() => {});
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (currentInstallChild) currentInstallChild.kill();
  app.quit();
});

function emitProgress(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

ipcMain.handle('app:getTheme', () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light');

ipcMain.handle('app:getPlatform', () => ({ platform: process.platform }));

ipcMain.on('app:minimize', () => win && win.minimize());
ipcMain.on('app:maximize', () => win && (win.isMaximized() ? win.unmaximize() : win.maximize()));
ipcMain.on('app:close', () => win && win.close());

ipcMain.handle('app:getMachineInfo', async () => {
  const info = await getMachineInfo();
  const winget = await isWingetAvailable().catch(() => false);
  return { ...info, wingetAvailable: winget };
});

ipcMain.handle('drives:list', async () => {
  try {
    return { ok: true, drives: await listDrives() };
  } catch (err) {
    return { ok: false, error: err.message, drives: [] };
  }
});

ipcMain.handle('backup:dataItems', async () => {
  const items = require('./lib/paths').dataItems();
  return items;
});

ipcMain.handle('backup:start', async (_e, options) => {
  try {
    const result = await doBackup(options, (p) => emitProgress('backup:progress', p));
    emitProgress('backup:progress', {
      phase: 'done',
      destination: result.destination,
      manifest: {
        apps: result.manifest.apps,
        totalBytes: result.manifest.totalBytes
      },
      _final: result
    });
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, cancelled: err.message === 'cancelled', error: err.message };
  }
});

ipcMain.on('backup:cancel', () => cancelBackup());

ipcMain.handle('restore:selectBackup', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose your Refreshy backup',
    properties: ['openDirectory'],
    buttonLabel: 'Use this backup'
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, cancelled: true };
  const p = res.filePaths[0];
  if (!(await verifyBackupPath(p))) {
    return { ok: false, error: 'No manifest.json found in that folder. Pick the top-level Refreshy-... folder on your external drive.' };
  }
  try {
    const info = await readBackup(p);
    const warning = targetOsWarning(info.manifest, process.platform);
    const defaults = await pickRestoreDefaults(info, process.platform);
    return {
      ok: true,
      backupPath: p,
      manifest: info.manifest,
      packages: defaults.packages,
      manualApps: info.manualApps,
      dataEntries: defaults.dataEntries,
      warning,
      currentOs: await require('./lib/restore').currentOsLabel()
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('restore:generateInstaller', async (_e, { backupPath, packages }) => {
  try {
    const chosen = packages.filter((p) => p.selected && p.id);
    if (!chosen.length) return { ok: false, error: 'No apps selected.' };
    const file = await writeInstallerScript(backupPath, chosen, process.platform);
    return { ok: true, file, count: chosen.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.on('restore:installAll', (_e, { backupPath, packages }) => {
  const chosen = packages.filter((p) => p.selected && p.id);
  emitProgress('install:progress', { phase: 'started', count: chosen.length });
  currentInstallChild = startInstaller(
    backupPath,
    chosen,
    (line) => emitProgress('install:progress', { phase: 'line', line }),
    (code) => {
      currentInstallChild = null;
      emitProgress('install:progress', { phase: 'done', code });
    }
  );
});

ipcMain.on('restore:cancelInstall', () => {
  if (currentInstallChild) currentInstallChild.kill();
  currentInstallChild = null;
  emitProgress('install:progress', { phase: 'cancelled' });
});

ipcMain.on('restore:importData', (_e, { backupPath, dataEntries }) => {
  const chosen = dataEntries.filter((d) => d.selected && d.exists);
  (async () => {
    for (const entry of chosen) {
      emitProgress('import:progress', { phase: 'started', label: entry.label });
      try {
        const res = await restoreData({ ...entry, fullPath: path.join(backupPath, entry.folder) });
        emitProgress('import:progress', { phase: 'itemDone', label: entry.label, files: res.files, errors: res.errors.slice(0, 20) });
      } catch (err) {
        emitProgress('import:progress', { phase: 'itemDone', label: entry.label, files: 0, errors: [err.message] });
      }
    }
    emitProgress('import:progress', { phase: 'done' });
  })();
});

ipcMain.handle('restore:estimateSize', async (_e, entries) => {
  const { dirSize } = require('./lib/backup');
  const { buildMatchers } = require('./lib/backup');
  const matchers = buildMatchers(require('./lib/paths').DEFAULT_EXCLUSIONS);
  let total = 0;
  const sizes = {};
  for (const e of entries) {
    if (!e.fullPath) continue;
    const s = await dirSize(e.fullPath, matchers);
    sizes[e.id] = s.bytes;
    total += s.bytes;
  }
  return { total, sizes };
});

ipcMain.handle('shell:openPath', async (_e, p) => shell.openPath(p));
ipcMain.handle('shell:showItemInFolder', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('dialog:chooseDirectory', async (_e, opts = {}) => {
  const res = await dialog.showOpenDialog(win, {
    title: opts.title || 'Choose a folder',
    properties: ['openDirectory'],
    buttonLabel: opts.buttonLabel || 'Select',
    defaultPath: opts.defaultPath
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
});
