import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { lazyEnv } from "@website/config/env";
import { createSqlOrgUnitStore } from "@website/db/sql";
import type { OrgUnit } from "@website/domain/organizations";
import { webDb } from "./db";

/** One person on the public structure: display data only (no account, no photo). */
export interface PublicMember {
  readonly name: string;
  readonly role: string;
  readonly head: boolean;
  /** The member's uploaded photo URL, when the admin set one. */
  readonly photo: string | null;
}

/** One division of a unit, with its people. */
export interface PublicDivision {
  readonly name: string;
  readonly members: readonly PublicMember[];
}

/**
 * One unit of the ACTIVE period's structure, flattened for the public page: the
 * admin's OrgUnit minus ids' timelines and photos (the About page renders the
 * tree from `parentId`).
 */
export interface PublicUnit {
  readonly id: string;
  readonly parentId: string | null;
  /** The unit this unit reports to (id; functional chain, round 23). */
  readonly reportTo: string | null;
  readonly name: string;
  readonly code: string;
  readonly type: OrgUnit["type"];
  readonly members: readonly PublicMember[];
  readonly divisions: readonly PublicDivision[];
}

/** A unit's detail page: the unit itself, its children and its ancestors. */
export interface PublicUnitDetail extends PublicUnit {
  readonly children: readonly PublicUnit[];
  /**
   * The "Bagian Terkait" list of the detail page. Usually the unit's direct
   * children; on the SEKJEN page it ALSO includes the units under them
   * (WASEKJEN + Sekretaris Eksekutif + Bendahara Eksekutif — the executive
   * team below the Secretary General, user round 15: "Isinya Wasekjen,
   * Sekretaris Eksekutif, Bendahara Eksekutif"; round 16 tried WASEKJEN too
   * but round 17 reverted it: "Hilangkan Wakil Sekretaris Eksekutif WASEKTIF
   * dan Wakil Bendahara Eksekutif WABEND"), while the tree itself is
   * untouched (SEKTIF/BEND stay children of WASEKJEN in the About hierarchy).
   */
  readonly related: readonly PublicUnit[];
  /** Root first: every ancestor's own id and name (the breadcrumb) — on the
   * officer-line pages the intermediate officer levels are skipped (round
   * 21), so Bapelha usually stays the only link. */
  readonly ancestors: readonly { readonly id: string; readonly name: string }[];
  /**
   * The units whose `reportTo` points at this one (round 24: the "Bagian
   * Terkait" of the four officer pages — SEKJEN/WASEKJEN/SEKTIF/BEND — comes
   * from the reporting line, e.g. KSA/JMO on the SEKTIF page, KPK on the BEND
   * page, the five directorates on the WASEKJEN page). On the SEKJEN page it
   * ALSO covers the officer line one level below his direct reporters (round
   * 33: Sektif & Bend, who report to the Wasekjen — user: "Saya ingin di
   * Sekjen ditampilkan juga Sektif dan Bend"). In display tree order.
   */
  readonly reporters: readonly PublicUnit[];
  /**
   * Round 27 (user: "di halaman bagian terkait itu seharusnya muncul untuk
   * bagian diatasnya, Misal PSDM-Bakat itu bagian terkaitnya ada Wasekjen,
   * Direktorat ..."): the units this one REPORTS TO up its functional chain
   * (`reportTo`), stopping BELOW the Sekretaris Jenderal (the executive
   * head — a direktorat/bidang's boss line ends at the wasekjen), TOP-FIRST.
   * Empty for the root (Bapelha) and the umbrella levels (Biro/Direktorat),
   * whose "Bagian Terkait" falls back to their children.
   */
  readonly managers: readonly PublicUnit[];
  /**
   * Round 34 (user: "Di halaman Detil Bapelha. Saya ingin pengurus diganti
   * dengan Sekjen, Dibawahnya ada Wasekjen, Dibawah Wasekjen ada Sektif dan
   * Bend. Lalu Bagian Terkait"): the officer line under the ROOT (Bapelha),
   * NESTED by `reportTo` — the Sekjen on top, the Wasekjen under him, then
   * Sektif & Bend under the Wasekjen (the functional chain, three levels
   * deep, officers only: the direktorat — which also report to the Wasekjen
   * — never enter here, nor the wakil deeper down). The koordinator page
   * renders it in place of the "Pengurus" members grid. Empty on every other
   * page.
   */
  readonly officerTree: readonly PublicUnitBranch[];
}

/** One node of the root's officer line (round 34): a unit and its officers
 * beneath it, by `reportTo`. */
export interface PublicUnitBranch {
  readonly unit: PublicUnit;
  readonly children: readonly PublicUnitBranch[];
}

/**
 * The wakil-numbering suffix of a unit code (round 24/26: "WASEKTIF-II",
 * "WAKA-I", "WADIR-II" — digits or roman numerals after a dash, or bare
 * trailing digits). Batteries of wakil use it, so it also tells the ABOUT
 * tree to skip them: round 27 (user: "Seharusnya wakil tidak muncul di
 * halaman About, biarkan saja seperti sebelumnya") — the wakil live on their
 * unit's detail page only, like the officer wakil never entered the tree.
 */
