'use strict';

const $ = (id) => document.getElementById(id);
const state = {
  os: null,
  destination: null,
  includeApps: true,
  dataSelection: [],
  backupPath: null,
  restoreInfo: null,
  platform: 'win32',
  lastDestination: null,
  fetchedInstallers: []
};

const OS_LIST = [
  { id: 'win11', label: 'Windows 11', icon: 'icons/brand/windows.svg', match: 'win11' },
  { id: 'win10', label: 'Windows 10', icon: 'icons/brand/windows.svg', match: 'win10' },
  { id: 'ubuntu', label: 'Ubuntu', icon: 'icons/brand/ubuntu.svg', match: 'ubuntu' },
  { id: 'fedora', label: 'Fedora', icon: 'icons/brand/fedora.svg', match: 'fedora' },
  { id: 'debian', label: 'Debian', icon: 'icons/brand/debian.svg', match: 'debian' },
  { id: 'arch', label: 'Arch Linux', icon: 'icons/brand/archlinux.svg', match: 'arch' },
  { id: 'linux', label: 'Other Linux', icon: 'icons/brand/linux.svg', match: 'linux' },
  { id: 'macos', label: 'macOS', icon: 'icons/brand/apple.svg', match: 'macos' }
];

const OS_DESCRIPTIONS = {
  win11: 'Best compatibility. Every app in your list can be reinstalled automatically with winget, and all AppData can be imported.',
  win10: 'Near-full compatibility. winget works, but some newer apps may drop Windows 10 support.',
  ubuntu: 'Linux can’t run Windows apps directly. Browser profiles, documents and developer settings carry over; apps use a Flatpak script instead of winget.',
  fedora: 'Linux can’t run Windows apps directly. Browser profiles, documents and developer settings carry over; apps use a Flatpak script instead of winget.',
  debian: 'Linux can’t run Windows apps directly. Browser profiles, documents and developer settings carry over; apps use a Flatpak script instead of winget.',
  arch: 'Linux can’t run Windows apps directly. Browser profiles, documents and developer settings carry over; apps use a script instead of winget.',
  linux: 'Linux can’t run Windows apps directly. Browser profiles, documents and developer settings carry over; apps use a script instead of winget.',
  macos: 'Commercial Windows apps usually need re-purchase. Browser profiles, documents and most developer tools carry over.',
  unsure: 'Refreshy will assume Windows 11 — the safest default for a full restore.'
};

const DATA_ICONS = {
  'appdata-roaming': 'i-data', 'appdata-local': 'i-data', 'appdata-locallow': 'i-data',
  'config': 'i-data', 'local-share': 'i-data', 'application-support': 'i-data',
  'desktop': 'i-desktop', 'documents': 'i-documents', 'pictures': 'i-desktop',
  'videos': 'i-desktop', 'music': 'i-music', 'downloads': 'i-download'
};

/* ---------- fatal error surface ---------- */

window.addEventListener('error', (e) => showFatal(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => showFatal(e.reason));

if (typeof window.refreshy === 'undefined' || !window.refreshy) {
  showFatal('Refreshy\u2019s internal bridge (preload) did not load \u2014 the UI cannot reach the app core. ' +
    'Fix: delete the dist folder, then pull the latest code and rebuild (git pull && npm install && npm run dist).');
}

function showFatal(reason) {
  let el = document.getElementById('fatalError');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fatalError';
    el.style.cssText = 'position:fixed;bottom:20px;left:20px;right:20px;z-index:99;background:#5d1a1a;color:#fff;' +
      'border:1px solid #ff99a4;border-radius:8px;padding:12px 16px;font-size:12.5px;line-height:1.5;max-height:40vh;overflow:auto;';
    document.body.appendChild(el);
  }
  const msg = reason && reason.stack ? `${reason.message}\n${reason.stack.split('\n').slice(1, 4).join('\n')}` : String(reason);
  el.textContent += (el.textContent ? '\n\n' : 'Something went wrong — please report this:\n') + msg;
}

/* ---------- helpers ---------- */

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  const el = $('view-' + name);
  if (el) {
    el.classList.add('active');
    el.scrollTop = 0;
  }
}

function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.classList.remove('show'); }, ms);
}

