import { afterEach, describe, expect, it, vi } from "vitest";
import { roastGenerator } from "../cache-version";
import { buildRoastPayload } from "../prompt";
import { coerceCopy, generateRoastV13, parseJsonObject, type V13Complete } from "../roast-v13/chain";
import { buildWriterFactCard, slimV13Payload } from "../roast-v13/facts";
import { renderV13Report } from "../roast-v13/render";
import { buildFactCards } from "../roast-v13/cards";
import {
  BAD_QUOTE,
  buildFactIndex,
  checkSlots,
  checkText,
  checkTrivia,
  dropUnverifiedSentences,
  fillQuoteTokens,
  fitSlotLengths,
  validateCopy,
  type V13Copy,
} from "../roast-v13/validate";
import { rewriteLegacyRoastMarkdown } from "../roast-report-legacy";
import type { ScanResult } from "../types";

const scan = {
  metrics: {
    username: "sample-user",
    account_age_years: 6.1,
    contribution_years_active: 7,
    followers: 44,
    following: 55,
    public_repos: 53,
    fork_repo_count: 34,
    merged_pr_count: 96,
    total_pr_count: 103,
    impact_pr_count: 58,
    impact_commit_count: 1191,
    impact_repo_count: 10,
    recent_merged_pr_sample: 50,
    last_year_contributions: 3611,
    bio: "Building small tools for big teams.",
  },
  top_repos: [
    {
      name: "widget-kit",
      owner_login: "sample-user",
      name_with_owner: "sample-user/widget-kit",
      stars: 57,
      forks: 10,
      open_issues: 5,
      open_issue_count: 5,
      size: 2311,
      language: "TypeScript",
      description: "A lightweight component library",
      pushed_at: "2026-01-20T03:01:04Z",
      readme_excerpt: "long readme text that the writer never needs",
    },
    {
      name: "desk-agent",
      owner_login: "sample-user",
      name_with_owner: "sample-user/desk-agent",
      stars: 19,
      forks: 0,
      open_issues: 7,
      size: 900,
      language: "Rust",
      description: "Desktop agent",
      pushed_at: "2026-10-26T03:01:04Z",
    },
  ],
  recent_prs: [],
  impact_repos: [
    { repo: "popular-org/word-trainer", stars: 23551, prs: 1, commits: 1 },
    { repo: "sample-user/side-app", stars: 2, prs: 10, commits: 719 },
  ],
  verified_impact_prs: [],
  flood_pr_titles: [],
  scoring: {
    sub_scores: {
      account_maturity: 10,
      original_project_quality: 12.2,
      contribution_quality: 21.5,
      ecosystem_impact: 10,
      community_influence: 4,
      activity_authenticity: 15.9,
    },
    base_score: 73.6,
    red_flags: [],
    risk_notes: [],
    total_penalty: 0,
    final_score: 73.6,
    tier: "人上人",
    tier_label: "优质贡献者 · 值得信任",
  },
} as unknown as ScanResult;

const goodCopy = {
  title: "万星仓库只改两个词",
  roast_line: {
    zh: "主力活全砸进 sample-user/side-app,组件库 sample-user/widget-kit 反倒从年初起没再推送。",
    en: "The real work went into the side app while the component library sat idle.",
  },
  roast_line_candidates: ["候选一", "候选二"],
  tags: { zh: ["词条外交", "自营荒地"], en: ["Word Diplomat", "Own-Repo Famine"] },
  verdict: "代码是真写,名气全靠别人家的仓库撑场。",
  findings: [
    { headline: "轻量组件库", text: "sample-user/widget-kit 自称 lightweight component library,TypeScript 写的,5 个 open Issue 等着。" },
    { headline: "桌面代理在加班", text: "sample-user/desk-agent 是 Rust 写的桌面代理,还堆着一串 open Issue。" },
    { headline: "简介很谦虚", text: "简介写着「Building small tools for big teams.」,最大的工具 57 星。" },
  ],
  dimensions: {
    account_maturity: "注册 6.1 年,贡献跨 7 个自然年。",
    original_project_quality: "最高星 sample-user/widget-kit 57 星。",
    contribution_quality: "合并 PR 很勤,几乎都合进去了。",
    ecosystem_impact: "提交大多砸在 sample-user/side-app。",
    community_influence: "总星不高,开 issue 也不算勤。",
    activity_authenticity: "过去一年贡献日历 3611 次。",
  },
  risk: "",
  advice: ["给 sample-user/widget-kit 关掉那 5 个 open Issue。"],
};

