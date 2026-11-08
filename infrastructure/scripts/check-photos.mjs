/** One-off check: foto per galeri di DB dummy (ops local, tidak di-deploy). */
import { getDatabase } from "../../packages/db/src/sql/store.ts";

const db = getDatabase({ url: process.env.DATABASE_URL });
const snap = await db.collection("galleries").get();
const rows = snap.docs
  .map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      slug: data.slug,
      published: !!data.published,
      photos: Array.isArray(data.images) ? data.images.length : 0,
    };
  })
  .sort((a, b) => a.id.localeCompare(b.id));
await db.close();
const bad = rows.filter((r) => r.photos !== 3);
console.log(
  `total galleries: ${rows.length} | published: ${rows.filter((r) => r.published).length}`,
);
console.log(`±3 foto → ${rows.filter((r) => r.photos === 3).length}`);
console.log(`tidak pas 3 foto: ${bad.length}`);
for (const r of bad) console.log(`  ${r.id} ${r.slug} photos=${r.photos} published=${r.published}`);
