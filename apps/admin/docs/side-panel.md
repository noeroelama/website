# Side panel

## What it does

The navigation column on every staff page: logo and organisation name, the MENU list, and the
signed-in staff member with an account menu (Profile, Account, Emails, Log out). On screens
narrower than 1024 px it becomes a drawer opened from a top bar, closed by the backdrop, Escape,
or following a link.

## Where it lives

- Layout: `apps/admin/src/app/(panel)/layout.tsx` (all staff pages sit in the `(panel)` route group)
- Component: `apps/admin/src/components/admin-sidebar.tsx`; styles: `.admin-*` classes in
  `apps/admin/src/app/globals.css` (values come from the shared tokens, see
  [design tokens](../../../packages/ui/docs/design-tokens.md))
- Page gate: `requireAdminViewer` in `apps/admin/src/server/context.ts`, messages in
  `apps/admin/src/components/access-message.tsx`
- Menu entries and permissions: `apps/admin/src/navigation.ts`
- Logo: `apps/admin/public/icon.png` (placeholder until the PPIDK logo is supplied — replace the file,
  keep the name)
- Tests: `tests/unit/admin-navigation.test.ts`

## How to use it

Add a page to the menu by adding one entry to `ADMIN_NAVIGATION` (label, href, permission). Put the
page under `src/app/(panel)/` so it gets the panel, and gate its content in the page itself:

```tsx
export const instant = false;

export default async function Page() {
  // signed out → web sign-in; signed in without a staff role → restricted (403) page
  const viewer = await requireAdminViewer("/events", "events.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />; // no page permission
  // … check can(viewer.principal, …) for the data, then render
}
```

## Rules and assumptions

- The server decides which entries appear (`navigationFor`, using `canInSomeScope`); only label and
  href reach the browser. Hiding a link is not security: every page and action still checks
  `can()` with the resource.
- The layout always renders the page segment (in the prerendered fallback and after the session is
  known), otherwise Next.js cannot validate instant navigation ("instant-unrendered-segment"). So
  the layout is not the gate: each page calls `requireAdminViewer`, which redirects signed-out
  visitors to `WEB_URL/login?next=ADMIN_URL/<path>`, shows the restricted (403) page
  (`forbidden()`, `src/app/forbidden.tsx`) to signed-in accounts without any staff role, and returns
  `"no-access"` for staff without the page's permission. Staff whose member profile is not
  complete are sent to `WEB_URL/account/profile?next=ADMIN_URL/<path>` first, and their actions
  are refused (`packages/domain/docs/members.md`). A unit test checks that every menu entry has a
  page calling `requireAdminViewer` with the same href and permission.
- The name comes from the sign-in provider (Google); otherwise the email is shown.
- Profile, Account and Emails link to `/profile`, `/account` and `/emails`; those pages are built in
  later steps. Log out calls `DELETE /api/session`.
- Accessibility: skip link, `aria-current` on the active page, 44 px targets, visible focus,
  keyboard menu (arrows, Escape), reduced-motion respected.

## Configuration

`WEB_URL` and `ADMIN_URL` (for the sign-in redirect). Poppins is self-hosted at build time by
`next/font`. Change sizes such as `--sidebar-width` at the top of `globals.css`.
