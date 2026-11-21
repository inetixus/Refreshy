'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');
const { IS_WIN, getMachineInfo } = require('./ps');
const { resolveBase, dataItems, linuxDistroFor } = require('./paths');

async function readBackup(backupPath) {
  const manifestPath = path.join(backupPath, 'manifest.json');
  const raw = await fsp.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  if (manifest.format !== 'refreshy-backup') {
    throw new Error('This folder is not a Refreshy backup.');
  }
  const packages = [];
  const wingetPath = path.join(backupPath, 'apps', 'winget.json');
  if (fs.existsSync(wingetPath)) {
    try {
      const raw2 = JSON.parse(await fsp.readFile(wingetPath, 'utf8'));
      for (const src of raw2.Sources || []) {
        for (const p of src.Packages || []) {
          packages.push({
            id: p.PackageIdentifier,
            version: p.PackageVersion && p.PackageVersion !== 'unknown' ? p.PackageVersion : null,
            selected: true
          });
        }
      }
    } catch { /* ignore malformed winget file */ }
  }
  const manualApps = ((manifest.apps && manifest.apps.packages) || [])
    .filter((p) => !p.id)
    .map((p) => ({ id: null, name: p.name, version: p.version || null, publisher: p.publisher || null, selected: false }));
  const dataEntries = (manifest.data || []).map((d) => ({
    ...d,
    fullPath: path.join(backupPath, d.folder),
    exists: fs.existsSync(path.join(backupPath, d.folder)),
    selected: true,
    targetBase: d.base,
    bytes: d.bytes || 0
  }));
  return { backupPath, manifest, packages, manualApps, dataEntries };
}

function sanitizeWingetId(id) {
  return String(id).replace(/[^A-Za-z0-9._-]/g, '');
}

function wingetInstallAllScript(packages, backupPath) {
  const ids = packages.map((p) => sanitizeWingetId(p.id)).filter(Boolean);
  return [
    '# Refreshy one-click installer',
    '# Installs every app that was captured on the old PC, in one run.',
    'param()',
    '$ErrorActionPreference = "Continue"',
    '$ProgressPreference = "SilentlyContinue"',
    `$backupRoot = "${backupPath.replace(/'/g, "''")}"`,
    '$log = Join-Path $backupRoot "apps\\install-log.txt"',
    'Start-Transcript -Path $log -Append | Out-Null',
    '',
    'if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {',
    '  Write-Host "winget is missing. Install \\"App Installer\\" from the Microsoft Store, then re-run this script." -ForegroundColor Red',
    '  Stop-Transcript | Out-Null',
    '  exit 1',
    '}',
    '',
    '$packages = @(',
    ...ids.map((id) => `  "${id}"`),
    ')',
    '',
    '$ok = @(); $failed = @()',
    'foreach ($id in $packages) {',
    '  Write-Host "`n=== Installing $id ===" -ForegroundColor Cyan',
    '  winget install -e --id $id --accept-source-agreements --accept-package-agreements --silent',
    '  if ($LASTEXITCODE -eq 0) { $ok += $id } else { $failed += $id }',
    '}',
    '',
    'Write-Host "`n================= SUMMARY =================" -ForegroundColor White',
    "Write-Host ('Installed OK: ' + $ok.Count)",
    "Write-Host ('Failed: ' + $failed.Count)",
    'if ($failed.Count -gt 0) { $failed | ForEach-Object { Write-Host ("  - " + $_) -ForegroundColor Yellow } }',
    'Stop-Transcript | Out-Null'
  ].join('\n');
}

function linuxShellScript(packages, backupPath, distro) {
  const flatpakIds = packages.map((p) => p.id);
  return [
    '#!/usr/bin/env bash',
    '# Refreshy Linux app installer (generated)',
    `# Distro: ${distro || 'linux'}  Backup: ${backupPath}`,
    'set -u',
    'echo "=== Refreshy app installer ==="',
    '',
    'if command -v flatpak >/dev/null 2>&1; then',
    '  echo "Installing apps via flatpak (Flathub)…"',
    '  flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo',
    '  for id in ' + flatpakIds.map((id) => `"${String(id).toLowerCase().replace(/[^a-z0-9._-]/g, '')}"`).join(' ') + '; do',
    '    echo "--- flatpak install $id"',
    '    flatpak install -y --noninteractive flathub "$id" || echo "skipped $id"',
    '  done',
    'else',
    '  echo "flatpak not found. Install it first: see https://flatpak.org/setup/"',
    'fi',
    'echo "Done. Review the output above for any app that needs a different package name."'
  ].join('\n');
}

