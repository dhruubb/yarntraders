import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const url = process.argv.includes("--test") ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const pool = new Pool({ connectionString: url });
await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
console.log("Migrations applied");
await pool.end();
