'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');
const { IS_WIN, getMachineInfo } = require('./ps');
const { resolveBase, dataItems, linuxDistroFor } = require('./paths');

const GOOD_EXIT = '$p.ExitCode -eq 0 -or $p.ExitCode -eq 1641 -or $p.ExitCode -eq 3010';

function psq(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function sanitizeWingetId(id) {
  return String(id).replace(/[^A-Za-z0-9._-]/g, '');
}

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
  const manualApps = ((manifest.apps && (manifest.apps.manual || manifest.apps.packages)) || [])
    .filter((p) => !p.id)
    .map((p) => ({
      name: p.name,
      version: p.version || null,
      publisher: p.publisher || null,
      matchedId: null,
      status: p.installerFile ? 'downloaded' : 'pending'
    }));
  const installerFiles = new Set(
    (function listInstallers(dir) {
      try { return fs.readdirSync(dir); } catch { return []; }
    })(path.join(backupPath, 'apps', 'installers'))
  );
  const dataEntries = (manifest.data || []).map((d) => ({
    ...d,
    fullPath: path.join(backupPath, d.folder),
    exists: fs.existsSync(path.join(backupPath, d.folder)),
    selected: true,
    targetBase: d.base,
    bytes: d.bytes || 0
  }));
  return { backupPath, manifest, packages, manualApps, dataEntries, installerFiles };
}

