const path = require('path');
const fsp = require('fs/promises');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const Redis = require('ioredis');
const connectRedis = require('connect-redis');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const validator = require('validator');
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { Resend } = require('resend');

const {
  uploadsDir,
  getKvMap,
  setKv,
  slugify,
  qr,
  q1,
  query,
  translationMapForLocale,
  initDb,
  isUniqueViolation,
  pool,
  logActivity,
} = require('./db');
const { I18N_LOCALES, LOCALE_LABELS, getAllKeys } = require('./i18n-seeds');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

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

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

function redactRedisUrl(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = '****';
    return u.toString();
  } catch {
    return '[redis URL]';
  }
}

async function createSessionMiddleware() {
  let store;
  let redisClient = null;
  try {
    const RedisStore = connectRedis(session);
    redisClient = new Redis(REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
      connectTimeout: 5000,
    });
    await redisClient.connect();
    await redisClient.ping();
    store = new RedisStore({ client: redisClient });
    console.log('[session] Using Redis store', redactRedisUrl(REDIS_URL));
  } catch (e) {
    console.warn('[session] Redis unavailable, using in-memory store:', e && e.message ? e.message : e);
    if (redisClient) {
      try {
        redisClient.disconnect();
      } catch (_) {
        /* ignore */
      }
    }
    store = undefined;
  }

  return session({
    name: 'sid',
    secret: sessionSecret,
    store,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: 1000 * 60 * 60 * 8,
    },
  });
}

const sessionHandlerPromise = createSessionMiddleware();

app.use((req, res, next) => {
  sessionHandlerPromise.then((handler) => handler(req, res, next)).catch(next);
});

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

const newsletterPublicLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
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

const totpLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  message: { ok: false, error: 'Too many authentication code attempts.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const trackLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

const analyticsTrackLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 800,
  standardHeaders: true,
  legacyHeaders: false,
});

const blogSearchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', publicLimiter);

function adminDisplayName(req) {
  return String((req.session && req.session.adminUsername) || 'admin').slice(0, 200);
}

function logAdminFire(req, action, entityType, entityId, details) {
  logActivity(adminDisplayName(req), action, entityType, entityId != null ? String(entityId) : '', details).catch(
    () => {}
  );
}

function requireAdmin(req, res, next) {
  if (!(req.session && req.session.adminId === 1)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  if (req.session.adminUsername) return next();
  q1('SELECT username FROM admin_user WHERE id = 1')
    .then((row) => {
      if (row && row.username) req.session.adminUsername = row.username;
      next();
    })
    .catch(() => next());
}

function totpIssuer() {
  return String(process.env.TOTP_ISSUER || 'Company Admin').slice(0, 80);
}

function isTotpEnabledRow(row) {
  if (!row) return false;
  const en = row.totp_enabled;
  const on = en === true || en === 1 || en === 't' || String(en).toLowerCase() === 'true';
  return on && String(row.totp_secret || '').trim().length > 0;
}

function verifyTotpToken(secretBase32, token) {
  const secret = String(secretBase32 || '').replace(/\s/g, '');
  const t = String(token || '').replace(/\s/g, '');
  if (!secret || !/^\d{6}$/.test(t)) return false;
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: t,
    window: 1,
  });
}

const ANALYTICS_CONSENT_COOKIE = 'ac_analytics';

function getCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  const parts = raw.split(';');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    if (k !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}

function setAnalyticsConsentCookie(res) {
    
    const maxAge = 60 * 60 * 24 * 400;
    const bits = [`${ANALYTICS_CONSENT_COOKIE}=1`, 'Path=/', `Max-Age=${maxAge}`, 'SameSite=Lax', 'HttpOnly'];
    if (isProd) bits.push('Secure');
    res.setHeader('Set-Cookie', bits.join('; '));
}

function clientIp(req) {
  let ip = req.ip || req.socket?.remoteAddress || '';
  ip = String(ip).replace(/^::ffff:/, '');
  return ip || 'unknown';
}

function hashIpForAnalytics(ip) {
  const salt =
    process.env.ANALYTICS_IP_SALT || process.env.SESSION_SECRET || 'dev-analytics-ip-salt-change-me';
  return crypto.createHash('sha256').update(`${ip}|${salt}`).digest('hex');
}

function deviceTypeFromUa(ua) {
  const s = String(ua || '').toLowerCase();
  if (!s) return 'unknown';
  if (/tablet|ipad|playbook|silk|(android(?!.*mobile))/.test(s)) return 'tablet';
  if (/mobile|iphone|ipod|android|blackberry|iemobile|opera mini|webos|windows phone/.test(s)) return 'mobile';
  return 'desktop';
}

function normalizeTrackPath(input) {
  let s = String(input || '/').trim().replace(/\0/g, '').slice(0, 512);
  if (!s.startsWith('/')) s = `/${s}`;
  return s || '/';
}

function sanitizeReferrer(input) {
  const raw = String(input || '').trim().replace(/\0/g, '').slice(0, 1024);
  if (!raw) return '';
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return `${u.origin}${u.pathname}${u.search}${u.hash}`.slice(0, 1024);
  } catch {
    return '';
  }
}

function generateSubscriberToken() {
  return crypto.randomBytes(32).toString('hex');
}

