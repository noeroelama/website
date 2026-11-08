import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import {
  publicUnit,
  WAKIL_CODE_SUFFIX,
  type PublicMember,
  type PublicUnit,
  type PublicUnitBranch,
} from "@/server/structure";

// Unknown or deactivated unit → the 404 page (soft 404 with the site frame, like
// the map and news detail pages).
export const instant = false;

const find = async (unitId: string) => publicUnit(unitId);

/**
 * Round 15: the sample name under the LEADS' hero photo until the admin
 * registers the person (user: "Dibawah foto kasih nama default dulu, Budi
 * Setiawan"). Data, not copy — the same in both languages.
 */
const LEAD_FALLBACK_NAME = "Budi Setiawan";
/**
 * Round 24 (Nov 2026, user: "buat Wasektifnya jadi Wasektif 1 dan Wasektif 2.
 * Dan ingat jika ada 2 wakil maka otomatis akan selalu begini di unit manapun"):
 * the wakil columns' jabatan. When two or more children share the same base
 * code (e.g. WASEKTIF and WASEKTIF-II, whose roman / numeric endings — I, II,
 * 2, 3 … — are stripped), each is numbered by its TREE ORDER among them —
 * "Wasektif 1", "Wasektif 2" — everywhere a unit has ≥ 2 wakil, whatever
 * the unit. A single wakil keeps its stored name. The title case comes from
 * the code's own letters (WASEKTIF → "Wasektif").
 */
// The numbering suffix of a second (third, …) wakil's code: digits ("-2", "02")
// or roman numerals AFTER a dash ("-II", "-III") — never a bare trailing letter
// (e.g. HAL, KOMDIGI) which would be a legitimate code ending.
// The wakil-numbering suffix (shared with the About tree filter, round 27):
// see WAKIL_CODE_SUFFIX in @/server/structure.
const DEPUTY_CODE_SUFFIX = WAKIL_CODE_SUFFIX;
const codeBase = (code: string) => code.replace(DEPUTY_CODE_SUFFIX, "");
const titleCase = (code: string) => code.charAt(0).toUpperCase() + code.slice(1).toLowerCase();
/**
 * Round 36 (user: "Tulisan Kepala, wakil, Sekretaris seharusnya diikuti
 * dengan Biro/Dir/Bidangnya, contoh Kepala Biro JMO, Wadir PSDM, Kabid
 * KOMDIGI-TDI"): the role text of the lineup people — the head, the wakil
 * and the sekretaris of a biro/direktorat/bidang ALWAYS carry the unit's
 * code after them, in the everyday short forms: "Kepala Biro JMO", "Waka
 * KSA", "Direktur PSDM", "Wadir PSDM", "Kabid KOMDIGI-TDI" (a bidang's
 * code PSDM-BAKAT/KOMDIGI-TDI already IS its name), "Sekretaris KSA".
 * Any other role — the officers' ("Sekretaris Jenderal", "Wakil Sekretaris
 * Eksekutif" …) and plain "Staff" — is returned untouched.
 */
const jabatanLabel = (role: string, code: string): string => {
  const shortForms: Record<string, string> = {
    "Kepala Biro": "Kepala Biro",
    "Wakil Kepala Biro": "Waka",
    Direktur: "Direktur",
    "Wakil Direktur": "Wadir",
    "Kepala Bidang": "Kabid",
    "Wakil Kepala Bidang": "Wakabid",
    Sekretaris: "Sekretaris",
  };
  const short = shortForms[role];
  return short ? `${short} ${code}` : role;
};
const deputyJabatan = (children: readonly PublicUnit[], child: PublicUnit): string => {
  const base = codeBase(child.code);
  // The peers WITH the same base code in tree order (the list order); the
  // numbering is their position among them, so it stays right whatever the
  // stored names or sort.
  const peers = children.filter((c) => codeBase(c.code) === base);
  return peers.length >= 2 ? `${titleCase(base)} ${peers.indexOf(child) + 1}` : child.name;
};
// Round 38 (user: "jika yang ada dua maka ditulis Wadir-I dan Wadir II"):
// the wakil columns number their pills with roman numerals by position.
const ROMAN_NUMERALS = ["I", "II", "III", "IV", "V"];
/**
 * Round 38 (user: "Pills: KABID-MINAT-PSDM"): the short word of a bidang's
 * name for the KABID-/WAKABID-/SEKBID-… pills — "Minat dan Bakat" → "Minat".
 * Strips the leading "Bidang ", drops the "dan" conjunction, keeps the
 * FIRST meaningful word (the CSS uppercases it in the pill).
 */
const bidangWord = (name: string): string =>
  name
    .replace(/^Bidang\s+/, "")
    .split(/\s+/)
    .find((w) => w.toLowerCase() !== "dan") ?? "";

