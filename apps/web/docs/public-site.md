# Public site: frame, language (ID/EN), Home, About, Terms, Privacy

## What it does

Every public page has the same header (Home, News, Events, Gallery, Map, About, language switch,
Sign in) and footer (Terms and Conditions, Privacy). Visitors read the site in Indonesian by
default and can switch to English; the choice is kept in the `lang` cookie for a year. Home
explains the purpose of the site and shows the Google data notice; About, Terms and Privacy are
static pages.

## Where it lives

- Dictionaries: `src/i18n/dictionaries.ts` (`DICTIONARIES.id` / `.en`, `languageFrom`, `LEGAL_VERSION`).
- Rendering helper: `src/i18n/localized.tsx` (`<Localized render={(t, language) => …} />`).
- Frame: `src/components/site-frame.tsx` (header, footer, legal page), `language-switch.tsx`.
- Pages: `src/app/{page,about,terms,privacy}/…`, styles `src/app/globals.css`.
- Tests: `tests/unit/web-i18n.test.ts`, `tests/e2e/web.spec.ts`.

## How to use it

```tsx
export default function Page() {
  return <Localized render={(t) => <AppShell title={t.pages.news} />} />;
}
```

Add a text: add the key to `id` first (it defines the shape), then to `en` — TypeScript and the
completeness test fail until both exist.

## Rules and assumptions

- Partial Prerendering: the prerendered shell contains the Indonesian version (what crawlers and
  Google's OAuth review see); the cookie's language streams in at request time. Nothing personal
  is read in these components.
- `/` never redirects and always contains the purpose statement and the Google data notice.
- Content from Firestore (news, events) is shown in the language it was written in.
- `LEGAL_VERSION` is the "last updated" date of Terms and Privacy: change it with the text.
- `<html lang>` stays `id` (the root layout is static).

## Configuration

None.
