import type { StreamItem, StreamKind } from "./types";
import type { XAccount, XPost, XTimeline } from "./x";

/**
 * Demo items for the /feed prototype when no live source answers (local dev
 * without D1/KV bindings). Fictional owners only, like lib/home-mocks.ts.
 */
type Seed = {
  kind: StreamKind;
  slug: string;
  title: [zh: string, en: string];
  summary: [zh: string, en: string];
  author: string;
  tags: string[];
  score?: number;
  scoreLabel?: string;
  days: number;
  quality: number;
  minutes?: number;
  sponsored?: boolean;
};

const SEEDS: Seed[] = [
  { kind: "project", slug: "demo/observatory", title: ["observatory", "observatory"], summary: ["让复杂生产系统一眼看懂：一条命令拉起链路追踪 + 指标面板。", "Make production systems legible: tracing and metrics in one command."], author: "demo", tags: ["observability", "developer-tools", "TypeScript"], score: 82, days: 2, quality: 0.82 },
  { kind: "developer", slug: "demo-maintainer", title: ["Demo Maintainer", "Demo Maintainer"], summary: ["Rust · 编译器 · 长期维护者", "Rust · compilers · long-term maintainer"], author: "demo-maintainer", tags: ["Rust", "compilers"], score: 91, scoreLabel: "god", days: 1, quality: 0.91 },
  { kind: "article", slug: "how-scores-work", title: ["我们如何给 GitHub 账号打分", "How we score GitHub accounts"], summary: ["从贡献深度到刷量识别：评分模型的每一个权重都公开在这里。", "From contribution depth to spam detection: every weight in the model, explained."], author: "ghfind", tags: ["methodology", "scoring"], days: 9, quality: 0.86, minutes: 7 },
  { kind: "talent", slug: "talent-ada", title: ["Ada L.", "Ada L."], summary: ["5 年 Infra 经验，主导过两个 2k★ 开源项目，正在看 AI Infra 机会。", "5 years of infra, led two 2k★ OSS projects, open to AI infra roles."], author: "ada-demo", tags: ["AI Infra", "Go", "Kubernetes"], score: 86, scoreLabel: "available", days: 3, quality: 0.84 },
  { kind: "project", slug: "sample/flowkit", title: ["flowkit", "flowkit"], summary: ["给小团队的可组合工作流：YAML 写流程，Git 管版本。", "Composable workflows for small teams: YAML flows, versioned in Git."], author: "sample", tags: ["workflow", "automation", "Go"], score: 74, days: 5, quality: 0.74 },
  { kind: "collection", slug: "agent-picks", title: ["本周 Agent 项目精选 10 个", "10 agent projects worth your weekend"], summary: ["从 MCP 工具到沙箱运行时，编辑逐个跑过的 10 个项目。", "From MCP tools to sandbox runtimes: ten projects our editors actually ran."], author: "ghfind", tags: ["agent", "projects"], days: 4, quality: 0.8, minutes: 5 },
  { kind: "developer", slug: "sample-builder", title: ["Sample Builder", "Sample Builder"], summary: ["TypeScript · 前端基建 · 本周进步 +12", "TypeScript · frontend infra · +12 this week"], author: "sample-builder", tags: ["TypeScript", "frontend"], score: 84, scoreLabel: "elite", days: 2, quality: 0.84 },
  { kind: "job", slug: "acme-ai-infra", title: ["AI Infra 工程师", "AI Infra Engineer"], summary: ["远程 · 全职 · 负责推理集群调度与成本优化。", "Remote · full-time · own inference scheduling and cost."], author: "Acme Labs", tags: ["AI Infra", "full_time"], scoreLabel: "40-70k", days: 1, quality: 0.6, sponsored: true },
  { kind: "project", slug: "fictional-owner-lathe/lathe", title: ["lathe", "lathe"], summary: ["本地夹具与布局检查的 CLI 生成器，10 秒出一套 e2e 骨架。", "A CLI that scaffolds local fixtures and layout checks in ten seconds."], author: "fictional-owner-lathe", tags: ["cli", "codegen", "testing"], score: 69, days: 12, quality: 0.69 },
  { kind: "talent", slug: "talent-kai", title: ["Kai W.", "Kai W."], summary: ["独立开发者，做过 3 个付费 SaaS，擅长从 0 到 1。", "Indie hacker, shipped 3 paid SaaS products, strong at zero-to-one."], author: "kai-demo", tags: ["Full-stack", "Next.js", "SaaS"], score: 79, days: 6, quality: 0.78 },
  { kind: "article", slug: "19000-accounts", title: ["我们给 19000 个 GitHub 账号打了分", "We scored 19,000 GitHub accounts"], summary: ["分数分布、语言偏好、刷量特征——数据里有很多反直觉的发现。", "Score distribution, languages, spam signals — the data has surprises."], author: "ghfind", tags: ["data", "scoring"], days: 20, quality: 0.88, minutes: 9 },
  { kind: "project", slug: "demo/sandboxd", title: ["sandboxd", "sandboxd"], summary: ["给 Agent 用的一次性沙箱，冷启动 80ms。", "Disposable sandboxes for agents with an 80ms cold start."], author: "demo", tags: ["agent", "sandbox", "Rust"], score: 88, days: 1, quality: 0.88 },
  { kind: "developer", slug: "npc-coder", title: ["NPC Coder", "NPC Coder"], summary: ["Python · 数据工程", "Python · data engineering"], author: "npc-coder", tags: ["Python", "data"], score: 58, scoreLabel: "npc", days: 3, quality: 0.58 },
  { kind: "collection", slug: "who-builds-dify", title: ["谁在构建 Dify？", "Who builds Dify?"], summary: ["拆解一个明星项目背后的贡献者网络。", "The contributor network behind a breakout project."], author: "ghfind", tags: ["developers", "agent"], days: 15, quality: 0.82, minutes: 6 },
  { kind: "job", slug: "nova-frontend", title: ["高级前端工程师", "Senior Frontend Engineer"], summary: ["上海 · 全职 · 设计系统与编辑器方向。", "Shanghai · full-time · design systems and editors."], author: "Nova Studio", tags: ["frontend", "full_time"], scoreLabel: "35-55k", days: 4, quality: 0.6, sponsored: true },
  { kind: "project", slug: "sample/mcp-lens", title: ["mcp-lens", "mcp-lens"], summary: ["抓包级 MCP 调试器，看清每一次工具调用。", "A packet-level MCP debugger: see every tool call."], author: "sample", tags: ["agent", "mcp", "developer-tools"], score: 80, days: 3, quality: 0.8 },
];

