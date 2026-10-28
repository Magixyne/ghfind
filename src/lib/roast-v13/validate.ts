/**
 * Deterministic checks for roast v13 copy: every number, repository and
 * per-repository star count the model writes is looked up in the payload the
 * model was given. The editor step receives these issues; the final pass drops
 * sentences that still cite facts absent from the data.
 */
import type { FactCard } from "./cards";
import { isTriviaTag } from "../roast-tags";
import { slotRange, SLOTS, type SlotName } from "./skill";
import { V13_CLICHE_PHRASES, V13_CLICHE_PHRASES_EN } from "./voice";

export interface V13Copy {
  title: string;
  roast_line: { zh: string; en: string };
  tags: { zh: string[]; en: string[] };
  verdict: string;
  findings: { headline: string; text: string }[];
  dimensions: Record<string, string>;
  risk: string;
  advice: string[];
  /** Fact-card ids each slot cites, keyed by field label (roast_line, verdict, findings[0], dimensions.x, advice[0]). */
  cites?: Record<string, string[]>;
}

export interface V13Issue {
  kind:
    | "number" | "repo" | "repo_stars" | "cliche" | "schema" | "language"
    | "quote" | "repeat" | "trivia" | "length" | "cite";
  field: string;
  detail: string;
}

export interface FactIndex {
  numbers: number[];
  repos: Map<string, number | null>;
  haystack: string;
  /** Normalized source texts a quote may come from (see checkQuotes). */
  sources: { bio: string; descriptions: string; all: string };
  /** Lifetime PRs + commits per repository, from impact_repos. */
  work: Map<string, number>;
  /** The account has substantial work somewhere (≥50 commits or ≥20 PRs in one repo). */
  hasMajorWork: boolean;
  followers: number;
}

const REPO_RE = /(?<![\w.-])([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})(?![\w-])/g;
const NUM_RE = /(?<![\w./-])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(k|K|万)?(?![\w/])/g;

function collectNumbers(value: unknown, out: number[]): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    out.push(value);
    return;
  }
  if (typeof value === "string") {
    for (const m of value.matchAll(/\d+(?:\.\d+)?/g)) out.push(Number(m[0]));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectNumbers(item, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectNumbers(v, out);
  }
}

function collectRepos(value: unknown, out: Map<string, number | null>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectRepos(item, out);
    return;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const name =
      (typeof obj.name_with_owner === "string" && obj.name_with_owner) ||
      (typeof obj.full_name === "string" && obj.full_name) ||
      (typeof obj.repo === "string" && obj.repo.includes("/") && obj.repo) ||
      null;
    const stars = typeof obj.stars === "number" ? Math.round(obj.stars) : null;
    if (name) {
      const key = name.toLowerCase();
      if (!out.has(key) || (out.get(key) === null && stars !== null)) out.set(key, stars);
    }
    for (const v of Object.values(obj)) collectRepos(v, out);
    return;
  }
  if (typeof value === "string") {
    for (const m of value.matchAll(REPO_RE)) {
      const key = `${m[1]}/${m[2]}`.toLowerCase();
      if (!out.has(key)) out.set(key, null);
    }
  }
}

/** Lowercase, NFKC, no whitespace/punctuation: the form quotes are compared in. */
export function normQuote(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

function collectStrings(value: unknown, out: string[], skip: Set<string> = new Set()): void {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out, skip);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) if (!skip.has(k)) collectStrings(v, out, skip);
  }
}

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const asArr = (v: unknown): Rec[] => (Array.isArray(v) ? v.map(asRec) : []);

/** Build the lookup index from the exact payload object sent to the models.
 * `source` (the raw scan, when available) is what quotes are checked against;
 * it defaults to the payload. */