export const WAKIL_CODE_SUFFIX = /(?:-\d+|\d+$|-[IVXLC]+)$/;

const db = lazyEnv(() => webDb());
const orgUnits = lazyEnv(() => createSqlOrgUnitStore(webDb()));

/**
 * The Bapelha officer line: Sekretaris Jenderal, Wakil Sekretaris Jenderal,
 * Sekretaris Eksekutif, Bendahara Eksekutif and their wakil. Breadcrumbs on
 * these pages skip the intermediate officer levels (rounds 17 & 21) —
 * `koordinator` (Bapelha, the root) is deliberately NOT in the set so it is
 * always kept.
 */
const OFFICER_TYPES = new Set(["sekjen", "wasekjen", "staf", "bendahara", "wakil_bendahara"]);

const publicMember = (m: OrgUnit["members"][number]): PublicMember => ({
  name: m.name,
  role: m.role,
  head: m.head,
  photo: m.photo?.url ?? null,
});

const publicUnitFrom = (u: OrgUnit): PublicUnit => ({
  id: u.id,
  parentId: u.parentId,
  reportTo: u.reportTo,
  name: u.name,
  code: u.code,
  type: u.type,
  members: u.members.map(publicMember),
  divisions: u.divisions.map((d) => ({
    name: d.name,
    members: d.members.map(publicMember),
  })),
});

/**
 * The ACTIVE board period's units for the About page (cached for minutes under the
 * tag "structure": an activation or a structure change in the admin shows up
 * within minutes). With no active period — or no units yet — the page shows the
 * "board not announced yet" fallback.
 */
export async function publicStructure(): Promise<readonly PublicUnit[]> {
  "use cache";
  cacheTag("structure");
  cacheLife("minutes");
  const active = await db().collection("settings").doc("activePeriod").get();
  const periodId = active.get("periodId");
  if (typeof periodId !== "string") return [];
  // Round 27: the wakil rows never entered the tree (the officer wakil are
  // hidden by the depth cap; the biro/direktorat wakil from round 26 get
  // filtered HERE so the About page looks exactly like before — user:
  // "Seharusnya wakil tidak muncul di halaman About, biarkan saja seperti
  // sebelumnya").
  return (await orgUnits().listForPeriod(periodId))
    .filter(
      (u) =>
        u.active &&
        !(u.code.includes("-") && WAKIL_CODE_SUFFIX.test(u.code) && u.parentId !== null),
    )
    .map(publicUnitFrom);
}

/**
 * Round 35 (user: "Sekarang buat Halaman Biro dan Direktorat tidak ada
 * detilnya. Hanya KSA, JMO, KPK, PSDM, HAL, KOMDIGI, PDR, PPM saja"): the
 * umbrella SHELLS — the top-level "Biro" and "Direktorat" rows (parentId
 * null, no real office of their own — cf. a real biro/direktorat like KSA or
 * PSDM, which hang BELOW them) — have no detail page in the schema sense:
 * they exist only as the About tree's dropdown headers. The real biro and
 * direktorat keep their pages.
 */
const isUmbrellaUnit = (u: OrgUnit) =>
  (u.type === "biro" || u.type === "direktorat") && u.parentId === null;

/**
 * One ACTIVE unit of the current period for its detail page (cached under the
 * same "structure" tag): the unit, its children in display order and its
 * ancestors root-first for the breadcrumb. `null` when there is no active
 * period or the unit is not among the active ones (the page 404s then).
 */
