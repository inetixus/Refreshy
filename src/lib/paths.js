'use strict';

const os = require('os');
const path = require('path');

const WINDOWS = process.platform === 'win32';

const PERSONAL_DIRS = {
  win32: [
    { id: 'desktop', label: 'Desktop', base: 'profile' },
    { id: 'documents', label: 'Documents', base: 'profile' },
    { id: 'pictures', label: 'Pictures', base: 'profile' },
    { id: 'videos', label: 'Videos', base: 'profile' },
    { id: 'music', label: 'Music', base: 'profile' },
    { id: 'downloads', label: 'Downloads', base: 'profile' }
  ],
  linux: [
    { id: 'desktop', label: 'Desktop', base: 'home' },
    { id: 'documents', label: 'Documents', base: 'home' },
    { id: 'pictures', label: 'Pictures', base: 'home' },
    { id: 'videos', label: 'Videos', base: 'home' },
    { id: 'music', label: 'Music', base: 'home' },
    { id: 'downloads', label: 'Downloads', base: 'home' }
  ],
  darwin: [
    { id: 'desktop', label: 'Desktop', base: 'home' },
    { id: 'documents', label: 'Documents', base: 'home' },
    { id: 'pictures', label: 'Pictures', base: 'home' },
    { id: 'movies', label: 'Movies', base: 'home' },
    { id: 'music', label: 'Music', base: 'home' },
    { id: 'downloads', label: 'Downloads', base: 'home' }
  ]
};

const APPDATA_DIRS = {
  win32: [
    {
      id: 'appdata-roaming',
      label: 'AppData\\Roaming',
      hint: 'Settings and data for most installed apps',
      base: 'appdata-roaming'
    },
    {
      id: 'appdata-local',
      label: 'AppData\\Local',
      hint: 'Largest folder — caches are skipped automatically',
      base: 'appdata-local'
    },
    {
      id: 'appdata-locallow',
      label: 'AppData\\LocalLow',
      hint: 'Low-integrity app data (rarely large)',
      base: 'appdata-local-low'
    }
  ],
  linux: [
    { id: 'config', label: '.config', hint: 'App settings (roaming equivalent)', base: 'config' },
    { id: 'local-share', label: '.local/share', hint: 'App data (flatpak, editors, browsers)', base: 'local-share' }
  ],
  darwin: [
    { id: 'application-support', label: 'Library/Application Support', hint: 'App settings and data', base: 'appdata-roaming' }
  ]
};

const DEFAULT_EXCLUSIONS = [
  '**/Temp/**',
  '**/tmp/**',
  '**/.tmp/**',
  '**/node_modules/**',
  '**/.git/**',
  '**/__pycache__/**',
  '**/Cache/**',
  '**/cache/**',
  '**/Caches/**',
  '**/Code Cache/**',
  '**/GPUCache/**',
  '**/ShaderCache/**',
  '**/DawnCache/**',
  '**/DawnGraphiteCache/**',
  '**/DawnWebGPUCache/**',
  '**/GrShaderCache/**',
  '**/Service Worker/CacheStorage/**',
  '**/CrashDumps/**',
  '**/Microsoft/Windows/INetCache/**',
  '**/Microsoft/Windows/WebCache/**',
  '**/npm-cache/**',
  '**/.npm/**',
  '**/pip/cache/**',
  '**/.cache/**',
  '**/pagefile.sys',
  '**/hiberfil.sys',
  'Thumbs.db',
  'desktop.ini',
  '**/.RefreshyTemp/**'
];

const BASE_PATHS = {
  win32: {
    'appdata-roaming': () => path.join(os.homedir(), 'AppData', 'Roaming'),
    'appdata-local': () => path.join(os.homedir(), 'AppData', 'Local'),
    'appdata-local-low': () => path.join(os.homedir(), 'AppData', 'LocalLow'),
    profile: () => os.homedir(),
    home: () => os.homedir()
  },
  linux: {
    config: () => path.join(os.homedir(), '.config'),
    'local-share': () => path.join(os.homedir(), '.local', 'share'),
    profile: () => os.homedir(),
    home: () => os.homedir()
  },
  darwin: {
    'appdata-roaming': () => path.join(os.homedir(), 'Library', 'Application Support'),
    profile: () => os.homedir(),
    home: () => os.homedir()
  }
};

function dataItems(platform) {
  const pf = platform || process.platform;
  return [...(APPDATA_DIRS[pf] || []), ...(PERSONAL_DIRS[pf] || [])];
}

function resolveBase(base, platform) {
  const pf = platform || process.platform;
  const table = BASE_PATHS[pf] || BASE_PATHS.linux;
  const fn = table[base];
  return fn ? fn() : null;
}

function defaultTargetOs(platform) {
  const pf = platform || process.platform;
  if (pf === 'win32') return { id: 'win11', label: 'Windows 11' };
  if (pf === 'darwin') return { id: 'macos', label: 'macOS' };
  return { id: 'ubuntu', label: 'Ubuntu (Linux)' };
}

function descriptionForOs(osId) {
  switch (osId) {
    case 'win11':
      return 'Best compatibility. Every app in your list can be reinstalled automatically with winget, and all AppData can be imported.';
    case 'win10':
      return 'Near-full compatibility. winget works, but some newer apps may drop Windows 10 support soon.';
    case 'ubuntu':
    case 'fedora':
    case 'debian':
    case 'arch':
      return 'Windows-specific apps cannot run natively. Browser profiles, documents and developer settings carry over easily; Refreshy will generate a Linux app script instead of winget.';
    case 'macos':
      return 'Commercial Windows apps usually need re-purchase. Browser profiles, documents and most developer tools carry over.';
    default:
      return 'Pick the system you will install so Refreshy can decide what is worth saving and what can be reinstalled automatically.';
  }
}

function linuxDistroFor(targetOsId) {
  if (targetOsId === 'ubuntu') return 'ubuntu';
  if (targetOsId === 'fedora') return 'fedora';
  if (targetOsId === 'debian') return 'debian';
  if (targetOsId === 'arch') return 'arch';
  return null;
}

module.exports = {
  WINDOWS,
  PERSONAL_DIRS,
  APPDATA_DIRS,
  DEFAULT_EXCLUSIONS,
  BASE_PATHS,
  dataItems,
  resolveBase,
  defaultTargetOs,
  descriptionForOs,
  linuxDistroFor
};