function formatBytes(n) {
  if (n == null || isNaN(n)) return '—';
  if (n < 1024) return n + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = -1;
  do { v /= 1024; i++; } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/* ---------- navigation ---------- */

$('btnStartBackup').addEventListener('click', () => { showView('os'); });
$('btnStartRestore').addEventListener('click', () => { showView('restorepick'); });
document.querySelectorAll('.back-btn').forEach((b) =>
  b.addEventListener('click', () => showView(b.dataset.nav))
);
$('btnDoneHome').addEventListener('click', () => { resetToHome(); });
$('btnDoneHome2').addEventListener('click', () => { resetToHome(); });

function resetToHome() {
  state.os = null;
  state.fetchedInstallers = [];
  state.restoreInfo = null;
  state.destination = null;
  document.querySelectorAll('.os-tile').forEach((t) => t.classList.remove('selected'));
  $('osContinue').disabled = true;
  $('destContinue').disabled = true;
  showView('home');
}

/* ---------- OS picker ---------- */

function initOsGrid() {
  const grid = $('osGrid');
  grid.innerHTML = '';
  OS_LIST.forEach((os) => {
    const btn = document.createElement('button');
    btn.className = 'os-tile';
    btn.dataset.os = os.id;
    btn.innerHTML = `<img src="${os.icon}" alt="${os.label}"/><span>${os.label}</span>`;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.os-tile').forEach((t) => t.classList.remove('selected'));
      btn.classList.add('selected');
      state.os = os;
      const desc = OS_DESCRIPTIONS[os.id];
      $('osDescriptionText').textContent = desc;
      $('osDescription').hidden = false;
      $('osContinue').disabled = false;
    });
    grid.appendChild(btn);
  });
}

$('osContinue').addEventListener('click', () => {
  loadDrives();
  showView('dest');
});

/* ---------- destination ---------- */

async function loadDrives() {
  const list = $('driveList');
  list.innerHTML = '<div class="skeleton-row"></div><div class="skeleton-row"></div>';
  const res = await window.refreshy.drives();
  list.innerHTML = '';
  if (!res.ok || !res.drives.length) {
    list.innerHTML = '<div class="callout info"><i class="icon i-info"></i><span>No extra drives detected. Plug in an external drive, or pick a folder manually below.</span></div>';
    return;
  }
  const sorted = [...res.drives].sort((a, b) => (b.recommended - a.recommended) || ((b.freeBytes || 0) - (a.freeBytes || 0)));
  sorted.forEach((d) => {
    const btn = document.createElement('button');
    btn.className = 'drive';
    const freeText = d.freeBytes != null ? `${formatBytes(d.freeBytes)} free` : '';
    const pct = d.totalBytes ? Math.round(((d.totalBytes - d.freeBytes) / d.totalBytes) * 100) : 0;
    btn.innerHTML = `
      <span class="drive-icon"><i class="icon i-drive"></i></span>
      <span>
        <span class="drive-name">${escapeHtml(d.label)}</span>
        <span class="drive-letter"> ${escapeHtml(d.path)}</span>
      </span>
      ${d.recommended ? '<span class="pill">Recommended</span>' : ''}
      <span class="drive-bar"><span style="width:${pct}%"></span></span>
      <span class="drive-free">${freeText}</span>`;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.drive').forEach((x) => x.classList.remove('selected'));
      btn.classList.add('selected');
      state.destination = d.path;
      $('destContinue').disabled = false;
    });
    list.appendChild(btn);
  });
}

$('btnPickFolder').addEventListener('click', async () => {
  const dir = await window.refreshy.chooseDirectory({
    title: 'Choose where to save the backup',
    buttonLabel: 'Save here'
  });
  if (dir) {
    state.destination = dir;
    document.querySelectorAll('.drive').forEach((x) => x.classList.remove('selected'));
    $('destContinue').disabled = false;
    toast('Backup will be saved to ' + dir);
  }
});

$('destContinue').addEventListener('click', () => {
  initDataList();
  showView('content');
});

/* ---------- content selection ---------- */

function switchEl(id, on, onToggle) {
  const el = $(id);
  el.classList.toggle('on', on);
  return el;
}

