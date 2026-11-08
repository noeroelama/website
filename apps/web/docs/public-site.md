# Public site: frame, language (ID/EN), Home, News, About, Terms, Privacy

## What it does

Every public page has the same dark header and footer (Figma design). Header: logo (links home),
About Us, Events, Gallery, News, Map; the current section is bold (`aria-current="page"`). Footer:
logo and tagline; Explore (Home … Map) and Services (E-Commerce = `SHOP_URL`, hidden when unset);
Our Community (five PPIs, linking to `/map`); address and social icons (new tab); copyright year,
Terms of Use, Privacy Policy. The header has no language switch or Sign in link (design choice):
visitors read the site in Indonesian unless the `lang` cookie says `en` (kept for a year). Home
explains the purpose of the site and shows the Google data notice; About, Terms and Privacy are
static pages. Home also lists the 3 latest news and a **highlights panel** (L1,
`src/server/highlights.ts`): up to 3 open recruitments, 3 public forms in their answer window and 3
upcoming published events. Its only inputs are those three public lists, so meetings, Zoom bookings
and unit agendas can never appear (`tests/integration/highlights.test.ts`). **Activities**
(`/activities`, M4, linked from the panel and the footer) is the same read model
(`src/components/highlights.tsx`) without the limit of 3.

**News**: `/news` lists visible news as cards, newest first, filtered by the category pills
(Semua · Seminar · Workshop · Webinar · Conference · Meetup · Lainnya — the same set and labels
as the events/gallery bar, over the news `category` field), country,
tag and time (`?category=seminar&tag=riset&region=Indonesia&time=month&page=2`, 12 per page);
the card meta is "date · location · category" (same as events). `/news/[slug]` is the article
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
SOUTH EAST ASIA · EAST ASIA · SOUTH ASIA · MIDDLE ASIA · Others; headings from
`lib/country-names.ts`, English in both languages like the page title), and one
cream-banded row per chapter — the design's registry number in a **dark round
badge** (brand-950, the design's 21 px circle), the dark country name (same source,
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
(40rem cap, aspect kept); below 56rem the boxes stack. The seed
(`infrastructure/scripts/seed-dummy.mjs`) contains the design's
17 chapters, PERMITHA and PERPIKA included. `public/map/side-list.svg` (the static
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
description paragraph plain (Poppins like the
name; the panel rows are **Inter** — user: "Teks New Zealand dan Deskripsi font:
Popins. Sisanya font Inter"), then the contact
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
Asia-Oseania** (2 paragraphs with a Cinzel drop cap on the first,
`--text-5xl` maroon, floated), **Kolaborasi ASIANIA** (3 paragraphs), **VISI**
and **MISI** on ONE maroon CARD (`--color-panel`, 40×48px padding, `--radius-xl`,
`--shadow-popover`; heading cream, text `--color-on-panel-muted`, gold
A—K—S—I) and **Struktur Organisasi**. Section headings are Cinzel 700
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
16px. Only the STRUCTURE comes from
the ACTIVE period's data in the database (server`src/server/structure.ts`,
cached for minutes under the tag "structure"; the admin Organizations period
form holds the units): `publicStructure()`reads`settings/activePeriod`and
its active units flattened to`PublicUnit`(no id timelines, no member photos)
— it returns units ONLY (no period; the period's vision/mission are unused on
the page). The structure section is THREE static blocks (client component
`src/components/site-structure-tree.tsx`, "use client"; the server passes the
flat `units`, the component nests them by`parentId`with a`useMemo`map). Per
the user (round 6 made Bapelha, Biro and Direktorat SIBLING ROOTS; round 9
briefly nested the umbrellas under WASEKJEN — "Posisi Biro dan direktorat
Sejajar dengan Sekretaris Eksekutif dan Bendahara"; round 10 moved them back
up: "Bagian Biro dan Direktoran kembali digeser ke kiri, sejajar dengan
Badan Pelaksana Harian"): the seed keeps`parentId: null`for Biro (bpl-08)
and Direktorat (bpl-12), so the umbrellas are ROOTS again, level with
Bapelha, each in its own `.site-about__structure-part`. Between the blocks
sits a hairline SEPARATOR (round 10: "dibawah Bendahara Eksekutif dan
dibawah biro paling bawah, diberi garis batas untuk pemisah") — the line is
below Bendahara Eksekutif (the Bapelha block's last row) and below the last
biro, KPK (the Biro block's last row): 24px air, 1px line, 24px air, via
`.site-about__structure-part + .site-about__structure-part { margin-top:
space-6; padding-top: space-6; border-top: 1px solid var(--color-border-subtle) }`
plus the trailing parts' root-tree margins zeroed. The breadcrumbs reverted
with the roots (KSA: "Biro" only; bpl-12/wasekjen: none (root); PSDM:
[Direktorat]; WASEKJEN bpl-03: Bapelha › Sekjen). Three blocks:

- **Bapelha — STATIC, not a dropdown** (user: "Bapelha tidak dropdown"): it
  is a LINK row (`a.site-about__unit`, Poppins name + Inter code pill) whose
  detail shows exactly the four executive rows — Sekretaris Jenderal, Wakil
  Sekretaris Jenderal, Sekretaris Eksekutif, Bendahara Eksekutif. Round 22
  flattened the officer line: the seed now keeps ALL FOUR as DIRECT children
  of Bapelha (sorts 1..4, `parentId: bpl-01`) — user: "anggota Bapelha itu
  sekjen, wasekjen, sektif, dan bendtif. Jadi wasekjen, sektif, dan
  bendtif bukan bagian dari sekjen" — so they sit side by side, ONE indent
  under Bapelha (the pre-flatten hierarchy SEKJEN → WASEKJEN → {SEKTIF,
  BEND} — round 8: "1 kali lebih kanan dari Wakil Sekretaris Jenderal" —
  is gone; the rows are 301px all four). A depth cap of 1 keeps exactly
  those four rows under
  Bapelha (user round 5: "Biar nanti jika ada wakilnya cukup
  ditampilkan di halaman detilnya saja ketika di klik"; round 18 briefly
  rendered the SEKTIF/BEND wakil in the tree (depth 4), round 19 reverted
  it: "Bukan seperti itu, kembalikan"). Every deeper
  unit — deputy offices like WASEKTIF & WASEKTIF-II (under SEKTIF) or WABEND
  (under BEND),
  and anything the admin adds later — is NOT a row; it appears only on its
  parent's detail page's "Wakil" cards (see the detail-page section).
- **Biro & Direktorat — DROPDOWN TOGGLES wherever they sit** (user: "sementara
  Direktorat dan biro dropdown"): a dropdown is an umbrella shell whose own
  parent is NOT an umbrella (`isDropdown`), so exactly the Biro and
  Direktorat rows render as `button.site-about__unit` toggles (chevron
  rotates on expand, COLLAPSED BY DEFAULT — round 11: "Biro dan Direktorat
  tidak tampil datanya (perlu diklik dropdown, baru muncul datanya)"; round
  6's "langsung muncul semua biro dan direktoratnya" is superseded, the
  subtree appears only after the user clicks the toggle) whose detail below
  lists KSA/JMO/KPK (resp.
  PSDM/HAL/KOMDIGI/PDR/PPM) and — inside each subtree, fully — their Bidang.
  The five direktorat rows (PSDM…) keep type "direktorat" but are NOT
  toggles (their parent IS an umbrella — they fail `isDropdown`): they stay
  static LINK rows with their Bidang as nested rows (round 4: "Di setiap
  biro dan Direktoratnya tidak perlu ada dropdown lagi").
  There is NO "Lihat detail pengurus" / "View officers" text anywhere
  (`about.unitPage` was REMOVED from both dictionaries; user round 5: "Hapus
  semua teks Lihat detail pengurus") — the row itself navigates. Each row's
  detail sits under it indented with the guide line: members ("name — role",
  heads bold), divisions and the nested sub-tree. The detail block only
  renders when the unit HAS content — members, divisions or children
  (`hasContent` guard) — and there is NO "Pengurus bagian ini belum
  diumumkan." / "Officers for this part have not been announced yet." note
  anywhere anymore (`about.unitEmpty` was REMOVED from both dictionaries;
  user round 7: "Hapus semua teks Pengurus bagian ini belum diumumkan") —
  empty exec rows are bare links, and people appear only once the admin fills
  members in (round 7: "Detil pengurus akan dimunculkan Ketika
  biro/direktorat di klik saja"). ROOT-ROW DETAILS: Bapelha's rows live in
  `ul.site-about__structure-root-tree` (list-style: none — the old bare `<li>`
  in the section drew a stray bullet next to "Badan Pelaksana Harian", fixed
  round 7), and Bapelha's detail uses `.site-about__unit-detail--tight`
  (round 7 wanted it "rapat" at 2px; round 9: "Jarak atas Bawah Sekretaris
  Jenderal belum sama dengan yang lain" — now 12px like every other parent
  row in the branch, via `.--tight .site-about__unit-detail { margin-top:
space-3 }`); the tight rules sit AFTER the base `.site-about__unit-detail`
  in globals.css or the base margin wins (same specificity). Every row gap
  in the whole executive branch is 12px (`--space-3`), uniform from Bapelha
  down through the umbrellas; the only breaks in the rhythm are the 49px
  block boundaries (24px air + 1px divider + 24px air, round 10). FONT SIZE RULE
  (user: "Ukuran font selain Badan Pelaksana Harian, Biro, dan Direktorat
  Diperkecil" + round 9 "Ukuran font Sekretaris Jenderal dan Wakil Sekretaris
  Jenderal dibuat sama. Setelah itu ukurannya diperbesar 1px"): 18px
  (`--text-lg`) for Badan Pelaksana Harian and the two umbrella toggles Biro
  & Direktorat wherever they sit; 17px (`calc(var(--text-base) + 1px)`, the
  `--lead` variant) for Sekretaris Jenderal & Wakil Sekretaris Jenderal;
  16px (`--text-base`) for EVERYTHING else (`.site-about__unit--small` —
  including KSA/JMO/KPK, the five direktorats and all Bidang). The whole section
  falls back to a single placeholder sentence (`about.structure`) when no
  units exist at all.
  Every row links to its own page (**/struktur/[unitId]**,
  `src/app/struktur/[unitId]/page.tsx`):
  a soft-404 shell page (`export const instant = false;`like /map/[slug]) with a
  breadcrumb along`unit.path` ending with the CURRENT unit itself, so the path
  reads "Badan Pelaksana Harian > Sekretaris Jenderal" (round 15: "Badan
  Pelaksana Harian seharusnya Badan Pelaksana Harian > Sekretaris Jenderal";
  every crumb after the first is separated by a ">" via
  `.site-unit__crumbs-path > * + *::before` and the last crumb — the page
  itself — is `.site-unit__crumbs-self`, bolder, NOT a link). Round 17 skips
  the SEKJEN level on the WASEKJEN page ("Badan Pelaksana Harian > Sekretaris
  Jenderal > Wakil Sekretaris Jenderal seharusnya Badan Pelaksana Harian >
  Wakil Sekretaris Jenderal" — the ancestor filter drops a `sekjen` ancestor
  on `wasekjen` pages); round 21 GENERALISED it to every page in the officer
  line (WASEKJEN, SEKTIF, BEND and their wakil — the officer types
  `sekjen|wasekjen|staf|bendahara|wakil_bendahara`, with `koordinator`
  excluded so Bapelha stays): the intermediate officer ancestors are skipped
  and the crumb reads "Badan Pelaksana Harian > Sekretaris Eksekutif"
  (user: "Badan Pelaksana Harian Sekretaris Jenderal Wakil Sekretaris
  Jenderal Sekretaris Eksekutif, seharusnya dari Bapelha Langsung ke
  Sekretaris Eksekutif saja"). The unit's name (Poppins 700)

- code pill, then "Pengurus"/"Officers" cards — each member's photo when the
  admin uploaded one (`member.photo`), otherwise a maroon circle with the gold
  initial — two columns on wide screens. Round 15 renamed "Bagian di
  dalamnya"/"Sub-units" ("Bagian di dalamnya seharusnya ganti dengan Bagian
  Terkaiit" — typo fixed) to **"Bagian Terkait"/"Related parts"**
  (`about.unitChildren`). The section shows `unit.related` — on Bapelha that
  is its four officer children (cards for SEKJEN/WASEKJEN/SEKTIF/BEND since
  round 22 flattened them into direct children); the SEKJEN-wide rounded
  list (direct children PLUS the units under them — "Isinya Wasekjen,
  Sekretaris Eksekutif, Bendahara Eksekutif"; round 16 extended this to
  WASEKJEN — "buat gaya yang sama untuk wasekjen" → 4
  cards — but round 17 reverted it: "Hilangkan Wakil Sekretaris Eksekutif
  WASEKTIF dan Wakil Bendahara Eksekutif WABEND") is DORMANT: the sekjen
  has no children any more, so its page renders no "Bagian Terkait" at all;
  the `sekjen` branch in
  `publicUnit()` stays as dead code,
  and all other pages list direct children only. The LEAD pages (SEKJEN `bpl-02`,
  WASEKJEN `bpl-03` and Sekretaris Eksekutif `bpl-04` &
  Bendahara Eksekutif `bpl-06`, the two officers whose direct children are
  their wakil; `isLead` = sekjen/wasekjen, or a staf/bendahara unit WITH
  children — type alone can't pick SEKTIF out of its own wakil; the round-22
  flattening leaves this rule untouched: the four officers keep their heroes,
  and SEKTIF/BEND keep their wakil children)
  replace the compact grid with a profile HERO (round 13: "Halaman ini
  memuat: Foto (Agak besar), Jabatan (pills alias jabatan)"; round 14:
  "Tulisan Pengurus dan garis dibawahnya dihapus. Gambar dibuat lebih besar,
  bentuknya potrait, dan posisi center. Dibawahnya ada tulisan Sekretaris
  Jenderal, Pills SEKJEN"): NO "Pengurus" heading (heading and ornament line
  removed from the hero only) — one column per person, everything CENTRED: a
  BIG PORTRAIT photo `site-unit__lead-photo` (240x320px,
  `calc(var(--space-24) * 2.5)` x `calc(var(--space-32) * 2.5)`, rounded
  `--radius-xl`, `object-fit: cover` or the gold initial placeholder — 60px
  `--text-6xl` — on the maroon `--color-panel`), then the member's name (18px
  `site-unit__lead-name`, when a member exists), the JABATAN as plain big
  text `site-unit__lead-jabatan` ("Sekretaris Jenderal", `--text-2xl` 24px
  Poppins semibold) and the CODE PILL underneath (the standard
  `.site-about__code` — uppercase outline, e.g. "SEKJEN"); with NO member
  yet the hero shows the SAMPLE NAME "Budi Setiawan" (`LEAD_FALLBACK_NAME`
  const in the page — same in both languages, round 15: "Dibawah foto kasih
  nama default dulu, Budi Setiawan") under the photo (initial "B"). On the
  lead pages the header streamlines too (round 15: "Sekretaris Jenderal
  SEKJEN yang diatas foto, hilangkan pills nya"): only the h1, NO code pill
  next to the title (`{!isLead && unit.code && …}` — other unit pages keep
  it), and the back link is a plain "← Back" (`about.unitBack`). On the
  SEKTIF & BEND pages the children section is headed **"Wakil"/"Deputies"**
  (`about.unitDeputies`, round 19: user "ada tambahan Wakilnya yang mungkin
  lebih dari satu") and — since round 20 (user: "Wakilnya langsung
  ditampilkan pakai foto dibawah Sektif, namun ukurannya lebih kecil") — the
  wakil render there as PHOTO COLUMNS instead of text cards: a portrait HALF
  the hero's size (120x160px, `site-unit__deputy-photo`, `--radius-lg`,
  gold initial placeholder or the uploaded photo), the person's name
  (`LEAD_FALLBACK_NAME` until the admin registers them), the jabatan and the
  code pill (WASEKTIF/WABEND), each column a link to the wakil's own page
  (`site-unit__deputies` flex row, centred, wraps for more than one — the
  list shows however many the admin registers as children of the officer,
  in the admin's `sort` order, read straight from the database; round 21
  verified this end-to-end by injecting a second wakil + member via SQL and
  checking the extra column appeared — round 22 made that second wakil
  PERMANENT in the preview DB: `bpl-05b` "Wakil Sekretaris Eksekutif II"
  (WASEKTIF-II, `sort: 2` under SEKTIF) whose registered member is
  **Siti Rahayu** — her name/initial come from the DB, the first column
  still shows the `LEAD_FALLBACK_NAME` fallback).
  On the other pages the same section stays the text-card list
  (`.site-unit__children`). All other units keep the
  compact grid. Empty-members
  sections simply don't
  render (no "not announced" line, round 7). WAKIL units: the admin registers
  them as child UNITS of the officer (WASEKTIF `bpl-05` & WASEKTIF-II `bpl-05b`
  under SEKTIF, WABEND
  `bpl-07` under BEND) — they stay OUT of the About tree (depth cap 1, round 22) and
  show on the officer's DETAIL page as "Wakil" photo columns (round 18
  briefly tried
  them as tree rows, round 19 reverted: "Bukan seperti itu, kembalikan").
  Dictionary
  keys: `about.unitMembers`, `unitChildren`, `unitDeputies`, `unitBack`.
  Static shell +`Suspense`streaming like /map (a prerender error occurs if the data
  await sits outside the Suspense); the whole hero (photo AND title) streams
  inside`AboutContent` — the shell has no banner (there was a duplicated-banner
  bug until the standalone img was removed). The old page's sections (what we do
  list, member councils + map link, intro brief) were replaced per the user's
  new spec; councils still exist on Profile. The old dictionary keys
  (`about.what*`, `about.councils*`) were removed from both languages. Locally a
  demo period (2026-2027 "Kabinet Kolaborasi Asiania") is used, seeded with the
  OFFICIAL structure (29 units — `bpl-01..28` via `seed-structure-resmi` plus
  the permanent `bpl-05b` WASEKTIF-II with member Siti Rahayu; tree
  order = the user's alias sheet): THREE SIBLING ROOTS (round 6; round 9
  nested the umbrellas one level, round 10 moved them back up) — BAPELHA
  (`bpl-01`, koordinator) → its FOUR officers as DIRECT children (round 22
  flattened the chain: SEKJEN `bpl-02`, WASEKJEN `bpl-03`, SEKTIF
  `bpl-04` & BEND `bpl-06` all hang off Bapelha, sorts 1..4 — previously
  WASEKJEN sat under SEKJEN and round 8 moved SEKTIF/BEND under
  WASEKJEN one level right; the four executive offices
  are part of the tree, not members — codes shown in the About tree;
  WASEKTIF `bpl-05`, WASEKTIF-II `bpl-05b` and WABEND `bpl-07` are depth-2
  (children of SEKTIF/BEND) and only show on their
  parents' detail pages), the Biro umbrella (`bpl-08`, ROOT) with
  KSA/JMO/KPK, the Direktorat umbrella (`bpl-12`, ROOT) with
  PSDM/HAL/KOMDIGI/PDR/PPM and all 11 Bidang under their Direktorat
  (PSDM-BAKAT/KARIR, HAL-KEMGIS/KWS, KOMDIGI-PK/TDI,
  PDR-AKIN/AGBU/KASTRAT, PPM-SOS/ABD). Since round 31 the member slots are
  FILLED with demo people — every unit has a ketua (head: true), the
  biro/direktorat/bidang a Sekretaris (round 38 also portraits them),
  biro & bidang 6 staff — plus the wakil child units
  (`bpl-31..47`, `bpl-31b`, `bpl-34b`; see the rounds 36-38 paragraph below).
  Real people (names, photos, roles) come from the admin Organizations form
  (tree rows show plain links until then — no placeholder notes, round 7).
  Run the seed again after edits to reset (it hard-deletes the previous
  `bpl-%` draft rows first) — full order: `seed-structure-resmi` →
  `seed-wakil` → `seed-people` → `seed-r36` → `seed-r37` → `seed-r38`.
  FONTS in the whole structure area (About tree, /struktur pages) are Poppins
  and Inter ONLY (user: "fontnya ganti Poppins dan Inter saja") — unit names,
  the unit-page title + its h2 headings and member names in Poppins, code
  pills, roles and the breadcrumb in Inter; no Cinzel anywhere in the
  structure.
  ROUNDS 36-38 (lineups and full-name jabatans): every biro has Ketua +
  Wakil + Sekretaris + 6 Staff, every direktorat Ketua + Wakil + Sekretaris,
  every bidang Ketua + Wakil + Sekretaris (round 38) + 6 Staff (`seed-r36.mjs`,
  `seed-r37.mjs`, `seed-r38.mjs` on top of people/wakil seeds — run all three
  again after a destructive reseed). The wakil are child UNITS (`isWakilUnit`:
  members[0] role starts with "Wakil" or the code carries a numbering suffix),
  one per biro/direktorat/bidang except JMO (bpl-31b WAKA-JMO-2) and KOMDIGI
  (bpl-34b WADIR-KOMDIGI-2) which have two. Jabatans/pills on the detail
  pages, per type: biro heads "Kepala Biro Kesekretariatan dan Administrasi"
  (full name minus "Biro ") + `Kabiro-KSA`; their wakil "Wakil Kepala Biro
  …" + `Wabiro` (one) or "Wakil Kepala 1/2 Biro …" + `Wabiro-I/-II` (two);
  direktorat heads "Direktur Direktorat Pengembangan Sumber Daya Manusia" +
  `Dir-PSDM`; their wakil "Wakil Direktur …" + `Wadir` /
  "Wakil Direktur 1/2 Direktorat …" + `Wadir-I/-II` (roman numerals by
  tree-order position); bidang heads "Kepala Bidang Minat dan Bakat" newline
  "Direktorat Pengembangan Sumber Daya Manusia" + `Kabid-PSDM-BAKAT`
  (the `\n` renders via `white-space: pre-line` on the title, lead-jabatan
  and deputy-jabatan; the parent direktorat comes from `unit.managers.at(-1)`)
  — the same two-line pattern applies to Wakabid and the Sekretaris
  (Sekretaris also renders as a wakil-style PORTRAIT column). The BIDANG PILLS
  follow the /about row pills exactly (round 40: "Seharusnya
  Jabatan-Direktorat-Bidang", round 41: "sesuai inisial … yang ada pada pills
  halaman about"): `KABID-PSDM-BAKAT`, `WAKABID-PSDM-BAKAT`,
  `SEKBID-PSDM-BAKAT` — the jabatan prefix + the bidang's OWN code as shown
  on the about tree (helper `bidangPill`, with the old word-built
  direktorat+`bidangWord` fallback only for a code-less bidang). Helper
  closures in `page.tsx`: `leadJabatan`, `leadPill`, `wakilJabatan`,
  `wakilPill`, `bidangPill` (+ module-level `bidangWord`, `ROMAN_NUMERALS`).
  The detail pages run WIDE now: `.site-about__detail .site-event__inner`
  overrides the 48rem album column back to the page's 74rem (the rule sits
  after the 48rem rules — same specificity, later wins; /about keeps 48rem)
  so long titles like "DIREKTORAT PERGERAKAN DAN PENGABDIAN MASYARAKAT" fit
  on one line. On /about, the organization chart (`/organization.png`) sits in
  a maroon frame `.site-about__structure-frame` — the same panel card recipe
  as the Visi-Misi card (round 38: "gunakan BG yang sama seperti Visi-Misi"),
  with, since round 39: the image bleeding full width edge-to-edge inside the
  card (`margin: 0 calc(-1 * var(--space-12)); width: calc(100% + 2 *
var(--space-12))`, the card `overflow: hidden` so the corners stay rounded),
  the frame hugging the "Struktur Organisasi" heading (margin-top `--space-3`
  — "jarak … dibuat mepet"), and a 1px hairline
  (`.site-about__structure-part:first-of-type`, the same rule the parts use
  between themselves) dividing the image from the "Badan Pelaksana Harian"
  tree rows. (The divider must NOT go on `.site-about__tree` — every nested
  accordion list reuses that class.) WAKIL PILLS: the wakil of a biro read
  "Wakabiro-JMO" (one) / "Wakabiro-I-JMO" (two, roman numeral by tree
  order), of a direktorat "Wadir-PSDM" / "Wadir-I-KOMDIGI" — the full
  prefix plus the unit's code (round 39: "WAKABIRO bukan WABIRO … kurang
  inisial Biro dan Direktoratnya"), displayed uppercased by the pill CSS.
  The staff grid cells left-align their avatar+name row since round 40 (the
  3-across media query: `.site-unit__members .site-unit__member {
justify-content: flex-start }` — round 39 had centered them, round 40
  reverted: "rata kiri, agar fotonya simetris semua" — a table look: 3
  columns, every avatar at the same x in its column, more staff just add
  rows).
  **Member councils**: About and Profile list the active chapters with their count; the
  interactive Asia–Oceania dot map (`ChapterMap`) still exists for them. Rules:
  `packages/domain/docs/organization.md`.

## Where it lives

- Dictionaries: `src/i18n/dictionaries.ts` (`DICTIONARIES.id` / `.en`, `languageFrom`, `LEGAL_VERSION`).
- Rendering helper: `src/i18n/localized.tsx` (`<Localized render={(t, language) => …} />`).
- Frame: `src/components/site-frame.tsx` (header, footer, legal page; address, community list and
  social profile URLs are constants at the top), `site-nav.tsx` (header links, current section).
  Logo: `public/logo.webp` (shield and name in one image; the admin app has the same file).
- Header account (`src/components/site-account.tsx`): **removed** — the public header is links
  only, no account chip (design choice, see "no Sign in link" above); the member pages under
  `/account` exist for signed-in visitors (linked from the admin app's web paths). Tests:
  `tests/unit/account-menu.test.ts` (covers the admin account menu only).
- Pages: `src/app/{page,about,terms,privacy,news}/…`, styles `src/app/globals.css`.
- About structure: cached read `src/server/structure.ts` (`publicStructure`, tag "structure").
- Events: cached reads and registration wiring `src/server/events.ts`, rules
  `src/server/registrations.ts`, captcha `src/server/captcha.ts`, e-mails
  `src/server/messaging.ts`, list query `src/lib/event-query.ts`, pages `src/app/events/…`.
- News: cached reads `src/server/news.ts` (`publicNews`, `publicNewsBySlug`), list query
  `src/lib/news-query.ts`, cards `src/components/news-cards.tsx`; rules in
  `packages/domain/docs/content.md`.
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
- If the news read fails, Home logs `home_latest_news_failed` and leaves the section out; a failing
  highlights read logs `home_highlights_failed` the same way.

## Configuration

`NEXT_PUBLIC_RECAPTCHA_SITE_KEY`, `RECAPTCHA_SECRET_KEY`, `RECAPTCHA_MIN_SCORE` (captcha);
`MESSAGING_MODE`, `MESSAGING_TEST_RECIPIENTS`, `RESEND_API_KEY`, `EMAIL_FROM_TRANSACTIONAL`
(confirmation e-mails, same meaning as in admin).
