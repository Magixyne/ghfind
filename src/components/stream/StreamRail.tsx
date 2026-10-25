"use client";

import type { ReactNode } from "react";
import { BadgeCheck, Flame, Library, Megaphone, Sparkles, TrendingUp, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { topInterests } from "@/lib/stream/rank";
import { useStreamStore } from "@/lib/stream/store";
import type { StreamItem, StreamVoice } from "@/lib/stream/types";
import { FollowButton } from "./StreamDetail";
import { StreamAvatar, ScorePill } from "./StreamCard";
import { XMark } from "./StreamPost";

function RailSection({ title, icon: Icon, action, children }: { title: string; icon: typeof Flame; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-white/[0.02] p-3">
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-foreground">
        <Icon className="size-4 text-muted-foreground" aria-hidden />
        {title}
        {action ? <span className="ms-auto">{action}</span> : null}
      </h2>
      {children}
    </section>
  );
}

/** Desktop right rail: score CTA, learned interests, rising developers, editor's picks. */
export function StreamRail({ items, voices, onOpen, onFollowed }: { items: StreamItem[]; voices: StreamVoice[]; onOpen: (item: StreamItem) => void; onFollowed: (name: string) => void }) {
  const t = useTranslations("stream");
  const affinity = useStreamStore((state) => state.affinity);
  const resetInterests = useStreamStore((state) => state.resetInterests);
  const interests = topInterests(affinity);

  const developers = items
    .filter((item) => item.kind === "developer")
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 4);
  const picks = items.filter((item) => item.badge === "editor").slice(0, 4);

  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-2xl border border-orange-500/30 bg-orange-500/10 p-3">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-foreground">
          <Flame className="size-4 text-orange-300" aria-hidden />
          {t("railCtaTitle")}
        </h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("railCtaBody")}</p>
        <Button asChild size="sm" shape="pill" className="mt-2 w-full">
          <Link href="/" prefetch={false}>{t("railCtaButton")}</Link>
        </Button>
      </section>

      <RailSection
        title={t("railInterests")}
        icon={Sparkles}
        action={interests.length > 0 ? (
          <button type="button" onClick={resetInterests} className="inline-flex items-center gap-0.5 text-xs font-normal text-muted-foreground hover:text-foreground">
            <X className="size-3" aria-hidden />
            {t("railReset")}
          </button>
        ) : null}
      >
        {interests.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {interests.map((tag) => (
              <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground">#{tag}</span>
            ))}
          </div>
        ) : (
          <p className="text-xs leading-5 text-muted-foreground">{t("railInterestsEmpty")}</p>
        )}
      </RailSection>

      {voices.length > 0 ? (
        <RailSection title={t("railVoices")} icon={Megaphone}>
          <p className="-mt-1 mb-2 text-[11px] leading-4 text-muted-foreground">{t("railVoicesHint")}</p>
          <ul className="flex flex-col gap-2">
            {voices.map((voice) => {
              const latest = items.find((item) => item.kind === "post" && item.author.x?.handle === voice.handle);
              return (
                <li key={voice.handle} className="flex items-center gap-2">
                  <button type="button" disabled={!latest} onClick={() => latest && onOpen(latest)} className="flex min-w-0 flex-1 items-center gap-2 text-start">
                    <StreamAvatar src={voice.avatarUrl} name={voice.name} className="size-8" />
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="flex items-center gap-1 truncate text-sm font-semibold text-foreground">
                        <span className="truncate">{voice.name}</span>
                        {voice.verified ? <BadgeCheck className="size-3.5 shrink-0 fill-sky-500 text-background" aria-hidden /> : null}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{t(`xCategory.${voice.category}`)} · @{voice.handle}</span>
                    </span>
                  </button>
                  <a href={`https://x.com/${voice.handle}`} target="_blank" rel="noopener noreferrer" aria-label={`@${voice.handle}`} className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-border text-foreground hover:bg-white/[0.04]">
                    <XMark className="size-3" />
                  </a>
                </li>
              );
            })}
          </ul>
        </RailSection>
      ) : null}

      {developers.length > 0 ? (
        <RailSection title={t("railTopDevelopers")} icon={TrendingUp}>
          <ul className="flex flex-col gap-2">
            {developers.map((item) => (
              <li key={item.id} className="flex items-center gap-2">
                <button type="button" onClick={() => onOpen(item)} className="flex min-w-0 flex-1 items-center gap-2 text-start">
                  <StreamAvatar src={item.author.avatarUrl} name={item.author.name} className="size-8" />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-sm font-semibold text-foreground">{item.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{item.author.handle}</span>
                  </span>
                  <ScorePill item={item} />
                </button>
                <FollowButton authorId={item.author.id} name={item.author.name} onFollowed={onFollowed} />
              </li>
            ))}
          </ul>
        </RailSection>
      ) : null}

      {picks.length > 0 ? (
        <RailSection title={t("railEditor")} icon={Library}>
          <ol className="flex flex-col gap-2">
            {picks.map((item, index) => (
              <li key={item.id}>
                <button type="button" onClick={() => onOpen(item)} className="flex w-full items-start gap-2 text-start">
                  <span className="w-4 shrink-0 text-sm font-black tabular-nums text-amber-300">{index + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">{item.title}</span>
                    <span className="text-xs text-muted-foreground">{item.author.name}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </RailSection>
      ) : null}
    </div>
  );
}