function initDataList() {
  const wrap = $('dataItems');
  wrap.innerHTML = '';
  if (!state.dataItemsCache) {
    wrap.innerHTML = '<div class="skeleton-row"></div>';
    window.refreshy.dataItems().then((items) => {
      state.dataItemsCache = items;
      initDataList();
    });
    return;
  }
  const items = state.dataItemsCache;
  items.forEach((item, idx) => {
    const isPersonal = !item.id.startsWith('appdata-');
    const existing = state.dataSelection.find((s) => s.id === item.id);
    const include = existing ? existing.include : !isPersonal;
    const row = document.createElement('div');
    row.className = 'row toggle-row';
    row.innerHTML = `
      <span class="row-icon"><i class="icon ${DATA_ICONS[item.id] || 'i-folder'}"></i></span>
      <span class="row-text"><span class="row-title">${escapeHtml(item.label)}</span>
        <span class="row-sub">${escapeHtml(item.hint || '')}</span></span>
      <span class="switch ${include ? 'on' : ''}" role="switch" aria-checked="${include}" tabindex="0"></span>`;
    const sw = row.querySelector('.switch');
    const toggle = () => {
      const on = !sw.classList.contains('on');
      sw.classList.toggle('on', on);
      sw.setAttribute('aria-checked', on);
      setSelection(item.id, on);
    };
    sw.addEventListener('click', toggle);
    sw.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') toggle(); });
    wrap.appendChild(row);
    if (idx !== items.length - 1) {
      const div = document.createElement('div');
      div.className = 'divider';
      wrap.appendChild(div);
    }
  });
}

function setSelection(id, include) {
  const found = state.dataSelection.find((s) => s.id === id);
  if (found) found.include = include;
  else state.dataSelection.push({ id, include });
}

window.refreshy.machine().then((m) => {
  if (m.wingetAvailable) {
    $('appsHint').textContent = 'Captured with winget so apps reinstall automatically — one command installs everything';
  } else {
    $('appsHint').textContent = 'winget not found — the app list will be captured from the registry instead';
  }
});

$('swApps').addEventListener('click', () => {
  state.includeApps = !state.includeApps;
  $('swApps').classList.toggle('on', state.includeApps);
  $('swApps').setAttribute('aria-checked', state.includeApps);
});

$('contentContinue').addEventListener('click', () => {
  runBackup();
});

/* ---------- backup run ---------- */

function runBackup() {
  const sel = [];
  (state.dataItemsCache || []).forEach((i) => {
    const s = state.dataSelection.find((x) => x.id === i.id);
    sel.push({ id: i.id, include: s ? s.include : !i.id.startsWith('appdata-') });
  });
  const options = {
    destination: state.destination,
    targetOs: state.os ? { id: state.os.id, label: state.os.label } : null,
    includeApps: state.includeApps,
    dataSelection: sel
  };
  const log = [];
  window.refreshy.onBackupProgress((p) => updateBackupProgress(p, log));
  window.refreshy.startBackup(options);
  showView('runbackup');
  setRing(0);
  $('backupLog').innerHTML = '';
  $('backupLog').hidden = true;
  $('btnShowLog').hidden = false;
  $('btnCancelBackup').hidden = false;
  $('btnCancelBackup').textContent = 'Cancel';
  $('statFiles').textContent = '0';
  $('statSize').textContent = '0 MB';
  $('statSkipped').textContent = '0';
}

function setRing(pct) {
  const c = 2 * Math.PI * 52;
  $('backupRingFg').style.strokeDashoffset = c * (1 - pct / 100);
}