function newsletterPublicSiteBase() {
  let raw = String(process.env.SITE_URL || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  return raw;
}

function newsletterUnsubscribeFooterHtml(siteBase, token) {
  const url = `${siteBase}/unsubscribe.html?token=${encodeURIComponent(token)}`;
  return `<div style="margin-top:2rem;padding-top:1.5rem;border-top:1px solid #e5e7eb;font-size:13px;line-height:1.5;color:#6b7280;font-family:system-ui,-apple-system,sans-serif;">
  <p style="margin:0 0 0.5rem">You are subscribed to our newsletter.</p>
  <p style="margin:0"><a href="${url}" style="color:#2563eb">Unsubscribe</a></p>
</div>`;
}

function buildNewsletterEmailHtml(bodyHtml, siteBase, token) {
  return String(bodyHtml || '') + newsletterUnsubscribeFooterHtml(siteBase, token);
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

const contactUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set([
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]);
    if (allowed.has(file.mimetype)) return cb(null, true);
    cb(new Error('Attachment type not allowed (images, PDF, Word)'));
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

function parseFeatureFlags(raw) {
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function normalizeLang(q) {
  const s = String(q || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  return s.slice(0, 8) || '';
}

async function applyTranslations(site, locale) {
  const kv = await getKvMap();
  const def = normalizeLang(kv.default_locale) || 'en';
  if (!locale || locale === def) return site;
  const t = await translationMapForLocale(locale);
  if (t.company_name) site.companyName = t.company_name;
  if (t.hero_title) site.hero.title = t.hero_title;
  if (t.hero_subtitle) site.hero.subtitle = t.hero_subtitle;
  if (t.hero_cta_primary_text) site.hero.ctaPrimary.text = t.hero_cta_primary_text;
  if (t.hero_cta_secondary_text) site.hero.ctaSecondary.text = t.hero_cta_secondary_text;
  if (t.home_about_title) site.homeAbout.title = t.home_about_title;
  if (t.home_about_text) site.homeAbout.text = t.home_about_text;
  if (t.footer_tagline) site.footerTagline = t.footer_tagline;
  if (t.home_projects_title) site.homeProjectsTitle = t.home_projects_title;
  if (t.home_projects_intro) site.homeProjectsIntro = t.home_projects_intro;
  return site;
}

async function publicSitePayload() {
  const kv = await getKvMap();
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
    homeProjectsTitle: kv.home_projects_title || 'Projects & micro-SaaS',
    homeProjectsIntro: kv.home_projects_intro || '',
    featureFlags: parseFeatureFlags(kv.feature_flags_json),
    defaultLocale: kv.default_locale || 'en',
    activeLocale: kv.default_locale || 'en',
  };
}

function projectRowPublic(r) {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    slug: r.slug,
    shortDesc: r.short_desc,
    longDesc: r.long_desc,
    image: r.image,
    linkUrl: r.link_url,
    featured: r.featured,
    sortOrder: r.sort_order,
    viewCount: r.view_count,
  };
}

app.get(
  '/api/public/site',
  asyncHandler(async (req, res) => {
    const locale = normalizeLang(req.query.lang);
    const services = await qr(
      `SELECT id, title, slug, short_desc AS "shortDesc", long_desc AS "longDesc", icon, image, featured
       FROM services ORDER BY sort_order ASC, id ASC`
    );
    const team = await qr(
      `SELECT id, name, role, bio, image FROM team_members ORDER BY sort_order ASC, id ASC`
    );
    const kv = await getKvMap();
    const flags = parseFeatureFlags(kv.feature_flags_json);
    let projectPreview = [];
    if (flags.showProjects !== false) {
      const prow = await qr(
        `SELECT id, kind, title, slug, short_desc, long_desc, image, link_url, featured, sort_order, view_count
         FROM projects ORDER BY featured DESC, sort_order ASC, id ASC LIMIT 8`
      );
      projectPreview = prow.map(projectRowPublic);
    }

    let site = await publicSitePayload();
    site.activeLocale = locale || site.defaultLocale || 'en';
    site = await applyTranslations(site, locale);

    res.json({
      ok: true,
      site,
      services,
      teamPreview: team.slice(0, 4),
      projectPreview,
    });
  })
);

app.get(
  '/api/public/contact-page',
  asyncHandler(async (_req, res) => {
    const kv = await getKvMap();
    res.json({
      ok: true,
      mapEmbedUrl: kv.contact_map_embed_url || '',
    });
  })
);

app.post(
  '/api/public/track-visit',
  trackLimiter,
  asyncHandler(async (_req, res) => {
    const kv = await getKvMap();
    const n = Math.max(0, Number(kv.visitor_count || 0)) + 1;
    await setKv('visitor_count', String(n));
    res.json({ ok: true, visitorCount: n });
  })
);

app.post(
  '/api/public/analytics-consent',
  analyticsTrackLimiter,
  asyncHandler((_req, res) => {
    setAnalyticsConsentCookie(res);
    res.json({ ok: true });
  })
);

app.post(
  '/api/public/track-page',
  analyticsTrackLimiter,
  asyncHandler(async (req, res) => {
    if (getCookie(req, ANALYTICS_CONSENT_COOKIE) !== '1') {
      return res.json({ ok: true, skipped: true });
    }
    const path = normalizeTrackPath(req.body && req.body.path);
    const referrer = sanitizeReferrer((req.body && req.body.referrer) || req.get('Referer') || '');
    const ua = req.get('User-Agent') || '';
    const deviceType = deviceTypeFromUa(ua);
    const ipHash = hashIpForAnalytics(clientIp(req));

    await query(
      `INSERT INTO page_views (path, referrer, device_type, ip_hash) VALUES (?, ?, ?, ?)`,
      [path, referrer, deviceType, ipHash]
    );

    await query(
      `INSERT INTO daily_stats (date, views, unique_visitors)
       SELECT CURRENT_DATE,
              (SELECT COUNT(*)::bigint FROM page_views WHERE created_at::date = CURRENT_DATE),
              (SELECT COUNT(DISTINCT ip_hash)::bigint FROM page_views WHERE created_at::date = CURRENT_DATE)
       ON CONFLICT (date) DO UPDATE SET
         views = EXCLUDED.views,
         unique_visitors = EXCLUDED.unique_visitors`
    );

    res.json({ ok: true });
  })
);

app.get(
  '/api/public/projects',
  asyncHandler(async (req, res) => {
    const kind = String(req.query.kind || '').slice(0, 20).toLowerCase();
    let q = `SELECT id, kind, title, slug, short_desc, long_desc, image, link_url, featured, sort_order, view_count
           FROM projects WHERE 1=1`;
    const args = [];
    if (kind === 'project' || kind === 'microsaas') {
      q += ' AND kind = ?';
      args.push(kind);
    }
    q += ' ORDER BY sort_order ASC, id ASC';
    const rows = (await qr(q, args)).map(projectRowPublic);
    res.json({ ok: true, projects: rows });
  })
);

app.get(
  '/api/public/projects/:slug',
  asyncHandler(async (req, res) => {
    const slug = String(req.params.slug || '').slice(0, 120);
    const row = await q1(
      `SELECT id, kind, title, slug, short_desc, long_desc, image, link_url, featured, sort_order, view_count
       FROM projects WHERE slug = ?`,
      [slug]
    );
    if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
    await query(`UPDATE projects SET view_count = view_count + 1, updated_at = NOW() WHERE id = ?`, [
      row.id,
    ]);
    row.view_count += 1;
    res.json({ ok: true, project: projectRowPublic(row) });
  })
);

app.get(
  '/api/public/blog/categories',
  asyncHandler(async (_req, res) => {
    const rows = await qr(
      `SELECT id, name, slug FROM blog_categories ORDER BY sort_order ASC, id ASC`
    );
    res.json({ ok: true, categories: rows });
  })
);

app.get(
  '/api/public/blog/posts',
  blogSearchLimiter,
  asyncHandler(async (req, res) => {
    const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 6));
    const page = Math.max(1, Number(req.query.page) || 1);
    const offset = (page - 1) * limit;
    const q = String(req.query.q || '')
      .trim()
      .slice(0, 80)
      .toLowerCase();
    const catSlug = String(req.query.category || '').trim().slice(0, 80);

    let where = 'WHERE p.published = 1';
    const args = [];

    if (catSlug) {
      where += ' AND c.slug = ?';
      args.push(catSlug);
    }
    if (q) {
      where +=
        ' AND (lower(p.title) LIKE ? OR lower(p.excerpt) LIKE ? OR lower(p.body) LIKE ?)';
      const term = `%${q}%`;
      args.push(term, term, term);
    }

    const countRow = await q1(`SELECT COUNT(*)::int AS n FROM blog_posts p
    JOIN blog_categories c ON c.id = p.category_id ${where}`, args);
    const total = countRow ? countRow.n : 0;

    const rows = await qr(
      `SELECT p.id, p.title, p.slug, p.excerpt, p.published_at AS "publishedAt",
       p.view_count AS "viewCount", c.name AS "categoryName", c.slug AS "categorySlug"
       FROM blog_posts p
       JOIN blog_categories c ON c.id = p.category_id
       ${where}
       ORDER BY p.published_at DESC, p.id DESC
       LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );

    res.json({
      ok: true,
      posts: rows,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      total,
    });
  })
);

app.get(
  '/api/public/blog/posts/:slug',
  asyncHandler(async (req, res) => {
    const slug = String(req.params.slug || '').slice(0, 120);
    const row = await q1(
      `SELECT p.id, p.category_id AS "categoryId", p.title, p.slug, p.excerpt, p.body,
       p.published_at AS "publishedAt", p.meta_title AS "metaTitle", p.meta_description AS "metaDescription",
       p.meta_keywords AS "metaKeywords", p.view_count AS "viewCount",
       c.name AS "categoryName", c.slug AS "categorySlug"
       FROM blog_posts p
       JOIN blog_categories c ON c.id = p.category_id
       WHERE p.slug = ? AND p.published = 1`,
      [slug]
    );
    if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
    await query(`UPDATE blog_posts SET view_count = view_count + 1, updated_at = NOW() WHERE id = ?`, [
      row.id,
    ]);
    row.viewCount = Number(row.viewCount || 0) + 1;
    res.json({ ok: true, post: row });
  })
);

function normalizeSeoPath(p) {
  let x = String(p || '/').trim();
  if (!x.startsWith('/')) x = '/' + x;
  return x.slice(0, 200);
}

app.get(
  '/api/public/seo',
  asyncHandler(async (req, res) => {
    const pagePath = normalizeSeoPath(req.query.path);
    const row = await q1(`SELECT * FROM page_seo WHERE path = ?`, [pagePath]);
    if (row) {
      return res.json({
        ok: true,
        seo: {
          title: row.meta_title,
          description: row.meta_description,
          keywords: row.meta_keywords,
        },
      });
    }
    const kv = await getKvMap();
    res.json({
      ok: true,
      seo: {
        title: kv.company_name ? `${kv.company_name}` : '',
        description: stripText(kv.hero_subtitle || '', 320),
        keywords: '',
      },
    });
  })
);

app.get(
  '/api/public/services',
  asyncHandler(async (_req, res) => {
    const rows = await qr(
      `SELECT id, title, slug, short_desc AS "shortDesc", long_desc AS "longDesc", icon, image, featured
       FROM services ORDER BY sort_order ASC, id ASC`
    );
    res.json({ ok: true, services: rows });
  })
);

app.get(
  '/api/public/services/:slug',
  asyncHandler(async (req, res) => {
    const slug = String(req.params.slug || '').slice(0, 120);
    const row = await q1(
      `SELECT id, title, slug, short_desc AS "shortDesc", long_desc AS "longDesc", icon, image, featured
       FROM services WHERE slug = ?`,
      [slug]
    );
    if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, service: row });
  })
);

app.get(
  '/api/public/team',
  asyncHandler(async (_req, res) => {
    const rows = await qr(
      `SELECT id, name, role, bio, image FROM team_members ORDER BY sort_order ASC, id ASC`
    );
    res.json({ ok: true, team: rows });
  })
);

async function handleContactSubmission(req, res) {
  const name = stripText(req.body.name, 120);
  const email = String(req.body.email || '').trim().slice(0, 120).toLowerCase();
  const phone = stripText(req.body.phone, 40);
  const message = stripText(req.body.message, 4000);
  let attachment_path = '';
  let attachment_name = '';
  if (req.file) {
    attachment_path = `/uploads/${req.file.filename}`;
    attachment_name = stripText(req.file.originalname, 240);
  }

  if (!name || name.length < 2) {
    return res.status(400).json({ ok: false, error: 'Please enter your name.' });
  }
  if (!validator.isEmail(email)) {
    return res.status(400).json({ ok: false, error: 'Please enter a valid email.' });
  }
  if (!message || message.length < 10) {
    return res.status(400).json({ ok: false, error: 'Please enter a longer message.' });
  }

  await query(
    `INSERT INTO contact_messages (name, email, phone, message, attachment_path, attachment_name)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [name, email, phone, message, attachment_path, attachment_name]
  );

  res.json({ ok: true });
}

app.post(
  '/api/public/contact',
  contactLimiter,
  (req, res, next) => {
    const ct = req.headers['content-type'] || '';
    if (ct.includes('multipart/form-data')) {
      contactUpload.single('attachment')(req, res, (err) => {
        if (err) {
          return res.status(400).json({ ok: false, error: err.message || 'Upload failed' });
        }
        next();
      });
    } else next();
  },
  asyncHandler((req, res) => handleContactSubmission(req, res))
);

app.post(
  '/api/admin/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    const row = await q1(
      'SELECT id, username, password_hash, totp_secret, totp_enabled FROM admin_user WHERE id = 1'
    );
    if (!row) return res.status(500).json({ ok: false, error: 'Server misconfigured' });

    const userOk = username === row.username;
    const passOk = bcrypt.compareSync(password, row.password_hash);

    if (!userOk || !passOk) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    if (isTotpEnabledRow(row)) {
      req.session.regenerate((err) => {
        if (err) return res.status(500).json({ ok: false, error: 'Session error' });
        req.session.totpChallenge = true;
        res.json({ ok: true, needTotp: true });
      });
      return;
    }

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ ok: false, error: 'Session error' });
      req.session.adminId = row.id;
      req.session.adminUsername = row.username;
      res.json({ ok: true });
      logActivity(row.username, 'login', 'session', '', 'Login success').catch(() => {});
    });
  })
);

