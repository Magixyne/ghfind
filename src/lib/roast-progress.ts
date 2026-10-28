/**
 * Approximate roast progress while the report is still generating.
 *
 * p(t) = cap * (1 - exp(-t / τ)), then a slow creep once the curve saturates,
 * and a short ramp to 100% when the report arrives. The displayed percent is
 * floored and never decreases. Backend T-frames may only raise a stage floor.
 *
 * τ is chosen so 80% of the capped curve (p = 0.80 × 0.92) lands on the
 * estimated median generation time:
 *   0.80 = 1 - exp(-median / τ)
 *   τ = median / -ln(0.2)
 * Live generation is budgeted at GENERATION_ATTEMPT_MS = 95s with a 30s LLM
 * idle timeout. The low-effort path's first content is about 15–60s (see
 * src/lib/llm.ts). Median estimate: 28s → τ ≈ 17.4s.
 */

export const ROAST_PROGRESS_CAP = 0.92;
export const ROAST_PROGRESS_CREEP_MAX = 0.97;
/** Time constant for the exponential approach to the cap. */
export const ROAST_PROGRESS_TAU_MS = 17_400;
/** Hold at the cap this long before the slow creep toward 97%. */
export const ROAST_PROGRESS_CREEP_DELAY_MS = 8_000;
/** Creep from cap to 97% over this window, then stay. */
export const ROAST_PROGRESS_CREEP_WINDOW_MS = 40_000;
/** Animate the ring to 100% over this long once the roast arrives. */
export const ROAST_PROGRESS_COMPLETE_MS = 300;
/** Cross-fade from the card into the report after the ring hits 100%. */
export const ROAST_PROGRESS_FADE_MS = 250;

/** Stage lines advance with progress and never cycle backward. */
export const ROAST_PROGRESS_STAGE_COUNT = 5;

/**
 * Conservative floors for server T-frame labels. Matching a later stage only
 * raises progress; an earlier or unknown label never pulls it back.
 */
export const ROAST_STAGE_FLOORS = [
  { match: /读取|扫描|reading scan|reading the scan/i, floor: 0.08 },
  { match: /挑|事实|angles|sharpest|值得写/i, floor: 0.22 },
  { match: /起草|撰写|笑点|writing roast|writer/i, floor: 0.4 },
  { match: /核对|数字|仓库|fact-check|editor/i, floor: 0.62 },
  { match: /排版|收尾|polish|layout/i, floor: 0.78 },
] as const;

export interface RoastProgressInput {
  /** Milliseconds since generation started (already elapsed, including a resumed job). */
  elapsedMs: number;
  /** True once report text or roast meta is ready to reveal. */
  complete?: boolean;
  /** Milliseconds since `complete` flipped true. Ignored while incomplete. */
  completeElapsedMs?: number;
  /** Highest stage floor observed from T-frames, in 0..1. */
  stageFloor?: number;
  /** When true, the displayed percent moves in 5-point steps. */
  reducedMotion?: boolean;
}

