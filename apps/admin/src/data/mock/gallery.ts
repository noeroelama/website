/**
 * Gallery mock data + helpers for the Gallery admin page. Static, client-side only —
 * there is no gallery backend yet; the page manages its own state on top of this seed.
 * Fields mirror the Figma "GALLERY ADMIN" list + create/edit screens.
 */

export type AlbumStatus = "published" | "private" | "draft";

export interface AlbumItem {
  id: string;
  /** Album title shown as the table's primary row text. */
  title: string;
  /** Name of the event this album is attached to (the "Event *" field). */
  event: string;
  /** Event type shown under the album title and in the Event column. */
  eventType: string;
  /** Number of photos/videos; rendered as "N+" in the cover stack chip. */
  total: number;
  /** Public slug, e.g. "simposium-ppidk-2026". */
  url: string;
  /** External Google Photos album link (public site opens this). */
  albumLink: string;
  /** Album cover art — reuses the event placeholder art under /events. */
  image: string;
  /** 5 cover-photo thumbnails ("album-preview stack"); the 5th carries the count. */
  photos: string[];
  status: AlbumStatus;
  /** Admin who created the album, shown under the date. */
  createdBy: string;
  /** Author email shown under the Author column name. */
  email: string;
  createdAt: string;
  /** When the album was last modified — shown under "Last Modified". */
  modifiedAt: string;
}

