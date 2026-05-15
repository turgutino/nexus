# Company Site (`company-site`)

Professional company marketing site with a browser-based content admin, PostgreSQL storage, optional Redis-backed sessions, first-party analytics (consent-gated), newsletter sign-ups via [Resend](https://resend.com), and Docker Compose for local or server runs.

## Features

### Public site

- **Pages**: Home (`index.html`), About, Services (list + detail), Team, Projects (list + detail), Blog (list + search/pagination + detail), Contact (with optional attachment upload), Newsletter unsubscribe (`unsubscribe.html`).
- **Internationalization**: Language switcher and client-side overlay via `/public/js/i18n.js` and `/public/js/shell.js`; site copy is merged from `site_kv`, seed strings, and DB `translations` (see **Multi-language**). Homepage project block is omitted when `feature_flags_json` sets `showProjects` to `false` (`public/js/home.js`).
- **Newsletter**: Footer form on public pages posts to `/api/public/newsletter/subscribe`; unsubscribe uses token links handled by `/api/public/newsletter/unsubscribe` and `unsubscribe.html`.
- **Cookie consent**: `/public/js/cookie-consent.js` shows Accept/Decline; Accept sets local storage, syncs an HttpOnly analytics consent cookie via `POST /api/public/analytics-consent`, then allows tracking.
- **Analytics (first-party)**: After consent, `shell.js` posts to `/api/public/track-page` (path + referrer); legacy visit counter via `POST /api/public/track-visit`. Admin dashboard reads `page_views`, `daily_stats`, and aggregates.
- **SEO**: Per-path meta from `page_seo` via `GET /api/public/seo?path=...`; shared defaults from `site` payload when no row exists. Client helper: `/public/js/seo.js`.
- **Sitemap**: `GET /sitemap.xml` lists static HTML routes, services, projects, and published blog posts; base URL from `SITE_URL` or `http://localhost:$PORT`.
- **Robots**: `public/robots.txt` allows `/`, disallows `/admin/`, references sitemap.

### Admin panel (`/admin/`)

- **Auth**: Session cookie `sid`; login at `POST /api/admin/login`; optional TOTP second step (`/api/admin/login/totp`, `/api/admin/login/cancel`).
- **Tabs in the top navigation** (see `public/admin/index.html`):
  - **Homepage** — Global copy, hero, about page fields, map embed URL, default locale, home projects section text, `feature_flags_json` (JSON object; `showProjects` is read on the public homepage; `showBlog` appears in seeds/placeholder but is not referenced elsewhere in this codebase), `analytics_mock_json` (stored in `site_kv` with admin validation only—no other reads in this repo).
  - **Banners** — Up to six homepage banner cards (`banners_json` in `site_kv`).
  - **Services** — CRUD for services.
  - **Team** — CRUD for team members.
  - **Projects** — CRUD for projects and micro-SaaS entries (`kind` project vs microsaas).
  - **Blog** — Categories and posts (published flag, meta fields).
  - **SEO** — Per-path meta title/description/keywords in `page_seo`.
  - **Translations** — Matrix editor for `translations` table (all seeded keys + DB overrides).
  - **Media** — Upload images to `public/uploads/`, list, filter, delete files on disk.
  - **Newsletter** — Paginated subscribers, status filter, CSV export of active emails, HTML newsletter send via Resend with per-recipient unsubscribe footer.
  - **Security** — TOTP 2FA setup (QR + enable/disable with password).
  - **Activity** — Paginated `activity_log`, action filter, auto-refresh every 30s while open.
  - **Analytics** — Charts (Chart.js CDN) for daily views/uniques, devices, top pages and referrers; legacy visitor count and content view totals.

**Contact messages**: `public/admin/index.html` includes a **Contact messages** section (`#tab-messages`) with CSV export and list rendering driven by bootstrap data, but there is **no tab button** in the current nav to switch to that panel (APIs and export still exist).

### Backend / infra

- **PostgreSQL** with versioned SQL migrations on startup.
- **Redis**: Used for `express-session` when the server can connect; otherwise sessions fall back to memory (logged at startup).
- **Rate limiting** on `/api/*` groups (public, contact, newsletter, login, TOTP, tracking) via `express-rate-limit`.
- **Helmet** enabled with CSP disabled (see `server/server.js`).

## Tech stack

| Layer | Technology |
|--------|------------|
| Runtime | Node.js (Dockerfile & CI use **20**; `package.json` lists `>=18`; Resend’s package expects Node 20+) |
| Server | Express |
| Database | PostgreSQL (`pg`) |
| Sessions | `express-session` + `connect-redis` / `ioredis` (optional Redis) |
| Auth | `bcryptjs`; TOTP via `speakeasy` + `qrcode` |
| Email | `resend` |
| Uploads | `multer` → `public/uploads/` |
| Front (public) | Static HTML + vanilla JS + `public/css/styles.css` |
| Admin UI | Vanilla JS + CSS; Chart.js loaded from jsDelivr |
| Container | Docker Compose: `postgres:16-alpine`, `redis:7-alpine`, app image from repo `Dockerfile` |

## Project structure

```text
company-site/
├── .env.example
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── dependency-review.yml
├── docker-compose.yml
├── Dockerfile
├── package.json
├── package-lock.json
├── POSTGRES.md
├── public/
│   ├── admin/              # Admin SPA (index.html, admin.js, admin.css)
│   ├── css/styles.css
│   ├── js/                 # i18n, shell, pages, cookie-consent, newsletter-footer, seo, …
│   ├── uploads/.gitkeep
│   ├── *.html              # Site pages + unsubscribe.html
│   └── robots.txt
└── server/
    ├── db.js               # Pool, migrations runner, seeding, helpers
    ├── i18n-seeds.js       # Default locale matrix + labels
    ├── pg-config.js        # dotenv + DATABASE_URL / DB_*
    ├── server.js           # Express app, routes
    ├── migrations/         # 001_schema … 005_newsletter
    └── scripts/
        └── sqlite-to-postgres.js
```

## Prerequisites

- **Node.js**: Use **20+** for parity with `Dockerfile`, GitHub Actions, and the `resend` dependency; `package.json` still declares `"node": ">=18"`.
- **PostgreSQL** (local or remote).
- **Redis** (recommended for production or multiple app instances); app runs without it using an in-memory session store.
- **Docker & Docker Compose** (optional): run DB + Redis + app together.

## Local setup

1. **Clone** the repository and `cd` into it.

2. **Install dependencies**  
   `npm install`

3. **Environment**  
   Copy `.env.example` to `.env` and set values (see **Environment variables**).  
   Ensure PostgreSQL is running and credentials match `DB_*` or `DATABASE_URL`.

4. **Database migrations and seed**  
   On first `npm start` (or `npm run dev`), `server/db.js` runs `initDb()`:** migrations** from `server/migrations/*.sql` (tracked in `schema_migrations`), then **seeds** when tables are empty: admin user, `site_kv`, services, team, blog, projects, `page_seo`, and translation seed rows (`ON CONFLICT DO NOTHING` for translations).  
   There is no separate `npm run migrate` / `npm run seed` script.

5. **Run**  
   `npm start`  
   Server listens on `PORT` (default **3000**). Open `http://localhost:3000/`.  
   Admin: `http://localhost:3000/admin/`.

## Docker Compose (single command)

From the project root (with `.env` present — copy from `.env.example`):

```bash
docker compose up --build
```

`docker-compose.yml` starts PostgreSQL, Redis, and the app; the app service sets `DB_HOST=postgres` and `REDIS_URL=redis://redis:6379`, and maps `${PORT:-3000}`. Comments in the file note `-d` for detached mode.

## Environment variables

Read from `.env` via `server/pg-config.js` (and `process.env` elsewhere). All are optional unless noted.

| Variable | Role |
|----------|------|
| `PORT` | HTTP port (default `3000`). |
| `NODE_ENV` | If `production`, stricter cookie `Secure`, production `SESSION_SECRET` required, and newsletter base URL logic. |
| `SESSION_SECRET` | Express session signing secret. **Required in production** (server exits if missing). Dev fallback exists only when not production. |
| `REDIS_URL` | Redis connection string for session store (default `redis://localhost:6379`). Compose overrides to `redis://redis:6379` for the app container. |
| `DATABASE_URL` | Full PostgreSQL URL; if set, used instead of discrete `DB_*` fields. |
| `DB_HOST` | Postgres host (default `localhost`). |
| `DB_PORT` | Postgres port (default `5432`). |
| `DB_USER` | Postgres user (default `postgres`). |
| `DB_PASSWORD` | Postgres password (empty string if unset). |
| `DB_NAME` | Database name (default `company_db`). |
| `ADMIN_USERNAME` | Username for the initial `admin_user` row (created only if none exists). |
| `ADMIN_PASSWORD` | Plain password for that initial user (hashed on insert). |
| `SITE_URL` | Canonical public URL, no trailing slash: sitemap `<loc>` values, Resend unsubscribe links (`newsletterPublicSiteBase()`), and `sitePublicBaseUrl()` fallback messaging. Required for sending newsletters (validated in `/api/admin/newsletter/send`). |
| `RESEND_API_KEY` | Resend API key; required to send newsletters from admin. |
| `RESEND_FROM_EMAIL` | Verified sender string for Resend (e.g. `News <news@domain.com>`). |
| `ANALYTICS_IP_SALT` | Salt for SHA-256 hashing of client IPs in analytics; falls back to `SESSION_SECRET` or a dev default string if unset. |
| `TOTP_ISSUER` | Issuer name embedded in otpauth URLs for 2FA setup (default `Company Admin`). |

## Admin access

- URL: **`/admin/`** (also disallowed in `robots.txt` for crawlers).
- Credentials: whatever was seeded — first boot uses `ADMIN_USERNAME` / `ADMIN_PASSWORD` from `.env` if no admin row exists; the login UI hints at `admin` / `admin123` when using defaults.
- With **TOTP enabled**, after password login the API returns `needTotp: true` and the UI collects a 6-digit code.

## API overview

### Public (`/api/public/…`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/public/site` | Site payload, services, team preview, optional project preview (`?lang=`). |
| GET | `/api/public/contact-page` | Map embed URL for contact page. |
| POST | `/api/public/track-visit` | Increments `visitor_count` in `site_kv` (rate limited). |
| POST | `/api/public/analytics-consent` | Sets HttpOnly analytics consent cookie. |
| POST | `/api/public/track-page` | Records page view if consent cookie set (rate limited). |
| GET | `/api/public/projects` | List projects; optional `?kind=project|microsaas`. |
| GET | `/api/public/projects/:slug` | Project detail; increments `view_count`. |
| GET | `/api/public/blog/categories` | Blog categories. |
| GET | `/api/public/blog/posts` | Paginated/searchable posts (`limit`, `page`, `q`, `category`). |
| GET | `/api/public/blog/posts/:slug` | Post detail; increments view count. |
| GET | `/api/public/seo` | SEO meta for `?path=` |
| GET | `/api/public/services` | All services. |
| GET | `/api/public/services/:slug` | Service by slug. |
| GET | `/api/public/team` | All team members. |
| POST | `/api/public/contact` | Contact form (+ optional multipart attachment). |
| POST | `/api/public/newsletter/subscribe` | Subscribe or reactivate subscriber. |
| GET | `/api/public/newsletter/unsubscribe` | Unsubscribe via `?token=`. |
| GET | `/api/public/translations` | Merged strings for `?locale=`. |
| GET | `/api/translations/:locale` | Same pattern, path param locale (must be supported). |

### Admin (`/api/admin/…`, session required except login/session)

Auth & security: `POST /login`, `POST /login/cancel`, `POST /login/totp`, `POST /logout`, `GET /session`, `GET|POST /2fa/*` (status, setup, enable, disable).

Content & CMS: `GET /bootstrap`, `PUT /site`, CRUD `/services`, `/team`, `/projects`, blog `/blog/categories`, `/blog/posts`, `PUT|DELETE /seo`, `GET|PUT|POST|DELETE /translations…`, `POST /upload`, `GET|DELETE /media…`.

Contact: `PATCH /messages/:id/read`, `DELETE /messages/:id`, `GET /messages/export.csv`.

Newsletter: `GET /newsletter/subscribers`, `DELETE /newsletter/subscribers/:id`, `GET /newsletter/export.csv`, `POST /newsletter/send`.

Analytics & audit: `GET /analytics`, `GET /activity-log`.

## Multi-language support (7 locales)

`server/i18n-seeds.js` defines:

`en`, `tr`, `az`, `ru`, `fr`, `es`, `de` with `LOCALE_LABELS` for display names.

Public pages load overlay strings from API; CMS can override via **Translations** admin tab and `site_kv` fields applied in `applyTranslations` on `/api/public/site`.

## Newsletter and email

1. Create a Resend account and verify sending domain / sender.
2. Set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` in `.env`.
3. Set `SITE_URL` to the deployed HTTPS origin (used in unsubscribe links in sent HTML).
4. Use **Newsletter** tab: compose HTML, preview, send to all **active** subscribers. Each message appends an unsubscribe block linking to `{SITE_URL}/unsubscribe.html?token=…`.

Public signup: footer forms use `/public/js/newsletter-footer.js` → `POST /api/public/newsletter/subscribe`.

## CI/CD (GitHub Actions)

- **`ci.yml`**: On PRs and pushes to `main`, runs `npm ci` and `node --check` on `server/server.js` and `server/db.js` (Node 20). On **push to `main` only**, a **deploy** job SSHs to the server and runs `git pull`, `npm ci --omit=dev`, and `pm2 restart` or `pm2 start server/server.js --name company-site` in `~/company-site`.
  - **Repository secrets (deploy)** commented in the workflow: `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`; optional `SSH_PORT` (defaults to 22 in script logic).
- **`dependency-review.yml`**: On PRs to `main`, runs GitHub’s dependency review action (requires Dependency graph / advisory data on the repo).

## SQLite import (legacy data)

Script: `server/scripts/sqlite-to-postgres.js`  
NPM: `npm run import:sqlite` — optional argument: path to SQLite file (default `data/app.db`).

**Warning:** The script **truncates** public content tables and deletes ` admin_user` id `1` before copying from SQLite. Use only with a target Postgres you are willing to reset. Requires dev dependency `better-sqlite3` (`npm install` including devDependencies).

Run against a Postgres URL/config matching `.env` from project root.

## Contributing

1. Open issues or small PRs against `main`.
2. Match existing code style (plain JS, no frontend bundler).
3. Run local `npm start` and exercise affected public pages and `/admin/` flows.
4. PRs to `main` run CI syntax check and dependency review.

## License

This repository does **not** include a `LICENSE` file. All rights may be reserved; clarify terms with the repository owner before redistribution.
