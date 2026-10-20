-- Newsletter double opt-in
ALTER TABLE subscribers DROP CONSTRAINT IF EXISTS subscribers_status_check;
ALTER TABLE subscribers
  ADD CONSTRAINT subscribers_status_check CHECK (status IN ('pending', 'active', 'unsubscribed'));
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS confirm_token TEXT;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS confirm_sent_at TIMESTAMPTZ;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscribers_confirm_token ON subscribers (confirm_token)
  WHERE confirm_token IS NOT NULL;

-- TOTP replay protection: last accepted 30s time step
ALTER TABLE admin_user ADD COLUMN IF NOT EXISTS totp_last_step BIGINT NOT NULL DEFAULT 0;

-- Bumped on password change/reset so every older admin session stops working
ALTER TABLE admin_user ADD COLUMN IF NOT EXISTS session_epoch INTEGER NOT NULL DEFAULT 0;

-- Rows that predate double opt-in were already active; keep them but record when
UPDATE subscribers SET confirmed_at = created_at WHERE status = 'active' AND confirmed_at IS NULL;
