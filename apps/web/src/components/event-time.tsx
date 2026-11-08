"use client";

import { useSyncExternalStore } from "react";
import type { Language } from "@/i18n/dictionaries";
import { formatEventTime } from "@/lib/event-time";

const subscribe = () => () => undefined;
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function ViewerTime(props: {
  iso: string;
  eventZone: string;
  label: string;
  language: Language;
}) {
  const zone = useSyncExternalStore(subscribe, browserZone, () => null);
  if (!zone || zone === props.eventZone) return null;
  return (
    <span className="site-muted">
      {" "}
      ({formatEventTime(new Date(props.iso), zone, props.language)}, {props.label})
    </span>
  );
}
