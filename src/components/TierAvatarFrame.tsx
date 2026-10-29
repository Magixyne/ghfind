import type { ReactNode } from "react";
import { TIER_ZH } from "@/lib/badge";
import { tierAvatarFrame } from "@/lib/tier";
import type { Tier } from "@/lib/types";

type AvatarFrameSize = "feed" | "sm" | "md" | "lg";

interface TierAvatarFrameProps {
  avatarContent?: ReactNode;
  username: string;
  avatarUrl: string | null;
  tier: Tier;
  size?: AvatarFrameSize;
  className?: string;
}

const SIZE_CLASS: Record<
  AvatarFrameSize,
  {
    shell: string;
    avatar: string;
    initial: string;
  }
> = {
  feed: {
    shell: "h-10 w-10",
    avatar: "h-8 w-8",
    initial: "text-sm",
  },
  sm: {
    shell: "h-16 w-16",
    avatar: "h-12 w-12",
    initial: "text-xl",
  },
  md: {
    shell: "h-24 w-24",
    avatar: "h-[72px] w-[72px]",
    initial: "text-3xl",
  },
  lg: {
    shell: "h-28 w-28",
    avatar: "h-20 w-20",
    initial: "text-4xl",
  },
};

/**
 * Tier-tinted avatar shell (ring / glow). Decoration that used to sit on the
 * ring were removed from the live profile UI in favor of ImpactOrbit; share
 * cards still draw frame icons via material-card /api/card.
 */
export function TierAvatarFrame({
  avatarContent,
  username,
  avatarUrl,
  tier,
  size = "md",
  className = "",
}: TierAvatarFrameProps) {
  const frame = tierAvatarFrame(tier);
  const classes = SIZE_CLASS[size];
  const initial = username.slice(0, 1).toUpperCase();

  return (
    <div
      className={`relative flex shrink-0 items-center justify-center rounded-full ${classes.shell} ${frame.bg} ring-2 ${frame.ring} ${className}`}
      style={{ boxShadow: `var(--tw-ring-shadow, 0 0 #0000), 0 0 ${size === "feed" ? "18px -3px" : "34px -6px"} ${frame.glow}` }}
      aria-label={`${TIER_ZH[tier]} avatar frame`}
    >
      <div className={`absolute ${size === "feed" ? "inset-1" : "inset-2"} rounded-full border border-white/10`} />

      {avatarContent ? (
        <div className={`relative overflow-hidden rounded-full ring-2 ring-black/80 ${classes.avatar}`}>{avatarContent}</div>
      ) : avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt={username}
          className={`relative rounded-full object-cover ring-2 ring-black/80 ${classes.avatar}`}
        />
      ) : (
        <div
          className={`relative flex items-center justify-center rounded-full bg-white/10 font-black text-zinc-100 ring-2 ring-black/80 ${classes.avatar} ${classes.initial}`}
        >
          {initial}
        </div>
      )}
    </div>
  );
}