function updateBackupProgress(p, log) {
  if (p.phase === 'done' && p.destination) {
    state.lastDestination = p.destination;
  }
  const total = p.taskBytes ? Object.values(p.taskBytes).reduce((a, b) => a + b, 0) : p.bytes || 0;
  const line = `[${p.phase}] ${p.task || ''}`;
  if (!log.includes(line)) {
    log.push(line);
    const el = $('backupLog');
    el.hidden = false;
    el.innerHTML = log.slice(-40).map(escapeHtml).join('<br/>');
    el.scrollTop = el.scrollHeight;
  }
  const knownPhases = ['apps', 'data', 'manifest'];
  let pct = 4;
  if (p.phase === 'apps') pct = 12;
  if (p.phase === 'data') pct = Math.min(92, 15 + Math.min(total / (6 * 1024 * 1024 * 1024), 1) * 75);
  if (p.phase === 'manifest') pct = 96;
  if (p.phase === 'done') pct = 100;
  setRing(pct);
  $('backupPercent').textContent = Math.round(pct) + '%';
  $('backupTask').textContent = p.task || 'Finishing up…';
  $('statFiles').textContent = (p.files != null ? p.files : 0).toLocaleString();
  $('statSize').textContent = formatBytes(total);
  $('statSkipped').textContent = p.skippedCount || 0;

  if (p.phase === 'done' && p._final) {
    $('backupTitle').textContent = 'Backup complete';
    $('backupTask').textContent = 'Everything is on your external drive.';
    $('btnCancelBackup').hidden = true;
    setTimeout(() => {
      $('doneBackupText').textContent = `${p._final.manifest.apps ? (p._final.manifest.apps.packages || []).length : 0} apps · ` +
        formatBytes(p._final.manifest.totalBytes) + ' of app data · saved to ' + p._final.destination;
      showView('donebackup');
    }, 700);
  }
}

$('btnCancelBackup').addEventListener('click', () => {
  window.refreshy.cancelBackup();
  $('btnCancelBackup').disabled = true;
  $('btnCancelBackup').textContent = 'Cancelling…';
});

$('btnShowLog').addEventListener('click', () => {
  const el = $('backupLog');
  el.hidden = !el.hidden;
  $('btnShowLog').textContent = el.hidden ? 'Show details' : 'Hide details';
});

$('btnOpenBackup').addEventListener('click', () => {
  if (state.lastDestination) window.refreshy.openPath(state.lastDestination);
});

/* ---------- restore: pick ---------- */

$('btnChooseBackup').addEventListener('click', async () => {
  const res = await window.refreshy.chooseBackup();
  if (!res.ok) {
    if (res.error) $('restorePickHint').textContent = res.error;
    return;
  }
  state.backupPath = res.backupPath;
  state.restoreInfo = res;
  $('restorePickHint').textContent = '';
  buildRestoreReview(res);
  showView('restorereview');
});

/* ---------- restore: review ---------- */

function buildRestoreReview(info) {
  const m = info.manifest;
  $('restoreFromText').textContent =
    `From “${m.machine.host}” · backed up ${new Date(m.created).toLocaleDateString()} · ` +
    `saved for ${m.targetOs ? m.targetOs.label : 'any OS'}`;

  if (info.warning) {
    $('restoreWarningText').textContent = info.warning;
    $('restoreWarning').hidden = false;
  } else {
    $('restoreWarning').hidden = true;
  }

  const pkgs = info.packages;
  state.fetchedInstallers = state.fetchedInstallers || [];
  $('appsCountText').textContent = pkgs.length
    ? `${pkgs.length} packages captured with winget — they install in one automated run`
    : 'No winget package list in this backup';

  renderPackageChips();
  renderManualApps();
  $('btnSelectAllApps').textContent = 'Select all';
  $('btnSelectAllApps').onclick = () => {
    const allOn = pkgs.every((p) => p.selected);
    pkgs.forEach((p) => { p.selected = !allOn; });
    chipWrap.querySelectorAll('.chip').forEach((c, i) => c.classList.toggle('checked', pkgs[i].selected));
    $('btnSelectAllApps').textContent = allOn ? 'Select all' : 'Deselect all';
  };

  const items = $('restoreDataItems');
  items.innerHTML = '';
  info.dataEntries.forEach((d, idx) => {
    const row = document.createElement('div');
    row.className = 'row toggle-row';
    row.innerHTML = `
      <label><input type="checkbox" class="checkbox" ${d.selected ? 'checked' : ''} ${d.exists ? '' : 'disabled'}/></label>
      <span class="row-text"><span class="row-title">${escapeHtml(d.label)}</span>
        <span class="row-sub">${d.exists ? (d.files || 0).toLocaleString() + ' files · ' + formatBytes(d.bytes) : 'missing from the backup drive'}</span></span>`;
    row.querySelector('.checkbox').addEventListener('change', (e) => {
      d.selected = e.target.checked;
    });
    items.appendChild(row);
    if (idx !== info.dataEntries.length - 1) {
      const div = document.createElement('div');
      div.className = 'divider';
      items.appendChild(div);
    }
  });
  const totalBytes = info.dataEntries.reduce((a, d) => a + (d.bytes || 0), 0);
  $('dataCountText').textContent = `${info.dataEntries.length} folders · ~${formatBytes(totalBytes)} to copy back`;
}

