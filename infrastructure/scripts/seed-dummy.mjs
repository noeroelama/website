/**
 * seed-dummy.mjs — data dummy untuk dev (DB lokal `preview`).
 *
 * Menulis events + galleries lewat API dokumen yang sama dengan kode produksi
 * (batch.set → tabel `(id, data JSON, dates JSON)` + pointer slug), jadi struktur
 * tabel dan bentuk dokumen persis seperti data admin; saat data asli masuk,
 * tidak ada yang perlu diubah. Idempoten: id tetap (dummy-event-001 …), ditulis ulang.
 *
 *   set -a; source apps/web/.env.local; set +a
 *   node --experimental-strip-types --import ./infrastructure/scripts/ts-register.mjs \
 *     infrastructure/scripts/seed-dummy.mjs
 */
import { getDatabase } from "../../packages/db/src/sql/store.ts";

if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL (source apps/web/.env.local first).");
  process.exit(2);
}

const db = getDatabase({ url: process.env.DATABASE_URL });
const now = new Date();

/** Banner seperti foto negara public/home/N.png, dipakai apa adanya (path statis lokal). */
const img = (n, w = 1200, h = 580) => ({
  url: `/home/${n}.png`,
  thumbUrl: `/home/${n}.png`,
  path: "dummy",
  thumbPath: "dummy",
  width: w,
  height: h,
});

const schedule = (rows) => rows.map(([time, title, description]) => ({ time, title, description }));

const SPEAKER_ROLES = [
  "Founder • Cultural Artist",
  "Co-Founder • Tech Entrepreneur",
  "Director • Education Program",
  "Lead Curator • Museum of Modern Art",
  "Partner • Design Studio",
  "Head of Research • Policy Institute",
];

const speakers = (names) =>
  names.map((name, i) => ({
    name,
    description: SPEAKER_ROLES[i % SPEAKER_ROLES.length], // "Founder • Cultural Artist" (user)
    photo: img(1 + (i % 14)), // setiap speaker punya foto (user)
  }));

/* Dummy logos removed (user): the "Our Network & Partners" section stays on page
   with an empty logo row, so the design does not show broken images. */
const sponsors = () => [];

/* Lorem ipsum yang agak panjang (user) untuk bagian "About"; konten asli datang dari admin. */
const DESCRIPTION =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Maecenas tincidunt odio quis purus " +
  "dapibus, nec volutpat lacus posuere. Donec a justo vel nisl elementum viverra at vitae nibh. " +
  "Sed semper lacus ac magna commodo, vitae dignissim velit tincidunt. Nulla facilisi. Vestibulum " +
  "ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Proin sed nisi " +
  "imperdiet, egestas sem nec, lobortis nibh. Curabitur nec nisi at odio tincidunt feugiat eu at " +
  "leo. Aliquam erat volutpat. Phasellus id justo vitae arcu aliquet pharetra in sed ligula.\n\n" +
  "Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. " +
  "Integer venenatis, arcu vitae faucibus tincidunt, risus tortor convallis libero, et blandit " +
  "metus nisi sed erat. Cras luctus odio a erat fringilla, sit amet sodales sem tincidunt. " +
  "Suspendisse potenti. Aenean ut erat maximus, scelerisque augue eget, laoreet erat. Ut sed " +
  "laoreet tellus, ac tincidunt arcu. Nunc rhoncus, mi vitae varius facilisis, lorem libero " +
  "aliquet neque, eget aliquam enim nunc ac felis.\n\n" +
  "Fusce vel nibh ipsum. Quisque bibendum, dolor id dictum cursus, est arcu gravida magna, ut " +
  "viverra tortor purus vitae neque. Maecenas maximus magna sit amet felis fermentum semper. " +
  "Pellentesque euismod nunc vel nisi porta, sed efficitur dui luctus.";

