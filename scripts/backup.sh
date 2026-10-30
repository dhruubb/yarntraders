#!/usr/bin/env bash
# Daily compressed database backup, keeping the last 30 days.
# Usage: npm run db:backup   (or from cron: 0 23 * * * cd /path/to/app && npm run db:backup)
# Restore: gunzip -c backups/yarncrm-YYYY-MM-DD.sql.gz | psql "$DATABASE_URL"
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi
: "${DATABASE_URL:?DATABASE_URL is not set}"
mkdir -p backups
file="backups/yarncrm-$(date +%F-%H%M).sql.gz"
pg_dump --no-owner --no-privileges "$DATABASE_URL" | gzip -9 > "$file"
find backups -name 'yarncrm-*.sql.gz' -mtime +30 -delete
echo "Backup written: $file ($(du -h "$file" | cut -f1))"
