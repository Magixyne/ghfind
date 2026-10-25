import { createHash } from "node:crypto";
import { createClient, type Client } from "@libsql/client/web";
import { SCORE_CACHE_VERSION } from "@/lib/cache-version";
import { d1AsLibsqlClient, getD1Binding } from "@/lib/d1-client";
import { PUBLIC_SCAN_COLLECTION_VERSION } from "@/lib/scan-run-types";
import { FEED_MINIMUM_SCORE, FEED_PUBLICATION_POLICY_VERSION, SocialFeedError, type FeedActor, type FeedPost, type PublicationEvidence, type PublishingCapabilities } from "./contract";

export interface PublishingScoreRecord {
  username: string;
  github_user_id: string | null;
  final_score: number;
  score_version: string | null;
  score_source_collection_version: string | null;
  score_source_snapshot_hash: string | null;
  hidden: number;
}
export type ScoreReader = (login: string) => Promise<PublishingScoreRecord | null>;

// Go's independent v5 collector is the current counterpart of Node v6.
// Keep aligned with goCanonicalCollectionVersion and docs/releases/v13-v12-v6-rollout.md.
// Both require an exact completed snapshot with a stable GitHub ID below; historical fallback is never sufficient.
const CURRENT_PUBLISHING_COLLECTIONS = new Set([PUBLIC_SCAN_COLLECTION_VERSION, "v5"]);

function coreDatabase(): Client {
  const binding = getD1Binding();
  if (binding) return d1AsLibsqlClient(binding);
  const url = process.env.TURSO_DATABASE_URL;
  if (url) return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  throw new SocialFeedError("score_unavailable", 503);
}

const SCORE_WITH_IDENTITY = `SELECT s.username, s.final_score, s.score_version, s.score_source_collection_version,
  s.score_source_snapshot_hash, s.hidden, r.snapshot
  FROM scores s LEFT JOIN public_scan_runs r ON r.id=(
    SELECT source.id FROM public_scan_runs source
    WHERE source.username=s.username AND source.snapshot_hash=s.score_source_snapshot_hash
      AND source.collection_version=s.score_source_collection_version
      AND source.state='complete_public' AND source.coverage='complete_public'
    ORDER BY source.completed_at DESC, source.id DESC LIMIT 1
  )`;

/** An avatar URL or current handle does not prove who owned an earlier score snapshot. */
export function githubIdentityFromSnapshot(snapshot: unknown, hash: unknown, login: string): string | null {
  if (typeof snapshot !== "string" || typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash) ||
      createHash("sha256").update(snapshot).digest("hex") !== hash) return null;
  try {
    const value: unknown = JSON.parse(snapshot);
    if (!value || typeof value !== "object" || !("metrics" in value) ||
        !value.metrics || typeof value.metrics !== "object") return null;
    const metrics = value.metrics;
    if (!("username" in metrics) || typeof metrics.username !== "string" || metrics.username.toLowerCase() !== login.toLowerCase() ||
        !("github_user_id" in metrics) || typeof metrics.github_user_id !== "string" || !/^[1-9]\d*$/.test(metrics.github_user_id)) return null;
    return metrics.github_user_id;
  } catch { return null; }
}
function scoreRecord(row: Record<string, unknown>): PublishingScoreRecord {
  const username = String(row.username);
  return {
    username, github_user_id: githubIdentityFromSnapshot(row.snapshot, row.score_source_snapshot_hash, username),
    final_score: Number(row.final_score), hidden: Number(row.hidden),
    score_version: typeof row.score_version === "string" ? row.score_version : null,
    score_source_collection_version: typeof row.score_source_collection_version === "string" ? row.score_source_collection_version : null,
    score_source_snapshot_hash: typeof row.score_source_snapshot_hash === "string" ? row.score_source_snapshot_hash : null,
  };
}