const payload = slimV13Payload(buildRoastPayload(scan, "zh"));
const index = buildFactIndex(payload);

describe("roast v13 fact checks", () => {
  it("accepts numbers, derived shares and repos that exist in the payload", () => {
    expect(checkText(index, "x", "1191 个 commit 里 719 个在 sample-user/side-app,占 60%。")).toEqual([]);
    expect(checkText(index, "x", "粉丝 44 / 关注 55")).toEqual([]);
  });

  it("flags invented numbers and repositories", () => {
    const issues = checkText(index, "x", "你在 other-org/ghost 提了 4242 个 PR。");
    expect(issues.map((i) => i.kind).sort()).toEqual(["number", "repo"]);
  });

  it("flags a star count attached to the wrong repository", () => {
    const issues = checkText(index, "x", "1181 个 commit 埋在 sample-user/widget-kit 2 星的仓库里。");
    expect(issues.some((i) => i.kind === "repo_stars")).toBe(true);
    expect(checkText(index, "x", "sample-user/widget-kit 57 星")).toEqual([]);
  });

  it("reports template clichés", () => {
    const copy = coerceCopy({ ...goodCopy, verdict: "资历老到能当化石,这不等于作弊。" })!;
    const kinds = validateCopy(index, copy, "zh").filter((i) => i.kind === "cliche");
    expect(kinds.length).toBe(2);
  });

  it("keeps the writer fact card small and free of README bodies and output contracts", () => {
    const card = JSON.stringify(buildWriterFactCard(payload));
    expect(card).not.toContain("long readme text");
    expect(JSON.stringify(payload)).not.toContain("@@ADJUST");
    expect(card).toContain("sample-user/widget-kit");
  });
});