function wingetInstallAllScript(packages, backupPath, installers = [], manualApps = []) {
  const ids = packages.map((p) => sanitizeWingetId(p.id)).filter(Boolean);
  const L = [];
  L.push(
    '# Refreshy one-click installer',
    '# Installs every app captured on the old PC, in one run.',
    `# Section 1: ${ids.length} app(s) via winget.`,
    installers.length
      ? `# Section 2: ${installers.length} installer(s) Refreshy fetched automatically for non-winget apps.`
      : '# Section 2: skipped (no fetched installers).',
    manualApps.length
      ? `# ${manualApps.length} app(s) could not be resolved automatically - listed at the end and in apps/Manual-Apps.txt.`
      : '# No manual installs needed - everything is automated.',
    'param()',
    "$ErrorActionPreference = 'Continue'",
    "$ProgressPreference = 'SilentlyContinue'",
    "$installersDir = Join-Path $PSScriptRoot 'installers'",
    "$log = Join-Path $PSScriptRoot 'install-log.txt'",
    'Start-Transcript -Path $log -Append | Out-Null',
    '',
    "$hasWinget = $null -ne (Get-Command winget -ErrorAction SilentlyContinue)",
    'if (-not $hasWinget) {',
    "  Write-Host 'winget is missing. Install App Installer from the Microsoft Store, then re-run this script.' -ForegroundColor Red",
    '}'
  );
  if (ids.length) {
    L.push('', '$packages = @(');
    for (const id of ids) L.push(`  ${psq(id)}`);
    L.push(
      ')',
      '',
      '$wingetOk = @(); $wingetFailed = @()',
      'if ($hasWinget) {',
      '  foreach ($id in $packages) {',
      '    Write-Host "`n=== Installing $id ===" -ForegroundColor Cyan',
      '    $out = winget install -e --id $id --accept-source-agreements --accept-package-agreements --silent 2>&1',
      '    $txt = ($out | Out-String)',
      '    $out | ForEach-Object { Write-Host $_ }',
      '    if ($LASTEXITCODE -eq 0 -or $txt -match "already installed") {',
      '      $wingetOk = $wingetOk + $id',
      '    } else {',
      '      $wingetFailed = $wingetFailed + $id',
      '    }',
      '  }',
      '} else {',
      "  Write-Host 'Skipping section 1 (no winget).'",
      '}'
    );
  }
  L.push('', '$exeOk = @(); $exeFailed = @()');
  if (installers.length) {
    L.push(`Write-Host "**** Section 2: ${installers.length} fetched installer(s) ****" -ForegroundColor White`);
    for (const inst of installers) {
      const file = String(inst.file).replace(/[^\w.-]+/g, '');
      const name = String(inst.name).replace(/'/g, "''");
      const args = String(inst.args || '/S').replace(/'/g, "''");
      L.push(
        `Write-Host "=== Installing ${name} ===" -ForegroundColor Cyan`,
        `$exe = Join-Path $installersDir ${psq(file)}`,
        'if (Test-Path $exe) {'
      );
      if (/\.msi$/i.test(file)) {
        L.push("  $p = Start-Process msiexec.exe -ArgumentList '/i', $exe, '/qn', '/norestart' -Wait -PassThru");
      } else {
        L.push(
          `  $p = Start-Process $exe -ArgumentList ${psq(args)} -Wait -PassThru`,
          `  if (-not (${GOOD_EXIT})) {`,
          "    $fb = if (" + psq(args) + " -eq '/S') { '/VERYSILENT /NORESTART' } else { '/S' }",
          '    $p = Start-Process $exe -ArgumentList $fb -Wait -PassThru',
          '  }'
        );
      }
      L.push(
        `  if (${GOOD_EXIT}) { $exeOk = $exeOk + ${psq(inst.name)} } else { $exeFailed = $exeFailed + ${psq(inst.name)} }`,
        '} else {',
        `  $exeFailed = $exeFailed + ${psq(inst.name)}`,
        '}'
      );
    }
  }
  if (manualApps.length) {
    L.push(
      '',
      "Write-Host '**** Apps that need a manual installer ****' -ForegroundColor Yellow",
      "Write-Host 'Find them on their official websites (listed in apps/Manual-Apps.txt):' -ForegroundColor Yellow"
    );
    for (const a of manualApps) {
      const label = a.version ? `${a.name} (v${a.version})` : a.name;
      L.push(`Write-Host ${psq('  - ' + label)} -ForegroundColor Yellow`);
    }
  }
  L.push(
    '',
    'Write-Host "**** SUMMARY ****" -ForegroundColor White',
    "Write-Host ('winget - installer OK: ' + $wingetOk.Count)",
    "Write-Host ('winget - failed: ' + $wingetFailed.Count)",
    '$wingetFailed | ForEach-Object { Write-Host ("  - " + $_) -ForegroundColor Yellow }',
    "Write-Host ('fetched installers - installer OK: ' + $exeOk.Count)",
    "Write-Host ('fetched installers - failed: ' + $exeFailed.Count)",
    '$exeFailed | ForEach-Object { Write-Host ("  - " + $_) -ForegroundColor Yellow }',
    'Stop-Transcript | Out-Null'
  );
  return L.join('\n') + '\n';
}

function manualAppsText(manualApps) {
  return [
    'Apps not covered by winget and not resolvable automatically',
    '==========================================================',
    '',
    'Find installers on the official websites (publisher search) and run them by hand.',
    '',
    ...manualApps.map((a) => `- ${a.name}${a.version ? ` (v${a.version})` : ''}${a.publisher ? ` - ${a.publisher}` : ''}`),
    ''
  ].join('\n') + '\n';
}

function linuxShellScript(packages, backupPath, distro, installers = []) {
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
    ...installers.reduce((acc, inst) => acc.concat([
      `echo "--- Fetched Windows installer: ${String(inst.file).replace(/["\\\\]/g, '')} (for ${String(inst.name).replace(/"/g, '')})"`,
      'echo "    Windows installers do not run on Linux - copy it somewhere safe or try Wine."'
    ]), []),
    'echo "Done. Review the output above for any app that needs a different package name."'
  ].join('\n');
}

async function writeInstallerScript(backupPath, packages, targetPlatform, opts = {}) {
  const appsDir = path.join(backupPath, 'apps');
  await fsp.mkdir(appsDir, { recursive: true });
  let file;
  let content;
  const installers = opts.installers || [];
  const manualApps = opts.manualApps || [];
  if (targetPlatform === 'win32') {
    file = path.join(appsDir, 'Refreshy-Installer.ps1');
    content = wingetInstallAllScript(packages, backupPath, installers, manualApps);
  } else {
    file = path.join(appsDir, 'Refreshy-Installer.sh');
    content = linuxShellScript(packages, backupPath, linuxDistroFor(null), installers);
  }
  await fsp.writeFile(file, content, 'utf8');
  if (manualApps.length && targetPlatform === 'win32') {
    await fsp.writeFile(path.join(appsDir, 'Manual-Apps.txt'), manualAppsText(manualApps), 'utf8');
  }
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
    const lines = buffer.split(/\r?\\n|\r/);
    buffer = lines.pop() || '';
    lines.forEach((l) => l.trim() && onLine(l));
  });
  child.stderr.on('data', (chunk) => {
    chunk.split(/\r?\\n|\r/).forEach((l) => l.trim() && onLine('[err] ' + l));
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
  psq,
  sanitizeWingetId,
  wingetInstallAllScript,
  manualAppsText,
  linuxShellScript,
  writeInstallerScript,
  startInstaller,
  restoreData,
  targetOsWarning,
  verifyBackupPath,
  pickRestoreDefaults,
  currentOsLabel
};
