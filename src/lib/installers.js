'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { fetchWithTimeout } = require('./ai');

const GOOD_EXIT_CODES = new Set([0, 1641, 3010]);

function safeFileName(app, url) {
  const fromUrl = (() => {
    try {
      const p = new URL(url).pathname;
      const base = path.posix.basename(p);
      return base && /\.[a-z0-9]{2,5}$/i.test(base) ? base : null;
    } catch { return null; }
  })();
  const fromName = String(app.name || 'installer').replace(/[^\w.-]+/g, '_').slice(0, 48);
  let name = fromUrl || fromName;
  if (!/\.(exe|msi|msix|appx|msixbundle)$/i.test(name)) name = `${fromName}.exe`;
  return name.replace(/[^\w.-]+/g, '_');
}

function silentArgsFor(url) {
  const u = url.toLowerCase();
  if (u.endsWith('.msi') || u.includes('.msi?')) return '/qn /norestart';
  if (/inno|jrsoftware/.test(u)) return '/VERYSILENT /NORESTART';
  if (/nullsoft|nsis/.test(u)) return '/S';
  return '/S';
}

const FALLBACK_ARGS = {
  '/S': '/VERYSILENT /NORESTART',
  '/VERYSILENT /NORESTART': '/S'
};

async function downloadFile(url, destPath, onProgress, opts) {
  const redirectCount = (opts && opts.maxRedirects) || 6;
  let current = url;
  for (let i = 0; i <= redirectCount; i++) {
    const res = await fetchWithTimeout(current, { redirect: 'manual' }, 30000);
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error(`download redirect without location (${res.status})`);
      current = new URL(loc, current).href;
      continue;
    }
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);

    const total = Number(res.headers.get('content-length')) || 0;
    const tmp = `${destPath}.part`;
    const ws = fs.createWriteStream(tmp);
    let received = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (value && value.length) {
        received += value.length;
        await new Promise((resolve, reject) => {
          ws.write(Buffer.from(value), (err) => err ? reject(err) : resolve());
        });
        if (onProgress && total) onProgress({ received, total });
      }
      if (done) break;
    }
    await new Promise((resolve) => ws.end(resolve));
    await fsp.rename(tmp, destPath);
    return { bytes: received, file: destPath };
  }
  throw new Error('too many redirects');
}

function executeCommandFor(installer) {
  if (/\.msi$/i.test(installer.file)) {
    return { program: 'msiexec.exe', args: ['/i', installer.file, ...(installer.args || '').split(' ')] };
  }
  return { program: installer.file, args: (installer.args || '').split(' ').filter(Boolean) };
}

module.exports = {
  GOOD_EXIT_CODES,
  safeFileName,
  silentArgsFor,
  FALLBACK_ARGS,
  downloadFile,
  executeCommandFor
};
