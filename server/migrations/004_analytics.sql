-- Page analytics (privacy: ip_hash is SHA-256; raw IPs are never stored)

CREATE TABLE IF NOT EXISTS page_views (
  id BIGSERIAL PRIMARY KEY,
  path VARCHAR(512) NOT NULL,
  referrer VARCHAR(1024) NOT NULL DEFAULT '',
  device_type VARCHAR(32) NOT NULL DEFAULT 'unknown',
  ip_hash CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_page_views_created_at ON page_views (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_page_views_path ON page_views (path);
CREATE INDEX IF NOT EXISTS idx_page_views_created_path ON page_views (created_at, path);

CREATE TABLE IF NOT EXISTS daily_stats (
  date DATE PRIMARY KEY,
  views BIGINT NOT NULL DEFAULT 0,
  unique_visitors BIGINT NOT NULL DEFAULT 0
);
