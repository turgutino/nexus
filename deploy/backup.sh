#!/usr/bin/env bash
# Database + uploads backup. Keeps the newest 14 of each in ~/backups.
# Run from the project directory (cron example is in DEPLOY.md).
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
OUT="${BACKUP_DIR:-$HOME/backups}"
STAMP="$(date +%F-%H%M)"
mkdir -p "$OUT"

$COMPOSE exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$OUT/db-$STAMP.sql.gz"
$COMPOSE exec -T app tar czf - -C /app/public/uploads . > "$OUT/uploads-$STAMP.tgz"

ls -1t "$OUT"/db-*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm --
ls -1t "$OUT"/uploads-*.tgz 2>/dev/null | tail -n +15 | xargs -r rm --
echo "Backup written to $OUT ($STAMP)"
