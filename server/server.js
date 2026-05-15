const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const validator = require('validator');
const bcrypt = require('bcryptjs');

const { db, uploadsDir, getKvMap, setKv, slugify } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: true, limit: '512kb' }));

const sessionSecret =
  process.env.SESSION_SECRET || (isProd ? null : 'dev-only-change-in-production');

if (!sessionSecret) {
  console.error('Set SESSION_SECRET in production.');
  process.exit(1);
}

app.use(
  session({
    name: 'sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);

const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 25,
  message: { ok: false, error: 'Too many requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  message: { ok: false, error: 'Too many login attempts.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', publicLimiter);

function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId === 1) return next();
  return res.status(401).json({ ok: false, error: 'Unauthorized' });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 8) || '.bin';
    const safe = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    cb(null, safe);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Invalid file type'));
  },
});

function stripText(s, max) {
  return String(s ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

function parseBanners(raw) {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function publicSitePayload() {
  const kv = getKvMap();
  const banners = parseBanners(kv.banners_json).map((b) => ({
    image: b.image || '',
    title: b.title || '',
    subtitle: b.subtitle || '',
    link: b.link || '',
    linkText: b.linkText || '',
  }));
  return {
    companyName: kv.company_name || 'Company',
    hero: {
      title: kv.hero_title || '',
      subtitle: kv.hero_subtitle || '',
      image: kv.hero_image || '',
      ctaPrimary: { text: kv.hero_cta_primary_text || '', link: kv.hero_cta_primary_link || '#' },
      ctaSecondary: {
        text: kv.hero_cta_secondary_text || '',
        link: kv.hero_cta_secondary_link || '#',
      },
    },
    homeAbout: {
      title: kv.home_about_title || '',
      text: kv.home_about_text || '',
      image: kv.home_about_image || '',
    },
    aboutPage: {
      title: kv.about_page_title || '',
      lead: kv.about_page_lead || '',
      body: kv.about_page_body || '',
      mission: kv.about_mission || '',
      values: kv.about_values || '',
    },
    footerTagline: kv.footer_tagline || '',
    banners,
  };
}

app.get('/api/public/site', (_req, res) => {
  const services = db
    .prepare(
      `SELECT id, title, slug, short_desc AS shortDesc, long_desc AS longDesc, icon, image, featured
       FROM services ORDER BY sort_order ASC, id ASC`
    )
    .all();
  const team = db
    .prepare(
      `SELECT id, name, role, bio, image FROM team_members ORDER BY sort_order ASC, id ASC`
    )
    .all();
  res.json({
    ok: true,
    site: publicSitePayload(),
    services,
    teamPreview: team.slice(0, 4),
  });
});

app.get('/api/public/services', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, title, slug, short_desc AS shortDesc, long_desc AS longDesc, icon, image, featured
       FROM services ORDER BY sort_order ASC, id ASC`
    )
    .all();
  res.json({ ok: true, services: rows });
});

app.get('/api/public/services/:slug', (req, res) => {
  const slug = String(req.params.slug || '').slice(0, 120);
  const row = db
    .prepare(
      `SELECT id, title, slug, short_desc AS shortDesc, long_desc AS longDesc, icon, image, featured
       FROM services WHERE slug = ?`
    )
    .get(slug);
  if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, service: row });
});

app.get('/api/public/team', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, name, role, bio, image FROM team_members ORDER BY sort_order ASC, id ASC`
    )
    .all();
  res.json({ ok: true, team: rows });
});

app.post('/api/public/contact', contactLimiter, (req, res) => {
  const name = stripText(req.body.name, 120);
  const email = String(req.body.email || '').trim().slice(0, 120).toLowerCase();
  const phone = stripText(req.body.phone, 40);
  const message = stripText(req.body.message, 4000);

  if (!name || name.length < 2) {
    return res.status(400).json({ ok: false, error: 'Please enter your name.' });
  }
  if (!validator.isEmail(email)) {
    return res.status(400).json({ ok: false, error: 'Please enter a valid email.' });
  }
  if (!message || message.length < 10) {
    return res.status(400).json({ ok: false, error: 'Please enter a longer message.' });
  }

  db.prepare(
    `INSERT INTO contact_messages (name, email, phone, message) VALUES (?, ?, ?, ?)`
  ).run(name, email, phone, message);

  res.json({ ok: true });
});

app.post('/api/admin/login', loginLimiter, (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  const row = db.prepare('SELECT id, username, password_hash FROM admin_user WHERE id = 1').get();
  if (!row) return res.status(500).json({ ok: false, error: 'Server misconfigured' });

  const userOk = username === row.username;
  const passOk = bcrypt.compareSync(password, row.password_hash);

  if (!userOk || !passOk) {
    return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ ok: false, error: 'Session error' });
    req.session.adminId = row.id;
    res.json({ ok: true });
  });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/admin/session', (req, res) => {
  const authed = !!(req.session && req.session.adminId === 1);
  res.json({ ok: true, authed });
});

