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

function offsetAt(instant: Date, timeZone: string): number {
  const p = wallParts(instant, timeZone);
  const asUtc = Date.UTC(+p["year"]!, +p["month"]! - 1, +p["day"]!, +p["hour"]!, +p["minute"]!);
  return asUtc - Math.floor(instant.getTime() / 60_000) * 60_000;
}

export function wallTimeToUtc(wallTime: string, timeZone: string): Date | null {
  const m = WALL.exec(wallTime);
  if (!m) return null;
  const guess = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  const first = guess - offsetAt(new Date(guess), timeZone);
  return new Date(guess - offsetAt(new Date(first), timeZone));
}

export function utcToWallTime(instant: Date, timeZone: string): string {
  const p = wallParts(instant, timeZone);
  return `${p["year"]}-${p["month"]}-${p["day"]}T${p["hour"]}:${p["minute"]}`;
}
