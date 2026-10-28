import { afterEach, expect, it, vi } from "vitest";
import fixture from "../../../internal/backend/testdata/scan-mvp-fiction.json";
import { collect, fetchCommitContribReposByYear, fetchOriginalInventory, GITHUB_PAGE_SIZE, QUICK_REPO_PAGES } from "../github";
import { score } from "../score";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function installGitHub(originals = fixture.originals, merged = 0, openPrs = 0) {
  vi.stubEnv("GITHUB_TOKEN", "fiction-token");
  const inventoryPages: number[] = [];
  const requests: string[] = [];
  vi.stubGlobal("fetch", async (raw: string, init?: RequestInit) => {
    requests.push(raw);
    const url = new URL(raw);
    const login = url.pathname.split("/")[2];
    if (url.pathname === `/users/${login}`) return Response.json({
      login, id: login === fixture.highLogin ? 900001 : 900002,
      public_repos: originals + (login === fixture.highLogin ? fixture.highForks : fixture.lowForks),
      created_at: "2020-01-01T00:00:00Z", followers: 100, following: 10, bio: "Fictional builder",
    });
    if (url.pathname.endsWith("events/public")) return Response.json([{ created_at: "2026-08-01T00:00:00Z" }]);
    if (url.pathname !== "/graphql") return new Response("{}", { status: 404 });
    const { query, variables } = JSON.parse(String(init?.body));
    const pageInfo = { hasNextPage: false, endCursor: null };
    let data: unknown;
    if (query.includes("query OriginalInventory")) {
      expect(query).toContain("isFork: false");
      expect(query).toContain("ownerAffiliations: [OWNER]");
      const start = Number(variables.after ?? 0);
      inventoryPages.push(start);
      const end = Math.min(originals, start + GITHUB_PAGE_SIZE);
      data = { user: { forks: { totalCount: variables.login === fixture.highLogin ? fixture.highForks : 0 }, repositories: {
        nodes: Array.from({ length: end - start }, (_, i) => ({ name: `fiction-original-${start+i}`, nameWithOwner: `${variables.login}/fiction-original-${start+i}`,
          isFork: false, diskUsage: start+i < 2 ? 250 : 0, stargazerCount: start+i < 2 ? 40 : 0, forkCount: 4,
          description: "Fictional service", pushedAt: "2026-07-30T00:00:00Z", primaryLanguage: { name: "Go" },
          issues: { totalCount: 3 }, openPullRequests: { totalCount: openPrs }, repositoryTopics: { nodes: [] } })),
        pageInfo: { hasNextPage: end < originals, endCursor: end < originals ? String(end) : null },
      } } };
    } else if (query.includes("totalCommitContributions")) {
      data = { user: { pinnedItems: { nodes: [] }, mergedPRs: { totalCount: merged }, allPRs: { totalCount: merged },
        closedPRs: { totalCount: 0, nodes: [] }, issues: { totalCount: 2 }, contributionYears: { contributionYears: [2025] },
        contributionsCollection: { totalCommitContributions: 20, totalPullRequestContributions: 0, totalIssueContributions: 2,
          totalPullRequestReviewContributions: 0, contributionCalendar: { totalContributions: 22 } } } };
    } else if (query.includes("commitContributionsByRepository")) {
      data = { user: { y0: { commitContributionsByRepository: [] } } };
    } else if (query.includes("states: MERGED, after:") || query.includes("type: ISSUE, first: $count")) {
      const start = Number(variables.after ?? 0);
      const end = Math.min(merged, start + variables.count);
      const connection = { nodes: Array.from({ length: end-start }, (_, i) => ({ id: `fiction-pr-${start+i}`,
        mergedAt: "2025-05-01T00:00:00Z", repository: { nameWithOwner: "fiction-upstream/fiction-service",
          stargazerCount: 1000, isPrivate: false, isFork: false, owner: { login: "fiction-upstream" } } })),
        issueCount: merged, pageInfo: { hasNextPage: end < merged, endCursor: end < merged ? String(end) : null } };
      data = query.includes("type: ISSUE") ? { search: connection } : { user: { pullRequests: connection } };
    } else {
      data = { user: { pullRequests: { nodes: [], pageInfo }, organizations: { nodes: [] } },
        search: { issueCount: 0, nodes: [], pageInfo }, repository: null };
    }
    return Response.json({ data });
  });
  return { inventoryPages, requests };
}

