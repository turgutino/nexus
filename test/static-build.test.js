const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../scripts/lib/static-build');

test('normalizeBase', () => {
  assert.equal(lib.normalizeBase(''), '');
  assert.equal(lib.normalizeBase('/'), '');
  assert.equal(lib.normalizeBase('Company-site'), '/Company-site');
  assert.equal(lib.normalizeBase('/Company-site/'), '/Company-site');
  assert.equal(lib.normalizeBase('C:/Program Files/Git/Company-site'), '/Company-site');
  assert.equal(lib.normalizeBase('/C:/Program Files/Git/Company-site'), '/Company-site');
});

test('rewriteAssetPaths prefixes site paths but not api, external or protocol-relative URLs', () => {
  const b = '/Company-site';
  const src = `<link href="/css/styles.css"><a href="/contact.html">x</a><script src="/js/a.js"></script><img src="/img/flags/us.svg">
    fetch("/api/public/site"); "//cdn.example/x.js"; "https://x.example/css/a.css"; url(/uploads/a.png) \`/blog.html?\${p}\``;
  const out = lib.rewriteAssetPaths(src, b);
  assert.ok(out.includes('href="/Company-site/css/styles.css"'));
  assert.ok(out.includes('href="/Company-site/contact.html"'));
  assert.ok(out.includes('src="/Company-site/js/a.js"'));
  assert.ok(out.includes('url(/Company-site/uploads/a.png)'));
  assert.ok(out.includes('src="/Company-site/img/flags/us.svg"'));
  assert.ok(out.includes('`/Company-site/blog.html?'));
  assert.ok(out.includes('fetch("/api/public/site")'));
  assert.ok(out.includes('"//cdn.example/x.js"'));
  assert.ok(out.includes('"https://x.example/css/a.css"'));
  assert.equal(lib.rewriteAssetPaths(src, ''), src);
});

test('prefixDeep only touches path-like strings', () => {
  const out = lib.prefixDeep(
    { image: '/uploads/a.png', link: '/services.html', text: '/ not a path', ext: 'https://a.example', arr: ['/about.html', 'x'] },
    '/Company-site'
  );
  assert.equal(out.image, '/Company-site/uploads/a.png');
  assert.equal(out.link, '/Company-site/services.html');
  assert.equal(out.text, '/ not a path');
  assert.equal(out.ext, 'https://a.example');
  assert.deepEqual(out.arr, ['/Company-site/about.html', 'x']);
});

test('transformHtml injects the shim before the first script and escapes config', () => {
  const html = '<html><head></head><body><script src="/js/i18n.js"></script></body></html>';
  const out = lib.transformHtml(html, '/Company-site', { contactEmail: '</script><b>' });
  assert.ok(out.indexOf('static-shim.js') < out.indexOf('i18n.js'));
  assert.ok(!out.includes('</script><b>'));
  assert.ok(out.includes('src="/Company-site/js/i18n.js"'));
  assert.ok(out.includes('footer-newsletter'));
});

test('pathname usage is redirected through the shim', () => {
  assert.equal(lib.rewritePathnameUsage('var p = window.location.pathname;'), 'var p = window.__pagePath();');
});

test('sitemap escapes and uses the site url', () => {
  const xml = lib.buildSitemap('https://x.example/app/', { posts: ['a&b'] });
  assert.ok(xml.includes('<loc>https://x.example/app/</loc>'));
  assert.ok(xml.includes('post.html?slug=a%26b'));
});

test('static build removes the admin footer link and renames the heading', () => {
  const html =
    '<head></head><div class="footer-col"><h4 data-i18n="footer.admin">Admin</h4><ul>' +
    '<li><a href="/admin/" data-i18n="footer.content_admin">Content admin</a></li>' +
    '<li><a href="/contact.html" data-i18n="nav.contact">Contact</a></li></ul></div><script></script>';
  const out = lib.transformHtml(html, '', {});
  assert.ok(!out.includes('/admin/'));
  assert.ok(!out.includes('footer.admin'));
  assert.ok(out.includes('<h4 data-i18n="nav.contact">Contact</h4>'));
  assert.ok(out.includes('href="/contact.html"'));
});

test('lines tagged static:keep are not rewritten', () => {
  const kept = 'a = "/about.html"; // static:keep';
  const moved = 'b = "/about.html";';
  const out = lib.rewriteAssetPaths([kept, moved].join(String.fromCharCode(10)), '/nexus').split(String.fromCharCode(10));
  assert.equal(out[0], kept);
  assert.equal(out[1], 'b = "/nexus/about.html";');
});

test('addVersion tags local scripts, styles and icons but not external or api URLs', () => {
  const html = '<link rel="stylesheet" href="/nexus/css/styles.css"><link href="https://fonts.googleapis.com/css2?x=1" rel="stylesheet">' +
    '<link rel="icon" href="/nexus/img/logo.svg"><script src="/nexus/js/app.js"></script><a href="/nexus/blog.html">b</a>';
  const out = lib.addVersion(html, 'abc123');
  assert.ok(out.includes('href="/nexus/css/styles.css?v=abc123"'));
  assert.ok(out.includes('href="/nexus/img/logo.svg?v=abc123"'));
  assert.ok(out.includes('src="/nexus/js/app.js?v=abc123"'));
  assert.ok(out.includes('href="https://fonts.googleapis.com/css2?x=1"'));
  assert.ok(out.includes('href="/nexus/blog.html"'));
  assert.equal(lib.addVersion(html, ''), html);
});
