/**
 * Runs a scheduled job directly (for a VPS with crontab instead of Vercel Cron).
 *   npm run cron -- daily-summary   (21:00 IST)
 *   npm run cron -- overdue         (10:00 IST)
 *   npm run cron -- dispatch        (every 10 minutes: retries failed alerts)
 */
import "dotenv/config";
import { runJob } from "../src/server/notify/jobs";
import { getPool } from "../src/db";

const job = process.argv[2];
if (!job) {
  console.error("Usage: npm run cron -- <daily-summary|overdue|dispatch>");
  process.exit(1);
}
console.log(job, await runJob(job));
await getPool().end();
