import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { sessions, users, businesses } from "@/db/schema";
import { can, type Permission } from "@/lib/permissions";
import { audit } from "./audit";
import type { Ctx } from "./posting";

const COOKIE = "ycrm_session";
const SESSION_DAYS = 30;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

// Simple per-username throttle (single server instance). 5 failures → 15 minute lock.
let dummyHash: string | undefined;
const failures = new Map<string, { count: number; until: number }>();

export async function login(username: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const uname = username.trim().toLowerCase();
  const f = failures.get(uname);
  if (f && f.count >= 5 && f.until > Date.now()) {
    const mins = Math.ceil((f.until - Date.now()) / 60000);
    return { ok: false, error: `Too many wrong attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` };
  }
  const [u] = await db.select().from(users).where(sql`lower(${users.username}) = ${uname}`);
  const valid = u && u.active ? await bcrypt.compare(password, u.passwordHash) : await bcrypt.compare(password, (dummyHash ??= bcrypt.hashSync("not-a-password", 12))); // same timing for unknown users
  if (!u || !u.active || !valid) {
    const cur = failures.get(uname);
    const count = cur && cur.until > Date.now() ? cur.count + 1 : 1;
    failures.set(uname, { count, until: Date.now() + 15 * 60000 });
    return { ok: false, error: "Wrong username or password." };
  }
  failures.delete(uname);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await db.insert(sessions).values({ id: hash(token), userId: u.id, expiresAt });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
  const h = await headers();
  await audit(db, { businessId: u.businessId, userId: u.id, action: "login", entity: "user", entityId: u.id, summary: `${u.name} signed in`, data: { ip: h.get("x-forwarded-for") ?? "", ua: h.get("user-agent") ?? "" } });
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
    path: "/",
    expires: expiresAt,
  });
  return { ok: true };
}

export async function logout() {
  const jar = await cookies();
  const t = jar.get(COOKIE)?.value;
  if (t) await db.delete(sessions).where(eq(sessions.id, hash(t)));
  jar.delete(COOKIE);
}

export type SessionUser = {
  ctx: Ctx;
  user: { id: number; name: string; username: string; role: "owner" | "staff" };
  business: { id: number; name: string; stateCode: string };
};

export const getSession = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const t = jar.get(COOKIE)?.value;
  if (!t) return null;
  const [row] = await db
    .select({ user: users, business: businesses })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(businesses, eq(businesses.id, users.businessId))
    .where(and(eq(sessions.id, hash(t)), gt(sessions.expiresAt, new Date()), eq(users.active, true)));
  if (!row) return null;
  const { user, business } = row;
  return {
    ctx: { userId: user.id, businessId: user.businessId, role: user.role, name: user.name },
    user: { id: user.id, name: user.name, username: user.username, role: user.role },
    business: { id: business.id, name: business.name, stateCode: business.stateCode },
  };
});

/** For pages: redirect to login when signed out, to the dashboard when not allowed. */
export async function requirePage(perm?: Permission): Promise<SessionUser> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (perm && !can(s.ctx.role, perm)) redirect("/?denied=1");
  return s;
}

/** For server actions and API routes: returns null when signed out. */
export async function sessionOrNull() {
  return getSession();
}