/** ISO date → "11 May 2026". */
export function formatDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Full timestamp → "15 Oct 2026, 14:00". */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${hh}:${mm}`;
}

/** Humanised "x time ago" (e.g. "2 hours ago", "3 days ago") from an ISO timestamp. */
export function timeAgo(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const diff = Math.max(0, now - d.getTime());
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

function daysFromNow(days: number): string {
  const d = new Date(Date.UTC(2026, 9, 15) + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** ISO timestamp a few hours/days in the past (for "Last modified … ago"). */
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

/**
 * 5 cover-photo URLs for the album-cell "preview stack" — the list shows five
 * small overlapping thumbnails and puts the "48+" count on the last one. Takes
 * the album's base art (`/events/evNN.png`) and cycles the 50 placeholders.
 */
function coverPhotos(base: string): string[] {
  const m = base.match(/ev(\d{2})\.png$/);
  if (!m) return [base, base, base, base, base];
  const start = Number(m[1]);
  return Array.from({ length: 5 }, (_, k) => {
    const n = ((((start - 1 + k) % 50) + 50) % 50) + 1;
    return `/events/ev${String(n).padStart(2, "0")}.png`;
  });
}

/** The events albums attach to: title + type, used to generate the seed rows. */
const ALBUM_EVENTS: Array<{ title: string; type: string }> = [
  { title: "Simposium PPIDK Asia-Oseania 2026", type: "Symposium" },
  { title: "Webinar Beasiswa LPDP", type: "Webinar" },
  { title: "Workshop Jurnalisme Data", type: "Workshop" },
  { title: "Festival Literasi Pelajar Terbuka", type: "Festival" },
  { title: "Pameran Inovasi Layanan Publik", type: "Exhibition" },
  { title: "Konvensi Mahasiswa Asia Tenggara", type: "Conference" },
  { title: "Malam Budaya Indonesia", type: "Event" },
  { title: "Pekan Olahraga PPI", type: "Event" },
  { title: "Sosialisasi Satu Data Indonesia", type: "Seminar" },
  { title: "Sidang Umum PPIDK", type: "Meeting" },
];

/** Options for the "Event *" select in the album form. */
export const ALBUM_EVENT_OPTIONS = ALBUM_EVENTS.map((e) => e.title);

const ADMINS = [
  "Adhitia Erfina",
  "Sarah Larasati",
  "Bagus Putra",
  "Dewi Anggraini",
  "Raka Pratama",
  "Maya Kusuma",
  "Ni Kadek Widiastini",
];

/** Realistic author email derived from the display name (first.last@asiania.id). */
function emailFor(name: string): string {
  return (
    name.toLowerCase().replace(/\s+/g, ".").normalize("NFD").replace(/[̀-ͯ]/g, "") + "@asiania.id"
  );
}

/** Status assigned to a generated album: most recent are published, a few drafts/private. */
function statusFor(i: number): AlbumStatus {
  if (i % 11 === 0) return "draft";
  if (i % 7 === 0) return "private";
  return "published";
}

/** Album-caption variants for the generated rows ("Dokumentasi …" / "Galeri …"). */
const CAPTIONS = ["Dokumentasi", "Galeri", "Foto Resmi", "Highlight", "Arsip Foto"];

/**
 * Seed list — 112 albums so the list matches the Figma footers
 * ("Showing 1–10 of 112", "Select all 112 albums"). The first few are
 * hand-authored to match the design text; the rest are generated by cycling
 * a small set of events/admins/captions, reusing the event art for covers.
 */
export const INITIAL_ALBUMS: AlbumItem[] = (() => {
  const handAuthored: AlbumItem[] = [
    {
      id: "al-01",
      title: "Dokumentasi Simposium PPIDK Asia-Oseania 2026",
      event: "Simposium PPIDK Asia-Oseania 2026",
      eventType: "Symposium",
      total: 48,
      url: "simposium-ppidk-asia-oceania-2026",
      albumLink: "https://photos.app.goo.gl/abc123def456",
      image: "/events/ev01.png",
      photos: coverPhotos("/events/ev01.png"),
      status: "published",
      createdBy: "Adhitia Erfina",
      email: emailFor("Adhitia Erfina"),
      createdAt: daysFromNow(-1),
      modifiedAt: hoursAgo(2),
    },
    {
      id: "al-02",
      title: "Galeri Webinar Beasiswa LPDP",
      event: "Webinar Beasiswa LPDP",
      eventType: "Webinar",
      total: 32,
      url: "webinar-beasiswa-lpdp",
      albumLink: "https://photos.app.goo.gl/lpdp789xyz012",
      image: "/events/ev03.png",
      photos: coverPhotos("/events/ev03.png"),
      status: "published",
      createdBy: "Sarah Larasati",
      email: emailFor("Sarah Larasati"),
      createdAt: daysFromNow(-2),
      modifiedAt: hoursAgo(26),
    },
    {
      id: "al-03",
      title: "Rangkaian Workshop Jurnalisme Data",
      event: "Workshop Jurnalisme Data",
      eventType: "Workshop",
      total: 64,
      url: "workshop-jurnalisme-data",
      albumLink: "https://photos.app.goo.gl/ws345abc678",
      image: "/events/ev07.png",
      photos: coverPhotos("/events/ev07.png"),
      status: "draft",
      createdBy: "Bagus Putra",
      email: emailFor("Bagus Putra"),
      createdAt: daysFromNow(-3),
      modifiedAt: hoursAgo(50),
    },
    {
      id: "al-04",
      title: "Pameran Inovasi Layanan Publik",
      event: "Pameran Inovasi Layanan Publik",
      eventType: "Exhibition",
      total: 27,
      url: "pameran-inovasi-layanan-publik",
      albumLink: "https://photos.app.goo.gl/pam901def234",
      image: "/events/ev12.png",
      photos: coverPhotos("/events/ev12.png"),
      status: "private",
      createdBy: "Maya Kusuma",
      email: emailFor("Maya Kusuma"),
      createdAt: daysFromNow(-4),
      modifiedAt: hoursAgo(74),
    },
  ];

  const generated: AlbumItem[] = Array.from({ length: 108 }, (_, k) => {
    const i = k + 1;
    const ev = ALBUM_EVENTS[k % ALBUM_EVENTS.length] ?? ALBUM_EVENTS[0]!;
    const caption = CAPTIONS[(k * 3) % CAPTIONS.length] ?? "Dokumentasi";
    const n = (k % 10) + 1;
    const img = `/events/ev${String((k % 50) + 1).padStart(2, "0")}.png`;
    return {
      id: `al-${String(handAuthored.length + i).padStart(2, "0")}`,
      title: `${caption} ${ev.title}`,
      event: ev.title,
      eventType: ev.type,
      total: 20 + ((k * 13) % 180),
      url: `${caption.toLowerCase().replace(/\s+/g, "-")}-${ev.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")}`.slice(0, 48),
      albumLink: `https://photos.app.goo.gl/gen${String(k + 100).padStart(3, "0")}${String(
        ((k * 7) % 900) + 100,
      )}`,
      image: img,
      photos: coverPhotos(img),
      status: statusFor(i),
      createdBy: ADMINS[(k * 5) % ADMINS.length] ?? ADMINS[0]!,
      email: emailFor(ADMINS[(k * 5) % ADMINS.length] ?? ADMINS[0]!),
      createdAt: daysFromNow(-(n + 2)),
      modifiedAt: hoursAgo((n + 1) * 24 - 3),
    };
  });

  return [...handAuthored, ...generated];
})();

export const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
