/**
 * First-time production setup: creates the business, the owner login and a Cash account.
 * Usage: npm run db:create-owner -- --business "Shree Yarn Traders" --name "Owner Name" --username owner --state 27
 * The password is asked for interactively (never pass it on the command line).
 */
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { db, getPool } from "../src/db";
import { accounts, businesses, users } from "../src/db/schema";

const { values } = parseArgs({ options: { business: { type: "string" }, name: { type: "string" }, username: { type: "string" }, state: { type: "string", default: "27" }, gstin: { type: "string", default: "" } } });
if (!values.business || !values.name || !values.username) {
  console.error('Usage: npm run db:create-owner -- --business "Business name" --name "Your name" --username yourlogin [--state 27] [--gstin 27...]');
  process.exit(1);
}
const count = await db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM businesses`);
if (count.rows[0].n > 0) {
  console.error("A business already exists in this database. Add more users from Settings → Users.");
  process.exit(1);
}
const rl = createInterface({ input: process.stdin, output: process.stdout });
const pw = await rl.question("Owner password (min 8 characters): ");
rl.close();
if (pw.length < 8) throw new Error("Password too short");
const [b] = await db.insert(businesses).values({ name: values.business, stateCode: values.state!, gstin: values.gstin!.toUpperCase() }).returning();
await db.insert(users).values({ businessId: b.id, name: values.name, username: values.username.toLowerCase(), passwordHash: await bcrypt.hash(pw, 12), role: "owner" });
await db.insert(accounts).values({ businessId: b.id, name: "Cash", type: "cash" });
console.log(`Created ${values.business} with owner login "${values.username}". Add bank accounts, products and parties in the app.`);
await getPool().end();
