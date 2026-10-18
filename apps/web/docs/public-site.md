# Public site: frame, language (ID/EN), Home, News, About, Terms, Privacy

## What it does

Every public page has the same header (Home, News, Events, Gallery, Map, About, language switch,
Sign in) and footer (Terms and Conditions, Privacy). Visitors read the site in Indonesian by
default and can switch to English; the choice is kept in the `lang` cookie for a year. Home
explains the purpose of the site and shows the Google data notice; About, Terms and Privacy are
static pages. Home also lists the 3 latest news.

**News**: `/news` lists visible news as cards, newest first, filtered by category and tag
(`?category=academic&tag=riset&page=2`, 12 per page). `/news/[slug]` shows the article (shared
`ArticleView`, the same layout as the admin preview), its tags as links to the filtered list,
plain share links (no third-party scripts) and up to 3 related articles (same category or a
shared tag). Drafts, future and deleted articles are never shown; an unknown slug shows the 404 page (a soft 404: status 200 with `noindex`, because the
response is already streaming).
Old `/articles` links redirect to `/news`.

## Where it lives

- Dictionaries: `src/i18n/dictionaries.ts` (`DICTIONARIES.id` / `.en`, `languageFrom`, `LEGAL_VERSION`).
- Rendering helper: `src/i18n/localized.tsx` (`<Localized render={(t, language) => …} />`).
- Frame: `src/components/site-frame.tsx` (header, footer, legal page), `language-switch.tsx`.
- Pages: `src/app/{page,about,terms,privacy,news}/…`, styles `src/app/globals.css`.
- News: cached reads `src/server/news.ts` (`publicNews`, `publicNewsBySlug`), list query
  `src/lib/news-query.ts`, cards `src/components/news-cards.tsx`; rules in
  `packages/domain/docs/content.md`.
- Tests: `tests/unit/web-i18n.test.ts`, `tests/unit/web-news.test.ts`,
  `tests/integration/news.test.ts` (public reader), `tests/e2e/web.spec.ts`.

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
- News reads are cached for minutes (`cacheTag("news")`, `cacheLife("minutes")`): an admin change
  or a scheduled article shows up within a few minutes (admin is a separate app and cannot
  revalidate the web cache). The list holds the newest 300 visible articles.
- If the news read fails, Home logs `home_latest_news_failed` and leaves the section out.

## Configuration

None.
