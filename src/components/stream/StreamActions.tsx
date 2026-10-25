"use client";

import { AnimatePresence, motion } from "motion/react";
import { Bookmark, Eye, Heart, MessageCircle, Share2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { engagementOf, useStreamStore } from "@/lib/stream/store";
import type { StreamItem } from "@/lib/stream/types";
import { cn } from "@/lib/utils";
import { compactNumber } from "./format";

/** Count that rolls up/down when it changes (likes, saves). */
function RollingCount({ value, locale }: { value: number; locale: string }) {
  return (
    <span className="relative inline-flex h-4 min-w-[2ch] overflow-hidden tabular-nums">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={value}
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -10, opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="leading-4"
        >
          {compactNumber(value, locale)}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function ActionButton({
  label,
  active,
  activeClass,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  activeClass?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        "group/action -mx-1.5 inline-flex items-center gap-1 rounded-full px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
        active && activeClass,
      )}
    >
      {children}
    </button>
  );
}

export function LikeIcon({ liked, className }: { liked: boolean; className?: string }) {
  return (
    <motion.span
      key={liked ? "on" : "off"}
      initial={liked ? { scale: 0.6 } : false}
      animate={{ scale: liked ? [0.6, 1.35, 1] : 1 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="inline-flex"
    >
      <Heart className={cn("size-4", liked && "fill-current", className)} aria-hidden />
    </motion.span>
  );
}

/**
 * Engagement row shared by list cards and the detail view: comments, likes,
 * saves, views, share. `compact` (masonry cards) shows only the like count.
 */
export function StreamActions({
  item,
  compact = false,
  onComment,
  onShare,
  className,
}: {
  item: StreamItem;
  compact?: boolean;
  onComment?: () => void;
  onShare: () => void;
  className?: string;
}) {
  const t = useTranslations("stream");
  const locale = useLocale();
  const liked = useStreamStore((state) => Boolean(state.liked[item.id]));
  const saved = useStreamStore((state) => Boolean(state.saved[item.id]));
  const viewed = useStreamStore((state) => Boolean(state.viewed[item.id]));
  const toggleLike = useStreamStore((state) => state.toggleLike);
  const toggleSave = useStreamStore((state) => state.toggleSave);
  const counts = engagementOf(item, { liked, saved, viewed });

  const like = (
    <ActionButton label={liked ? t("unlike") : t("like")} active={liked} activeClass="text-rose-500 hover:text-rose-500" onClick={() => toggleLike(item)}>
      <LikeIcon liked={liked} />
      <RollingCount value={counts.likes} locale={locale} />
    </ActionButton>
  );

  if (compact) return <div className={cn("flex items-center", className)}>{like}</div>;

  return (
    <div className={cn("flex items-center justify-between gap-2", className)}>
      <ActionButton label={t("comments")} onClick={() => onComment?.()}>
        <MessageCircle className="size-4" aria-hidden />
        <span className="tabular-nums">{compactNumber(counts.comments, locale)}</span>
      </ActionButton>
      {like}
      <ActionButton label={saved ? t("unsave") : t("save")} active={saved} activeClass="text-amber-400 hover:text-amber-400" onClick={() => toggleSave(item)}>
        <Bookmark className={cn("size-4", saved && "fill-current")} aria-hidden />
        <RollingCount value={counts.saves} locale={locale} />
      </ActionButton>
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={t("views", { count: counts.views })}>
        <Eye className="size-4" aria-hidden />
        <span className="tabular-nums">{compactNumber(counts.views, locale)}</span>
      </span>
      <ActionButton label={t("share")} onClick={onShare}>
        <Share2 className="size-4" aria-hidden />
      </ActionButton>
    </div>
  );
}
