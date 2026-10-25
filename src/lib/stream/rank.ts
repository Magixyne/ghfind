import type { StreamAffinity, StreamEngagement, StreamItem, StreamKind } from "./types";

/**
 * Ranking for the /feed prototype. Pure and deterministic for a given seed so
 * it can be unit tested and reproduced: the same viewer state plus the same
 * refresh seed always yields the same order.
 *
 *   rank = 0.35·quality + 0.20·freshness + 0.20·engagement + 0.25·affinity + jitter
 *
 * minus a penalty for items already viewed, followed by a diversity pass (no three items of one kind in a row; sponsored
 * jobs spaced out and kept off the first slots).
 */

const WEIGHTS = { quality: 0.35, freshness: 0.2, engagement: 0.2, affinity: 0.25, jitter: 0.06 };
const FRESHNESS_HALF_LIFE_DAYS = 21;
/** Sponsored items never take the first slots and keep this many items apart. */
const SPONSORED_FIRST_SLOT = 3;
const SPONSORED_GAP = 6;
const SEEN_PENALTY = 0.15;

/** FNV-1a, enough for stable per-item pseudo-randomness. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Uniform [0, 1) from a string. */
export function unitHash(input: string): number {
  return hashString(input) / 0x1_0000_0000;
}

/**
 * Seeded engagement for an item until real counters exist. Better items get
 * more views and a higher like rate, so the prototype feels plausible.
 */
export function baselineEngagement(id: string, quality: number): StreamEngagement {
  const r = unitHash(id);
  const views = Math.round(300 + (2_000 + 18_000 * r) * (0.35 + quality));
  const likeRate = 0.02 + 0.06 * quality * unitHash(`${id}:like`);
  const likes = Math.round(views * likeRate);
  return {
    views,
    likes,
    saves: Math.round(likes * (0.2 + 0.3 * unitHash(`${id}:save`))),
    comments: Math.round(likes * (0.05 + 0.12 * unitHash(`${id}:comment`))),
  };
}

export function freshness(publishedAt: string, now: number): number {
  const time = Date.parse(publishedAt);
  if (!Number.isFinite(time)) return 0.3;
  const days = Math.max(0, (now - time) / 86_400_000);
  return Math.pow(0.5, days / FRESHNESS_HALF_LIFE_DAYS);
}

/** Weighted interaction rate squashed to [0, 1). Saves and comments say more than likes. */
export function engagementScore(e: StreamEngagement): number {
  const weighted = e.likes + 2 * e.saves + 3 * e.comments;
  const rate = weighted / (e.views + 200);
  return 1 - Math.exp(-rate * 8);
}

/** Viewer affinity for an item in [-1, 1]. */
export function affinityScore(item: Pick<StreamItem, "kind" | "tags">, affinity: StreamAffinity): number {
  const kind = affinity.kinds[item.kind] ?? 0;
  const tagValues = item.tags.map((tag) => affinity.tags[tag.toLowerCase()] ?? 0);
  const tag = tagValues.length > 0 ? Math.max(...tagValues) : 0;
  const raw = kind + tag;
  return raw / (1 + Math.abs(raw));
}

export function scoreItem(
  item: StreamItem,
  ctx: { affinity: StreamAffinity; engagement: StreamEngagement; now: number; seed: string },
): number {
  return (
    WEIGHTS.quality * item.quality +
    WEIGHTS.freshness * freshness(item.publishedAt, ctx.now) +
    WEIGHTS.engagement * engagementScore(ctx.engagement) +
    WEIGHTS.affinity * affinityScore(item, ctx.affinity) +
    WEIGHTS.jitter * unitHash(`${ctx.seed}:${item.id}`)
  );
}

/**
 * Greedy diversity pass over items already sorted best-first: take the best
 * remaining item that does not make three of a kind in a row and respects the
 * sponsored spacing; fall back to the best remaining item when nothing fits.
 */