export function buildFactIndex(payload: unknown, source?: unknown): FactIndex {
  const raw: number[] = [];
  collectNumbers(payload, raw);
  const set = new Set<number>();
  const ints: number[] = [];
  for (const n of raw) {
    set.add(n);
    set.add(Math.round(n));
    set.add(Math.round(n * 10) / 10);
    set.add(Math.round(n * 100) / 100);
    set.add(Math.floor(n));
    if (n > 0 && n <= 1) {
      set.add(Math.round(n * 100));
      set.add(Math.round(n * 1000) / 10);
      set.add(Math.floor(n * 100));
    }
    if (Number.isInteger(n) && n > 0 && n < 1e7) ints.push(n);
  }
  // Derived shares/differences between two payload integers ("1181 of 1191",
  // "87%"), bounded so huge payloads stay cheap.
  const uniq = [...new Set(ints)].slice(0, 400);
  for (const a of uniq) {
    for (const b of uniq) {
      if (a < b) {
        set.add(Math.round((a / b) * 100));
        set.add(Math.round((a / b) * 1000) / 10);
        set.add(b - a);
      } else if (a > b && a / b < 1000) {
        const ratio = a / b;
        set.add(Math.round(ratio));
        set.add(Math.round(ratio * 10) / 10);
      }
    }
  }
  const repos = new Map<string, number | null>();
  collectRepos(payload, repos);
  const src = asRec(source ?? payload);
  const p = asRec(payload);
  const metrics = { ...asRec(p.metrics), ...asRec(src.metrics) };
  const descTexts: string[] = [];
  for (const r of [...asArr(src.top_repos), ...asArr(src.pinned_repos), ...asArr(p.top_repos)]) {
    collectStrings([r.description, r.readme_excerpt, asRec(r.readme).excerpt, asRec(r.readme).text, r.topics], descTexts);
  }
  // Model-facing instructions (contracts, guardrails, notes) are not quotable data.
  const all: string[] = [];
  collectStrings(src, all, new Set(["score_contract", "context_notes", "factual_guardrails", "sha", "html_url", "path"]));
  const work = new Map<string, number>();
  let hasMajorWork = false;
  for (const r of asArr(p.impact_repos)) {
    if (typeof r.repo !== "string") continue;
    const prs = Number(r.prs) || 0;
    const commits = Number(r.commits) || 0;
    work.set(r.repo.toLowerCase(), prs + commits);
    if (commits >= 50 || prs >= 20) hasMajorWork = true;
  }
  return {
    numbers: [...set],
    repos,
    haystack: JSON.stringify(payload).toLowerCase(),
    sources: {
      bio: normQuote(typeof metrics.bio === "string" ? metrics.bio : ""),
      descriptions: normQuote(descTexts.join("\n")),
      all: normQuote(all.join("\n")),
    },
    work,
    hasMajorWork,
    followers: Number(metrics.followers) || 0,
  };
}

function numberKnown(index: FactIndex, n: number): boolean {
  if (n <= 3) return true;
  if (n >= 1990 && n <= 2035) return true; // years are checked loosely
  return index.numbers.some((v) => Math.abs(v - n) <= Math.max(1e-9, Math.abs(n) * 0.005));
}

function numberApprox(index: FactIndex, n: number): boolean {
  return index.numbers.some((v) => Math.abs(v - n) <= Math.abs(n) * 0.05);
}

/** Every user-visible text field, flattened with a stable field label. */
export function copyFields(copy: V13Copy): { field: string; text: string }[] {
  const out: { field: string; text: string }[] = [
    { field: "title", text: copy.title },
    { field: "roast_line.zh", text: copy.roast_line.zh },
    { field: "roast_line.en", text: copy.roast_line.en },
    { field: "verdict", text: copy.verdict },
    { field: "risk", text: copy.risk },
  ];
  copy.tags.zh.forEach((t, i) => out.push({ field: `tags.zh[${i}]`, text: t }));
  copy.tags.en.forEach((t, i) => out.push({ field: `tags.en[${i}]`, text: t }));
  copy.findings.forEach((f, i) => {
    out.push({ field: `findings[${i}].headline`, text: f.headline });
    out.push({ field: `findings[${i}].text`, text: f.text });
  });
  for (const [k, v] of Object.entries(copy.dimensions)) out.push({ field: `dimensions.${k}`, text: v });
  copy.advice.forEach((a, i) => out.push({ field: `advice[${i}]`, text: a }));
  return out.filter((f) => f.text);
}