app.post(
  '/api/admin/login/cancel',
  asyncHandler(async (req, res) => {
    if (req.session && req.session.totpChallenge) {
      await new Promise((resolve) => {
        req.session.destroy(() => resolve());
      });
    }
    res.json({ ok: true });
  })
);

app.post(
  '/api/admin/login/totp',
  totpLoginLimiter,
  asyncHandler(async (req, res) => {
    if (!req.session || !req.session.totpChallenge) {
      return res.status(401).json({ ok: false, error: 'No authentication challenge in progress.' });
    }
    const token = String(req.body.token || '').replace(/\s/g, '');
    const row = await q1(
      'SELECT id, username, totp_secret, totp_enabled FROM admin_user WHERE id = 1'
    );
    if (!row || !isTotpEnabledRow(row) || !verifyTotpToken(row.totp_secret, token)) {
      return res.status(401).json({ ok: false, error: 'Invalid authentication code.' });
    }
    delete req.session.totpChallenge;
    req.session.adminId = row.id;
    req.session.adminUsername = row.username;
    res.json({ ok: true });
    logActivity(row.username, 'login', 'session', '', 'Login success (2FA)').catch(() => {});
  })
);

app.post(
  '/api/admin/logout',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const uname = adminDisplayName(req);
    logActivity(uname, 'logout', 'session', '', 'Logout').catch(() => {});
    await new Promise((resolve) => {
      req.session.destroy(() => resolve());
    });
    res.json({ ok: true });
  })
);

app.get(
  '/api/admin/session',
  asyncHandler(async (req, res) => {
    const authed = !!(req.session && req.session.adminId === 1);
    const needTotp = !!(req.session && req.session.totpChallenge && !authed);
    res.json({ ok: true, authed, needTotp });
  })
);

app.get(
  '/api/admin/2fa/status',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const row = await q1('SELECT totp_enabled, totp_secret FROM admin_user WHERE id = 1');
    res.json({ ok: true, totpEnabled: isTotpEnabledRow(row) });
  })
);

app.get(
  '/api/admin/2fa/setup',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const row = await q1('SELECT username FROM admin_user WHERE id = 1');
    const issuer = totpIssuer();
    const account = String((row && row.username) || 'admin').slice(0, 80);
    const secret = speakeasy.generateSecret({
      name: account,
      issuer,
      length: 32,
    });
    const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url, {
      margin: 1,
      width: 220,
      errorCorrectionLevel: 'M',
    });
    res.json({
      ok: true,
      secret: secret.base32,
      qrDataUrl,
      otpauthUrl: secret.otpauth_url,
    });
  })
);

app.post(
  '/api/admin/2fa/enable',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const secret = String(req.body.secret || '')
      .replace(/\s/g, '')
      .slice(0, 200);
    const token = String(req.body.token || '').replace(/\s/g, '');
    if (!secret || !verifyTotpToken(secret, token)) {
      return res.status(400).json({ ok: false, error: 'Invalid code or secret.' });
    }
    await query(
      `UPDATE admin_user SET totp_secret = ?, totp_enabled = TRUE WHERE id = 1`,
      [secret]
    );
    logAdminFire(req, '2fa_enable', 'admin_user', '1', 'TOTP enabled');
    res.json({ ok: true });
  })
);

