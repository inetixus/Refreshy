'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const listeners = {};

contextBridge.exposeInMainWorld('refreshy', {
  platform: () => ipcRenderer.invoke('app:getPlatform'),
  theme: () => ipcRenderer.invoke('app:getTheme'),
  machine: () => ipcRenderer.invoke('app:getMachineInfo'),
  drives: () => ipcRenderer.invoke('drives:list'),
  dataItems: () => ipcRenderer.invoke('backup:dataItems'),
  startBackup: (options) => ipcRenderer.invoke('backup:start', options),
  cancelBackup: () => ipcRenderer.send('backup:cancel'),
  onBackupProgress: (cb) => {
    listeners.onBackupProgress = cb;
    ipcRenderer.on('backup:progress', (_e, p) => cb(p));
  },
  chooseBackup: () => ipcRenderer.invoke('restore:selectBackup'),
  estimateSize: (entries) => ipcRenderer.invoke('restore:estimateSize', entries),
  generateInstaller: (backupPath, packages, installers, manualApps) => ipcRenderer.invoke('restore:generateInstaller', { backupPath, packages, installers, manualApps }),
  settings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (pick) => ipcRenderer.invoke('settings:set', pick),
  matchApps: (manualApps) => ipcRenderer.invoke('winget:matchApps', manualApps),
  resolveInstallers: (backupPath, apps) => ipcRenderer.invoke('ai:resolveInstallers', { backupPath, apps }),
  onAiProgress: (cb) => ipcRenderer.on('ai:progress', (_e, p) => cb(p)),
  installAll: (backupPath, packages) => ipcRenderer.send('restore:installAll', { backupPath, packages }),
  cancelInstall: () => ipcRenderer.send('restore:cancelInstall'),
  onInstallProgress: (cb) => {
    listeners.onInstallProgress = cb;
    ipcRenderer.on('install:progress', (_e, p) => cb(p));
  },
  importData: (backupPath, dataEntries) => ipcRenderer.send('restore:importData', { backupPath, dataEntries }),
  onImportProgress: (cb) => {
    listeners.onImportProgress = cb;
    ipcRenderer.on('import:progress', (_e, p) => cb(p));
  },
  chooseDirectory: (opts) => ipcRenderer.invoke('dialog:chooseDirectory', opts),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  showItemInFolder: (p) => ipcRenderer.invoke('shell:showItemInFolder', p),
  minimize: () => ipcRenderer.send('app:minimize'),
  maximize: () => ipcRenderer.send('app:maximize'),
  closeWindow: () => ipcRenderer.send('app:close')
});
