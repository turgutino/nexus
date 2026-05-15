# Company Site (`company-site`)

<!-- Replace OWNER/REPO with your GitHub owner and repository (same as the clone URL). -->
[![CI](https://github.com/OWNER/REPO/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/OWNER/REPO/actions/workflows/ci.yml)

A **company marketing site** plus a **browser-based content admin**: homepage copy, banners, services, team, projects, blog, SEO metadata, contact messages, analytics snapshot, image uploads, and **multi-language UI strings** stored in PostgreSQL.

It fits **teams that want a single Node app** serving static HTML/CSS/vanilla JS pages while keeping structured content and translations in a database.

## CI/CD

Workflows live under [`.github/workflows/`](.github/workflows/):

| Workflow | When | What it does |
|----------|------|----------------|
| **CI** | Push & PR to `main` | `npm ci`, `node --check server/server.js server/db.js`. On **push** to `main` only (after tests): SSH deploy (`git pull`, `npm ci --omit=dev`, `pm2 restart` or start `company-site`). |
| **Dependency review** | PR to `main` | Flags known-vulnerable dependency changes. |

**Deploy secrets** (repository → Settings → Secrets and variables → Actions): `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`, optional `SSH_PORT` (default 22). The deploy script expects the repo at **`~/company-site`** on the server; change [`ci.yml`](.github/workflows/ci.yml) if your path differs.

Update the **CI badge** at the top of this readme: replace `OWNER/REPO` with your GitHub namespace and repository name.

---


## Tech stack

| Layer | Technology |
|--------|-------------|
| Runtime | **Node.js** (see `package.json` `engines`: `>=18`) |
| HTTP | **Express** 4.x |
| Database | **PostgreSQL** via `pg` |
| Session | **express-session** (cookie `sid`) |
| Security / limits | **helmet** (CSP disabled in code), **express-rate-limit**, **bcryptjs**, **validator** |
| Uploads | **multer** → `public/uploads/` |
| Public site | **Vanilla JS** + static HTML under `public/` |
| Admin UI | Vanilla JS SPA under `public/admin/` |
| Legacy import | **better-sqlite3** (devDependency) for `npm run import:sqlite` |

There is **no Docker Compose file** in this repository. `.env.example` documents variables that work with a typical **local PostgreSQL** instance or with the official `postgres` Docker image if you run it yourself.

---

## Project structure

```
├── package.json              # Scripts: start, dev, import:sqlite
├── .env.example              # Template for environment variables
├── server/
│   ├── server.js             # Express app, routes, static `public/`
│   ├── db.js                 # Pool, migrations, seeds, translation helpers
│   ├── pg-config.js          # Loads .env; pool from DATABASE_URL or DB_*
│   ├── i18n-seeds.js         # Default strings matrix (7 locales)
│   ├── migrations/
│   │   └── 001_schema.sql    # Schema + schema_migrations
│   └── scripts/
│       └── sqlite-to-postgres.js   # One-off SQLite → Postgres import
└── public/
    ├── index.html, about.html, …   # Site pages
    ├── css/styles.css
    ├── js/                   # i18n.js, shell.js, page scripts, seo.js
    ├── admin/                # Admin HTML/CSS/JS
    └── uploads/.gitkeep      # User uploads land here (gitignored)
```

---

## Prerequisites

- **Node.js 18+** (required by `package.json`).
- **PostgreSQL** reachable from the app with credentials in `.env`. **Docker** is optional—this repo does not ship a Compose file; you can run Postgres any way you prefer.
- For **SQLite import:** `better-sqlite3` (installed with `npm install` as a devDependency).

---

## Setup

### 1. Clone and install

```bash
git clone <your-repo-url>
cd Company
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your PostgreSQL settings. Either:

- Set **`DATABASE_URL`**, or  
- Set **`DB_HOST`**, **`DB_PORT`**, **`DB_USER`**, **`DB_PASSWORD`**, **`DB_NAME`** (defaults align with `.env.example`).

**Production:** `server.js` requires **`SESSION_SECRET`** (or it exits). Development uses a hard-coded fallback only when `NODE_ENV` is not `production`.

### 3. Database

Create the database named in `DB_NAME` (e.g. `company_db`) on your PostgreSQL instance.

### 4. Run the app

```bash
npm start
```

On startup, `initDb()` in `server/db.js`:

1. Runs **`server/migrations/*.sql`** in order, recording versions in **`schema_migrations`**.
2. Seeds **`site_kv`**, default services/team/blog/projects/SEO when tables are empty, and **translation rows** via `i18n-seeds.js` (`INSERT … ON CONFLICT DO NOTHING`).

The server listens on **`PORT`** from `.env` (default **3000**) and serves static files from **`public/`**.

### 5. Open the site

- Public site: `http://localhost:3000/` (e.g. `index.html`).
- Admin: `http://localhost:3000/admin/`

---

## Importing SQLite data into PostgreSQL

The script **`server/scripts/sqlite-to-postgres.js`** copies a legacy **SQLite** database into the configured **PostgreSQL** database.

- **Default SQLite path:** `data/app.db` (relative to project root).
- **Override path:** pass a file path as the first argument.

```bash
npm run import:sqlite
# or
node server/scripts/sqlite-to-postgres.js /path/to/app.db
```

**Important (from the script):** it **`TRUNCATE`** several tables (translations, blog, projects, contact messages, team, services, page SEO, site_kv) and **`DELETE`s admin user id 1**, then copies data from SQLite. **This wipes existing data in those tables.** Run only when you intend to replace Postgres content with the SQLite export.

Requirements: PostgreSQL reachable with `.env` credentials; SQLite file present; `better-sqlite3` installed.

---

## Admin panel

- **URL:** `/admin/`
- **Auth:** `POST /api/admin/login` with session cookie; `GET /api/admin/session` checks authentication.

Default **first-time** admin user is created in `seedIfEmpty()` using **`ADMIN_USERNAME`** / **`ADMIN_PASSWORD`** from the environment (see `.env.example`, e.g. `admin` / `admin123`).

The login screen notes: set **`ADMIN_PASSWORD`** and **`SESSION_SECRET`** for production.

### Tabs / features (from `public/admin/index.html` and `admin.js`)

| Tab | Purpose |
|-----|---------|
| **Homepage** | Global copy: company name, hero, about blocks, contact map embed URL, default locale, projects block titles, feature flags JSON, analytics mock JSON, etc. |
| **Banners** | JSON-driven homepage banners (upload images via admin upload). |
| **Services** | CRUD services. |
| **Team** | CRUD team members. |
| **Projects** | CRUD projects / micro-SaaS entries. |
| **Blog** | Categories and posts CRUD. |
| **SEO** | Per-path meta title/description/keywords (`page_seo`). |
| **Translations** | Matrix of translation keys × locales; save rows via admin API. |
| **Analytics** | Reads mock/analytics data exposed by `/api/admin/analytics`. |

**Messages:** Contact form submissions are listed/exportable via bootstrap data and admin routes (see API below).

**Upload:** `POST /api/admin/upload` stores files under `public/uploads/` and returns a URL path.

---

## API overview

Public routes are under **`/api/public/*`** (rate limited as configured in `server.js`). Admin routes require an authenticated session (**`/api/admin/*`** except login).

### Public

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/public/site` | Query `?lang=` — locale-aware overlay for selected CMS fields in `applyTranslations()` |
| GET | `/api/public/contact-page` | Contact map embed URL from `site_kv` |
| POST | `/api/public/track-visit` | Increments visitor counter in `site_kv` |
| GET | `/api/public/projects` | Project list |
| GET | `/api/public/projects/:slug` | Project detail |
| GET | `/api/public/blog/categories` | Blog categories |
| GET | `/api/public/blog/posts` | Blog posts (query params for filters/pagination per handler) |
| GET | `/api/public/blog/posts/:slug` | Single post |
| GET | `/api/public/seo` | SEO for a path (`?path=`) |
| GET | `/api/public/services` | Services list |
| GET | `/api/public/services/:slug` | Service detail |
| GET | `/api/public/team` | Team list |
| POST | `/api/public/contact` | Contact form (JSON or multipart with attachment) |
| GET | `/api/translations/:locale` | Supported locale codes: `en`, `tr`, `az`, `ru`, `fr`, `es`, `de`; returns `{ ok, locale, strings }` (DB + seed merge from `translationMapForLocale`) |
| GET | `/api/public/translations` | `?locale=` — same map for a locale (empty `strings` if locale omitted) |

### Admin (session required)

| Method | Path | Notes |
|--------|------|--------|
| POST | `/api/admin/login` | Body: username/password |
| POST | `/api/admin/logout` | |
| GET | `/api/admin/session` | |
| GET | `/api/admin/bootstrap` | Full admin payload (kv, services, team, messages, projects, blog, SEO, translations list) |
| PUT | `/api/admin/site` | Update `site_kv` fields |
| POST/PUT/DELETE | `/api/admin/services`, `/api/admin/services/:id` | |
| POST/PUT/DELETE | `/api/admin/team`, `/api/admin/team/:id` | |
| DELETE | `/api/admin/messages/:id` | |
| GET | `/api/admin/messages/export.csv` | |
| GET | `/api/admin/analytics` | |
| POST/PUT/DELETE | `/api/admin/projects`, `/api/admin/projects/:id` | |
| POST/PUT/DELETE | `/api/admin/blog/categories`, `.../:id` | |
| POST/PUT/DELETE | `/api/admin/blog/posts`, `.../:id` | |
| PUT/DELETE | `/api/admin/seo` | |
| GET | `/api/admin/translations` | Keys + matrix for all locales |
| PUT | `/api/admin/translations/:key` | Body: per-locale `values` map |
| POST | `/api/admin/translations/bulk` | Bulk by locale |
| DELETE | `/api/admin/translations` | `?locale=` & `?key=` |
| POST | `/api/admin/upload` | Multipart file |

(Exact validation and bodies are defined in `server.js`.)

---

## Multi-language support

- **Locales:** `en`, `tr`, `az`, `ru`, `fr`, `es`, `de` (see `server/i18n-seeds.js`).
- **Storage:** `translations` table (`locale`, `translation_key`, `value`). Defaults are seeded from **`i18n-seeds.js`**; `translationMapForLocale()` merges **seed defaults** with **database** values (DB wins per key).
- **Public API:** `GET /api/translations/:locale` (and `GET /api/public/translations?locale=`).
- **Client:** `public/js/i18n.js` (`SiteI18n`) loads strings, applies `data-i18n`, `data-i18n-placeholder`, `data-i18n-aria`, `data-i18n-html`. Active locale is stored in **`localStorage`** under key **`siteLocale`** (default English; English may clear storage in `setLocale`).
- **Shell:** `public/js/shell.js` injects a language `<select>` and passes `?lang=` to `/api/public/site` for CMS-field overlays server-side (`applyTranslations` in `server.js`).
- **Admin:** Translations tab edits keys across locales via **`GET/PUT /api/admin/translations`**.

---

## Environment variables

| Variable | Purpose |
|----------|---------|
| `PORT` | HTTP port (default `3000` in `.env.example`) |
| `NODE_ENV` | If `production`, `SESSION_SECRET` is **required** |
| `SESSION_SECRET` | Session signing secret |
| `DATABASE_URL` | Optional full Postgres connection string (overrides `DB_*` when set) |
| `DB_HOST` | Postgres host (default `localhost`) |
| `DB_PORT` | Postgres port (default `5432`) |
| `DB_USER` | Postgres user (default `postgres`) |
| `DB_PASSWORD` | Postgres password |
| `DB_NAME` | Database name (default `company_db`) |
| `ADMIN_USERNAME` | Used when seeding admin user if none exists |
| `ADMIN_PASSWORD` | Used when seeding admin user if none exists |

---

## Contributing

1. Use **Node 18+** and match existing code style (vanilla JS on the frontend, CommonJS in `server/`).
2. Do not commit **`.env`**, **`node_modules/`**, or **`public/uploads/`** files (only `.gitkeep` is tracked for uploads).
3. Run **`npm start`** locally and confirm migrations/seeds against a disposable database when changing **`server/migrations/`** or **`db.js`**.
4. For translation keys, update **`server/i18n-seeds.js`** if you add new default strings so seeds stay complete.

---

## License

This repository **does not include a `LICENSE` file**. If you publish or reuse the project, add a license (for example MIT, Apache-2.0, or proprietary) appropriate for your organization.
