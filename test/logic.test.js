'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { buildMatchers, isExcluded, copyTree, pruneEmptyDirs, dirSize } = require('../src/lib/backup');
const { DEFAULT_EXCLUSIONS } = require('../src/lib/paths');
const restore = require('../src/lib/restore');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'refy-'));
const src = path.join(tmp, 'src');
fs.mkdirSync(path.join(src, 'Temp'), { recursive: true });
fs.mkdirSync(path.join(src, 'App', 'Cache'), { recursive: true });
fs.mkdirSync(path.join(src, 'App', 'settings'), { recursive: true });
fs.mkdirSync(path.join(src, 'Vendor', 'Temp'), { recursive: true });
fs.writeFileSync(path.join(src, 'keep.ini'), 'x'.repeat(100));
fs.writeFileSync(path.join(src, 'App', 'settings', 'conf.json'), 'y'.repeat(2000));
fs.writeFileSync(path.join(src, 'Temp', 'junk.tmp'), 'z'.repeat(5000));
fs.writeFileSync(path.join(src, 'App', 'Cache', 'blob'), 'w'.repeat(3000));
fs.writeFileSync(path.join(src, 'Vendor', 'Temp', 'junk2'), 'q'.repeat(100));
fs.writeFileSync(path.join(src, 'Thumbs.db'), 't');

const matchers = buildMatchers(DEFAULT_EXCLUSIONS);
assert(isExcluded('Temp/junk.tmp', 'junk.tmp', matchers), 'root Temp excluded');
assert(isExcluded('Vendor/Temp/junk2', 'junk2', matchers), 'nested Temp excluded');
assert(isExcluded('App/Cache/blob', 'blob', matchers), 'Cache excluded');
assert(isExcluded('Thumbs.db', 'Thumbs.db', matchers), 'Thumbs.db excluded');
assert(!isExcluded('App/settings/conf.json', 'conf.json', matchers), 'keep settings');
assert(!isExcluded('keep.ini', 'keep.ini', matchers), 'keep ini');

const dest = path.join(tmp, 'dest');
const progress = { cancelled: false, files: 0, bytes: 0, skipped: [], taskBytes: {}, maybeEmit() {}, emit() {} };
copyTree(src, dest, matchers, progress, 'test').then(async () => {
  await pruneEmptyDirs(dest);
  assert(fs.existsSync(path.join(dest, 'App', 'settings', 'conf.json')), 'copied settings');
  assert(fs.existsSync(path.join(dest, 'keep.ini')), 'copied ini');
  assert(!fs.existsSync(path.join(dest, 'Temp')), 'no Temp dir');
  assert(!fs.existsSync(path.join(dest, 'App', 'Cache')), 'no Cache dir');
  assert(!fs.existsSync(path.join(dest, 'Vendor')), 'no Vendor (all Temp)');

  const size = await dirSize(src, matchers);
  assert.strictEqual(size.files, 2, 'dirSize counts 2 kept files');
  assert.strictEqual(size.bytes, 2100, 'dirSize sums kept bytes');

  const script = restore.wingetInstallAllScript(
    [{ id: "Git.Git' ; evil" }, { id: 'Microsoft.VisualStudioCode' }],
    'E:\\Refreshy-PC\\'
  );
  assert(script.includes("'Microsoft.VisualStudioCode'"), 'script has id');
  assert(!script.includes('; evil'), 'script injection neutralized');
  assert(script.includes('"already installed"'), 'already-installed counts as success');

  const withInstallers = restore.wingetInstallAllScript(
    [{ id: 'Git.Git' }],
    'E:\\Refreshy-PC\\',
    [
      { name: 'SomeTool', file: 'SomeTool_setup.exe', args: '/S' },
      { name: 'MSI thing', file: 'tool.msi', args: '/qn' }
    ],
    [{ name: 'Sketchy App', version: '1.2', publisher: 'Sky' }]
  );
  assert(withInstallers.includes("Join-Path $installersDir 'SomeTool_setup.exe'"), 'installer file referenced');
  assert(withInstallers.includes('msiexec.exe'), 'msi handled via msiexec');
  assert(withInstallers.includes('/VERYSILENT /NORESTART'), 'fallback silent flag present');
  assert(withInstallers.includes('  - Sketchy App (v1.2)'), 'manual apps listed');

  const manualTxt = restore.manualAppsText([{ name: 'Sketchy App', version: '1.2', publisher: 'Sky' }]);
  assert(manualTxt.includes('- Sketchy App (v1.2) - Sky'), 'manual text lists app');

  const { parseWingetSearchTable } = require('../src/lib/ps');
  const table = [
    'Name               Id                  Version   Matched',
    '-----------------  ------------------  --------  -------',
    'Git                Git.Git             2.50.0    <Git>',
    'Visual Studio Code Microsoft.VisualStudioCode 1.2.3',
    ''
  ].join('\n');
  const parsed = parseWingetSearchTable(table);
  assert.strictEqual(parsed.length, 2, 'parses two rows');
  assert.strictEqual(parsed[0].id, 'Git.Git', 'parses id');
  assert.strictEqual(parsed[1].id, 'Microsoft.VisualStudioCode', 'parses id without version col');
  assert.strictEqual(parseWingetSearchTable('no table here').length, 0, 'handles empty');

  const ai = require('../src/lib/ai');
  assert.deepStrictEqual(
    ai.parseJsonField('{"urls": ["https://x.com/dl", "nope"]}'),
    ['https://x.com/dl'],
    'parses json urls field'
  );
  assert.strictEqual(
    ai.filterInstallerLinks('https://x.com/page', ['https://x.com/files/setup.exe', 'https://x.com/about', 'ftp://y/tmp.exe']).length,
    1,
    'filters direct installer links'
  );

  const installers = require('../src/lib/installers');
  assert.strictEqual(installers.silentArgsFor('https://x.com/setup.msi'), '/qn /norestart', 'msi silent args');
  assert(installers.safeFileName({ name: 'My Tool (x64)' }, 'https://x.com/get/installer?file=setup9.exe').endsWith('.exe'), 'safe file name');

  const sh = restore.linuxShellScript([{ id: 'org.mozilla.firefox' }], '/mnt/b', 'ubuntu');
  assert(sh.includes('flatpak install'), 'linux script uses flatpak');

  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');
  assert(/\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(css),
    'CSS guard present: author display rules must not override the hidden attribute\n'
    + '(a full-window .overlay with opacity:0 once swallowed every click)');

  console.log('ALL LOGIC TESTS PASSED');
  fs.rmSync(tmp, { recursive: true, force: true });
}).catch((e) => { console.error('TEST FAILED', e); process.exit(1); });
