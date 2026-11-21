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
  assert(script.includes('"Microsoft.VisualStudioCode"'), 'script has id');
  assert(!script.includes('; evil'), 'script injection neutralized');
  assert(script.includes('$backupRoot = "E:\\Refreshy-PC\\"'), 'backup root line');

  const sh = restore.linuxShellScript([{ id: 'org.mozilla.firefox' }], '/mnt/b', 'ubuntu');
  assert(sh.includes('flatpak install'), 'linux script uses flatpak');

  console.log('ALL LOGIC TESTS PASSED');
  fs.rmSync(tmp, { recursive: true, force: true });
}).catch((e) => { console.error('TEST FAILED', e); process.exit(1); });
