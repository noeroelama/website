# News (content)

## What it does

Staff write news on the admin **Article** page: save a draft, publish now, or schedule a publish
date. Visitors only ever see published articles whose publish date has passed. The rule is
applied when the page is read (`isPubliclyVisible`), so scheduled news goes live without a cron
job.

## Where it lives

- Rules and form schema: `packages/domain/src/content/index.ts` (`NewsInputSchema`,
  `publishState`, `slugify`, `normalizeTags`, `formatNewsDate`, `NEWS_CATEGORIES`)
- Rich-text allowlist: `packages/security/src/html.ts` (`sanitizeRichText`)
- Firestore: `packages/db/src/firestore/content.ts` (`content/{id}`, slug index
  `contentSlugs/{kind}_{slug}`)
- Admin actions: `apps/admin/src/server/news.ts`; page `apps/admin/src/app/(panel)/articles/`
  (list + form in `src/components/articles-page.tsx`, rows mapped in `articles-model.ts`);
  preview `/articles/[id]/preview`
- Shared article layout (public page and preview): `packages/ui/src/article-view.tsx`
- Tests: `tests/unit/content.test.ts`, `tests/unit/admin-articles.test.ts`,
  `tests/security/rich-text.test.ts`, `tests/integration/news.test.ts`

## Rules and assumptions

- Fields: title (3–200), URL slug (built from the title when empty, unique per kind), author,
  category (General, Academic, Community, Announcement, International), publish date (entered in
  the viewer's time zone, stored UTC), summary (≤ 500), up to 10 lower-case tags, featured image
  (preset `thumbnail`), body (rich text).
- Status: **Save draft** → `draft`; **Publish** → `published` (publish date = now when empty) or
  `scheduled` when the date is in the future. The row menu **Publish/Unpublish** works
  immediately (published now / back to draft).
- Permissions: `articles.read` to see the page, `articles.edit` to add, edit and delete,
  `articles.publish` to publish, schedule or unpublish (also when saving an already published
  article). Checked on the server by `createGuardedAction`; the page only hides buttons.
- Body HTML is sanitised on save **and** again on render. Allowed: paragraphs, headings, bold,
  italic, underline, strike, quotes, lists, links (http/https/mailto, `rel="noopener noreferrer"`),
  https images, code, dividers and text alignment. Inline images are uploaded first; the body
  never holds data URLs.
- Every change is one transaction with a version check and an audit entry (module `articles`):
  CREATE / UPDATE / PUBLISH / UNPUBLISH / DELETE. Delete is a soft delete and can be reverted
  for 14 days on the Audit Log page; an edit that changed the URL is not revertible.
- The admin list loads the 500 most recently changed articles and filters them in the browser.
- The public site (separate app) refreshes cached news within minutes (`cacheLife("minutes")`).

## Configuration

Firestore index `content (kind asc, updatedAt desc)` in
`infrastructure/firebase/firestore.indexes.json`. Image uploads need `FIREBASE_STORAGE_BUCKET`.
