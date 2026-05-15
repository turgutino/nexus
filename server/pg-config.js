const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const rootDir = path.join(__dirname, '..');
const envPath = path.join(rootDir, '.env');

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

/**
 * Pool options for node-pg. Loads .env from project root.
 * Prefer DATABASE_URL if set; otherwise DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME.
 *
 * Official postgres Docker image creates superuser "postgres" with POSTGRES_PASSWORD —
 * not "admin". Wrong user/password causes SASL / SCRAM authentication failures.
 */
function getPoolOptions(overrides = {}) {
  const databaseUrl = process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim();
  if (databaseUrl) {
    return {
      connectionString: databaseUrl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
      ...overrides,
    };
  }

  const rawPassword = process.env.DB_PASSWORD;
  const password =
    rawPassword === undefined || rawPassword === null ? '' : String(rawPassword);

  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password,
    database: process.env.DB_NAME || 'company_db',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
    ...overrides,
  };
}

module.exports = { getPoolOptions, rootDir };
