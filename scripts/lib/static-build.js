// Pure helpers for the static (GitHub Pages / Vercel) build. No filesystem access, so they are unit-testable.

const PAGES = ['index', 'about', 'contact', 'services', 'service', 'projects', 'project', 'team', 'blog', 'post'];

/**
 * Normalizes "--base" input: '' for root hosting, otherwise '/Name' (leading slash, no trailing slash).
 * Git Bash on Windows rewrites a leading "/Name" argument into "C:/Program Files/Git/Name"; that case is repaired.
 */
function normalizeBase(raw) {
  let b = String(raw || '').trim().split(String.fromCharCode(92)).join('/');
  if (/^\/?[A-Za-z]:\//.test(b)) b = b.split('/').filter(Boolean).pop();
  if (!b || b === '/') return '';
  if (!b.startsWith('/')) b = `/${b}`;
  return b.replace(/\/+$/, '');
}

/**
 * Prefixes absolute site paths ("/css/…", "/js/…", "/img/…", "/data/…", "/uploads/…", "/about.html") that appear
 * inside quotes or url(…) with the hosting base path. "/api/…" is intentionally left alone: the browser shim
 * intercepts those calls.
 */
function rewriteAssetPaths(text, base) {
  if (!base) return text;
  const re = new RegExp('(["\'`(])/(?=(?:css|js|img|data|uploads)/|(?:' + PAGES.join('|') + ')\.html)', 'g');
  return text.replace(re, `$1${base}/`);
}

/** Pages read location.pathname; with a base path they must see the path relative to the base. */
function rewritePathnameUsage(js) {
  return js.replace(/window\.location\.pathname/g, 'window.__pagePath()');
}

/** Deep-prefixes strings that look like site paths ("/uploads/a.png", "/services.html?x=1") in exported data. */
function prefixDeep(value, base) {
  if (!base) return value;
  if (typeof value === 'string') {
    return /^\/(?!\/)[\w./~%-]*(\?[^\s]*)?$/.test(value) ? `${base}${value}` : value;
  }
  if (Array.isArray(value)) return value.map((v) => prefixDeep(v, base));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = prefixDeep(v, base);
    return out;
  }
  return value;
}

function escapeForInlineScript(json) {
  // Keep user-controlled config from closing the <script> element or breaking out of it.
  const BACKSLASH = String.fromCharCode(92);
  const unsafe = new RegExp('[<>&' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');
  return json.replace(unsafe, (c) => BACKSLASH + 'u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

/** Injects the browser shim before the first script tag and the static-mode CSS before </head>. */
function transformHtml(html, base, config) {
  const cfg = escapeForInlineScript(JSON.stringify(config || {}));
  const shim =
    `<script>window.__STATIC_BASE__=${JSON.stringify(base)};window.__STATIC_CONFIG__=${cfg};</script>\n` +
    `    <script src="${base}/js/static-shim.js"></script>\n    `;
  let out = html;
  const i = out.search(/<script[\s>]/i);
  out = i === -1 ? out.replace('</body>', `${shim}</body>`) : out.slice(0, i) + shim + out.slice(i);
  const css =
    '<style>/* static build: features that need a server are hidden */' +
    '.footer-newsletter,#cookie-consent-banner,label[for="attachment"],#attachment{display:none!important}</style>';
  out = out.replace('</head>', `    ${css}\n  </head>`);
  return rewriteAssetPaths(out, base);
}

function buildSitemap(siteUrl, slugs) {
  const root = String(siteUrl || '').replace(/\/+$/, '');
  const urls = ['/', '/about.html', '/contact.html', '/services.html', '/team.html', '/projects.html', '/blog.html'];
  for (const s of slugs.services || []) urls.push(`/service.html?slug=${encodeURIComponent(s)}`);
  for (const s of slugs.projects || []) urls.push(`/project.html?slug=${encodeURIComponent(s)}`);
  for (const s of slugs.posts || []) urls.push(`/post.html?slug=${encodeURIComponent(s)}`);
  const esc = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = urls.map((u) => `  <url>\n    <loc>${esc(root + u)}</loc>\n  </url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

module.exports = {
  PAGES,
  normalizeBase,
  rewriteAssetPaths,
  rewritePathnameUsage,
  prefixDeep,
  transformHtml,
  buildSitemap,
};
