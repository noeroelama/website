# Public site: frame, language (ID/EN), Home, News, About, Terms, Privacy

## What it does

Every public page has the same dark header and footer (Figma design). Header: logo (links home),
About Us, Events, Gallery, News, Map; the current section is bold (`aria-current="page"`). Footer:
logo and tagline; Explore (Home … Map) and Services (E-Commerce = `SHOP_URL`, hidden when unset);
Our Community (five PPIs, linking to `/map`); address and social icons (new tab); copyright year,
Terms of Use, Privacy Policy. All labels come from the dictionaries, so they follow the page
language. The header has no language switch; on the right it streams a **Log in** chip for
signed-out visitors, or the signed-in member's account menu (Profile, Account, Log out). Visitors
read the site in Indonesian unless the `lang` cookie says `en` (kept for a year). Home
keeps the purpose statement, the newsletter sign-up and the Google data notice (Google's OAuth
review fetches "/" as a guest) around the design sections; About, Terms and Privacy are
static pages. Home also lists the 3 latest news and a **highlights panel** (L1,
`src/server/highlights.ts`): up to 3 open recruitments, 3 public forms in their answer window and 3
upcoming published events. Its only inputs are those three public lists, so meetings, Zoom bookings
and unit agendas can never appear (`tests/integration/highlights.test.ts`). **Activities**
(`/activities`, M4, linked from the panel and the footer) is the same read model
(`src/components/highlights.tsx`) without the limit of 3.

**News**: `/news` lists visible news as cards, newest first, filtered by the category pills
(Semua · Umum · Akademik · Komunitas · Pengumuman · Internasional, over the news `category`
field), search, tag and time (`?category=academic&tag=riset&q=riset&time=month&page=2`, 12 per
page); the card meta is "date · category". `/news/[slug]` is the article
page (user): the same black page and 74rem column as the list, a "← Back to Blog & Articles"
link, the headline, the card meta line, the banner, the body, and a "Recent News" row of the 3
newest other articles (3-up cards, the list's black-page card styles; no share links or tag
chips). Drafts, future and deleted articles are never shown; an unknown slug shows the 404 page (a soft 404: status 200 with `noindex`, because the
response is already streaming).
Old `/articles` links redirect to `/news`.

