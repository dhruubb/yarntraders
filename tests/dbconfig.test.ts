import { afterEach, describe, expect, it, vi } from "vitest";
import { poolConfig } from "@/db/config";

afterEach(() => vi.unstubAllEnvs());

describe("database TLS settings", () => {
  it("uses no TLS for a local database", () => {
    expect(poolConfig("postgres://yarn:yarn@localhost:5432/yarncrm").ssl).toBe(false);
  });
  it("verifies certificates for a remote host by default", () => {
    expect(poolConfig("postgresql://u:p@dpg-abc123-a.singapore-postgres.render.com/yarn").ssl).toEqual({ rejectUnauthorized: true });
  });
  it("honours sslmode=require (encrypt without verifying) and strips it from the URL", () => {
    const c = poolConfig("postgresql://u:p@dpg-abc.singapore-postgres.render.com/yarn?sslmode=require");
    expect(c.ssl).toEqual({ rejectUnauthorized: false });
    expect(c.connectionString).not.toContain("sslmode");
  });
  it("lets DATABASE_SSL override, and keeps pools small on Vercel", () => {
    vi.stubEnv("DATABASE_SSL", "require");
    vi.stubEnv("VERCEL", "1");
    const c = poolConfig("postgresql://u:p@db.example.com/yarn");
    expect(c.ssl).toEqual({ rejectUnauthorized: false });
    expect(c.max).toBe(3);
  });
});
