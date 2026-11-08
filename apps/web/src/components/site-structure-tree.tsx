"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

/**
 * One unit as the About tree needs it (a serializable subset of PublicUnit:
 * the server page passes the flat unit list, this component nests it). Round
 * 31 (user: "Di halaman about, nama2nya jangan ditampilkan. Cukup di bagian
 * detil saja"): no MEMBERS here — the people (name — role) only list on the
 * unit's detail page, the tree keeps the unit rows alone.
 */
export interface StructureUnit {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly code: string;
  readonly type: string;
  readonly divisions: readonly {
    readonly name: string;
  }[];
}

const Chevron = () => (
  <svg
    className="site-about__unit-chevron"
    viewBox="0 0 16 16"
    width="12"
    height="12"
    aria-hidden="true"
  >
    <path
      d="M6 3l5 5-5 5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const isUmbrella = (unit: StructureUnit) => unit.type === "biro" || unit.type === "direktorat";

/* The three headline units stay large wherever they sit: Bapelha (the only
   root), and the Biro & Direktorat umbrella toggles (user: "Ukuran font
   selain Badan Pelaksana Harian, Biro, dan Direktorat Diperkecil" — their
   SIZE never shrank, only their position moved, round 9). Sekretaris
   Jenderal & Wakil Sekretaris Jenderal share one size one step above the
   rest (user round 9: "Ukuran font Sekretaris Jenderal dan Wakil Sekretaris
   Jenderal dibuat sama. Setelah itu ukurannya diperbesar 1px"). */
const isExec = (unit: StructureUnit) => unit.type === "sekjen" || unit.type === "wasekjen";

const rowClass = (depth: number, unit: StructureUnit, umbrellaWithChildren: boolean) => {
  if (depth === 0 || umbrellaWithChildren) return "site-about__unit";
  if (isExec(unit)) return "site-about__unit site-about__unit--small site-about__unit--lead";
  return "site-about__unit site-about__unit--small";
};

/**
 * A unit's detail content: its divisions, then the nested rows below. NO
 * people lists anymore (user round 31: "Di halaman about, nama2nya jangan
 * ditampilkan. Cukup di bagian detil saja" — the names & roles only render
 * on /struktur/[unitId]) and no "belum diumumkan" note (user round 7: "Hapus
 * semua teks Pengurus bagian ini belum diumumkan. Detil pengurus akan
 * dimunculkan Ketika biro/direktorat di klik saja"). Under Bapelha the four
 * officers are FLAT — one row each, nothing nested (round 22: the wasekjen,
 * sektif and bend hang off BAPELHA, not off the sekjen; their wakil stay on
 * the DETAIL pages); a Biro/Direktorat that
 * sits deeper still expands its own dropdown ("all" — the umbrella IS the
 * cap, so its boards always render, user round 9).
 */
function UnitBody({
  unit,
  byParent,
  depth,
  maxDepth,
  open,
  onToggle,
  isDropdown,
}: {
  unit: StructureUnit;
  byParent: ReadonlyMap<string | null, readonly StructureUnit[]>;
  depth: number;
  maxDepth: number | "all";
  open: ReadonlySet<string>;
  onToggle: (id: string) => void;
  isDropdown: (unit: StructureUnit) => boolean;
}) {
  const children = byParent.get(unit.id) ?? [];
  const showChildren =
    children.length > 0 && (maxDepth === "all" || depth < maxDepth || isDropdown(unit));
  const childMax: number | "all" = isDropdown(unit) ? "all" : maxDepth;
  return (
    <>
      {unit.divisions.length > 0 && (
        <ul className="site-about__divisions">
          {unit.divisions.map((division) => (
            <li key={division.name}>
              <span className="site-about__division">{division.name}</span>
            </li>
          ))}
        </ul>
      )}
      {showChildren && (
        <ul className="site-about__tree">
          {children.map((child) => (
            <UnitRow
              key={child.id}
              unit={child}
              byParent={byParent}
              depth={depth + 1}
              maxDepth={childMax}
              open={open}
              onToggle={onToggle}
              isDropdown={isDropdown}
            />
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * The tree has THREE sibling roots, each rendered as its own static block
 * (user round 6: "Biro dan Direktorat dibuat sejajar dengan BAPELHA"; user
 * round 9 briefly moved the umbrellas into the Secretary General's branch —
 * "Posisi Biro dan direktorat Sejajar dengan Sekretaris Eksekutif dan
 * Bendahara" — but round 10 moved them back up: "Bagian Biro dan Direktoran
 * kembali digeser ke kiri, sejajar dengan Badan Pelaksana Harian"; the extra
 * picture on top of round 6 is the hairline separator between the blocks,
 * below Bendahara Eksekutif and below the last biro — user round 10:
 * "dibawah Bendahara Eksekutif dan dibawah biro paling bawah, diberi garis
 * batas untuk pemisah"). Bapelha's row opens a STATIC tree (no dropdown):
 * the four officers hang FLAT one level under it — Sekretaris Jenderal,
 * Wakil Sekretaris Jenderal, Sekretaris Eksekutif and Bendahara Eksekutif
 * side by side (round 22 flattened the hierarchy: "anggota Bapelha itu
 * sekjen, wasekjen, sektif, dan bendtif. Jadi wasekjen, sektif, dan
 * bendtif bukan bagian dari sekjen"). A further "wakil" unit (any deputy
 * added later) is only on its parent's detail
 * page (user rounds 5-6: "Biar nanti jika ada wakilnya cukup ditampilkan di
 * halaman detilnya saja"; round 18 briefly rendered the SEKTIF/BEND wakil
 * in the tree too, round 19 reverted it: "Bukan seperti itu, kembalikan" —
 * the wakil live on their parent's DETAIL page, not in the tree). Biro and
 * Direktorat ARE dropdowns (user:
 * "sementara Direktorat dan biro dropdown"): their row is a toggle (chevron
 * rotates on expand, COLLAPSED by default — round 11: "Biro dan Direktorat
 * tidak tampil datanya (perlu diklik dropdown, baru muncul datanya)"; round
 * 6's "langsung muncul semua biro dan direktoratnya" was superseded) whose
 * detail below lists the KSA/JMO/KPK (or the five
 * direktorats and, inside each, the Bidang) — all reachable from any depth.
 * Every other row is a LINK to its own page (/struktur/[unitId]); there is
 * no "Lihat detail pengurus" text (user round 5) and no "belum diumumkan"
 * note (user round 7).
 */
export default function StructureTree({ units }: { units: readonly StructureUnit[] }) {
  const byParent = useMemo(() => {
    const map = new Map<string | null, StructureUnit[]>();
    for (const unit of units) {
      const list = map.get(unit.parentId);
      if (list) list.push(unit);
      else map.set(unit.parentId, [unit]);
    }
    return map;
  }, [units]);
  const byId = useMemo(() => {
    const map = new Map<string, StructureUnit>();
    for (const unit of units) map.set(unit.id, unit);
    return map;
  }, [units]);
  // A dropdown is an umbrella shell whose own parent is NOT an umbrella —
  // i.e. exactly the Biro and Direktorat rows, wherever they sit: their
  // contents (KSA/JMO/KPK, the five direktorats + Bidang) remain static
  // link rows with their nested details (user rounds 4+9).
  const isDropdown = (unit: StructureUnit) => {
    const parent = unit.parentId ? byId.get(unit.parentId) : undefined;
    return isUmbrella(unit) && !(parent && isUmbrella(parent));
  };
  // Every dropdown starts COLLAPSED: the Biro/Direktorat contents only
  // appear after the user clicks the toggle (user round 11: "Biro dan
  // Direktorat tidak tampil datanya (perlu diklik dropdown, baru muncul
  // datanya)" — round 6 had them open by default, that is superseded).
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const roots = byParent.get(null) ?? [];
  return (
    <>
      {roots.map((root) => (
        <section key={root.id} className="site-about__structure-part">
          {/* The bare li of a root row renders a stray list-item marker next
              to "Badan Pelaksana Harian" (user round 7: "Sebelah Badan
              Pelaksana Harian ada bullet, itu dihapus") — wrap it in a clean
              ul so the li has a proper list context without bullets. */}
          <ul className="site-about__structure-root-tree">
            <UnitRow
              unit={root}
              byParent={byParent}
              depth={0}
              // Round 18 raised this to 4 (the SEKTIF/BEND wakil in the tree),
              // round 19 reverted it — "Bukan seperti itu, kembalikan": the
              // wakil belong on their parent's detail page ("Wakil" cards).
              // Round 22 flattened the officers under Bapelha (wasekjen,
              // sektif and bend are no longer children of the sekjen), so 1
              // now renders exactly those four rows — cap 3 would have
              // reached nothing anyway (no depth-2 children any more).
              maxDepth={1}
              open={open}
              onToggle={toggle}
              isDropdown={isDropdown}
            />
          </ul>
        </section>
      ))}
    </>
  );
}

/**
 * A static (always-visible) row — or, for a Biro/Direktorat, a dropdown
 * toggle: link/button to the unit's page toggle, then its body (divisions,
 * nested rows). The detail box only renders when the unit
 * actually HAS content (no more empty "belum diumumkan" boxes, user round
 * 7); the root's box is "tight" so its first row sits close under Badan
 * Pelaksana Harian — now at the same 12px as every other parent row (user
 * round 9: "Jarak atas Bawah Sekretaris Jenderal belum sama dengan yang
 * lain"). `maxDepth=1` under Bapelha renders exactly the four officer rows
 * (and the two umbrella toggles) — flat, nothing nested: their wakil are
 * depth-2 rows cut off by the cap (round 18 tried them in the tree,
 * reverted in round 19), they live on the officers' DETAIL pages as photo
 * columns (round 20). Umbrella subtrees pass `"all"`.
 */
function UnitRow({
  unit,
  byParent,
  depth,
  maxDepth,
  open,
  onToggle,
  isDropdown,
}: {
  unit: StructureUnit;
  byParent: ReadonlyMap<string | null, readonly StructureUnit[]>;
  depth: number;
  maxDepth: number | "all";
  open: ReadonlySet<string>;
  onToggle: (id: string) => void;
  isDropdown: (unit: StructureUnit) => boolean;
}) {
  const children = byParent.get(unit.id) ?? [];
  /* Same rule as UnitBody: rows whose children are cut off by the depth cap
     must NOT draw an empty detail box (its margin would add a phantom gap
     between the rows — user round 8: "Jarak antar Sekretaris Jenderal, Wakil
     Sekretaris Jenderal, Sekretaris Eksekutif, Bendahara Eksekutif
     diseragamkan"). A dropdown's children are never cut off. */
  const showChildren =
    children.length > 0 && (maxDepth === "all" || depth < maxDepth || isDropdown(unit));
  const hasContent = unit.divisions.length > 0 || showChildren;
  const detailClass =
    depth === 0
      ? "site-about__unit-detail site-about__unit-detail--tight"
      : "site-about__unit-detail";
  if (isDropdown(unit) && showChildren) {
    const expanded = open.has(unit.id);
    return (
      <li>
        <button
          type="button"
          className={rowClass(depth, unit, showChildren)}
          aria-expanded={expanded}
          onClick={() => onToggle(unit.id)}
        >
          <strong>{unit.name}</strong>
          {unit.code && <span className="site-about__code">{unit.code}</span>}
          <Chevron />
        </button>
        {expanded && (
          <div className={detailClass}>
            <UnitBody
              unit={unit}
              byParent={byParent}
              depth={depth}
              maxDepth="all"
              open={open}
              onToggle={onToggle}
              isDropdown={isDropdown}
            />
          </div>
        )}
      </li>
    );
  }
  return (
    <li>
      <Link
        className={rowClass(depth, unit, isDropdown(unit) && showChildren)}
        href={`/struktur/${unit.id}`}
      >
        <strong>{unit.name}</strong>
        {unit.code && <span className="site-about__code">{unit.code}</span>}
      </Link>
      {hasContent && (
        <div className={detailClass}>
          <UnitBody
            unit={unit}
            byParent={byParent}
            depth={depth}
            maxDepth={maxDepth}
            open={open}
            onToggle={onToggle}
            isDropdown={isDropdown}
          />
        </div>
      )}
    </li>
  );
}