export async function publicUnit(unitId: string): Promise<PublicUnitDetail | null> {
  "use cache";
  cacheTag("structure");
  cacheLife("minutes");
  const active = await db().collection("settings").doc("activePeriod").get();
  const periodId = active.get("periodId");
  if (typeof periodId !== "string") return null;
  const units = (await orgUnits().listForPeriod(periodId)).filter((u) => u.active);
  const unit = units.find((u) => u.id === unitId);
  if (!unit) return null;
  // Round 35: the umbrella shells 404 — they are tree headers, not offices.
  if (isUmbrellaUnit(unit)) return null;
  const byId = new Map(units.map((u) => [u.id, u]));
  const children = units.filter((u) => u.parentId === unitId).map(publicUnitFrom);
  return {
    ...publicUnitFrom(unit),
    children,
    related:
      unit.type === "sekjen"
        ? // The SEKJEN's list also covers the units under WASEKJEN (see the
          // interface). Round 16 widened this to WASEKJEN too ("buat gaya
          // yang sama untuk wasekjen"), but round 17 came back — the wakil
          // units dropped again (user: "Hilangkan Wakil Sekretaris Eksekutif
          // WASEKTIF dan Wakil Bendahara Eksekutif WABEND") — so only the
          // secretary general keeps the rounded list.
          //
          // DORMANT since round 22: the hierarchy was flattened (wasekjen,
          // sektif and bend are now direct children of Bapelha, not of the
          // sekjen), so a sekjen has no children and its "Bagian Terkait"
          // section simply does not render. Bapelha's list — four cards for
          // SEKJEN/WASEKJEN/SEKTIF/BEND — is the plain `children` branch.
          children.concat(
            units
              .filter((u) => u.parentId !== null && children.some((c) => c.id === u.parentId))
              .map(publicUnitFrom),
          )
        : children,
    // Round 24: the units reporting to this one, in display tree order
    // (listForPeriod already returns tree order). Round 33 (user: "Sekarang
    // fokus di Bagian Terkait. Saya ingin di Sekjen ditampilkan juga Sektif
    // dan Bend"): on the SEKJEN page the list ALSO covers the officers one
    // level below his direct reporters — Sektif & Bend report to the Wasekjen
    // (bpl-04/bpl-06 → bpl-03), not to the sekjen himself, and the user wants
    // them on his page anyway. Data-driven on the OFFICER line only (the
    // officer types: staf & bendahara — the five direktorat report to the
    // Wasekjen too but stay on HIS page, round 33: "Sektif dan Bend").
    reporters: (() => {
      const direct = units.filter((u) => u.reportTo === unitId);
      if (unit.type !== "sekjen") return direct.map(publicUnitFrom);
      return [
        ...direct,
        ...units.filter(
          (u) => direct.some((d) => d.id === u.reportTo) && OFFICER_TYPES.has(u.type),
        ),
      ].map(publicUnitFrom);
    })(),
    // Round 27 (user: "Ini berlaku untuk semua bagian, coba periksa kembali"):
    // the units this unit reports to (walk `reportTo`, TOP-FIRST). The chain
    // stops below the SEKJEN — save for the WASEKJEN itself, whose only
    // superiors ARE the Sekjen and the Bapelha root; the root and the
    // umbrella blocks (Biro/Direktorat) have no chain at all (their "Bagian
    // Terkait" fall back to the children). PSDM-BAKAT → [Wasekjen, Direktorat
    // PSDM]; SEKTIF → [Wasekjen]; WASEKJEN → [Bapelha, Sekjen].
    managers: (() => {
      const chain: OrgUnit[] = [];
      const seen = new Set<string>();
      let hop = unit.reportTo ? byId.get(unit.reportTo) : undefined;
      while (hop && !seen.has(hop.id)) {
        // The sekjen ends the chain for everyone BELOW the wasekjen; the
        // wasekjen itself keeps the sekjen (and Bapelha) in its list.
        if (hop.type === "sekjen" && chain.length > 0) break;
        seen.add(hop.id);
        chain.push(hop);
        hop = hop.reportTo ? byId.get(hop.reportTo) : undefined;
      }
      return chain.reverse().map(publicUnitFrom);
    })(),
    // Round 34: the ROOT's officer line, nested by `reportTo` — the Sekjen
    // level, the Wasekjen under him, and Sektif & Bend under the Wasekjen
    // (the functional chain, three levels, officers only: the five
    // direktorat report to the Wasekjen too but stay out — user: "Dibawah
    // Wasekjen ada Sektif dan Bend").
    officerTree: (() => {
      if (unit.type !== "koordinator") return [];
      const officers = units.filter((u) => OFFICER_TYPES.has(u.type));
      const first = officers.filter((u) => u.reportTo === unitId);
      const second = officers.filter((u) => first.some((a) => a.id === u.reportTo));
      const third = officers.filter((u) => second.some((a) => a.id === u.reportTo));
      return first.map((sekjen) => ({
        unit: publicUnitFrom(sekjen),
        children: second
          .filter((w) => w.reportTo === sekjen.id)
          .map((wasekjen) => ({
            unit: publicUnitFrom(wasekjen),
            children: third
              .filter((o) => o.reportTo === wasekjen.id)
              .map((officer) => ({ unit: publicUnitFrom(officer), children: [] })),
          })),
      }));
    })(),
    ancestors: unit.path
      .filter((id) => id !== unitId)
      .map((id) => byId.get(id))
      .filter((u): u is OrgUnit => u !== undefined)
      // Round 35: the umbrella shells (Biro/Direktorat) have no detail page
      // any more — their crumb link would 404, so the biro/direktorat pages
      // (KSA, PSDM, …) open with themselves as the first (and only) crumb.
      .filter((u) => !isUmbrellaUnit(u))
      // Round 21: the officer-line pages (SEKTIF, BEND, their wakil — and
      // WASEKJEN, the round-17 case) skip the intermediate officer ancestors
      // so the crumb reads "Badan Pelaksana Harian > Sekretaris Eksekutif"
      // (user: "Badan Pelaksana Harian Sekretaris Jenderal Wakil Sekretaris
      // Jenderal Sekretaris Eksekutif, seharusnya dari Bapelha Langsung ke
      // Sekretaris Eksekutif saja"). Round 17's wasekjen-only filter
      // (`unit.type === "wasekjen" && u.type === "sekjen"`) is the special
      // case of this rule.
      .filter((u) => !(OFFICER_TYPES.has(unit.type) && OFFICER_TYPES.has(u.type)))
      .map((u) => ({ id: u.id, name: u.name })),
  };
}
