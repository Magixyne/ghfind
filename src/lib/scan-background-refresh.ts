import { after } from "next/server";
import { publishCompleteQuickScan } from "@/lib/db";
import { admitVisitRefresh, coalesceScan, tryAcquireScanRefresh } from "@/lib/redis";
import { buildScanResult, logFreshScanFailure } from "@/lib/scan-core";
import type { ScanResult } from "@/lib/types";
import {
  autoRefreshOnVisitEnabled,
  autoRefreshOnVisitMaxPerHour,
  isAutomatedVisitClient,
  snapshotStaleForVisitRefresh,
} from "@/lib/auto-refresh-on-visit";

class ScorePersistenceError extends Error {}

async function persistQuickScan(scan: ScanResult, scannedAt: number): Promise<boolean> {
  try {
    return Boolean(await publishCompleteQuickScan(scan, scannedAt));
  } catch {
    console.error("publishCompleteQuickScan failed");
    return false;
  }
}

async function produceFreshScan(username: string): Promise<ScanResult> {
  const scannedAt = Date.now();
  const quickScan = await buildScanResult(username);
  if (!(await persistQuickScan(quickScan, scannedAt))) throw new ScorePersistenceError();
  return Object.assign(quickScan, { scanned_at: scannedAt });
}

/** Score-only background refresh (no LLM). Single-flight via tryAcquireScanRefresh. */
export async function refreshScanInBackground(username: string): Promise<void> {
  if (!(await tryAcquireScanRefresh(username))) return;
  try {
    await coalesceScan(username, () => produceFreshScan(username), { background: true });
  } catch (error) {
    logFreshScanFailure(error, {
      route: "scan",
      username,
      persistenceFailure: error instanceof ScorePersistenceError,
    });
  }
}

export function scheduleBackgroundRefresh(username: string): void {
  after(() => refreshScanInBackground(username));
}

/**
 * When serving an already-indexed snapshot that is older than the scan-cache
 * window, optionally schedule a score-only background refresh. Always returns
 * immediately to the caller; never waits on GitHub.
 */
export function maybeScheduleVisitRefresh(input: {
  username: string;
  scannedAt: number | null | undefined;
  headers: Headers;
  /** Profile SSR document navigations: use the softer UA-only bot filter. */
  documentNavigate?: boolean;
}): void {
  if (!autoRefreshOnVisitEnabled()) return;
  if (
    isAutomatedVisitClient(input.headers, {
      documentNavigate: input.documentNavigate === true,
    })
  ) {
    return;
  }
  if (!snapshotStaleForVisitRefresh(input.scannedAt)) return;

  const username = input.username;
  const maxPerHour = autoRefreshOnVisitMaxPerHour();
  after(async () => {
    const admission = await admitVisitRefresh(username, maxPerHour);
    if (!admission.ok) {
      console.log("auto_refresh_on_visit", {
        outcome: "deferred",
        reason: admission.reason,
        username,
      });
      return;
    }
    console.log("auto_refresh_on_visit", { outcome: "started", username });
    await refreshScanInBackground(username);
  });
}
