/**
 * Exports the live site content to static/site-data.json (+ referenced images to static/uploads/)
 * so it can be published on static hosting (GitHub Pages / Vercel).
 *
 *   1. Start the site locally (docker compose up -d) and make sure the content looks right.
 *   2. node scripts/export-data.js            (or: npm run export:data)
 *        --server http://localhost:3000       where the running site is
 *
 * Only public content is read, through the public API. Nothing private (messages, subscribers, admin data)
 * is exported.
 */
const fs = require('fs');
const path = require('path');
const { I18N_LOCALES } = require('../server/i18n-seeds');

const args = process.argv.slice(2);
const argVal = (name, def) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};
const SERVER = argVal('--server', 'http://localhost:3000').replace(/\/+$/, '');
const OUT_DIR = path.join(__dirname, '..', 'static');
const PAGE_PATHS = ['/', '/index.html', '/about.html', '/contact.html', '/services.html', '/service.html', '/projects.html', '/project.html', '/team.html', '/blog.html', '/post.html'];

// The "X-Static-Export" header tells the server not to count these requests as page views.
async function get(urlPath) {
  const r = await fetch(SERVER + urlPath, { headers: { 'X-Static-Export': '1' } });
  if (!r.ok) throw new Error(`GET ${urlPath} -> ${r.status}`);
  return r;
}
const getJson = async (urlPath) => (await get(urlPath)).json();

function collectUploads(value, set) {
  if (typeof value === 'string') {
    const m = /^\/uploads\/([\w.-]+)$/.exec(value);
    if (m) set.add(m[1]);
  } else if (Array.isArray(value)) value.forEach((v) => collectUploads(v, set));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectUploads(v, set));
}

async function main() {
  console.log(`Exporting from ${SERVER} ...`);
  const data = { exportedAt: new Date().toISOString(), sites: {}, translations: {} };

  for (const loc of I18N_LOCALES) {
    const site = await getJson(`/api/public/site?lang=${encodeURIComponent(loc)}`);
    if (!site.ok) throw new Error(`site payload failed for ${loc}`);
    data.sites[loc] = site;
    const tr = await getJson(`/api/translations/${encodeURIComponent(loc)}`);
    data.translations[loc] = tr.strings || {};
  }
  const first = data.sites[I18N_LOCALES[0]];
  data.defaultLocale = first.site.defaultLocale || 'en';

  data.services = (await getJson('/api/public/services')).services;
  data.projects = (await getJson('/api/public/projects')).projects;
  data.team = (await getJson('/api/public/team')).team;
  data.blogCategories = (await getJson('/api/public/blog/categories')).categories;
  data.contactPage = await getJson('/api/public/contact-page');

  // Blog: list (paged) -> full post for each slug (needs the body and the SEO fields)
  const slugs = [];
  for (let page = 1; page < 200; page += 1) {
    const l = await getJson(`/api/public/blog/posts?limit=20&page=${page}`);
    l.posts.forEach((p) => slugs.push(p.slug));
    if (page >= l.totalPages) break;
  }
  data.blogPosts = [];
  for (const slug of slugs) {
    const { post } = await getJson(`/api/public/blog/posts/${encodeURIComponent(slug)}`);
    data.blogPosts.push(post);
  }
  data.blogPosts.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)) || b.id - a.id);

  data.seo = {};
  for (const p of PAGE_PATHS) {
    const s = await getJson(`/api/public/seo?path=${encodeURIComponent(p)}`);
    if (s.ok && s.seo) data.seo[p] = s.seo;
  }

  // Images referenced by the content
  const uploads = new Set();
  collectUploads(data, uploads);
  fs.mkdirSync(path.join(OUT_DIR, 'uploads'), { recursive: true });
  for (const f of fs.readdirSync(path.join(OUT_DIR, 'uploads'))) {
    if (f !== '.gitkeep') fs.unlinkSync(path.join(OUT_DIR, 'uploads', f));
  }
  for (const name of uploads) {
    const buf = Buffer.from(await (await get(`/uploads/${name}`)).arrayBuffer());
    fs.writeFileSync(path.join(OUT_DIR, 'uploads', name), buf);
  }

  fs.writeFileSync(path.join(OUT_DIR, 'site-data.json'), JSON.stringify(data, null, 2) + '\n');
  console.log(
    `Done: ${I18N_LOCALES.length} languages, ${data.services.length} services, ${data.projects.length} projects, ` +
      `${data.team.length} team members, ${data.blogPosts.length} blog posts, ${uploads.size} images -> static/`
  );
}

main().catch((e) => {
  console.error(e.message || e);
  console.error('Is the site running? (docker compose up -d)');
  process.exit(1);
});