function renderPackageChips() {
  const info = state.restoreInfo;
  if (!info) return;
  const chipWrap = $('packagesList');
  chipWrap.innerHTML = '';
  info.packages.forEach((p) => {
    const c = document.createElement('button');
    c.className = 'chip' + (p.selected ? ' checked' : '');
    c.textContent = p.id;
    c.title = (p.version ? `${p.id} ${p.version}` : p.id) + (p.fromManual ? ` — matched from “${p.fromManual}”` : '');
    c.addEventListener('click', () => {
      p.selected = !p.selected;
      c.classList.toggle('checked', p.selected);
    });
    chipWrap.appendChild(c);
  });
}

function manualStateLabel(m) {
  if (m.status === 'downloaded') return 'Installer fetched — installs automatically';
  if (m.status === 'failed') return 'No installer found automatically — download it from the official site';
  if (m.status === 'working') return 'Looking for an installer…';
  if (m.matchedId) return 'Matched via winget — installs automatically';
  return 'Not on winget — pick an action below';
}

function renderManualApps() {
  const info = state.restoreInfo;
  if (!info) return;
  const manuals = info.manualApps || [];
  const block = $('manualAppsBlock');
  block.hidden = manuals.length === 0;
  if (!manuals.length) return;
  const pending = manuals.filter((m) => !m.matchedId && m.status === 'pending').length;
  const working = manuals.filter((m) => m.status === 'working').length;
  $('manualAppsNote').textContent =
    `${manuals.length} app(s) were installed from outside winget (website installers, sideloads). ` +
    `Refreshy can match them against winget by name, and use AI to find the official installers for the rest.`;
  const chips = $('manualChips');
  chips.innerHTML = '';
  manuals.forEach((m) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const cls = m.matchedId ? 'merged'
      : m.status === 'downloaded' ? 'ok'
      : m.status === 'failed' ? 'fail'
      : m.status === 'working' ? 'spin' : '';
    const label = m.matchedId || m.name;
    const ver = m.version ? ` (v${m.version})` : '';
    chip.innerHTML = `<span class="chip-state ${cls}"></span>${escapeHtml(label)}${escapeHtml(ver)}`;
    chip.title = manualStateLabel(m) + (m.error ? ` (${m.error})` : '');
    chips.appendChild(chip);
  });
  const fetched = (state.fetchedInstallers || []).length;
  let hint = working ? `Working on ${working} app(s)… ` : '';
  if (fetched) hint += `${fetched} installer(s) on the drive. `;
  if (!working && pending) hint += 'Unresolved apps are listed in apps/Manual-Apps.txt after restore.';
  $('manualHint').textContent = hint.trim();
  $('btnMatchApps').disabled = !manuals.some((m) => !m.matchedId && m.status === 'pending');
  $('btnAiResolve').disabled = pending === 0;
  $('btnAiResolve').textContent = pending === 0 && !fetched ? 'Find installers with AI' : 'Find remaining installers with AI';
}