app.post(
  '/api/admin/2fa/disable',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const password = String(req.body.password || '');
    const row = await q1('SELECT password_hash FROM admin_user WHERE id = 1');
    if (!row || !bcrypt.compareSync(password, row.password_hash)) {
      return res.status(400).json({ ok: false, error: 'Invalid password.' });
    }
    await query(
      `UPDATE admin_user SET totp_secret = '', totp_enabled = FALSE WHERE id = 1`,
      []
    );
    logAdminFire(req, '2fa_disable', 'admin_user', '1', 'TOTP disabled');
    res.json({ ok: true });
  })
);

app.get(
  '/api/admin/activity-log',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
    const actionFilter = stripText(req.query.action || '', 120);
    const offset = (page - 1) * limit;

    const countRow = actionFilter
      ? await q1(`SELECT COUNT(*)::bigint AS c FROM activity_log WHERE action = ?`, [actionFilter])
      : await q1(`SELECT COUNT(*)::bigint AS c FROM activity_log`);
    const total = Number(countRow?.c || 0);

    const rows = actionFilter
      ? await qr(
          `SELECT id, admin_username AS "adminUsername", action, entity_type AS "entityType",
             entity_id AS "entityId", details, created_at AS "createdAt"
           FROM activity_log WHERE action = ?
           ORDER BY created_at DESC, id DESC
           LIMIT ? OFFSET ?`,
          [actionFilter, limit, offset]
        )
      : await qr(
          `SELECT id, admin_username AS "adminUsername", action, entity_type AS "entityType",
             entity_id AS "entityId", details, created_at AS "createdAt"
           FROM activity_log
           ORDER BY created_at DESC, id DESC
           LIMIT ? OFFSET ?`,
          [limit, offset]
        );

    const actionRows = await qr(`SELECT DISTINCT action FROM activity_log ORDER BY action ASC`);

    res.json({
      ok: true,
      page,
      limit,
      total,
      actions: actionRows.map((r) => r.action).filter(Boolean),
      entries: rows,
    });
  })
);

app.get(
  '/api/admin/bootstrap',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const kv = await getKvMap();
    const services = await qr(`SELECT * FROM services ORDER BY sort_order ASC, id ASC`);
    const team = await qr(`SELECT * FROM team_members ORDER BY sort_order ASC, id ASC`);
    const messages = await qr(
      `SELECT id, name, email, phone, message, is_read AS "isRead", created_at AS "createdAt",
       attachment_path AS "attachmentPath", attachment_name AS "attachmentName"
       FROM contact_messages ORDER BY id DESC LIMIT 200`
    );
    const projects = await qr(`SELECT * FROM projects ORDER BY sort_order ASC, id ASC`);
    const blogCategories = await qr(
      `SELECT * FROM blog_categories ORDER BY sort_order ASC, id ASC`
    );
    const blogPosts = await qr(
      `SELECT * FROM blog_posts ORDER BY published_at DESC, id DESC LIMIT 500`
    );
    const seoPages = await qr(`SELECT * FROM page_seo ORDER BY path ASC`);
    const translationLocalesRows = await qr(`SELECT DISTINCT locale FROM translations ORDER BY locale`);
    const translationLocales = translationLocalesRows.map((r) => r.locale);
    const translations = await qr(`SELECT * FROM translations ORDER BY locale, translation_key`);

    res.json({
      ok: true,
      kv,
      services,
      team,
      messages,
      projects,
      blogCategories,
      blogPosts,
      seoPages,
      translationLocales,
      translations,
    });
  })
);

app.put(
  '/api/admin/site',
  requireAdmin,
  asyncHandler(async (req, res) => {
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
      'contact_map_embed_url',
      'default_locale',
      'home_projects_title',
      'home_projects_intro',
      'feature_flags_json',
      'analytics_mock_json',
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
      } else if (k === 'feature_flags_json') {
        try {
          const parsed = typeof v === 'string' ? JSON.parse(v) : v;
          if (!parsed || typeof parsed !== 'object') continue;
          v = JSON.stringify(parsed).slice(0, 4000);
        } catch {
          continue;
        }
      } else if (k === 'analytics_mock_json') {
        try {
          const parsed = typeof v === 'string' ? JSON.parse(v) : v;
          if (!parsed || typeof parsed !== 'object') continue;
          v = JSON.stringify(parsed).slice(0, 16000);
        } catch {
          continue;
        }
      } else {
        v = String(v ?? '').slice(0, 8000);
      }
      await setKv(k, v);
    }

    const touched = Object.keys(body || {}).filter((k) => allowedKeys.has(k));
    logAdminFire(
      req,
      'site_update',
      'site_settings',
      '',
      touched.length
        ? `Updated: ${touched.slice(0, 24).join(', ')}${touched.length > 24 ? '…' : ''}`
        : 'No allowed keys in body'
    );

    res.json({ ok: true, site: await publicSitePayload() });
  })
);

