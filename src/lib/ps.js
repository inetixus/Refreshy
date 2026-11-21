'use strict';

const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const IS_WIN = process.platform === 'win32';

function run(cmd, args, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, shell: false });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      child.kill();
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function runPowerShell(script, opts) {
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script];
  return run(IS_WIN ? 'powershell.exe' : 'pwsh', args, opts);
}

async function isWingetAvailable() {
  if (!IS_WIN) return false;
  try {
    const res = await run('winget', ['--version'], { timeoutMs: 15000 });
    return res.code === 0;
  } catch {
    return false;
  }
}

async function exportWingetPackages(outFile) {
  const args = ['export', '-o', outFile, '--accept-source-agreements'];
  const res = await run('winget', args, { timeoutMs: 180000 });
  if (res.code !== 0 && res.code !== 197120) {
    throw new Error(`winget export failed (code ${res.code}): ${res.stderr.slice(0, 400)}`);
  }
  return res;
}

function listInstalledAppsFromRegistry() {
  return runPowerShell(`
    $keys = @(
      'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
      'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
      'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
    )
    Get-ItemProperty $keys -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName } |
      Select-Object DisplayName, DisplayVersion, Publisher |
      Sort-Object DisplayName -Unique |
      ForEach-Object {
        $o = [ordered]@{ name = $_.DisplayName; version = $_.DisplayVersion; publisher = $_.Publisher }
        $o | ConvertTo-Json -Compress
      }
  `, { timeoutMs: 120000 })
    .then((res) => res.stdout
      .split(/\r?\n/)
      .filter((l) => l.trim().startsWith('{'))
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(Boolean));
}

async function listDrives() {
  const platform = process.platform;
  let out = [];
  if (platform === 'win32') {
    const res = await runPowerShell(`
      Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3 OR DriveType=2' |
        Select-Object DeviceID, VolumeName, DriveType,
          @{n='FreeGB';e={[math]::Round($_.FreeSpace/1GB,1)}},
          @{n='TotalGB';e={[math]::Round($_.Size/1GB,1)}} |
        ConvertTo-Json -Compress
    `, { timeoutMs: 60000 });
    if (res.code !== 0) throw new Error('Could not enumerate drives: ' + res.stderr.slice(0, 200));
    const parsed = safeJsonArray(res.stdout);
    out = parsed.map((d) => ({
      path: d.DeviceID + '\\',
      label: d.VolumeName || 'Local Disk',
      kind: d.DriveType === 2 ? 'removable' : 'fixed',
      freeBytes: d.FreeGB != null ? Math.round(d.FreeGB * 1e9) : null,
      totalBytes: d.TotalGB != null ? Math.round(d.TotalGB * 1e9) : null,
      recommended: d.DriveType === 2 || isLikelyExternal(d)
    }));
  } else {
    const res = await run('df', ['-l', '-P'], { timeoutMs: 30000 });
    const lines = res.stdout.trim().split('\n').slice(1);
    out = lines.map((line) => {
      const cols = line.trim().split(/\s+/);
      const total = parseInt(cols[1], 10) * 1024;
      const free = parseInt(cols[3], 10) * 1024;
      return {
        path: cols[5],
        label: cols[5],
        kind: total > 0 ? 'fixed' : 'unknown',
        freeBytes: free,
        totalBytes: total,
        recommended: free / (total || 1) > 0.8 && !cols[5].startsWith('/')
      };
    }).filter((d) => d.totalBytes > 0 && d.freeBytes > d.totalBytes * 0.1);
    if (platform === 'darwin') {
      out = out.filter((d) => d.path.startsWith('/Volumes/'));
    }
  }
  return out;
}

function isLikelyExternal(d) {
  return false;
}

async function getMachineInfo() {
  const info = {
    host: os.hostname(),
    platform: process.platform,
    osRelease: os.release(),
    arch: os.arch()
  };
  if (IS_WIN) {
    try {
      const res = await runPowerShell(`
        $ci = Get-CimInstance Win32_OperatingSystem
        $cv = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'
        [pscustomobject]@{
          name = $ci.Caption
          version = $cv.DisplayVersion
          build = $cv.CurrentBuildNumber
          displayVersion = $cv.DisplayVersion
        } | ConvertTo-Json -Compress
      `, { timeoutMs: 60000 });
      const parsed = safeJsonObject(res.stdout);
      if (parsed) {
        info.osName = parsed.name;
        info.osVersion = parsed.displayVersion || parsed.version;
        info.osBuild = parsed.build;
      }
    } catch { /* keep defaults */ }
  } else {
    info.osName = `${os.type()} ${os.release()}`;
  }
  return info;
}

async function ensureAdminSupported() {
  return IS_WIN;
}

function safeJsonArray(text) {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v : [v];
  } catch {
    return [];
  }
}

function safeJsonObject(text) {
  if (!text || !text.trim()) return null;
  try { return JSON.parse(text); } catch { return null; }
}

module.exports = {
  IS_WIN,
  run,
  runPowerShell,
  isWingetAvailable,
  exportWingetPackages,
  listInstalledAppsFromRegistry,
  listDrives,
  getMachineInfo,
  ensureAdminSupported,
  safeJsonArray,
  safeJsonObject
};
