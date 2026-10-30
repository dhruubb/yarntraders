# Yarn Register — CRM & management for a yarn trading business

Replaces the handwritten sale and purchase registers: bills, stock, party ledgers, payments, expenses, profit, reports, Telegram alerts and register import.

Built with Next.js 16 (App Router, server actions), TypeScript, Tailwind CSS 4, PostgreSQL 16 and Drizzle ORM.

---

## 1. Run it on your Mac

You need **Node.js 20+** and **PostgreSQL 16** (easiest: Docker Desktop, or `brew install postgresql@16`).

```bash
cd ~/Desktop/YarnFactoryCRM
npm install
cp .env.example .env            # then edit .env (see section 3)

# Database — pick one:
docker compose up -d db         # Docker: creates yarncrm + yarncrm_test
# or with Homebrew Postgres:
#   createuser -s yarn; createdb -O yarn yarncrm; createdb -O yarn yarncrm_test
#   psql -c "ALTER USER yarn PASSWORD 'yarn';"

npm run db:migrate              # creates tables, views and safety triggers
npm run db:seed                 # DEMO data from the register photos (dev only)
npm run dev                     # http://localhost:3000
```

Demo logins (seed only): `owner` / `demo-owner-123` and `staff` / `demo-staff-123`.

For a real install, **skip the seed** and create the owner instead:

```bash
npm run db:create-owner -- --business "Your Business Name" --name "Owner Name" --username owner --state 27
```

Then sign in and add, in order: bank accounts (Settings) → products → parties with opening balances → opening stock. Or use **Import** with the CSV templates.

### Tests

```bash
npx tsx scripts/migrate.ts --test   # once, prepares yarncrm_test
npm test                            # 45 tests: register math, posting, stock, returns, duplicates, permissions, imports, alerts
```

---

## 2. How the numbers work (agreed defaults)

| Area | Rule |
|---|---|
| **Rate units** | Each product stores a standard **bag weight** and a **rate basis**. Line amount = bags → kg → rate units × rate. `30 Amrut 40 × 1258` (50 kg bag, per 5 kg) = 40 × 50 ÷ 5 × 1258 = **₹5,03,200**. `58 Silver 12 × 238` (64 kg bag, per kg) = **₹1,82,784**. `32 Rameshwar 32 × 1570` (45.36 kg bag) = **₹4,55,777**. A line can override the weighed kg. |
| **GST** | Rates are entered **before GST**. GST is per line on taxable value: CGST + SGST within the state, IGST when the party's state differs (from GSTIN or state). Total rounds to the rupee. The purchase register's amounts include 5% GST — e.g. Shrenik Shah 48 × 64 kg × ₹238 + 5% = **₹7,67,693**. |
| **Freight / discount** | Invoice-level, spread over lines by amount *before* GST so tax stays correct. On purchases they become part of stock cost. |
| **Revenue vs collections** | Sales/purchases are booked on the bill date at taxable value (GST is not income). Payments are separate and only move balances. |
| **Stock valuation** | **Weighted average cost per kg**, excluding GST (input tax is claimed). Sales take the average at the moment of posting → cost of goods sold. |
| **Gross / net profit** | Gross = net sales − cost of goods sold (returns reversed at their original cost). Net = gross − operating expenses. |
| **Party balance** | Running account: opening balance + bills − returns − payments. Positive = they owe you. |
| **Outstanding bills / overdue** | **FIFO**: payments settle the oldest bills first. Due date = bill date + party's credit days (editable per bill). Handles part payments, advances, returns and opening balances without manual matching. |
| **Cheques** | Received cheques reduce the party's dues immediately but count in the bank balance only after **Cleared**. **Bounced** puts the amount back on the party and alerts the owner. |
| **Returns** | Made from the original bill only, at the original rate, kg-per-bag and GST; can't exceed what's left to return. Stock comes back at original cost. |
| **Corrections** | Posted bills, payments and expenses **can't be edited or deleted** — enforced by database triggers, not just the UI. The owner **cancels** with a reason (stock and balances reverse, history stays, owner alerted) and re-enters. A purchase whose stock was already sold can't be cancelled; make a purchase return. |
| **Duplicates** | (1) Every form submission carries a one-time key, so double-clicks/retries post once. (2) Same party + date + total warns and asks "Post anyway". (3) The same supplier bill no. can't be entered twice. |
| **Stock safety** | Sales can't exceed stock. Concurrent entries lock the stock rows, so two people can't sell the same last bags. |
| **Atomicity** | Each posting writes bill + lines + stock movements + stock balance + audit log + alerts in one database transaction. |

### Roles

| | Owner | Staff |
|---|---|---|
| Enter sales, purchases, returns, payments, expenses, parties | ✓ | ✓ |
| See cost, stock value, margins, profit | ✓ | — |
| Cancel posted entries, adjust stock, edit products | ✓ | — |
| Export reports, import data, settings, users, activity log | ✓ | — |

Every create/change/cancel/sign-in is in the **Activity log** with who and when; the log is append-only at database level.

---

## 3. Environment variables (`.env`)