app.post(
  '/api/admin/services',
  requireAdmin,
  asyncHandler(async (req, res) => {
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
      const ins = await query(
        `INSERT INTO services (title, slug, short_desc, long_desc, icon, image, sort_order, featured)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
        [title, slug, short_desc, long_desc, icon, image, sort_order, featured]
      );
      const row = ins.rows[0];
      logAdminFire(req, 'service_create', 'service', String(row.id), String(row.slug || row.title || ''));
      res.json({ ok: true, service: row });
    } catch (e) {
      if (isUniqueViolation(e)) {
        return res.status(409).json({ ok: false, error: 'Slug already exists' });
      }
      throw e;
    }
  })
);

app.put(
  '/api/admin/services/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await q1(`SELECT id FROM services WHERE id = ?`, [id]);
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
      await query(
        `UPDATE services SET title = ?, slug = ?, short_desc = ?, long_desc = ?, icon = ?, image = ?,
       sort_order = ?, featured = ?, updated_at = NOW() WHERE id = ?`,
        [title, slug, short_desc, long_desc, icon, image, sort_order, featured, id]
      );
      const row = await q1(`SELECT * FROM services WHERE id = ?`, [id]);
      logAdminFire(req, 'service_update', 'service', String(id), String(row.slug || row.title || ''));
      res.json({ ok: true, service: row });
    } catch (e) {
      if (isUniqueViolation(e)) {
        return res.status(409).json({ ok: false, error: 'Slug already exists' });
      }
      throw e;
    }
  })
);

app.delete(
  '/api/admin/services/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await query(`DELETE FROM services WHERE id = ?`, [id]);
    logAdminFire(req, 'service_delete', 'service', String(id), '');
    res.json({ ok: true });
  })
);

app.post(
  '/api/admin/team',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const name = stripText(req.body.name, 120);
    if (!name) return res.status(400).json({ ok: false, error: 'Name required' });
    const role = stripText(req.body.role, 160);
    const bio = stripText(req.body.bio, 4000);
    const image = String(req.body.image || '').slice(0, 500);
    const sort_order = Number(req.body.sort_order) || 0;

    const ins = await query(
      `INSERT INTO team_members (name, role, bio, image, sort_order) VALUES (?, ?, ?, ?, ?)
       RETURNING *`,
      [name, role, bio, image, sort_order]
    );
    const row = ins.rows[0];
    logAdminFire(req, 'team_create', 'team_member', String(row.id), String(row.name || ''));
    res.json({ ok: true, member: row });
  })
);

app.put(
  '/api/admin/team/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await q1(`SELECT id FROM team_members WHERE id = ?`, [id]);
    if (!existing) return res.status(404).json({ ok: false, error: 'Not found' });

    const name = stripText(req.body.name, 120);
    if (!name) return res.status(400).json({ ok: false, error: 'Name required' });
    const role = stripText(req.body.role, 160);
    const bio = stripText(req.body.bio, 4000);
    const image = String(req.body.image || '').slice(0, 500);
    const sort_order = Number(req.body.sort_order) || 0;

    await query(
      `UPDATE team_members SET name = ?, role = ?, bio = ?, image = ?, sort_order = ?, updated_at = NOW()
     WHERE id = ?`,
      [name, role, bio, image, sort_order, id]
    );
    const row = await q1(`SELECT * FROM team_members WHERE id = ?`, [id]);
    logAdminFire(req, 'team_update', 'team_member', String(id), String(row.name || ''));
    res.json({ ok: true, member: row });
  })
);

app.delete(
  '/api/admin/team/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await query(`DELETE FROM team_members WHERE id = ?`, [id]);
    logAdminFire(req, 'team_delete', 'team_member', String(id), '');
    res.json({ ok: true });
  })
);

app.patch(
  '/api/admin/messages/:id/read',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await query(`UPDATE contact_messages SET is_read = 1 WHERE id = ?`, [id]);
    logAdminFire(req, 'message_read', 'contact_message', String(id), '');
    res.json({ ok: true });
  })
);

app.delete(
  '/api/admin/messages/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await query(`DELETE FROM contact_messages WHERE id = ?`, [id]);
    logAdminFire(req, 'message_delete', 'contact_message', String(id), '');
    res.json({ ok: true });
  })
);

app.get(
  '/api/admin/messages/export.csv',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const rows = await qr(
      `SELECT id, name, email, phone, message, is_read, created_at, attachment_path, attachment_name
       FROM contact_messages ORDER BY id DESC`
    );
    const cell = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const lines = [
      ['id', 'name', 'email', 'phone', 'is_read', 'created_at', 'attachment_name', 'attachment_path', 'message'].join(
        ','
      ),
    ];
    for (const r of rows) {
      lines.push(
        [
          r.id,
          r.name,
          r.email,
          r.phone,
          r.is_read,
          r.created_at,
          r.attachment_name,
          r.attachment_path,
          r.message,
        ]
          .map(cell)
          .join(',')
      );
    }
    const csv = '\uFEFF' + lines.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="contact-messages.csv"');
    res.send(csv);
  })
);

app.post(
  '/api/public/newsletter/subscribe',
  newsletterPublicLimiter,
  asyncHandler(async (req, res) => {
    const email = String(req.body.email || '')
      .trim()
      .toLowerCase()
      .slice(0, 254);
    if (!email || !validator.isEmail(email)) {
      return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
    }

    const existing = await q1(`SELECT id, status FROM subscribers WHERE email = ?`, [email]);
    if (existing) {
      if (existing.status === 'unsubscribed') {
        let token = generateSubscriberToken();
        try {
          await query(
            `UPDATE subscribers SET status = 'active', token = ?, unsubscribed_at = NULL WHERE id = ?`,
            [token, existing.id]
          );
        } catch (e) {
          if (isUniqueViolation(e)) {
            token = generateSubscriberToken();
            await query(
              `UPDATE subscribers SET status = 'active', token = ?, unsubscribed_at = NULL WHERE id = ?`,
              [token, existing.id]
            );
          } else throw e;
        }
      }
      return res.json({ ok: true });
    }

    let attempts = 0;
    while (attempts < 4) {
      attempts += 1;
      const token = generateSubscriberToken();
      try {
        await query(
          `INSERT INTO subscribers (email, status, token) VALUES (?, 'active', ?)`,
          [email, token]
        );
        return res.json({ ok: true });
      } catch (e) {
        if (isUniqueViolation(e)) {
          const again = await q1(`SELECT id FROM subscribers WHERE email = ?`, [email]);
          if (again) return res.json({ ok: true });
          continue;
        }
        throw e;
      }
    }
    res.status(500).json({ ok: false, error: 'Could not save subscription.' });
  })
);

app.get(
  '/api/public/newsletter/unsubscribe',
  asyncHandler(async (req, res) => {
    const token = String(req.query.token || '')
      .trim()
      .slice(0, 128);
    if (!token) {
      return res.status(400).json({ ok: false, error: 'Missing token.' });
    }
    const updated = await query(
      `UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = NOW()
       WHERE token = ? AND status = 'active' RETURNING id`,
      [token]
    );
    if (updated.rows.length > 0) {
      return res.json({ ok: true });
    }
    const row = await q1(`SELECT id, status FROM subscribers WHERE token = ?`, [token]);
    if (!row) {
      return res.status(404).json({ ok: false, error: 'Invalid or expired link.' });
    }
    res.json({ ok: true, alreadyUnsubscribed: row.status === 'unsubscribed' });
  })
);

app.get(
  '/api/admin/newsletter/subscribers',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
    const statusRaw = String(req.query.status || '').toLowerCase();
    const statusFilter = statusRaw === 'active' || statusRaw === 'unsubscribed' ? statusRaw : null;
    const offset = (page - 1) * limit;

    const args = [];
    let whereClause = 'TRUE';
    if (statusFilter) {
      whereClause = 'status = ?';
      args.push(statusFilter);
    }

    const countRow = await q1(`SELECT COUNT(*)::bigint AS c FROM subscribers WHERE ${whereClause}`, args);
    const total = Number(countRow?.c || 0);

    const rows = await qr(
      `SELECT id, email, status, created_at AS "createdAt", unsubscribed_at AS "unsubscribedAt"
       FROM subscribers WHERE ${whereClause}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );

    res.json({ ok: true, total, page, limit, subscribers: rows });
  })
);

app.delete(
  '/api/admin/newsletter/subscribers/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ ok: false, error: 'Invalid id' });
    }
    const del = await query(`DELETE FROM subscribers WHERE id = ? RETURNING id`, [id]);
    if (!del.rows.length) return res.status(404).json({ ok: false, error: 'Not found' });
    logAdminFire(req, 'newsletter_delete', 'subscriber', String(id), '');
    res.json({ ok: true });
  })
);

app.get(
  '/api/admin/newsletter/export.csv',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const rows = await qr(
      `SELECT email, status, created_at FROM subscribers WHERE status = 'active' ORDER BY created_at ASC, id ASC`
    );
    const cell = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const lines = [['email', 'status', 'created_at'].join(',')];
    for (const r of rows) {
      lines.push([r.email, r.status, r.created_at].map(cell).join(','));
    }
    const csv = '\uFEFF' + lines.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="newsletter-subscribers-active.csv"');
    res.send(csv);
  })
);

app.post(
  '/api/admin/newsletter/send',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const apiKey = String(process.env.RESEND_API_KEY || '').trim();
    if (!apiKey) {
      return res.status(503).json({
        ok: false,
        error:
          'Newsletter email is not configured. Add RESEND_API_KEY to your environment (see Resend.com) and restart the server.',
      });
    }
    const from = String(process.env.RESEND_FROM_EMAIL || '').trim();
    if (!from) {
      return res.status(503).json({
        ok: false,
        error:
          'Newsletter email is not configured. Set RESEND_FROM_EMAIL to a verified sender address (e.g. newsletters@yourdomain.com).',
      });
    }

    const siteBase = newsletterPublicSiteBase();
    if (!siteBase) {
      return res.status(400).json({
        ok: false,
        error:
          'SITE_URL must be set in the environment so each email can include a correct unsubscribe link (e.g. https://yourdomain.com).',
      });
    }

    const subject = stripText(req.body.subject, 998);
    if (!subject) {
      return res.status(400).json({ ok: false, error: 'Subject is required.' });
    }
    const htmlBody = String(req.body.html || '').slice(0, 500000);

    const rows = await qr(
      `SELECT email, token FROM subscribers WHERE status = 'active' ORDER BY id ASC`
    );

    const resend = new Resend(apiKey);
    let sent = 0;
    let failed = 0;

    for (const row of rows) {
      const html = buildNewsletterEmailHtml(htmlBody, siteBase, row.token);
      try {
        const { error } = await resend.emails.send({
          from,
          to: row.email,
          subject,
          html,
        });
        if (error) failed += 1;
        else sent += 1;
      } catch {
        failed += 1;
      }
    }

    logAdminFire(
      req,
      'newsletter_send',
      'newsletter',
      '',
      `subject="${subject.slice(0, 160)}" recipients=${rows.length} sent=${sent} failed=${failed}`
    );

    res.json({ ok: true, sent, failed });
  })
);