$('btnMatchApps').addEventListener('click', async () => {
  const info = state.restoreInfo;
  const pending = info.manualApps.filter((m) => !m.matchedId && m.status === 'pending');
  pending.forEach((m) => { m.status = 'working'; });
  renderManualApps();
  const res = await window.refreshy.matchApps(pending.map((m) => ({ name: m.name })));
  if (!res.ok) {
    pending.forEach((m) => { m.status = 'pending'; });
    renderManualApps();
    toast(res.error || 'Could not search winget.');
    return;
  }
  let matched = 0;
  res.matches.forEach((mt) => {
    const m = info.manifest && info.manualApps.find((x) => x.name === mt.name);
    if (!m) return;
    if (mt.id) {
      m.matchedId = mt.id;
      mt.confidence = mt.confidence || 'name';
      matched += 1;
      if (!info.packages.some((p) => p.id === mt.id)) {
        info.packages.push({ id: mt.id, version: null, selected: true, fromManual: mt.name });
      }
    } else {
      m.status = 'pending';
    }
  });
  $('appsCountText').textContent = info.packages.length
    ? `${info.packages.length} apps ready for one automated install run`
    : 'No apps selected';
  renderPackageChips();
  renderManualApps();
  toast(matched ? `Matched ${matched} app(s) with winget — review the list before installing.` : 'No winget matches found — try the AI installer search.');
});

let keysResolver = null;
function askKeys() {
  return new Promise((resolve) => {
    keysResolver = resolve;
    const ov = $('keysOverlay');
    ov.hidden = false;
    requestAnimationFrame(() => ov.classList.add('show'));
    $('keyMistral').focus();
  });
}

function closeKeysModal(result) {
  const ov = $('keysOverlay');
  ov.classList.remove('show');
  setTimeout(() => { ov.hidden = true; }, 200);
  if (keysResolver) keysResolver(result);
  keysResolver = null;
}

$('keysCancel').addEventListener('click', () => closeKeysModal(null));

$('keysSave').addEventListener('click', async () => {
  const mistralKey = $('keyMistral').value.trim() || null;
  const firecrawlKey = $('keyFirecrawl').value.trim() || null;
  const res = await window.refreshy.saveSettings({ mistralKey, firecrawlKey });
  if (!res.ok) {
    toast(res.error || 'Could not save settings.');
    return;
  }
  $('keyMistral').value = '';
  $('keyFirecrawl').value = '';
  closeKeysModal(res);
});

$('btnAiResolve').addEventListener('click', async () => {
  const info = state.restoreInfo;
  let targets = info.manualApps.filter((m) => !m.matchedId && m.status === 'pending');
  if (!targets.length) return;
  let st = await window.refreshy.settings();
  if (!st.ready) {
    const saved = await askKeys();
    if (!saved || !saved.ready) return;
    st = saved;
  }
  targets.forEach((m) => { m.status = 'working'; });
  renderManualApps();
  const res = await window.refreshy.resolveInstallers(state.backupPath, targets.map((m) => ({
    name: m.name, version: m.version, publisher: m.publisher
  })));
  if (!res.ok) {
    targets.forEach((m) => { m.status = 'pending'; });
    renderManualApps();
    if (res.error === 'missing-keys') return;
    toast(res.error || 'Installer search failed.');
    return;
  }
  const byName = Object.fromEntries(res.resolved.map((r) => [r.name, r]));
  state.fetchedInstallers = (state.fetchedInstallers || []).concat(res.installers);
  targets.forEach((m) => {
    const r = byName[m.name];
    if (r && !r.failed) {
      m.status = 'downloaded';
      m.version = m.version || r.file;
    } else {
      m.status = 'failed';
      m.error = r ? r.error : 'unknown';
    }
  });
  renderManualApps();
  toast(res.installers.length
    ? `Fetched ${res.installers.length}/${targets.length} official installer(s) — they install in the same run as winget apps.`
    : 'No installers found automatically — those apps are listed for manual download.');
});

$('btnRestoreAll').addEventListener('click', () => {
  const info = state.restoreInfo;
  const packages = info.packages;
  const dataEntries = info.dataEntries;
  const anyPackages = packages.some((p) => p.selected);
  const anyData = dataEntries.some((d) => d.selected);
  if (!anyPackages && !anyData) {
    toast('Select at least one app or data folder first.');
    return;
  }
  startRestoreFlow(anyPackages, packages, dataEntries);
});

/* ---------- restore: run ---------- */

const restoreRun = { appDone: false, dataDone: false, results: { appsOk: 0, appsFailed: 0, dataFiles: 0, errors: [] } };

