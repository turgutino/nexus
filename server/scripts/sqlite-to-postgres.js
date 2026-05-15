/**
 * One-off import from legacy SQLite (data/app.db) into PostgreSQL.
 * Loads .env from project root (via ../pg-config).
 *
 * Usage: node server/scripts/sqlite-to-postgres.js [path/to/app.db]
 */
const fs = require('fs');
const path = require('path');
const { getPoolOptions } = require('../pg-config');
const { Pool } = require('pg');

const argDb = process.argv[2];
const sqlitePath = argDb
  ? path.resolve(argDb)
  : path.join(__dirname, '..', '..', 'data', 'app.db');

if (!fs.existsSync(sqlitePath)) {
  console.error('SQLite file not found:', sqlitePath);
  process.exit(1);
}

let Database;
try {
  Database = require('better-sqlite3');
} catch {
  console.error('Install better-sqlite3: npm install better-sqlite3');
  process.exit(1);
}

const pool = new Pool(getPoolOptions());
const sqlite = new Database(sqlitePath, { readonly: true });

function sqliteColumns(table) {
  return sqlite.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

async function q(text, params = []) {
  return pool.query(text, params);
}

async function assertDbConnection() {
  try {
    await pool.query('SELECT 1 AS ok');
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.error('PostgreSQL connection failed:', msg);
    console.error(
      'Check .env: DB_USER must match Docker POSTGRES_USER (usually "postgres"), ' +
        'DB_PASSWORD must match POSTGRES_PASSWORD. Or set DATABASE_URL. ' +
        'Ensure dotenv loads (run from project root: npm run import:sqlite).'
    );
    throw err;
  }
}

async function resetPublicData() {
  await q(
    'TRUNCATE translations, blog_posts, blog_categories, projects, contact_messages, team_members, services, page_seo, site_kv RESTART IDENTITY CASCADE'
  );
  await q('DELETE FROM admin_user WHERE id = 1');
}

async function copyKv() {
  const rows = sqlite.prepare('SELECT key, value FROM site_kv').all();
  for (const r of rows) {
    await q('INSERT INTO site_kv (key, value) VALUES ($1, $2)', [r.key, r.value]);
  }
}

async function copyAdmin() {
  const r = sqlite.prepare('SELECT id, username, password_hash FROM admin_user WHERE id = 1').get();
  if (r) {
    await q('INSERT INTO admin_user (id, username, password_hash) VALUES ($1, $2, $3)', [
      r.id,
      r.username,
      r.password_hash,
    ]);
  }
}

async function copyServices() {
  const rows = sqlite.prepare(`SELECT * FROM services ORDER BY id`).all();
  for (const r of rows) {
    if (r.created_at != null && r.updated_at != null) {
      await q(
        `INSERT INTO services (title, slug, short_desc, long_desc, icon, image, sort_order, featured, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          r.title,
          r.slug,
          r.short_desc,
          r.long_desc,
          r.icon,
          r.image,
          r.sort_order,
          r.featured,
          r.created_at,
          r.updated_at,
        ]
      );
    } else {
      await q(
        `INSERT INTO services (title, slug, short_desc, long_desc, icon, image, sort_order, featured)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          r.title,
          r.slug,
          r.short_desc,
          r.long_desc,
          r.icon,
          r.image,
          r.sort_order,
          r.featured,
        ]
      );
    }
  }
}