**Events**: `/events` lists published events as cards (newest first), filtered by type and a
date range (`?type=webinar&from=2026-01-01&to=2026-12-31`, 12 per page; the country filter comes
with chapters, step 2.7). `/events/[slug]` shows banner, type, date and time on the event's clock
(and, in the browser, in the visitor's own zone), location, deadline, description, schedule,
speakers and sponsors (by order number). Registration (flowchart decision): before the deadline
an external registration link opens in a new tab; without one, a signed-in member registers here
(confirmed or waitlisted by capacity, one registration per member, reCAPTCHA v3 action
`event_register`, confirmation e-mail key `event:{id}:registered:{uid}`) and a guest is sent to
sign in first. After the deadline the page says registration is closed. `/account` lists the
member's own registrations.

**Gallery**: `/gallery` shows one card per published album (cover, event title, photo count);
`/gallery/[slug]` shows the featured images with a native `<dialog>` lightbox and **See all
photos** (external album, new tab, `rel="noopener noreferrer"`). Rules:
`packages/domain/docs/gallery.md`.

**Newsletter**: the field on Home subscribes with double opt-in; the
confirm and unsubscribe pages act only when their button is pressed. `/newsletter/[id]` is the
public archive of a sent campaign (admin "Copy Link"; not cached, so a deleted campaign is gone at
once). Campaign e-mails load `/newsletter/o?t=` (open pixel) and link through `/newsletter/c?t=`
(counts the click, then redirects to the signed address). Rules:
`packages/domain/docs/newsletter.md`.

**Public forms**: `/f/[token]` shows a published public form (surveys, sign-ups, suggestion box;
no account needed). The token is random (never the form id); unknown, draft, deleted and
recruitment forms are a 404, and the page is `noindex`. Answers go through reCAPTCHA v3 (action
`form_submit`) and are validated on the server against the form's current version in one
transaction (`src/server/forms.ts`, wiring `src/server/forms-wiring.ts`, renderer
`src/components/form-fields.tsx`, answers `src/lib/form-answers.ts`). Rules:
`packages/domain/docs/forms.md`.

**Recruitment**: `/recruitment` lists published recruitments (cached, tag `recruitment`);
`/recruitment/[id]` shows the units and, for a signed-in member, the own application with ONE
next action; `/recruitment/[id]/apply` (session + complete profile) takes the choices, the
portfolio and the answers. Uploads: `POST /api/recruitment/[id]/portfolio` (PDF, 5 MB, private).
`/test/personality/[token]` is the personality test of a submitted applicant (signed 7-day link,
noindex; `src/server/personality.ts`).
Rules: `packages/domain/docs/recruitment.md`.

**Document verification**: `/verify` (type a code) and `/verify/[code]` (also the bare `/<CODE>`
on `VERIFICATION_HOST`) show whether a letter or a certificate sheet is ours, its details and,
for letters by their type's rule, the content and archived PDF (`/verify/[code]/pdf`). No sign-in, noindex, 20 requests/minute per IP.
Rules: `packages/domain/docs/documents.md` → Public verification.

**Certificate pickup**: `/certificates` — the e-mail given at registration finds that person's
sheets of issued certificate batches (exact match on a keyed hash, reCAPTCHA, the same 20/minute
limit) and gives 15-minute signed download links to the admin app, where sheets are rendered.
Needs SUBSCRIBER_HASH_SECRET, LINK_SIGNING_SECRET (both as in admin) and ADMIN_URL.
Rules: `packages/domain/docs/documents.md` → Certificates (D5) → Pickup.

**Signature**: `/account/signature` (linked from `/account`) holds the signed-in person's own
signature for letters: upload (`POST /api/account/signature`, PNG/JPEG ≤ 2 MB, stored encrypted),
preview (`GET`, owner only), printed width and rotation, removal (`src/server/signature.ts`).
Rules: `packages/domain/docs/documents.md` → Personal signatures.

**Map**: `/map` is a static design page (user) — the black news page frame, the title
"Map PPI Negara Kawasan Asia Oseania" with the shared tagline, then a two-column block:
the region map image left (design asset `images/Map/Asia-Oseania.png`, copied to
`public/map/asia-oseania-design.png`; the map column has a **fixed width**
(52rem = 832px) and the image scales down to it at its own 940:860 aspect, so the
map is **smaller than native but never cropped** (user) — no shrinking or cropping
at any column size; the column is constant, so the image keeps its size no matter
which chapters the list shows), and on the right the **side.svg design recreated
from the chapters data** (user): a square table straight on the black page — no
cream panel, no rounded corners — with the region groups of the design (OCEANIA ·
SOUTH EAST ASIA · EAST ASIA · SOUTH ASIA · MIDDLE ASIA · Others; order from
`lib/country-names.ts`, translated headings in `map.regions`), and one
cream-banded row per chapter — the design's registry number in a **dark round
badge** (brand-950, the design's 21 px circle), the dark country name (`Intl.DisplayNames` in the page language,
ISO code as fallback) and the chapter's PPI alias on the same row (e.g.
"5 Thailand PERMITHA", "10 South Korea PERPIKA"; only names that do not start with
"PPI" count as aliases). The rows come from the **active chapters only**
(`src/server/chapters.ts`, cached for minutes under the tag "chapters"): a
deactivated chapter disappears from the table at once. The **group of each row is
the chapter's own `region` field** (`packages/domain/docs/organization.md`), so the
national board can move a chapter to another group (e.g. Middle Asia → Others) or
hide it from the table (empty region) from the admin chapter form — a data change,
not a code change. The **badge number is the chapter's own `mapNo`**, also set in the
admin form (a new PPI comes pre-filled with the next free number), so a new country
shows with its own number; empty = no badge, rows sort by number first. Only the
heading order is a design constant left in `lib/country-names.ts`. (The 17 seed
chapters carry the design's numbers in their data; the real production chapters
need their `mapNo` backfilled — until then they show without a badge.) Because the map column is fixed
width, **the image does not change size when the chapters change** (user): adding
or removing rows makes the table taller or shorter; the map stays put and the
rows below it never crop it. Gotcha: the interactive member-council map's
`.site-map__image` rule (About/Profile) must stay scoped to `.site-map__box` —
its `height: 100%` otherwise overrides the map page's `height: auto` and
stretches the image to the table's height. Below 64rem the column shrinks
(40rem cap, aspect kept); below 56rem the boxes stack. `public/map/side-list.svg` (the static
list image) is no longer used.

