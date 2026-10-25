import { localePath } from "@ghfind/i18n";
import { listPosts } from "@/lib/blog";
import { listCollections, pickText } from "@/lib/collections";
import { getScoreCount } from "@/lib/db";
import { attachCoverUrls } from "@/lib/discover/covers";
import { cardFromAssessment } from "@/lib/discover/map";
import { getGoLeaderboard } from "@/lib/go-leaderboard.server";
import { listJobs } from "@/lib/jobs";
import { loadHomeCollectionCards } from "@/lib/pages/home";
import { listProjectBoard, type ProjectAssessment } from "@/lib/project-analysis-db";
import { heatThreshold } from "@/lib/stream/rank";
import { seedStreamItems } from "@/lib/stream/seed";
import type { StreamExtra, StreamItem, StreamKind, StreamPulse, StreamVoice } from "@/lib/stream/types";
import { linkXAccounts, xStreamItems, xVoices } from "@/lib/pages/feed-x";
import { seedXTimeline } from "@/lib/stream/seed";
import { readXTimeline } from "@/lib/x-timeline.server";
import { isProductionDeployment } from "@/lib/deploy-env";
import { listTalentsPage } from "@/lib/talent-db";
import { TIER_KEY } from "@/lib/tier";

/**
 * Data for the /feed prototype: every existing content source mapped onto one
 * StreamItem shape. Each source fails independently (a D1 or KV miss drops
 * that source only). Outside production, seeded demo items fill any kind that
 * loaded nothing, e.g. local dev without D1 tables.
 *
 * Nothing here is invented: dates, counters and heat are only set when the
 * source has them.
 */

const NEW_WINDOW_MS = 3 * 86_400_000;
const PROJECT_LIMIT = 24;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** log-scaled 0–1 so one viral profile does not flatten the rest. */
function logHeat(value: number, ceiling: number): number {
  return clamp01(Math.log10(1 + Math.max(0, value)) / Math.log10(1 + ceiling));
}

async function settle<T>(label: string, run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (error) {
    console.error(`feed.source_failed ${label}`, error);
    return fallback;
  }
}

async function loadProjects(): Promise<ProjectAssessment[]> {
  const picks = await listProjectBoard("treasure", { limit: PROJECT_LIMIT, offset: 0 });
  if (picks.length >= 8) return picks;
  const more = await listProjectBoard("all", { limit: PROJECT_LIMIT, offset: 0 });
  const seen = new Set(picks.map((entry) => entry.repoKey));
  return [...picks, ...more.filter((entry) => !seen.has(entry.repoKey))].slice(0, PROJECT_LIMIT);
}

type Draft = Omit<StreamItem, "badge" | "comments" | "extra" | "counter" | "heat"> &
  Partial<Pick<StreamItem, "comments" | "extra" | "counter" | "heat" | "badge">>;

function finish(draft: Draft): StreamItem {
  return { heat: 0, counter: null, badge: null, comments: null, extra: null, ...draft };
}