/** Satu event dummy; id tetap supaya skrip idempoten. */
function event(id, slug, fields) {
  return {
    ref: `events/${id}`,
    slugRef: `eventSlugs/${slug}`,
    data: {
      slug,
      title: fields.title,
      summary: fields.summary ?? "Ringkasan singkat kegiatan (dummy).",
      startsAt: fields.startsAt,
      endsAt: fields.endsAt ?? null,
      timezone: fields.timezone ?? "Asia/Jakarta",
      location: fields.location ?? "Jakarta, Indonesia",
      chapterId: null,
      published: fields.published ?? true,
      capacity: fields.capacity ?? null,
      registrationClosesAt: fields.registrationClosesAt ?? null,
      type: fields.type,
      description: fields.description ?? DESCRIPTION,
      bannerImage: img(fields.photo ?? 1),
      registrationUrl: null,
      schedule: fields.schedule ?? [],
      speakers: fields.speakers ?? [],
      sponsors: sponsors(),
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
  };
}

const EVENTS = [
  event("dummy-event-001", "kongres-ppi-asia-oceania-2026", {
    title: "Kongres PPI Asia-Oseania 2026",
    type: "conference",
    startsAt: new Date("2026-12-05T09:00:00+07:00"),
    endsAt: new Date("2026-12-07T17:00:00+07:00"),
    location: "Jakarta, Indonesia",
    photo: 5,
    schedule: schedule([
      ["09:00", "Opening Ceremony & National Anthem", "Remarks by the host chapter."],
      ["10:30", "Keynote Address", "Welcome speech by invited guests."],
      ["13:30", "Panel Discussion", "Moderated Q&A with the speakers."],
    ]),
    speakers: speakers(["Budi Setiawan", "Siti Rahayu"]),
  }),
  event("dummy-event-002", "malam-kebudayaan-indonesia", {
    title: "Malam Kebudayaan Indonesia",
    type: "festival",
    startsAt: new Date("2026-11-28T18:00:00+08:00"),
    timezone: "Asia/Kuala_Lumpur",
    endsAt: new Date("2026-11-28T22:00:00+08:00"),
    location: "Kuala Lumpur, Malaysia",
    photo: 6,
    schedule: schedule([
      ["18:00", "Opening Ceremony & National Anthem", "Remarks by the host chapter."],
      ["20:00", "Cultural Performance", "Traditional dances and music."],
    ]),
    speakers: speakers(["Sari Dewi"]),
  }),
  event("dummy-event-003", "seminar-karier-diaspora", {
    title: "Seminar Karier untuk Mahasiswa Diaspora",
    type: "seminar",
    startsAt: new Date("2026-11-20T10:00:00+07:00"),
    endsAt: new Date("2026-11-20T13:00:00+07:00"),
    location: "Jakarta (Webinar)",
    photo: 9,
    schedule: schedule([["10:00", "Keynote Address", "Welcome speech by invited guests."]]),
    speakers: speakers(["Andi Wijaya", "Maria Chen"]),
  }),
  event("dummy-event-004", "lokakarya-jurnalistik", {
    title: "Lokakarya Jurnalistik Mahasiswa",
    type: "workshop",
    startsAt: new Date("2026-11-15T09:00:00+08:00"),
    endsAt: new Date("2026-11-15T16:00:00+08:00"),
    location: "Beijing, Tiongkok",
    photo: 8,
    schedule: schedule([
      ["09:00", "Opening Ceremony", "Flag ceremony and anthem."],
      ["13:00", "Parallel Sessions", "Breakout meetings per division."],
    ]),
    speakers: speakers(["Rina Kusuma"]),
  }),
  event("dummy-event-005", "diskusi-startup-ekonomi-digital", {
    title: "Diskusi Panel: Startup & Ekonomi Digital",
    type: "discussion",
    startsAt: new Date("2026-12-12T14:00:00+08:00"),
    endsAt: new Date("2026-12-12T17:00:00+08:00"),
    location: "Singapore",
    photo: 3,
    schedule: schedule([["14:00", "Panel Discussion", "Moderated Q&A with the speakers."]]),
    speakers: speakers(["Dewi Lestari", "Kevin Santoso"]),
  }),
  event("dummy-event-006", "festival-film-pelajar", {
    title: "Festival Film Pelajar Indonesia",
    type: "festival",
    startsAt: new Date("2026-12-20T13:00:00+09:00"),
    endsAt: new Date("2026-12-20T17:00:00+09:00"),
    location: "Tokyo, Jepang",
    photo: 11,
    schedule: schedule([["13:00", "Cultural Performance", "Traditional dances and music."]]),
    speakers: speakers(["Angga Pratama", "Laras Sekar"]),
  }),
  event("dummy-event-007", "pertemuan-anggota-tahunan", {
    title: "Pertemuan Anggota Tahunan",
    type: "meeting",
    startsAt: new Date("2027-01-15T10:00:00+07:00"),
    endsAt: new Date("2027-01-15T12:00:00+07:00"),
    location: "Bangkok, Thailand",
    photo: 4,
    schedule: schedule([["10:00", "Plenary Session", "Joint session with all delegates."]]),
    speakers: speakers(["Ketua PPI Dunia"]),
  }),
  event("dummy-event-008", "pekan-olahraga-pelajar-2025", {
    title: "Pekan Olahraga Pelajar 2025",
    type: "event",
    startsAt: new Date("2025-09-10T08:00:00+10:00"),
    endsAt: new Date("2025-09-10T17:00:00+10:00"),
    location: "Sydney, Australia",
    photo: 2,
    schedule: schedule([["08:00", "Opening Ceremony", "Flag ceremony and anthem."]]),
    speakers: speakers(["Rendy Saputra"]),
  }),
  // Webinar: published supaya setiap pill pada halaman publik ada datanya.
  event("dummy-event-009", "webinar-beasiswa", {
    title: "Webinar Persiapan Beasiswa",
    type: "webinar",
    startsAt: new Date("2026-12-01T19:00:00+07:00"),
    endsAt: new Date("2026-12-01T21:00:00+07:00"),
    location: "Online",
    photo: 7,
    schedule: schedule([["19:00", "Panel Discussion", "Moderated Q&A with the speakers."]]),
    speakers: speakers(["Prof. Bambang"]),
  }),
];

// Bulk data beragam: tanggal tersebar (16 lampau, 12 dalam 7 hari, 24 dalam 30 hari,
// 68 ke depan) supaya combobox Rentang Waktu (upcoming/week/month) semuanya punya isi;
// lokasi 16 negara agar combobox Country beragam; zona waktu, tipe, judul, deskripsi,
// foto, dan durasi juga diputar. Id/slug tetap → skrip tetap idempoten.
const THEMES = [
  "Semiloka",
  "Rapat Kerja",
  "Diskusi",
  "Festival",
  "Webinar",
  "Pelatihan",
  "Sidang",
  "Turnamen",
];
const FOCUS = [
  "Kepemimpinan",
  "Kewirausahaan",
  "Kebudayaan",
  "Keanggotaan",
  "Karier",
  "Olahraga",
  "Teknologi",
  "Beasiswa",
];

const BULK_CITIES = [
  "Jakarta, Indonesia",
  "Surabaya, Indonesia",
  "Yogyakarta, Indonesia",
  "Singapore",
  "Kuala Lumpur, Malaysia",
  "Tokyo, Jepang",
  "Beijing, Tiongkok",
  "Shanghai, Tiongkok",
  "Sydney, Australia",
  "Bangkok, Thailand",
  "Manila, Filipina",
  "Seoul, Korea Selatan",
  "Taipei, Taiwan",
  "Hanoi, Vietnam",
  "Phnom Penh, Kamboja",
  "Auckland, Selandia Baru",
];
const ZONES = [
  "Asia/Jakarta",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Asia/Bangkok",
  "Asia/Manila",
];
// Pembicara & jadwal untuk bulk events: diputar supaya tiap halaman detail selalu
// menampilkan bagian "Guest Speaker" dan "Event schedule" (tidak pernah kosong).
const BULK_SPEAKERS = [
  speakers(["Budi Setiawan", "Siti Rahayu"]),
  speakers(["Andi Wijaya", "Maria Chen", "Rina Kusuma"]),
  speakers(["Kevin Santoso"]),
  speakers(["Prof. Bambang", "Dewi Lestari"]),
  speakers(["Rina Kusuma", "Andi Wijaya", "Kevin Santoso"]),
];
const BULK_SCHEDULES = [
  schedule([
    ["09:00", "Opening Ceremony & National Anthem", "Remarks by the host chapter."],
    ["10:30", "Keynote Address", "Welcome speech by invited guests."],
    ["13:00", "Panel Discussion", "Moderated Q&A with the speakers."],
  ]),
  schedule([
    ["14:00", "Cultural Performance", "Traditional dances and music."],
    ["16:30", "Closing Ceremony", "Group photo and closing remarks."],
  ]),
  schedule([
    ["10:00", "Opening Ceremony", "Flag ceremony and anthem."],
    ["11:30", "Parallel Sessions", "Breakout meetings per division."],
    ["14:30", "Networking Session", "Coffee break and mingling."],
  ]),
  schedule([
    ["08:30", "Registration & Welcome", "Badge pick-up and refreshments."],
    ["09:30", "Plenary Session", "Joint session with all delegates."],
    ["15:00", "Award Giving & Closing", "Certificate handover."],
  ]),
];

const BULK = Array.from({ length: 120 }, (_, i) => {
  const n = i + 100;
  let startsAt;
  if (i < 16) {
    // Lampau: Jul 2025 – Okt 2026 (judul "Seminar/Lokakarya" agar terasa berjarak).
    startsAt = new Date("2025-07-01T09:00:00+07:00");
    startsAt.setMonth(startsAt.getMonth() + i);
  } else if (i < 28) {
    // 7 hari ke depan: 5–16 Nov 2026 → preset "Minggu ini" ada isinya.
    startsAt = new Date("2026-11-05T09:00:00+07:00");
    startsAt.setDate(startsAt.getDate() + i - 16);
  } else if (i < 52) {
    // 30 hari ke depan: 5–28 Nov 2026 → preset "Bulan ini" ada isinya.
    startsAt = new Date("2026-11-05T09:00:00+07:00");
    startsAt.setDate(startsAt.getDate() + i - 28);
  } else {
    // Sesudahnya: Jan 2027 – Jun 2029 (modulo 30 → beberapa event juga di 2029,
    // sehingga pilihan "Tahun ini" punya data variatif lintas tahun).
    startsAt = new Date("2027-01-15T09:00:00+07:00");
    startsAt.setMonth(startsAt.getMonth() + ((i - 52) % 30));
  }
  // Semua event punya jam selesai (durasi 2-8 jam) supaya meta detail menampilkan
  // rentang seperti desain: "9:00 AM - 5:00 PM".
  const endsAt = new Date(startsAt.getTime() + 3_600_000 * (2 + (i % 7)));
  const title = `${THEMES[i % THEMES.length]} ${FOCUS[(i >> 3) % FOCUS.length]}`;
  return event(`dummy-event-${n}`, `kegiatan-dummy-${n}`, {
    title,
    type: [
      "conference",
      "festival",
      "seminar",
      "workshop",
      "discussion",
      "meeting",
      "event",
      "webinar",
    ][i % 8],
    startsAt,
    endsAt,
    timezone: ZONES[i % ZONES.length],
    location: BULK_CITIES[i % BULK_CITIES.length],
    photo: (i % 14) + 1,
    speakers: BULK_SPEAKERS[i % BULK_SPEAKERS.length],
    schedule: BULK_SCHEDULES[(i >> 1) % BULK_SCHEDULES.length],
  });
});

const ALL_EVENTS = [...EVENTS, ...BULK];

/** Album dummy: snapshot tipe/tanggal/lokasi event (field yang dipakai bar filter
 * /gallery — sama persis dengan panel /events). totalPhotos = jumlah foto pilihan. */
function album(id, slug, fields) {
  return {
    ref: `galleries/${id}`,
    slugRef: `gallerySlugs/${slug}`,
    data: {
      slug,
      eventId: fields.eventId,
      eventTitle: fields.eventTitle,
      eventType: fields.eventType,
      eventStartsAt: fields.eventStartsAt,
      eventTimezone: fields.eventTimezone,
      eventLocation: fields.eventLocation,
      eventDescription: fields.eventDescription,
      images: fields.images,
      totalPhotos: fields.totalPhotos ?? fields.images.length,
      albumUrl: "https://drive.google.com/drive/folders/dummy-album",
      published: fields.published ?? true,
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
  };
}

/** Album yang menaut ke dokumen event dummy (eventId + snapshot dari data event). */
const EV_BY_SLUG = Object.fromEntries(EVENTS.map((e) => [e.data.slug, e]));
const albumFor = (id, slug, eventId, doc, photoNums, opts = {}) => {
  // Tepat 3 foto untuk semua record (user): layout detail = 1 lebar kiri + 2 kanan.
  // Kurang dari 3 → diisi, lebih → dipangkas (display juga membatasi 3).
  const nums = [...new Set(photoNums)];
  for (let n = 1; nums.length < 3 && n <= 14; n += 1) {
    if (!nums.includes(n)) nums.push(n);
  }
  nums.length = 3;
  return album(id, slug, {
    eventId,
    eventTitle: doc.data.title,
    eventType: doc.data.type,
    eventStartsAt: doc.data.startsAt,
    eventTimezone: doc.data.timezone,
    eventLocation: doc.data.location,
    eventDescription: doc.data.description,
    images: nums.map((n) => img(n)),
    published: opts.published ?? true,
  });
};

// Album tersebar lintas waktu & negara supaya tiap filter panel (/gallery, sama
// dengan /events) punya isi: lampau, minggu/bulan ini (Nov 2026), tahun ini,
// dan tahun depan; 10 negara; dan beragam tipe untuk pill kategori.
const ALBUMS = [
  albumFor(
    "dummy-album-001",
    "album-malam-budaya-2025",
    "dummy-event-002",
    EV_BY_SLUG["malam-kebudayaan-indonesia"],
    [6, 12, 13],
  ),
  albumFor(
    "dummy-album-002",
    "album-kongres-2026",
    "dummy-event-001",
    EV_BY_SLUG["kongres-ppi-asia-oceania-2026"],
    [5, 14],
  ),
  // Draft album: tidak muncul di publik.
  albumFor(
    "dummy-album-003",
    "album-seminar-karir-draft",
    "dummy-event-003",
    EV_BY_SLUG["seminar-karier-diaspora"],
    [9],
    { published: false },
  ),

  albumFor(
    "dummy-album-004",
    "album-olahraga-sydney-2025",
    "dummy-event-008",
    EV_BY_SLUG["pekan-olahraga-pelajar-2025"],
    [2, 1],
  ),
  albumFor(
    "dummy-album-005",
    "album-lokakarya-beijing-2026",
    "dummy-event-004",
    EV_BY_SLUG["lokakarya-jurnalistik"],
    [8, 13, 5, 3],
  ),
  albumFor(
    "dummy-album-006",
    "album-seminar-karier-2026",
    "dummy-event-003",
    EV_BY_SLUG["seminar-karier-diaspora"],
    [9, 4],
  ),
  albumFor(
    "dummy-album-007",
    "album-webinar-beasiswa-2026",
    "dummy-event-009",
    EV_BY_SLUG["webinar-beasiswa"],
    [7, 10],
  ),
  albumFor(
    "dummy-album-008",
    "album-festival-film-tokyo-2026",
    "dummy-event-006",
    EV_BY_SLUG["festival-film-pelajar"],
    [11, 6, 14],
  ),
  albumFor(
    "dummy-album-009",
    "album-diskusi-startup-2026",
    "dummy-event-005",
    EV_BY_SLUG["diskusi-startup-ekonomi-digital"],
    [3, 8, 11],
  ),
  albumFor(
    "dummy-album-010",
    "album-pertemuan-bangkok-2027",
    "dummy-event-007",
    EV_BY_SLUG["pertemuan-anggota-tahunan"],
    [4, 12],
  ),

  // Bulk events (tanggal/lokasi/tipe mengikuti BULK[i] — lihat komentar di atas).
  ...(() => {
    const picks = [8, 20, 44, 90];
    return picks.map((i, k) => {
      const { id, doc } = { id: `dummy-event-${i + 100}`, doc: BULK[i] };
      const slug = doc.data.slug.replace(/^kegiatan-/, "album-kegiatan-");
      return albumFor(`dummy-album-${String(11 + k).padStart(3, "0")}`, slug, id, doc, [
        1 + ((i + k * 3) % 14),
        1 + ((i + k * 5 + 2) % 14),
      ]);
    });
  })(),

  // +30 album lagi (user): semua event bulk yang tersisa (16 lampau + 74 ke depan)
  // mendapat album → 43 published → pager bernomor muncul, sama dengan /events.
  // Sisa 90 event tanpa album biar tetap ada acara tanpa galeri.
  ...(() => {
    const rest = Array.from({ length: 120 }, (_, i) => i).filter(
      (i) => ![8, 20, 44, 90].includes(i),
    );
    const step = Math.floor(rest.length / 30); // 90/30 = 3 → setiap event ke-3
    return Array.from({ length: 30 }, (_, k) => {
      const i = rest[k * step];
      const { id, doc } = { id: `dummy-event-${i + 100}`, doc: BULK[i] };
      const slug = doc.data.slug.replace(/^kegiatan-/, "album-kegiatan-");
      return albumFor(`dummy-album-${String(41 + k).padStart(3, "0")}`, slug, id, doc, [
        1 + ((i + k * 7) % 14),
        1 + ((i + k * 11 + 3) % 14),
      ]);
    });
  })(),
];

// ---- News dummy (content kind "news") ----
// 18 berita → /news berisi (12 per halaman, pager bernomor seperti events/gallery).
// Kategori (manual per judul, lihat NEWS_CATEGORIES di bawah), tanggal terbit,
// penulis, dan tag dirotasi dari daftar di bawah.
const NEWS_TITLES = [
  "Kongres PPI Asia-Oseania 2026 Resmi Dibuka",
  "Jaringan Diaspora Luncurkan Beasiswa Baru",
  "Seminar Karier: Peluang Kerja di Asia Timur",
  "Festival Kebudayaan Indonesia Meriahkan Kuala Lumpur",
  "Hasil Riset: Startup Diaspora Tumbuh 40%",
  "Pelatihan Kepemimpinan untuk Mahasiswa Baru",
  "Webinar Beasiswa Lanjut Studi di Jepang",
  "Kolaborasi PPI Se-Nusantara untuk Literasi Digital",
  "Turnamen Olahraga Antar Pelajar Kembali Digelar",
  "Workshop Jurnalistik: Menulis Kisah Diaspora",
  "Pertemuan Anggota Tahunan PPI Asiania",
  "Program Mentoring Karier untuk Anggota Muda",
  "Podcast Baru: Cerita dari Seluruh Asiania",
  "Kampanye Kebersihan Pantai oleh PPI Sydney",
  "Diskusi Panel: Ekonomi Digital Indonesia",
  "Penghargaan untuk Relawan PPI Asiania",
  "Sekolah Bahasa Indonesia di Tokyo Dibuka",
  "Laporan Tahunan PPI Asiania 2025 Terbit",
];
const NEWS_AUTHORS = [
  "Redaksi PPIDK",
  "Budi Setiawan",
  "Siti Rahayu",
  "Rina Kusuma",
  "Dewi Lestari",
];
const NEWS_LOCATIONS = [
  "Jakarta, Indonesia",
  "Singapore",
  "Kuala Lumpur, Malaysia",
  "Tokyo, Jepang",
  "Beijing, Tiongkok",
  "Bangkok, Thailand",
  "Sydney, Australia",
  "Seoul, Korea Selatan",
];
const NEWS_TAG_LISTS = [
  ["kongres"],
  ["beasiswa"],
  ["karier", "webinar"],
  ["kebudayaan"],
  ["startup"],
  ["kepemimpinan"],
  ["beasiswa"],
  ["literasi"],
  ["olahraga"],
  ["jurnalistik"],
  ["keanggotaan"],
  ["mentoring"],
  ["podcast"],
  ["sosial"],
  ["ekonomi"],
  ["penghargaan"],
  ["pendidikan"],
  ["laporan"],
];
// Kategori = tipe kegiatan, persis pill events/gallery (Seminar/Workshop/Webinar/
// Conference/Meetup/Lainnya) — ditentukan manual per judul agar tiap pill ada isinya.
const NEWS_CATEGORIES = [
  "conference", // 1. Kongres PPI Asia-Oseania 2026 Resmi Dibuka
  "other", // 2. Jaringan Diaspora Luncurkan Beasiswa Baru
  "seminar", // 3. Seminar Karier: Peluang Kerja di Asia Timur
  "other", // 4. Festival Kebudayaan Indonesia Meriahkan Kuala Lumpur
  "other", // 5. Hasil Riset: Startup Diaspora Tumbuh 40%
  "workshop", // 6. Pelatihan Kepemimpinan untuk Mahasiswa Baru
  "webinar", // 7. Webinar Beasiswa Lanjut Studi di Jepang
  "other", // 8. Kolaborasi PPI Se-Nusantara untuk Literasi Digital
  "other", // 9. Turnamen Olahraga Antar Pelajar Kembali Digelar
  "workshop", // 10. Workshop Jurnalistik: Menulis Kisah Diaspora
  "meeting", // 11. Pertemuan Anggota Tahunan PPI Asiania
  "workshop", // 12. Program Mentoring Karier untuk Anggota Muda
  "other", // 13. Podcast Baru: Cerita dari Seluruh Asiania
  "other", // 14. Kampanye Kebersihan Pantai oleh PPI Sydney
  "meeting", // 15. Diskusi Panel: Ekonomi Digital Indonesia
  "other", // 16. Penghargaan untuk Relawan PPI Asiania
  "workshop", // 17. Sekolah Bahasa Indonesia di Tokyo Dibuka
  "other", // 18. Laporan Tahunan PPI Asiania 2025 Terbit
];
// Isi berita: lorem ipsum lengkap (7 paragraf, teks klasik utuh) — halaman artikel
// menampilkan teks sampai mentok kanan, jadi body-nya dibuat panjang (user).
const NEWS_BODY = [
  "<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.</p>",
  "<p>Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo. Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt. Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit, sed quia non numquam eius modi tempora incidunt ut labore et dolore magnam aliquam quaerat voluptatem.</p>",
  "<p>Ut enim ad minima veniam, quis nostrum exercitationem ullam corporis suscipit laboriosam, nisi ut aliquid ex ea commodi consequatur? Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse quam nihil molestiae consequatur, vel illum qui dolorem eum fugiat quo voluptas nulla pariatur?</p>",
  "<p>At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident, similique sunt in culpa qui officia deserunt mollitia animi, id est laborum et dolorum fuga. Et harum quidem rerum facilis est et expedita distinctio. Nam libero tempore, cum soluta nobis est eligendi optio cumque nihil impedit quo minus id quod maxime placeat facere possimus, omnis voluptas assumenda est, omnis dolor repellendus.</p>",
  "<p>Temporibus autem quibusdam et aut officiis debitis aut rerum necessitatibus saepe eveniet ut et voluptates repudiandae sint et molestiae non recusandae. Itaque earum rerum hic tenetur a sapiente delectus, ut aut reiciendis voluptatibus maiores alias consequatur aut perferendis doloribus asperiores repellat.</p>",
  "<p>On the other hand, we denounce with righteous indignation and dislike men who are so beguiled and demoralized by the charms of pleasure of the moment, so blinded by desire, that they cannot foresee the pain and trouble that are bound to ensue; and equal blame belongs to those who fail in their duty through weakness of will, which is the same as saying through shrinking from toil and pain. These cases are perfectly simple and easy to distinguish. In a free hour, when our power of choice is untrammelled and when nothing prevents our being able to do what we like best, every pleasure is to be welcomed and every pain avoided. But in certain circumstances and owing to the claims of duty or the obligations of business it will frequently occur that pleasures have to be repudiated and annoyances accepted. The wise man therefore always holds in these matters to this principle of selection: he rejects pleasures to secure other greater pleasures, or else he endures pains to avoid worse pains.</p>",
  "<p>But I must explain to you how all this mistaken idea of denouncing pleasure and praising pain was born and I will give you a complete account of the system, and expound the actual teachings of the great explorer of the truth, the master-builder of human happiness. No one rejects, dislikes, or avoids pleasure itself, because it is pleasure, but because those who do not know how to pursue pleasure rationally encounter consequences that are extremely painful. Nor again is there anyone who loves or pursues or desires to obtain pain of itself, because it is pain, but because occasionally circumstances occur in which toil and pain can procure him some great pleasure. To take a trivial example, which of us ever undertakes laborious physical exercise, except to obtain some advantage from it? But who has any right to find fault with a man who chooses to enjoy a pleasure that has no annoying consequences, or one who avoids a pain that produces no resultant pleasure?</p>",
].join("");
const NEWS = Array.from({ length: 18 }, (_, i) => {
  const n = i + 1;
  const slug = `berita-dummy-${String(n).padStart(3, "0")}`;
  // Tanggal terbit tersebar agar preset Rentang Waktu (minggu/minggu lalu, 30 hari
  // terakhir, tahun berjalan) semuanya punya isi: 4 terbit 7 hari terakhir
  // (28 Okt–4 Nov 2026), 4 lagi 30 hari terakhir, 10 lainnya di 2026.
  const today = new Date("2026-11-04T09:00:00+07:00");
  const publishAt = new Date(today);
  if (i < 4) publishAt.setDate(publishAt.getDate() - [0, 2, 4, 6][i]);
  else if (i < 8) publishAt.setDate(publishAt.getDate() - [10, 15, 22, 28][i - 4]);
  else publishAt.setMonth(publishAt.getMonth() - (i - 7) * 1); // Mei 2026 s/d Okt 2026
  return {
    ref: `content/dummy-news-${String(n).padStart(3, "0")}`,
    slugRef: `contentSlugs/news_${slug}`,
    data: {
      slug,
      kind: "news",
      title: NEWS_TITLES[i],
      body: NEWS_BODY,
      status: "published",
      publishAt,
      chapterId: null,
      author: NEWS_AUTHORS[i % NEWS_AUTHORS.length],
      category: NEWS_CATEGORIES[i],
      location: NEWS_LOCATIONS[i % NEWS_LOCATIONS.length],
      summary: `${NEWS_TITLES[i]}. Lorem ipsum dolor sit amet, consectetur adipiscing elit.`,
      tags: NEWS_TAG_LISTS[i],
      featuredImage: img(1 + (i % 14)),
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
  };
});

// ---- PPI Negara (chapters) dummy ----
// Mengisi tabel PPI di /map (dan titik peta interaktif About/Profile). 17 negara
// persis daftar desain side.svg, urutan nomor registry (nomor bukan urut region —
// lihat Vietnam 14, Kazakhstan 13, Bangladesh 16). `region` memakai kode kelompok
// tabel /map; Thailand dan Korea Selatan memakai alias PERMITHA/PERPIKA di baris
// yang sama (contoh user).
const CHAPTERS = [
  // NZ is the demo chapter of the detail page (user) — full public profile.
  {
    code: "NZ",
    name: "PPI Selandia Baru",
    region: "oceania",
    no: 1,
    contactName: "Budi Setiawan",
    role: "Ketua",
    email: "selandiabaru@example.com",
    phone: "+00 000 0000 000",
    instagram: "@ppiselandiabaru",
    website: "https://ppiselandiabaru.nz",
    socials: [
      { label: "YouTube", url: "https://youtube.com/@ppiselandiabaru" },
      { label: "TikTok", url: "https://tiktok.com/@ppiselandiabaru" },
    ],
    logo: img(10),
    description:
      "New Zealand is an island country in the South Pacific Ocean and the southwesternmost " +
      "part of Polynesia. It lies more than 1,000 miles (1,600 km) southeast of Australia, its " +
      "nearest neighbor. The country has two main islands, the North Island and the South " +
      "Island, plus many smaller islands. Its capital is Wellington, and its largest city is " +
      "Auckland.",
  },
  { code: "AU", name: "PPIA", region: "oceania", no: 2 },
  { code: "MY", name: "PPI Malaysia", region: "southeastAsia", no: 3 },
  { code: "SG", name: "PPI Singapura", region: "southeastAsia", no: 4 },
  { code: "TH", name: "PERMITHA", region: "southeastAsia", no: 5 },
  { code: "PH", name: "PPI Filipina", region: "southeastAsia", no: 6 },
  { code: "BN", name: "PPI Brunei Darussalam", region: "southeastAsia", no: 7 },
  { code: "VN", name: "PPI Vietnam", region: "southeastAsia", no: 14 },
  { code: "CN", name: "PPI Tiongkok", region: "eastAsia", no: 8 },
  { code: "TW", name: "PPI Taiwan", region: "eastAsia", no: 9 },
  { code: "KR", name: "PERPIKA", region: "eastAsia", no: 10 },
  { code: "JP", name: "PPI Jepang", region: "eastAsia", no: 11 },
  { code: "IN", name: "PPI India", region: "southAsia", no: 12 },
  { code: "BD", name: "PPI Bangladesh", region: "southAsia", no: 16 },
  { code: "LK", name: "PPI Sri Lanka", region: "southAsia", no: 17 },
  { code: "KZ", name: "PPI Kazakhstan", region: "middleAsia", no: 13 },
  { code: "KG", name: "PPI Kirgistan", region: "middleAsia", no: 15 },
];
const CHAPTER_META = {
  NZ: ["Pacific/Auckland", -41.3, 174.8],
  AU: ["Australia/Sydney", -25.3, 133.8],
  MY: ["Asia/Kuala_Lumpur", 4.2, 102.0],
  SG: ["Asia/Singapore", 1.35, 103.8],
  TH: ["Asia/Bangkok", 15.9, 100.9],
  PH: ["Asia/Manila", 12.9, 121.8],
  BN: ["Asia/Brunei", 4.5, 114.7],
  VN: ["Asia/Ho_Chi_Minh", 14.0, 108.0],
  CN: ["Asia/Shanghai", 35.8, 104.2],
  TW: ["Asia/Taipei", 23.7, 121.0],
  KR: ["Asia/Seoul", 36.5, 127.9],
  JP: ["Asia/Tokyo", 36.2, 138.2],
  IN: ["Asia/Kolkata", 21.0, 78.0],
  BD: ["Asia/Dhaka", 23.7, 90.4],
  LK: ["Asia/Colombo", 7.9, 80.8],
  KZ: ["Asia/Almaty", 48.2, 67.0],
  KG: ["Asia/Bishkek", 41.2, 74.8],
};
const PPIDK = CHAPTERS.map((c, i) => {
  const [timezone, latitude, longitude] = CHAPTER_META[c.code];
  const slug = `ppidk-${c.code.toLowerCase()}`;
  return {
    ref: `chapters/dummy-ppi-${String(i + 1).padStart(2, "0")}`,
    slugRef: `chapterSlugs/${slug}`,
    data: {
      slug,
      name: c.name,
      countryCode: c.code,
      region: c.region,
      mapNo: c.no,
      active: c.active ?? true,
      timezone,
      logo: c.logo ?? null,
      contactName: c.contactName ?? "",
      contactPublic: "",
      description: c.description ?? "",
      role: c.role ?? null,
      phone: c.phone ?? null,
      website: c.website ?? null,
      email: c.email ?? null,
      instagram: c.instagram ?? null,
      socials: c.socials ?? [],
      latitude,
      longitude,
      memberCount: 0,
      conditions: [],
      risk: "none",
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
  };
});

// Satu transaksi untuk semua baris (tabel dibuat otomatis oleh store bila belum ada).
const batch = db.batch();
for (const { ref, slugRef, data } of [...ALL_EVENTS, ...ALBUMS, ...NEWS, ...PPIDK]) {
  batch.set(db.doc(ref), data);
  batch.set(db.doc(slugRef), { id: ref.split("/")[1] });
}
await batch.commit();
await db.close();

console.log(
  `Seeded ${ALL_EVENTS.length} events (${ALL_EVENTS.filter((e) => e.data.published).length} published) ` +
    `dan ${ALBUMS.length} albums (${ALBUMS.filter((a) => a.data.published).length} published) ` +
    `dan ${NEWS.length} news, ${PPIDK.length} PPI negara ` +
    `ke ${new URL(process.env.DATABASE_URL).host}${new URL(process.env.DATABASE_URL).pathname}.`,
);
