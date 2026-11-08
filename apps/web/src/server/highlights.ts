import "server-only";
import type { PublicEvent } from "@website/domain/events";
import { publicAnswerState, type Form } from "@website/domain/forms";
import { isRecruitmentOpen, type Recruitment } from "@website/domain/recruitment";

export interface Highlight {
  readonly kind: "recruitment" | "form" | "event";
  readonly title: string;
  readonly href: string;
  readonly at: Date | null;
}

const LIMIT = 3;

export function publicHighlights(
  input: {
    readonly recruitments: readonly Recruitment[];
    readonly forms: readonly Form[];
    readonly events: readonly PublicEvent[];
  },
  now: Date,
  limit = LIMIT,
): Highlight[] {
  return [
    ...input.recruitments
      .filter((r) => isRecruitmentOpen(r, now))
      .slice(0, limit)
      .map((r) => ({
        kind: "recruitment" as const,
        title: r.title,
        href: `/recruitment/${r.id}`,
        at: r.closesAt,
      })),
    ...input.forms
      .filter((f) => publicAnswerState(f, now) === "open")
      .slice(0, limit)
      .map((f) => ({
        kind: "form" as const,
        title: f.title,
        href: `/f/${f.publicToken as string}`,
        at: f.closesAt,
      })),
    ...input.events
      .filter((e) => e.startsAt >= now)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .slice(0, limit)
      .map((e) => ({
        kind: "event" as const,
        title: e.title,
        href: `/events/${e.slug}`,
        at: e.startsAt,
      })),
  ];
}
