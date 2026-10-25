import type { StreamItem, StreamKind } from "./types";

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