function startRestoreFlow(withApps, packages, dataEntries) {
  restoreRun.appDone = !withApps;
  restoreRun.dataDone = false;
  restoreRun.results = { appsOk: 0, appsFailed: 0, dataFiles: 0, errors: [] };
  const logEl = $('restoreLog');
  logEl.innerHTML = '';
  $('restoreRunActions').innerHTML = '<button class="btn subtle danger" id="btnCancelInstall">Cancel</button>';
  $('btnCancelInstall').addEventListener('click', () => {
    window.refreshy.cancelInstall();
  });
  setPhase('apps', withApps ? 'active' : 'idle');
  setPhase('data', 'idle');
  $('restoreRunTitle').textContent = 'Installing your apps…';
  $('restoreRunSub').textContent = 'Windows may ask for permission (UAC) so installers can run — that’s normal.';
  addLogLine(`Preparing to install ${packages.filter((p) => p.selected).length} apps in one automated run…`);
  showView('restorerun');

  if (withApps && state.platform !== 'win32') {
    window.refreshy.generateInstaller(state.backupPath, packages, state.fetchedInstallers || [], unresolvedManualApps()).then((gen) => {
      if (gen.ok) {
        addLogLine(`Auto-install isn’t possible here. Run the generated installer from a terminal:\n${gen.file}`);
        addLogLine('It installs every selected app in one run.');
      } else {
        addLogLine('[err] Could not prepare the installer: ' + gen.error);
      }
      restoreRun.appDone = true;
      startDataPhaseOrFinish();
    });
    return;
  }

  if (withApps) {
    window.refreshy.generateInstaller(state.backupPath, packages, state.fetchedInstallers || [], unresolvedManualApps()).then((gen) => {
      if (!gen.ok) {
        addLogLine('[err] Could not prepare the installer: ' + gen.error);
        return;
      }
      addLogLine('One-click installer ready: ' + gen.file + (gen.count ? ` (${gen.count} installs)` : ''));
      window.refreshy.installAll(state.backupPath, packages);
    });
  } else {
    runDataPhase(dataEntries);
  }
}

window.refreshy.onInstallProgress((p) => {
  if (p.phase === 'started') addLogLine(`Installing ${p.count} apps — this can take a while ☕`);
  if (p.phase === 'line') addLogLine(p.line);
  if (p.phase === 'done' || p.phase === 'cancelled') {
    if (!restoreRun.appDone) {
      restoreRun.appDone = true;
      setPhase('apps', p.phase === 'cancelled' ? 'idle' : 'done');
      const failed = countFailures();
      restoreRun.results.appsOk = Math.max(0, failed.ok);
      restoreRun.results.appsFailed = failed.failed;
      if (p.phase === 'cancelled') {
        addLogLine('Install cancelled.');
        return finishRestore('cancelled');
      }
      addLogLine(`App installation finished — ${restoreRun.results.appsOk} ok, ${restoreRun.results.appsFailed} need attention.`);
      startDataPhaseOrFinish();
    }
  }
});

function countFailures() {
  const text = document.getElementById('restoreLog').textContent;
  const ok = (text.match(/installer OK: (\d+)/g) || []).reduce((a, s) => a + parseInt(s.replace(/\D/g, ''), 10), 0);
  const failed = (text.match(/failed: (\d+)/g) || []).reduce((a, s) => a + parseInt(s.replace(/\D/g, ''), 10), 0);
  return { ok, failed };
}

window.refreshy.onImportProgress((p) => {
  if (p.phase === 'started') {
    $('restoreRunTitle').textContent = 'Importing your data…';
    $('restoreRunSub').textContent = 'Settings, profiles and documents are being copied back into your user profile.';
  }
  if (p.phase === 'itemDone') {
    addLogLine(`Imported ${p.label}: ${p.files.toLocaleString()} files${p.errors.length ? ' (' + p.errors.length + ' skipped)' : ''}`);
    restoreRun.results.dataFiles += p.files;
    restoreRun.results.errors.push(...p.errors);
  }
  if (p.phase === 'done' && !restoreRun.dataDone) {
    restoreRun.dataDone = true;
    startDataPhaseOrFinish(true);
  }
});

function startDataPhase(entries) {
  setPhase('data', 'active');
  $('restoreRunTitle').textContent = 'Importing your data…';
  window.refreshy.importData(state.backupPath, entries);
}

