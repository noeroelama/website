import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { SqlCalendarStore } from "@website/db/sql";
import type { Meeting } from "@website/domain/meetings";
import type { LpjReport, Program } from "@website/domain/programs";
import {
  calendarItems,
  HolidayInputSchema,
  toIcs,
  type CalendarItem,
  type HolidayInput,
} from "@website/domain/tasks";
import type { ZoomRequest, ZoomSettings } from "@website/domain/zoom";
import { can, canAccessAdmin, canInSomeScope, type Principal } from "@website/permissions";
import { safeId } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";
import { canSeeMeeting } from "./meetings";

const DAY = 86_400_000;

export interface CalendarDeps {
  readonly meetings: (from: Date, to: Date) => Promise<Meeting[]>;
  readonly zoom: (from: Date, to: Date) => Promise<ZoomRequest[]>;
  readonly zoomSettings: () => Promise<Pick<ZoomSettings, "licences" | "concurrentPerLicence">>;
  /** Programmes and LPJs of the active period. */
  readonly programs: () => Promise<Program[]>;
  readonly lpj: () => Promise<LpjReport[]>;
  readonly store: Pick<
    SqlCalendarStore,
    "listHolidays" | "saveHoliday" | "feedVersion" | "revokeFeed"
  >;
  /** The principal of a uid (feed requests have no session); null when unknown. */
  readonly principalOf: (uid: string) => Promise<Principal | null>;
  /** CALENDAR_FEED_SIGNING_SECRET; null = feeds are off. */
  readonly secret: string | null;
  readonly adminUrl: string;
  readonly now: () => Date;
}

/** What one person sees (the screen and the feed use this same filter). */
function visibleTo(
  principal: Principal,
  input: {
    meetings: Meeting[];
    zoom: ZoomRequest[];
    programs: Program[];
    lpj: LpjReport[];
  },
) {
  const uid = principal.userId;
  return {
    meetings: input.meetings.filter((m) => canSeeMeeting(principal, m)),
    zoom: input.zoom.filter(
      (z) => z.requestedBy === uid || can(principal, "zoom.read", { orgUnitPath: z.orgUnitPath }),
    ),
    programs: input.programs.filter(
      (p) =>
        p.pics.includes(uid) || can(principal, "programs.read", { orgUnitPath: p.orgUnitPath }),
    ),
    lpj: input.lpj.filter(
      (l) => l.pics.includes(uid) || can(principal, "lpj.read", { orgUnitPath: l.orgUnitPath }),
    ),
  };
}

const inRange = (item: CalendarItem, from: Date, to: Date) => {
  const fromDay = from.toISOString().slice(0, 10);
  const toDay = to.toISOString().slice(0, 10);
  return item.day !== null
    ? item.day >= fromDay && item.day <= toDay
    : (item.end as Date) > from && (item.start as Date) < to;
};

/** Calendar (G2): items per person, holidays, the signed .ics feed. */
export function createCalendar(deps: CalendarDeps) {
  async function items(principal: Principal, from: Date, to: Date): Promise<CalendarItem[]> {
    const [meetings, zoom, settings, programs, lpj, holidays] = await Promise.all([
      deps.meetings(from, to),
      // Bookings overlapping the range start up to a day before it.
      deps.zoom(new Date(from.getTime() - DAY), to),
      deps.zoomSettings(),
      deps.programs(),
      deps.lpj(),
      deps.store.listHolidays(),
    ]);
    const mine = visibleTo(principal, { meetings, zoom, programs, lpj });
    return calendarItems({
      ...mine,
      holidays,
      zoomCapacity: settings.licences * settings.concurrentPerLicence,
    })
      .filter((item) => inRange(item, from, to))
      .sort(
        (a, b) =>
          (a.day ?? (a.start as Date).toISOString()).localeCompare(
            b.day ?? (b.start as Date).toISOString(),
          ) || a.title.localeCompare(b.title),
      );
  }

  const sign = (uid: string, version: number) =>
    createHmac("sha256", deps.secret as string)
      .update(`calendar:${uid}:${version}`)
      .digest("base64url");

  /** The person's feed URL (null when feeds are off). */
  async function feedUrl(uid: string): Promise<string | null> {
    if (!deps.secret) return null;
    return `${deps.adminUrl}/calendar/${uid}.${sign(uid, await deps.store.feedVersion(uid))}.ics`;
  }

  const notFound = () =>
    new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

  /**
   * GET /calendar/<uid>.<signature>.ics: unknown, revoked (old version) or inactive → 404. The
   * same items as the screen: 30 days back to a year ahead.
   */
  async function feed(file: string): Promise<Response> {
    const match = /^([A-Za-z0-9_-]{1,128})\.([A-Za-z0-9_-]{43})\.ics$/.exec(file);
    if (!deps.secret || !match) return notFound();
    const [, uid, signature] = match as unknown as [string, string, string];
    const expected = Buffer.from(sign(uid, await deps.store.feedVersion(uid)));
    if (!timingSafeEqual(Buffer.from(signature), expected)) return notFound();
    const principal = await deps.principalOf(uid);
    if (
      !principal?.active ||
      !canAccessAdmin(principal) ||
      !canInSomeScope(principal, "calendar.read")
    ) {
      return notFound();
    }
    const now = deps.now();
    const list = await items(
      principal,
      new Date(now.getTime() - 30 * DAY),
      new Date(now.getTime() + 365 * DAY),
    );
    return new Response(toIcs(list, { name: "PPIDK Asia-Oseania", baseUrl: deps.adminUrl, now }), {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  /** Revokes my feed links (a new link replaces them). */
  const revokeFeed = createGuardedAction({
    permission: "calendar.read",
    inSomeScope: true,
    input: z.object({}).strict(),
    handler: async (_input, principal) => {
      await deps.store.revokeFeed(principal.userId, deps.now());
      return { url: await feedUrl(principal.userId) };
    },
  });

  const holidayAudit =
    (audit: AuditBuilder, action: "CREATE" | "DELETE", title: string, after: HolidayInput | null) =>
    (id: string) =>
      audit({
        module: "calendar",
        action,
        resourceType: "holiday",
        resourceId: id,
        title,
        before: null,
        after: after && { ...after },
        versionBefore: null,
        versionAfter: null,
        revertible: false,
      });

  const addHoliday = createGuardedAction({
    permission: "calendar.holidays",
    input: HolidayInputSchema,
    handler: async (input, _principal, audit) => ({
      id: await deps.store.saveHoliday(
        null,
        input,
        holidayAudit(audit, "CREATE", input.name, input),
      ),
    }),
  });

  const removeHoliday = createGuardedAction({
    permission: "calendar.holidays",
    input: z.object({ id: safeId }).strict(),
    handler: async ({ id }, _principal, audit) => ({
      id: await deps.store.saveHoliday(id, null, holidayAudit(audit, "DELETE", id, null)),
    }),
  });

  return { items, feedUrl, feed, revokeFeed, addHoliday, removeHoliday };
}
