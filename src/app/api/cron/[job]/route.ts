import { timingSafeEqual } from "node:crypto";
import { runJob } from "@/server/notify/jobs";

/** Called by Vercel Cron (GET with "Authorization: Bearer $CRON_SECRET") or any scheduler. */
async function handle(req: Request, { params }: { params: Promise<{ job: string }> }) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || secret === "change-me" || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret)))
    return new Response("Unauthorized", { status: 401 });
  const { job } = await params;
  if (!["daily-summary", "overdue", "dispatch"].includes(job)) return new Response("Unknown job", { status: 404 });
  const result = await runJob(job);
  return Response.json({ ok: true, job, ...result });
}

export const GET = handle;
export const POST = handle;
