'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { getMachineInfo, exportWingetPackages, isWingetAvailable, listInstalledAppsFromRegistry } = require('./ps');
const { DEFAULT_EXCLUSIONS, resolveBase, dataItems } = require('./paths');

function toMatcher(pattern) {
  const esc = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  let re = '';
  let i = 0;
  while (i < esc.length) {
    if (esc[i] === '*') {
      if (esc[i + 1] === '*') {
        if (esc[i + 2] === '/') { re += '(?:[^/\\\\]+/)*'; i += 3; }
        else { re += '.*'; i += 2; }
      } else { re += '[^/\\\\]*'; i += 1; }
    } else if (esc[i] === '?') {
      re += '[^/\\\\]'; i += 1;
    } else {
      re += esc[i]; i += 1;
    }
  }
  return new RegExp(`^${re}$`, 'i');
}

function buildMatchers(patterns) {
  return (patterns || []).map(toMatcher);
}

function isExcluded(relPath, name, matchers) {
  const norm = relPath.split(path.sep).join('/');
  if (matchers.some((m) => m.test(norm) || m.test(`${norm}/**`) || m.test(name))) return true;
  const parts = norm.split('/');
  for (let i = 1; i < parts.length; i++) {
    const prefix = parts.slice(0, i).join('/');
    if (matchers.some((m) => m.test(`${prefix}/**`))) return true;
  }
  return false;
}

async function copyTree(srcDir, destDir, matchers, progress, taskId, depthPrefix = '') {
  const entries = await fsp.readdir(srcDir, { withFileTypes: true });
  await fsp.mkdir(destDir, { recursive: true });
  for (const entry of entries) {
    if (progress.cancelled) throw new Error('cancelled');
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    const rel = depthPrefix ? `${depthPrefix}/${entry.name}` : entry.name;
    if (isExcluded(rel, entry.name, matchers)) {
      progress.skipped.push(rel);
      continue;
    }
    if (entry.isDirectory()) {
      await copyTree(src, dest, matchers, progress, taskId, rel);
    } else if (entry.isFile()) {
      const stat = await fsp.stat(src).catch(() => null);
      if (!stat) continue;
      await fsp.copyFile(src, dest).catch(async (err) => {
        if (err.code === 'EPERM' || err.code === 'EBUSY') {
          progress.skipped.push(rel);
        } else {
          throw err;
        }
      });
      progress.files += 1;
      progress.bytes += stat.size;
      progress.taskBytes[taskId] = (progress.taskBytes[taskId] || 0) + stat.size;
      progress.maybeEmit();
    }
  }
}

async function pruneEmptyDirs(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return true;
  }
  let empty = true;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const removed = await pruneEmptyDirs(path.join(dir, entry.name));
      if (!removed) empty = false;
    } else {
      empty = false;
    }
  }
  if (empty && dir !== path.parse(dir).root) {
    await fsp.rmdir(dir).catch(() => {});
    return true;
  }
  return false;
}

async function dirSize(dir, matchers, depthPrefix = '') {
  let files = 0;
  let bytes = 0;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return { files, bytes };
  }
  for (const entry of entries) {
    const rel = depthPrefix ? `${depthPrefix}/${entry.name}` : entry.name;
    if (isExcluded(rel, entry.name, matchers)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await dirSize(full, matchers, rel);
      files += sub.files;
      bytes += sub.bytes;
    } else if (entry.isFile()) {
      const stat = await fsp.stat(full).catch(() => null);
      if (stat) {
        files += 1;
        bytes += stat.size;
      }
    }
  }
  return { files, bytes };
}

function makeProgressEmitter(onProgress) {
  const progress = {
    cancelled: false,
    files: 0,
    bytes: 0,
    skipped: [],
    taskBytes: {},
    phase: 'preparing',
    task: null,
    _last: 0,
    emit(force) {
      const now = Date.now();
      if (!force && now - this._last < 200) return;
      this._last = now;
      onProgress(this.snapshot());
    },
    maybeEmit() { this.emit(false); },
    snapshot() {
      return {
        phase: this.phase,
        task: this.task,
        files: this.files,
        bytes: this.bytes,
        skippedCount: this.skipped.length,
        taskBytes: { ...this.taskBytes }
      };
    }
  };
  return progress;
}

function backupFolderName(destination, machineInfo) {
  const stamp = new Date().toISOString().slice(0, 10);
  const host = (machineInfo && machineInfo.host ? machineInfo.host : 'PC')
    .replace(/[^\w.-]+/g, '_').slice(0, 32) || 'PC';
  let p = path.join(destination, `Refreshy-${host}-${stamp}`);
  let n = 1;
  while (fs.existsSync(p)) n += 1;
  if (n > 1) p = `${p} (${n})`;
  return p;
}

let activeProgress = null;

function cancelBackup() {
  if (activeProgress) activeProgress.cancelled = true;
}

async function backup(options, onProgress) {
  const progress = makeProgressEmitter(onProgress || (() => {}));
  activeProgress = progress;
  try {
    return await backupInternal(options, progress);
  } finally {
    activeProgress = null;
  }
}