describe("roast v13 rendering", () => {
  it("renders scores from the scan, never from the model", () => {
    const copy = coerceCopy(goodCopy) as V13Copy;
    const md = renderV13Report(scan, "zh", copy);
    expect(md.startsWith("## sample-user — 73.60/100  ·  人上人 (优质贡献者 · 值得信任)")).toBe(true);
    expect(md).toContain("#### 原创与主导项目质量 · 12.2/18");
    expect(md).toContain("### 扎心三连");
    expect(md).toContain("> **一句话结论**");
    expect(md).toMatch(/#### .+ · \d/);
    expect(md).toContain("### 风险标记");
    expect(md).toContain("无。");
    const en = renderV13Report(scan, "en", copy);
    expect(en).toContain("SOLID (Solid · Trustworthy)");
    expect(en).toContain("#### Account maturity · 10/10");
  });
});

function stub(outputs: Partial<Record<"angles" | "writer" | "editor", string | Error>>): V13Complete {
  return async (step) => {
    const out = outputs[step];
    if (out instanceof Error) throw out;
    return out ?? "";
  };
}

describe("roast v13 risk section", () => {
  it("falls back to the scorer's own notes without the disclaimer tail", () => {
    const risky = {
      ...scan,
      scoring: {
        ...scan.scoring,
        risk_notes: [{ flag: "mostly_forks", disposition: "note", detail: "公开仓库以 Fork 为主；这本身不代表任何问题。" }],
      },
    } as unknown as ScanResult;
    const md = renderV13Report(risky, "zh", { ...(coerceCopy(goodCopy) as V13Copy), risk: "" });
    expect(md).toContain("### 风险标记");
    expect(md).toContain("- 公开仓库以 Fork 为主（提示）");
    expect(md).not.toContain("不代表任何问题");
  });

  it("drops over-long tags instead of cutting them mid-word", () => {
    const copy = coerceCopy({ ...goodCopy, tags: { zh: ["短标签", "这是一个超过六个字的标签", "第二个"], en: [] } })!;
    expect(copy.tags.zh).toEqual(["短标签", "第二个"]);
  });
});

describe("generateRoastV13", () => {
  const opts = { deadlineMs: Date.now() + 600_000 };

  it("runs angle → writer → editor and returns rendered copy", async () => {
    const edited = { ...goodCopy, verdict: "编辑后的结论,真代码在 2 星仓库。" };
    const r = await generateRoastV13(
      scan,
      "zh",
      stub({ angles: '{"angles":[]}', writer: JSON.stringify(goodCopy), editor: "```json\n" + JSON.stringify(edited) + "\n```" }),
      opts,
    );
    expect(r.steps.map((s) => s.step)).toEqual(["writer", "editor"]);
    expect(r.report).toContain("编辑后的结论");
    expect(r.tags.zh).toEqual(["词条外交", "自营荒地"]);
    const hard = ["number", "repo", "repo_stars", "quote", "trivia", "repeat", "schema", "language"];
    expect(r.finalIssues.filter((i) => hard.includes(i.kind))).toEqual([]);
    expect(r.cards.length).toBeGreaterThan(3);
  });

  it("uses the draft when the editor fails and tolerates a failed angle step", async () => {
    const r = await generateRoastV13(
      scan,
      "zh",
      stub({ angles: new Error("boom"), writer: JSON.stringify(goodCopy), editor: new Error("timeout") }),
      opts,
    );
    expect(r.copy.verdict).toBe(goodCopy.verdict);
  });

  it("retries an empty writer once, then fails so the route can fall back", async () => {
    let writerCalls = 0;
    await expect(
      generateRoastV13(scan, "zh", async (step) => (step === "writer" ? (writerCalls++, "") : "{}"), opts),
    ).rejects.toThrow(/writer/);
    expect(writerCalls).toBe(2);
  });

  it("drops sentences that still cite facts absent from the data", async () => {
    const bad = {
      ...goodCopy,
      findings: [
        ...goodCopy.findings.slice(0, 2),
        { headline: "编造", text: "你在 other-org/ghost 有 9999 星。sample-user/desk-agent 用 Rust 写。" },
      ],
    };
    const r = await generateRoastV13(scan, "zh", stub({ writer: JSON.stringify(bad), editor: "not json" }), opts);
    expect(r.copy.findings[2].text).toBe("sample-user/desk-agent 用 Rust 写。");
    expect(r.dropped).toEqual(["findings[2].text: 你在 other-org/ghost 有 9999 星。"]);
  });

  it("refuses to start a step without budget", async () => {
    await expect(
      generateRoastV13(scan, "zh", stub({}), { deadlineMs: Date.now() + 1000 }),
    ).rejects.toThrow(/budget/);
  });

  it("parses JSON objects wrapped in prose", () => {
    expect(parseJsonObject('ok {"a":1} done')).toEqual({ a: 1 });
    expect(parseJsonObject("nothing")).toBeNull();
  });
});

describe("roast generator flag", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to v12", () => {
    vi.stubEnv("ROAST_GENERATOR", "");
    expect(roastGenerator()).toBe("v12");
    expect(roastGenerator({ background: true })).toBe("v12");
  });

  it("uses v13 everywhere when enabled", () => {
    vi.stubEnv("ROAST_GENERATOR", "v13");
    expect(roastGenerator()).toBe("v13");
    expect(roastGenerator({ background: true })).toBe("v13");
  });

  it("can limit v13 to queued background re-roasts", () => {
    vi.stubEnv("ROAST_GENERATOR", "v13");
    vi.stubEnv("ROAST_V13_SCOPE", "background");
    expect(roastGenerator()).toBe("v12");
    expect(roastGenerator({ background: true })).toBe("v13");
  });
});