app.get(
  '/api/admin/analytics',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const kv = await getKvMap();
    const visitorCount = Math.max(0, Number(kv.visitor_count || 0));
    const pv = await q1(`SELECT COALESCE(SUM(view_count), 0)::bigint AS s FROM projects`);
    const bv = await q1(`SELECT COALESCE(SUM(view_count), 0)::bigint AS s FROM blog_posts`);
    const projectViews = Number(pv?.s || 0);
    const blogViews = Number(bv?.s || 0);

    const views7 = await q1(
      `SELECT COUNT(*)::bigint AS c FROM page_views WHERE created_at >= NOW() - INTERVAL '7 days'`
    );
    const views30 = await q1(
      `SELECT COUNT(*)::bigint AS c FROM page_views WHERE created_at >= NOW() - INTERVAL '30 days'`
    );
    const uni7 = await q1(
      `SELECT COUNT(DISTINCT ip_hash)::bigint AS c FROM page_views WHERE created_at >= NOW() - INTERVAL '7 days'`
    );
    const uni30 = await q1(
      `SELECT COUNT(DISTINCT ip_hash)::bigint AS c FROM page_views WHERE created_at >= NOW() - INTERVAL '30 days'`
    );

    const topPages = await qr(
      `SELECT path, COUNT(*)::bigint AS views
       FROM page_views
       WHERE created_at >= NOW() - INTERVAL '30 days'
       GROUP BY path
       ORDER BY views DESC, path ASC
       LIMIT 10`
    );

    const topReferrers = await qr(
      `SELECT referrer, COUNT(*)::bigint AS views
       FROM page_views
       WHERE created_at >= NOW() - INTERVAL '30 days' AND referrer <> ''
       GROUP BY referrer
       ORDER BY views DESC, referrer ASC
       LIMIT 10`
    );

    const devices = await qr(
      `SELECT device_type AS device, COUNT(*)::bigint AS views
       FROM page_views
       WHERE created_at >= NOW() - INTERVAL '30 days'
       GROUP BY device_type
       ORDER BY views DESC`
    );

    const daily = await qr(
      `WITH day_series AS (
         SELECT generate_series(
           (CURRENT_DATE - INTERVAL '29 days')::date,
           CURRENT_DATE,
           '1 day'::interval
         )::date AS stat_date
       )
       SELECT s.stat_date::text AS date,
              COALESCE(ds.views, 0)::bigint AS views,
              COALESCE(ds.unique_visitors, 0)::bigint AS "uniqueVisitors"
       FROM day_series s
       LEFT JOIN daily_stats ds ON ds.date = s.stat_date
       ORDER BY s.stat_date ASC`
    );

    res.json({
      ok: true,
      visitorCount,
      projectViews,
      blogViews,
      totals: {
        views7d: Number(views7?.c || 0),
        views30d: Number(views30?.c || 0),
        unique7d: Number(uni7?.c || 0),
        unique30d: Number(uni30?.c || 0),
      },
      topPages: topPages.map((r) => ({ path: r.path, views: Number(r.views) })),
      topReferrers: topReferrers.map((r) => ({ referrer: r.referrer, views: Number(r.views) })),
      devices: devices.map((r) => ({ device: r.device, views: Number(r.views) })),
      daily: daily.map((r) => ({
        date: r.date,
        views: Number(r.views),
        uniqueVisitors: Number(r.uniqueVisitors),
      })),
    });
  })
);