**Chapter detail page** (`/map/[slug]`): every row of the /map table links to its
chapter's detail page (the row is the `<a>`). The page uses the same black frame,
and the page header is **the same title + tagline as /map** (user: "Tambahkan
teks Map PPI Negara Kawasan Asia Oseania … Seperti halaman map" — `t.title` /
`t.tagline`, so the h1 is the map title and the country name is an h2). Below
the header, the country's design MAP **left** — New Zealand's, for EVERY
chapter for now (user: "Sementara untuk map nya gunakan map new Zealand
saja"; `CHAPTER_MAP` in `lib/country-names.ts`, the design's
"New Zealand.png" copied to `public/map/countries/nz.png`) — and the cream
panel right The columns and the air between them are
**the same as the /map block** (user: "jarak dan ukurannya seperti pada halaman
Map"): the image column is the map's **fixed 52rem** and the panel the map
table's 18rem, with the map's **2rem gap** (`--space-8`) — the image no longer
touches the panel (it grew to touch both edges before, per an earlier request;
the user reverted that: gap + sizes like /map). The 940:860 asset keeps its
aspect, so at 1440 viewport it renders 832×761 like the map image; the panel is
only as tall as its rows (user: "tinggi panel ini tidak perlu sejajar" —
`align-items: start`, where /map's table stretches), **not rounded** (user). The
**"← Back to Map" link is the panel's first row, above the country name** (user:
"Pindahkan ← Back to Map diposisi diatas teks New Zealand (Detil Chapter)" — it
was a full-width link above the block before; also the page's original design
spec), with extra air under it (user: "Jarak antara ← Back to Map dan New
Zealand ditambah": `margin-bottom: space-2`) and the country name follows (16 px,
Poppins, user: "Ukuran font diperkecil"). The rows are the **dashboard's flat
rows** (user: no field headers): the **chapter photo sized to the description's
width** (user: "Gambar di atas deskripsi diperkecil agar sesuai dengan Panjang
bagian deskripsi": `max-width: 100%` + `align-self: flex-start` — it reached
edge-to-edge of the panel before, per an earlier request the user then
reverted; the wide seed renders ≈240×135, the same width as the
description's longest line). The photo is the chapter's **own photo from the
database** — the admin form's logo upload (user: "masuk ke database aja …
semua foto dan deskripsi untuk 17 negara ada di dashboard"): the local seed's
17 rows carry the design's country photos as their `logo` field
(`/home/{mapNo}.png`, backfilled from the design folder by a one-off script,
editable in the admin PPI form like any other field). An earlier temporary
version picked numbered assets by file name (`1.png…17.png`); the user
reverted it — the page never branches on files, only on the chapter's data.
Then the
description paragraph plain, then the contact
lines — "Budi Setiawan", "Ketua PPI Selandia Baru" (`role` + chapter name,
**bold**, user: "dicetak tebal"), **"Email:"** / **"Phone:"** lines with the
values inline (like the chapter form shows them) — then, **right below the
phone** (user: "mepet dengan dibawah phone"), the chapter name as **plain text —
no website link** (user: "Link PPI Selandia Baru dihilangkan"; the admin
`website` field exists but is no longer linked here) and the
**social logo row**: the SAME five platform logos as
the footer and the PPi slider — LinkedIn, YouTube, Instagram, X, Facebook
(shared `SOCIAL_LINKS` Simple Icons) — **black** on the cream panel (user: "Logo
Social media sama seperti halaman dashboard: LinkedIn, Youtube, Instagram, X,
Facebook. Warnanya hitam"; 20 px, `fill: currentColor`, `aria-label` per
platform). Every chapter shows ALL FIVE logos, always (user: "Di saya logonya masih
instagram, youtube dan tiktok" — the chapter's own platform mix is no longer
the row; the row renders even with no social fields on the chapter — an
earlier `socials.length > 0` guard was removed); each logo links to the
chapter's OWN profile for that platform when
it has one (the `instagram` field or a matching `socials` row), otherwise to
the network home page, like the footer row. A `socials` link outside the five
platforms is not shown at all. All still from the chapter's own data, nothing
hardcoded. Fonts
are smaller still (user: "Ukuran font diperkecil" again — 16 px name
(`text-base`, **bold 700** — user asked to thicken it: "Teks New Zealand apa
bisa dipertebal lagi?", then enlarged it a little: "Text New Zealand
perbesar sedikit saja"), **10 px rows** (`text-3xs`, the smallest text token)) and the
rows are tight: the **contact lines are a single flush block — no air
between them** (user: "Jarak antar baris dikurangi"), and the LINE SPACING is
tight on the description and every contact row alike — `--leading-3xs` 1.35
(user asked whether the description's line spacing matched the "Ketua PPI
Selandia Baru" line's; they were equal, so both got tighter: "Kalau sudah
sama berarti kurang rapat"), while the air **above
the contact person** and **above the chapter name** is larger, ≈10 px with
the panel's 2 px gap (user: "Jarak antara Budi Setiawan dan atasnya
ditambah, serta PPI Selandia Baru dan atasnya ditambah"); the remaining
blocks keep the uniform **2 px** of the earlier rounds (user: "Kurangi
jarak antar paragraph", "dibuat mepet", "dibuat mepet lagi") — except a
little extra air between the logo photo and the description (6 px; user:
"jarak antara deskripsi dan gambar diatasnya tambahkan sedikit saja", then
"ditambah sedikit lagi", `.chapter__logo + .chapter__about`). All from the admin form ("isi dari container ini diambil dari
halaman dashboard", user); every field is optional: empty ones are
left out. The 17 seed chapters' `description` and `role` ("Ketua") were
backfilled into the database from the design ("dashboard") extract — the
Figma HOME-PUBLIC detail slides' editorial texts, one per country, by mapNo
(user: "kok data untuk negara lain belum muncul?" / "kan isi datanya udah ada
di dashboard"). The design's contact name/email/phone are REUSED PLACEHOLDERS
("Budi Setiawan" everywhere, "autralia@example.com", "+00 000 0000 000"), so
those fields were left out of the description backfill; then, per the user
("Kontak Ketua PPI Samakan dulu aja semuanya"), the NZ row's contact
(`Budi Setiawan` / `selandiabaru@example.com` / `+00 000 0000 000`) was
copied to all 17 rows for a uniform look — still placeholders, still editable
one by one in the admin form; social profile URLs likewise don't exist in the
design (icons only), so the row links to the network home pages until the
real profiles are entered.
Below 64rem both columns behave like /map (image shrinks to a 40rem
cap, the panel takes the rest; below 56rem the boxes stack). Unknown or
deactivated slugs are a soft 404 (`noindex`), like the news article page.
The PRODUCTION chapters (cPanel) still need their `description` / `role` /
`phone` / website / socials backfilled (PROD BACKLOG).
**About Us**: the GALLERY DETAIL template's frame, REDESIGNED to look elegant
(user: "Sekarang coba halaman ini di desain dengan sebagus mungkin versi kamu
biar terlihat elegan untuk halaman profil") — a full-bleed HERO: the board
photo (`public/about/banner.svg` 1920×336 "FOTO KEPENGURUSAN" is the
placeholder; swap the file or the `ABOUT_BANNER` constant in
`src/app/about/page.tsx`) at 27rem (21rem on phones) with a dark bottom-up
gradient (`hero::after`) — with NO title over it, the page title was
removed on request (user: "Tulisan Tentang Kami dan garis dibawah teks itu
dihapus aja"); it still exists as a screen-reader-only h1 that keeps the
`site-event__title` class the e2e spec asserts. Then the
cream page in a narrow 48rem column with five sections — **Profil PPIDK
Asia-Oseania** (2 paragraphs with a drop cap on the first,
`--text-5xl` maroon, floated), **Kolaborasi ASIANIA** (3 paragraphs), **VISI**
and **MISI** on ONE maroon CARD (`--color-panel`, 40×48px padding, `--radius-xl`,
`--shadow-popover`; heading cream, text `--color-on-panel-muted`, gold
A—K—S—I) and **Struktur Organisasi**. Section headings are 700
`--text-3xl` with wide tracking and a short gold rule under each
(`heading::after`); the prose blocks are separated by a hairline
(`.site-about__section + .site-about__section`); the section right after the
VISI/MISI card gets extra breathing room (`.site-about__aspirasi + .site-about__section`
→ `--space-16` top, the user's "Jarak antara teks Struktur organisasi dan
atasnya ditambah"); paragraphs, mission points
and structure lines are justified (`text-align: justify`). Profil, Kolaborasi,
VISI and MISI are STATIC dictionary texts (`about.profil*`, `kolaborasi*`,
`visionDefault`, `missionDefault` — the user's editorial copy, id + en), NOT
the period's vision/mission fields. The initial A—K—S—I of each MISI point is
bigger and bold (`.`site-about__missions li::first-letter`), and the slogan
up to the colon — "A—Accelerate Collaboration" etc. — is BOLD too (round 12:
"teks Accelerate Collaboration, Knit Strategic Partnership, Spark Innovation,
Inspire Impact dicetak tebal"; the component splits each item at the first
colon into `<strong>`+ description). Body: Poppins
16px. **Struktur Organisasi** shows the static organisation chart
(`public/organization.png`) on the same maroon panel card as VISI/MISI; there are no
per-unit public pages.
  **Member councils**: About and Profile list the active chapters with their count; the
  interactive Asia–Oceania dot map (`ChapterMap`) still exists for them. Rules:
  `packages/domain/docs/organization.md`.

## Where it lives

- Dictionaries: `src/i18n/dictionaries.ts` (`DICTIONARIES.id` / `.en`, `languageFrom`, `LEGAL_VERSION`).
- Rendering helper: `src/i18n/localized.tsx` (`<Localized render={(t, language) => …} />`).
- Frame: `src/components/site-frame.tsx` (header, footer, legal page; address, community list and
  social profile URLs are constants at the top), `site-nav.tsx` (header links, current section).
  Logo: `public/logo.webp` (shield and name in one image; the admin app has the same file).
- Header account (`src/components/site-account.tsx`): Log in chip, or photo/initials, short name
  and a menu (Profile, Account, Log out); streamed, never prerendered. Tests:
  `tests/unit/account-menu.test.ts`.
- Pages: `src/app/{page,about,terms,privacy,news}/…`, styles `src/app/globals.css`.
- Events: cached reads and registration wiring `src/server/events.ts`, rules
  `src/server/registrations.ts`, captcha `src/server/captcha.ts`, e-mails
  `src/server/messaging.ts`, list query `src/lib/event-query.ts`, pages `src/app/events/…`.
- News: cached reads `src/server/news.ts` (`publicNews`, `publicNewsBySlug`), list query
  `src/lib/news-query.ts`, cards `src/components/news-cards.tsx`; rules in
  `packages/domain/docs/content.md`.
- Page views: `src/components/page-view-tracker.tsx` (in the root layout; calls the server action
  `src/app/page-view-action.ts` on every path change), `src/server/page-views.ts` (`pageViewHit`:
  path check, bot filter, device, external referrer host, visitor = HMAC of UTC day + IP + user
  agent with `LINK_SIGNING_SECRET`; the IP is never stored). Shown to superadmins in admin Page Views.
  Tests: `tests/integration/page-views.test.ts`.
- Tests: `tests/unit/web-i18n.test.ts`, `tests/unit/web-news.test.ts`,
  `tests/unit/web-events.test.ts`, `tests/integration/web-registration.test.ts`,
  `tests/integration/event-registration.test.ts`, `tests/security/captcha.test.ts`,
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
- Content from the database (news, events) is shown in the language it was written in.
- `LEGAL_VERSION` is the "last updated" date of Terms and Privacy: change it with the text.
- `<html lang>` stays `id` (the root layout is static).
- The social icons link to the networks' home pages until the organisation's profile URLs are put in
  `SOCIAL` (`site-frame.tsx`).
- The copyright year comes from a cached component (`"use cache"`, `cacheLife("days")`): the
  prerendered shell may not read the clock directly.
- News reads are cached for minutes (`cacheTag("news")`, `cacheLife("minutes")`): an admin change
  or a scheduled article shows up within a few minutes (admin is a separate app and cannot
  revalidate the web cache). The list holds the newest 300 visible articles.
- Events are cached the same way (`cacheTag("events")`); the register action reads the event
  uncached and checks the deadline inside the registration transaction (capacity counter
  `eventCounters/{eventId}`).
- Without `RECAPTCHA_SECRET_KEY`, development and test skip the captcha; staging and production
  refuse every registration (fail closed).
- Page views: only the path is kept (no query string, ≤ 200 safe characters); bots and requests
  without a user agent are skipped; a failed write logs `page_view_failed` and never affects the page.
  Any path a visitor sends is counted (the per-IP rate limit caps it).
- If the news read fails, Home logs `home_latest_news_failed` and leaves the section out; a failing
  highlights read logs `home_highlights_failed` the same way.

## Configuration

`NEXT_PUBLIC_RECAPTCHA_SITE_KEY`, `RECAPTCHA_SECRET_KEY`, `RECAPTCHA_MIN_SCORE` (captcha);
`MESSAGING_MODE`, `MESSAGING_TEST_RECIPIENTS`, `RESEND_API_KEY`, `EMAIL_FROM_TRANSACTIONAL`
(confirmation e-mails, same meaning as in admin).
