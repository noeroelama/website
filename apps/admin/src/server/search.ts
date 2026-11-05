import "server-only";
import type { UserSummary } from "@website/db";
import type { Letter } from "@website/domain/documents";
import type { Meeting } from "@website/domain/meetings";
import type { Program } from "@website/domain/programs";
import {
  can,
  canInSomeScope,
  scopedChapterIds,
  scopedOrgUnitIds,
  type Principal,
} from "@website/permissions";
import { navigationFor } from "../navigation";
import { canSeeMeeting } from "./meetings";

export interface SearchResult {
  readonly group: "Menu" | "Letters" | "Programmes" | "Meetings" | "People";
  readonly label: string;
  readonly sub: string | null;
  readonly href: string;
}

/** Results per group. */
const LIMIT = 8;

/** True when `text` or one of its words starts with `q` (lower case). */
const startsWith = (text: string | null, q: string) =>
  text !== null && ` ${text.toLowerCase()}`.includes(` ${q}`);

/**
 * Global search (G4): menu pages from the permission-filtered navigation, then records from the
 * SAME queries and scope filters as their list pages (active period). The lists are already
 * bounded per period, so the prefix match runs on them; people use the account prefix index.
 */
export function createSearch(deps: {
  activePeriod: () => Promise<{ id: string } | null>;
  letters: (periodId: string, orgUnitIds: "all" | readonly string[]) => Promise<Letter[]>;
  programs: (periodId: string) => Promise<Program[]>;
  meetings: (periodId: string) => Promise<Meeting[]>;
  /** Accounts whose name or e-mail starts with the text. */
  people: (text: string) => Promise<UserSummary[]>;
}) {
  return async (principal: Principal, query: string): Promise<SearchResult[]> => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const menu = navigationFor(principal)
      .filter((item) => startsWith(item.label, q))
      .map((item) => ({ group: "Menu" as const, label: item.label, sub: null, href: item.href }));
    const period = await deps.activePeriod();
    const chapters = scopedChapterIds(principal, "users.read");
    const [letters, programs, meetings, people] = await Promise.all([
      period && canInSomeScope(principal, "letters.read")
        ? deps.letters(period.id, scopedOrgUnitIds(principal, "letters.read"))
        : [],
      period && canInSomeScope(principal, "programs.read") ? deps.programs(period.id) : [],
      period ? deps.meetings(period.id) : [],
      canInSomeScope(principal, "users.read") ? deps.people(q) : [],
    ]);
    return [
      ...menu,
      ...letters
        .filter((l) => startsWith(l.numberFormatted, q) || startsWith(l.subject, q))
        .slice(0, LIMIT)
        .map((l) => ({
          group: "Letters" as const,
          label: l.subject,
          sub: l.numberFormatted,
          href: "/letters",
        })),
      ...programs
        .filter(
          (p) =>
            can(principal, "programs.read", { orgUnitPath: p.orgUnitPath }) &&
            startsWith(p.name, q),
        )
        .slice(0, LIMIT)
        .map((p) => ({
          group: "Programmes" as const,
          label: p.name,
          sub: null,
          href: `/programs/${p.id}`,
        })),
      ...meetings
        .filter((m) => canSeeMeeting(principal, m) && startsWith(m.title, q))
        .slice(0, LIMIT)
        .map((m) => ({
          group: "Meetings" as const,
          label: m.title,
          sub: null,
          href: `/meetings/${m.id}`,
        })),
      ...people
        .filter(
          (p) => chapters === "all" || (p.chapterId !== null && chapters.includes(p.chapterId)),
        )
        .slice(0, LIMIT)
        .map((p) => ({
          group: "People" as const,
          label: p.name ?? p.email ?? p.uid,
          sub: p.name ? p.email : null,
          href: "/roles",
        })),
    ];
  };
}
