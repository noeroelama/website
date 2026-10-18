/**
 * UI text of the public website in Indonesian (default) and English. No i18n library: two typed
 * dictionaries with the same shape (tests/unit/web-i18n.test.ts checks every key in both).
 * Content from Firestore (news, events) is shown in the language it was written in.
 */
export const LANGUAGES = ["id", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

/** Cookie holding the visitor's choice (not personal data; 1 year, SameSite=Lax). */
export const LANG_COOKIE = "lang";

/** Indonesian unless the cookie says exactly "en". */
export function languageFrom(cookieValue: string | undefined): Language {
  return cookieValue === "en" ? "en" : "id";
}

/** Date the Terms and the Privacy Policy last changed (shown on both pages). */
export const LEGAL_VERSION = "2026-10-18";

interface Section {
  readonly heading: string;
  readonly paragraphs: readonly string[];
}

const id = {
  siteName: "PPIDK Asia-Oseania",
  nav: {
    label: "Navigasi utama",
    home: "Beranda",
    news: "Berita",
    events: "Acara",
    gallery: "Galeri",
    map: "Peta",
    about: "Tentang",
    signIn: "Masuk",
  },
  language: { label: "Bahasa", id: "ID", en: "EN", switchTo: "Ganti bahasa ke" },
  footer: {
    terms: "Syarat dan Ketentuan",
    privacy: "Kebijakan Privasi",
    rights: "Perhimpunan Pelajar Indonesia Dunia Kawasan Asia-Oseania",
  },
  home: {
    title: "PPIDK Asia-Oseania",
    tagline:
      "Perhimpunan Pelajar Indonesia Dunia Kawasan Asia-Oseania — rumah bersama PPI Negara di kawasan Asia dan Oseania.",
    purposeHeading: "Tentang situs ini",
    purpose:
      "Situs ini memuat berita, acara, galeri, dan peta PPI Negara di kawasan Asia-Oseania. Anggota dapat membuat akun untuk mendaftar acara dan mengelola profilnya; pengurus memakai akun yang sama untuk mengelola konten.",
    googleHeading: "Pemberitahuan data Google",
    google:
      "Bila kamu masuk dengan Google, kami hanya menerima ID akun, alamat email, nama, dan foto profilmu (izin openid, email, profile). Data itu dipakai untuk membuat dan mengamankan akunmu, tidak pernah dijual, dan tidak dibagikan kepada pengiklan. Kami tidak meminta akses ke Gmail, Drive, Kalender, atau layanan Google lain.",
    googleMore: "Baca Kebijakan Privasi",
  },
  pages: {
    news: "Berita",
    events: "Acara",
    gallery: "Galeri",
    map: "Peta",
  },
  news: {
    latest: "Berita terbaru",
    by: "Oleh",
    allCategories: "Semua kategori",
    category: "Kategori",
    filter: "Terapkan",
    tagged: "Tag",
    clear: "Hapus filter",
    empty: "Belum ada berita.",
    related: "Berita terkait",
    share: "Bagikan",
    previous: "Sebelumnya",
    next: "Berikutnya",
    all: "Lihat semua berita",
    categories: {
      general: "Umum",
      academic: "Akademik",
      community: "Komunitas",
      announcement: "Pengumuman",
      international: "Internasional",
    },
  },
  events: {
    upcoming: "Akan datang",
    past: "Sudah lewat",
    type: "Jenis",
    allTypes: "Semua jenis",
    from: "Dari tanggal",
    to: "Sampai tanggal",
    filter: "Terapkan",
    clear: "Hapus filter",
    empty: "Belum ada acara.",
    when: "Waktu",
    where: "Tempat",
    eventTime: "waktu setempat",
    yourTime: "waktumu",
    deadline: "Pendaftaran ditutup",
    speakers: "Pembicara",
    schedule: "Susunan acara",
    sponsors: "Didukung oleh",
    register: "Daftar",
    registering: "Mendaftarkan…",
    signInToRegister: "Masuk untuk mendaftar",
    confirmed: "Kamu sudah terdaftar. Cek e-mail untuk konfirmasinya.",
    waitlisted: "Kuota penuh: kamu masuk daftar tunggu. Kami kabari bila ada tempat.",
    closed: "Pendaftaran sudah ditutup.",
    captchaFailed: "Verifikasi gagal. Muat ulang halaman lalu coba lagi.",
    failed: "Pendaftaran gagal. Coba lagi sebentar lagi.",
    mailSubject: "Pendaftaran acara",
    mailConfirmed: "Pendaftaranmu sudah kami terima.",
    mailWaitlisted:
      "Kuota sudah penuh, jadi kamu masuk daftar tunggu. Kami kabari bila ada tempat.",
    mine: "Pendaftaran acaraku",
    mineEmpty: "Kamu belum mendaftar acara apa pun.",
    statuses: { confirmed: "Terdaftar", waitlisted: "Daftar tunggu", cancelled: "Dibatalkan" },
    types: {
      general: "Umum",
      seminar: "Seminar",
      webinar: "Webinar",
      discussion: "Diskusi",
      workshop: "Lokakarya",
      launch: "Peluncuran",
      event: "Acara",
      festival: "Festival",
      conference: "Konferensi",
      exhibition: "Pameran",
      meeting: "Rapat",
    },
  },
  gallery: {
    photos: "foto",
    seeAll: "Lihat semua foto",
    empty: "Belum ada album.",
    close: "Tutup",
    previous: "Sebelumnya",
    next: "Berikutnya",
    open: "Buka foto",
    eventAlbum: "Album foto acara ini",
  },
  about: {
    title: "Tentang kami",
    intro:
      "PPIDK Asia-Oseania (Perhimpunan Pelajar Indonesia Dunia Kawasan Asia-Oseania) adalah organisasi kemahasiswaan nirlaba yang menaungi PPI Negara di kawasan Asia dan Oseania.",
    whatHeading: "Yang kami lakukan",
    what: [
      "Menghubungkan pelajar Indonesia di kawasan Asia-Oseania melalui PPI Negara.",
      "Menyelenggarakan acara, kajian, dan program bersama antarnegara.",
      "Menyampaikan informasi resmi organisasi kepada anggota dan publik.",
    ],
    structureHeading: "Struktur organisasi",
    structure:
      "Kepengurusan disusun per periode. Visi, misi, dan susunan pengurus periode berjalan ditampilkan di sini setelah ditetapkan.",
    councilsHeading: "PPI Negara",
    councils: "Daftar PPI Negara anggota ditampilkan di halaman Peta.",
  },
  terms: {
    title: "Syarat dan Ketentuan",
    updated: "Terakhir diperbarui",
    intro:
      "Ketentuan ini mengatur penggunaan situs PPIDK Asia-Oseania. Dengan membuat akun atau memakai situs ini, kamu menyetujui ketentuan di bawah.",
    sections: [
      {
        heading: "1. Siapa yang boleh memakai",
        paragraphs: [
          "Siapa pun boleh membaca halaman publik. Akun ditujukan bagi pelajar dan mahasiswa Indonesia di kawasan Asia-Oseania, pengurus PPIDK Asia-Oseania dan PPI Negara, serta pihak yang diundang untuk keperluan tertentu. Kamu harus berusia sekurang-kurangnya 15 tahun untuk membuat akun.",
        ],
      },
      {
        heading: "2. Akun",
        paragraphs: [
          "Satu orang, satu akun. Isi data dengan benar dan jangan mengaku sebagai orang lain. Kamu bertanggung jawab menjaga akses masukmu (akun Google, kata sandi, atau passkey) dan segera memberi tahu kami bila menduga akunmu dipakai orang lain.",
        ],
      },
      {
        heading: "3. Yang tidak boleh dilakukan",
        paragraphs: [
          "Mengunggah materi yang melanggar hukum, memfitnah, atau melanggar hak pihak lain; mengunggah berkas berbahaya; mencoba menembus, memindai, atau membebani sistem di luar penggunaan wajar; mengakses data anggota lain di luar kewenangan yang diberikan.",
        ],
      },
      {
        heading: "4. Kewenangan pengurus",
        paragraphs: [
          "Kewenangan pengurus melekat pada jabatan, bukan pada pribadi, dan berakhir bersama masa jabatan. Setiap perubahan oleh pengurus tercatat beserta pelakunya.",
        ],
      },
      {
        heading: "5. Perubahan ketentuan",
        paragraphs: [
          "Ketentuan ini dapat diperbarui. Tanggal pembaruan terakhir tercantum di atas; perubahan penting diumumkan di situs ini.",
        ],
      },
    ] satisfies Section[],
  },
  privacy: {
    title: "Kebijakan Privasi",
    updated: "Terakhir diperbarui",
    intro:
      "Kebijakan ini menjelaskan data pribadi apa yang dikumpulkan situs PPIDK Asia-Oseania, untuk apa dipakai, siapa yang bisa melihatnya, berapa lama disimpan, dan bagaimana kamu dapat memintanya dihapus. Situs ini nirlaba: tidak ada iklan dan datamu tidak pernah diperjualbelikan.",
    sections: [
      {
        heading: "1. Data yang kami kumpulkan",
        paragraphs: [
          "Akun: alamat email dan nama. Bila masuk dengan Google, kami menerima ID akun, email, nama, dan foto profil (izin openid, email, profile) dan tidak meminta akses ke layanan Google lain. Bila memakai email dan kata sandi, kata sandimu dikelola oleh Firebase Authentication (Google) dan tidak pernah kami simpan sendiri.",
          "Data yang kamu isi sendiri: profil anggota, pendaftaran acara, dan langganan buletin.",
          "Data teknis: waktu masuk terakhir, catatan perubahan data oleh pengurus, dan alamat IP dalam bentuk tersamar (hash) untuk membatasi penyalahgunaan.",
        ],
      },
      {
        heading: "2. Cookie",
        paragraphs: [
          "Kami hanya memasang cookie sesi yang diperlukan agar kamu tetap masuk, dan cookie pilihan bahasa. Tidak ada cookie pelacak, analitik pihak ketiga, maupun piksel iklan.",
        ],
      },
      {
        heading: "3. Untuk apa data dipakai",
        paragraphs: [
          "Membuat dan mengamankan akunmu, memproses pendaftaran acara dan langganan buletin, menjalankan administrasi organisasi, dan mengirim pemberitahuan yang berkaitan dengan hal-hal itu.",
        ],
      },
      {
        heading: "4. Siapa yang bisa melihat datamu",
        paragraphs: [
          "Kamu sendiri melihat seluruh datamu. Pengurus hanya melihat data yang dibutuhkan jabatannya, dan kewenangan itu berakhir bersama masa jabatan.",
        ],
      },
      {
        heading: "5. Pihak ketiga",
        paragraphs: [
          "Google (Firebase: autentikasi, basis data, penyimpanan berkas; reCAPTCHA pada formulir publik), Resend (pengiriman email), dan DomaiNesia (hosting situs). Di luar itu datamu tidak dibagikan kepada siapa pun, kecuali bila diwajibkan oleh hukum.",
        ],
      },
      {
        heading: "6. Hakmu",
        paragraphs: [
          "Kamu dapat melihat, memperbaiki, dan meminta salinan atau penghapusan datamu. Kamu juga dapat mencabut akses Google kapan saja di pengaturan akun Google-mu. Hubungi pengurus melalui kanal resmi PPIDK Asia-Oseania untuk permintaan tersebut.",
        ],
      },
    ] satisfies Section[],
  },
};

export type Dictionary = typeof id;

const en: Dictionary = {
  siteName: "PPIDK Asia-Oseania",
  nav: {
    label: "Main navigation",
    home: "Home",
    news: "News",
    events: "Events",
    gallery: "Gallery",
    map: "Map",
    about: "About",
    signIn: "Sign in",
  },
  language: { label: "Language", id: "ID", en: "EN", switchTo: "Switch language to" },
  footer: {
    terms: "Terms and Conditions",
    privacy: "Privacy Policy",
    rights: "Indonesian Students' Association in Asia-Oceania",
  },
  home: {
    title: "PPIDK Asia-Oseania",
    tagline:
      "The Indonesian Students' Association in Asia-Oceania — home of the national Indonesian student associations (PPI) across Asia and Oceania.",
    purposeHeading: "About this website",
    purpose:
      "This website publishes news, events, galleries and the map of the PPI associations in Asia-Oceania. Members can create an account to register for events and manage their profile; officers use the same account to manage content.",
    googleHeading: "Google data notice",
    google:
      "If you sign in with Google, we only receive your account ID, e-mail address, name and profile picture (openid, email, profile scopes). We use them to create and protect your account, never sell them and never share them with advertisers. We do not request access to Gmail, Drive, Calendar or any other Google service.",
    googleMore: "Read the Privacy Policy",
  },
  pages: {
    news: "News",
    events: "Events",
    gallery: "Gallery",
    map: "Map",
  },
  news: {
    latest: "Latest news",
    by: "By",
    allCategories: "All categories",
    category: "Category",
    filter: "Apply",
    tagged: "Tag",
    clear: "Clear filters",
    empty: "No news yet.",
    related: "Related news",
    share: "Share",
    previous: "Previous",
    next: "Next",
    all: "See all news",
    categories: {
      general: "General",
      academic: "Academic",
      community: "Community",
      announcement: "Announcement",
      international: "International",
    },
  },
  events: {
    upcoming: "Upcoming",
    past: "Past",
    type: "Type",
    allTypes: "All types",
    from: "From",
    to: "To",
    filter: "Apply",
    clear: "Clear filters",
    empty: "No events yet.",
    when: "When",
    where: "Where",
    eventTime: "local time",
    yourTime: "your time",
    deadline: "Registration closes",
    speakers: "Speakers",
    schedule: "Schedule",
    sponsors: "Supported by",
    register: "Register",
    registering: "Registering…",
    signInToRegister: "Sign in to register",
    confirmed: "You are registered. Check your e-mail for the confirmation.",
    waitlisted: "The event is full: you are on the waiting list. We will tell you if a seat opens.",
    closed: "Registration is closed.",
    captchaFailed: "Verification failed. Reload the page and try again.",
    failed: "Registration failed. Please try again shortly.",
    mailSubject: "Event registration",
    mailConfirmed: "We have received your registration.",
    mailWaitlisted:
      "The event is full, so you are on the waiting list. We will tell you if a seat opens.",
    mine: "My event registrations",
    mineEmpty: "You have not registered for any event yet.",
    statuses: { confirmed: "Registered", waitlisted: "Waiting list", cancelled: "Cancelled" },
    types: {
      general: "General",
      seminar: "Seminar",
      webinar: "Webinar",
      discussion: "Discussion",
      workshop: "Workshop",
      launch: "Launch",
      event: "Event",
      festival: "Festival",
      conference: "Conference",
      exhibition: "Exhibition",
      meeting: "Meeting",
    },
  },
  gallery: {
    photos: "photos",
    seeAll: "See all photos",
    empty: "No albums yet.",
    close: "Close",
    previous: "Previous",
    next: "Next",
    open: "Open photo",
    eventAlbum: "Photo album of this event",
  },
  about: {
    title: "About us",
    intro:
      "PPIDK Asia-Oseania (Indonesian Students' Association in Asia-Oceania) is a non-profit student organisation that brings together the national Indonesian student associations (PPI) in Asia and Oceania.",
    whatHeading: "What we do",
    what: [
      "Connect Indonesian students across Asia-Oceania through their national associations.",
      "Run events, studies and joint programmes between countries.",
      "Share official information with members and the public.",
    ],
    structureHeading: "Organisation structure",
    structure:
      "The board is formed per period. The vision, mission and board of the current period appear here once they are set.",
    councilsHeading: "National associations",
    councils: "The member associations are listed on the Map page.",
  },
  terms: {
    title: "Terms and Conditions",
    updated: "Last updated",
    intro:
      "These terms govern the use of the PPIDK Asia-Oseania website. By creating an account or using this website, you agree to the terms below.",
    sections: [
      {
        heading: "1. Who may use it",
        paragraphs: [
          "Anyone may read the public pages. Accounts are meant for Indonesian students in Asia-Oceania, officers of PPIDK Asia-Oseania and the national associations, and people invited for a specific purpose. You must be at least 15 years old to create an account.",
        ],
      },
      {
        heading: "2. Accounts",
        paragraphs: [
          "One person, one account. Provide correct information and do not pretend to be someone else. You are responsible for keeping your sign-in methods (Google account, password or passkey) safe, and for telling us promptly if you think someone else uses your account.",
        ],
      },
      {
        heading: "3. What is not allowed",
        paragraphs: [
          "Uploading unlawful or defamatory material or material that infringes others' rights; uploading harmful files; trying to break into, scan or overload the system beyond normal use; accessing other members' data beyond the access you were given.",
        ],
      },
      {
        heading: "4. Officers' access",
        paragraphs: [
          "An officer's access belongs to the position, not the person, and ends with the term of office. Every change made by an officer is recorded together with who made it.",
        ],
      },
      {
        heading: "5. Changes to these terms",
        paragraphs: [
          "These terms may be updated. The date of the last update is shown above; important changes are announced on this website.",
        ],
      },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    updated: "Last updated",
    intro:
      "This policy explains which personal data the PPIDK Asia-Oseania website collects, what it is used for, who can see it, how long it is kept and how you can ask for it to be deleted. The website is non-profit: there are no ads and your data is never sold.",
    sections: [
      {
        heading: "1. Data we collect",
        paragraphs: [
          "Account: e-mail address and name. With Google sign-in we receive your account ID, e-mail, name and profile picture (openid, email, profile scopes) and request no access to other Google services. With e-mail and password, your password is handled by Firebase Authentication (Google) and never stored by us.",
          "Data you enter yourself: member profile, event registrations and newsletter subscription.",
          "Technical data: time of your last sign-in, a record of changes made by officers, and your IP address in hashed form to limit abuse.",
        ],
      },
      {
        heading: "2. Cookies",
        paragraphs: [
          "We only set the session cookie that keeps you signed in and a language-choice cookie. There are no tracking cookies, third-party analytics or advertising pixels.",
        ],
      },
      {
        heading: "3. What we use data for",
        paragraphs: [
          "Creating and protecting your account, processing event registrations and newsletter subscriptions, running the organisation's administration, and sending notices about these.",
        ],
      },
      {
        heading: "4. Who can see your data",
        paragraphs: [
          "You see all of your own data. Officers only see the data their position needs, and that access ends with their term of office.",
        ],
      },
      {
        heading: "5. Third parties",
        paragraphs: [
          "Google (Firebase: authentication, database, file storage; reCAPTCHA on public forms), Resend (sending e-mail) and DomaiNesia (website hosting). Beyond these, your data is not shared with anyone unless the law requires it.",
        ],
      },
      {
        heading: "6. Your rights",
        paragraphs: [
          "You can view and correct your data and ask for a copy or for its deletion. You can also revoke Google access at any time in your Google account settings. Contact the officers through the official PPIDK Asia-Oseania channels for these requests.",
        ],
      },
    ],
  },
};

export const DICTIONARIES: Readonly<Record<Language, Dictionary>> = { id, en };