export function diversify<T extends { kind: StreamKind; sponsored: boolean }>(sorted: T[]): T[] {
  const pool = [...sorted];
  const out: T[] = [];
  let lastSponsored = -Infinity;
  while (pool.length > 0) {
    const position = out.length;
    const a = out[position - 1]?.kind;
    const b = out[position - 2]?.kind;
    const fits = (item: T) => {
      if (a && a === b && item.kind === a) return false;
      if (item.sponsored && (position < SPONSORED_FIRST_SLOT || position - lastSponsored < SPONSORED_GAP)) return false;
      return true;
    };
    let index = pool.findIndex(fits);
    if (index < 0) index = pool.findIndex((item) => !item.sponsored);
    if (index < 0) index = 0;
    const [picked] = pool.splice(index, 1);
    if (picked.sponsored) lastSponsored = position;
    out.push(picked);
  }
  return out;
}

export function rankStream(
  items: StreamItem[],
  ctx: {
    affinity: StreamAffinity;
    engagementOf: (item: StreamItem) => StreamEngagement;
    hidden: ReadonlySet<string>;
    /** Already-viewed items sink on refresh so the stream feels new. */
    seen?: ReadonlySet<string>;
    now: number;
    seed: string;
  },
): StreamItem[] {
  const scored = items
    .filter((item) => !ctx.hidden.has(item.id))
    .map((item) => ({
      item,
      score:
        scoreItem(item, { affinity: ctx.affinity, engagement: ctx.engagementOf(item), now: ctx.now, seed: ctx.seed }) -
        (ctx.seen?.has(item.id) ? SEEN_PENALTY : 0),
    }))
    .sort((x, y) => y.score - x.score);
  return diversify(scored.map((entry) => entry.item));
}

/** Related items for the detail view: shared tags first, then same kind. */
export function relatedItems(target: StreamItem, items: StreamItem[], limit = 6): StreamItem[] {
  const tags = new Set(target.tags.map((tag) => tag.toLowerCase()));
  return items
    .filter((item) => item.id !== target.id)
    .map((item) => ({
      item,
      score:
        item.tags.filter((tag) => tags.has(tag.toLowerCase())).length * 2 +
        (item.kind === target.kind ? 1 : 0) +
        item.quality,
    }))
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map((entry) => entry.item);
}

/** Affinity deltas per viewer signal. Negative signals push a kind/tag down. */
export const SIGNAL_WEIGHTS = {
  like: 1,
  save: 1.5,
  open: 0.5,
  dwell: 0.25,
  hide: -2,
} as const;

export type StreamSignal = keyof typeof SIGNAL_WEIGHTS;

const AFFINITY_DECAY = 0.97;
const AFFINITY_TAG_LIMIT = 60;

/** Apply one signal; older preferences decay so the stream keeps adapting. */
export function applySignal(
  affinity: StreamAffinity,
  item: Pick<StreamItem, "kind" | "tags">,
  signal: StreamSignal,
): StreamAffinity {
  const weight = SIGNAL_WEIGHTS[signal];
  const kinds: StreamAffinity["kinds"] = {};
  for (const [kind, value] of Object.entries(affinity.kinds) as [StreamKind, number][]) {
    kinds[kind] = value * AFFINITY_DECAY;
  }
  kinds[item.kind] = (kinds[item.kind] ?? 0) + weight;
  const tags: Record<string, number> = {};
  for (const [tag, value] of Object.entries(affinity.tags)) tags[tag] = value * AFFINITY_DECAY;
  for (const tag of item.tags.slice(0, 5)) {
    const key = tag.toLowerCase();
    tags[key] = (tags[key] ?? 0) + weight * 0.5;
  }
  const trimmed = Object.entries(tags)
    .filter(([, value]) => Math.abs(value) > 0.05)
    .sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))
    .slice(0, AFFINITY_TAG_LIMIT);
  return { kinds, tags: Object.fromEntries(trimmed) };
}

/** Top positive interests, for the "tuned to you" chips. */
export function topInterests(affinity: StreamAffinity, limit = 5): string[] {
  return Object.entries(affinity.tags)
    .filter(([, value]) => value > 0.3)
    .sort((x, y) => y[1] - x[1])
    .slice(0, limit)
    .map(([tag]) => tag);
}
