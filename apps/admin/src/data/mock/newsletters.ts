/**
 * Newsletter mock data + helpers for the Newsletter admin page. Static, client-side only —
 * there is no newsletter backend yet; the page manages its own state on top of this seed.
 * Fields mirror the Figma "NEWSLETTER ADMIN" list + create/edit screens.
 */

export type CampaignStatus = "sent" | "scheduled" | "draft";
export type CampaignStatusFilter = "all" | CampaignStatus;

export interface NewsletterItem {
  id: string;
  /** Email subject line (the Campaign column's main line). */
  subject: string;
  /** Audience label, e.g. "All subscribers". */
  to: string;
  /** Number of recipients the campaign covers. */
  subscribers: number;
  status: CampaignStatus;
  /** Name of the admin who authored/last touched the campaign. */
  author: string;
  /** ISO created/modified date. */
  createdAt: string;
  /** ISO date the campaign went out (sent campaigns only). */
  sentAt?: string;
  /** ISO date a scheduled campaign is due to send. */
  scheduledFor?: string;
  /** Open rate displayed under Opens, e.g. "49.9%". */
  opens: string;
  /** Click rate displayed under Clicks, e.g. "9.6%". */
  clicks: string;
  /** Content Blocks body (plain text kept in sync with the composer). */
  body: string;
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

/** ISO timestamp → "24 Oct 2026 · 09:00" — date + send time for the Sent column. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${formatDate(iso)} · ${hh}:${mm}`;
}

/** Mock "today": the seed is pinned so pagination and KPIs stay stable in the preview. */
const BASE = Date.UTC(2026, 9, 15);
function daysFromNow(days: number): string {
  const d = new Date(BASE + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Date-only variant with a send time — full ISO so the Sent column can show
    "date · HH:MM" alongside the date. */
function daysFromNowAt(days: number, hhmm: string): string {
  const d = new Date(BASE + days * 86_400_000);
  return `${d.toISOString().slice(0, 10)}T${hhmm}:00`;
}

/** Sent campaigns — a mix of recent and older sends, newest first. */
function sentSeed(): NewsletterItem[] {
  const subjects: ReadonlyArray<[string, string, number, string, string, string, string]> = [
    // subject, audience segment, recipients, author, opens, clicks, time
    [
      "PPIDK Newsletter — Edisi Oktober 2026",
      "All subscribers",
      1_186,
      "Nevyllo Kalangi",
      "80.5%",
      "52.1%",
      "09:00",
    ],
    [
      "Undangan: Simposium PPIDK Asia-Oseania 2026",
      "Asia-Pacific region",
      1_048,
      "Adhitia Erfina",
      "76.3%",
      "49.9%",
      "10:30",
    ],
    [
      "Rekap Laporan Keterbukaan Informasi — Q3 2026",
      "All subscribers",
      1_186,
      "Nevyllo Kalangi",
      "71.8%",
      "47.2%",
      "14:15",
    ],
    [
      "Webinar Literasi Digital untuk Anggota",
      "Workshop invitees",
      512,
      "Adhitia Erfina",
      "84.2%",
      "55.4%",
      "08:45",
    ],
    [
      "Kolaborasi Lintas Kawasan: Panggilan Partisipasi",
      "Partners",
      402,
      "Nevyllo Kalangi",
      "66.4%",
      "44.8%",
      "13:00",
    ],
    [
      "Panduan Baru Layanan Informasi Publik",
      "All subscribers",
      1_186,
      "Adhitia Erfina",
      "78.9%",
      "51.6%",
      "11:20",
    ],
    [
      "Edisi Spesial: Hari Keterbukaan Informasi 2026",
      "All subscribers",
      1_186,
      "Nevyllo Kalangi",
      "74.5%",
      "48.3%",
      "16:05",
    ],
    [
      "Kabar Anggota — September 2026",
      "Local PPI chapters",
      689,
      "Adhitia Erfina",
      "69.2%",
      "46.9%",
      "09:40",
    ],
    [
      "Pelatihan PPID: Kuota Terbatas",
      "Opener segment",
      784,
      "Nevyllo Kalangi",
      "88.1%",
      "57.8%",
      "12:55",
    ],
    [
      "Survey Kepuasan Layanan 2026",
      "Engaged members",
      931,
      "Adhitia Erfina",
      "63.7%",
      "42.5%",
      "15:30",
    ],
  ];
  return subjects.map(([subject, to, subscribers, author, opens, clicks, hhmm], i) => ({
    id: `nl-s${String(i + 1).padStart(2, "0")}`,
    subject,
    to,
    subscribers,
    status: "sent",
    author,
    createdAt: daysFromNow(-28 + i * 2),
    sentAt: daysFromNowAt(-27 + i * 2, hhmm),
    opens,
    clicks,
    body: `Kabar ${subject.toLowerCase()} untuk seluruh anggota kawasan Asia-Oseania.`,
  }));
}

/** Scheduled campaigns — due to go out over the next few days. */
function scheduledSeed(): NewsletterItem[] {
  const subjects: ReadonlyArray<[string, string, number, string, string]> = [
    // subject, audience segment, recipients, author, time
    [
      "Tanya-Jawab PPID: Kirim Pertanyaan Anda",
      "All subscribers",
      1_186,
      "Nevyllo Kalangi",
      "08:30",
    ],
    [
      "Agenda November 2026 — Kalender Kawasan",
      "All subscribers",
      1_186,
      "Adhitia Erfina",
      "10:00",
    ],
    ["Pengumuman Hasil Seleksi Program Magang", "New members", 356, "Nevyllo Kalangi", "13:45"],
    ["Kampanye Kesadaran Open Data — Minggu 2", "Media contacts", 223, "Adhitia Erfina", "09:15"],
    [
      "Tech Talk: Arsitektur Portal Keterbukaan",
      "Board & committee",
      118,
      "Nevyllo Kalangi",
      "14:30",
    ],
    ["Rekrutmen Relawan Humas Kawasan", "Local PPI chapters", 689, "Adhitia Erfina", "11:10"],
    ["Newsletter Edisi November 2026", "All subscribers", 1_186, "Nevyllo Kalangi", "16:20"],
  ];
  return subjects.map(([subject, to, subscribers, author, hhmm], i) => ({
    id: `nl-sc${String(i + 1).padStart(2, "0")}`,
    subject,
    to,
    subscribers,
    status: "scheduled",
    author,
    createdAt: daysFromNow(-Math.min(i, 6)),
    scheduledFor: daysFromNowAt(1 + i, hhmm),
    opens: "—",
    clicks: "—",
    body: "",
  }));
}

/** Draft campaigns — still being written. */
function draftSeed(): NewsletterItem[] {
  const subjects: ReadonlyArray<[string, string, string, string]> = [
    // subject, author, opens, clicks
    ["Draft: Kolom Opini — Memperkuat Keterbukaan", "Nevyllo Kalangi", "—", "—"],
    ["Draft: Infografis Alur Permohonan Informasi", "Adhitia Erfina", "—", "—"],
    ["Draft: Ucapan Hari Anggota 2026", "Nevyllo Kalangi", "—", "—"],
    ["Draft: Sinergi PPI Lokal dan Nasional", "Adhitia Erfina", "—", "—"],
    ["Draft: Liputan Kegiatan PPID di Media", "Nevyllo Kalangi", "—", "—"],
    ["Draft: Undangan Rapat Pleno Tahunan", "Adhitia Erfina", "—", "—"],
    ["Draft: Catatan Perjalanan — Australia", "Nevyllo Kalangi", "—", "—"],
  ];
  return subjects.map(([subject, author], i) => ({
    id: `nl-d${String(i + 1).padStart(2, "0")}`,
    subject,
    to: "All subscribers",
    subscribers: 1_186,
    status: "draft",
    author,
    createdAt: daysFromNow(-12 + i),
    opens: "—",
    clicks: "—",
    body: "",
  }));
}

/** Seed list — 24 campaigns: sent / scheduled / drafts, newest-created first. */
export const INITIAL_NEWSLETTERS: NewsletterItem[] = [
  ...sentSeed(),
  ...scheduledSeed(),
  ...draftSeed(),
];

/* ==================================================================
   Subscribers — the people on the newsletter list. Shown on the
   "Subscribers" tab of the Newsletter page (Figma "NEWSLETTER >
   SUBSCRIBERS" screens): table = Subscriber | PPI Country | Joined,
   footer "Showing 1–10 of 112". Static seed, client-side only.
   ================================================================== */

export type SubscriberStatus = "active" | "unsubscribed";

export interface SubscriberItem {
  id: string;
  name: string;
  email: string;
  /** PPI chapter / country of the subscriber, e.g. "Indonesia". */
  country: string;
  status: SubscriberStatus;
  /** ISO subscription date. */
  subscribed: string;
  /** ISO date of the last email they opened (null = never opened). */
  lastOpen: string | null;
  /** Share of the last 5 campaigns they opened, e.g. "52.1%". */
  opensRate: string;
}

const SUB_FIRST = [
  "Aditya",
  "Bunga",
  "Citra",
  "Dewa",
  "Elang",
  "Fitri",
  "Galih",
  "Hana",
  "Irfan",
  "Juwita",
  "Kartika",
  "Lukman",
  "Maya",
  "Nadia",
  "Oscar",
  "Putri",
  "Qodri",
  "Rizky",
  "Salsabila",
  "Teuku",
  "Umar",
  "Vina",
  "Wulan",
  "Yoga",
];

const SUB_LAST = [
  "Pratama",
  "Lestari",
  "Saputra",
  "Hidayat",
  "Wijaya",
  "Nugroho",
  "Anggraini",
  "Kurniawan",
  "Puspitasari",
  "Santoso",
  "Ramadhan",
  "Halim",
  "Sari",
  "Gunawan",
  "Maulana",
  "Utami",
  "Firmansyah",
  "Handayani",
];

const SUB_DOMAINS = ["gmail.com", "yahoo.com", "outlook.com", "asiania.id"];

/** PPI chapters (Asia & Oceania region) the subscribers registered from —
    "PPI Country" column, prefixed "PPI" like the Figma rows. */
const SUB_COUNTRIES = [
  "PPI Jepang",
  "PPI Korea",
  "PPI Tiongkok",
  "PPI Taiwan",
  "PPI Hong Kong",
  "PPI Singapura",
  "PPI Malaysia",
  "PPI Thailand",
  "PPI Vietnam",
  "PPI Filipina",
  "PPI Australia",
  "PPI Selandia Baru",
];

/** Deterministic 112 subscribers — a seeded LCG keeps the preview stable
    (no Math.random), matching the Figma footer "Showing 1–10 of 112". */
function subscribersSeed(): SubscriberItem[] {
  const list: SubscriberItem[] = [];
  let s = 42;
  for (let i = 0; i < 112; i++) {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    const first = SUB_FIRST[s % SUB_FIRST.length]!;
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    const last = SUB_LAST[s % SUB_LAST.length]!;
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    const domain = SUB_DOMAINS[s % SUB_DOMAINS.length]!;
    const email = `${first.toLowerCase()}.${last.toLowerCase()}-${i}@${domain}`;
    // Even spread so the first page shows a full mix of PPI countries
    // (the LCG's residues collapse to 3 values mod 12, so it is not used).
    const country = SUB_COUNTRIES[i % SUB_COUNTRIES.length]!;

    const unsubscribed = s % 9 === 0; // ~11% unsubscribed
    const subscribedOffset = 30 + (s % 1800); // 30..1829 days before BASE
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    const lastOpenOffset = Math.max(0, subscribedOffset - (1 + (s % 60)));
    const opensRate = `${(20 + (s % 500) / 10).toFixed(1)}%`;

    list.push({
      id: `sub-${String(i + 1).padStart(3, "0")}`,
      name: `${first} ${last}`,
      email,
      country,
      status: unsubscribed ? "unsubscribed" : "active",
      subscribed: daysFromNow(-subscribedOffset),
      lastOpen: unsubscribed ? null : daysFromNow(-lastOpenOffset),
      opensRate: unsubscribed ? "—" : opensRate,
    });
  }
  return list;
}

export const INITIAL_SUBSCRIBERS: SubscriberItem[] = subscribersSeed();