/** Check one text against the payload index. */
export function checkText(index: FactIndex, field: string, text: string): V13Issue[] {
  const issues: V13Issue[] = [];
  const repoSpans: [number, number][] = [];
  for (const m of text.matchAll(REPO_RE)) {
    const name = `${m[1]}/${m[2]}`.replace(/[.,;:]+$/, "");
    const key = name.toLowerCase();
    repoSpans.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
    // Ratios like "44/55" are numbers, not repositories.
    if (/^\d+\/\d+$/.test(name)) continue;
    if (!index.repos.has(key) && !index.haystack.includes(key)) {
      issues.push({ kind: "repo", field, detail: `repository ${name} is not in the data` });
      continue;
    }
    const stars = index.repos.get(key);
    if (stars !== null && stars !== undefined) {
      const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 14);
      const before = text.slice(Math.max(0, (m.index ?? 0) - 10), m.index ?? 0);
      const near =
        after.match(/^[`)\s(（,，的]*(?:★\s*)?(\d[\d,.]*)\s*(k|K)?\s*(?:★|星|stars?)/) ??
        before.match(/(\d[\d,.]*)\s*(k|K)?\s*(?:★|星|stars?)\s*(?:的)?\s*[`(（]*$/);
      if (near) {
        let n = Number(near[1].replace(/,/g, ""));
        if (near[2]) n *= 1000;
        const tolerance = near[2] ? Math.max(1, stars * 0.06) : Math.max(1, stars * 0.01);
        if (Math.abs(n - stars) > tolerance) {
          issues.push({ kind: "repo_stars", field, detail: `${name} has ${stars} stars, text says ${near[0].trim()}` });
        }
      }
    }
  }
  const masked = repoSpans.reduceRight(
    (acc, [s, e]) => acc.slice(0, s) + " ".repeat(e - s) + acc.slice(e),
    text,
  );
  for (const m of masked.matchAll(NUM_RE)) {
    let n = Number(m[1].replace(/,/g, "") + (m[2] ? `.${m[2]}` : ""));
    if (m[3] === "k" || m[3] === "K") n *= 1000;
    if (m[3] === "万") n *= 10000;
    const ok = m[3] ? numberApprox(index, n) : numberKnown(index, n);
    if (!ok) issues.push({ kind: "number", field, detail: `number ${m[0].trim()} is not in the data` });
  }
  issues.push(...checkQuotes(index, field, text));
  return issues;
}