async function writeInstallerScript(backupPath, packages, targetPlatform) {
  const appsDir = path.join(backupPath, 'apps');
  await fsp.mkdir(appsDir, { recursive: true });
  let file;
  let content;
  if (targetPlatform === 'win32') {
    file = path.join(appsDir, 'Refreshy-Installer.ps1');
    content = wingetInstallAllScript(packages, backupPath);
  } else {
    file = path.join(appsDir, 'Refreshy-Installer.sh');
    content = linuxShellScript(packages, backupPath, linuxDistroFor(null));
  }
  await fsp.writeFile(file, content, 'utf8');
  return file;
}

function startInstaller(backupPath, packages, onLine, onDone) {
  const scriptPath = path.join(backupPath, 'apps', 'Refreshy-Installer.ps1');
  const args = [
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', scriptPath
  ];
  const child = spawn('powershell.exe', args, {
    windowsHide: false,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n|\r/);
    buffer = lines.pop() || '';
    lines.forEach((l) => l.trim() && onLine(l));
  });
  child.stderr.on('data', (chunk) => {
    chunk.split(/\r?\n|\r/).forEach((l) => l.trim() && onLine('[err] ' + l));
  });
  child.on('close', (code) => onDone(code));
  child.on('error', (err) => {
    onLine('[err] ' + err.message);
    onDone(-1);
  });
  return child;
}

async function restoreData(entry, onProgress) {
  const srcRoot = entry.fullPath;
  const destBase = resolveBase(entry.targetBase);
  if (!destBase) throw new Error(`Unknown base '${entry.targetBase}' on this platform`);
  const progress = { files: 0, bytes: 0, errors: [] };
  async function walk(srcDir, relPrefix) {
    const entries = await fsp.readdir(srcDir, { withFileTypes: true });
    await fsp.mkdir(path.join(destBase, relPrefix), { recursive: true });
    for (const e of entries) {
      const rel = relPrefix ? path.join(relPrefix, e.name) : e.name;
      const src = path.join(srcDir, e.name);
      const dest = path.join(destBase, rel);
      if (e.isDirectory()) {
        await walk(src, rel);
      } else if (e.isFile()) {
        if (fs.existsSync(dest)) {
          continue;
        }
        await fsp.copyFile(src, dest).catch((err) => {
          progress.errors.push(`${rel}: ${err.message}`);
        });
        progress.files += 1;
        if (onProgress) onProgress(progress);
      }
    }
  }
  await walk(srcRoot, '');
  return progress;
}

function targetOsWarning(backupManifest, currentPlatform) {
  const intended = backupManifest.targetOs && backupManifest.targetOs.id;
  if (!intended) return null;
  if (currentPlatform === 'win32' && (intended === 'win11' || intended === 'win10')) return null;
  if (currentPlatform !== 'win32' && !(intended === 'win11' || intended === 'win10')) return null;
  if (currentPlatform !== 'win32') {
    return 'This backup was made for Windows. On this system, Windows-only app settings may not be usable, but documents, browser profiles and most config files will import fine.';
  }
  return `This backup was made for ${backupManifest.targetOs.label}, but you are running Windows. App settings from another OS can still be copied into your profile, and apps will be installed via winget where possible.`;
}

async function verifyBackupPath(p) {
  try {
    const st = await fsp.stat(p);
    if (!st.isDirectory()) return false;
    return fs.existsSync(path.join(p, 'manifest.json'));
  } catch {
    return false;
  }
}

async function pickRestoreDefaults(restoreInfo, currentPlatform) {
  const wingetOk = currentPlatform === 'win32';
  return {
    packages: restoreInfo.packages.map((p) => ({ ...p, selected: wingetOk })),
    dataEntries: restoreInfo.dataEntries.map((d) => ({
      ...d,
      selected: d.exists
    }))
  };
}

async function currentOsLabel() {
  if (IS_WIN) {
    const info = await getMachineInfo();
    return info.osName || 'Windows';
  }
  return `${process.platform} (${require('os').type()})`;
}

module.exports = {
  readBackup,
  sanitizeWingetId,
  wingetInstallAllScript,
  linuxShellScript,
  writeInstallerScript,
  startInstaller,
  restoreData,
  targetOsWarning,
  verifyBackupPath,
  pickRestoreDefaults,
  currentOsLabel
};
