import type { ReactNode } from "react";
import { TIER_ZH } from "@/lib/badge";
import { tierStyle } from "@/lib/tier";
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
    glowSpread: string;
  }
> = {
  feed: {
    shell: "h-10 w-10",
    avatar: "h-8 w-8",
    initial: "text-sm",
    glowSpread: "18px -3px",
  },
  sm: {
    shell: "h-16 w-16",
    avatar: "h-12 w-12",
    initial: "text-xl",
    glowSpread: "28px -5px",
  },
  md: {
    shell: "h-24 w-24",
    avatar: "h-[72px] w-[72px]",
    initial: "text-3xl",
    glowSpread: "34px -6px",
  },
  lg: {
    shell: "h-28 w-28",
    avatar: "h-20 w-20",
    initial: "text-4xl",
    glowSpread: "34px -6px",
  },
};

function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Tier-tinted avatar shell. Ring + glow use {@link tierStyle}.hex so they always
 * match the score/tier label color (inline styles — no Tailwind purge risk).
 * Share/OG cards still draw frame icons via material-card /api/card.
 */
export function TierAvatarFrame({
  avatarContent,
  username,
  avatarUrl,
  tier,
  size = "md",
  className = "",
}: TierAvatarFrameProps) {
  const style = tierStyle(tier);
  const classes = SIZE_CLASS[size];
  const initial = username.slice(0, 1).toUpperCase();
  const ring = style.hex;
  const softBg = withAlpha(style.hex, 0.14);
  const glow = withAlpha(style.hex, size === "feed" ? 0.45 : 0.55);

  return (
    <div
      className={`relative flex shrink-0 items-center justify-center rounded-full ${classes.shell} ${className}`}
      style={{
        backgroundColor: softBg,
        boxShadow: `0 0 0 2px ${ring}, 0 0 ${classes.glowSpread} ${glow}`,
      }}
      aria-label={`${TIER_ZH[tier]} avatar frame`}
    >
      <div
        className={`absolute ${size === "feed" ? "inset-1" : "inset-2"} rounded-full`}
        style={{ boxShadow: `inset 0 0 0 1px ${withAlpha(style.hex, 0.35)}` }}
      />

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