async function copyTeam() {
  const rows = sqlite.prepare(`SELECT * FROM team_members ORDER BY id`).all();
  for (const r of rows) {
    if (r.created_at != null && r.updated_at != null) {
      await q(
        `INSERT INTO team_members (name, role, bio, image, sort_order, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [r.name, r.role, r.bio, r.image, r.sort_order, r.created_at, r.updated_at]
      );
    } else {
      await q(
        `INSERT INTO team_members (name, role, bio, image, sort_order) VALUES ($1,$2,$3,$4,$5)`,
        [r.name, r.role, r.bio, r.image, r.sort_order]
      );
    }
  }
}

async function copyContactMessages() {
  const cols = new Set(sqliteColumns('contact_messages'));
  const hasAttachPath = cols.has('attachment_path');
  const hasAttachName = cols.has('attachment_name');
  const sel = ['name', 'email', 'phone', 'message', 'is_read'];
  if (hasAttachPath) sel.push('attachment_path');
  if (hasAttachName) sel.push('attachment_name');
  sel.push('created_at');

  const rows = sqlite.prepare(`SELECT ${sel.join(', ')} FROM contact_messages ORDER BY id`).all();

  for (const r of rows) {
    const attachment_path = hasAttachPath ? (r.attachment_path ?? '') : '';
    const attachment_name = hasAttachName ? (r.attachment_name ?? '') : '';
    await q(
      `INSERT INTO contact_messages (name, email, phone, message, is_read, attachment_path, attachment_name, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        r.name,
        r.email,
        r.phone,
        r.message,
        r.is_read,
        attachment_path,
        attachment_name,
        r.created_at,
      ]
    );
  }
}

async function copyBlogCategories() {
  const rows = sqlite.prepare(`SELECT name, slug, sort_order FROM blog_categories ORDER BY id`).all();
  for (const r of rows) {
    await q(`INSERT INTO blog_categories (name, slug, sort_order) VALUES ($1,$2,$3)`, [
      r.name,
      r.slug,
      r.sort_order,
    ]);
  }
}

async function categoryIdMap() {
  const oldRows = sqlite.prepare(`SELECT id, slug FROM blog_categories`).all();
  const map = new Map();
  for (const o of oldRows) {
    const { rows } = await pool.query(`SELECT id FROM blog_categories WHERE slug = $1`, [o.slug]);
    if (rows[0]) map.set(o.id, rows[0].id);
  }
  return map;
}

async function copyBlogPosts() {
  const idMap = await categoryIdMap();
  const rows = sqlite.prepare(`SELECT * FROM blog_posts ORDER BY id`).all();
  for (const r of rows) {
    const categoryId = idMap.get(r.category_id);
    if (!categoryId) {
      console.warn('Skipping blog post missing category', r.slug);
      continue;
    }
    const hasTs = r.created_at != null && r.updated_at != null;
    if (hasTs) {
      await q(
        `INSERT INTO blog_posts (category_id, title, slug, excerpt, body, published, published_at, meta_title, meta_description, meta_keywords, view_count, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          categoryId,
          r.title,
          r.slug,
          r.excerpt,
          r.body,
          r.published,
          r.published_at,
          r.meta_title,
          r.meta_description,
          r.meta_keywords,
          r.view_count ?? 0,
          r.created_at,
          r.updated_at,
        ]
      );
    } else {
      await q(
        `INSERT INTO blog_posts (category_id, title, slug, excerpt, body, published, published_at, meta_title, meta_description, meta_keywords, view_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          categoryId,
          r.title,
          r.slug,
          r.excerpt,
          r.body,
          r.published,
          r.published_at,
          r.meta_title,
          r.meta_description,
          r.meta_keywords,
          r.view_count ?? 0,
        ]
      );
    }
  }
}

async function copyProjects() {
  const rows = sqlite.prepare(`SELECT * FROM projects ORDER BY id`).all();
  for (const r of rows) {
    if (r.created_at != null && r.updated_at != null) {
      await q(
        `INSERT INTO projects (kind, title, slug, short_desc, long_desc, image, link_url, featured, sort_order, view_count, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          r.kind,
          r.title,
          r.slug,
          r.short_desc,
          r.long_desc,
          r.image,
          r.link_url,
          r.featured,
          r.sort_order,
          r.view_count ?? 0,
          r.created_at,
          r.updated_at,
        ]
      );
    } else {
      await q(
        `INSERT INTO projects (kind, title, slug, short_desc, long_desc, image, link_url, featured, sort_order, view_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          r.kind,
          r.title,
          r.slug,
          r.short_desc,
          r.long_desc,
          r.image,
          r.link_url,
          r.featured,
          r.sort_order,
          r.view_count ?? 0,
        ]
      );
    }
  }
}

async function copyPageSeo() {
  const rows = sqlite
    .prepare(`SELECT path, meta_title, meta_description, meta_keywords FROM page_seo`)
    .all();
  for (const r of rows) {
    await q(
      `INSERT INTO page_seo (path, meta_title, meta_description, meta_keywords) VALUES ($1,$2,$3,$4)`,
      [r.path, r.meta_title, r.meta_description, r.meta_keywords]
    );
  }
}

async function copyTranslations() {
  const rows = sqlite
    .prepare(`SELECT locale, translation_key, value FROM translations ORDER BY id`)
    .all();
  for (const r of rows) {
    await q(`INSERT INTO translations (locale, translation_key, value) VALUES ($1,$2,$3)`, [
      r.locale,
      r.translation_key,
      r.value,
    ]);
  }
}

async function syncSequencesFixed() {
  const tables = [
    'services',
    'team_members',
    'contact_messages',
    'projects',
    'blog_categories',
    'blog_posts',
    'translations',
  ];
  for (const t of tables) {
    const { rows } = await pool.query(`SELECT MAX(id) AS m FROM ${t}`);
    const m = rows[0]?.m;
    if (m != null) {
      await pool.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), $1)`, [m]);
    } else {
      await pool.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), 1, false)`);
    }
  }
}

async function main() {
  console.log('Importing from', sqlitePath);
  await assertDbConnection();
  await resetPublicData();
  await copyKv();
  await copyAdmin();
  await copyServices();
  await copyTeam();
  await copyContactMessages();
  await copyBlogCategories();
  await copyBlogPosts();
  await copyProjects();
  await copyPageSeo();
  await copyTranslations();
  await syncSequencesFixed();
  console.log('Done. Restart the app if it is running.');
  await pool.end();
  sqlite.close();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await pool.end();
  } catch (_) {
    /* ignore */
  }
  try {
    sqlite.close();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
