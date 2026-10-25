"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Heart, MessageCircle, SquareArrowOutUpRight, UserCheck, UserPlus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { relatedItems } from "@/lib/stream/rank";
import { useStreamStore } from "@/lib/stream/store";
import type { StreamItem } from "@/lib/stream/types";
import { cn } from "@/lib/utils";
import { KIND_STYLE, compactNumber, relativeTime } from "./format";
import { StreamActions } from "./StreamActions";
import { KindBadge, ScorePill, StreamAvatar, StreamVisual, isTextTile, type StreamCardHandlers } from "./StreamCard";

const STAT_KEYS = new Set(["confidence", "community", "language", "lookups", "delta", "location", "project", "stars", "salary"]);

export function FollowButton({ authorId, name, onFollowed }: { authorId: string; name: string; onFollowed?: (name: string) => void }) {
  const t = useTranslations("stream");
  const following = useStreamStore((state) => Boolean(state.following[authorId]));
  const toggleFollow = useStreamStore((state) => state.toggleFollow);
  return (
    <Button
      type="button"
      size="sm"
      shape="pill"
      variant={following ? "outline" : "default"}
      onClick={(event) => {
        event.stopPropagation();
        if (toggleFollow(authorId)) onFollowed?.(name);
      }}
      className="h-7 shrink-0 px-3"
    >
      {following ? <UserCheck className="size-3.5" aria-hidden /> : <UserPlus className="size-3.5" aria-hidden />}
      {following ? t("following") : t("follow")}
    </Button>
  );
}

/**
 * Detail view. Full-screen on phones, a wide modal on desktop. The URL carries
 * `?item=<id>` (pushed by StreamApp), so Back closes it and links deep-link.
 * Related items swap in place, which keeps the reader inside the stream.
 */