export async function generateMetadata({
  params,
}: PageProps<"/struktur/[unitId]">): Promise<Metadata> {
  const unit = await find((await params).unitId);
  if (!unit) return {};
  return { title: unit.name, description: undefined };
}

/**
 * One unit of the ACTIVE period's structure (user: "Ketika masing-masing Bagian
 * di klik, bisa muncul halaman untuk menampilkan foto serta jabatannya"): the
 * unit's name, its ancestors as a breadcrumb, its core members — photo and
 * role, with the initial as the avatar placeholder until photos are uploaded
 * in the admin — and its sub-units as links. The LEAD officer pages
 * (Sekretaris Jenderal, Wakil Sekretaris Jenderal and — since round 19 —
 * Sekretaris Eksekutif & Bendahara Eksekutif, the units whose direct
 * children are their wakil; user round 19: "saya ingin tampilan detil
 * Sekretaris Eksekutif dan Bendahara Eksekutif seperti detil Sekjen dan
 * Waksekjen, namun ada tambahan Wakilnya yang mungkin lebih dari satu");
 * round 26 ("Sekarang implementasikan juga untuk semua biro dan dir. Ingat
 * setiap biro dan dir memungkinkan memiliki wakil lebih dari 1") extends the
 * same hero to the biro/direktorat pages once they carry two or more wakil —
 * there the wakil are the children sharing a deputy base code (WADIR-I &
 * WADIR-II, WAKA-I & WAKA-II) and the other children (the bidang, …) still
 * list under "Bagian Terkait"
 * show a profile hero
 * instead of the compact grid: a BIG PORTRAIT photo, centred, with the
 * jabatan text and the code pill (SEKJEN) underneath and NO "Pengurus"
 * heading (user round 13: "Halaman ini memuat: Foto (Agak besar), Jabatan
 * (pills alias jabatan)"; round 14: "Tulisan Pengurus dan garis dibawahnya
 * dihapus. Gambar dibuat lebih besar, bentuknya potrait, dan posisi center.
 * Dibawahnya ada tulisan Sekretaris Jenderal, Pills SEKJEN"). Round 15
 * (user: "← Kembali ke Tentang kami ganti jadi ← Back. Badan Pelaksana
 * Harian seharusnya Badan Pelaksana Harian > Sekretaris Jenderal. … Sekretaris Jenderal SEKJEN yang diatas foto, hilangkan pills nya … Dibawah
 * foto kasih nama default dulu, Budi Setiawan. Bagian di dalamnya seharusnya
 * ganti dengan Bagian Terkaiit. Isinya Wasekjen, Sekretaris Eksekutif,
 * Bendahara Eksekutif"): back link shortened to "← Back", the breadcrumb
 * ends with the current unit ("Badan Pelaksana Harian > Sekretaris
 * Jenderal"), the header pill is gone on the leads (h1 only), the empty
 * hero shows the sample name "Budi Setiawan" under the photo, and the
 * "Pengurus" heading is replaced by "Bagian Terkait" — on Bapelha's page
 * that list covers all four officers (SEKJEN + WASEKJEN + SEKTIF + BEND,
 * since round 22 flattened them to direct children); the SEKJEN-keeps-the-
 * rounded-WASEKJEN-line rule is DORMANT now that the sekjen has no children.
 * On the SEKTIF & BEND pages
 * that children section is headed "Wakil" instead and the wakil render as
 * small photo columns right under the hero (round 19: "ada tambahan Wakilnya
 * yang mungkin lebih dari satu"; round 20: "Wakilnya langsung ditampilkan
 * pakai foto dibawah Sektif, namun ukurannya lebih kecil") — however many
 * the admin registers. With no person
 * registered yet, the hero falls back to the unit's own initial, name and
 * code. Everything comes from the database (the
 * admin Organizations → Manage Structure form), cached under "structure"
 * like the About tree.
 */
