"use client";

import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Profile / live / modal roast markdown with the v13l card layout:
 * - blockquote → highlighted 一句话结论 callout
 * - h4 "Name · score/max" → stacked dimension card header + progress bar
 *   (following <p> is the full-width note, styled via CSS sibling)
 * - ol/li with leading **title** → numbered finding + title chip
 * - ul → spaced advice bullets
 */
const DIM_SCORE_RE = /^(.+?)\s*[·•|]\s*([\d.]+)\s*\/\s*([\d.]+)\s*$/;

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && node && "props" in node) {
    return textOf((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

function splitLeadingStrong(children: ReactNode): { chip: ReactNode | null; rest: ReactNode } {
  const arr = Array.isArray(children) ? [...children] : [children];
  while (arr.length && (arr[0] == null || arr[0] === "" || arr[0] === "\n" || arr[0] === " ")) {
    arr.shift();
  }
  const first = arr[0];
  if (first && typeof first === "object" && "type" in first && (first as { type?: unknown }).type === "strong") {
    return {
      chip: (first as { props?: { children?: ReactNode } }).props?.children ?? null,
      rest: arr.slice(1),
    };
  }
  return { chip: null, rest: children };
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="mb-3 mt-1 text-xl font-black tracking-tight text-zinc-100">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-3 mt-0 border-b border-white/10 pb-2 text-base font-black text-zinc-100">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-6 text-sm font-bold tracking-wide text-zinc-200 first:mt-2">{children}</h3>
  ),
  h4: ({ children }) => {
    const raw = textOf(children).trim();
    const m = raw.match(DIM_SCORE_RE);
    if (m) {
      const score = Number(m[2]);
      const max = Number(m[3]);
      const pct = max > 0 ? Math.max(0, Math.min(100, (score / max) * 100)) : 0;
      return (
        <div className="roast-dim-head mt-3 rounded-t-xl border border-b-0 border-white/10 bg-white/[0.03] px-3.5 pb-0 pt-3.5 sm:px-4 sm:pt-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold tracking-tight text-zinc-100">{m[1].trim()}</span>
            <span className="shrink-0 font-mono text-xs tabular-nums text-orange-300/90">
              {Number.isInteger(score) ? score : score.toFixed(1)}/{max}
            </span>
          </div>
          <div
            className="roast-dim-bar mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${m[1].trim()} ${pct.toFixed(0)}%`}
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-orange-500/80 to-orange-400"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      );
    }
    return <h4 className="mb-1.5 mt-4 text-sm font-bold text-zinc-200">{children}</h4>;
  },
  p: ({ children }) => <p className="my-2.5 text-sm leading-relaxed text-zinc-300">{children}</p>,
  blockquote: ({ children }) => (
    <blockquote className="roast-verdict my-4 rounded-xl border border-orange-500/30 bg-orange-500/[0.08] px-4 py-3 text-sm leading-relaxed text-zinc-100 not-italic">
      {children}
    </blockquote>
  ),
  ul: ({ children }) => (
    <ul className="roast-advice my-3 list-disc space-y-2.5 pl-5 text-sm leading-relaxed text-zinc-300">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="roast-findings my-3 list-none space-y-3.5 pl-0 text-sm text-zinc-300">{children}</ol>
  ),
  li: ({ children }) => {
    const { chip, rest } = splitLeadingStrong(children);
    if (chip) {
      return (
        <li className="roast-finding rounded-xl border border-white/[0.08] bg-white/[0.02] px-3.5 py-3 sm:px-4">
          <div className="flex gap-3">
            <span className="roast-finding-num mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-500/20 text-xs font-bold text-orange-300" />
            <div className="min-w-0 flex-1">
              <span className="roast-finding-chip mb-1.5 inline-flex max-w-full items-center rounded-md border border-orange-500/25 bg-orange-500/10 px-2 py-0.5 text-[0.8rem] font-semibold text-orange-200">
                {chip}
              </span>
              <div className="mt-1 leading-relaxed text-zinc-300">{rest}</div>
            </div>
          </div>
        </li>
      );
    }
    return <li className="leading-relaxed">{children}</li>;
  },
  strong: ({ children }) => <strong className="font-semibold text-zinc-100">{children}</strong>,
  a: ({ children, href }) => (
    <a href={href} className="text-orange-300 hover:underline">
      {children}
    </a>
  ),
  code: ({ children, className }) =>
    className ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="break-all rounded bg-white/5 px-1 py-0.5 font-mono text-[0.85em] text-orange-200">
        {children}
      </code>
    ),
  table: ({ children }) => <table className="my-3 w-full border-collapse text-sm">{children}</table>,
  th: ({ children }) => (
    <th className="border-b border-white/15 px-2 py-1.5 text-left font-semibold text-zinc-200">{children}</th>
  ),
  td: ({ children }) => <td className="border-b border-white/5 px-2 py-1.5 text-zinc-300">{children}</td>,
  hr: () => <hr className="my-6 border-white/10" />,
};

export function RoastReport({ markdown, className = "" }: { markdown: string; className?: string }) {
  return (
    <div dir="ltr" className={`report roast-report text-[0.95rem] text-zinc-200 ${className}`.trim()}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
