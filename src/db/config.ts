import type { PoolConfig } from "pg";

const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "db", "postgres"]);

/**
 * Turns DATABASE_URL into pg Pool settings with explicit TLS handling.
 *  - Local hosts: no TLS.
 *  - Remote hosts (Render, Supabase, Neon…): TLS with certificate verification by default.
 *  - DATABASE_SSL overrides: "disable" | "require" (encrypt, don't verify the certificate) | "verify".
 * sslmode in the URL is honoured with libpq meanings and then removed, because node-postgres would
 * otherwise reinterpret it.
 */
export function poolConfig(url: string): PoolConfig {
  const u = new URL(url);
  const fromUrl = u.searchParams.get("sslmode") ?? (u.searchParams.get("ssl") === "true" ? "require" : null);
  u.searchParams.delete("sslmode");
  u.searchParams.delete("ssl");
  const mode = (process.env.DATABASE_SSL || fromUrl || (LOCAL.has(u.hostname) ? "disable" : "verify")).toLowerCase();
  const ssl = mode === "disable" || mode === "off" || mode === "false" ? false : mode === "require" || mode === "prefer" || mode === "no-verify" ? { rejectUnauthorized: false } : { rejectUnauthorized: true };
  return {
    connectionString: u.toString(),
    ssl,
    // Serverless (Vercel) runs many small instances: keep each pool small.
    max: Number(process.env.DB_POOL_MAX || (process.env.VERCEL ? 3 : 10)),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  };
}