/** An authorization read must not use the public API's stale/legacy fallback. */
export const readPublishingScore: ScoreReader = async (login) => {
  try {
    const result = await coreDatabase().execute({ sql: `${SCORE_WITH_IDENTITY} WHERE s.username=? LIMIT 1`, args: [login.toLowerCase()] });
    return result.rows[0] ? scoreRecord(result.rows[0]) : null;
  } catch {
    throw new SocialFeedError("score_unavailable", 503);
  }
};

export function publicationFromScore(login: string, score: PublishingScoreRecord | null, githubUserId: string): PublicationEvidence {
  if (!score || score.hidden !== 0 || score.username.toLowerCase() !== login.toLowerCase()) {
    throw new SocialFeedError("score_required", 403);
  }
  if (score.score_version !== SCORE_CACHE_VERSION ||
      (!score.score_source_collection_version || !CURRENT_PUBLISHING_COLLECTIONS.has(score.score_source_collection_version)) ||
      !score.score_source_snapshot_hash || !/^[a-f0-9]{64}$/.test(score.score_source_snapshot_hash)) {
    throw new SocialFeedError("score_outdated", 403);
  }
  if (!Number.isFinite(score.final_score) || score.final_score < 0 || score.final_score > 100) throw new SocialFeedError("score_unavailable", 503);
  // Never round 59.96 into publishing eligibility.
  if (score.final_score < FEED_MINIMUM_SCORE) throw new SocialFeedError("score_below_minimum", 403);
  if (!score.github_user_id) throw new SocialFeedError("score_identity_required", 403);
  if (score.github_user_id !== githubUserId) throw new SocialFeedError("score_identity_mismatch", 403);
  return {
    score: score.final_score,
    score_record_id: `${score.username.toLowerCase()}:${score.score_version}:${score.score_source_snapshot_hash}`,
    score_version: score.score_version,
    policy_version: FEED_PUBLICATION_POLICY_VERSION,
  };
}

export async function requirePublication(actor: FeedActor, readScore: ScoreReader = readPublishingScore): Promise<PublicationEvidence> {
  return publicationFromScore(actor.github_login, await readScore(actor.github_login), actor.github_user_id);
}
export async function publishingCapabilities(actor: FeedActor | null, readScore: ScoreReader = readPublishingScore): Promise<PublishingCapabilities> {
  const denied = (reason: string): PublishingCapabilities => ({ can_publish: false, can_reply: false, minimum_score: 60, reason });
  if (!actor) return denied("authentication_required");
  try {
    await requirePublication(actor, readScore);
    return { can_publish: true, can_reply: true, minimum_score: 60, reason: null, policy_version: FEED_PUBLICATION_POLICY_VERSION };
  } catch (error) {
    return denied(error instanceof SocialFeedError ? error.code : "score_unavailable");
  }
}

/** Read-time source eligibility: native posts retain their publication-time evidence. */
export async function filterEligibleFeedCandidates(items: FeedPost[]): Promise<FeedPost[]> {
  const handles = [...new Set(items.filter((post) => post.origin === "x").map((post) => post.author.github_login.toLowerCase()))];
  if (handles.length === 0) return items;
  const eligible = new Set<string>();
  try {
    const result = await coreDatabase().execute({
      sql: `${SCORE_WITH_IDENTITY} WHERE s.username IN (${handles.map(() => "?").join(",")})`, args: handles,
    });
    for (const row of result.rows) {
      const score = scoreRecord(row);
      try {
        publicationFromScore(score.username, score, score.github_user_id ?? "");
        eligible.add(`${score.username.toLowerCase()}:gha_${score.github_user_id}`);
      } catch { /* Invalid source identity or score cannot become a recommended X candidate. */ }
    }
  } catch {
    // Unavailable score storage cannot authorize X candidates; existing native posts stay readable.
    console.warn(JSON.stringify({ event: "social_feed.source_eligibility_unavailable", degraded: true }));
  }
  return items.filter((post) => post.origin === "ghfind" || eligible.has(`${post.author.github_login.toLowerCase()}:${post.author.id}`));
}