describe("roast v13 salience, quotes and repetition", () => {
  const dropFrom = (findings: { headline: string; text: string }[]) =>
    dropUnverifiedSentences(index, { ...goodCopy, findings } as V13Copy);

  it("accepts a verbatim bio quote and rejects a translated or misattributed one", () => {
    expect(checkText(index, "findings[0].text", "简介写着「Building small tools for big teams.」。")).toEqual([]);
    expect(checkText(index, "findings[0].text", "简介写着「给大团队造小工具」。").map((i) => i.kind)).toEqual(["quote"]);
    // The phrase exists, but in a repository description, not in the bio.
    expect(checkText(index, "findings[0].text", "简介喊「lightweight component library」。").map((i) => i.kind)).toEqual(["quote"]);
    expect(checkText(index, "findings[0].text", "sample-user/widget-kit 的描述写着「A lightweight component library」。")).toEqual([]);
  });

  it("rejects paraphrasing what the bio says without quoting it", () => {
    expect(checkText(index, "findings[0].text", "简介写的是给大团队造工具,结果都很小。").map((i) => i.kind)).toEqual(["quote"]);
    const { copy } = dropFrom([
      { headline: "a", text: "简介喊 become one。sample-user/desk-agent 用 Rust 写。" },
      ...goodCopy.findings.slice(0, 2),
    ]);
    expect(copy.findings[0].text).toBe("sample-user/desk-agent 用 Rust 写。");
  });

  it("drops a finding that restates the one-liner and a headline equal to the title", () => {
    const { copy, dropped } = dropUnverifiedSentences(index, {
      ...goodCopy,
      findings: [
        { headline: goodCopy.title, text: goodCopy.roast_line.zh },
        ...goodCopy.findings.slice(0, 2),
      ],
    } as V13Copy);
    expect(copy.findings).toHaveLength(2);
    expect(dropped.some((d) => d.includes("restates the one-liner"))).toBe(true);
    const issues = validateCopy(index, { ...goodCopy, findings: [{ headline: goodCopy.title, text: goodCopy.roast_line.zh }] } as V13Copy, "zh");
    expect(issues.filter((i) => i.kind === "repeat").map((i) => i.field)).toEqual(
      expect.arrayContaining(["findings[0].text", "findings[0].headline"]),
    );
    expect(issues.filter((i) => i.kind === "repeat").map((i) => i.field)).not.toContain("findings[1].text");
  });

  it("drops follower counts, time windows and token PRs to famous repos everywhere", () => {
    const { copy } = dropFrom([
      { headline: "a", text: "粉丝 44,关注 55。" },
      { headline: "b", text: "23551 星的 popular-org/word-trainer 只有你 1 个 PR。sample-user/desk-agent 用 Rust 写。" },
      goodCopy.findings[0],
    ]);
    expect(copy.findings.map((f) => f.text)).toEqual(["sample-user/desk-agent 用 Rust 写。", goodCopy.findings[0].text]);
    // Follower sentence also dropped from community when injected.
    const dims = dropUnverifiedSentences(index, {
      ...goodCopy,
      dimensions: {
        ...goodCopy.dimensions,
        community_influence: "粉丝 44。总星不高。",
        ecosystem_impact: "word-trainer 上只有 1 个 PR。sample-user/side-app 有 719 个提交。",
      },
      advice: ["近 180 天提交很多,把 sample-user/widget-kit 的 5 个 open Issue 关掉。", "把 sample-user/desk-agent 打包发布,写清安装步骤。"],
    } as V13Copy).copy;
    expect(dims.dimensions.community_influence).toBe("总星不高。");
    expect(dims.dimensions.ecosystem_impact).toBe("sample-user/side-app 有 719 个提交。");
    expect(dims.advice).toEqual(["把 sample-user/desk-agent 打包发布,写清安装步骤。"]);
    const trivia = validateCopy(index, { ...goodCopy, verdict: "近 180 天提交全在一个仓库。" } as V13Copy, "zh");
    expect(trivia.some((i) => i.kind === "trivia" && i.field === "verdict")).toBe(true);
  });

  it("rejects follower-ratio tags and thickness / share-count trivia in copy", () => {
    const tagIssues = validateCopy(
      index,
      { ...goodCopy, tags: { zh: ["关注倒挂", "核心修理工"], en: ["Follows>Fans", "Core Fixer"] } } as V13Copy,
      "zh",
    ).filter((i) => i.kind === "trivia" && i.field.startsWith("tags"));
    expect(tagIssues.map((i) => i.field)).toEqual(expect.arrayContaining(["tags.zh[0]", "tags.en[0]"]));
    expect(tagIssues.every((i) => /trivial stat/.test(i.detail))).toBe(true);

    const thick = validateCopy(index, { ...goodCopy, verdict: "对外要人时卡在厚度,作品还撑得住。" } as V13Copy, "zh");
    expect(thick.some((i) => i.kind === "trivia" && /厚度/.test(i.detail))).toBe(true);

    const share = validateCopy(
      index,
      { ...goodCopy, findings: [{ headline: "a", text: "apache/big-repo 1863 个已合并 PR 里你 7 个,主战场在别处。" }, ...goodCopy.findings.slice(0, 2)] } as V13Copy,
      "zh",
    );
    expect(share.some((i) => i.kind === "trivia" && /share-count contrast/.test(i.detail))).toBe(true);

    // Broader share forms — including dimensions, "是你的", "第一名 N 个", "X of Y".
    const forms = [
      { field: "verdict", text: "362 个提交里 93 个是你的,方向清楚。" },
      { field: "dimensions.contribution_quality", text: "400 个已合并 PR 里 178 个,很能打。" },
      { field: "findings", text: "第一名 267 个,但主战场不在这。" },
      { field: "advice", text: "5 个已合并 PR 里你只有 1 个,去把份额做大。" },
      { field: "roast_line", text: "4972 星的 apache/dubbo-go 里你只有 4 个提交。" },
    ] as const;
    for (const f of forms) {
      const copy =
        f.field === "verdict"
          ? ({ ...goodCopy, verdict: f.text } as V13Copy)
          : f.field === "dimensions.contribution_quality"
            ? ({ ...goodCopy, dimensions: { ...goodCopy.dimensions, contribution_quality: f.text } } as V13Copy)
            : f.field === "findings"
              ? ({ ...goodCopy, findings: [{ headline: "x", text: f.text }, ...goodCopy.findings.slice(0, 2)] } as V13Copy)
              : f.field === "advice"
                ? ({ ...goodCopy, advice: [f.text] } as V13Copy)
                : ({ ...goodCopy, roast_line: { ...goodCopy.roast_line, zh: f.text } } as V13Copy);
      const issues = validateCopy(index, copy, "zh");
      expect(issues.some((i) => i.kind === "trivia" && /share-count contrast|gamey advice/.test(i.detail))).toBe(true);
    }

    // Number density + days-since + follower count.
    expect(
      validateCopy(index, { ...goodCopy, verdict: "注册 6 年,7 个仓库,96 个 PR。" } as V13Copy, "zh").some(
        (i) => i.kind === "trivia" && /number density/.test(i.detail),
      ),
    ).toBe(true);
    // ISO dates count as one number, not three.
    expect(
      validateCopy(index, { ...goodCopy, verdict: "2022-07-21 注册,主线还在长。" } as V13Copy, "zh").some(
        (i) => i.kind === "trivia" && /number density/.test(i.detail),
      ),
    ).toBe(false);
    expect(
      validateCopy(index, { ...goodCopy, verdict: "距上次活动 12 天,该动了。" } as V13Copy, "zh").some(
        (i) => i.kind === "trivia" && /days-since|time window/.test(i.detail),
      ),
    ).toBe(true);
    expect(
      validateCopy(
        index,
        { ...goodCopy, dimensions: { ...goodCopy.dimensions, community_influence: "粉丝 44、关注 55。" } } as V13Copy,
        "zh",
      ).some((i) => i.kind === "trivia" && /follower/.test(i.detail)),
    ).toBe(true);

    // Stars-vs-commits / rank talk / lang share / gender / OWNER.
    expect(
      validateCopy(
        index,
        { ...goodCopy, roast_line: { ...goodCopy.roast_line, zh: "84213 星的 org/app 上堆了 100 个提交。" } } as V13Copy,
        "zh",
      ).some((i) => i.kind === "trivia" && /stars-vs-commits|提交数第一/.test(i.detail)),
    ).toBe(true);
    expect(
      validateCopy(
        index,
        { ...goodCopy, verdict: "你在那边不是提交数第一,只是客座。" } as V13Copy,
        "zh",
      ).some((i) => i.kind === "trivia" && /stars-vs-commits|提交数第一/.test(i.detail)),
    ).toBe(true);
    expect(
      validateCopy(
        index,
        { ...goodCopy, findings: [{ headline: "x", text: "约 65% 是文档和站点皮肤。", cards: ["c1"] }, ...goodCopy.findings.slice(0, 2)] } as V13Copy,
        "zh",
      ).some((i) => i.kind === "trivia" && /percent-of/.test(i.detail)),
    ).toBe(true);
    expect(
      validateCopy(
        index,
        {
          ...goodCopy,
          dimensions: { ...goodCopy.dimensions, activity_authenticity: "语言落在 TypeScript 32%、Go 19%。" },
        } as V13Copy,
        "zh",
      ).some((i) => i.kind === "trivia" && /language-share/.test(i.detail)),
    ).toBe(true);
    expect(
      validateCopy(index, { ...goodCopy, verdict: "她把导航补丁合进主干。" } as V13Copy, "zh").some(
        (i) => i.kind === "trivia" && /gender/.test(i.detail),
      ),
    ).toBe(true);
    expect(
      validateCopy(
        index,
        {
          ...goodCopy,
          dimensions: { ...goodCopy.dimensions, account_maturity: "仓把你标成 OWNER 和维护者。" },
        } as V13Copy,
        "zh",
      ).some((i) => i.kind === "trivia" && /OWNER/.test(i.detail)),
    ).toBe(true);
    expect(
      validateCopy(
        index,
        { ...goodCopy, tags: { zh: ["协作者", "导航补丁"], en: ["Collaborator", "Nav"] } } as V13Copy,
        "zh",
      ).some((i) => i.kind === "trivia" && i.field.startsWith("tags") && /role|trivial/.test(i.detail)),
    ).toBe(true);

    // Credited/折算 stars must not be mislabeled as owned-repo totals.
    expect(
      validateCopy(
        index,
        {
          ...goodCopy,
          dimensions: { ...goodCopy.dimensions, community_influence: "名下仓库总星 272,另外开过 55 个 issue。" },
        } as V13Copy,
        "zh",
      ).some((i) => i.kind === "trivia" && /credited|折算/.test(i.detail)),
    ).toBe(true);
    expect(
      validateCopy(
        index,
        {
          ...goodCopy,
          dimensions: { ...goodCopy.dimensions, community_influence: "折算计入星 272,另外开过 55 个 issue。" },
        } as V13Copy,
        "zh",
      ).some((i) => i.kind === "trivia" && /credited|折算/.test(i.detail)),
    ).toBe(false);

    // Closed-PR counts only — no invented close reasons.
    expect(
      validateCopy(
        index,
        {
          ...goodCopy,
          risk: "有 79 个 PR 被维护者关闭且未合并,说明文档型改动会被门槛直接弹回。",
        } as V13Copy,
        "zh",
      ).some((i) => i.kind === "trivia" && /invent|close reason|关闭原因/.test(i.detail)),
    ).toBe(true);
    expect(
      validateCopy(
        index,
        { ...goodCopy, risk: "有 79 个 PR 被维护者关闭且未合并。" } as V13Copy,
        "zh",
      ).some((i) => i.kind === "trivia" && /invent|close reason|关闭原因/.test(i.detail)),
    ).toBe(false);

    const { copy } = dropUnverifiedSentences(index, {
      ...goodCopy,
      tags: { zh: ["关注倒挂", "核心修理工"], en: ["Follows>Fans"] },
      verdict: "对外要人时卡在厚度。",
    } as V13Copy);
    expect(copy.tags.zh).toEqual(["核心修理工"]);
    expect(copy.tags.en).toEqual([]);
  });

  it("flags PR-count contrasts and description wordplay in the one-liner only", () => {
    const kinds = (text: string, field = "roast_line.zh") =>
      validateCopy(index, { ...goodCopy, roast_line: { ...goodCopy.roast_line, zh: text } } as V13Copy, "zh")
        .filter((i) => i.field === field && i.kind === "trivia");
    expect(kinds("sample-user/side-app 有 719 个提交,合进去的那个 PR 只改了导航。").length).toBeGreaterThanOrEqual(1);
    expect(kinds("sample-user/widget-kit 的描述写着「A lightweight component library」,轻的是推送。")).toHaveLength(1);
    expect(kinds(goodCopy.roast_line.zh)).toEqual([]);
    expect(checkTrivia(index, "findings[0].text", "sample-user/side-app 只有 1 个 PR。")).toEqual([]);
  });

  it("renders up to four advice lines and names the findings count", () => {
    const report = renderV13Report(scan, "zh", {
      ...goodCopy,
      findings: goodCopy.findings.slice(0, 2),
      advice: ["一", "二", "三", "四", "五"],
    } as V13Copy);
    expect(report).toContain("### 扎心两连");
    expect(report.match(/^- /gm)?.length).toBe(4);
  });
});