export interface RoastProgressSnapshot {
  /** 0..1, monotonic in elapsed time for a fixed stage floor. */
  ratio: number;
  /** Integer percent, floored, 0..100. */
  percent: number;
  /** 0-based stage index. Advances with progress and completion; never decreases. */
  stageIndex: number;
  /** True once the complete animation has reached 100%. */
  settled: boolean;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Exponential approach to `cap`, before creep or completion. */
export function roastApproachRatio(elapsedMs: number, tauMs = ROAST_PROGRESS_TAU_MS): number {
  const t = Math.max(0, elapsedMs);
  const tau = tauMs > 0 ? tauMs : ROAST_PROGRESS_TAU_MS;
  return ROAST_PROGRESS_CAP * (1 - Math.exp(-t / tau));
}

/**
 * Running ratio: exponential curve, then a slow creep from the cap toward 97%
 * that stays there. Never exceeds the creep ceiling while incomplete.
 */
export function roastRunningRatio(elapsedMs: number, tauMs = ROAST_PROGRESS_TAU_MS): number {
  const approach = roastApproachRatio(elapsedMs, tauMs);
  const t = Math.max(0, elapsedMs);
  // Time when the curve is within ~0.5pt of the cap — creep starts after a pause.
  const nearCapMs = tauMs > 0 ? -tauMs * Math.log(0.005 / ROAST_PROGRESS_CAP) : 0;
  const creepStart = nearCapMs + ROAST_PROGRESS_CREEP_DELAY_MS;
  if (t <= creepStart) return approach;
  const creepT = Math.min(1, (t - creepStart) / ROAST_PROGRESS_CREEP_WINDOW_MS);
  const crept = ROAST_PROGRESS_CAP + (ROAST_PROGRESS_CREEP_MAX - ROAST_PROGRESS_CAP) * creepT;
  return Math.max(approach, Math.min(ROAST_PROGRESS_CREEP_MAX, crept));
}

/** Map a T-frame label to a forward-only floor. Unknown labels return 0. */
export function stageFloorForLabel(label: string): number {
  const text = label.trim();
  if (!text) return 0;
  let floor = 0;
  for (const stage of ROAST_STAGE_FLOORS) {
    if (stage.match.test(text)) floor = Math.max(floor, stage.floor);
  }
  return floor;
}

/** Merge a new stage signal without ever moving the floor backward. */
export function nextStageFloor(current: number, incoming: number): number {
  const base = Number.isFinite(current) ? current : 0;
  const next = Number.isFinite(incoming) ? incoming : 0;
  return clamp01(Math.max(base, next));
}

function stageIndexForRatio(ratio: number, complete: boolean): number {
  if (complete || ratio >= 0.78) return 4;
  if (ratio >= 0.58) return 3;
  if (ratio >= 0.38) return 2;
  if (ratio >= 0.18) return 1;
  return 0;
}

/**
 * Displayed progress. `stageFloor` can only raise the ratio. Completion eases
 * from the in-flight value to 1 over {@link ROAST_PROGRESS_COMPLETE_MS}.
 */
export function roastProgress(input: RoastProgressInput): RoastProgressSnapshot {
  const elapsedMs = Math.max(0, input.elapsedMs);
  const floor = clamp01(input.stageFloor ?? 0);
  const running = Math.max(roastRunningRatio(elapsedMs), floor);
  const complete = input.complete === true;
  let ratio = running;
  if (complete) {
    const dt = Math.max(0, input.completeElapsedMs ?? 0);
    const u = Math.min(1, dt / ROAST_PROGRESS_COMPLETE_MS);
    // Smoothstep so the last stretch does not jump.
    const eased = u * u * (3 - 2 * u);
    ratio = running + (1 - running) * eased;
  }
  ratio = clamp01(ratio);
  let percent = Math.floor(ratio * 100 + 1e-9);
  if (input.reducedMotion) {
    const done = complete && (input.completeElapsedMs ?? 0) >= ROAST_PROGRESS_COMPLETE_MS;
    percent = done ? 100 : Math.min(complete ? 100 : 97, Math.floor(percent / 5) * 5);
    ratio = percent / 100;
  }
  if (complete && (input.completeElapsedMs ?? 0) >= ROAST_PROGRESS_COMPLETE_MS) {
    ratio = 1;
    percent = 100;
  }
  percent = Math.min(100, Math.max(0, percent));
  return {
    ratio,
    percent,
    stageIndex: stageIndexForRatio(percent / 100, complete && percent >= 100),
    settled: complete && percent >= 100,
  };
}

/**
 * Seed a non-zero elapsed time when a roast is already in flight but this
 * view has no start timestamp — avoids flashing 0% on refresh.
 */
export function seedElapsedMs(startedAtMs: number | null | undefined, nowMs: number): number {
  if (startedAtMs == null || !Number.isFinite(startedAtMs)) return 4_000;
  const elapsed = nowMs - startedAtMs;
  if (!Number.isFinite(elapsed) || elapsed < 0) return 0;
  return elapsed;
}

const START_KEY_PREFIX = "ghfind:roast-progress:";

export function roastProgressStorageKey(username: string, lang: string): string {
  return `${START_KEY_PREFIX}${username.trim().toLowerCase()}:${lang}`;
}

/** Persist the moment generation started so a refresh can resume the curve. */
export function rememberRoastStart(username: string, lang: string, startedAtMs: number): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(roastProgressStorageKey(username, lang), String(Math.floor(startedAtMs)));
  } catch {
    /* private mode / quota */
  }
}

export function readRoastStart(username: string, lang: string): number | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(roastProgressStorageKey(username, lang));
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function clearRoastStart(username: string, lang: string): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(roastProgressStorageKey(username, lang));
  } catch {
    /* ignore */
  }
}
