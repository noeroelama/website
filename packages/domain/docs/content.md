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
- Database: `packages/db/src/sql/content.ts` (`content/{id}`, slug index
  `contentSlugs/{kind}_{slug}`)
- Admin actions: `apps/admin/src/server/news.ts`; page `apps/admin/src/app/(panel)/articles/`
  (list + form in `src/components/articles-page.tsx`, rows mapped in `articles-model.ts`);
  preview `/articles/[id]/preview`
- Shared article layout (public page and preview): `packages/ui/src/article-view.tsx`
- Tests: `tests/unit/content.test.ts`, `tests/unit/admin-articles.test.ts`,
  `tests/security/rich-text.test.ts`, `tests/integration/news.test.ts`

## Rules and assumptions

- Fields: title (3–200), URL slug (unique per kind), author, category (Seminar, Workshop,
  Webinar, Conference, Meetup, Lainnya — the same activity types as the events/gallery pills;
  "Lainnya" (`other`) holds everything that is not one of the five), location ("Jakarta,
  Indonesia"; the public cards and the news Country filter read it — see
  `apps/web/docs/public-site.md`), publish date (entered in
  the viewer's time zone, stored UTC), summary (≤ 500), up to 10 lower-case tags, featured image
  (preset `thumbnail`), body (rich text). **Required** (also for drafts): title, URL, author,
  category, location, publish date, summary and featured image (`NewsInputSchema`; the form marks
  them with *).
- Admin page layout (Figma "ARTICLE ADMIN"): the list (tabs All/Published/Drafts, title search,
  filters, bulk Publish/Delete, row menu Publish or Make Private · Copy Link · Settings · Delete
  Article); the editor page holds only the featured image and the content boxes (Back · Preview ·
  Save draft · Publish); title, category, location, date, URL, summary and tags are edited in the
  **Settings** panel (row menu, or opened by Save draft/Publish when one of those fields is
  refused). The URL follows the title while it is still the title's slug. There is no Author
  field: a new article gets the staff member's name (else e-mail), an edit keeps its byline.
  The Author column shows that byline; Last Modified shows who made the newest audited change.
- Status: **Save draft** → `draft`; **Publish** → `published` (a past date) or `scheduled` when
  the date is in the future. The row menu **Publish / Make Private** works immediately
  (published now / back to draft).
- Permissions: `articles.read` to see the page, `articles.edit` to add, edit and delete,
  `articles.publish` to publish, schedule or unpublish (also when saving an already published
  article). Checked on the server by `createGuardedAction`; the page only hides buttons.
- Body HTML is sanitised on save **and** again on render. Allowed: paragraphs, headings, bold,
  italic, underline, strike, quotes, lists, links (http/https/mailto, `rel="noopener noreferrer"`),
  https images (plain http only from localhost/127.0.0.1, where local development serves uploads),
  code, dividers and text alignment. Inline images are uploaded first; the body never holds
  data URLs.
- The editor's content blocks are saved as one `<div>` per block (`joinBlocks`), and edit opens
  the same blocks again (`splitBlocks`, `apps/admin/src/components/ui/rich-text-box.tsx`; same
  for Newsletter and Letters). Bodies saved before that get one block per paragraph, heading,
  list …
- Every change is one transaction with a version check and an audit entry (module `articles`):
  CREATE / UPDATE / PUBLISH / UNPUBLISH / DELETE. Delete is a soft delete and can be reverted
  for 14 days on the Audit Log page; an edit that changed the URL is not revertible.
- The admin list loads the 500 most recently changed articles and filters them in the browser.
- Public site: `createSqlNewsReader` returns `PublicNews` DTOs (no id, version, status or
  chapter); `relatedNews` (same category or shared tag) still exists for tests, while the
  public article page links the 3 newest articles ("Recent News"). Pages:
  `apps/web/docs/public-site.md`. Cached for minutes.

## Configuration

Image uploads need `FILE_STORAGE_DIR`.
