/**
 * Date-times entered "as on the clock where the event happens" (a datetime-local value plus an
 * IANA zone) ↔ UTC. Intl only, no library; daylight saving time is handled by re-checking the
 * zone's offset at the computed instant.
 */
const WALL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function wallParts(instant: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds. */
function offsetAt(instant: Date, timeZone: string): number {
  const p = wallParts(instant, timeZone);
  const asUtc = Date.UTC(+p["year"]!, +p["month"]! - 1, +p["day"]!, +p["hour"]!, +p["minute"]!);
  return asUtc - Math.floor(instant.getTime() / 60_000) * 60_000;
}

/** "2026-11-20T11:00" in Asia/Tokyo → 2026-11-20T02:00Z. Null for an empty or invalid value. */
export function wallTimeToUtc(wallTime: string, timeZone: string): Date | null {
  const m = WALL.exec(wallTime);
  if (!m) return null;
  const guess = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  const first = guess - offsetAt(new Date(guess), timeZone);
  return new Date(guess - offsetAt(new Date(first), timeZone));
}

/** UTC instant → "YYYY-MM-DDTHH:MM" on the clock of `timeZone` (a datetime-local value). */
export function utcToWallTime(instant: Date, timeZone: string): string {
  const p = wallParts(instant, timeZone);
  return `${p["year"]}-${p["month"]}-${p["day"]}T${p["hour"]}:${p["minute"]}`;
}
