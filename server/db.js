const fs = require('fs');
const path = require('path');
const { getPoolOptions } = require('./pg-config');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { getAllSeedRows, getSeedStringsForLocale } = require('./i18n-seeds');

const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');

function ensureUploadsDir() {
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
}

ensureUploadsDir();

const pool = new Pool(getPoolOptions());

function toPg(sql, params = []) {
  let i = 0;
  const text = String(sql).replace(/\?/g, () => `$${++i}`);
  return { text, params };
}

async function query(sql, params = []) {
  const { text, params: p } = toPg(sql, params);
  return pool.query(text, p);
}

async function qr(sql, params = []) {
  const r = await query(sql, params);
  return r.rows;
}

async function q1(sql, params = []) {
  const rows = await qr(sql, params);
  return rows[0];
}

async function runSqlFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const chunks = raw
    .split(/;\s*\n\s*\n/)
    .map((s) => s.trim())
    .filter((c) => c.length > 0);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const chunk of chunks) {
      const stmt = chunk
        .split('\n')
        .filter((line) => !/^\s*--/.test(line))
        .join('\n')
        .trim();
      if (!stmt) continue;
      await client.query(stmt + (stmt.endsWith(';') ? '' : ';'));
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function runMigrations() {
  const migrationsDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let applied = new Set();
  try {
    const r = await pool.query('SELECT version FROM schema_migrations');
    applied = new Set(r.rows.map((x) => x.version));
  } catch {
    /* schema_migrations not yet created */
  }

  for (const file of files) {
    const version = file.replace(/\.sql$/i, '');
    if (applied.has(version)) continue;
    await runSqlFile(path.join(migrationsDir, file));
    await pool.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
  }
}

async function getKvMap() {
  const rows = await qr(`SELECT key, value FROM site_kv`);
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

async function setKv(key, value) {
  await query(
    `INSERT INTO site_kv (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function translationMapForLocale(locale) {
  if (!locale) return {};
  const seed = getSeedStringsForLocale(locale);
  const rows = await qr(`SELECT translation_key AS k, value AS v FROM translations WHERE locale = ?`, [locale]);
  const out = { ...seed };
  for (const r of rows) {
    if (r && r.k != null) out[r.k] = r.v;
  }
  return out;
}

async function kvCount() {
  const row = await q1(`SELECT COUNT(*)::int AS c FROM site_kv`);
  return row ? row.c : 0;
}

async function ensureKvDefaults() {
  const defaults = {
    contact_map_embed_url:
      'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d193595.15830869428!2d-74.11976397304903!3d40.69766374874458!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x89c24fa5d33f083b%3A0xc80e8e51e9698b08!2sNew%20York%2C%20NY%2C%20USA!5e0!3m2!1sen!2sus!4v1715000000000',
    default_locale: 'en',
    visitor_count: '12480',
    home_projects_title: 'Projects & micro-SaaS',
    home_projects_intro:
      'Shipping products for clients—and a few of our own small bets—in production today.',
    feature_flags_json: JSON.stringify({ showProjects: true, showBlog: true }),
    analytics_mock_json: JSON.stringify({
      weeklyVisitors: [120, 145, 132, 168, 155, 190, 210],
      weeklyBlogReads: [42, 38, 55, 61, 48, 72, 68],
      engagementScore: 87,
    }),
  };
  for (const [k, v] of Object.entries(defaults)) {
    await query(
      `INSERT INTO site_kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING`,
      [k, v]
    );
  }
}

async function seedIfEmpty() {
  const defaultUser = process.env.ADMIN_USERNAME || 'admin';
  const defaultPass = process.env.ADMIN_PASSWORD || 'admin123';

  const adminExists = await q1(`SELECT 1 AS x FROM admin_user WHERE id = 1`);
  if (!adminExists) {
    const hash = bcrypt.hashSync(defaultPass, 12);
    await query(`INSERT INTO admin_user (id, username, password_hash) VALUES (1, ?, ?)`, [
      defaultUser,
      hash,
    ]);
  }

  if ((await kvCount()) === 0) {
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
    for (const [k, v] of Object.entries(defaults)) {
      await query(`INSERT INTO site_kv (key, value) VALUES (?, ?)`, [k, v]);
    }
  }

  await ensureKvDefaults();

  const svcCount = (await q1(`SELECT COUNT(*)::int AS c FROM services`)).c;
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
    for (const r of rows) {
      await query(
        `INSERT INTO services (title, slug, short_desc, long_desc, icon, image, sort_order, featured)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        r
      );
    }
  }

  const teamCount = (await q1(`SELECT COUNT(*)::int AS c FROM team_members`)).c;
  if (teamCount === 0) {
    const t = [
      ['Alex Rivera', 'Founder & Creative Director', 'Leads vision, brand, and client partnerships.', '', 1],
      ['Jordan Lee', 'Lead Engineer', 'Architecture, performance, and developer experience.', '', 2],
      ['Sam Patel', 'Product Designer', 'Research, UX flows, and interface craft.', '', 3],
    ];
    for (const row of t) {
      await query(
        `INSERT INTO team_members (name, role, bio, image, sort_order) VALUES (?, ?, ?, ?, ?)`,
        row
      );
    }
  }

  await seedBlogIfEmpty();
  await seedProjectsIfEmpty();
  await seedSeoIfEmpty();
  await seedTranslationsIfEmpty();
}

