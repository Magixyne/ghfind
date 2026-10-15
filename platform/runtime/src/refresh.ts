import type { RuntimeSettings, Target } from "./router";
import { HTTPError } from "./security";

export type RefreshRequest = {
  sourceSha: string; imageBuildId: string; mode: "baseline"; writerEpoch: 1;
  offVersionId: string; baselineVersionId: string; actorId: string;
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function validateRefresh(value: unknown, env: RuntimeSettings, actorId: string, phase: "edge" | "actor"): asserts value is RefreshRequest {
  const d = value as RefreshRequest;
  if (!d || typeof d !== "object" || Array.isArray(d) ||
      Object.keys(d).sort().join(",") !== "actorId,baselineVersionId,imageBuildId,mode,offVersionId,sourceSha,writerEpoch" ||
      env.FEED_ENVIRONMENT !== "production" || env.FEED_MODE !== (phase === "edge" ? "baseline" : "off") ||
      !/^[a-f0-9]{40}$/.test(d.sourceSha) || d.sourceSha !== env.FEED_RELEASE_SHA ||
      !/^[a-f0-9]{64}$/.test(d.imageBuildId) || d.imageBuildId !== env.FEED_IMAGE_BUILD_ID ||
      d.mode !== "baseline" || d.writerEpoch !== 1 || env.FEED_WRITER_EPOCH !== "1" ||
      !uuid.test(d.offVersionId) || !uuid.test(d.baselineVersionId) || d.offVersionId === d.baselineVersionId ||
      env.WORKER_VERSION.id !== (phase === "edge" ? d.baselineVersionId : d.offVersionId) ||
      !/^[a-f0-9]{64}$/.test(d.actorId) || d.actorId !== actorId)
    throw new HTTPError(400, "invalid_refresh");
}
export type RefreshFailure = { kind: "refresh-rejected"; status: 400 | 409; code: "invalid_refresh" | "transition_in_progress" };
// Validation returns a typed envelope before the abort boundary. An abort cannot
// be a success receipt: only a subsequent exact metadata read proves propagation.
export function refreshActor(input: unknown, env: RuntimeSettings, target: Target, actorId: string,
  expectedActorId: string, service: "api" | "executor", busy: boolean, abort: () => void): RefreshFailure {
  try {
    validateRefresh(input, env, actorId, "actor");
    if (actorId !== expectedActorId || !(service === "api" ? ["api-0", "api-1"] : ["executor-0"]).includes(target))
      throw new HTTPError(400, "invalid_refresh");
    if (busy) throw new HTTPError(409, "transition_in_progress");
  } catch (error) {
    if (error instanceof HTTPError && (error.code === "invalid_refresh" || error.code === "transition_in_progress"))
      return { kind: "refresh-rejected", status: error.status as 400 | 409, code: error.code };
    throw error;
  }
  abort();
  throw new Error("refresh_outcome_unknown");
}
export function readRefreshFailure(value: unknown): never {
  const d = value as RefreshFailure;
  if (d && typeof d === "object" && Object.keys(d).sort().join(",") === "code,kind,status" && d.kind === "refresh-rejected" &&
      ((d.status === 400 && d.code === "invalid_refresh") || (d.status === 409 && d.code === "transition_in_progress")))
    throw new HTTPError(d.status, d.code);
  throw new HTTPError(503, "refresh_outcome_unknown");
}