const QUOTE_RE = /[「『“"‘]([^「」『』“”"‘’]{1,200})[」』”"’]/g;
const DESC_WORD = /(项目简介|仓库简介|项目描述|仓库描述|描述|readme|自述|tagline|description|slogan|口号|标语)/i;
const BIO_WORD = /(简介|签名|自我介绍|个人介绍|个人说明|\bbio\b|profile)/i;
const CLAIM_RE =
  /(简介|签名|自我介绍|个人介绍|\bbio\b|描述|readme|自述|tagline|description|slogan|口号|标语)[^。！？!?；;]{0,8}?(写着|写的|写了|写|喊着|喊|说着|说|称|自称|挂着|挂|是|标着|立着|says|reads|claims|promises|calls|wants)/i;

/**
 * Quotes of the bio, a README, a repository description or a PR title must be
 * verbatim (after normalizing whitespace/punctuation/case) in the named source:
 * a sentence that names the bio must quote the bio, one that names a
 * description/README must quote a description/README, and any other quoted
 * span must exist somewhere in the scan data. A sentence that claims what the
 * bio/README/description "says" without quoting it is also an issue: those are
 * the paraphrases that turn into fabrications.
 */
export function checkQuotes(index: FactIndex, field: string, text: string): V13Issue[] {
  const issues: V13Issue[] = [];
  const matches = [...text.matchAll(QUOTE_RE)];
  const quotes = matches.map((m) => m[1]);
  const sentenceSource = DESC_WORD.test(text) ? "descriptions" : BIO_WORD.test(text) ? "bio" : "all";
  for (const m of matches) {
    const q = m[1];
    const n = normQuote(q);
    if (n.length < 2) continue;
    // The source a quote is attributed to is whatever is named just before it.
    const ctx = text.slice(Math.max(0, (m.index ?? 0) - 16), m.index ?? 0);
    const source = /(PR|标题|title)/i.test(ctx)
      ? "all"
      : DESC_WORD.test(ctx)
        ? "descriptions"
        : BIO_WORD.test(ctx)
          ? "bio"
          : matches.length === 1
            ? sentenceSource
            : "all";
    const pool = source === "bio" ? index.sources.bio : source === "descriptions" ? index.sources.descriptions : index.sources.all;
    if (!pool.includes(n)) {
      issues.push({ kind: "quote", field, detail: `quoted "${q}" is not verbatim in the ${source === "all" ? "scan data" : source}` });
    }
  }
  const source = sentenceSource;
  if (!quotes.length && CLAIM_RE.test(text)) {
    const bioEmpty = !index.sources.bio;
    const saysEmpty = /(空|没写|没有|未填|empty|blank)/i.test(text);
    if (!(source === "bio" && bioEmpty && saysEmpty)) {
      issues.push({ kind: "quote", field, detail: `claims what the ${source === "bio" ? "bio" : "README/description"} says without a verbatim quote` });
    }
  }
  return issues;
}

/** Wording bigrams: repository names and numbers are stripped, so restating a
 * fact in the table is fine and only reused phrasing counts. */
const wording = (text: string): string => normQuote(text.replace(REPO_RE, " ").replace(/\d+/g, " "));

function bigrams(text: string): Set<string> {
  const n = wording(text);
  const out = new Set<string>();
  for (let i = 0; i < n.length - 1; i++) out.add(n.slice(i, i + 2));
  return out;
}

/** Share of `a`'s character bigrams that also occur in `b` (0 when `a` is tiny). */
export function coverage(a: string, b: string): number {
  const A = bigrams(a);
  if (A.size < 6) return 0;
  const B = bigrams(b);
  let k = 0;
  for (const g of A) if (B.has(g)) k++;
  return k / A.size;
}

const SENTENCE_RE = /[^。！？!?；;]+[。！？!?；;]?/g;
const sentences = (text: string): string[] => text.match(SENTENCE_RE) ?? [text];

/** A field restates the one-liner when it covers half of it, or one of its
 * sentences (≥12 chars) is mostly the one-liner. */
export function repeatsRoastLine(roastLine: string, text: string): boolean {
  if (!roastLine || !text) return false;
  if (coverage(roastLine, text) >= 0.5) return true;
  return sentences(text).some((s) => wording(s).length >= 12 && coverage(s, roastLine) >= 0.7);
}

const FOLLOW_RE = /(粉丝|关注|followers?|following)/i;
const WINDOW_RE = /(近|最近|过去)\s*\d+\s*(天|日|周)|last\s+\d+\s+days/i;
/** Vague depth jab with no project named ("卡在厚度"). */
const THICKNESS_RE = /卡在厚度|没有厚度|厚度不够|差在厚度|缺厚度|少了厚度/;
/**
 * Tiny share of a large repo's merged-PR total ("1863 个已合并 PR 里你 7 个").
 * Captures yours ≤15 against a total ≥50 — substance lives in the main work,
 * not in a token slice of someone else's ledger.
 */
const SHARE_CONTRAST_RE = /(?:[5-9]\d|\d{3,})\s*个(?:已合并\s*)?PR\s*里\s*(?:你|TA|他|她|其)?\s*(?:只有\s*)?(?:[0-9]|1[0-5])\s*个|(?:only\s+)?(?:[0-9]|1[0-5])\s+(?:of\s+(?:the\s+)?)?(?:[5-9]\d|\d{3,})\s+(?:merged\s+)?PRs?\b/i;

/**
 * Trivia hooks the owner rejected: follower/following ratios, activity time
 * windows, vague "厚度", big-repo share-count contrasts, and a handful of
 * PRs/commits to a famous repository on an account that has real work
 * elsewhere. Dimension notes may still state follower counts; hooks may not.
 */
/** "只合了 1 个 PR" / "那个 PR" / "only one PR" in a one-liner. */
const PR_COUNT_RE = /(只|仅|就|才|那)(合进去?的?|合并的?|有|提了?|开了?)?(你|她|他)?\s*(那|一|1|两|2|三|3|几)?\s*个\s*PR|\bonly (one|two|three|a few|\d) (merged )?PRs?\b/i;

export function checkTrivia(index: FactIndex, field: string, text: string): V13Issue[] {
  const issues: V13Issue[] = [];
  // Tags: reject follower-ratio / time-window / thickness gotchas by name.
  if (field.startsWith("tags")) {
    if (isTriviaTag(text)) {
      issues.push({ kind: "trivia", field, detail: "tag names a trivial stat, not substance" });
    }
    return issues;
  }
  // The community row may state the follower count; nowhere else is it a point.
  if (FOLLOW_RE.test(text) && index.followers < 5000 && field !== "dimensions.community_influence") {
    issues.push({ kind: "trivia", field, detail: "follower/following counts are not a roast hook" });
  }
  if (WINDOW_RE.test(text)) issues.push({ kind: "trivia", field, detail: "activity time window is not a roast hook" });
  // Vague "厚度" as a roast jab — name the project/gap instead.
  if (THICKNESS_RE.test(text)) {
    issues.push({ kind: "trivia", field, detail: "vague '厚度' is not a roast hook; name the project or gap" });
  }
  // Big-repo share-count contrast ("1863 个已合并 PR 里你 7 个") — not a hook.
  if (SHARE_CONTRAST_RE.test(text) && !field.startsWith("dimensions.")) {
    issues.push({ kind: "trivia", field, detail: "a tiny share of a big repo's PR total is not a roast hook" });
  }
  if (/^(roast_line|title)/.test(field)) {
    if (PR_COUNT_RE.test(text)) issues.push({ kind: "trivia", field, detail: "a PR count is not a one-liner hook" });
    if (DESC_WORD.test(text) && [...text.matchAll(QUOTE_RE)].length > 0) {
      issues.push({ kind: "trivia", field, detail: "wordplay on a repository description is not a one-liner hook" });
    }
  }
  if (index.hasMajorWork) {
    const lower = text.toLowerCase();
    for (const [key, work] of index.work) {
      // Token touch to a famous repo (≤10 lifetime PRs+commits) is not a point.
      if ((index.repos.get(key) ?? 0) < 10_000 || work > 10) continue;
      const name = key.split("/")[1];
      // Full owner/repo, or the bare repo name as a standalone word.
      const bare = name.length >= 3 && new RegExp(`(^|[^a-z0-9_.-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9_-])`).test(lower);
      if (lower.includes(key) || bare) {
        issues.push({ kind: "trivia", field, detail: `a few PRs to famous ${key} is not a point when the account has real work elsewhere` });
      }
    }
  }
  return issues;
}

export function checkCliches(field: string, text: string, lang: "zh" | "en"): V13Issue[] {
  const list: readonly string[] = field.endsWith(".en") || lang === "en"
    ? [...V13_CLICHE_PHRASES_EN, ...(field.endsWith(".en") ? [] : V13_CLICHE_PHRASES)]
    : V13_CLICHE_PHRASES;
  const lower = text.toLowerCase();
  return list
    .filter((p) => lower.includes(p.toLowerCase()))
    .map((p) => ({ kind: "cliche" as const, field, detail: `cliché "${p}"` }));
}

export function validateCopy(index: FactIndex, copy: V13Copy, lang: "zh" | "en"): V13Issue[] {
  const issues: V13Issue[] = [];
  if (!copy.roast_line.zh) issues.push({ kind: "schema", field: "roast_line.zh", detail: "missing" });
  if (!copy.roast_line.en) issues.push({ kind: "schema", field: "roast_line.en", detail: "missing" });
  if (/[㐀-鿿]/.test(copy.roast_line.en)) {
    issues.push({ kind: "language", field: "roast_line.en", detail: "English roast line contains Chinese" });
  }
  if (copy.findings.length < 2) issues.push({ kind: "schema", field: "findings", detail: "need 3 findings" });
  for (const { field, text } of copyFields(copy)) {
    issues.push(...checkText(index, field, text), ...checkCliches(field, text, lang), ...checkTrivia(index, field, text));
    if (field !== "roast_line.zh" && field !== "roast_line.en" && !field.startsWith("tags") && field !== "title" &&
        repeatsRoastLine(copy.roast_line.zh, text)) {
      issues.push({ kind: "repeat", field, detail: "restates the one-liner; say something new here" });
    }
  }
  copy.findings.forEach((f, i) => {
    if (f.headline && copy.title && normQuote(f.headline) === normQuote(copy.title)) {
      issues.push({ kind: "repeat", field: `findings[${i}].headline`, detail: "repeats the title" });
    }
  });
  return issues;
}

/** Remove sentences that still cite a repo/number/star count absent from the
 * data after the editor pass. Returns the cleaned copy and what was dropped. */
export function dropUnverifiedSentences(
  index: FactIndex,
  copy: V13Copy,
): { copy: V13Copy; dropped: string[] } {
  const dropped: string[] = [];
  const roast = copy.roast_line.zh;
  const clean = (field: string, text: string): string => {
    if (!text) return text;
    const parts = sentences(text);
    const kept = parts.filter((s) => {
      const bad =
        s.includes(BAD_QUOTE) ||
        checkText(index, field, s).some((i) => i.kind !== "cliche") ||
        checkTrivia(index, field, s).some((i) => !/one-liner hook/.test(i.detail)) ||
        (/^(findings|dimensions|advice)/.test(field) && wording(s).length >= 12 && coverage(s, roast) >= 0.7);
      if (bad) dropped.push(`${field}: ${s.trim()}`);
      return !bad;
    });
    return kept.join("").trim();
  };
  const next: V13Copy = {
    ...copy,
    tags: {
      zh: copy.tags.zh.filter((t) => !isTriviaTag(t)),
      en: copy.tags.en.filter((t) => !isTriviaTag(t)),
    },
    verdict: clean("verdict", copy.verdict),
    risk: clean("risk", copy.risk),
    findings: copy.findings
      .map((f, i) => ({ f, i }))
      .filter(({ f, i }) => {
        const repeat = copy.findings.length > 1 && repeatsRoastLine(roast, f.text);
        if (repeat) dropped.push(`findings[${i}]: restates the one-liner`);
        return !repeat;
      })
      .map(({ f, i }) => ({
        i,
        headline: f.headline && copy.title && normQuote(f.headline) === normQuote(copy.title) ? "" : f.headline,
        text: clean(`findings[${i}].text`, f.text),
      }))
      .filter((f) => f.text),
    dimensions: Object.fromEntries(
      Object.entries(copy.dimensions).map(([k, v]) => [k, clean(`dimensions.${k}`, v)]),
    ),
    advice: [],
  };
  const advice = copy.advice.map((a, i) => ({ i, text: clean(`advice[${i}]`, a) })).filter((a) => a.text);
  next.advice = advice.map((a) => a.text);
  // Re-key citations to the surviving findings/advice.
  const findings = next.findings as unknown as { i: number; headline: string; text: string }[];
  if (copy.cites) {
    const cites: Record<string, string[]> = Object.fromEntries(
      Object.entries(copy.cites).filter(([k]) => !/^(findings|advice)\[/.test(k)),
    );
    findings.forEach((f, j) => (cites[`findings[${j}]`] = copy.cites![`findings[${f.i}]`] ?? []));
    advice.forEach((a, j) => (cites[`advice[${j}]`] = copy.cites![`advice[${a.i}]`] ?? []));
    next.cites = cites;
  }
  next.findings = findings.map(({ headline, text }) => ({ headline, text }));
  return { copy: next, dropped };
}

// ---------------------------------------------------------------------------
// Slotted copy: quote tokens, card citations and slot lengths.

const TOKEN_RE = /\{\{\s*q\s*:\s*(c\d+)(?:\s*#\s*(\d+))?\s*\}\}/g;
/** Marker for a token that named no card quote; its sentence is dropped. */
export const BAD_QUOTE = "\u2063BADQUOTE\u2063";

/** Replace {{q:cN}} / {{q:cN#k}} with the card's verbatim text in quotes. */
export function fillQuoteTokens(text: string, cards: FactCard[], lang: "zh" | "en"): string {
  if (!text) return text;
  const byId = new Map(cards.map((c) => [c.id, c]));
  const [open, close] = lang === "en" ? ["\u201c", "\u201d"] : ["「", "」"];
  return text.replace(TOKEN_RE, (_m, id: string, n?: string) => {
    const q = byId.get(id)?.quotes?.[n ? Number(n) - 1 : 0];
    return q ? `${open}${q.text}${close}` : BAD_QUOTE;
  });
}

export function fillCopyQuotes(copy: V13Copy, cards: FactCard[], lang: "zh" | "en"): V13Copy {
  const f = (t: string, l: "zh" | "en" = lang) => fillQuoteTokens(t, cards, l);
  return {
    ...copy,
    title: f(copy.title),
    roast_line: { zh: f(copy.roast_line.zh, "zh"), en: f(copy.roast_line.en, "en") },
    verdict: f(copy.verdict),
    risk: f(copy.risk),
    findings: copy.findings.map((x) => ({ headline: f(x.headline), text: f(x.text) })),
    dimensions: Object.fromEntries(Object.entries(copy.dimensions).map(([k, v]) => [k, f(v)])),
    advice: copy.advice.map((a) => f(a)),
  };
}

const charLen = (t: string) => [...t].length;

/** Slot lengths, card citations and distinct roast points. */
export function checkSlots(copy: V13Copy, cards: FactCard[], lang: "zh" | "en"): V13Issue[] {
  const issues: V13Issue[] = [];
  const byId = new Map(cards.map((c) => [c.id, c]));
  const cites = copy.cites ?? {};
  const len = (field: string, slot: SlotName, text: string, l: "zh" | "en" = lang) => {
    if (!text) return;
    const { min, max } = slotRange(slot, l);
    const n = charLen(text);
    if (n > max) issues.push({ kind: "length", field, detail: `${n} chars, slot allows ${min}-${max}; cut filler` });
    else if (n < min) issues.push({ kind: "length", field, detail: `${n} chars, slot needs ${min}-${max}; add evidence from the cards` });
  };
  const cite = (field: string, slot: SlotName) => {
    const ids = cites[field] ?? [];
    const known = ids.filter((id) => byId.has(id));
    if (ids.length > known.length) {
      issues.push({ kind: "cite", field, detail: `unknown card ids ${ids.filter((id) => !byId.has(id)).join(",")}` });
    }
    if (!known.length) issues.push({ kind: "cite", field, detail: "cite the card(s) this text rests on" });
    else if (SLOTS[slot].hook && !known.some((id) => byId.get(id)!.hook)) {
      issues.push({ kind: "trivia", field, detail: "rests only on context cards (followers, calendar, account age); use a hook card" });
    }
  };
  len("roast_line.zh", "roast_line", copy.roast_line.zh, "zh");
  cite("roast_line", "roast_line");
  len("title", "title", copy.title);
  len("verdict", "verdict", copy.verdict);
  cite("verdict", "verdict");
  const primaries = new Set<string>();
  copy.findings.forEach((f, i) => {
    len(`findings[${i}].headline`, "finding_headline", f.headline);
    len(`findings[${i}].text`, "finding", f.text);
    cite(`findings[${i}]`, "finding");
    const first = (cites[`findings[${i}]`] ?? [])[0];
    if (first && primaries.has(first)) {
      issues.push({ kind: "repeat", field: `findings[${i}]`, detail: `same main card ${first} as an earlier point; use another card` });
    }
    if (first) primaries.add(first);
  });
  for (const [k, v] of Object.entries(copy.dimensions)) {
    len(`dimensions.${k}`, "dimension", v);
  }
  copy.advice.forEach((a, i) => {
    len(`advice[${i}]`, "advice", a);
    cite(`advice[${i}]`, "advice");
  });
  return issues;
}