async function seedBlogIfEmpty() {
  const n = (await q1(`SELECT COUNT(*)::int AS n FROM blog_categories`)).n;
  if (n > 0) return;

  await query(`INSERT INTO blog_categories (name, slug, sort_order) VALUES ('News', 'news', 1)`);
  await query(`INSERT INTO blog_categories (name, slug, sort_order) VALUES ('Product', 'product', 2)`);
  await query(`INSERT INTO blog_categories (name, slug, sort_order) VALUES ('Company', 'company', 3)`);

  const newsId = (await q1(`SELECT id FROM blog_categories WHERE slug = 'news'`)).id;
  const productId = (await q1(`SELECT id FROM blog_categories WHERE slug = 'product'`)).id;
  const companyId = (await q1(`SELECT id FROM blog_categories WHERE slug = 'company'`)).id;

  const posts = [
    [
      newsId,
      'Nexus Studio expands remote delivery footprint',
      'nexus-expands-remote-delivery',
      'How we scale synchronous collaboration without slowing delivery cadence.',
      'Teams often ask how we keep velocity high across time zones. Our answer is simple: fewer meetings, clearer artifacts, and a shared definition of done.\n\nIn this post we share the rituals that keep stakeholders aligned without thrash—the same patterns we use on client engagements weekly.',
      'Remote delivery at scale | Nexus Studio',
      'Practical rituals for distributed teams shipping product and web experiences.',
      'remote, delivery, collaboration',
      '-2 days',
    ],
    [
      productId,
      'Introducing better performance budgets for marketing sites',
      'performance-budgets-marketing-sites',
      'A practical checklist to keep Lighthouse green as content grows.',
      'Performance is a feature—not a phase. We codify budgets for LCP, CLS, and JS payload early so content editors can publish confidently.\n\nWalk through the thresholds we recommend for brochure sites vs. app shells, and how we monitor regressions in CI.',
      'Performance budgets for marketing sites',
      'Lighthouse-friendly thresholds for brochure sites and content-heavy pages.',
      'performance, web vitals, CI',
      '-5 days',
    ],
    [
      companyId,
      'Why we invest in internal micro-SaaS',
      'internal-microsaas-investment',
      'Small tools sharpen our craft and create reference implementations.',
      'Micro-SaaS products are not a distraction—they are living labs. Shipping subscription billing, auth, and onboarding for our own tools keeps patterns fresh.\n\nClients benefit from battle-tested snippets rather than experiments invented mid-project.',
      'Micro-SaaS as a learning lab',
      'How internal products improve delivery quality for client work.',
      'microsaas, product, studio',
      '-8 days',
    ],
    [
      newsId,
      'Design systems office hours—notes from May',
      'design-systems-office-hours-may',
      'Themes, tokens, and governance questions from recent sessions.',
      'We hosted open office hours for teams adopting design systems. Common questions: token naming, when to fork a component, and how to version breaking visual changes.\n\nHere are consolidated answers plus links to further reading.',
      'Design systems office hours recap',
      'Token naming, component forks, and versioning in design systems.',
      'design systems, tokens, governance',
      '-12 days',
    ],
    [
      productId,
      'Shipping accessible forms without the friction',
      'accessible-forms-without-friction',
      'Patterns for validation, errors, and focus management that users feel as effortless.',
      'Accessible forms are not only about WCAG checklists—they reduce support load and improve completion rates. We document error copy, live regions, and keyboard flows in one place.\n\nReuse this pattern library in your next lead capture or onboarding flow.',
      'Accessible web forms—patterns',
      'Validation, focus management, and error patterns for inclusive forms.',
      'a11y, forms, UX',
      '-18 days',
    ],
  ];

  for (const p of posts) {
    await query(
      `INSERT INTO blog_posts (category_id, title, slug, excerpt, body, published, published_at, meta_title, meta_description, meta_keywords)
       VALUES (?, ?, ?, ?, ?, 1, NOW() + (?::interval), ?, ?, ?)`,
      [p[0], p[1], p[2], p[3], p[4], p[8], p[5], p[6], p[7]]
    );
  }
}

