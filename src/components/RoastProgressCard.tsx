"use client";

import { TIER_KEY } from "@/lib/tier";
import type { Tier } from "@/lib/types";

const RING = 56;
const STROKE = 4;
const RADIUS = (RING - STROKE) / 2;
const CIRC = 2 * Math.PI * RADIUS;

export interface RoastProgressCardProps {
  /** Integer 0..100, already floored by the progress helper. */
  percent: number;
  title: string;
  stage: string;
  tier?: Tier | null;
  /** Two faint lines hinting at upcoming report text. */
  shimmer?: boolean;
  /** Stage name for assistive tech. Percent ticks are not announced. */
  liveStage?: string;
}

/**
 * Compact placeholder that occupies the roast report slot while copy generates.
 * The arc uses the same tier CSS variables as `.roast-report`.
 */
export function RoastProgressCard({
  percent,
  title,
  stage,
  tier,
  shimmer = true,
  liveStage,
}: RoastProgressCardProps) {
  const tone = tier ? TIER_KEY[tier] : "elite";
  const clamped = Math.min(100, Math.max(0, Math.floor(percent)));
  const dash = CIRC * (1 - clamped / 100);

  return (
    <div
      data-tier-tone={tone}
      data-roast-progress=""
      className="roast-report roast-progress-card flex min-h-[160px] max-h-[200px] w-full flex-col items-center gap-4 overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4 sm:max-h-none sm:flex-row sm:items-center sm:gap-5 sm:px-5"
      role="status"
    >
      <div className="relative size-14 shrink-0" aria-hidden>
        <svg width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`} className="-rotate-90">
          <circle
            cx={RING / 2}
            cy={RING / 2}
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE}
            className="text-foreground/15"
          />
          <circle
            cx={RING / 2}
            cy={RING / 2}
            r={RADIUS}
            fill="none"
            stroke="var(--roast-tier)"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${CIRC} ${CIRC}`}
            strokeDashoffset={dash}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums text-foreground">
          {clamped}
        </span>
      </div>
      <div className="min-w-0 flex-1 text-center sm:text-start">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-xs text-foreground/70">{stage}</p>
        <span className="sr-only" aria-live="polite">
          {liveStage ?? stage}
        </span>
        {shimmer ? (
          <div className="roast-progress-shimmer mx-auto mt-3 w-full max-w-sm space-y-2 sm:mx-0" aria-hidden>
            <div className="h-2 w-11/12 rounded-full bg-foreground/10" />
            <div className="h-2 w-8/12 rounded-full bg-foreground/10" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
