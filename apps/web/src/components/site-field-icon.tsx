/** The design bar's field logos (datetime picker, location pin, search, count grid),
 * drawn as transparent stroke SVGs in the site's icon style; color comes from CSS
 * (cream on the panel for the labels, ink inside the boxes). Shared by the events,
 * gallery and news list pages. */
export const BAR_ICONS = {
  date: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
      <path d="M8 15h2M14 15h2M8 19h2M14 19h2" />
    </>
  ),
  region: (
    <>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.35-4.35" />
    </>
  ),
  /* Tag — the news list's category filter field. */
  tag: (
    <>
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3.4 13.4A2 2 0 0 1 3 12V5a2 2 0 0 1 2-2h7a2 2 0 0 1 1.4.6l7.2 7.2a2 2 0 0 1 0 2.8z" />
      <circle cx="7.5" cy="7.5" r="1" />
    </>
  ),
  /* Four squares (left-right, top-bottom) — the design's logo beside the counter,
     same glyph as the shared icon set's "grid". */
  count: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
} as const;

export function FieldIcon({
  name,
  className,
}: {
  name: keyof typeof BAR_ICONS;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {BAR_ICONS[name]}
    </svg>
  );
}
