"use client";

import { useSyncExternalStore } from "react";
import type { Language } from "@/i18n/dictionaries";
import { formatEventTime } from "@/lib/event-time";

const subscribe = () => () => undefined;
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * The same instant in the visitor's own time zone. Rendered only in the browser (the server
 * does not know the zone), and only when it differs from the event's zone.
 */
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