app.get('/api/admin/bootstrap', requireAdmin, (_req, res) => {
  const kv = getKvMap();
  const services = db
    .prepare(`SELECT * FROM services ORDER BY sort_order ASC, id ASC`)
    .all();
  const team = db
    .prepare(`SELECT * FROM team_members ORDER BY sort_order ASC, id ASC`)
    .all();
  const messages = db
    .prepare(
      `SELECT id, name, email, phone, message, is_read AS isRead, created_at AS createdAt
       FROM contact_messages ORDER BY id DESC LIMIT 200`
    )
    .all();

  res.json({
    ok: true,
    kv,
    services,
    team,
    messages,
  });
});

app.put('/api/admin/site', requireAdmin, (req, res) => {
  const body = req.body || {};
  const allowedKeys = new Set([
    'company_name',
    'hero_title',
    'hero_subtitle',
    'hero_image',
    'hero_cta_primary_text',
    'hero_cta_primary_link',
    'hero_cta_secondary_text',
    'hero_cta_secondary_link',
    'home_about_title',
    'home_about_text',
    'home_about_image',
    'about_page_title',
    'about_page_lead',
    'about_page_body',
    'about_mission',
    'about_values',
    'footer_tagline',
    'banners_json',
  ]);

  for (const k of Object.keys(body)) {
    if (!allowedKeys.has(k)) continue;
    let v = body[k];
    if (k === 'banners_json') {
      let parsed;
      try {
        parsed = typeof v === 'string' ? JSON.parse(v) : v;
      } catch {
        continue;
      }
      if (!Array.isArray(parsed)) continue;
      const clean = parsed.slice(0, 6).map((b) => ({
        image: String(b.image || '').slice(0, 500),
        title: stripText(b.title, 160),
        subtitle: stripText(b.subtitle, 240),
        link: String(b.link || '').slice(0, 500),
        linkText: stripText(b.linkText, 80),
      }));
      v = JSON.stringify(clean);
    } else {
      v = String(v ?? '').slice(0, 8000);
    }
    setKv(k, v);
  }

  res.json({ ok: true, site: publicSitePayload() });
});