describe("roast v13 fact cards and slots", () => {
  const cards = buildFactCards(payload, { username: "sample-user", scan });
  const byKind = (k: string) => cards.filter((c) => c.kind === k);

  it("turns the scan into weighted cards with verbatim quotes and no trivia hooks", () => {
    expect(cards.map((c) => c.id)).toEqual(cards.map((_, i) => `c${i + 1}`));
    const communityCard = byKind("community")[0];
    expect(communityCard.claim).toMatch(/折算计入星/);
    expect(communityCard.claim).not.toMatch(/^总星 /);
    const widget = cards.find((c) => c.facts.repo === "sample-user/widget-kit")!;
    expect(widget.kind).toBe("project");
    expect(widget.quotes?.[0]).toEqual({ text: "A lightweight component library", source: "description", repo: "sample-user/widget-kit" });
    expect(byKind("bio")[0].quotes?.[0].text).toBe("Building small tools for big teams.");
    // A token PR to a famous repo is not a card when the account has real work elsewhere.
    expect(cards.some((c) => c.facts.repo === "popular-org/word-trainer")).toBe(false);
    expect(cards.find((c) => c.facts.repo === "sample-user/side-app")?.kind).toBe("maintenance");
    // Community context card must not feed follower counts into hooks.
    const community = cards.filter((c) => c.kind === "community");
    expect(community.length).toBe(1);
    expect(community[0].hook).toBe(false);
    expect(community[0].claim).toMatch(/禁止写入锐评正文/);
    // Project/maintenance claims never use share-contrast phrasing.
    for (const c of cards.filter((c) => c.kind === "project" || c.kind === "maintenance")) {
      expect(c.claim).not.toMatch(/\d+\s*个(?:已合并\s*)?(?:PR|提交)[^。]{0,20}里/);
      expect(c.claim).not.toMatch(/是 TA 的/);
    }
    const weights = cards.filter((c) => c.hook && c.kind !== "bio").map((c) => c.weight);
    expect(weights).toEqual([...weights].sort((a, b) => b - a));
  });

  it("never turns the username/username profile README repo into a project card", () => {
    const withProfile = {
      ...payload,
      top_repos: [
        ...(payload as { top_repos: unknown[] }).top_repos,
        { name_with_owner: "sample-user/sample-user", owner_login: "sample-user", stars: 40, description: "Config files for my GitHub profile." },
      ],
    };
    const built = buildFactCards(withProfile as typeof payload, { username: "sample-user", scan });
    expect(built.some((c) => c.facts.repo === "sample-user/sample-user")).toBe(false);
  });

  it("fills quote tokens with the card's exact text and marks unknown tokens", () => {
    const bio = byKind("bio")[0].id;
    expect(fillQuoteTokens(`简介写着{{q:${bio}}}。`, cards, "zh")).toBe("简介写着「Building small tools for big teams.」。");
    expect(fillQuoteTokens("the bio says {{ q:" + bio + " }}", cards, "en")).toBe("the bio says \u201cBuilding small tools for big teams.\u201d");
    expect(fillQuoteTokens("简介写着{{q:c999}}。", cards, "zh")).toContain(BAD_QUOTE);
  });

  it("drops a sentence whose quote token named no card", async () => {
    const withToken = {
      ...goodCopy,
      findings: [...goodCopy.findings.slice(0, 2), { headline: "x", text: "简介写着{{q:c999}}。sample-user/desk-agent 用 Rust 写。" }],
    };
    const r = await generateRoastV13(scan, "zh", stub({ writer: JSON.stringify(withToken), editor: "not json" }), {
      deadlineMs: Date.now() + 600_000,
    });
    expect(r.copy.findings[2].text).toBe("sample-user/desk-agent 用 Rust 写。");
  });

  it("checks slot lengths, citations and distinct main cards", () => {
    const hook = cards.find((c) => c.hook)!.id;
    const context = cards.find((c) => !c.hook)!.id;
    const copy = coerceCopy({
      ...goodCopy,
      roast_line: { ...goodCopy.roast_line, cards: [context] },
      verdict: { text: goodCopy.verdict, cards: [hook] },
      findings: goodCopy.findings.map((f) => ({ ...f, cards: [hook] })),
      advice: [{ text: "短", cards: ["c999"] }],
    })!;
    const issues = checkSlots(copy, cards, "zh");
    const at = (field: string) => issues.filter((i) => i.field === field).map((i) => i.kind);
    expect(at("roast_line")).toEqual(["trivia"]);
    expect(at("findings[1]")).toEqual(["repeat"]);
    expect(at("advice[0]")).toEqual(expect.arrayContaining(["cite"]));
    expect(at("advice[0]")).toContain("length");
    expect(issues.some((i) => i.kind === "length" && i.field === "dimensions.account_maturity")).toBe(true);
  });

  it("accepts slot-shaped writer output with per-slot card citations", () => {
    const hook = cards.find((c) => c.hook)!.id;
    const copy = coerceCopy({
      ...goodCopy,
      verdict: { text: "x".repeat(40), cards: [hook] },
      dimensions: { account_maturity: { text: "y".repeat(70), cards: [hook] } },
      advice: [{ text: "z".repeat(50), cards: [hook] }],
    })!;
    expect(copy.verdict).toBe("x".repeat(40));
    expect(copy.dimensions.account_maturity).toBe("y".repeat(70));
    expect(copy.advice).toEqual(["z".repeat(50)]);
    expect(copy.cites?.["advice[0]"]).toEqual([hook]);
  });
});