const DAY = 86_400_000;

export function seedStreamItems(lang: "zh" | "en", now: number): StreamItem[] {
  const pick = (pair: [string, string]) => (lang === "zh" ? pair[0] : pair[1]);
  return SEEDS.map((seed) => {
    const id = `${seed.kind}:demo:${seed.slug}`;
    const isPerson = seed.kind === "developer" || seed.kind === "talent";
    const login = isPerson ? seed.slug : seed.author;
    return {
      id,
      kind: seed.kind,
      title: pick(seed.title),
      summary: pick(seed.summary),
      body: null,
      author: {
        id: seed.kind === "job" ? `company:${seed.author}` : login,
        name: seed.kind === "job" ? seed.author : isPerson ? pick(seed.title) : seed.author,
        avatarUrl: seed.author === "ghfind" ? "/icon.svg" : null,
        handle: seed.kind === "job" ? null : `@${login}`,
      },
      coverUrl: null,
      tags: seed.tags,
      score: seed.score ?? null,
      scoreLabel: seed.scoreLabel ?? null,
      stats: [],
      href: "#",
      external: false,
      publishedAt: seed.kind === "article" || seed.kind === "collection" ? new Date(now - seed.days * DAY).toISOString() : null,
      readingMinutes: seed.minutes ?? null,
      sponsored: seed.sponsored ?? false,
      quality: seed.quality,
      heat: seed.quality * 0.6,
      counter: null,
      badge: seed.kind === "collection" ? "editor" : null,
      comments: null,
      extra: null,
    };
  });
}

/**
 * Demo X timeline for non-production deployments until the operator agent
 * pushes real posts. Every account and post is fictional (no real person is
 * quoted); the UI labels the set as demo data. One account links to the demo
 * developer above so the profile ↔ X linking is visible locally.
 */
