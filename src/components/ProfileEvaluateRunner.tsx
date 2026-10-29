"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ProfileEvaluateWait,
  type EvaluatePhase,
} from "@/components/ProfileEvaluateWait";
import { Turnstile, turnstileEnabled } from "@/components/Turnstile";
import {
  takePendingEvaluate,
  writeSessionScan,
  type PendingEvaluateIntent,
} from "@/lib/home-handoff";
import { isRoastClientTimeout } from "@/lib/roast-client-timeout";
import {
  completedScanPayload,
  readScanResponse,
} from "@/lib/scan-job-client";
import type { ScanResult } from "@/lib/types";

/**
 * Homepage navigates here before the scan finishes. Runs /api/scan on the
 * profile route, surfaces a skeleton + stage spinner, then hands the scan up
 * so PendingProfile can render the live roast.
 */
export function ProfileEvaluateRunner({
  username,
  onReady,
}: {
  username: string;
  onReady: (scan: ScanResult) => void;
}) {
  const t = useTranslations("detail");
  const [phase, setPhase] = useState<EvaluatePhase>("fetch");
  const [percent, setPercent] = useState(4);
  const [token, setToken] = useState("");
  const [needVerify, setNeedVerify] = useState(false);
  const intentRef = useRef<PendingEvaluateIntent | null>(null);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const runId = useRef(0);

  useEffect(() => {
    alive.current = true;
    intentRef.current = takePendingEvaluate(username);
    return () => {
      alive.current = false;
    };
  }, [username]);

  useEffect(() => {
    if (phase === "error" || phase === "timeout") return;
    const id = window.setInterval(() => {
      setPercent((p) => {
        const cap = phase === "fetch" ? 38 : phase === "analyze" ? 72 : 92;
        if (p >= cap) return p;
        return Math.min(cap, p + (phase === "fetch" ? 2 : 1));
      });
    }, 700);
    return () => window.clearInterval(id);
  }, [phase]);

  const run = useCallback(
    async (turnstileOverride?: string) => {
      if (inFlight.current) return;
      const intent = intentRef.current;
      const turnstileToken =
        turnstileOverride || token || intent?.turnstileToken || "";
      if (turnstileEnabled() && !turnstileToken) {
        setNeedVerify(true);
        setPhase("error");
        return;
      }
      inFlight.current = true;
      const myRun = ++runId.current;
      setNeedVerify(false);
      setPhase("fetch");
      setPercent(6);
      try {
        const res = await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username,
            turnstileToken: turnstileToken || undefined,
            campaign: intent?.campaign ?? undefined,
          }),
        });
        if (!alive.current || myRun !== runId.current) return;
        setPhase("analyze");
        const data = await readScanResponse(res);
        if (!alive.current || myRun !== runId.current) return;
        if (!res.ok) {
          setPhase("error");
          return;
        }
        if (
          data &&
          typeof data === "object" &&
          "legacy_profile" in data &&
          (data as { legacy_profile?: unknown }).legacy_profile === true &&
          "username" in data &&
          typeof (data as { username?: unknown }).username === "string"
        ) {
          // Rare legacy redirect path: send the browser to the canonical handle.
          window.location.replace(
            `/u/${encodeURIComponent((data as { username: string }).username)}?roasting=1`,
          );
          return;
        }
        const scan =
          completedScanPayload(data) ??
          (data && typeof data === "object" && "metrics" in data
            ? (data as ScanResult)
            : null);
        if (!scan?.metrics || !scan.scoring) {
          setPhase("error");
          return;
        }
        writeSessionScan(scan.metrics.username, scan);
        setPhase("roast");
        setPercent(88);
        onReady(scan);
      } catch (error) {
        if (!alive.current || myRun !== runId.current) return;
        const code =
          error && typeof error === "object" && "code" in error
            ? String((error as { code?: unknown }).code ?? "")
            : "";
        const timedOut =
          isRoastClientTimeout(error) ||
          code === "scan_timeout" ||
          (error instanceof Error && /timeout/i.test(error.message));
        setPhase(timedOut ? "timeout" : "error");
      } finally {
        if (myRun === runId.current) inFlight.current = false;
      }
    },
    [username, token, onReady],
  );

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot mount kickoff
  }, []);

  // After the user solves Turnstile on the profile, continue automatically.
  useEffect(() => {
    if (!needVerify || !token) return;
    void run(token);
  }, [needVerify, token, run]);

  const retry = () => {
    setToken("");
    intentRef.current = {
      ...(intentRef.current ?? { startedAt: Date.now() }),
      turnstileToken: undefined,
      startedAt: Date.now(),
    };
    if (turnstileEnabled()) {
      setNeedVerify(true);
      setPhase("error");
      setPercent(0);
      return;
    }
    setPhase("fetch");
    setPercent(4);
    void run();
  };

  const stageLabels: [string, string, string] = [
    t("evaluateStageFetch"),
    t("evaluateStageAnalyze"),
    t("evaluateStageRoast"),
  ];
  const stageLabel =
    phase === "analyze"
      ? stageLabels[1]
      : phase === "roast"
        ? stageLabels[2]
        : stageLabels[0];

  return (
    <>
      <ProfileEvaluateWait
        username={username}
        phase={phase}
        stageLabel={stageLabel}
        stageLabels={stageLabels}
        percent={percent}
        errorLabel={
          phase === "timeout" ? t("evaluateTimeout") : t("evaluateError")
        }
        retryLabel={t("evaluateRetry")}
        onRetry={retry}
      />
      {needVerify ? (
        <div className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <div className="rounded-2xl border border-white/10 bg-zinc-950/95 p-4 shadow-xl">
            <Turnstile onToken={setToken} />
          </div>
        </div>
      ) : null}
    </>
  );
}
