import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { applySignal, type StreamSignal } from "./rank";
import type { StreamAffinity, StreamEngagement, StreamItem, StreamLayout } from "./types";

/**
 * Viewer state for the /feed prototype, persisted to localStorage. Nothing
 * here reaches the server yet; when real counters land, `like`/`save`/`view`
 * become the write path and `engagementOf` reads the server totals instead of
 * the seeded baseline.
 *
 * `skipHydration` keeps the first client render identical to the server
 * render; StreamApp calls `persist.rehydrate()` after mount.
 */
type Flags = Record<string, true>;

export type StreamStore = {
  liked: Flags;
  saved: Flags;
  viewed: Flags;
  following: Flags;
  hidden: string[];
  affinity: StreamAffinity;
  layout: StreamLayout | null;
  /** Bumped by "refresh" so the ranking jitter reshuffles near-ties. */
  seed: number;
  toggleLike: (item: StreamItem) => boolean;
  toggleSave: (item: StreamItem) => boolean;
  toggleFollow: (authorId: string) => boolean;
  markViewed: (item: StreamItem) => void;
  signal: (item: StreamItem, signal: StreamSignal) => void;
  hide: (item: StreamItem) => void;
  unhide: (id: string) => void;
  setLayout: (layout: StreamLayout) => void;
  refresh: () => void;
  resetInterests: () => void;
};

const EMPTY_AFFINITY: StreamAffinity = { kinds: {}, tags: {} };
const VIEWED_LIMIT = 2_000;

function toggle(flags: Flags, id: string): [Flags, boolean] {
  const next = { ...flags };
  if (next[id]) {
    delete next[id];
    return [next, false];
  }
  next[id] = true;
  return [next, true];
}

export const useStreamStore = create<StreamStore>()(
  persist(
    (set, get) => ({
      liked: {},
      saved: {},
      viewed: {},
      following: {},
      hidden: [],
      affinity: EMPTY_AFFINITY,
      layout: null,
      seed: 0,
      toggleLike: (item) => {
        const [liked, on] = toggle(get().liked, item.id);
        set({ liked, affinity: on ? applySignal(get().affinity, item, "like") : get().affinity });
        return on;
      },
      toggleSave: (item) => {
        const [saved, on] = toggle(get().saved, item.id);
        set({ saved, affinity: on ? applySignal(get().affinity, item, "save") : get().affinity });
        return on;
      },
      toggleFollow: (authorId) => {
        const [following, on] = toggle(get().following, authorId);
        set({ following });
        return on;
      },
      markViewed: (item) => {
        const { viewed } = get();
        if (viewed[item.id]) return;
        const keys = Object.keys(viewed);
        const kept = keys.length >= VIEWED_LIMIT ? keys.slice(keys.length - VIEWED_LIMIT + 1) : keys;
        set({ viewed: { ...Object.fromEntries(kept.map((key) => [key, true as const])), [item.id]: true } });
      },
      signal: (item, signal) => set({ affinity: applySignal(get().affinity, item, signal) }),
      hide: (item) =>
        set({
          hidden: [...get().hidden.filter((id) => id !== item.id), item.id],
          affinity: applySignal(get().affinity, item, "hide"),
        }),
      unhide: (id) => set({ hidden: get().hidden.filter((value) => value !== id) }),
      setLayout: (layout) => set({ layout }),
      refresh: () => set({ seed: get().seed + 1 }),
      resetInterests: () => set({ affinity: EMPTY_AFFINITY, hidden: [] }),
    }),
    {
      name: "ghfind.stream.v1",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: ({ liked, saved, viewed, following, hidden, affinity, layout, seed }) => ({
        liked, saved, viewed, following, hidden, affinity, layout, seed,
      }),
    },
  ),
);

/** Seeded totals plus this viewer's own actions. */
export function engagementOf(
  item: StreamItem,
  mine: { liked: boolean; saved: boolean; viewed: boolean },
): StreamEngagement {
  return {
    views: item.baseline.views + (mine.viewed ? 1 : 0),
    likes: item.baseline.likes + (mine.liked ? 1 : 0),
    saves: item.baseline.saves + (mine.saved ? 1 : 0),
    comments: item.baseline.comments,
  };
}
