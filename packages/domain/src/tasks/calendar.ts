import { z } from "zod";
import { safeText } from "@website/security/validation";
import type { Meeting } from "../meetings";
import type { LpjReport, Program } from "../programs";
import type { ZoomRequest } from "../zoom";

export type CalendarKind = "meeting" | "zoom" | "milestone" | "lpj" | "holiday";
export const CALENDAR_KIND_LABELS: Record<CalendarKind, string> = {
  meeting: "Meeting",
  zoom: "Zoom",
  milestone: "Milestone",
  lpj: "LPJ due",
  holiday: "Holiday",
};

export interface CalendarItem {
  readonly id: string;
  readonly kind: CalendarKind;
  readonly title: string;
  readonly start: Date | null;
  readonly end: Date | null;
  readonly day: string | null;
  readonly href: string | null;
  readonly warnings: readonly string[];
}

export const HolidayInputSchema = z
  .object({
    date: z.iso.date("Choose the date."),
    name: safeText(120).pipe(z.string().min(2, "Name the holiday.")),
  })
  .strict();
export type HolidayInput = z.infer<typeof HolidayInputSchema>;
export interface Holiday extends HolidayInput {
  readonly id: string;
}

const dayIn = (instant: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone }).format(instant);

export function calendarItems(input: {
  readonly meetings: readonly Meeting[];
  readonly zoom: readonly ZoomRequest[];
  readonly programs: readonly Program[];
  readonly lpj: readonly LpjReport[];
  readonly holidays: readonly Holiday[];
  readonly zoomCapacity: number;
}): CalendarItem[] {
  const holidayOn = new Map(input.holidays.map((h) => [h.date, h.name]));
  const holidayWarning = (start: Date, zone: string) => {
    const name = holidayOn.get(dayIn(start, zone));
    return name ? [`Holiday: ${name}`] : [];
  };
  const approved = input.zoom.filter((z) => z.status === "approved");
  const zoomFull = (m: Meeting) =>
    m.room.zoomRequestId === null &&
    approved.filter((o) => o.startsAt < m.endsAt && m.startsAt < o.endsAt).length >=
      input.zoomCapacity
      ? ["No Zoom licence is free at this time"]
      : [];
  return [
    ...input.meetings
      .filter((m) => !m.cancelledAt)
      .map((m) => ({
        id: `meeting:${m.id}`,
        kind: "meeting" as const,
        title: m.title,
        start: m.startsAt,
        end: m.endsAt,
        day: null,
        href: `/meetings/${m.id}`,
        warnings: [...holidayWarning(m.startsAt, m.timeZone), ...zoomFull(m)],
      })),
    ...input.zoom
      .filter((z) => z.status === "approved" || z.status === "pending")
      .map((z) => ({
        id: `zoom:${z.id}`,
        kind: "zoom" as const,
        title: z.status === "pending" ? `${z.topic} (waiting for approval)` : z.topic,
        start: z.startsAt,
        end: z.endsAt,
        day: null,
        href: "/zoom",
        warnings: holidayWarning(z.startsAt, z.timeZone),
      })),
    ...input.programs
      .filter((p) => p.status === "approved" || p.status === "running")
      .flatMap((p) =>
        p.milestones
          .filter((m) => m.dueOn !== null && m.completedAt === null)
          .map((m) => ({
            id: `milestone:${p.id}:${m.id}`,
            kind: "milestone" as const,
            title: `${p.name}: ${m.title}`,
            start: null,
            end: null,
            day: m.dueOn,
            href: `/programs/${p.id}`,
            warnings: [],
          })),
      ),
    ...input.lpj
      .filter((l) => l.status !== "approved")
      .map((l) => ({
        id: `lpj:${l.id}`,
        kind: "lpj" as const,
        title: `LPJ ${l.plan.name}`,
        start: null,
        end: null,
        day: l.dueOn,
        href: `/lpj/${l.id}`,
        warnings: [],
      })),
    ...input.holidays.map((h) => ({
      id: `holiday:${h.id}`,
      kind: "holiday" as const,
      title: h.name,
      start: null,
      end: null,
      day: h.date,
      href: null,
      warnings: [],
    })),
  ];
}

const escapeText = (text: string) =>
  text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const utcStamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
const dateStamp = (day: string) => day.replace(/-/g, "");
const nextDay = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const code = char.codePointAt(0) as number;
    const bytes = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (size + bytes > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function toIcs(
  items: readonly CalendarItem[],
  options: { name: string; baseUrl: string; now: Date },
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PPIDK Asia-Oseania//Calendar//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeText(options.name)}`,
  ];
  for (const item of items) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${item.id.replace(/[^A-Za-z0-9_.:-]/g, "_")}@ppidk`,
      `DTSTAMP:${utcStamp(options.now)}`,
    );
    if (item.day !== null) {
      lines.push(
        `DTSTART;VALUE=DATE:${dateStamp(item.day)}`,
        `DTEND;VALUE=DATE:${dateStamp(nextDay(item.day))}`,
      );
    } else {
      lines.push(`DTSTART:${utcStamp(item.start as Date)}`, `DTEND:${utcStamp(item.end as Date)}`);
    }
    lines.push(`SUMMARY:${escapeText(`[${CALENDAR_KIND_LABELS[item.kind]}] ${item.title}`)}`);
    if (item.warnings.length) lines.push(`DESCRIPTION:${escapeText(item.warnings.join("\n"))}`);
    if (item.href) lines.push(`URL:${options.baseUrl}${item.href}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
