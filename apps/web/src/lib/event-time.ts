import type { Language } from "@/i18n/dictionaries";

/** Date and time of an instant on the clock of `timeZone`, with the zone's short name. */
export function formatEventTime(date: Date, timeZone: string, language: Language): string {
  return new Intl.DateTimeFormat(language === "id" ? "id-ID" : "en-GB", {
    timeZone,
    dateStyle: "full",
    timeStyle: "short",
    timeZoneName: "short",
  }).format(date);
}
