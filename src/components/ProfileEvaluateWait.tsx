"use client";

import { LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export type EvaluatePhase = "fetch" | "analyze" | "roast" | "error" | "timeout";

const PHASE_ORDER: Array<Exclude<EvaluatePhase, "error" | "timeout">> = [
  "fetch",
  "analyze",
  "roast",
];

export function ProfileEvaluateWait({
  username,
  phase,
  stageLabel,
  stageLabels,
  percent,
  errorLabel,
  retryLabel,
  onRetry,
}: {
  username: string;
  phase: EvaluatePhase;
  /** Current status line under the spinner. */
  stageLabel: string;
  /** Chip labels for fetch / analyze / roast, in order. */
  stageLabels: [string, string, string];
  /** 0..100 display progress while scanning / waiting. */
  percent: number;
  errorLabel?: string;
  retryLabel?: string;
  onRetry?: () => void;
}) {
  const failed = phase === "error" || phase === "timeout";
  const clamped = Math.min(100, Math.max(0, Math.floor(percent)));
  const activeIdx =
    phase === "analyze" ? 1 : phase === "roast" ? 2 : 0;

  return (
    <main
      data-profile-evaluate={phase}
      className="relative isolate flex w-full flex-1 justify-center px-5 py-14 sm:py-20"
    >
      <div className="relative z-10 flex w-full max-w-4xl flex-col">
        <div className="h-4 w-24 rounded bg-white/5" aria-hidden />

        <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-start">
          <aside className="flex flex-col gap-4 lg:sticky lg:top-8 lg:w-80 lg:shrink-0">
            <div className="flex flex-col items-center rounded-2xl border border-white/10 bg-white/[0.05] p-6 text-center ring-1 ring-white/10">
              <div className="max-w-full truncate rounded-full bg-black/35 px-4 py-1.5 text-xl font-black text-zinc-100 ring-1 ring-white/10">
                @{username}
              </div>
              <Skeleton className="mt-5 size-24 rounded-full bg-white/10" />
              <Skeleton className="mt-5 h-12 w-28 rounded-xl bg-white/10" />
              <Skeleton className="mt-3 h-5 w-36 rounded-full bg-white/10" />
              <div className="mt-5 w-full space-y-2" aria-hidden>
                <Skeleton className="h-2 w-full rounded-full bg-white/10" />
                <Skeleton className="h-2 w-5/6 rounded-full bg-white/10" />
                <Skeleton className="mx-auto h-2 w-2/3 rounded-full bg-white/10" />
              </div>
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col gap-6">
            <section
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:p-7"
              role="status"
              aria-live="polite"
            >
              <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
                <div className="relative flex size-16 shrink-0 items-center justify-center">
                  {!failed ? (
                    <LoaderCircle
                      aria-hidden
                      className="size-10 text-orange-300/90 motion-safe:animate-spin motion-reduce:animate-none"
                    />
                  ) : (
                    <RefreshCw aria-hidden className="size-9 text-rose-300/90" />
                  )}
                </div>
                <div className="min-w-0 flex-1 text-center sm:text-start">
                  <p className="text-base font-semibold text-zinc-100">
                    {failed ? errorLabel : stageLabel}
                  </p>
                  {!failed ? (
                    <p className="mt-1 text-xs tabular-nums text-zinc-400">{clamped}%</p>
                  ) : null}
                  {!failed ? (
                    <ol className="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start">
                      {PHASE_ORDER.map((id, idx) => {
                        const done = idx < activeIdx;
                        const active = idx === activeIdx;
                        return (
                          <li
                            key={id}
                            data-phase={id}
                            data-active={active ? "1" : "0"}
                            className={`rounded-full px-2.5 py-1 text-[11px] ring-1 ${
                              active
                                ? "bg-orange-500/15 text-orange-100 ring-orange-400/35"
                                : done
                                  ? "bg-white/5 text-zinc-300 ring-white/10"
                                  : "bg-transparent text-zinc-500 ring-white/5"
                            }`}
                          >
                            {stageLabels[idx]}
                          </li>
                        );
                      })}
                    </ol>
                  ) : null}
                  {failed && onRetry && retryLabel ? (
                    <div className="mt-4 flex justify-center sm:justify-start">
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        shape="pill"
                        className="gap-1.5 bg-orange-600 text-white hover:bg-orange-500"
                        onClick={onRetry}
                      >
                        <RefreshCw aria-hidden className="size-3.5" />
                        {retryLabel}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
              {!failed ? (
                <div
                  className="roast-progress-shimmer mt-6 space-y-2 motion-reduce:[&_*]:animate-none"
                  aria-hidden
                >
                  <div className="h-2 w-11/12 rounded-full bg-foreground/10" />
                  <div className="h-2 w-9/12 rounded-full bg-foreground/10" />
                  <div className="h-2 w-7/12 rounded-full bg-foreground/10" />
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5" aria-hidden>
              <Skeleton className="h-4 w-40 bg-white/10" />
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <Skeleton className="h-16 rounded-xl bg-white/10" />
                <Skeleton className="h-16 rounded-xl bg-white/10" />
                <Skeleton className="h-16 rounded-xl bg-white/10" />
                <Skeleton className="h-16 rounded-xl bg-white/10" />
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
