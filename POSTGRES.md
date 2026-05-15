# PostgreSQL setup (Company site)

The app uses **PostgreSQL** only. SQLite (`data/app.db`) is no longer used at runtime. Optional script below imports old SQLite data.

## 1. Start PostgreSQL

### Docker

```bash
docker run --name company-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=company_db -p 5432:5432 -d postgres:16
```

Create a role/database only if you use a custom image without `POSTGRES_DB`. The command above creates database `company_db` automatically.

### Local install

Create database:

```sql
CREATE DATABASE company_db;
```

## 2. Configure environment

Copy `.env.example` to `.env` and set `DB_*`, `SESSION_SECRET`, and production `ADMIN_PASSWORD`.

## 3. Install and run

```bash
npm install
npm start
```

On startup the app:

1. Applies SQL migrations in `server/migrations/*.sql` (tracked in `schema_migrations`).
2. Seeds demo content if tables are empty (including `visitor_count`, `feature_flags_json`, `analytics_mock_json`, `home_projects_*`, etc.).

## 4. Import existing SQLite data (optional)

After Postgres is running and migrations have been applied once (e.g. after a successful `npm start`), you can copy rows from `data/app.db`:

```bash
npm run import:sqlite
# or
node server/scripts/sqlite-to-postgres.js path/to/app.db
```

This **truncates** public content tables (not `schema_migrations`), replaces `admin_user` id `1`, and re-imports from SQLite. It requires the `better-sqlite3` devDependency (`npm install`).

## 5. File uploads

Uploaded files are still stored under `public/uploads/`. The database stores paths such as `/uploads/<filename>`.

## Troubleshooting

- **Connection refused**: check `DB_HOST` / `DB_PORT` and that PostgreSQL is listening.
- **database "company_db" does not exist**: create it or set `POSTGRES_DB` / `DB_NAME` consistently.
- **password authentication failed**: set `DB_USER` / `DB_PASSWORD` to match your Postgres role.
