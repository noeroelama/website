import type { Language } from "@/i18n/dictionaries";

/** Date and time of an instant on the clock of `timeZone`, with the zone's short name. */
export function formatEventTime(date: Date, timeZone: string, language: Language): string {
  // Explicit options instead of dateStyle/timeStyle: combining timeZoneName with
  // dateStyle/timeStyle throws `TypeError: Invalid option : option` in some engines
  // (observed on the Node 24 / V8 dev server). The explicit set below renders the
  // same full date + short time, with the zone abbreviation (e.g. WIB).
  return new Intl.DateTimeFormat(language === "id" ? "id-ID" : "en-GB", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

/** Date only, for the card meta line — always "November 5, 2025" order (user). */
export function formatEventDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

/** City only, as the card and detail meta show ("Jakarta, Indonesia" → "Jakarta"); a
 * marker in parentheses like "Jakarta (Webinar)" is a same-city stand-in, country is
 * dropped. (Moved here from the cards component so the detail hero reuses it.) */
export function cityOf(location: string): string {
  const city = location.split(",")[0] ?? "";
  return city
    .trim()
    .replace(/\s*\(.*\)\s*$/, "")
    .trim();
}

/** Clock range for the detail meta line, "6:00 PM - 10:00 PM" (design); when the event
 * ends on another day only the start time is shown. Always 12-hour en-US with AM/PM. */
export function formatEventTimeRange(
  startsAt: Date,
  endsAt: Date | null,
  timeZone: string,
): string {
  const time = (date: Date) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  return endsAt ? `${time(startsAt)} - ${time(endsAt)}` : time(startsAt);
}