it("keeps identical original work score neutral after excluding 500 invalid forks", async () => {
  const { requests } = installGitHub();
  const highQuick = await collect(fixture.highLogin, { now: new Date(fixture.now) });
  expect(highQuick.collection).toMatchObject({ mode: "quick", coverage: "partial_public", truncation_reasons: ["public_repos_quick_limit"] });
  const high = await collect(fixture.highLogin, { full: true, now: new Date(fixture.now) });
  const low = await collect(fixture.lowLogin, { full: true, now: new Date(fixture.now) });
  expect(high.collection.coverage).toBe("complete_public");
  expect(high.metrics.fork_repo_count).toBe(500);
  expect(high.metrics.fetched_repo_count).toBe(502);
  expect(high.metrics.nonempty_original_repo_count).toBe(2);
  expect(high.metrics.total_stars).toBe(low.metrics.total_stars);
  const highScore = score(high.metrics);
  const lowScore = score(low.metrics);
  expect(highScore.final_score).toBeLessThanOrEqual(lowScore.final_score);
  expect(highScore.final_score).toBe(30.6);
  expect(lowScore.final_score).toBe(30.6);
  expect(highScore.risk_notes?.some(n => n.flag === "mostly_forks")).toBe(true);
  expect(requests.some(r => r.includes("/repos?"))).toBe(false);
  console.log(`fiction fixture: high=${highScore.final_score}, low=${lowScore.final_score}, originals=2, forks=500/0`);
});

it("escalates the external 300 cap and merged window, then reads PR 301 natively", async () => {
  installGitHub(fixture.originals, 301);
  const quick = await collect(fixture.lowLogin, { now: new Date(fixture.now) });
  expect(quick.collection.truncation_reasons).toEqual(expect.arrayContaining(["merged_pr_window", "external_merged_pr_cap"]));
  const full = await collect(fixture.lowLogin, { full: true, now: new Date(fixture.now) });
  expect(full.collection).toEqual({ mode: "full", coverage: "complete_public", truncation_reasons: [] });
  expect(full.metrics.external_merged_pr_count).toBe(301);
  expect(full.metrics.merged_pr_contribution_aggregation_incomplete).toBe(false);
});

it("continues original inventory beyond the existing two quick pages", async () => {
  const count = QUICK_REPO_PAGES * GITHUB_PAGE_SIZE + 1;
  const { inventoryPages } = installGitHub(count, 0, 2);
  const quick = await fetchOriginalInventory(fixture.lowLogin);
  expect(quick.repos).toHaveLength(count-1);
  expect(quick.incomplete).toBe(true);
  inventoryPages.length = 0;
  const full = await fetchOriginalInventory(fixture.lowLogin, true);
  expect(full.repos).toHaveLength(count);
  expect(full.repos[0].open_issues_count).toBe(5); // REST includes open PRs
  expect(full.incomplete).toBe(false);
  expect(inventoryPages).toEqual([0, 100, 200]);
});

it("replaces a saturated commit window with disjoint children without double counting", async () => {
  vi.stubEnv("GITHUB_TOKEN", "fiction-token");
  const node = (repo: string, commits: number) => ({ repository: { nameWithOwner: `fiction-org/${repo}`,
    stargazerCount: 1000, isPrivate: false, isFork: false, owner: { login: "fiction-org" } },
    contributions: { totalCount: commits, nodes: [] } });
  vi.stubGlobal("fetch", async (_raw: string, init?: RequestInit) => {
    const { variables } = JSON.parse(String(init?.body));
    const root = variables.from0.startsWith("2025-01-01") && variables.to0.startsWith("2025-12-31");
    const nodes = root ? Array.from({ length: GITHUB_PAGE_SIZE }, (_, i) => node(`truncated-parent-${i}`, 99))
      : variables.from0.startsWith("2025-01-01") ? [node("shared", 2)] : [node("shared", 3), node("tail", 7)];
    return Response.json({ data: { user: { y0: { commitContributionsByRepository: nodes } } } });
  });
  const reasons: string[] = [];
  await fetchCommitContribReposByYear("fiction-lowfork", [2025], { note: r => reasons.push(r) });
  expect(reasons).toContain("commit_repository_cap");
  const full = await fetchCommitContribReposByYear("fiction-lowfork", [2025], { full: true, note: r => reasons.push(r) });
  expect(full?.map(r => [r.repo, r.commits, r.active_years])).toEqual([
    ["fiction-org/shared", 5, 1], ["fiction-org/tail", 7, 1],
  ]);
});
