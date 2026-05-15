const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'app.db');
const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');

function ensureDirs() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
}

ensureDirs();

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS site_kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS admin_user (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      short_desc TEXT NOT NULL DEFAULT '',
      long_desc TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT 'layers',
      image TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      featured INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '',
      image TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS contact_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_services_sort ON services(sort_order);
    CREATE INDEX IF NOT EXISTS idx_team_sort ON team_members(sort_order);
    CREATE INDEX IF NOT EXISTS idx_contact_created ON contact_messages(created_at DESC);
  `);
}

function seedIfEmpty() {
  const adminExists = db.prepare('SELECT 1 FROM admin_user WHERE id = 1').get();
  const defaultUser = process.env.ADMIN_USERNAME || 'admin';
  const defaultPass = process.env.ADMIN_PASSWORD || 'admin123';

  if (!adminExists) {
    const hash = bcrypt.hashSync(defaultPass, 12);
    db.prepare(
      'INSERT INTO admin_user (id, username, password_hash) VALUES (1, ?, ?)'
    ).run(defaultUser, hash);
  }

  const kvCount = db.prepare('SELECT COUNT(*) AS c FROM site_kv').get().c;
  if (kvCount === 0) {
    const defaults = {
      company_name: 'Nexus Studio',
      hero_title: 'Build bold digital experiences',
      hero_subtitle:
        'Strategy, design, and engineering that help growing companies ship products customers love—on time and on brand.',
      hero_image: '',
      hero_cta_primary_text: 'View services',
      hero_cta_primary_link: '/services.html',
      hero_cta_secondary_text: 'Contact us',
      hero_cta_secondary_link: '/contact.html',
      home_about_title: 'About our studio',
      home_about_text:
        'We are a multidisciplinary team focused on clarity, performance, and outcomes. From discovery to launch, we partner closely with you.',
      home_about_image: '',
      about_page_title: 'Our story',
      about_page_lead:
        'Founded on the belief that great products start with great collaboration.',
      about_page_body:
        'We blend research, design systems, and modern engineering to deliver scalable web experiences. Our process is transparent, measurable, and built around your goals.\n\nWhether you need a new marketing site, a product interface, or ongoing optimization—we bring senior-level craft without enterprise overhead.',
      about_mission:
        'Empower teams to ship high-quality digital products with confidence.',
      about_values:
        'Clarity, accountability, accessibility, performance, and long-term maintainability.',
      footer_tagline: '© Nexus Studio. Crafted with care for ambitious teams.',
      banners_json: JSON.stringify([
        {
          image: '',
          title: 'Launch-ready websites',
          subtitle: 'Performance-first builds that scale with your business.',
          link: '/services.html',
          linkText: 'Explore services',
        },
        {
          image: '',
          title: 'Design systems that stick',
          subtitle: 'Cohesive UI patterns for faster iterations.',
          link: '/team.html',
          linkText: 'Meet the team',
        },
      ]),
    };
    const ins = db.prepare('INSERT INTO site_kv (key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(defaults)) {
      ins.run(k, v);
    }
  }

  const svcCount = db.prepare('SELECT COUNT(*) AS c FROM services').get().c;
  if (svcCount === 0) {
    const rows = [
      [
        'Strategy & discovery',
        'strategy-discovery',
        'Workshops, roadmaps, and prioritization grounded in user evidence.',
        'We align stakeholders, clarify outcomes, and define a pragmatic plan. Deliverables include UX audits, technical feasibility notes, and a milestone roadmap your team can execute against.',
        'compass',
        '',
        1,
        1,
      ],
      [
        'Product design',
        'product-design',
        'Interfaces that feel effortless—accessible, responsive, and on-brand.',
        'From wireframes to high-fidelity UI, we craft flows that reduce friction. We document components and states so engineering can move quickly without guesswork.',
        'pen',
        '',
        2,
        1,
      ],
      [
        'Web development',
        'web-development',
        'Fast, secure frontends with clean architecture and observability.',
        'We ship production-ready builds with performance budgets, sensible security defaults, and maintainable code structure—ready for your next phase of growth.',
        'code',
        '',
        3,
        1,
      ],
    ];
    const insert = db.prepare(`
      INSERT INTO services (title, slug, short_desc, long_desc, icon, image, sort_order, featured)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of rows) insert.run(...r);
  }

  const teamCount = db.prepare('SELECT COUNT(*) AS c FROM team_members').get().c;
  if (teamCount === 0) {
    const t = [
      ['Alex Rivera', 'Founder & Creative Director', 'Leads vision, brand, and client partnerships.', '', 1],
      ['Jordan Lee', 'Lead Engineer', 'Architecture, performance, and developer experience.', '', 2],
      ['Sam Patel', 'Product Designer', 'Research, UX flows, and interface craft.', '', 3],
    ];
    const insert = db.prepare(`
      INSERT INTO team_members (name, role, bio, image, sort_order) VALUES (?, ?, ?, ?, ?)
    `);
    for (const row of t) insert.run(...row);
  }
}

initSchema();
seedIfEmpty();

function getKvMap() {
  const rows = db.prepare('SELECT key, value FROM site_kv').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

function setKv(key, value) {
  db.prepare(
    `
    INSERT INTO site_kv (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `
  ).run(key, value);
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = {
  db,
  uploadsDir,
  getKvMap,
  setKv,
  slugify,
};
