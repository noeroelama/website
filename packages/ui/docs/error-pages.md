# Error pages

## What it does

web, admin and shop show one shared, generic page for every common error: 401 (sign-in required),
403 (access denied), 404 (page not found) and 500 (something went wrong). The page never shows the
error message or stack trace. Next.js prints the full error in the **server terminal** together
with a short `digest`; the 500 page shows only that digest as "Reference" so a report from a user
can be matched to the server log line.

## Where it lives

- Component and copy: `packages/ui/src/error-page.tsx` (`ErrorPage`), styles `.ui-error-*` in
  `packages/ui/src/styles.css`
- Next.js files in each app (`apps/{web,admin,shop}/src/app/`):

  | File               | When it is shown                                       | Status |
  | ------------------ | ------------------------------------------------------ | ------ |
  | `not-found.tsx`    | Unknown URL, or a page calls `notFound()`              | 404    |
  | `unauthorized.tsx` | A page calls `unauthorized()` (from `next/navigation`) | 401    |
  | `forbidden.tsx`    | A page calls `forbidden()` (from `next/navigation`)    | 403    |
  | `error.tsx`        | A page throws (has a "Try again" button)               | 500    |
  | `global-error.tsx` | The root layout throws (loads its own styles and font) | 500    |

- Tests: `tests/security/error-pages.test.ts`, `tests/e2e/security.spec.ts`

## How to use it

Throw or call the Next.js function on the server; the matching page is shown automatically:

```tsx
import { forbidden, notFound } from "next/navigation";

if (!item) notFound();
if (!allowed) forbidden(); // the permission check itself still happens on the server
```

## Rules and assumptions

- Never pass `error.message`, `error.stack` or other error details to the page, and never
  `console.*` them in the browser. The security test fails if an error page does.
- Next.js already logs server errors (with the digest) in the server terminal; no extra logging
  is needed. In development (`next dev`) Next.js also shows its error overlay with details —
  production builds never do.
- Pages rendered with Partial Prerendering stream, so a `forbidden()`/`notFound()` called inside
  `<Suspense>` shows the page but keeps HTTP status 200.
- The gateway has no pages: it returns RFC 9457 problem JSON (`apps/gateway/src/http/problem.ts`).

## Configuration

`experimental.authInterrupts: true` in each app's `next.config.ts` enables `forbidden()` and
`unauthorized()`.
