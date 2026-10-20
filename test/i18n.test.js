const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { I18N_LOCALES, getAllKeys, getSeedStringsForLocale } = require('../server/i18n-seeds');
const FIXES = require('../server/i18n-fixes');

const publicDir = path.join(__dirname, '..', 'public');

function collectUsedKeys() {
  const used = new Set();
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['uploads', 'admin', 'img'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(html|js)$/.test(e.name)) {
        const s = fs.readFileSync(p, 'utf8');
        for (const m of s.matchAll(/data-i18n(?:-placeholder|-aria|-html)?="([^"]+)"/g)) used.add(m[1]);
        for (const m of s.matchAll(/\b(?:T|msg|t)\(\s*["'`]([a-z0-9_.]+)["'`]/gi)) used.add(m[1]);
      }
    }
  })(publicDir);
  return used;
}

test('every translation key used by the pages exists', () => {
  const catalog = new Set(getAllKeys());
  // keys ending in "_" or "." are prefixes of dynamically built keys (e.g. "contact.err_" + code)
  const missing = [...collectUsedKeys()].filter((k) => !/[_.]$/.test(k) && !catalog.has(k));
  assert.deepEqual(missing, []);
});

test('every locale has a non-empty value for every key', () => {
  for (const loc of I18N_LOCALES) {
    const strings = getSeedStringsForLocale(loc);
    for (const key of getAllKeys()) {
      assert.ok(String(strings[key] || '').trim(), `${loc} is missing "${key}"`);
    }
  }
});

test('placeholders such as {page} are kept in every language', () => {
  const en = getSeedStringsForLocale('en');
  for (const key of getAllKeys()) {
    const tokens = (en[key].match(/\{\w+\}/g) || []).sort().join(',');
    for (const loc of I18N_LOCALES) {
      const got = (getSeedStringsForLocale(loc)[key].match(/\{\w+\}/g) || []).sort().join(',');
      assert.equal(got, tokens, `${loc}:${key} must keep ${tokens || 'no placeholders'}`);
    }
  }
});

test('known spelling mistakes are gone', () => {
  const all = I18N_LOCALES.flatMap((l) => Object.values(getSeedStringsForLocale(l))).join('\n');
  for (const bad of ['plurdisciplinaire', 'Capabilités', 'Quienes hay']) {
    assert.ok(!all.includes(bad), `"${bad}" must not appear`);
  }
});

test('translation corrections only touch existing keys and locales', () => {
  const keys = new Set(getAllKeys());
  for (const f of FIXES) {
    assert.ok(keys.has(f.key) && I18N_LOCALES.includes(f.locale), `${f.locale}:${f.key}`);
    assert.equal(getSeedStringsForLocale(f.locale)[f.key], f.to);
  }
});

test('every language has a flag file and is offered by the language picker', () => {
  const shell = fs.readFileSync(path.join(publicDir, 'js', 'shell.js'), 'utf8');
  const flagMap = /const FLAG_FILES = \{([^}]*)\}/.exec(shell)[1];
  for (const loc of I18N_LOCALES) {
    const m = new RegExp('(?:^|[ ,])' + loc + ': *"([a-z]+)"').exec(flagMap);
    assert.ok(m, `no flag mapped for ${loc}`);
    assert.ok(fs.existsSync(path.join(publicDir, 'img', 'flags', m[1] + '.svg')), `missing flag file for ${loc}`);
    assert.ok(shell.includes(`code: "${loc}"`), `${loc} is not in LANG_OPTIONS`);
  }
});

test('right-to-left languages flip the page direction', () => {
  const i18n = fs.readFileSync(path.join(publicDir, 'js', 'i18n.js'), 'utf8');
  assert.ok(/RTL_LOCALES = \[[^\]]*'he'/.test(i18n));
  assert.ok(i18n.includes("'dir'"));
});