async function seedProjectsIfEmpty() {
  const n = (await q1(`SELECT COUNT(*)::int AS c FROM projects`)).c;
  if (n > 0) return;

  const rows = [
    [
      'project',
      'Orbit Analytics Platform',
      'orbit-analytics',
      'Multi-tenant dashboards for operations teams with real-time KPIs.',
      'A full redesign and rebuild of the core reporting experience. Role-based views, scheduled exports, and drill-downs that stay fast at scale.\n\nStack: React, Node, Postgres. Engagements included UX research, UI system, and observability hardening.',
      'https://example.com/orbit',
      1,
      1,
      420,
    ],
    [
      'microsaas',
      'PulsePing',
      'pulseping-microsaas',
      'Uptime alerts and status pages for lean teams—our in-house micro-SaaS.',
      'Born from client requests for simpler incident comms. PulsePing combines monitoring hooks, Slack integration, and branded status pages.\n\nSubscription billing and team seats included.',
      'https://example.com/pulseping',
      1,
      2,
      890,
    ],
    [
      'project',
      'Harbor Retail Omnichannel',
      'harbor-retail',
      'Unified commerce experience across web, in-store kiosks, and staff tools.',
      'Discovery through launch: inventory sync, cart persistence, and BOPIS flows. Close collaboration with legal and compliance on regional variants.',
      'https://example.com/harbor',
      1,
      3,
      315,
    ],
    [
      'microsaas',
      'SnippetVault',
      'snippetvault',
      'Team snippet manager with shared variables and environment-scoped secrets (demo product).',
      'SnippetVault showcases secure sharing patterns we reuse in client work—scoped tokens, audit trails, and editor integrations.\n\nNot production for external signups; reference architecture only.',
      'https://example.com/snippetvault',
      0,
      4,
      210,
    ],
    [
      'project',
      'Aperture Health Portal',
      'aperture-health',
      'Patient-facing portal with appointment scheduling and encrypted messaging.',
      'Accessibility-first UI, WCAG 2.2 AA target, and hardened session handling. Worked alongside clinical stakeholders for safe consent flows.',
      'https://example.com/aperture',
      0,
      5,
      156,
    ],
  ];

  for (const r of rows) {
    await query(
      `INSERT INTO projects (kind, title, slug, short_desc, long_desc, image, link_url, featured, sort_order, view_count)
       VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?)`,
      r
    );
  }
}

async function seedSeoIfEmpty() {
  const n = (await q1(`SELECT COUNT(*)::int AS c FROM page_seo`)).c;
  if (n > 0) return;

  const rows = [
    ['/index.html', 'Nexus Studio — Digital product & web studio', 'Strategy, design, and engineering for modern web experiences.', 'digital agency, web development, product design'],
    ['/about.html', 'About Nexus Studio', 'Our story, mission, and how we partner with ambitious teams.', 'about, studio, team culture'],
    ['/services.html', 'Services — Nexus Studio', 'Discovery, design, and development engagements tailored to outcomes.', 'services, UX, engineering'],
    ['/team.html', 'Team — Nexus Studio', 'Meet the senior practitioners behind delivery.', 'team, leadership, design'],
    ['/contact.html', 'Contact Nexus Studio', 'Start a project or ask a question—we reply within two business days.', 'contact, RFP, inquiry'],
    ['/blog.html', 'Blog — Nexus Studio', 'News, product thinking, and notes from the studio.', 'blog, news, product'],
    ['/projects.html', 'Projects & micro-SaaS — Nexus Studio', 'Selected client work and internal micro-products.', 'portfolio, case studies, microsaas'],
  ];

  for (const r of rows) {
    await query(`INSERT INTO page_seo (path, meta_title, meta_description, meta_keywords) VALUES (?, ?, ?, ?)`, r);
  }
}

async function seedI18nFromMatrix() {
  for (const { locale, key, value } of getAllSeedRows()) {
    await query(
      `INSERT INTO translations (locale, translation_key, value) VALUES (?, ?, ?)
       ON CONFLICT (locale, translation_key) DO NOTHING`,
      [locale, key, value]
    );
  }
}

async function seedTranslationsIfEmpty() {
  await seedI18nFromMatrix();
}

async function initDb(options = {}) {
  const keepPoolOpen = options.keepPoolOpen !== false;
  await runMigrations();
  await seedIfEmpty();
  if (!keepPoolOpen) await pool.end();
}

function isUniqueViolation(e) {
  return e && e.code === '23505';
}

async function logActivity(adminUsername, action, entityType, entityId, details) {
  await query(
    `INSERT INTO activity_log (admin_username, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)`,
    [
      String(adminUsername || '').slice(0, 200),
      String(action || '').slice(0, 120),
      String(entityType || '').slice(0, 120),
      String(entityId ?? '').slice(0, 200),
      String(details ?? '').slice(0, 4000),
    ]
  );
}

module.exports = {
  pool,
  query,
  qr,
  q1,
  getKvMap,
  setKv,
  slugify,
  uploadsDir,
  translationMapForLocale,
  initDb,
  isUniqueViolation,
  logActivity,
};
