import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { poolConfig } from "../src/db/config";

// On Vercel, only production deploys change the database schema.
if (process.env.VERCEL && process.env.VERCEL_ENV !== "production") {
  console.log(`Skipping migrations on a ${process.env.VERCEL_ENV} deploy`);
  process.exit(0);
}
const url = process.argv.includes("--test") ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const pool = new Pool(poolConfig(url));
await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
console.log("Migrations applied");
await pool.end();