export default async function UnitPage({ params }: PageProps<"/struktur/[unitId]">) {
  const unit = await find((await params).unitId);
  if (!unit) notFound();
  const t = DICTIONARIES[languageFrom((await cookies()).get(LANG_COOKIE)?.value)].about;
  // The lead hero spans the SEKJEN/WASEKJEN AND — since round 19 — the two
  // officers whose direct children are their wakil: Sekretaris Eksekutif &
  // Bendahara Eksekutif (user round 19: "tampilan detil Sekretaris Eksekutif
  // dan Bendahara Eksekutif seperti detil Sekjen dan Waksekjen, namun ada
  // tambahan Wakilnya yang mungkin lebih dari satu"). Round 22 flattened the
  // hierarchy under Bapelha (sekjen keeps no children), which leaves this
  // rule untouched: the four officers stay leads. Type alone cannot pick
  // SEKTIF out of its own wakil (both are "staf"), so a staf/bendahara unit
  // is a lead only when it HAS children — its wakil. Round 26 (user:
  // "Sekarang implementasikan juga untuk semua biro dan dir. Ingat setiap
  // biro dan dir memungkinkan memiliki wakil lebih dari 1"): the same hero
  // extends to the biro/direktorat pages — there a page becomes a lead when
  // at least two of its children share a wakil base code (WADIR-I & WADIR-II
  // under a direktorat, WAKA-I & WAKA-II under a biro); those children
  // render as the wakil photo columns and the other children (e.g. the
  // bidang under a direktorat) stay "Bagian Terkait" cards. Round 36 (user:
  // "Ketua 1. Wakil 1. Sekretaris 1. Staff 6.") settles the lineup at
  // EXACTLY ONE wakil per biro/direktorat/bidang — any child unit whose lead
  // member's role is a "Wakil …" role IS the wakil, so the page becomes a
  // lead as soon as one such child exists.
  // Round 36: a wakil unit — its lead member's role is a "Wakil …" role (the
  // demo wakil bpl-29/31…47 are type "staf", indistinguishable from the
  // officer pages by type alone — the ROLE picks them out), or its code
  // carries the wakil-numbering suffix.
  const isWakilUnit = (u: PublicUnit) =>
    (u.members[0]?.role ?? "").startsWith("Wakil") || WAKIL_CODE_SUFFIX.test(u.code);
  const leadDeputies =
    unit.type === "staf" || unit.type === "bendahara"
      ? unit.children.length > 0
      : (unit.type === "biro" || unit.type === "direktorat" || unit.type === "bidang") &&
        unit.children.some(isWakilUnit);
  const isLead = unit.type === "sekjen" || unit.type === "wasekjen" || leadDeputies;
  // The "Wakil" heading: on the pages whose direct children ARE the wakil —
  // the officer pages (SEKTIF/BEND; rounds 19/20) and, since round 36, every
  // biro/direktorat/bidang page with one wakil child (round 26 wanted ≥ 2
  // deputy peers; round 36 makes it a single wakil). There the wakil render
  // as photo columns and the "Bagian Terkait" cards come from the REPORTING
  // line instead (rounds 24/25).
  const wakilHeading = leadDeputies;
  // The units rendered as wakil photo columns: on the officer pages ALL the
  // direct children (round 20), on the biro/direktorat/bidang pages the
  // wakil children only (round 36) — the remaining children (bidang,
  // subdivisions) list under "Bagian Terkait".
  const deputies: readonly PublicUnit[] =
    unit.type === "staf" || unit.type === "bendahara"
      ? unit.children
      : (unit.type === "biro" || unit.type === "direktorat" || unit.type === "bidang") &&
          leadDeputies
        ? unit.children.filter(isWakilUnit)
        : [];
  // Round 38 (user: "Untuk Jabatan Direktur ditulis begini: Direktur
  // Direktorat Pengembangan Sumber Daya Manusia, Pills: DIR-PSDM" / "Untuk
  // Jabatan Kepala Bidang begini: Kepala Bidang Minat dan Bakat (enter)
  // Direktorat Sumber Daya Manusia, Pills: KABID-MINAT-PSDM"): the heads of
  // a direktorat/bidang follow the biro pattern — FULL names, \;newline\;
  // between the bidang's role-line and its direktorat's name (the parent
  // from the managers chain; the line breaks render via white-space:
  // pre-line). The pills read "Dir-PSDM" and — round 40 (user: "Perbaiki
  // semua pills untuk Bidang, Seharusnya Jabatan-Direktorat-Bidang. Contoh:
  // KABID-PSDM-MINAT") then round 41 (user: "Pastikan juga pills ditulis
  // sesuai inisial Biro, Direktorat, Bidang yang ada pada pills halaman
  // about"): "Kabid-PSDM-BAKAT" — jabatan + the bidang's OWN /about code
  // (see bidangPill).
  const parentUnit = [...unit.managers].at(-1);
  const leadJabatan = (role: string): string => {
    if (unit.type === "direktorat") return `${role} ${unit.name}`;
    if (unit.type === "biro") return `${role} ${unit.name.replace(/^Biro\s+/, "")}`;
    if (unit.type === "bidang")
      return `${role} ${unit.name.replace(/^Bidang\s+/, "")}\n${parentUnit?.name ?? ""}`;
    return jabatanLabel(role, unit.code);
  };
  const leadPill = (): string => {
    if (unit.type === "biro") return `Kabiro-${unit.code}`;
    if (unit.type === "direktorat") return `Dir-${unit.code}`;
    if (unit.type === "bidang") return bidangPill("Kabid");
    return unit.code;
  };
  // Round 38 (user: "Untuk Wabiro dan Wadir yang hanya 1, sebaiknya ditulis
  // Wabiro dan Wadir saja Pillsnya, bukan Wabiro-I. Namun jika yang ada dua
  // maka ditulis Wadir-I dan Wadir II. Dan jabatannya Wakil Kepala 1 Biro
  // Jaminan Mutu Organisasi, Wakil Direktur 2 Direktorat Komunikasi
  // Digital"): the biro/direktorat wakil — one wakil gets a PLAIN pill
  // ("Wabiro"/"Wadir") and an unnumbered jabatan; two or more get roman
  // numerals by position ("Wadir-I", "Wadir-II") and the NUMBERED jabatan
  // ("Wakil Kepala 1 Biro …", "Wakil Direktur 2 Direktorat …"). The bidang
  // wakil (round 38: "terapkan untuk Wakabid") carry the WAKABID-… pill and
  // two-line jabatan like the head.
  const wakilJabatan = (child: PublicUnit): string => {
    const i = deputies.indexOf(child) + 1;
    const many = deputies.length >= 2;
    if (unit.type === "biro")
      return `${many ? `Wakil Kepala ${i} Biro` : "Wakil Kepala Biro"} ${unit.name.replace(/^Biro\s+/, "")}`;
    if (unit.type === "direktorat")
      return `${many ? `Wakil Direktur ${i}` : "Wakil Direktur"} ${unit.name}`;
    if (unit.type === "bidang")
      return `${many ? `Wakil Kepala ${i} Bidang` : "Wakil Kepala Bidang"} ${unit.name.replace(/^Bidang\s+/, "")}\n${parentUnit?.name ?? ""}`;
    return deputyJabatan(deputies, child);
  };
  const wakilPill = (child: PublicUnit): string => {
    const i = deputies.indexOf(child) + 1;
    const roman = ROMAN_NUMERALS[i - 1] ?? String(i);
    // Round 39 (user: "Pills untuk Wakil Biro seharusnya WAKABIRO, bukan
    // WABIRO. Pills untuk Wakil Biro dan Direktorat. Kurang inisial Biro dan
    // Direktorat nya. Contoh WAKABIRO-I-JMO atau WADIR-PSDM"): the wakil pills
    // carry the full "Wakabiro-"/"Wadir-" prefix PLUS the biro/direktorat's
    // code — "Wakabiro-JMO"/"Wakabiro-I-JMO", "Wadir-PSDM"/"Wadir-I-PSDM"
    // (the CSS uppercases them).
    if (unit.type === "biro") {
      const prefix = deputies.length >= 2 ? `Wakabiro-${roman}` : "Wakabiro";
      return `${prefix}-${unit.code}`;
    }
    if (unit.type === "direktorat") {
      const prefix = deputies.length >= 2 ? `Wadir-${roman}` : "Wadir";
      return `${prefix}-${unit.code}`;
    }
    if (unit.type === "bidang") return bidangPill("Wakabid");
    return child.code;
  };
  // Round 41 (user: "Pastikan juga pills ditulis sesuai inisial Biro,
  // Direktorat, Bidang yang ada pada pills halaman about"): the bidang pills
  // reuse the unit's OWN code — the exact pill that row shows on /about
  // ("PSDM-BAKAT") — so the three read KABID-PSDM-BAKAT, WAKABID-PSDM-BAKAT,
  // SEKBID-PSDM-BAKAT (jabatan + the about initials). The old word-built
  // form (direktorat code + bidangWord) only steps in if a bidang ever
  // loses its code.
  const bidangPill = (role: string) =>
    unit.code
      ? `${role}-${unit.code}`
      : `${role}-${parentUnit?.code ?? ""}-${bidangWord(unit.name)}`;
  const avatar = (name: string) => name.trim().charAt(0).toUpperCase();
  // Round 31 (user: "isi setiap data ketua, dan wakil masing2 satu. Selain
  // itu untuk biro dan bidang pada setiap dir juga memiliki staff yang isinya
  // 5 staff. Tambahkan juga sekretaris di setiap biro dan dir"): every unit
  // now carries its people as MEMBERS — the ketua (head: true) plus, on the
  // biro/direktorat pages, a Sekretaris and (biro & bidang) staff. The lead
  // hero portraits are the HEADS only; the rest of the team lists under the
  // "Pengurus" grid, so a biro/direktorat page reads: Kepala (portrait) →
  // Pengurus (Sekretaris + staff) → Wakil columns → Bagian Terkait.
  // Round 36: the grid role also carries a code — the sekretaris of bpl-09
  // reads "Sekretaris KSA" (the unit's OWN code). A wakil unit's page (e.g.
  // bpl-31 WAKA-JMO-1) would otherwise read an opaque code, so for wakil
  // roles the label takes the PARENT's code from the managers chain (the
  // last — immediate — superior; falls back to the unit's own code).
  const roleLabel = (role: string) => {
    // Round 38 (user: "juga terapkan untuk ... Sekbidnya"): the bidang's
    // Sekretaris reads "Sekretaris Bidang Minat dan Bakat" + the direktorat
    // on the second line, like the kepala/wakabid two-liners.
    if (unit.type === "bidang" && role === "Sekretaris")
      return `Sekretaris Bidang ${unit.name.replace(/^Bidang\s+/, "")}\n${parentUnit?.name ?? ""}`;
    return role.startsWith("Wakil")
      ? jabatanLabel(role, [...unit.managers].at(-1)?.code ?? unit.code)
      : jabatanLabel(role, unit.code);
  };
  const memberGrid = (members: readonly PublicMember[]) => (
    <ul className="site-unit__members">
      {members.map((member, i) => (
        <li key={`${member.name}-${i}`} className="site-unit__member">
          {member.photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- member photo from the admin upload
            <img className="site-unit__avatar" src={member.photo} alt="" />
          ) : (
            <span className="site-unit__avatar" aria-hidden="true">
              {avatar(member.name)}
            </span>
          )}
          <span className="site-unit__person">
            <strong>{member.name}</strong>
            <span className="site-unit__role">{roleLabel(member.role)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
  // Round 37 (user: "Gambar setiap Sekretaris pada Biro dan Dir, buat
  // gambarnya seperti Wakil (portrait). Tambahkan juga Pills (Sekbiro dan
  // Sekdir)"): the sekretaris of a biro/direktorat render as WAKIL-STYLE
  // portrait columns — the same 120x160 deputy photo, name, jabatan — but
  // WITHOUT a link (no page of their own), carrying the SEKBIRO-…/SEKDIR-…
  // pill (uppercased by the CSS).
  const sekretarisPortrait = (members: readonly PublicMember[]) => (
    <ul className="site-unit__sekretaris">
      {members.map((member, i) => (
        <li key={`${member.name}-${i}`} className="site-unit__deputy">
          {member.photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- member photo from the admin upload
            <img className="site-unit__deputy-photo" src={member.photo} alt="" />
          ) : (
            <span className="site-unit__deputy-photo" aria-hidden="true">
              {avatar(member.name)}
            </span>
          )}
          <span className="site-unit__deputy-meta">
            <strong className="site-unit__deputy-name">{member.name}</strong>
            <span className="site-unit__deputy-jabatan">{roleLabel(member.role)}</span>
            <span className="site-about__code">
              {unit.type === "biro"
                ? `Sekbiro-${unit.code}`
                : unit.type === "bidang"
                  ? bidangPill("Sekbid")
                  : `Sekdir-${unit.code}`}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
  // Round 34 (user: "Di halaman Detil Bapelha ... pengurus diganti dengan
  // Sekjen, Dibawahnya ada Wasekjen, Dibawah Wasekjen ada Sektif dan Bend"
  // then "Maksud saya tampilkan fotonya"): the ROOT page's officer line as
  // PHOTO COLUMNS, one nested flex row per officer level — the Sekjen on top
  // as the big LEAD portrait (240x320, the lead-hero look), the Wasekjen
  // under him and Sektif & Bend under the Wasekjen as the small deputy-style
  // columns (120x160) side by side. Every column is a link to the officer's
  // page; the person is each unit's member (head), the avatars fall back to
  // the initials until photos are uploaded in the admin.
  const officerBranch = (branch: PublicUnitBranch, depth: number) => {
    const person = branch.unit.members[0];
    return (
      <li key={branch.unit.id} className="site-unit__officers-branch">
        {depth === 1 ? (
          /* The officer on top of the line — the SEKRETARIS JENDERAL — gets
             the big lead portrait; the levels under him the wakil-style
             columns (user: "Dibawahnya ada Wasekjen, Dibawah Wasekjen ada
             Sektif dan Bend"). */
          <Link
            className="site-unit__lead site-unit__officer-lead"
            href={`/struktur/${branch.unit.id}`}
          >
            {person?.photo ? (
              // eslint-disable-next-line @next/next/no-img-element -- officer photo from the admin upload
              <img className="site-unit__lead-photo" src={person.photo} alt="" />
            ) : (
              <span className="site-unit__lead-photo" aria-hidden="true">
                {avatar(person?.name ?? branch.unit.name)}
              </span>
            )}
            <span className="site-unit__lead-meta">
              <strong className="site-unit__lead-name">{person?.name ?? LEAD_FALLBACK_NAME}</strong>
              <span className="site-unit__lead-jabatan">{branch.unit.name}</span>
              {branch.unit.code && <span className="site-about__code">{branch.unit.code}</span>}
            </span>
          </Link>
        ) : (
          <Link className="site-unit__deputy" href={`/struktur/${branch.unit.id}`}>
            {person?.photo ? (
              // eslint-disable-next-line @next/next/no-img-element -- officer photo from the admin upload
              <img className="site-unit__deputy-photo" src={person.photo} alt="" />
            ) : (
              <span className="site-unit__deputy-photo" aria-hidden="true">
                {avatar(person?.name ?? branch.unit.name)}
              </span>
            )}
            <span className="site-unit__deputy-meta">
              <strong className="site-unit__deputy-name">
                {person?.name ?? LEAD_FALLBACK_NAME}
              </strong>
              <span className="site-unit__deputy-jabatan">{branch.unit.name}</span>
              {branch.unit.code && <span className="site-about__code">{branch.unit.code}</span>}
            </span>
          </Link>
        )}
        {branch.children.length > 0 && (
          <ul className="site-unit__officer-children">
            {branch.children.map((child) => officerBranch(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  };
  return (
    <main className="site-event site-album site-about site-about__detail">
      <div className="site-event__inner">
        <nav className="site-unit__crumbs" aria-label="Breadcrumb">
          <Link href="/about" className="site-unit__back">
            ← {t.unitBack}
          </Link>
          <span className="site-unit__crumbs-path" aria-hidden="true">
            {unit.ancestors.map((a) => (
              <Link key={a.id} href={`/struktur/${a.id}`}>
                {a.name}
              </Link>
            ))}
            {/* Round 15: the breadcrumb ends with the CURRENT unit, so the path
                reads "Badan Pelaksana Harian > Sekretaris Jenderal" (user:
                "Badan Pelaksana Harian seharusnya Badan Pelaksana Harian >
                Sekretaris Jenderal"); the ">" separator is the CSS rule
                `.site-unit__crumbs-path > * + *::before` and the last crumb is
                the page itself (not a link). */}
            <span className="site-unit__crumbs-self">{unit.name}</span>
          </span>
        </nav>

        <hr className="site-album__divider" />

        <header className="site-about__head">
          {/* Round 38 (user: "Judul halaman detil bidang: Bidang Minat dan
              Bakat (enter) Direktorat Sumber Daya Manusia"): the bidang
              title runs to TWO lines — the bidang name, then its direktorat
              (the `\n` renders via white-space: pre-line). */}
          <h1 className="site-event__title site-unit__title">
            {unit.type === "bidang" && parentUnit ? `${unit.name}\n${parentUnit.name}` : unit.name}
          </h1>
          {/* Round 15: no code pill next to the title on the LEAD pages (user:
              "Sekretaris Jenderal SEKJEN yang diatas foto, hilangkan pills
              nya, hanya Sekretaris Jenderal saja") — the pill stays on the
              other unit pages. */}
          {!isLead && unit.code && (
            <span className="site-about__code site-unit__code">{unit.code}</span>
          )}
        </header>

        {isLead ? (
          /* The lead hero: NO "Pengurus" heading (user round 14: "Tulisan
             Pengurus dan garis dibawahnya dihapus") — instead one big
             PORTRAIT photo per person, centred, with the jabatan text and
             the code pill (SEKJEN) underneath ("Gambar dibuat lebih besar,
             bentuknya potrait, dan posisi center. Dibawahnya ada tulisan
             Sekretaris Jenderal, Pills SEKJEN"). Round 31: the portraits are
             the unit's HEADS (head: true — the sekretaris & staff list under
             "Pengurus" below, so a directorate with a Sekretaris does not
             crowd the hero). */
          <section className="site-about__section">
            <ul className="site-unit__leads">
              {unit.members.some((m) => m.head) ? (
                unit.members
                  .filter((m) => m.head)
                  .map((member, i) => (
                    <li key={`${member.name}-${i}`} className="site-unit__lead">
                      {member.photo ? (
                        // eslint-disable-next-line @next/next/no-img-element -- member photo from the admin upload
                        <img className="site-unit__lead-photo" src={member.photo} alt="" />
                      ) : (
                        <span className="site-unit__lead-photo" aria-hidden="true">
                          {avatar(member.name)}
                        </span>
                      )}
                      <span className="site-unit__lead-meta">
                        <strong className="site-unit__lead-name">{member.name}</strong>
                        {/* Round 36: the jabatan reads "Kepala Biro JMO".
                            Officer roles ("Sekretaris Jenderal", …) pass
                            through unchanged. Round 37 (user: "Jabatan Kepala
                            Biro seharusnya begini, contoh: Kepala Biro
                            Kesekretariatan dan Administrasi, Pills:
                            Kabiro-KSA"): the BIRO jabatan takes the FULL
                            name (minus the leading "Biro ") and the pill
                            reads "Kabiro-KSA" (the CSS uppercases it). */}
                        <span className="site-unit__lead-jabatan">
                          {/* Round 38: direktorat/bidang heads get the FULL
                              name + DIR-…/KABID-… pills (the bidangs on two
                              lines); the biro kept round 37's wording. */}
                          {leadJabatan(member.role)}
                        </span>
                        {leadPill() && <span className="site-about__code">{leadPill()}</span>}
                      </span>
                    </li>
                  ))
              ) : (
                /* Round 15: with no person registered yet the hero shows the
                   sample name "Budi Setiawan" under the photo (user: "Dibawah
                   foto kasih nama default dulu, Budi Setiawan"). */
                <li className="site-unit__lead">
                  <span className="site-unit__lead-photo" aria-hidden="true">
                    {avatar(LEAD_FALLBACK_NAME)}
                  </span>
                  <span className="site-unit__lead-meta">
                    <strong className="site-unit__lead-name">{LEAD_FALLBACK_NAME}</strong>
                    <span className="site-unit__lead-jabatan">{unit.name}</span>
                    {unit.code && <span className="site-about__code">{unit.code}</span>}
                  </span>
                </li>
              )}
            </ul>
          </section>
        ) : unit.type === "koordinator" ? (
          /* Round 34 (user: "Di halaman Detil Bapelha. Saya ingin pengurus
             diganti dengan Sekjen, Dibawahnya ada Wasekjen, Dibawah Wasekjen
             ada Sektif dan Bend. Lalu Bagian Terkait" — then: "Maksud saya
             tampilkan fotonya"): the ROOT page has no "Pengurus" grid — the
             officer line renders here WITH PHOTOS, nested by the functional
             chain: Sekjen's big portrait on top, the Wasekjen under him,
             Sektif & Bend under the Wasekjen, each column a link to the
             officer's page. "Bagian Terkait" still follows. */
          unit.officerTree.length > 0 && (
            <section className="site-about__section">
              <ul className="site-unit__officers">
                {unit.officerTree.map((branch) => officerBranch(branch, 1))}
              </ul>
            </section>
          )
        ) : (
          unit.members.length > 0 && (
            <section className="site-about__section">
              <h2 className="site-about__heading">{t.unitMembers}</h2>
              {memberGrid(unit.members)}
            </section>
          )
        )}

        {/* Round 35 (user: "Buat urutan fotonya begini: Kepala/Dir. Wakil.
            Sekretaris. Staff."): the wakil photo columns sit RIGHT UNDER the
            Kepala/Direktur hero, BEFORE the team — the photo order now runs
            Kepala → Wakil → Sekretaris → Staff → Bagian Terkait (rounds
            19-30 rendered the team between the hero and the wakil). On the
            officer pages (SEKTIF/BEND) the order was already this. */}
        {wakilHeading && deputies.length > 0 && (
          <section className="site-about__section">
            <h2 className="site-about__heading">{t.unitDeputies}</h2>
            <ul className="site-unit__deputies">
              {deputies.map((child) => {
                const person = child.members[0];
                return (
                  <li key={child.id}>
                    <Link className="site-unit__deputy" href={`/struktur/${child.id}`}>
                      {person?.photo ? (
                        // eslint-disable-next-line @next/next/no-img-element -- wakil photo from the admin upload
                        <img className="site-unit__deputy-photo" src={person.photo} alt="" />
                      ) : (
                        <span className="site-unit__deputy-photo" aria-hidden="true">
                          {avatar(person?.name ?? child.name)}
                        </span>
                      )}
                      <span className="site-unit__deputy-meta">
                        <strong className="site-unit__deputy-name">
                          {person?.name ?? LEAD_FALLBACK_NAME}
                        </strong>
                        {/* Round 24: with ≥ 2 wakil sharing a base code the
                            jabatan reads "Wasektif 1", "Wasektif 2" (see
                            deputyJabatan) — the OFFICER pages; round 36 the
                            biro/direktorat/bidang wakil read "Waka KSA",
                            "Wadir PSDM", "Wakabid KOMDIGI-TDI" (short form +
                            the parent's code); round 37 (user: "Jabatan Wakil
                            Kepala Biro seharusnya begini, contoh: Wakil Kepala
                            Biro Kesekretariatan dan Administrasi, Pills:
                            Wakabiro-KSA") the BIRO wakil take the FULL name
                            and the Wakabiro-… pill instead — both JMO wakil
                            columns read the same. */}
                        <span className="site-unit__deputy-jabatan">
                          {/* Round 38 (user: "Untuk Wabiro dan Wadir yang
                              hanya 1, sebaiknya ditulis Wabiro dan Wadir
                              saja Pillsnya, bukan Wabiro-I. Namun jika yang
                              ada dua maka ditulis Wadir-I dan Wadir II. Dan
                              jabatannya Wakil Kepala 1 Biro Jaminan Mutu
                              Organisasi, Wakil Direktur 2 Direktorat
                              Komunikasi Digital"): the wakil columns now read
                              the full jabatan (numbered when two) and
                              WABIRO/-I/-II, WADIR/-I/-II, WAKABID-… pills. */}
                          {wakilJabatan(child)}
                        </span>
                        {wakilPill(child) && (
                          <span className="site-about__code">{wakilPill(child)}</span>
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Round 35: the lead pages' team splits into its own headings, in
            the requested photo order: "Sekretaris" then "Staff" (the heads
            already have their hero portrait above — round 31). Members with
            any other role fall back to the plain "Pengurus" grid last. */}
        {isLead &&
          (() => {
            const team = unit.members.filter((m) => !m.head);
            const sekretaris = team.filter((m) => m.role === "Sekretaris");
            const staff = team.filter((m) => m.role === "Staff");
            const rest = team.filter((m) => m.role !== "Sekretaris" && m.role !== "Staff");
            return (
              <>
                {sekretaris.length > 0 && (
                  <section className="site-about__section">
                    <h2 className="site-about__heading">{t.unitSekretaris}</h2>
                    {/* Round 37: portrait columns, not a grid row — like the
                        wakil. */}
                    {sekretarisPortrait(sekretaris)}
                  </section>
                )}
                {staff.length > 0 && (
                  <section className="site-about__section">
                    <h2 className="site-about__heading">{t.unitStaff}</h2>
                    {memberGrid(staff)}
                  </section>
                )}
                {rest.length > 0 && (
                  <section className="site-about__section">
                    <h2 className="site-about__heading">{t.unitMembers}</h2>
                    {memberGrid(rest)}
                  </section>
                )}
              </>
            );
          })()}

        {unit.divisions.map((division) => (
          <section className="site-about__section" key={division.name}>
            <h2 className="site-about__heading">{division.name}</h2>
            {memberGrid(division.members)}
          </section>
        ))}

        {(() => {
          // The "Bagian Terkait" of EVERY page (round 27: the units ABOVE,
          // `managers`; round 29 (user: "Bagian terkait itu menjelaskan
          // bagian yang keatas saja namun juga bawahnya"): the units BELOW
          // too, `reporters` — so the section spans the reporting line both
          // ways: SEKTIF → [Wasekjen, KSA, JMO], WASEKJEN → [Bapelha, Sekjen,
          // Sektif, Bend, the five direktorat], PSDM-BAKAT → [Wasekjen,
          // Direktorat PSDM]. The chain-less blocks — the root (Bapelha,
          // whose officers report to it but whose page keeps its own
          // children) and the umbrellas (Biro & Direktorat) — keep the
          // display-tree children (round 15). The KEPALA/Direktur hero, the
          // wakil photo columns and the Sekretaris/Staff team all render
          // ABOVE (round 35 moved the wakil up — user: "Kepala/Dir. Wakil.
          // Sekretaris. Staff."); round 30 (user: "disetiap bagian terkait
          // diatasnya beri garis pembatas dulu seperti Sektif dan Wakil
          // sektif"): the cards keep the hairline above them via the
          // `site-unit__related` class even where no section precedes it.
          const cards =
            unit.managers.length > 0
              ? [
                  // Round 37 (user: "Pada bagian Detil Wasekjen, hapus Badan
                  // Pelaksana Harian di Bagian Terkait"): the WASEKJEN's list
                  // drops the root — his chain starts at the Sekretaris
                  // Jenderal.
                  ...unit.managers.filter(
                    (m) => !(unit.type === "wasekjen" && m.type === "koordinator"),
                  ),
                  // The below-units skip the wakil that already have their
                  // photo columns above (rounds 24/25 did the same).
                  ...unit.reporters.filter((r) => !deputies.some((d) => d.id === r.id)),
                ]
              : unit.related;
          return (
            cards.length > 0 && (
              <section className="site-about__section site-unit__related">
                <h2 className="site-about__heading">{t.unitChildren}</h2>
                <ul className="site-unit__children">
                  {cards.map((child) => (
                    <li key={child.id}>
                      <Link className="site-unit__child" href={`/struktur/${child.id}`}>
                        <strong>{child.name}</strong>
                        {child.code && <span className="site-about__code">{child.code}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )
          );
        })()}
      </div>
    </main>
  );
}