| Variable | Required | What it is |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string. |
| `CRON_SECRET` | Yes in production | Long random string protecting `/api/cron/*`. `openssl rand -hex 32`. |
| `TELEGRAM_BOT_TOKEN` | For alerts | From @BotFather. Chat IDs are set in **Settings → Telegram alerts**. |
| `ANTHROPIC_API_KEY` | For photo import | Enables reading register photos. Excel/CSV import works without it. |
| `ANTHROPIC_MODEL` | No | Defaults to `claude-sonnet-5-5`. |
| `TEST_DATABASE_URL` | For tests | Separate database; tests wipe it. |
| `INSECURE_COOKIES` | No | Set `1` only to test a production build over plain `http://localhost`. Never in real deployments. |

No secrets are stored in code. `.env` is git-ignored.

---

## 4. Telegram alerts

1. In Telegram, message **@BotFather** → `/newbot` → copy the token into `TELEGRAM_BOT_TOKEN`, restart the app.
2. Open your new bot and send `/start` (each person who should get alerts does this; groups work too — add the bot to the group).
3. **Settings → Telegram alerts → Find my chat ID → Add → Save settings → Send test alert.**

Alerts: large bills/payments (threshold in Settings, default ₹25 lakh), low stock, overdue payments (daily 10:00 IST), daily summary (21:00 IST), and unusual activity — cancellations, sale below average cost, credit limit crossed, back-dated entries, stock reduced by adjustment, bounced cheques.

Alerts are written to an outbox in the same transaction as the event and delivered afterwards with retries, so an alert never goes out for something that didn't save. **WhatsApp** can be added later by implementing one `NotificationChannel` (`src/server/notify/channels.ts`).

---

## 5. Deploy

### Option A — Vercel + Supabase (recommended, ~₹0–2,000/month)
1. Create a Supabase project in **Mumbai (ap-south-1)**. Copy the *Session pooler* connection string into `DATABASE_URL`.
2. From your Mac: `DATABASE_URL=... npm run db:migrate` then `npm run db:create-owner -- ...`.
3. Push the folder to a private GitHub repo, import it in Vercel, add the environment variables.
4. `vercel.json` already schedules the overdue alert (04:30 UTC = 10:00 IST) and daily summary (15:30 UTC = 21:00 IST). Vercel sends `CRON_SECRET` automatically.

### Option B — Any VPS with Docker
```bash
cp .env.example .env   # set CRON_SECRET, TELEGRAM_BOT_TOKEN, POSTGRES_PASSWORD
docker compose --profile full up -d --build
docker compose exec app npm run db:create-owner -- --business "…" --name "…" --username owner
```
Put Caddy or Nginx in front for HTTPS. Add to crontab (server in IST, or adjust):
```
30 10 * * * cd /srv/YarnFactoryCRM && docker compose exec -T app npm run cron -- overdue
0 21  * * * cd /srv/YarnFactoryCRM && docker compose exec -T app npm run cron -- daily-summary
*/10 * * * * cd /srv/YarnFactoryCRM && docker compose exec -T app npm run cron -- dispatch
0 23  * * * cd /srv/YarnFactoryCRM && npm run db:backup
```

### Backups
- `npm run db:backup` writes a compressed `pg_dump` to `backups/` and keeps 30 days. Copy that folder off the server (rclone to Google Drive works well).
- Restore: `gunzip -c backups/yarncrm-YYYY-MM-DD-HHMM.sql.gz | psql "$DATABASE_URL"` into an empty database.
- Supabase also keeps daily backups on paid plans. Test a restore once before going live.

---

## 6. Importing old data

**Import** page → choose type → upload `.xlsx`/`.csv` (download the template first) → **review screen** → Post.
- Party and yarn names are matched automatically; unmatched ones must be picked from a list.
- If the file has the register amount, each row shows **Matches** / **Doesn't match** against bags × rate (before or after GST). Mismatched rows are held until someone fixes them or confirms the calculated amount.
- **Register photo**: AI reads one page into the same review screen. Low-confidence digits are highlighted, struck-through entries are skipped. Nothing is posted until a person checks it.
- Imported bills go through the same posting engine as manual entry and are marked *Imported*.

---

## 7. Project layout

```
src/lib/calc.ts            money, bag-weight, GST and rounding math (shared by browser and server)
src/server/posting.ts      posting engine: bills, returns, cancellations, payments, expenses, stock
src/server/queries.ts      balances, ledgers, FIFO outstanding, dashboard
src/server/reports.ts      all reports (same data for screen, CSV, Excel, PDF)
src/server/pdfs.ts         tax invoice and party statement PDFs
src/server/notify/         alert outbox, Telegram channel, scheduled jobs
src/server/importer.ts     CSV/Excel import + review;  src/server/ocr.ts photo reading
src/db/schema.ts           tables;  drizzle/  migrations incl. immutability triggers and balance views
src/app/(app)/             pages;  src/app/actions.ts  server actions;  src/app/api/  PDFs, exports, cron
tests/                     Vitest suites (run against a real Postgres)
```

---

## 8. Not in this version (by design, ask if needed)
- E-invoice (IRN) and e-way bill generation — do these on the GST portal; the GSTIN, HSN and tax breakup on bills are ready for it.
- Tally sync — use the Excel exports.
- Brokerage accounting — agent name is recorded on bills; brokerage paid can be entered as an expense.
- TDS under section 194Q, interest on late payments, cash ↔ bank transfers between your own accounts.
- Multi-godown stock (the schema is ready for it), and multiple businesses in one install (every table already has `business_id`).
- Login throttling is per server instance; on a multi-instance deploy put rate limiting at the proxy.
