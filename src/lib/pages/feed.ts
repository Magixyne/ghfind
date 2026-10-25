import { localePath } from "@ghfind/i18n";
import { listPosts } from "@/lib/blog";
import { getGoLeaderboard } from "@/lib/go-leaderboard.server";
import { listJobs } from "@/lib/jobs";
import { loadDiscoverPage } from "@/lib/pages/discover";
import { loadHomeCollectionCards } from "@/lib/pages/home";
import { listTalentsPage } from "@/lib/talent-db";
import { TIER_KEY } from "@/lib/tier";
import { baselineEngagement, unitHash } from "@/lib/stream/rank";
import { seedStreamItems } from "@/lib/stream/seed";
import type { StreamItem } from "@/lib/stream/types";

/**
 * Data for the /feed prototype: every existing content source mapped onto one
 * StreamItem shape. Each source fails independently (a D1 or KV miss drops
 * that source only). Outside production, seeded demo items fill any kind that
 * loaded nothing, e.g. local dev without D1 tables.
 */

const DAY = 86_400_000;

/** Sources without a timestamp get a stable pseudo-date within `spreadDays`. */
function pseudoDate(id: string, now: number, spreadDays: number): string {
  return new Date(now - unitHash(`${id}:date`) * spreadDays * DAY).toISOString();
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function item(input: Omit<StreamItem, "baseline">): StreamItem {
  return { ...input, baseline: baselineEngagement(input.id, input.quality) };
}

async function settle<T>(label: string, run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (error) {
    console.error(`feed.source_failed ${label}`, error);
    return fallback;
  }
}

export async function loadFeedPage(locale: string): Promise<{ items: StreamItem[]; generatedAt: number; demo: boolean }> {
  const now = Date.now();
  const lang = locale === "zh" ? "zh" : "en";

  const [projectCards, developers, talents, collections, jobs] = await Promise.all([
    settle("projects", () => loadDiscoverPage(locale).then((page) => page.cards), []),
    settle("developers", () => getGoLeaderboard("trending", "7d", 24), []),
    settle("talent", () => listTalentsPage({ locale, pageSize: 18, sort: "recommended" }).then((page) => page.items), []),
    settle("collections", () => loadHomeCollectionCards(locale), []),
    settle("jobs", () => listJobs(locale, { limit: 6 }), []),
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

  for (const card of projectCards) {
    const id = `project:${card.repoKey}`;
    items.push(item({
      id,
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
        ...(card.language ? [{ label: "language", value: card.language }] : []),
      ],
      href: card.analysisId ? `/projects/analyses/${card.analysisId}` : card.canonicalUrl,
      external: !card.analysisId,
      publishedAt: pseudoDate(id, now, 30),
      readingMinutes: null,
      sponsored: false,
      quality: clamp01(card.productScore / 100),
    }));
  }

  for (const dev of developers) {
    const id = `developer:${dev.username}`;
    const tags = (dev.tags?.[lang] ?? []).slice(0, 4);
    items.push(item({
      id,
      kind: "developer",
      title: dev.display_name || dev.username,
      summary: tags.join(" · "),
      body: null,
      author: { id: dev.username, name: dev.display_name || dev.username, avatarUrl: dev.avatar_url, handle: `@${dev.username}` },
      coverUrl: null,
      tags,
      score: Math.round(dev.final_score),
      scoreLabel: TIER_KEY[dev.tier] ?? "npc",
      stats: [
        { label: "lookups", value: `${dev.lookup_count}` },
        ...(dev.delta != null ? [{ label: "delta", value: `${dev.delta > 0 ? "+" : ""}${Math.round(dev.delta)}` }] : []),
      ],
      href: `/u/${dev.username}`,
      external: false,
      publishedAt: pseudoDate(id, now, 7),
      readingMinutes: null,
      sponsored: false,
      quality: clamp01(dev.final_score / 100),
    }));
  }

  for (const talent of talents) {
    const id = `talent:${talent.id}`;
    const github = talent.source === "github" && talent.handle ? talent.handle.replace(/^@/, "") : null;
    items.push(item({
      id,
      kind: "talent",
      title: talent.name,
      summary: talent.bio || talent.role,
      body: [talent.note, talent.projectDescription].filter(Boolean).join("\n\n") || null,
      author: { id: github ?? talent.id, name: talent.name, avatarUrl: talent.avatarUrl ?? (github ? `https://github.com/${github}.png?size=80` : null), handle: talent.role || null },
      coverUrl: null,
      tags: [talent.direction, ...talent.skills].filter(Boolean).slice(0, 5),
      score: talent.score,
      scoreLabel: talent.available ? "available" : null,
      stats: [
        ...(talent.location ? [{ label: "location", value: talent.location }] : []),
        ...(talent.project ? [{ label: "project", value: talent.project }] : []),
        ...(talent.stars != null ? [{ label: "stars", value: `${talent.stars}` }] : []),
      ],
      href: github ? `/u/${github}` : `/talent?q=${encodeURIComponent(talent.name)}`,
      external: false,
      publishedAt: pseudoDate(id, now, 45),
      readingMinutes: null,
      sponsored: false,
      quality: clamp01((talent.score ?? 70) / 100),
    }));
  }

  for (const post of posts) {
    const id = `article:${post.slug}`;
    items.push(item({
      id,
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
    }));
  }

  for (const collection of collections) {
    const id = `collection:${collection.slug}`;
    const authorId = collection.githubUsername ?? "ghfind";
    items.push(item({
      id,
      kind: "collection",
      title: collection.title,
      summary: collection.intro,
      body: null,
      author: {
        id: authorId,
        name: collection.identityName ?? "ghfind",
        avatarUrl: collection.avatarUrl ?? "/icon.svg",
        handle: collection.githubUsername ? `@${collection.githubUsername}` : "@ghfind",
      },
      coverUrl: null,
      tags: [],
      score: null,
      scoreLabel: null,
      stats: [],
      href: `/collections/${collection.slug}`,
      external: false,
      publishedAt: collection.publishedAt,
      readingMinutes: collection.readingMinutes,
      sponsored: false,
      quality: 0.8,
    }));
  }

  for (const job of jobs) {
    const id = `job:${job.id}`;
    items.push(item({
      id,
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
      publishedAt: pseudoDate(id, now, 14),
      readingMinutes: null,
      sponsored: job.pinned || job.company.sponsor,
      quality: 0.6,
    }));
  }

  // Internal links are resolved here so client links need no locale logic.
  const localized = items.map((entry) => (entry.external ? entry : { ...entry, href: localePath(locale, entry.href) }));
  // Outside production (local dev has no D1 tables), demo items stand in for
  // every kind that loaded nothing, so the prototype shows the full mix.
  if (process.env.NODE_ENV !== "production") {
    const loaded = new Set(localized.map((entry) => entry.kind));
    const fill = seedStreamItems(lang, now).filter((entry) => !loaded.has(entry.kind));
    return { items: [...localized, ...fill], generatedAt: now, demo: fill.length > 0 };
  }
  return { items: localized, generatedAt: now, demo: false };
}
