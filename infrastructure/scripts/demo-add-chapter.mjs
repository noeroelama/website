/**
 * demo-add-chapter.mjs — tambah satu chapter dummy (Nepal, belum ada di tabel /map)
 * sebagai bukti: PPI baru langsung muncul di tabel (data-driven, user: "buat 1 data
 * dummy untuk menampilkan negara yang belum ada di list"). Tulis lewat db.batch
 * (pola sama dengan seed-dummy). Argumen `remove` menghapusnya lagi.
 *
 *   set -a; source apps/web/.env.local; set +a
 *   node --experimental-strip-types --import ./infrastructure/scripts/ts-register.mjs \
 *     infrastructure/scripts/demo-add-chapter.mjs            # add
 *   ... demo-add-chapter.mjs remove                          # remove
 */
import { getDatabase } from "../../packages/db/src/sql/store.ts";
import { createSqlChapterReader } from "../../packages/db/src/sql/chapters.ts";

if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL (source apps/web/.env.local first).");
  process.exit(2);
}

const db = getDatabase({ url: process.env.DATABASE_URL });
const reader = createSqlChapterReader(db);
const ID = "chapters/dummy-ppi-np";
const SLUG_REF = "chapterSlugs/ppidk-np";
const SLUG = "ppidk-np";

const show = async (label) => {
  const list = await reader.listActive();
  const rows = list.map((c) => `${c.name} (#${c.slug}, ${c.region ?? "-"})`);
  console.log(`\n[${label}] listActive = ${list.length}`);
  console.log(rows.join("\n"));
};

const doc = await db.doc(ID).get();
if (process.argv[2] === "off") {
  if (!doc.exists) {
    console.log("Chapter dummy tidak ada (sudah dihapus).");
  } else {
    const batch = db.batch();
    batch.update(db.doc(ID), { active: false, updatedAt: new Date() });
    await batch.commit();
    console.log(`\nDinonaktifkan: ${ID} (active=false) — hilang dari /map.`);
  }
} else if (process.argv[2] === "remove") {
  if (!doc.exists) {
    console.log("Tidak ada chapter dummy (sudah dihapus).");
  } else {
    const batch = db.batch();
    batch.delete(db.doc(ID));
    batch.delete(db.doc(SLUG_REF));
    await batch.commit();
    console.log(`\nDihapus: ${ID} + pointer ${SLUG_REF}.`);
  }
} else if (doc.exists) {
  console.log("Chapter dummy sudah ada — jalankan dengan argumen `remove` untuk menghapus.");
} else {
  const now = new Date();
  const batch = db.batch();
  batch.set(db.doc(ID), {
    slug: SLUG,
    name: "PPI Nepal",
    countryCode: "NP",
    region: "southAsia",
    mapNo: 18,
    active: true,
    timezone: "Asia/Kathmandu",
    logo: null,
    contactName: "",
    contactPublic: "",
    website: null,
    email: null,
    instagram: null,
    socials: [],
    latitude: 28.4,
    longitude: 84.1,
    memberCount: 0,
    conditions: [],
    risk: "none",
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
  batch.set(db.doc(SLUG_REF), { id: ID.split("/")[1] });
  await batch.commit();
  console.log(`\nDitambah: ${ID} (PPI Nepal, southAsia) + pointer ${SLUG_REF}.`);
}

await show(process.argv[2] === "remove" ? "SETELAH dihapus" : "SETELAH ditambah");
await db.close();