app.post('/api/admin/services', requireAdmin, (req, res) => {
  const title = stripText(req.body.title, 160);
  let slug = String(req.body.slug || '').trim().slice(0, 120).toLowerCase();
  if (!title) return res.status(400).json({ ok: false, error: 'Title required' });
  if (!slug) slug = slugify(title);

  const short_desc = stripText(req.body.short_desc, 600);
  const long_desc = stripText(req.body.long_desc, 12000);
  const icon = stripText(req.body.icon, 40);
  const image = String(req.body.image || '').slice(0, 500);
  const sort_order = Number(req.body.sort_order) || 0;
  const featured = req.body.featured ? 1 : 0;

  try {
    const info = db
      .prepare(
        `INSERT INTO services (title, slug, short_desc, long_desc, icon, image, sort_order, featured)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(title, slug, short_desc, long_desc, icon, image, sort_order, featured);
    const row = db.prepare(`SELECT * FROM services WHERE id = ?`).get(info.lastInsertRowid);
    res.json({ ok: true, service: row });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ ok: false, error: 'Slug already exists' });
    }
    throw e;
  }
});

app.put('/api/admin/services/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare(`SELECT id FROM services WHERE id = ?`).get(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'Not found' });

  const title = stripText(req.body.title, 160);
  let slug = String(req.body.slug || '').trim().slice(0, 120).toLowerCase();
  if (!title) return res.status(400).json({ ok: false, error: 'Title required' });
  if (!slug) slug = slugify(title);

  const short_desc = stripText(req.body.short_desc, 600);
  const long_desc = stripText(req.body.long_desc, 12000);
  const icon = stripText(req.body.icon, 40) || 'layers';
  const image = String(req.body.image || '').slice(0, 500);
  const sort_order = Number(req.body.sort_order) || 0;
  const featured = req.body.featured ? 1 : 0;

  try {
    db.prepare(
      `UPDATE services SET title = ?, slug = ?, short_desc = ?, long_desc = ?, icon = ?, image = ?,
       sort_order = ?, featured = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(title, slug, short_desc, long_desc, icon, image, sort_order, featured, id);
    const row = db.prepare(`SELECT * FROM services WHERE id = ?`).get(id);
    res.json({ ok: true, service: row });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ ok: false, error: 'Slug already exists' });
    }
    throw e;
  }
});

app.delete('/api/admin/services/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare(`DELETE FROM services WHERE id = ?`).run(id);
  res.json({ ok: true });
});

app.post('/api/admin/team', requireAdmin, (req, res) => {
  const name = stripText(req.body.name, 120);
  if (!name) return res.status(400).json({ ok: false, error: 'Name required' });
  const role = stripText(req.body.role, 160);
  const bio = stripText(req.body.bio, 4000);
  const image = String(req.body.image || '').slice(0, 500);
  const sort_order = Number(req.body.sort_order) || 0;

  const info = db
    .prepare(
      `INSERT INTO team_members (name, role, bio, image, sort_order) VALUES (?, ?, ?, ?, ?)`
    )
    .run(name, role, bio, image, sort_order);
  const row = db.prepare(`SELECT * FROM team_members WHERE id = ?`).get(info.lastInsertRowid);
  res.json({ ok: true, member: row });
});

app.put('/api/admin/team/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare(`SELECT id FROM team_members WHERE id = ?`).get(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'Not found' });

  const name = stripText(req.body.name, 120);
  if (!name) return res.status(400).json({ ok: false, error: 'Name required' });
  const role = stripText(req.body.role, 160);
  const bio = stripText(req.body.bio, 4000);
  const image = String(req.body.image || '').slice(0, 500);
  const sort_order = Number(req.body.sort_order) || 0;

  db.prepare(
    `UPDATE team_members SET name = ?, role = ?, bio = ?, image = ?, sort_order = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(name, role, bio, image, sort_order, id);
  const row = db.prepare(`SELECT * FROM team_members WHERE id = ?`).get(id);
  res.json({ ok: true, member: row });
});

app.delete('/api/admin/team/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare(`DELETE FROM team_members WHERE id = ?`).run(id);
  res.json({ ok: true });
});

app.patch('/api/admin/messages/:id/read', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare(`UPDATE contact_messages SET is_read = 1 WHERE id = ?`).run(id);
  res.json({ ok: true });
});

app.delete('/api/admin/messages/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare(`DELETE FROM contact_messages WHERE id = ?`).run(id);
  res.json({ ok: true });
});

app.post('/api/admin/upload', requireAdmin, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ ok: false, error: err.message || 'Upload failed' });
    }
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file' });
    const url = `/uploads/${req.file.filename}`;
    res.json({ ok: true, url });
  });
});

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: 'Server error' });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  if (!isProd) {
    console.log('Dev defaults: change ADMIN_PASSWORD via env for production.');
  }
});
