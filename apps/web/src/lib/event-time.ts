import type { Language } from "../i18n/dictionaries";

export function formatEventTime(date: Date, timeZone: string, language: Language): string {
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

export function formatEventDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function cityOf(location: string): string {
  const city = location.split(",")[0] ?? "";
  return city
    .trim()
    .replace(/\s*\(.*\)\s*$/, "")
    .trim();
}

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
  const zone =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
      .formatToParts(startsAt)
      .find((part) => part.type === "timeZoneName")?.value ?? timeZone;
  const range = endsAt ? `${time(startsAt)} - ${time(endsAt)}` : time(startsAt);
  return `${range} (${zone})`;
}