describe("roast report legacy markdown rewrite", () => {
  it("turns v12 dimension tables into h4 score cards", () => {
    const legacy = `## sample-user — 82.90/100

**一句话结论**: 分数站得住，招牌却薄。

| 维度 | 得分 | 说明 |
|------|------|------|
| 账号成熟度 | 8/10 | 注册多年，合入稳定。 |
| 贡献质量 | 23.8/27 | 合进评分器和放槽家务。 |

**风险标记**
无。

**建议**
把归属规则写成公开规格。

给 ScriptForge 补可跑 demo。
`;
    const out = rewriteLegacyRoastMarkdown(legacy);
    expect(out).toContain("> **一句话结论**");
    expect(out).toContain("#### 账号成熟度 · 8/10");
    expect(out).toContain("#### 贡献质量 · 23.8/27");
    expect(out).toContain("### 风险标记");
    expect(out).toContain("### 建议");
    expect(out).toContain("- 把归属规则写成公开规格。");
    expect(out).toContain("- 给 ScriptForge 补可跑 demo。");
    expect(out).not.toMatch(/\|\s*维度\s*\|/);
  });
});

describe("roast v13 commit-contrast and metaphor bans", () => {
  const index = buildFactIndex(buildRoastPayload(scan as ScanResult, "zh"), scan as ScanResult);

  it("bans N-commits-却 outcome contrast and commits↔merged juxtaposition", () => {
    const a = checkTrivia(index, "roast_line.zh", "提交到了 100,方向是 agent harness,留下的合入却是导航过期状态。");
    expect(a.some((i) => /commits-却|outcome contrast/i.test(i.detail))).toBe(true);
    const b = checkTrivia(index, "advice[0]", "你有 93 个提交、合进 1 个 PR。把改动收成插件。");
    expect(b.some((i) => /commits↔merged|提交↔合入/i.test(i.detail))).toBe(true);
  });

  it("bans long English verbatim quotes", () => {
    const issues = checkTrivia(
      index,
      "findings[2].text",
      "描述却是 「AI-powered Novel-to-Screenplay Workspace for authors」。应意译。",
    );
    expect(issues.some((i) => /long English/i.test(i.detail))).toBe(true);
  });

  it("flags a distinctive metaphor used more than once across the report", () => {
    const copy = coerceCopy({
      ...goodCopy,
      verdict: "家务做得密。",
      findings: [
        { headline: "一", text: "又在评分器里做家务，把放槽修好。" + "证".repeat(50) },
        { headline: "二", text: "第三处还是家务：相位切换。" + "据".repeat(50) },
        goodCopy.findings[2],
      ],
    })!;
    const issues = validateCopy(index, copy, "zh");
    expect(issues.some((i) => i.kind === "repeat" && /家务/.test(i.detail))).toBe(true);
  });

  it("fitSlotLengths trims over-long findings to the slot max", () => {
    const copy = coerceCopy({
      ...goodCopy,
      findings: [
        { headline: "标题够长了", text: "甲。" + "这是填充句用来超过一百五十字限制的内容。".repeat(8) },
        goodCopy.findings[1],
        goodCopy.findings[2],
      ],
    })!;
    // coerce may already trim — force long text
    copy.findings[0].text = "这是一句用来撑长度的中文证据。".repeat(12);
    expect([...copy.findings[0].text].length).toBeGreaterThan(150);
    const fitted = fitSlotLengths(copy, "zh");
    expect([...fitted.findings[0].text].length).toBeLessThanOrEqual(150);
  });
});
