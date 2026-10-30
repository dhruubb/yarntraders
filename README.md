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
npm test                            # 49 tests: register math, posting, stock, returns, duplicates, permissions, imports, alerts
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
| `DATABASE_SSL` | No | `require` if a remote database fails certificate checks; `disable` for a database without TLS. Default: verify for remote hosts, off for localhost. |
| `DB_POOL_MAX` | No | Database connections per server instance (3 on Vercel, 10 elsewhere). |
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

## 5. Deploy: Vercel (app) + Render (database)

The app runs on **Vercel**; PostgreSQL runs on **Render**. Pick the same part of the world for both: Render **Singapore** + Vercel **sin1** (already set in `vercel.json`).

### 5.1 Put the code on GitHub (once)
```bash
cd ~/Desktop/YarnFactoryCRM
git init -b main
git add -A
git status            # check .env, node_modules and .next are NOT listed
git commit -m "Yarn Register v1"
```
Create an **empty private** repo on github.com (no README/licence), then:
```bash
git remote add origin https://github.com/<your-username>/yarn-factory-crm.git
git push -u origin main
```
(With the GitHub CLI: `gh repo create yarn-factory-crm --private --source=. --push`.)

### 5.2 Create the database on Render
1. render.com → **New → Postgres**. Name `yarn-crm-db`, region **Singapore**, PostgreSQL **16**.
2. Instance type: **Free only for trying it out** — free databases expire 30 days after creation, have no backups, and are deleted if not upgraded within 14 days of expiry. For the client's real data choose a paid instance: it gets point-in-time recovery (3 days on a Hobby workspace, 7 on Pro) and on-demand backups.
3. When it shows *Available*, open it → **Connect** → copy the **External Database URL**.
4. Optional but recommended: under **Access Control** you can limit who can connect. Vercel's IPs change, so leave `0.0.0.0/0` unless you're on a Vercel plan with static IPs; the database still needs the password.

### 5.3 Prepare the database from your Mac (once)
```bash
cd ~/Desktop/YarnFactoryCRM
export DATABASE_URL='<External Database URL from Render>'
npm run db:migrate
npm run db:create-owner -- --business "Client Business Name" --name "Owner Name" --username owner --state 27
unset DATABASE_URL
```
Never run `npm run db:seed` against Render — it's demo data only (and refuses if data exists).
If you see a certificate error, run the commands again with `export DATABASE_SSL=require` set too, and add the same variable on Vercel.

### 5.4 Deploy on Vercel
1. vercel.com → **Add New → Project** → import the GitHub repo. Framework: **Next.js** (auto-detected). Leave build settings as they are — `vercel.json` already sets the build command to run migrations first.
2. **Environment Variables** (Production):

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | Render **External** Database URL |
   | `CRON_SECRET` | output of `openssl rand -hex 32` |
   | `TELEGRAM_BOT_TOKEN` | from @BotFather (optional) |
   | `ANTHROPIC_API_KEY` | for register photos (optional) |
   | `DATABASE_SSL` | only if you needed it in 5.3 |

3. **Deploy.** Open the `.vercel.app` URL and sign in with the owner login from 5.3.
4. Settings → **Domains** to add the client's own domain (HTTPS is automatic).

After this, every `git push` to `main` redeploys automatically, and new database migrations run during the production build. Preview deploys (other branches) skip migrations; if you add `DATABASE_URL` to Preview too, previews will read and write the **live** data, so only do that knowingly.

### 5.5 What runs on a schedule
`vercel.json` schedules (times in UTC; IST = UTC + 5:30):
- 04:30 → overdue-payment alert (~10:00 IST)
- 15:30 → daily summary (~21:00 IST)
- 07:00 → retry any Telegram alerts that failed

On the Hobby plan, Vercel runs each job once a day somewhere within that hour. Alerts for bills and payments are also sent immediately when they're saved.

### 5.6 Backups
- Paid Render databases have point-in-time recovery (3 days on Hobby workspaces, 7 on Pro) and on-demand backups from the database's **Recovery** page (kept 7 days). That's short, so also keep your own copies:
- From your Mac, weekly or before big changes (needs `pg_dump` 16+: `brew install postgresql@16`):
  ```bash
  DATABASE_URL='<External URL>' npm run db:backup     # writes backups/yarncrm-<date>.sql.gz
  ```
- Restore into an empty database: `gunzip -c backups/yarncrm-….sql.gz | psql "<URL>"`.

### 5.7 Limits to know
- Uploads are capped at about 4.5 MB on Vercel. Register photos are resized in the browser before upload; Excel/CSV files over 4.5 MB should be split.
- Login lockout after wrong passwords is tracked per server instance, so it's softer on Vercel than on a single server.

### Alternative: everything on a VPS with Docker
```bash
cp .env.example .env   # set CRON_SECRET, TELEGRAM_BOT_TOKEN, POSTGRES_PASSWORD
docker compose --profile full up -d --build
docker compose exec app npm run db:create-owner -- --business "…" --name "…" --username owner
```
Put Caddy or Nginx in front for HTTPS and add crontab entries for `npm run cron -- overdue|daily-summary|dispatch` and `npm run db:backup`.

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
