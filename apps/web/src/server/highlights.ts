import "server-only";
import type { PublicEvent } from "@website/domain/events";
import { publicAnswerState, type Form } from "@website/domain/forms";
import { isRecruitmentOpen, type Recruitment } from "@website/domain/recruitment";

/** One item of the home panel (L1): what anyone may open, nothing internal. */
export interface Highlight {
  readonly kind: "recruitment" | "form" | "event";
  readonly title: string;
  readonly href: string;
  /** Closing time (recruitment, form) or start (event); null = none. */
  readonly at: Date | null;
}

/** At most this many per kind. */
const LIMIT = 3;

/**
 * The home highlights: open recruitments, public forms in their answer window and upcoming
 * published events. Its inputs are those three PUBLIC lists only, so meetings, Zoom bookings
 * and unit agendas can never reach it (tests/integration/highlights.test.ts).
 */
export function publicHighlights(
  input: {
    readonly recruitments: readonly Recruitment[];
    readonly forms: readonly Form[];
    readonly events: readonly PublicEvent[];
  },
  now: Date,
): Highlight[] {
  return [
    ...input.recruitments
      .filter((r) => isRecruitmentOpen(r, now))
      .slice(0, LIMIT)
      .map((r) => ({
        kind: "recruitment" as const,
        title: r.title,
        href: `/recruitment/${r.id}`,
        at: r.closesAt,
      })),
    ...input.forms
      .filter((f) => publicAnswerState(f, now) === "open")
      .slice(0, LIMIT)
      .map((f) => ({
        kind: "form" as const,
        title: f.title,
        href: `/f/${f.publicToken as string}`,
        at: f.closesAt,
      })),
    ...input.events
      .filter((e) => e.startsAt >= now)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .slice(0, LIMIT)
      .map((e) => ({
        kind: "event" as const,
        title: e.title,
        href: `/events/${e.slug}`,
        at: e.startsAt,
      })),
  ];
}
