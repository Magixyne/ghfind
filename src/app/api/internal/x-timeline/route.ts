import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ingestXTimeline, readXTimeline, removeFromXTimeline } from "@/lib/x-timeline.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Operator-agent ingest for the curated X timeline on /feed.
 * Contract and examples: docs/operations/x-timeline.md.
 *
 *   POST   { accounts?: [...], posts: [...] }  ?dryRun=1  → what was kept and why not
 *   GET                                        → stored counts and last update
 *   DELETE ?id=<postId> | ?handle=<handle>     → moderation
 *
 * Auth: ADMIN_SECRET in `x-admin-secret` (same as /api/admin/*) or as a Bearer token.
 */

const MAX_BODY_BYTES = 512 * 1024;

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorized(req: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET;
  const supplied = req.headers.get("x-admin-secret") ?? req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
  return Boolean(secret && supplied && secureEqual(supplied.trim(), secret));
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  const timeline = await readXTimeline();
  return json({
    accounts: timeline?.accounts.length ?? 0,
    posts: timeline?.posts.length ?? 0,
    updatedAt: timeline?.updatedAt ?? null,
  });
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return json({ error: "body_too_large" }, 413);
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return json({ error: "body_too_large" }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";
  const result = await ingestXTimeline(body, { dryRun });
  return result ? json(result) : json({ error: "storage_unavailable" }, 503);
}

export async function DELETE(req: NextRequest) {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  const id = req.nextUrl.searchParams.get("id") ?? undefined;
  const handle = req.nextUrl.searchParams.get("handle") ?? undefined;
  if (!id && !handle) return json({ error: "id_or_handle_required" }, 400);
  const removed = await removeFromXTimeline({ id, handle });
  return removed == null ? json({ error: "storage_unavailable" }, 503) : json({ removed });
}
