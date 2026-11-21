'use strict';
/* UI smoke test: loads index.html + app.js in jsdom with a stubbed IPC bridge and clicks through the flows. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8')
  .replace(/<script[^>]*><\/script>/g, '')
  .replace(/<meta[^>]*Content-Security-Policy[^>]*>/g, '');

const vm = require('vm');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;
const { document } = window;

window.refreshy = {
  platform: async () => ({ platform: 'win32' }),
  theme: async () => ({ dark: 'dark' } && (await undefined, 'dark')),
  machine: async () => ({ host: 'TEST-PC', platform: 'win32', wingetAvailable: true }),
  drives: async () => ({ ok: true, drives: [
    { path: 'E:\\', label: 'Backup drive', kind: 'removable', freeBytes: 64e9, totalBytes: 128e9, recommended: true },
    { path: 'C:\\', label: 'System', kind: 'fixed', freeBytes: 12e9, totalBytes: 476e9, recommended: false }
  ] }),
  dataItems: async () => [
    { id: 'appdata-roaming', label: 'AppData\\Roaming', hint: 'settings' },
    { id: 'appdata-local', label: 'AppData\\Local', hint: 'big' },
    { id: 'desktop', label: 'Desktop', hint: '' },
    { id: 'documents', label: 'Documents', hint: '' }
  ],
  startBackup: async () => ({ ok: true }),
  cancelBackup: () => {},
  onBackupProgress: (cb) => { window.__bpCb = cb; },
  chooseBackup: async () => ({ ok: true, backupPath: 'E:\\Refreshy-TEST-PC-2026-01-01',
    manifest: { format: 'refreshy-backup', created: '2026-01-01T00:00:00Z', machine: { host: 'TEST-PC' },
      targetOs: { id: 'win11', label: 'Windows 11' }, apps: { source: 'winget', packages: [], manual: [
        { name: 'Sketchy App', version: '1.2', publisher: 'Sky' },
        { name: 'ExoticTool', version: null, publisher: 'Indie' }
      ] }, data: [] },
    packages: [{ id: 'Git.Git', version: '2.50.0', selected: true }],
    manualApps: [
      { name: 'Sketchy App', version: '1.2', publisher: 'Sky', matchedId: null, status: 'pending' },
      { name: 'ExoticTool', version: null, publisher: 'Indie', matchedId: null, status: 'pending' }
    ],
    dataEntries: [], warning: null, currentOs: 'Windows' }),
  generateInstaller: async () => ({ ok: true, file: 'x', count: 1 }),
  installAll: () => {},
  cancelInstall: () => {},
  onInstallProgress: (cb) => { window.__ipCb = cb; },
  importData: () => {},
  onImportProgress: (cb) => { window.__impCb = cb; },
  onAiProgress: (cb) => { window.__aiCb = cb; },
  matchApps: async (apps) => ({ ok: true, matches: apps.map((m) => ({ name: m.name, id: m.name === 'Sketchy App' ? 'Mock.SketchyApp' : null })) }),
  resolveInstallers: async (_backupPath, apps) => ({ ok: true, resolved: apps.map((m) => ({ name: m.name, file: 'x.exe', failed: false })), installers: apps.map((m) => ({ name: m.name, file: 'x.exe', args: '/S' })) }),
  settings: async () => ({ ready: true }),
  saveSettings: async () => ({ ok: true, ready: true }),
  chooseDirectory: async () => ({})
};

let failures = 0;
function ok(cond, name, extra) {
  if (cond) console.log('PASS ' + name);
  else { failures++; console.log('FAIL ' + name + (extra ? ' — ' + extra : '')); }
}
const active = () => document.querySelector('.view.active');

async function main() {
  const appCode = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
  try {
    vm.runInContext(appCode, dom.getInternalVMContext(), { filename: 'app.js' });
  } catch (err) {
    console.log('FATAL: app.js top-level threw: ' + err.stack);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 30)); // let async inits settle

  ok(active().id === 'view-home', 'home visible at start');
  ok(!document.getElementById('osGrid').children.length === false, 'OS tiles built');

  // home → backup
  document.getElementById('btnStartBackup').click();
  ok(active().id === 'view-os', 'clicking "Back up this PC" opens OS picker');
  ok(!document.getElementById('osContinue').disabled === false, 'continue disabled until OS chosen');

  // pick Windows 11
  const tile = document.querySelector('.os-tile[data-os="win11"]');
  tile.click();
  ok(tile.classList.contains('selected'), 'OS tile selects');
  ok(!document.getElementById('osContinue').disabled, 'continue enabled after OS selection');
  ok(!document.getElementById('osDescription').hidden, 'OS description shown');

  document.getElementById('osContinue').click();
  ok(active().id === 'view-dest', 'continue opens drive picker');

  await new Promise((r) => setTimeout(r, 20));
  const drives = document.querySelectorAll('.drive');
  ok(drives.length === 2, 'drives rendered: ' + drives.length);
  drives[0].click();
  ok(!document.getElementById('destContinue').disabled, 'continue enabled after drive pick');

  document.getElementById('destContinue').click();
  ok(active().id === 'view-content', 'continue opens content picker');

  await new Promise((r) => setTimeout(r, 20));
  const switches = document.querySelectorAll('#dataItems .switch');
  ok(switches.length === 4, 'data item switches rendered: ' + switches.length);

  document.getElementById('contentContinue').click();
  ok(active().id === 'view-runbackup', 'continue starts backup run view');
  ok(typeof window.__bpCb === 'function', 'backup progress subscribed');

  window.__bpCb({ phase: 'data', task: 'Backing up AppData\\Local', taskBytes: { l: 100 }, files: 3, skippedCount: 1 });
  ok(document.getElementById('backupPercent').textContent !== '0%', 'progress updates percent');
  window.__bpCb({ phase: 'done', destination: 'E:\\out', manifest: { apps: { packages: [{}] }, totalBytes: 100 }, _final: { destination: 'E:\\out', manifest: { apps: { packages: [{}] }, totalBytes: 100 } } });
  await new Promise((r) => setTimeout(r, 800));
  ok(active().id === 'view-donebackup', 'done view after backup completes');

  // restore flow
  document.getElementById('btnDoneHome').click();
  ok(active().id === 'view-home', 'done returns home');
  document.getElementById('btnStartRestore').click();
  ok(active().id === 'view-restorepick', 'restore card opens pick view');
  document.getElementById('btnChooseBackup').click();
  await new Promise((r) => setTimeout(r, 20));
  ok(active().id === 'view-restorereview', 'backup folder choice opens review');

  ok(!document.getElementById('manualAppsBlock').hidden, 'manual (non-winget) apps block visible');
  const manualChips = document.querySelectorAll('#manualChips .chip');
  ok(manualChips.length === 2, 'manual chips rendered: ' + manualChips.length);
  document.getElementById('btnMatchApps').click();
  await new Promise((r) => setTimeout(r, 30));
  ok(document.querySelector('#manualChips .chip .chip-state.merged'), 'auto-match marks app as merged');
  const pkChips = document.querySelectorAll('#packagesList .chip');
  ok(pkChips.length === 2, 'matched app joined winget chips: ' + pkChips.length);

  document.getElementById('btnAiResolve').click();
  await new Promise((r) => setTimeout(r, 30));
  ok(document.querySelector('#manualChips .chip .chip-state.ok'), 'AI resolve fetches installer (ok state)');

  document.getElementById('btnRestoreAll').click();
  ok(active().id === 'view-restorerun', 'restore everything opens run view');

  console.log(failures ? `\n${failures} FAILURES` : '\nALL UI SMOKE TESTS PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
