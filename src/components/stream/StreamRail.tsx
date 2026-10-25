"use client";

import type { ReactNode } from "react";
import { Flame, Sparkles, TrendingUp, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { topInterests } from "@/lib/stream/rank";
import { useStreamStore } from "@/lib/stream/store";
import type { StreamItem } from "@/lib/stream/types";
import { compactNumber } from "./format";
import { FollowButton } from "./StreamDetail";
import { StreamAvatar, ScorePill } from "./StreamCard";

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

/** Desktop right rail: learned interests, rising developers, most read, score CTA. */
export function StreamRail({ items, onOpen, onFollowed }: { items: StreamItem[]; onOpen: (item: StreamItem) => void; onFollowed: (name: string) => void }) {
  const t = useTranslations("stream");
  const locale = useLocale();
  const affinity = useStreamStore((state) => state.affinity);
  const resetInterests = useStreamStore((state) => state.resetInterests);
  const interests = topInterests(affinity);

  const developers = items
    .filter((item) => item.kind === "developer")
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 4);
  const reads = items
    .filter((item) => item.kind === "article" || item.kind === "collection")
    .sort((a, b) => b.baseline.views - a.baseline.views)
    .slice(0, 4);

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

      {reads.length > 0 ? (
        <RailSection title={t("railTrending")} icon={Flame}>
          <ol className="flex flex-col gap-2">
            {reads.map((item, index) => (
              <li key={item.id}>
                <button type="button" onClick={() => onOpen(item)} className="flex w-full items-start gap-2 text-start">
                  <span className="w-4 shrink-0 text-sm font-black tabular-nums text-muted-foreground">{index + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">{item.title}</span>
                    <span className="text-xs text-muted-foreground">{t("views", { count: compactNumber(item.baseline.views, locale) })}</span>
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
