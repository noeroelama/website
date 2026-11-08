export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (first === undefined) return "?";
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  return (
    last === undefined ? first.slice(0, 2) : `${first[0] ?? ""}${last[0] ?? ""}`
  ).toUpperCase();
}

export function shortName(name: string): string {
  return name.length > 16 ? `${name.slice(0, 13)}...` : name;
}
