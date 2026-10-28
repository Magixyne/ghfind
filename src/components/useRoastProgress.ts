"use client";

import { useEffect, useRef, useState } from "react";
import {
  ROAST_PROGRESS_COMPLETE_MS,
  ROAST_PROGRESS_FADE_MS,
  clearRoastStart,
  nextStageFloor,
  readRoastStart,
  rememberRoastStart,
  roastProgress,
  seedElapsedMs,
  stageFloorForLabel,
} from "@/lib/roast-progress";

export interface RoastProgressDriver {
  percent: number;
  stageIndex: number;
  /** Cross-fade the card out after the ring reaches 100%. */
  fading: boolean;
  /** Drop the card once the fade finishes. */
  hidden: boolean;
  noteThinking: (label: string) => void;
  markComplete: () => void;
  reset: () => void;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Drive the pseudo-progress ring. `active` means a roast request is in flight
 * (or already known to be running). A stored start time resumes the curve;
 * otherwise an in-flight job is seeded above 0%.
 */
export function useRoastProgress(
  active: boolean,
  username: string,
  lang: string,
  options?: { resume?: boolean },
): RoastProgressDriver {
  const startedAtRef = useRef<number | null>(null);
  const floorRef = useRef(0);
  const highPercentRef = useRef(0);
  const highStageRef = useRef(0);
  const completeAtRef = useRef<number | null>(null);
  const publishRef = useRef<(now: number) => void>(() => {});
  const reducedRef = useRef(false);
  const resume = options?.resume === true;
  const [percent, setPercent] = useState(0);
  const [stageIndex, setStageIndex] = useState(0);
  const [settled, setSettled] = useState(false);
  const [fading, setFading] = useState(false);
  const [hidden, setHidden] = useState(false);

  const publish = (now: number) => {
    const started = startedAtRef.current ?? now;
    const completeAt = completeAtRef.current;
    const next = roastProgress({
      elapsedMs: Math.max(0, now - started),
      complete: completeAt != null,
      completeElapsedMs: completeAt == null ? 0 : now - completeAt,
      stageFloor: floorRef.current,
      reducedMotion: reducedRef.current,
    });
    const shownPercent = Math.max(highPercentRef.current, next.percent);
    const shownStage = Math.max(highStageRef.current, next.stageIndex);
    highPercentRef.current = shownPercent;
    highStageRef.current = shownStage;
    setPercent(shownPercent);
    setStageIndex(shownStage);
    setSettled(next.settled || shownPercent >= 100);
  };

  useEffect(() => {
    publishRef.current = publish;
  });

  const markComplete = () => {
    if (completeAtRef.current != null) return;
    completeAtRef.current = Date.now();
    publishRef.current(Date.now());
    window.setTimeout(() => publishRef.current(Date.now()), ROAST_PROGRESS_COMPLETE_MS);
  };

  useEffect(() => {
    reducedRef.current = prefersReducedMotion();
    if (!active) return;
    const now = Date.now();
    if (startedAtRef.current == null) {
      const stored = readRoastStart(username, lang);
      if (stored != null && now - stored < 10 * 60_000 && now >= stored) {
        startedAtRef.current = stored;
      } else {
        // A brand-new request starts at 0. A resumed in-flight view with no
        // timestamp is seeded above 0 so the ring does not flash empty.
        const seeded = resume ? seedElapsedMs(null, now) : 0;
        startedAtRef.current = now - seeded;
      }
      rememberRoastStart(username, lang, startedAtRef.current);
    }
    publish(Date.now());
    const timer = window.setInterval(() => publish(Date.now()), reducedRef.current ? 800 : 200);
    return () => window.clearInterval(timer);
  }, [active, username, lang, resume]);

  useEffect(() => {
    if (!settled) return;
    const fade = window.setTimeout(() => setFading(true), 0);
    const hide = window.setTimeout(() => {
      setHidden(true);
      clearRoastStart(username, lang);
    }, ROAST_PROGRESS_FADE_MS);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(hide);
    };
  }, [settled, username, lang]);

  return {
    percent,
    stageIndex,
    fading,
    hidden,
    noteThinking(label: string) {
      floorRef.current = nextStageFloor(floorRef.current, stageFloorForLabel(label));
      publishRef.current(Date.now());
    },
    markComplete,
    reset() {
      const now = Date.now();
      // Re-anchor even when the ring is already active, so a retry starts over.
      startedAtRef.current = now;
      floorRef.current = 0;
      highPercentRef.current = 0;
      highStageRef.current = 0;
      completeAtRef.current = null;
      setFading(false);
      setHidden(false);
      setSettled(false);
      setPercent(0);
      setStageIndex(0);
      clearRoastStart(username, lang);
    },
  };
}