export function seedXTimeline(now: number): XTimeline {
  const hours = (value: number) => new Date(now - value * 3_600_000).toISOString();
  const account = (handle: string, name: string, category: XAccount["category"], github: string | null = null, ghfind: XAccount["ghfind"] = null): XAccount => ({
    handle, name, category, github, talentId: null, verified: true, avatarUrl: null, note: null, ghfind, source: github ? "score" : "editorial",
  });
  let sequence = 0;
  const post = (handle: string, text: string, at: number, topics: string[], metrics: [number, number, number, number], extra: Partial<XPost> = {}): XPost => {
    sequence += 1;
    const id = `19000000000000${String(sequence).padStart(5, "0")}`;
    return {
      id, handle, text, createdAt: hours(at), url: `https://x.com/${handle}/status/${id}`, kind: "post",
      metrics: { likes: metrics[0], reposts: metrics[1], replies: metrics[2], views: metrics[3] },
      media: null, quote: null, topics, technical: 0.9, lang: /[\u4e00-\u9fff]/.test(text) ? "zh" : "en", ...extra,
    };
  };
  return {
    updatedAt: now,
    accounts: [
      account("demo_researcher", "Demo Researcher", "researcher"),
      account("demo_lab_cn", "示例 AI 实验室", "researcher"),
      account("demo_builder", "Demo Builder", "builder"),
      account("demo_founder_cn", "示例创始人", "builder"),
      account("demo_media", "Demo Tech Weekly", "media"),
      account("demo_media_cn", "示例科技观察", "media"),
      account("demo_maintainer", "Demo Maintainer", "developer", "demo-maintainer", { score: 91, tier: "god" }),
      account("demo_infra_dev", "Demo Infra Dev", "developer", "demo-infra-dev", { score: 86, tier: "elite" }),
    ],
    posts: [
      post("demo_researcher", "We trained a 1B model with half the tokens by filtering for code that compiles and passes its own tests. Data quality beats data quantity again — ablations and the filter script in the paper.", 2, ["LLM", "data quality"], [2400, 380, 120, 210000]),
      post("demo_lab_cn", "我们把长上下文评测从 128k 拉到 1M token 后发现：大多数模型的「找针」分数很好看，但在多跳推理上掉得很厉害。评测集和复现脚本已开源，欢迎拍砖。", 4, ["长上下文", "评测"], [1800, 420, 160, 150000]),
      post("demo_maintainer", "Shipped incremental parsing in our Rust compiler front-end today. Re-check of a 40k-line crate after a one-line edit went from 2.1s to 90ms. Write-up on how we kept the red-green tree cache coherent:", 6, ["Rust", "compilers"], [860, 140, 45, 64000], {
        quote: { author: "demo-maintainer", text: "Incremental parsing in practice: red-green trees, cache invalidation and what broke.", url: "https://example.com/incremental-parsing" },
      }),
      post("demo_builder", "Hard-won lesson from running agents in production: give them a sandbox that boots in <100ms and they stop trying to be clever with the host. Our failure rate dropped 60% after we moved every tool call into a disposable VM.", 8, ["agents", "infra"], [1500, 210, 98, 120000]),
      post("demo_founder_cn", "做开发者工具三年的一个体会：用户不会因为你的功能多而留下，只会因为「第一次 5 分钟就跑通」而留下。我们把安装步骤从 7 步砍到 1 条命令后，次周留存翻了一倍。", 10, ["开发者工具", "增长"], [960, 230, 88, 72000]),
      post("demo_infra_dev", "Postmortem from last week's outage is up. Root cause: a retry storm between two services that both had \"safe\" exponential backoff, just with the same jitter seed. Fix was one line; finding it took 9 hours.", 12, ["SRE", "distributed systems"], [740, 160, 52, 58000]),
      post("demo_media", "New issue: how three open-source inference engines handle KV-cache eviction under load, with benchmarks on the same hardware and the configs to reproduce.", 14, ["inference", "benchmarks"], [420, 90, 12, 38000]),
      post("demo_media_cn", "本周开源观察：一个只有 3 位维护者的向量数据库项目，Star 两周涨了 1.2 万。我们拆了它的代码和 issue 区，聊聊它为什么能火、以及接下来最可能踩的坑。", 16, ["开源", "数据库"], [530, 140, 40, 46000]),
      post("demo_researcher", "Reminder that a 2-point benchmark gain is often inside run-to-run noise. We re-ran 5 popular evals with 10 seeds each — the std dev is bigger than most reported improvements. Please report variance.", 20, ["evaluation", "ML research"], [3100, 640, 210, 260000]),
      post("demo_maintainer", "PSA for library authors: semver-major for a type-only change is fine. Your users' CI breaking on a minor bump is not.", 26, ["open source", "Rust"], [1200, 260, 130, 90000]),
      post("demo_lab_cn", "小模型也能做好工具调用：我们用 3B 模型 + 结构化解码，在内部函数调用基准上追平了 70B 基线，延迟降到 1/8。训练数据构造方法写在技术报告第 4 节。", 30, ["小模型", "工具调用"], [1350, 300, 76, 110000]),
      post("demo_builder", "Unpopular opinion: most teams don't need a vector DB on day one. Postgres + pgvector carried us to 40M embeddings before we felt any pain. Measure first.", 36, ["databases", "RAG"], [2100, 350, 290, 180000]),
      post("demo_infra_dev", "Wrote a tiny eBPF tool that attributes every TCP retransmit to the Kubernetes pod that caused it. Took our \"network is slow\" tickets from days to minutes. Open-sourcing it this week.", 44, ["eBPF", "Kubernetes"], [880, 190, 34, 61000]),
      post("demo_founder_cn", "招聘上的一个反直觉：我们最好的几位工程师，简历都很普通，但 GitHub 上都有一个维护了两年以上、没什么人用、却写得很认真的项目。", 52, ["招聘", "工程文化"], [1650, 410, 190, 130000]),
    ],
  };
}