async function backupInternal(options, progress) {
  const machine = await getMachineInfo();
  const dest = path.join(options.destination, backupFolderName(options.destination, machine));
  const appsDir = path.join(dest, 'apps');
  const dataDir = path.join(dest, 'data');
  await fsp.mkdir(appsDir, { recursive: true });

  const matchers = buildMatchers([...DEFAULT_EXCLUSIONS, ...(options.extraExclusions || [])]);

  const manifest = {
    format: 'refreshy-backup',
    formatVersion: 1,
    created: new Date().toISOString(),
    app: { name: 'Refreshy', version: require('../../package.json').version },
    machine,
    targetOs: options.targetOs || null,
    apps: null,
    data: [],
    exclusions: DEFAULT_EXCLUSIONS,
    notes: []
  };

  let wingetAvailable = false;
  if (options.includeApps) {
    progress.phase = 'apps';
    progress.task = 'Exporting your app list (winget)';
    progress.emit(true);
    wingetAvailable = await isWingetAvailable();
    if (wingetAvailable) {
      const wingetFile = path.join(appsDir, 'winget.json');
      try {
        await exportWingetPackages(wingetFile);
        manifest.apps = readWingetExport(wingetFile);
        manifest.apps.file = 'apps/winget.json';
      } catch (err) {
        manifest.notes.push(`winget export failed: ${err.message}`);
      }
    }
    if (!manifest.apps || !(manifest.apps.packages || []).length) {
      const fallback = await listInstalledAppsFromRegistry().catch(() => []);
      manifest.apps = {
        source: 'registry',
        packages: fallback.map((a) => ({ name: a.name, version: a.version, publisher: a.publisher }))
      };
      manifest.apps.file = null;
      if (fallback.length) {
        manifest.notes.push('winget was unavailable or empty; app list captured from registry. You will need to pick installers manually on restore for apps without winget ids.');
      }
    }
    progress.emit(true);
  }

  const wanted = (options.dataSelection || []).filter((s) => s.include);
  const allItems = dataItems();
  for (const sel of wanted) {
    if (progress.cancelled) throw new Error('cancelled');
    const item = allItems.find((i) => i.id === sel.id);
    if (!item) continue;
    const src = resolveBase(item.base);
    if (!src || !fs.existsSync(src)) {
      manifest.notes.push(`Skipped ${item.label}: source not found (${src})`);
      continue;
    }
    progress.phase = 'data';
    progress.task = `Backing up ${item.label} — scanning…`;
    progress.emit(true);
    const est = await dirSize(src, matchers);
    const taskDest = path.join(dataDir, item.id);
    progress.taskBytes[item.id] = 0;
    progress.task = `Backing up ${item.label}`;
    progress.emit(true);
    try {
      await copyTree(src, taskDest, matchers, progress, item.id);
      await pruneEmptyDirs(taskDest);
      const isEmpty = !(await fsp.readdir(taskDest).then((e) => e.length > 0).catch(() => false));
      if (isEmpty) continue;
      manifest.data.push({
        id: item.id,
        label: item.label,
        base: item.base,
        files: est.files,
        bytes: est.bytes,
        folder: `data/${item.id}`
      });
    } catch (err) {
      if (err.message === 'cancelled') throw err;
      manifest.notes.push(`Failed to fully back up ${item.label}: ${err.message}`);
    }
  }

  progress.phase = 'manifest';
  progress.task = 'Writing manifest';
  progress.emit(true);
  manifest.totalBytes = manifest.data.reduce((a, d) => a + (d.bytes || 0), 0);
  manifest.totalFiles = manifest.data.reduce((a, d) => a + (d.files || 0), 0);
  await fsp.writeFile(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  await fsp.writeFile(path.join(dest, 'README.txt'), readmeText(manifest), 'utf8');

  progress.phase = 'done';
  progress.emit(true);
  return { destination: dest, manifest, skipped: progress.skipped.slice(0, 300) };
}

function readWingetExport(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const packages = (raw.Sources || [])
      .flatMap((s) => s.Packages || [])
      .map((p) => ({
        id: p.PackageIdentifier,
        version: (p.PackageVersion && p.PackageVersion !== 'unknown') ? p.PackageVersion : null,
        source: (raw.Sources && raw.Sources[0] && raw.Sources[0].SourceDetails) ? 'winget' : 'winget'
      }));
    return { source: 'winget', packages };
  } catch {
    return null;
  }
}

function readmeText(manifest) {
  return [
    'Refreshy backup',
    '===============',
    '',
    `Created: ${manifest.created}`,
    `Source PC: ${manifest.machine.host} (${manifest.machine.osName || manifest.machine.platform})`,
    `Intended next OS: ${manifest.targetOs ? manifest.targetOs.label : 'not specified'}`,
    `Apps captured: ${manifest.apps ? (manifest.apps.packages || []).length : 0}`,
    `Data folders: ${manifest.data.length} (${(manifest.totalBytes / (1024 * 1024 * 1024)).toFixed(2)} GB)`,
    '',
    'To restore: install Refreshy on the new system, choose Restore, and pick this folder.',
    'Keep this whole folder as-is — apps/, data/ and manifest.json must stay together.',
    ''
  ].join('\n');
}

module.exports = {
  backup,
  cancelBackup,
  backupFolderName,
  buildMatchers,
  isExcluded,
  copyTree,
  pruneEmptyDirs,
  dirSize,
  readWingetExport,
  makeProgressEmitter
};
