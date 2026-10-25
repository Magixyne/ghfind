/**
 * The /feed prototype: every ghfind content type (scored projects, scored
 * developers, talent, articles, collections, jobs) folded into one item shape
 * so a single ranked stream can interleave them.
 *
 * Engagement counts (views/likes/saves/comments) have no server source yet:
 * `baseline` is a deterministic seed per item (see rank.ts) and the viewer's
 * own actions are layered on top client-side (store.ts).
 */
export type StreamKind = "project" | "developer" | "talent" | "article" | "collection" | "job";

/** "foryou" is the ranked mix; following/saved are viewer filters; the rest filter by kind. */
export type StreamChannel = "foryou" | "following" | "saved" | StreamKind;

export type StreamLayout = "list" | "masonry";

export type StreamAuthor = {
  /** Stable key used for follow state, e.g. a GitHub login or company id. */
  id: string;
  name: string;
  avatarUrl: string | null;
  /** Secondary line, e.g. "@login" or a company tagline. */
  handle: string | null;
};

export type StreamStat = { label: string; value: string };

export type StreamItem = {
  id: string;
  kind: StreamKind;
  title: string;
  /** One or two lines shown on the card. */
  summary: string;
  /** Longer body for the detail view (plain text, paragraphs split on \n\n). */
  body: string | null;
  author: StreamAuthor;
  coverUrl: string | null;
  tags: string[];
  /** 0–100 headline score (product score, developer score, talent score…). */
  score: number | null;
  /** Short label next to the score, e.g. a tier name. */
  scoreLabel: string | null;
  /** Compact facts for the detail view. */
  stats: StreamStat[];
  /** Internal path to the canonical page ("/u/foo", "/blog/x") or an external URL. */
  href: string;
  external: boolean;
  /** ISO timestamp used for freshness. */
  publishedAt: string;
  /** Minutes, for articles/collections. */
  readingMinutes: number | null;
  sponsored: boolean;
  /** Editorial quality prior 0–1, before engagement. */
  quality: number;
  baseline: StreamEngagement;
};

export type StreamEngagement = {
  views: number;
  likes: number;
  saves: number;
  comments: number;
};

/** What the viewer has learned the stream about them (persisted locally). */
export type StreamAffinity = {
  kinds: Partial<Record<StreamKind, number>>;
  tags: Record<string, number>;
};