function startDataPhaseOrFinish(fromDataWatcher) {
  if (!restoreRun.dataDone && !fromDataWatcher) {
    const entries = state.restoreInfo.dataEntries.filter((d) => d.selected);
    if (entries.length) {
      startDataPhase(entries);
      return;
    }
    restoreRun.dataDone = true;
  }
  if (restoreRun.appDone && restoreRun.dataDone) {
    finishRestore('ok');
  }
}

function finishRestore(status) {
  setPhase('data', restoreRun.dataDone ? 'done' : 'idle');
  setPhase('apps', restoreRun.appDone ? 'done' : 'idle');
  if (status === 'cancelled') {
    $('doneRestoreIcon').className = 'big-check warn';
    $('doneRestoreIcon').innerHTML = '<i class="icon i-warning"></i>';
    $('doneRestoreText').textContent = 'Restore was cancelled. You can start again anytime — nothing was removed.';
    showView('donerestore');
    return;
  }
  const r = restoreRun.results;
  let text = '';
  if (r.appsOk || r.appsFailed) text += `${r.appsOk} apps installed, ${r.appsFailed} need attention. `;
  if (r.dataFiles) text += `${r.dataFiles.toLocaleString()} data files imported. `;
  text += 'Sign in to your apps to pick up where you left off.';
  const icon = $('doneRestoreIcon');
  icon.className = 'big-check ok';
  icon.innerHTML = '<i class="icon i-check"></i>';
  $('doneRestoreText').textContent = text || 'Nothing was selected, so there was nothing to restore.';
  showView('donerestore');
}

function setPhase(which, mode) {
  const el = $(which === 'apps' ? 'phaseApps' : 'phaseData');
  el.classList.toggle('active', mode === 'active');
  el.classList.toggle('done', mode === 'done');
}

let lastLogDate = '';
function addLogLine(line) {
  const el = $('restoreLog');
  if (!el) return;
  const d = document.createElement('div');
  const isErr = line.startsWith('[err]');
  const isOk = /Installed OK|=== Installing|Imported /.test(line);
  if (isErr) d.className = 'err';
  if (isOk && !isErr) d.className = 'ok';
  d.textContent = line;
  el.appendChild(d);
  while (el.childElementCount > 500) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
  lastLogDate = line;
}

function unresolvedManualApps() {
  return ((state.restoreInfo && state.restoreInfo.manualApps) || [])
    .filter((m) => !m.matchedId && m.status !== 'downloaded')
    .map((m) => ({ name: m.name, version: m.version, publisher: m.publisher }));
}

window.refreshy.onAiProgress((p) => {
  if (p.phase === 'resolving') {
    $('manualHint').textContent = `Searching the official site for ${p.app}…`;
  } else if (p.phase === 'downloading') {
    $('manualHint').textContent = `Downloading installer for ${p.app}…`;
  } else if (p.phase === 'download' && p.total) {
    const pct = Math.round((p.received / p.total) * 100);
    $('manualHint').textContent = `Downloading installer for ${p.app}… ${pct}%`;
  }
});

/* ---------- misc ---------- */

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function initTheme() {
  const theme = await window.refreshy.theme();
  document.body.classList.toggle('light', theme === 'light');
  document.body.classList.toggle('dark', theme !== 'light');
}

async function initWindowButtons() {
  const plat = (await window.refreshy.platform()).platform;
  if (plat !== 'win32') {
    $('customWindowButtons').hidden = false;
    $('btnMin').classList.add('min');
    $('btnMax').classList.add('max');
    $('btnClose').classList.add('close');
    $('btnMin').addEventListener('click', () => window.refreshy.minimize());
    $('btnMax').addEventListener('click', () => window.refreshy.maximize());
    $('btnClose').addEventListener('click', () => window.refreshy.closeWindow());
  }
}

initTheme();
initWindowButtons();
initOsGrid();
window.refreshy.platform().then((p) => { state.platform = p.platform; });
if (window.refreshy.version) {
  window.refreshy.version().then((v) => {
    const el = $('versionStamp');
    if (el) el.textContent = 'Refreshy v' + v + ' \u2014 if this is not the newest version, rebuild: git pull && npm run dist';
  }).catch(() => {});
}
