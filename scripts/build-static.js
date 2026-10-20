/**
 * Builds the static site (no server needed) into ./dist-static.
 *
 *   node scripts/build-static.js [--base /nexus] [--out dist-static]
 *
 *   --base   URL path the site is served under. GitHub *project* pages live under "/<repo-name>";
 *            use "" (default) for a user/organisation page, a custom domain, or Vercel.
 *
 * Inputs: public/ (pages, css, js), static/site-data.json (from `npm run export:data`),
 *         static/static-shim.js, static/config.json, static/uploads/.
 */
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const lib = require('./lib/static-build');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const argVal = (name, def) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : def;
};
const base = lib.normalizeBase(argVal('--base', ''));
const out = path.resolve(root, argVal('--out', 'dist-static'));

// Pages and assets that need a server and therefore are not part of the static site.
const EXCLUDE = new Set(['admin', 'uploads', 'unsubscribe.html', 'confirm.html', 'token-action.js', 'robots.txt']);

function copyDir(src, dst, rel = '') {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (!rel && EXCLUDE.has(e.name)) continue;
    if (rel === 'js' && EXCLUDE.has(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) {
      copyDir(s, d, rel ? `${rel}/${e.name}` : e.name);
      continue;
    }
    if (e.name.endsWith('.html')) {
      fs.writeFileSync(d, lib.transformHtml(fs.readFileSync(s, 'utf8'), base, config, version));
    } else if (e.name.endsWith('.js')) {
      fs.writeFileSync(d, lib.rewriteAssetPaths(lib.rewritePathnameUsage(fs.readFileSync(s, 'utf8')), base));
    } else if (e.name.endsWith('.css')) {
      fs.writeFileSync(d, lib.rewriteAssetPaths(fs.readFileSync(s, 'utf8'), base));
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

// Version = hash of everything that ends up in the site, so URLs change exactly when content changes.
function contentVersion() {
  const h = crypto.createHash('sha1');
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['admin', 'uploads', 'node_modules'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else h.update(e.name).update(fs.readFileSync(p));
    }
  })(path.join(root, 'public'));
  for (const f of ['static-shim.js', 'site-data.json', 'config.json']) h.update(fs.readFileSync(path.join(root, 'static', f)));
  h.update(fs.readFileSync(path.join(__dirname, 'lib', 'static-build.js')));
  return h.digest('hex').slice(0, 10);
}

const dataPath = path.join(root, 'static', 'site-data.json');
if (!fs.existsSync(dataPath)) {
  console.error('static/site-data.json is missing. Run "npm run export:data" first (site must be running).');
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'static', 'config.json'), 'utf8'));
// Only what the browser shim needs; siteUrl stays build-side.
const config = {
  contactEndpoint: cfg.contactEndpoint || '',
  contactExtraFields: cfg.contactExtraFields || {},
  contactEmail: cfg.contactEmail || '',
};
const siteUrl = String(argVal('--site-url', cfg.siteUrl || '')).replace(/\/+$/, '');

const version = contentVersion();
fs.rmSync(out, { recursive: true, force: true });
copyDir(path.join(root, 'public'), out);

fs.mkdirSync(path.join(out, 'js'), { recursive: true });
fs.copyFileSync(path.join(root, 'static', 'static-shim.js'), path.join(out, 'js', 'static-shim.js'));

const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
fs.mkdirSync(path.join(out, 'data'), { recursive: true });
fs.writeFileSync(path.join(out, 'data', 'site-data.json'), JSON.stringify(lib.prefixDeep(data, base)));

const upDir = path.join(root, 'static', 'uploads');
if (fs.existsSync(upDir)) {
  fs.mkdirSync(path.join(out, 'uploads'), { recursive: true });
  for (const f of fs.readdirSync(upDir)) {
    if (f !== '.gitkeep') fs.copyFileSync(path.join(upDir, f), path.join(out, 'uploads', f));
  }
}

fs.writeFileSync(
  path.join(out, 'sitemap.xml'),
  lib.buildSitemap(siteUrl, {
    services: data.services.map((s) => s.slug),
    projects: data.projects.map((p) => p.slug),
    posts: data.blogPosts.map((p) => p.slug),
  })
);
fs.writeFileSync(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`);
fs.writeFileSync(path.join(out, '.nojekyll'), '');
if (fs.existsSync(path.join(root, 'static', 'CNAME'))) {
  fs.copyFileSync(path.join(root, 'static', 'CNAME'), path.join(out, 'CNAME'));
}
fs.writeFileSync(
  path.join(out, '404.html'),
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found</title></head>` +
    `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>Page not found</h1><p><a href="${base}/">Back to the home page</a></p></body></html>\n`
);

console.log(`Static site built in ${path.relative(root, out)}/ (base path: "${base || '/'}", version ${version})`);