export function StreamDetail({
  item,
  pool,
  now,
  handlers,
  onClose,
  onFollowed,
}: {
  item: StreamItem | null;
  pool: StreamItem[];
  now: number;
  handlers: StreamCardHandlers;
  onClose: () => void;
  onFollowed: (name: string) => void;
}) {
  const t = useTranslations("stream");
  const locale = useLocale();
  const toggleLike = useStreamStore((state) => state.toggleLike);
  const liked = useStreamStore((state) => (item ? Boolean(state.liked[item.id]) : false));
  const [burst, setBurst] = useState(0);
  const lastTap = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const onVisualTap = () => {
    if (!item) return;
    const at = Date.now();
    if (at - lastTap.current < 300) {
      if (!liked) toggleLike(item);
      setBurst((value) => value + 1);
      lastTap.current = 0;
    } else {
      lastTap.current = at;
    }
  };

  const related = item ? relatedItems(item, pool) : [];
  const style = item ? KIND_STYLE[item.kind] : null;
  const person = item?.kind === "developer" || item?.kind === "talent";

  return (
    <Dialog open={item != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        aria-describedby={undefined}
        className="inset-0 flex h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 p-0 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-[min(88dvh,820px)] sm:w-[min(calc(100vw-2rem),42rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border"
      >
        {item && style ? (
          <>
            <header className="flex items-center gap-2 border-b border-border px-3 py-2">
              <DialogClose asChild>
                <button type="button" aria-label={t("close")} className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
                  <ArrowLeft className="size-4" aria-hidden />
                </button>
              </DialogClose>
              <StreamAvatar src={item.author.avatarUrl} name={item.author.name} className="size-8" />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-sm font-semibold text-foreground">{item.author.name}</p>
                {item.author.handle ? <p className="truncate text-xs text-muted-foreground">{item.author.handle}</p> : null}
              </div>
              {item.kind !== "article" ? <FollowButton authorId={item.author.id} name={item.author.name} onFollowed={onFollowed} /> : null}
            </header>

            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div className="px-4 pb-4 pt-3">
                <div className="relative select-none" onClick={onVisualTap} title={t("doubleTapHint")}>
                  {isTextTile(item) ? null : <StreamVisual item={item} variant="detail" />}
                  <AnimatePresence>
                    {burst > 0 ? (
                      <motion.span
                        key={burst}
                        initial={{ scale: 0.3, opacity: 0 }}
                        animate={{ scale: [0.3, 1.2, 1], opacity: [0, 1, 1] }}
                        exit={{ scale: 1.4, opacity: 0 }}
                        transition={{ duration: 0.45 }}
                        onAnimationComplete={() => window.setTimeout(() => setBurst(0), 250)}
                        className="pointer-events-none absolute inset-0 flex items-center justify-center"
                      >
                        <Heart className="size-20 fill-rose-500 text-rose-500 drop-shadow-lg" aria-hidden />
                      </motion.span>
                    ) : null}
                  </AnimatePresence>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <KindBadge item={item} />
                  {item.sponsored ? <span>{t("sponsored")}</span> : null}
                  <span>{relativeTime(item.publishedAt, now, locale)}</span>
                  {item.readingMinutes ? <><span aria-hidden>·</span><span>{t("minutesRead", { minutes: item.readingMinutes })}</span></> : null}
                  <span aria-hidden>·</span>
                  <span>{t("views", { count: compactNumber(item.baseline.views, locale) })}</span>
                </div>

                <div className="mt-2 flex items-start justify-between gap-3">
                  <DialogTitle className="text-xl font-black leading-snug tracking-tight">{item.title}</DialogTitle>
                  {!person ? <ScorePill item={item} size="lg" /> : null}
                </div>
                {item.summary ? <DialogDescription className="mt-1.5 text-[15px] leading-6 text-foreground/85">{item.summary}</DialogDescription> : null}
                {item.body
                  ? item.body.split(/\n{2,}/).map((paragraph, index) => (
                      <p key={index} className="mt-2 text-sm leading-6 text-foreground/80">{paragraph}</p>
                    ))
                  : null}

                {item.stats.length > 0 ? (
                  <dl className="mt-3 grid grid-cols-3 gap-1.5">
                    {item.stats.map((stat) => (
                      <div key={stat.label} className="rounded-lg border border-border bg-white/[0.02] px-2.5 py-1.5">
                        <dt className="text-[11px] text-muted-foreground">{STAT_KEYS.has(stat.label) ? t(`stats.${stat.label}`) : stat.label}</dt>
                        <dd className="truncate text-sm font-semibold tabular-nums text-foreground">{stat.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}

                {item.tags.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {item.tags.map((tag) => (
                      <span key={tag} className={cn("rounded-md px-1.5 py-0.5 text-xs font-medium", style.tint, style.text)}>#{tag}</span>
                    ))}
                  </div>
                ) : null}

                <a
                  href={item.href}
                  target={item.external ? "_blank" : undefined}
                  rel={item.external ? "noopener noreferrer" : undefined}
                  className="mt-4 flex items-center justify-between rounded-xl border border-border px-3 py-2.5 text-sm font-semibold text-foreground hover:bg-white/[0.03]"
                >
                  {t("openOriginal")}
                  <SquareArrowOutUpRight className="size-4 text-muted-foreground" aria-hidden />
                </a>
                <a
                  href={item.href}
                  className="mt-1.5 flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  <MessageCircle className="size-3.5" aria-hidden />
                  {t("discussion")}
                </a>
              </div>

              {related.length > 0 ? (
                <section className="border-t border-border px-4 py-3">
                  <h4 className="text-sm font-bold text-foreground">{t("related")}</h4>
                  <ul className="mt-1 divide-y divide-border">
                    {related.map((entry) => (
                      <li key={entry.id}>
                        <button
                          type="button"
                          onClick={() => {
                            handlers.onOpen(entry);
                            scrollRef.current?.scrollTo({ top: 0 });
                          }}
                          className="flex w-full items-center gap-2.5 py-2 text-start"
                        >
                          <StreamAvatar src={entry.author.avatarUrl} name={entry.author.name} className="size-8" />
                          <span className="min-w-0 flex-1">
                            <span className="line-clamp-1 text-sm font-semibold text-foreground">{entry.title}</span>
                            <span className="line-clamp-1 text-xs text-muted-foreground">{entry.summary}</span>
                          </span>
                          <KindBadge item={entry} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>

            <footer className="border-t border-border px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              <StreamActions item={item} onComment={() => { if (item.external) window.open(item.href, "_blank", "noopener"); else window.location.assign(item.href); }} onShare={() => handlers.onShare(item)} />
            </footer>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
