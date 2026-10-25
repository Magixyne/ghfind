import type { ComponentProps } from "react";
import { StreamApp } from "@/components/stream/StreamApp";
import { IslandRoot } from "./IslandRoot";
import type { WithIntl } from "./types";

export function StreamIsland({ intl, ...props }: WithIntl<ComponentProps<typeof StreamApp>>) {
  return <IslandRoot intl={intl}><StreamApp {...props} /></IslandRoot>;
}