export async function loadFeedPage(locale: string): Promise<{ items: StreamItem[]; pulse: StreamPulse; voices: StreamVoice[]; generatedAt: number; demo: boolean; demoX: boolean }> {
  const now = Date.now();
  const lang = locale === "zh" ? "zh" : "en";

  const [projects, developers, trending24h, totalScored, talents, collectionCards, collections, jobs, storedX] = await Promise.all([
    settle("projects", loadProjects, []),
    settle("developers", () => getGoLeaderboard("trending", "7d", 24), []),
    settle("pulse", () => getGoLeaderboard("trending", "24h", 10), []),
    settle("score_count", getScoreCount, null),
    settle("talent", () => listTalentsPage({ locale, pageSize: 18, sort: "recommended" }).then((page) => page.items), []),
    settle("collections", () => loadHomeCollectionCards(locale), []),
    settle("collection_items", listCollections, []),
    settle("jobs", () => listJobs(locale, { limit: 6 }), []),
    settle("x_timeline", readXTimeline, null),
  ]);
  const posts = (() => {
    try {
      return listPosts(locale);
    } catch (error) {
      console.error("feed.source_failed articles", error);
      return [];
    }
  })();

  const items: StreamItem[] = [];

  const plainCards = projects.map((entry) => cardFromAssessment(entry, locale));
  const cards = await settle("covers", () => attachCoverUrls(plainCards), plainCards);
  projects.forEach((assessment, index) => {
    const card = cards[index];
    const extra: StreamExtra = {
      kind: "project",
      meters: [
        { key: "pain", value: assessment.painScore, max: 25 },
        { key: "effectiveness", value: assessment.effectivenessScore, max: 30 },
        { key: "experience", value: assessment.experienceScore, max: 30 },
        { key: "valueDensity", value: assessment.valueDensityScore, max: 15 },
      ],
      audience: card.audience,
      risks: assessment.risks.map((risk) => risk.summary).filter(Boolean).slice(0, 3),
      repoKey: assessment.repoKey,
      stars: assessment.stars,
    };
    items.push(finish({
      id: `project:${card.repoKey}`,
      kind: "project",
      title: card.name,
      summary: card.hook || card.summary,
      body: card.summary && card.summary !== card.hook ? card.summary : null,
      author: { id: card.ownerLogin, name: card.ownerLogin, avatarUrl: `https://github.com/${card.ownerLogin}.png?size=80`, handle: `@${card.ownerLogin}` },
      coverUrl: card.coverUrl,
      tags: card.tags.slice(0, 5).map((tag) => tag.label),
      score: card.productScore,
      scoreLabel: null,
      stats: [
        { label: "confidence", value: `${card.confidence}` },
        ...(card.communityStrength != null ? [{ label: "community", value: `${card.communityStrength}` }] : []),
      ],
      href: card.analysisId ? `/projects/analyses/${card.analysisId}` : card.canonicalUrl,
      external: !card.analysisId,
      publishedAt: Number.isFinite(assessment.analyzedAt) && assessment.analyzedAt > 0 ? new Date(assessment.analyzedAt).toISOString() : null,
      readingMinutes: null,
      sponsored: false,
      quality: clamp01(card.productScore / 100),
      heat: assessment.stars != null ? logHeat(assessment.stars, 100_000) : clamp01((card.communityStrength ?? 30) / 100),
      counter: assessment.stars != null && assessment.stars > 0 ? { kind: "stars", value: assessment.stars } : null,
      extra,
    }));
  });

  for (const dev of developers) {
    const tags = (dev.tags?.[lang] ?? []).slice(0, 4);
    items.push(finish({
      id: `developer:${dev.username}`,
      kind: "developer",
      title: dev.display_name || dev.username,
      summary: tags.join(" · "),
      body: null,
      author: { id: dev.username.toLowerCase(), name: dev.display_name || dev.username, avatarUrl: dev.avatar_url, handle: `@${dev.username}` },
      coverUrl: null,
      tags,
      score: Math.round(dev.final_score),
      scoreLabel: TIER_KEY[dev.tier] ?? "npc",
      stats: dev.delta != null ? [{ label: "delta", value: `${dev.delta > 0 ? "+" : ""}${Math.round(dev.delta)}` }] : [],
      href: `/u/${dev.username}`,
      external: false,
      publishedAt: null,
      readingMinutes: null,
      sponsored: false,
      quality: clamp01(dev.final_score / 100),
      heat: logHeat(dev.recent_lookup_count || dev.lookup_count, 500),
      counter: dev.lookup_count > 0 ? { kind: "lookups", value: dev.lookup_count } : null,
      comments: { kind: "profile", key: dev.username },
    }));
  }

  for (const talent of talents) {
    const github = talent.source === "github" && talent.handle ? talent.handle.replace(/^@/, "") : null;
    items.push(finish({
      id: `talent:${talent.id}`,
      kind: "talent",
      title: talent.name,
      summary: talent.bio || talent.role,
      body: [talent.note, talent.projectDescription].filter(Boolean).join("\n\n") || null,
      author: { id: github?.toLowerCase() ?? talent.id, name: talent.name, avatarUrl: talent.avatarUrl ?? (github ? `https://github.com/${github}.png?size=80` : null), handle: talent.role || null },
      coverUrl: null,
      tags: [talent.direction, ...talent.skills].filter(Boolean).slice(0, 5),
      score: talent.score,
      scoreLabel: talent.available ? "available" : null,
      stats: [
        ...(talent.location ? [{ label: "location", value: talent.location }] : []),
        ...(talent.project ? [{ label: "project", value: talent.project }] : []),
      ],
      href: github ? `/u/${github}` : `/talent?q=${encodeURIComponent(talent.name)}`,
      external: false,
      publishedAt: null,
      readingMinutes: null,
      sponsored: false,
      quality: clamp01((talent.score ?? 70) / 100),
      heat: talent.stars != null ? logHeat(talent.stars, 50_000) : 0.2,
      counter: talent.stars ? { kind: "stars", value: talent.stars } : null,
      comments: github ? { kind: "profile", key: github } : null,
      extra: {
        kind: "talent",
        projects: (talent.projects ?? []).slice(0, 4).map((project) => ({ name: project.name, url: project.url ?? null, description: project.description, relationship: project.relationship })),
        sources: (talent.sources ?? []).slice(0, 4).map((source) => ({ title: source.title, url: source.url ?? null, publisher: source.publisher })),
        skills: talent.skills.slice(0, 10),
      },
    }));
  }

  for (const post of posts) {
    items.push(finish({
      id: `article:${post.slug}`,
      kind: "article",
      title: post.title,
      summary: post.description,
      body: null,
      author: { id: "ghfind", name: "ghfind", avatarUrl: "/icon.svg", handle: "@ghfind" },
      coverUrl: `/api/og/blog/${post.slug}`,
      tags: post.tags.slice(0, 4),
      score: null,
      scoreLabel: null,
      stats: [],
      href: `/blog/${post.slug}`,
      external: false,
      publishedAt: post.updated ?? post.date,
      readingMinutes: post.readingMinutes,
      sponsored: false,
      quality: 0.85,
      heat: 0.5,
      comments: { kind: "blog", key: post.slug },
    }));
  }

  const collectionBySlug = new Map(collections.map((collection) => [collection.slug, collection]));
  for (const card of collectionCards) {
    const collection = collectionBySlug.get(card.slug);
    const authorId = card.githubUsername ?? "ghfind";
    items.push(finish({
      id: `collection:${card.slug}`,
      kind: "collection",
      title: card.title,
      summary: card.intro,
      body: null,
      author: {
        id: authorId,
        name: card.identityName ?? "ghfind",
        avatarUrl: card.avatarUrl ?? "/icon.svg",
        handle: card.githubUsername ? `@${card.githubUsername}` : "@ghfind",
      },
      coverUrl: null,
      tags: collection?.tags.slice(0, 4) ?? [],
      score: null,
      scoreLabel: null,
      stats: [],
      href: `/collections/${card.slug}`,
      external: false,
      publishedAt: card.publishedAt,
      readingMinutes: card.readingMinutes,
      sponsored: false,
      quality: 0.8,
      heat: 0.5,
      badge: "editor",
      counter: collection && collection.items.length > 0 ? { kind: "items", value: collection.items.length } : null,
      comments: { kind: "collection", key: card.slug },
      extra: collection
        ? {
            kind: "collection",
            picks: collection.items.slice(0, 12).map((pick) => pick.kind === "repo"
              ? { kind: "repo" as const, id: pick.id, blurb: pickText(pick.blurb, locale), score: pick.stats.avgScore != null ? Math.round(pick.stats.avgScore) : null, tier: null, stars: pick.stats.stars, href: `https://github.com/${pick.id}` }
              : { kind: "developer" as const, id: pick.id, blurb: pickText(pick.blurb, locale), score: Math.round(pick.stats.score), tier: TIER_KEY[pick.stats.tier] ?? "npc", stars: pick.stats.totalStars ?? null, href: localePath(locale, `/u/${pick.id}`) }),
          }
        : null,
    }));
  }

  for (const job of jobs) {
    items.push(finish({
      id: `job:${job.id}`,
      kind: "job",
      title: job.title,
      summary: job.summary ?? [job.location, job.category].filter(Boolean).join(" · "),
      body: null,
      author: { id: `company:${job.company.id}`, name: job.company.name, avatarUrl: job.company.logoUrl, handle: job.location },
      coverUrl: null,
      tags: [job.category, ...job.employmentTypes].filter((tag): tag is string => Boolean(tag)),
      score: null,
      scoreLabel: job.salary,
      stats: [
        ...(job.location ? [{ label: "location", value: job.location }] : []),
        ...(job.salary ? [{ label: "salary", value: job.salary }] : []),
      ],
      href: job.hasDetail ? `/jobs/${encodeURIComponent(job.id)}` : job.applyUrl,
      external: !job.hasDetail,
      publishedAt: null,
      readingMinutes: null,
      sponsored: job.pinned || job.company.sponsor,
      quality: 0.6,
      heat: 0.3,
    }));
  }

  // Curated X posts. Until the agent pushes real posts, every non-production
  // deployment (local, dev) shows fictional demo voices, flagged in the UI;
  // production never invents posts.
  const demoX = !(storedX && storedX.posts.length > 0) && !isProductionDeployment();
  const timeline = demoX ? seedXTimeline(now) : storedX;
  if (timeline) items.push(...xStreamItems(timeline, lang));
  const voices = timeline ? xVoices(timeline) : [];

  // Badges: "hot" only for the real top slice of a kind, "new" only for real dates.
  const thresholds = new Map<StreamKind, number>();
  for (const kind of ["project", "developer", "talent", "post"] as StreamKind[]) {
    thresholds.set(kind, heatThreshold(items.filter((entry) => entry.kind === kind).map((entry) => entry.heat)));
  }
  const badged = items.map((entry): StreamItem => {
    if (entry.badge) return entry;
    if (entry.heat > 0 && entry.heat >= (thresholds.get(entry.kind) ?? Infinity)) return { ...entry, badge: "hot" };
    if (entry.publishedAt && now - Date.parse(entry.publishedAt) < NEW_WINDOW_MS) return { ...entry, badge: "new" };
    return entry;
  });

  const pulse: StreamPulse = {
    totalScored,
    trending: trending24h
      .filter((entry) => entry.recent_lookup_count > 0)
      .slice(0, 8)
      .map((entry) => ({
        username: entry.username,
        name: entry.display_name || entry.username,
        avatarUrl: entry.avatar_url,
        score: Math.round(entry.final_score),
        tier: TIER_KEY[entry.tier] ?? "npc",
        lookups: entry.recent_lookup_count,
      })),
  };

  // Internal links are resolved here so client links need no locale logic.
  const localized = badged.map((entry) => (entry.external ? entry : { ...entry, href: localePath(locale, entry.href) }));
  const link = (list: StreamItem[]) => (timeline ? linkXAccounts(list, timeline) : list);
  // Outside production (local dev has no D1 tables), demo items stand in for
  // every kind that loaded nothing, so the prototype shows the full mix.
  if (process.env.NODE_ENV !== "production") {
    const loaded = new Set(localized.map((entry) => entry.kind));
    const fill = seedStreamItems(lang, now).filter((entry) => !loaded.has(entry.kind));
    return { items: link([...localized, ...fill]), pulse, voices, generatedAt: now, demo: fill.length > 0, demoX };
  }
  return { items: link(localized), pulse, voices, generatedAt: now, demo: false, demoX };
}