app.post(
  '/api/admin/projects',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const kind = req.body.kind === 'microsaas' ? 'microsaas' : 'project';
    const title = stripText(req.body.title, 160);
    let slug = String(req.body.slug || '').trim().slice(0, 120).toLowerCase();
    if (!title) return res.status(400).json({ ok: false, error: 'Title required' });
    if (!slug) slug = slugify(title);
    const short_desc = stripText(req.body.short_desc, 800);
    const long_desc = stripText(req.body.long_desc, 12000);
    const image = String(req.body.image || '').slice(0, 500);
    const link_url = String(req.body.link_url || '').trim().slice(0, 800);
    const sort_order = Number(req.body.sort_order) || 0;
    const featured = req.body.featured ? 1 : 0;
    try {
      const ins = await query(
        `INSERT INTO projects (kind, title, slug, short_desc, long_desc, image, link_url, featured, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
        [kind, title, slug, short_desc, long_desc, image, link_url, featured, sort_order]
      );
      const row = ins.rows[0];
      logAdminFire(req, 'project_create', 'project', String(row.id), String(row.slug || row.title || ''));
      res.json({ ok: true, project: row });
    } catch (e) {
      if (isUniqueViolation(e)) {
        return res.status(409).json({ ok: false, error: 'Slug already exists' });
      }
      throw e;
    }
  })
);

app.put(
  '/api/admin/projects/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!(await q1(`SELECT id FROM projects WHERE id = ?`, [id]))) {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }
    const kind = req.body.kind === 'microsaas' ? 'microsaas' : 'project';
    const title = stripText(req.body.title, 160);
    let slug = String(req.body.slug || '').trim().slice(0, 120).toLowerCase();
    if (!title) return res.status(400).json({ ok: false, error: 'Title required' });
    if (!slug) slug = slugify(title);
    const short_desc = stripText(req.body.short_desc, 800);
    const long_desc = stripText(req.body.long_desc, 12000);
    const image = String(req.body.image || '').slice(0, 500);
    const link_url = String(req.body.link_url || '').trim().slice(0, 800);
    const sort_order = Number(req.body.sort_order) || 0;
    const featured = req.body.featured ? 1 : 0;
    try {
      await query(
        `UPDATE projects SET kind = ?, title = ?, slug = ?, short_desc = ?, long_desc = ?, image = ?,
       link_url = ?, featured = ?, sort_order = ?, updated_at = NOW() WHERE id = ?`,
        [kind, title, slug, short_desc, long_desc, image, link_url, featured, sort_order, id]
      );
      const row = await q1(`SELECT * FROM projects WHERE id = ?`, [id]);
      logAdminFire(req, 'project_update', 'project', String(id), String(row.slug || row.title || ''));
      res.json({ ok: true, project: row });
    } catch (e) {
      if (isUniqueViolation(e)) {
        return res.status(409).json({ ok: false, error: 'Slug already exists' });
      }
      throw e;
    }
  })
);

app.delete(
  '/api/admin/projects/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const pid = Number(req.params.id);
    await query(`DELETE FROM projects WHERE id = ?`, [pid]);
    logAdminFire(req, 'project_delete', 'project', String(pid), '');
    res.json({ ok: true });
  })
);

app.post(
  '/api/admin/blog/categories',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const name = stripText(req.body.name, 120);
    let slug = String(req.body.slug || '').trim().slice(0, 120).toLowerCase();
    if (!name) return res.status(400).json({ ok: false, error: 'Name required' });
    if (!slug) slug = slugify(name);
    const sort_order = Number(req.body.sort_order) || 0;
    try {
      const ins = await query(
        `INSERT INTO blog_categories (name, slug, sort_order) VALUES (?, ?, ?) RETURNING *`,
        [name, slug, sort_order]
      );
      const row = ins.rows[0];
      logAdminFire(req, 'blog_category_create', 'blog_category', String(row.id), String(row.slug || row.name || ''));
      res.json({ ok: true, category: row });
    } catch (e) {
      if (isUniqueViolation(e)) {
        return res.status(409).json({ ok: false, error: 'Slug exists' });
      }
      throw e;
    }
  })
);

app.put(
  '/api/admin/blog/categories/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!(await q1(`SELECT id FROM blog_categories WHERE id = ?`, [id]))) {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }
    const name = stripText(req.body.name, 120);
    let slug = String(req.body.slug || '').trim().slice(0, 120).toLowerCase();
    if (!name) return res.status(400).json({ ok: false, error: 'Name required' });
    if (!slug) slug = slugify(name);
    const sort_order = Number(req.body.sort_order) || 0;
    try {
      await query(
        `UPDATE blog_categories SET name = ?, slug = ?, sort_order = ? WHERE id = ?`,
        [name, slug, sort_order, id]
      );
      const row = await q1(`SELECT * FROM blog_categories WHERE id = ?`, [id]);
      logAdminFire(req, 'blog_category_update', 'blog_category', String(id), String(row.slug || row.name || ''));
      res.json({ ok: true, category: row });
    } catch (e) {
      if (isUniqueViolation(e)) {
        return res.status(409).json({ ok: false, error: 'Slug exists' });
      }
      throw e;
    }
  })
);

app.delete(
  '/api/admin/blog/categories/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const inUse = await q1(`SELECT 1 AS x FROM blog_posts WHERE category_id = ? LIMIT 1`, [id]);
    if (inUse) return res.status(400).json({ ok: false, error: 'Category in use' });
    await query(`DELETE FROM blog_categories WHERE id = ?`, [id]);
    logAdminFire(req, 'blog_category_delete', 'blog_category', String(id), '');
    res.json({ ok: true });
  })
);

app.post(
  '/api/admin/blog/posts',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const category_id = Number(req.body.category_id) || 1;
    if (!(await q1(`SELECT id FROM blog_categories WHERE id = ?`, [category_id]))) {
      return res.status(400).json({ ok: false, error: 'Invalid category' });
    }
    const title = stripText(req.body.title, 200);
    let slug = String(req.body.slug || '').trim().slice(0, 120).toLowerCase();
    if (!title) return res.status(400).json({ ok: false, error: 'Title required' });
    if (!slug) slug = slugify(title);
    const excerpt = stripText(req.body.excerpt, 600);
    const bodyText = stripText(req.body.body, 60000);
    const published = req.body.published ? 1 : 0;
    const published_at =
      stripText(req.body.published_at, 40) || new Date().toISOString().slice(0, 19).replace('T', ' ');
    const meta_title = stripText(req.body.meta_title, 200);
    const meta_description = stripText(req.body.meta_description, 400);
    const meta_keywords = stripText(req.body.meta_keywords, 400);
    try {
      const ins = await query(
        `INSERT INTO blog_posts (category_id, title, slug, excerpt, body, published, published_at, meta_title, meta_description, meta_keywords)
         VALUES (?, ?, ?, ?, ?, ?, ?::timestamp, ?, ?, ?)
         RETURNING *`,
        [
          category_id,
          title,
          slug,
          excerpt,
          bodyText,
          published,
          published_at,
          meta_title,
          meta_description,
          meta_keywords,
        ]
      );
      const row = ins.rows[0];
      logAdminFire(req, 'blog_post_create', 'blog_post', String(row.id), String(row.slug || row.title || ''));
      res.json({ ok: true, post: row });
    } catch (e) {
      if (isUniqueViolation(e)) {
        return res.status(409).json({ ok: false, error: 'Slug exists' });
      }
      throw e;
    }
  })
);

app.put(
  '/api/admin/blog/posts/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!(await q1(`SELECT id FROM blog_posts WHERE id = ?`, [id]))) {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }
    const category_id = Number(req.body.category_id) || 1;
    const title = stripText(req.body.title, 200);
    let slug = String(req.body.slug || '').trim().slice(0, 120).toLowerCase();
    if (!title) return res.status(400).json({ ok: false, error: 'Title required' });
    if (!slug) slug = slugify(title);
    const excerpt = stripText(req.body.excerpt, 600);
    const bodyText = stripText(req.body.body, 60000);
    const published = req.body.published ? 1 : 0;
    const published_at = stripText(req.body.published_at, 40);
    const meta_title = stripText(req.body.meta_title, 200);
    const meta_description = stripText(req.body.meta_description, 400);
    const meta_keywords = stripText(req.body.meta_keywords, 400);
    try {
      await query(
        `UPDATE blog_posts SET category_id = ?, title = ?, slug = ?, excerpt = ?, body = ?, published = ?,
       published_at = COALESCE(?::timestamp, published_at), meta_title = ?, meta_description = ?, meta_keywords = ?,
       updated_at = NOW() WHERE id = ?`,
        [
          category_id,
          title,
          slug,
          excerpt,
          bodyText,
          published,
          published_at || null,
          meta_title,
          meta_description,
          meta_keywords,
          id,
        ]
      );
      const row = await q1(`SELECT * FROM blog_posts WHERE id = ?`, [id]);
      logAdminFire(req, 'blog_post_update', 'blog_post', String(id), String(row.slug || row.title || ''));
      res.json({ ok: true, post: row });
    } catch (e) {
      if (isUniqueViolation(e)) {
        return res.status(409).json({ ok: false, error: 'Slug exists' });
      }
      throw e;
    }
  })
);

app.delete(
  '/api/admin/blog/posts/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const bid = Number(req.params.id);
    await query(`DELETE FROM blog_posts WHERE id = ?`, [bid]);
    logAdminFire(req, 'blog_post_delete', 'blog_post', String(bid), '');
    res.json({ ok: true });
  })
);

app.put(
  '/api/admin/seo',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const pagePath = normalizeSeoPath(req.body.path);
    const meta_title = stripText(req.body.meta_title, 200);
    const meta_description = stripText(req.body.meta_description, 500);
    const meta_keywords = stripText(req.body.meta_keywords, 500);
    await query(
      `INSERT INTO page_seo (path, meta_title, meta_description, meta_keywords)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET
       meta_title = EXCLUDED.meta_title,
       meta_description = EXCLUDED.meta_description,
       meta_keywords = EXCLUDED.meta_keywords`,
      [pagePath, meta_title, meta_description, meta_keywords]
    );
    logAdminFire(req, 'seo_update', 'page_seo', pagePath, meta_title.slice(0, 120));
    res.json({ ok: true });
  })
);

app.delete(
  '/api/admin/seo',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const pagePath = normalizeSeoPath(req.query.path);
    await query(`DELETE FROM page_seo WHERE path = ?`, [pagePath]);
    logAdminFire(req, 'seo_delete', 'page_seo', pagePath, '');
    res.json({ ok: true });
  })
);

app.get(
  '/api/translations/:locale',
  asyncHandler(async (req, res) => {
    const loc = normalizeLang(req.params.locale);
    if (!loc) return res.status(400).json({ ok: false, error: 'Invalid locale' });
    if (!I18N_LOCALES.includes(loc)) {
      return res.status(404).json({ ok: false, error: 'Unsupported locale' });
    }
    res.json({ ok: true, locale: loc, strings: await translationMapForLocale(loc) });
  })
);

app.get(
  '/api/admin/translations',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const rows = await qr(
      `SELECT locale, translation_key AS k, value AS v FROM translations ORDER BY translation_key ASC, locale ASC`
    );
    const keys = [...new Set(rows.map((r) => r.k))];
    const matrix = {};
    for (const k of keys) matrix[k] = {};
    for (const r of rows) {
      matrix[r.k][r.locale] = r.v;
    }
    const catalogKeys = getAllKeys();
    for (const k of catalogKeys) {
      if (!matrix[k]) matrix[k] = {};
    }
    const mergedKeys = [...new Set([...keys, ...catalogKeys])].sort();
    res.json({
      ok: true,
      locales: [...I18N_LOCALES],
      localeLabels: LOCALE_LABELS,
      keys: mergedKeys,
      matrix,
    });
  })
);

app.put(
  '/api/admin/translations/:key',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const translationKey = stripText(decodeURIComponent(req.params.key || ''), 200);
    if (!translationKey) return res.status(400).json({ ok: false, error: 'key required' });
    const raw = req.body || {};
    const values = raw.values && typeof raw.values === 'object' ? raw.values : raw;
    if (!values || typeof values !== 'object') {
      return res.status(400).json({ ok: false, error: 'values map required (per-locale strings)' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [locRaw, val] of Object.entries(values)) {
        const lc = normalizeLang(locRaw);
        if (!lc || !I18N_LOCALES.includes(lc)) continue;
        await client.query(
          `INSERT INTO translations (locale, translation_key, value) VALUES ($1, $2, $3)
           ON CONFLICT (locale, translation_key) DO UPDATE SET value = EXCLUDED.value`,
          [lc, translationKey, String(val ?? '').slice(0, 8000)]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    logAdminFire(req, 'translation_update', 'translation', translationKey, `${Object.keys(values).length} locale(s)`);
    res.json({ ok: true });
  })
);

app.post(
  '/api/admin/translations/bulk',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const locale = normalizeLang(req.body.locale);
    if (!locale) return res.status(400).json({ ok: false, error: 'locale required' });
    const entries = req.body.entries;
    if (!entries || typeof entries !== 'object') {
      return res.status(400).json({ ok: false, error: 'entries object required' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [key, val] of Object.entries(entries)) {
        const k = stripText(key, 80);
        if (!k) continue;
        await client.query(
          `INSERT INTO translations (locale, translation_key, value) VALUES ($1, $2, $3)
     ON CONFLICT(locale, translation_key) DO UPDATE SET value = EXCLUDED.value`,
          [locale, k, String(val ?? '').slice(0, 8000)]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    logAdminFire(
      req,
      'translation_bulk',
      'translation',
      locale,
      `${Object.keys(entries).length} key(s)`
    );
    res.json({ ok: true });
  })
);

app.delete(
  '/api/admin/translations',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const locale = normalizeLang(req.query.locale);
    const key = stripText(req.query.key, 80);
    if (!locale || !key) return res.status(400).json({ ok: false, error: 'locale and key required' });
    await query(`DELETE FROM translations WHERE locale = ? AND translation_key = ?`, [locale, key]);
    logAdminFire(req, 'translation_delete', 'translation', `${locale}:${key}`, '');
    res.json({ ok: true });
  })
);

app.get(
  '/api/public/translations',
  asyncHandler(async (req, res) => {
    const locale = normalizeLang(req.query.locale);
    if (!locale) return res.json({ ok: true, locale: '', strings: {} });
    res.json({ ok: true, locale, strings: await translationMapForLocale(locale) });
  })
);

app.post(
  '/api/admin/upload',
  requireAdmin,
  (req, res) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ ok: false, error: err.message || 'Upload failed' });
      }
      if (!req.file) return res.status(400).json({ ok: false, error: 'No file' });
      const url = `/uploads/${req.file.filename}`;
      logAdminFire(req, 'media_upload', 'media', req.file.filename, url);
      res.json({ ok: true, url });
    });
  }
);

function safeUploadsBasename(raw) {
  let s = String(raw ?? '');
  try {
    s = decodeURIComponent(s);
  } catch {
    return null;
  }
  if (/[/\\]/.test(s) || s.includes('\0')) return null;
  const base = path.basename(s);
  if (!base || base === '.' || base === '..') return null;
  if (base.includes('..')) return null;
  return base;
}

function resolvedUploadFilePath(filenameParam) {
  const base = safeUploadsBasename(filenameParam);
  if (!base) return null;
  const root = path.resolve(uploadsDir);
  const target = path.resolve(path.join(root, base));
  if (target === root) return null;
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return target;
}

app.get(
  '/api/admin/media',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const root = path.resolve(uploadsDir);
    const names = await fsp.readdir(root, { withFileTypes: true });
    const files = [];
    for (const d of names) {
      if (!d.isFile()) continue;
      const name = d.name;
      if (safeUploadsBasename(name) !== name) continue;
      const full = path.join(root, name);
      const st = await fsp.stat(full);
      files.push({
        name,
        size: st.size,
        mtime: st.mtime.toISOString(),
        url: `/uploads/${name}`,
      });
    }
    files.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
    res.json({ ok: true, files });
  })
);

app.delete(
  '/api/admin/media/:filename',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const target = resolvedUploadFilePath(req.params.filename);
    if (!target) {
      return res.status(400).json({ ok: false, error: 'Invalid filename' });
    }
    try {
      await fsp.unlink(target);
    } catch (e) {
      if (e && e.code === 'ENOENT') {
        return res.status(404).json({ ok: false, error: 'File not found' });
      }
      throw e;
    }
    const base = safeUploadsBasename(req.params.filename);
    logAdminFire(req, 'media_delete', 'media', base || '', '');
    res.json({ ok: true });
  })
);

function sitePublicBaseUrl() {
  const raw = String(process.env.SITE_URL || '').trim();
  if (raw) return raw.replace(/\/+$/, '');
  return `http://localhost:${PORT}`;
}

function sitemapDateISO(d) {
  if (d == null) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

app.get(
  '/sitemap.xml',
  asyncHandler(async (_req, res) => {
    const base = sitePublicBaseUrl();
    const staticPaths = [
      '/',
      '/about.html',
      '/contact.html',
      '/services.html',
      '/team.html',
      '/projects.html',
      '/blog.html',
    ];
    const services = await qr(
      `SELECT slug, updated_at, created_at FROM services ORDER BY id ASC`
    );
    const projects = await qr(
      `SELECT slug, updated_at, created_at FROM projects ORDER BY id ASC`
    );
    const posts = await qr(
      `SELECT slug, updated_at, published_at, created_at FROM blog_posts WHERE published = 1 ORDER BY id ASC`
    );

    const urls = [];
    for (const p of staticPaths) {
      const loc = p === '/' ? `${base}/` : `${base}${p}`;
      urls.push({ loc, lastmod: null });
    }
    for (const row of services) {
      const loc = `${base}/service.html?slug=${encodeURIComponent(row.slug)}`;
      const lm =
        sitemapDateISO(row.updated_at) || sitemapDateISO(row.created_at);
      urls.push({ loc, lastmod: lm });
    }
    for (const row of projects) {
      const loc = `${base}/project.html?slug=${encodeURIComponent(row.slug)}`;
      const lm =
        sitemapDateISO(row.updated_at) || sitemapDateISO(row.created_at);
      urls.push({ loc, lastmod: lm });
    }
    for (const row of posts) {
      const loc = `${base}/post.html?slug=${encodeURIComponent(row.slug)}`;
      const lm =
        sitemapDateISO(row.updated_at) ||
        sitemapDateISO(row.published_at) ||
        sitemapDateISO(row.created_at);
      urls.push({ loc, lastmod: lm });
    }

    const body = urls
      .map(({ loc, lastmod }) => {
        let u = `  <url>\n    <loc>${xmlEscape(loc)}</loc>`;
        if (lastmod) u += `\n    <lastmod>${xmlEscape(lastmod)}</lastmod>`;
        u += `\n  </url>`;
        return u;
      })
      .join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
    res.type('application/xml');
    res.send(xml);
  })
);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: 'Server error' });
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
      if (!isProd) {
        console.log('Dev defaults: set ADMIN_PASSWORD and DB_* via env for production.');
      }
    });
  })
  .catch((err) => {
    console.error('Database init failed:', err);
    process.exit(1);
  });
