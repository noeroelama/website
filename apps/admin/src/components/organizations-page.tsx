"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EditableList } from "@/components/ui/editable-list";
import { Icon } from "@/components/ui/icon";
import { PhotoDrop } from "@/components/ui/photo-drop";
import { Modal } from "@/components/ui/modal";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import {
  INITIAL_PERIODS,
  INITIAL_PPIS,
  INITIAL_UNITS,
  PAGE_SIZE_OPTIONS,
  PERIOD_LABELS,
  UNIT_TYPES,
  type Division,
  type PeriodItem,
  type PeriodStatus,
  type PpiItem,
  type UnitItem,
  type UnitMember,
  type UnitType,
} from "@/data/mock/organizations";

/* ==================================================================
   Organizations — Period list, unit Structure, Create/Edit Unit form,
   and the PPI chapters list. Ported from the Figma "ORGANIZATIONS
   ADMIN" screens; colours come from the shared design tokens.
   ================================================================== */

/** Page subtitle on every screen (the Figma's own caption is a copy-paste
    leftover from the Gallery artboard, so the section name is corrected here). */
const ORG_SUBTITLE = "PPIDK ASIANIA ORGANIZATION ADMIN PAGE";

/** Screen state machine, following the breadcrumbs "Organizations > …". */
type OrgView = "period" | "structure" | "unit" | "ppi";

/** Default role for a fresh member row, by position in the list:
 *  1st = Kepala Direktorat, 2nd = Wakil Kepala Direktorat, 3rd = Sekretaris,
 *  anything after that is a Staff. */
const DEFAULT_ROLES = ["Kepala Direktorat", "Wakil Kepala Direktorat", "Sekretaris"] as const;
const roleForIndex = (index: number): string => DEFAULT_ROLES[index] ?? "Staff";

/** The role the Head button crowns the member with. */
const HEAD_ROLE = "Kepala Direktorat";

/** The role the division Head button crowns a division member with. */
const DIVISION_HEAD_ROLE = "Ketua";

type UnitFormMode = "create" | "edit";

/** Form shape for the unit form (Core Members + Divisions live here too). */
interface UnitForm {
  name: string;
  code: string;
  type: UnitType;
  members: UnitMember[];
  divisions: Division[];
}

/** Delete-confirmation union: one period/unit/ppi row, or a bulk of PPI rows. */
type OrgDelete =
  | { kind: "period"; item: PeriodItem }
  | { kind: "unit"; item: UnitItem }
  | { kind: "ppi"; item: PpiItem }
  | { kind: "many"; count: number };

/** Create/Edit Period popup. */
type PeriodModalState = { mode: "create" } | { mode: "edit"; item: PeriodItem } | null;

/** Sortable table header — label + arrow icon, gold when sorting (same
    pattern as the Events table's sortable columns). */
function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`admin-th-sort${active ? " admin-th-sort--active" : ""}`}
      onClick={onClick}
    >
      <span>{label}</span>
      <Icon name={active ? (dir === "asc" ? "arrowUp" : "arrowDown") : "sort"} size={12} />
    </button>
  );
}

/** Columns of the Period table that can be sorted (Aksi never sorts). */
type PeriodSortKey = "name" | "cabinet" | "status";

/** Columns of the PPI table that can be sorted (Members sorts numerically). */
type PpiSortKey = "name" | "country" | "members";

/** Slug shown under a unit name (the Figma structure row has name + slug). */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Period status chip — a plain two-state Active/Inactive text pill without
    any icon (the Figma Period row shows just the badge, no logo). */
function periodStatusBadge(status: PeriodStatus): ReactNode {
  const active = status === "published";
  return (
    <span
      className={
        active
          ? "admin-org-status admin-org-status--active"
          : "admin-org-status admin-org-status--inactive"
      }
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

/** ids for freshly added member/division rows (monotonic while the page lives). */
let ROW_SEQ = 1;
const nextRowId = () => `row-${ROW_SEQ++}`;

export function OrganizationsPage() {
  const pathname = usePathname();
  // key={pathname} remounts the list when the organizations route is (re)entered,
  // so pagination / selection / tab state start fresh on every visit (same
  // pattern as Events, Articles & Gallery).
  return <OrganizationsList key={pathname} />;
}

/** Organizations screens (all state lives here; remounted by OrganizationsPage
 *  on navigation so each visit starts clean). */
function OrganizationsList() {
  const toast = useToastMessage();
  /* ---- navigation ---- */
  const [view, setView] = useState<OrgView>("period");
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>(PERIOD_LABELS[1]!.id);
  const [unitFormMode, setUnitFormMode] = useState<UnitFormMode>("create");
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);

  /* ---- lists ---- */
  const [periods, setPeriods] = useState<PeriodItem[]>(INITIAL_PERIODS);
  const [units, setUnits] = useState<UnitItem[]>(INITIAL_UNITS);
  const [ppis, setPpis] = useState<PpiItem[]>(INITIAL_PPIS);

  /* Structure header pill options: the Figma labels first, then any periods
     created in this session (so a new period can be opened immediately). */
  const periodOptions = useMemo(() => {
    const knownIds = new Set(PERIOD_LABELS.map((p) => p.id));
    const extras = periods.filter((p) => !knownIds.has(p.id));
    return [...PERIOD_LABELS, ...extras.map((p) => ({ id: p.id, label: `Period ${p.name}` }))];
  }, [periods]);

  /* ---- UI state ---- */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [periodModal, setPeriodModal] = useState<PeriodModalState>(null);
  const [periodPage, setPeriodPage] = useState(1);
  /* Structure table page (per selected period) — the darkbar footer below the
     unit table paginates just like the Period list above. */
  const [unitPage, setUnitPage] = useState(1);
  /* No sort applied on load — headers show the plain sort icon like the other
     pages; first click on a column turns ascending. */
  const [periodSort, setPeriodSort] = useState<PeriodSortKey | null>(null);
  const [periodSortDir, setPeriodSortDir] = useState<"asc" | "desc">("asc");
  const onPeriodSort = (key: PeriodSortKey) => {
    if (periodSort === key) {
      setPeriodSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setPeriodSort(key);
      setPeriodSortDir("asc");
    }
    setPeriodPage(1);
  };
  /* Structure table: unit name sort (same no-default-active pattern). */
  const [unitSort, setUnitSort] = useState<"name" | null>(null);
  const [unitSortDir, setUnitSortDir] = useState<"asc" | "desc">("asc");
  const onUnitSort = (key: "name") => {
    if (unitSort === key) {
      setUnitSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setUnitSort(key);
      setUnitSortDir("asc");
    }
    setUnitPage(1);
  };
  /* PPI table: name / country / members sort (same no-default-active pattern). */
  const [ppiSort, setPpiSort] = useState<PpiSortKey | null>(null);
  const [ppiSortDir, setPpiSortDir] = useState<"asc" | "desc">("asc");
  const onPpiSort = (key: PpiSortKey) => {
    if (ppiSort === key) {
      setPpiSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setPpiSort(key);
      setPpiSortDir("asc");
    }
    setPpiPage(1);
  };
  const [ppiPage, setPpiPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [deleteConfirm, setDeleteConfirm] = useState<OrgDelete | null>(null);
  const [unitForm, setUnitForm] = useState<UnitForm>({
    name: "",
    code: "",
    type: "Biro",
    members: [],
    divisions: [],
  });
  const [divisionDragFrom, setDivisionDragFrom] = useState<number | null>(null);

  /* ---- period list: header sort + pagination ---- */
  const sortedPeriods = useMemo(() => {
    if (!periodSort) return periods;
    const copy = [...periods];
    copy.sort((a, b) => {
      const av = periodSort === "name" ? a.name : periodSort === "cabinet" ? a.cabinet : a.status;
      const bv = periodSort === "name" ? b.name : periodSort === "cabinet" ? b.cabinet : b.status;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return periodSortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [periods, periodSort, periodSortDir]);
  const periodTotalPages = Math.max(1, Math.ceil(periods.length / pageSize));
  const periodSafePage = Math.min(periodPage, periodTotalPages);
  const periodPageRows = sortedPeriods.slice(
    (periodSafePage - 1) * pageSize,
    periodSafePage * pageSize,
  );
  const periodShownStart = periods.length === 0 ? 0 : (periodSafePage - 1) * pageSize + 1;
  const periodShownEnd = Math.min(periodSafePage * pageSize, periods.length);

  /* ---- ppi list: sort + pagination (full list — All/Upcoming tabs are gone) ---- */
  const sortedPpis = useMemo(() => {
    if (!ppiSort) return ppis;
    const copy = [...ppis];
    copy.sort((a, b) => {
      if (ppiSort === "members") return a.members - b.members;
      const av = ppiSort === "name" ? a.name : a.country;
      const bv = ppiSort === "name" ? b.name : b.country;
      return av < bv ? -1 : av > bv ? 1 : 0;
    });
    return ppiSortDir === "asc" ? copy : copy.reverse();
  }, [ppis, ppiSort, ppiSortDir]);
  const ppiTotalPages = Math.max(1, Math.ceil(sortedPpis.length / pageSize));
  const ppiSafePage = Math.min(ppiPage, ppiTotalPages);
  const ppiPageRows = sortedPpis.slice((ppiSafePage - 1) * pageSize, ppiSafePage * pageSize);
  const ppiShownStart = sortedPpis.length === 0 ? 0 : (ppiSafePage - 1) * pageSize + 1;
  const ppiShownEnd = Math.min(ppiSafePage * pageSize, sortedPpis.length);

  /* ---- structure list: per-period pagination (darkbar footer, same as Period) ---- */
  const periodUnits = useMemo(
    () => units.filter((u) => u.periodId === selectedPeriodId),
    [units, selectedPeriodId],
  );
  const sortedUnitRows = useMemo(() => {
    if (!unitSort) return periodUnits;
    const copy = [...periodUnits];
    copy.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return unitSortDir === "asc" ? copy : copy.reverse();
  }, [periodUnits, unitSort, unitSortDir]);
  const unitTotalPages = Math.max(1, Math.ceil(sortedUnitRows.length / pageSize));
  const unitSafePage = Math.min(unitPage, unitTotalPages);
  const unitPageRows = sortedUnitRows.slice((unitSafePage - 1) * pageSize, unitSafePage * pageSize);
  const unitShownStart = sortedUnitRows.length === 0 ? 0 : (unitSafePage - 1) * pageSize + 1;
  const unitShownEnd = Math.min(unitSafePage * pageSize, sortedUnitRows.length);

  /* ---- bulk selection (PPI table) ---- */
  const pageSelected = ppiPageRows.every((r) => selected.has(r.id));
  const pageSomeSelected = ppiPageRows.some((r) => selected.has(r.id));
  const toggleAllPage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (pageSelected) ppiPageRows.forEach((r) => next.delete(r.id));
      else ppiPageRows.forEach((r) => next.add(r.id));
      return next;
    });
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

  /* ---- actions ---- */
  const exportPeriodsCsv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = [
      ["Period", "Cabinet", "Status", "Created", "Updated by"],
      ...periods.map((p) => [esc(p.name), esc(p.cabinet), p.status, p.createdAt, esc(p.updatedBy)]),
    ];
    const csv = "﻿" + rows.map((r) => r.join(",")).join("\r\n") + "\r\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `periods-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.show(`Exported ${periods.length} periods`);
  };

  const exportPpisCsv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = [
      ["Chapter", "Country", "Timezone", "Members", "Status", "Notes"],
      ...ppis.map((p) => [
        esc(p.name),
        esc(p.country),
        esc(p.timezone),
        String(p.members),
        p.status,
        esc(p.notes),
      ]),
    ];
    const csv = "﻿" + rows.map((r) => r.join(",")).join("\r\n") + "\r\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `ppi-chapters-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.show(`Exported ${ppis.length} chapters`);
  };

  const setPeriodStatus = (id: string, status: PeriodStatus, verb: string) => {
    setPeriods((prev) => prev.map((p) => (p.id === id ? { ...p, status } : p)));
    setMenuFor(null);
    toast.show(`Period ${verb}`);
  };

  /* ---- period modal ---- */
  const savePeriod = () => {
    if (!periodModal) return;
    const name = (document.querySelector<HTMLInputElement>("#org-period-name")?.value ?? "").trim();
    const cabinet = (
      document.querySelector<HTMLInputElement>("#org-period-cabinet")?.value ?? ""
    ).trim();
    if (!name || !cabinet) {
      toast.show("Period and Cabinet are required");
      return;
    }
    if (periodModal.mode === "edit") {
      setPeriods((prev) =>
        prev.map((p) => (p.id === periodModal.item.id ? { ...p, name, cabinet } : p)),
      );
      toast.show("Period saved");
    } else {
      const now = new Date().toISOString().slice(0, 10);
      setPeriods((prev) => [
        {
          id: `per-${Date.now()}`,
          name,
          cabinet,
          status: "draft",
          createdAt: now,
          updatedBy: "Admin",
        },
        ...prev,
      ]);
      toast.show("Period created");
    }
    setPeriodModal(null);
  };

  /* ---- unit navigation ---- */
  const toStructure = (periodId: string) => {
    setSelectedPeriodId(periodId);
    setUnitPage(1);
    setMenuFor(null);
    setView("structure");
  };

  const toUnitForm = (mode: UnitFormMode, item?: UnitItem) => {
    setUnitFormMode(mode);
    setEditingUnitId(item?.id ?? null);
    setUnitForm(
      item
        ? {
            name: item.name,
            code: item.code,
            type: item.code,
            members: item.members,
            divisions: item.divisions,
          }
        : { name: "", code: "", type: "Biro", members: [], divisions: [] },
    );
    setMenuFor(null);
    setView("unit");
  };

  const setMember = (index: number, patch: Partial<UnitMember>) => {
    setUnitForm((f) => ({
      ...f,
      members: f.members.map((m, i) => (i === index ? { ...m, ...patch } : m)),
    }));
  };
  const addMember = () => {
    setUnitForm((f) => ({
      ...f,
      members: [
        ...f.members,
        {
          id: nextRowId(),
          name: "",
          // In the create form a fresh member starts neutral so the Head
          // button is black (crown only via a click); the edit form keeps
          // its sequential role defaults.
          role: unitFormMode === "create" ? "Staff" : roleForIndex(f.members.length),
          photo: null,
          previousRole: null,
        },
      ],
    }));
  };
  const removeMember = (index: number) => {
    setUnitForm((f) => ({ ...f, members: f.members.filter((_, i) => i !== index) }));
  };
  /** Crown/un-crown the member as the unit's Head of. Only one member can
   *  hold the "Kepala Direktorat" role at a time: crowning lifts the row to
   *  the top of the list and demotes the previous head back to its own
   *  earlier role; clicking a crowned row again un-crowns it (restoring the
   *  remembered role). The "Head" state of the button derives from the role
   *  itself, so typing "Kepala Direktorat" in the Role box also crowns it. */
  const toggleMemberHead = (index: number) => {
    setUnitForm((f) => {
      const row = f.members[index];
      if (!row) return f;
      if (row.role === HEAD_ROLE) {
        // Un-crown: switch back to the role it had before, stay in place.
        return {
          ...f,
          members: f.members.map((m, i) =>
            i === index ? { ...m, role: m.previousRole ?? "Staff", previousRole: null } : m,
          ),
        };
      }
      // Crown: this row becomes the single head — move it to the top and
      // demote any other member still carrying the role.
      const next = [...f.members];
      const [moved] = next.splice(index, 1);
      if (moved === undefined) return f;
      next.unshift({ ...moved, role: HEAD_ROLE, previousRole: moved.role });
      return {
        ...f,
        members: next.map((m) =>
          m.id !== moved.id && m.role === HEAD_ROLE
            ? { ...m, role: m.previousRole ?? "Staff", previousRole: null }
            : m,
        ),
      };
    });
  };
  /** Move a member row within the Core Members list (drag & drop). */
  const reorderDivisions = (from: number, to: number) => {
    setUnitForm((f) => {
      if (
        from < 0 ||
        from >= f.divisions.length ||
        to < 0 ||
        to >= f.divisions.length ||
        from === to
      ) {
        return f;
      }
      const next = [...f.divisions];
      const [moved] = next.splice(from, 1);
      if (moved === undefined) return f;
      next.splice(to, 0, moved);
      return { ...f, divisions: next };
    });
  };

  const reorderMembers = (from: number, to: number) => {
    setUnitForm((f) => {
      if (from < 0 || from >= f.members.length || to < 0 || to >= f.members.length || from === to) {
        return f;
      }
      const next = [...f.members];
      const [moved] = next.splice(from, 1);
      if (moved === undefined) return f;
      next.splice(to, 0, moved);
      return { ...f, members: next };
    });
  };
  const setDivision = (index: number, name: string) => {
    setUnitForm((f) => ({
      ...f,
      divisions: f.divisions.map((d, i) => (i === index ? { ...d, name } : d)),
    }));
  };
  const addDivision = () => {
    setUnitForm((f) => ({
      ...f,
      divisions: [...f.divisions, { id: nextRowId(), name: "", members: [] }],
    }));
  };
  const removeDivision = (index: number) => {
    setUnitForm((f) => ({ ...f, divisions: f.divisions.filter((_, i) => i !== index) }));
  };

  /* ---- per-division team members (Ketua/Wakil/Sekretaris/Staff) ---- */
  const setDivisionMember = (div: number, index: number, patch: Partial<UnitMember>) => {
    setUnitForm((f) => ({
      ...f,
      divisions: f.divisions.map((d, i) =>
        i === div
          ? { ...d, members: d.members.map((m, j) => (j === index ? { ...m, ...patch } : m)) }
          : d,
      ),
    }));
  };
  const addDivisionMember = (div: number) => {
    setUnitForm((f) => ({
      ...f,
      divisions: f.divisions.map((d, i) =>
        i === div
          ? {
              ...d,
              members: [
                ...d.members,
                {
                  id: nextRowId(),
                  name: "",
                  // A fresh row is neutral Staff — crowning it makes it Ketua.
                  role: "Staff",
                  photo: null,
                  previousRole: null,
                },
              ],
            }
          : d,
      ),
    }));
  };
  const removeDivisionMember = (div: number, index: number) => {
    setUnitForm((f) => ({
      ...f,
      divisions: f.divisions.map((d, i) =>
        i === div ? { ...d, members: d.members.filter((_, j) => j !== index) } : d,
      ),
    }));
  };

  /** Single head per division: crowning "Ketua" lifts the row to the top of
   *  that division's team and demotes any previous Ketua; un-crowning
   *  restores the stored role. (Mirror of the core toggleMemberHead.) */
  const toggleDivisionMemberHead = (div: number, index: number) => {
    setUnitForm((f) => {
      const d = f.divisions[div];
      const row = d?.members[index];
      if (!d || !row) return f;
      if (row.role === DIVISION_HEAD_ROLE) {
        const next = d.members.map((m, j) =>
          j === index ? { ...m, role: m.previousRole ?? "Staff", previousRole: null } : m,
        );
        return {
          ...f,
          divisions: f.divisions.map((x, i) => (i === div ? { ...x, members: next } : x)),
        };
      }
      const members = [...d.members];
      const [moved] = members.splice(index, 1);
      if (moved === undefined) return f;
      members.unshift({ ...moved, role: DIVISION_HEAD_ROLE, previousRole: moved.role });
      return {
        ...f,
        divisions: f.divisions.map((x, i) =>
          i === div
            ? {
                ...x,
                members: members.map((m) =>
                  m.id !== moved.id && m.role === DIVISION_HEAD_ROLE
                    ? { ...m, role: m.previousRole ?? "Staff", previousRole: null }
                    : m,
                ),
              }
            : x,
        ),
      };
    });
  };

  const saveUnit = () => {
    const name = unitForm.name.trim();
    const code = unitForm.code.trim();
    if (!name) {
      toast.show("Name is required");
      return;
    }
    if (!code) {
      toast.show("Code is required");
      return;
    }
    const emptyRole = unitForm.members.find((m) => m.role.trim() === "");
    if (emptyRole) {
      toast.show("Role is required");
      return;
    }
    const emptyDivisionRole = unitForm.divisions
      .flatMap((d) => d.members)
      .find((m) => m.role.trim() === "");
    if (emptyDivisionRole) {
      toast.show("Role is required");
      return;
    }
    if (unitFormMode === "edit" && editingUnitId) {
      setUnits((prev) =>
        prev.map((u) =>
          u.id === editingUnitId
            ? {
                ...u,
                name,
                code: code as UnitType,
                type: unitForm.type,
                members: unitForm.members,
                divisions: unitForm.divisions,
              }
            : u,
        ),
      );
      toast.show("Unit saved");
    } else {
      const cabinet =
        periods.find((p) => p.id === selectedPeriodId)?.cabinet ?? "Kolaborasi Asiania";
      setUnits((prev) => [
        {
          id: `unit-${Date.now()}`,
          code: code as UnitType,
          name,
          cabinet,
          periodId: selectedPeriodId,
          members: unitForm.members,
          divisions: unitForm.divisions,
        },
        ...prev,
      ]);
      toast.show("Unit created");
    }
    setView("structure");
  };

  /* ---- deletes ---- */
  const requestDelete = (d: OrgDelete) => {
    setMenuFor(null);
    setDeleteConfirm(d);
  };

  const doDelete = () => {
    if (!deleteConfirm) return;
    if (deleteConfirm.kind === "period") {
      setPeriods((prev) => prev.filter((p) => p.id !== deleteConfirm.item.id));
      toast.show("Period deleted");
    } else if (deleteConfirm.kind === "unit") {
      setUnits((prev) => prev.filter((u) => u.id !== deleteConfirm.item.id));
      toast.show("Unit deleted");
    } else if (deleteConfirm.kind === "ppi") {
      setPpis((prev) => prev.filter((p) => p.id !== deleteConfirm.item.id));
      toast.show("Chapter deleted");
    } else if (deleteConfirm.kind === "many") {
      setPpis((prev) => prev.filter((p) => !selected.has(p.id)));
      clearSelection();
      toast.show(`Deleted ${deleteConfirm.count} chapters`);
    }
    setDeleteConfirm(null);
  };

  /* ---- shared pagination bar ---- */
  const pageNumbers: number[] = [];
  {
    const total =
      view === "period" ? periodTotalPages : view === "structure" ? unitTotalPages : ppiTotalPages;
    const safe =
      view === "period" ? periodSafePage : view === "structure" ? unitSafePage : ppiSafePage;
    const winStart = Math.max(1, Math.min(safe - 2, total - 4));
    const winEnd = Math.min(total, winStart + 4);
    for (let i = winStart; i <= winEnd; i++) pageNumbers.push(i);
  }

  /** Current page of whichever list is on screen (Period / Structure / PPI). */
  const safePage =
    view === "period" ? periodSafePage : view === "structure" ? unitSafePage : ppiSafePage;
  const totalPages =
    view === "period" ? periodTotalPages : view === "structure" ? unitTotalPages : ppiTotalPages;
  const setPage = (p: number) =>
    view === "period" ? setPeriodPage(p) : view === "structure" ? setUnitPage(p) : setPpiPage(p);

  const paginationBar = (shownStart: number, shownEnd: number, total: number) => (
    <div className="admin-darkbar">
      <span className="admin-darkbar__info">
        Showing {shownStart}–{shownEnd} of {total}
      </span>
      <span className="admin-darkbar__info">
        Rows per page
        <select
          className="admin-darkbar__select"
          aria-label="Rows per page"
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPeriodPage(1);
            setPpiPage(1);
            setUnitPage(1);
          }}
        >
          {PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </span>
      <span className="admin-darkbar__spacer" />
      <button
        type="button"
        className="admin-darkbar__btn"
        disabled={safePage <= 1}
        onClick={() => setPage(safePage - 1)}
        aria-label="Previous page"
      >
        <Icon name="chevronLeft" size={14} />
      </button>
      {pageNumbers.map((p) => (
        <button
          type="button"
          key={p}
          className={`admin-darkbar__btn${safePage === p ? " admin-darkbar__btn--active" : ""}`}
          onClick={() => setPage(p)}
        >
          {p}
        </button>
      ))}
      <button
        type="button"
        className="admin-darkbar__btn"
        disabled={safePage >= totalPages}
        onClick={() => setPage(safePage + 1)}
        aria-label="Next page"
      >
        <Icon name="chevronRight" size={14} />
      </button>
    </div>
  );

  /* ---- shared delete modal ---- */
  const deleteTitle =
    deleteConfirm?.kind === "many"
      ? `Delete ${deleteConfirm.count} PPI Chapter${deleteConfirm.count === 1 ? "" : "s"}?`
      : deleteConfirm?.kind === "period"
        ? `Delete "${deleteConfirm.item.name}"?`
        : deleteConfirm?.kind === "unit"
          ? `Delete "${deleteConfirm.item.code}"?`
          : deleteConfirm?.kind === "ppi"
            ? `Delete "${deleteConfirm.item.name}"?`
            : "Delete";

  /* The "confirm delete" popup is shared by every screen that deletes
     (Period, Structure, PPI) — render it once per screen, next to the card. */
  const deleteModal = (
    <Modal
      open={deleteConfirm !== null}
      title={deleteTitle}
      width={420}
      className="admin-modal--dark admin-modal--delete"
      hideClose
      onClose={() => setDeleteConfirm(null)}
      footer={
        <div className="admin-modal__footer-row admin-modal__footer-row--end">
          <Button
            variant="ghost"
            className="admin-btn--light admin-modal__foot-btn"
            icon="chevronLeft"
            onClick={() => setDeleteConfirm(null)}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            className="admin-modal__foot-btn"
            icon="trash"
            onClick={doDelete}
          >
            Delete
          </Button>
        </div>
      }
    >
      <p className="admin-delete-confirm__message">
        <span className="admin-delete-confirm__hint">
          They disappear from the public page now. You can revert deletion on the admin log before
          14 days.
        </span>
      </p>
    </Modal>
  );

  /* ================================================================
     SCREENS
     ================================================================ */

  if (view === "period") {
    const columns: Column<PeriodItem>[] = [
      {
        key: "name",
        header: (
          <SortHeader
            label="Period"
            active={periodSort === "name"}
            dir={periodSortDir}
            onClick={() => onPeriodSort("name")}
          />
        ),
        width: "40%",
        render: (r) => <span className="admin-table__title">{r.name}</span>,
      },
      {
        key: "cabinet",
        header: (
          <SortHeader
            label="Cabinet"
            active={periodSort === "cabinet"}
            dir={periodSortDir}
            onClick={() => onPeriodSort("cabinet")}
          />
        ),
        width: "34%",
        render: (r) => <span className="admin-table__title">{r.cabinet}</span>,
      },
      {
        key: "status",
        header: (
          <SortHeader
            label="Status"
            active={periodSort === "status"}
            dir={periodSortDir}
            onClick={() => onPeriodSort("status")}
          />
        ),
        width: "18%",
        render: (r) => periodStatusBadge(r.status),
      },
      {
        key: "aksi",
        header: "",
        align: "right",
        width: "12%",
        render: (r) => (
          <div className="admin-table__actions">
            <Button
              variant="ghost"
              size="icon"
              icon="edit"
              aria-label="Edit"
              title="Edit"
              onClick={() => {
                setMenuFor(null);
                setPeriodModal({ mode: "edit", item: r });
              }}
            />
            <div className="admin-row-menu">
              {menuFor === `per-${r.id}` ? (
                <div className="admin-row-menu__backdrop" onClick={() => setMenuFor(null)} />
              ) : null}
              <Button
                variant="ghost"
                size="icon"
                icon="more"
                aria-label="More actions"
                title="More actions"
                onClick={() => setMenuFor(menuFor === `per-${r.id}` ? null : `per-${r.id}`)}
              />
              {menuFor === `per-${r.id}` ? (
                <div className="admin-row-menu__panel" role="menu">
                  <button
                    type="button"
                    className="admin-row-menu__item"
                    role="menuitem"
                    onClick={() => toStructure(r.id)}
                  >
                    <Icon name="settings" size={14} /> Manage Structure
                  </button>
                  <button
                    type="button"
                    className="admin-row-menu__item"
                    role="menuitem"
                    onClick={() =>
                      setPeriodStatus(
                        r.id,
                        r.status === "published" ? "draft" : "published",
                        r.status === "published" ? "set as inactive" : "set as active",
                      )
                    }
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- packed public asset, same logo as the Public badge */}
                    <img
                      src="/globe.png"
                      alt=""
                      width={14}
                      height={14}
                      className="admin-status-badge__img"
                    />{" "}
                    {r.status === "published" ? "Set as Inactive" : "Set as Active"}
                  </button>
                  <div className="admin-row-menu__divider" role="separator" />
                  <button
                    type="button"
                    className="admin-row-menu__item admin-row-menu__item--danger"
                    role="menuitem"
                    onClick={() => requestDelete({ kind: "period", item: r })}
                  >
                    <Icon name="trash" size={14} /> Delete Period
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ),
      },
    ];

    return (
      <>
        <div className="admin-page-header admin-events-header">
          <div>
            <h1 className="admin-page-header__title">Organizations &gt; Period</h1>
            <p className="admin-page-header__desc">{ORG_SUBTITLE}</p>
          </div>
          <div className="admin-page-header__actions">
            <Button variant="outline" size="sm" icon="download" onClick={exportPeriodsCsv}>
              Export CSV
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon="plus"
              className="admin-btn--events-add"
              onClick={() => setPeriodModal({ mode: "create" })}
            >
              Add New Period
            </Button>
          </div>
        </div>

        <Card className="admin-events-card admin-list-card admin-org-card">
          <CardBody flush>
            {/* Section tabs: Period list vs PPI chapters (top-level switch). */}
            <div className="admin-tabs" role="tablist" aria-label="Organization lists">
              <button
                type="button"
                role="tab"
                aria-selected={view === "period"}
                className={`admin-tabs__btn${view === "period" ? " admin-tabs__btn--active" : ""}`}
                onClick={() => setView("period")}
              >
                Period
                <span className="admin-tabs__count">{periods.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={false}
                className="admin-tabs__btn"
                onClick={() => {
                  setView("ppi");
                  setMenuFor(null);
                }}
              >
                PPI
                <span className="admin-tabs__count">{ppis.length}</span>
              </button>
            </div>
            <DataTable
              columns={columns}
              rows={periodPageRows}
              rowKey={(r) => r.id}
              minRows={pageSize}
            />
            {paginationBar(periodShownStart, periodShownEnd, periods.length)}
          </CardBody>
        </Card>

        {/* Create/Edit Period popup — Period + Cabinet, Cancel keeps the list. */}
        <Modal
          open={periodModal !== null}
          title={periodModal?.mode === "edit" ? "Edit Period" : "Create Period"}
          className="admin-modal--light"
          width={420}
          hideClose
          onClose={() => setPeriodModal(null)}
          footer={
            <div className="admin-modal__footer-row">
              <Button
                variant="ghost"
                className="admin-btn--light admin-modal__foot-btn"
                onClick={() => setPeriodModal(null)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                className="admin-modal__foot-btn"
                icon="cloud"
                onClick={savePeriod}
              >
                Save
              </Button>
            </div>
          }
        >
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="org-period-name">
              Period *
            </label>
            <input
              id="org-period-name"
              className="admin-input"
              type="text"
              placeholder="e.g 2026-2027"
              defaultValue={periodModal?.mode === "edit" ? periodModal.item.name : ""}
            />
          </div>
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="org-period-cabinet">
              Cabinet *
            </label>
            <input
              id="org-period-cabinet"
              className="admin-input"
              type="text"
              placeholder="e.g Kolaborasi Asiania"
              defaultValue={periodModal?.mode === "edit" ? periodModal.item.cabinet : ""}
            />
          </div>
        </Modal>

        {deleteModal}

        <ToastBanner message={toast.message} />
      </>
    );
  }

  if (view === "structure") {
    const columns: Column<UnitItem>[] = [
      {
        key: "unit",
        header: (
          <SortHeader
            label="Unit"
            active={unitSort === "name"}
            dir={unitSortDir}
            onClick={() => onUnitSort("name")}
          />
        ),
        width: "40%",
        render: (r) => (
          <div>
            <div className="admin-table__title">{r.name}</div>
            <div className="admin-table__sub">{slugify(r.name)}</div>
          </div>
        ),
      },
      {
        key: "cabinet",
        header: "Cabinet",
        width: "25%",
        render: (r) => <span className="admin-table__title">{r.code}</span>,
      },
      {
        key: "people",
        header: "Members",
        width: "20%",
        render: (r) => <span className="admin-table__title">{r.members.length} People</span>,
      },
      {
        key: "aksi",
        header: "",
        align: "right",
        width: "15%",
        render: (r) => (
          <div className="admin-table__actions">
            <Button
              variant="ghost"
              size="icon"
              icon="trash"
              className="admin-table__delete"
              aria-label={`Delete ${r.name}`}
              title="Delete"
              onClick={() => requestDelete({ kind: "unit", item: r })}
            />
            <Button
              variant="ghost"
              size="icon"
              icon="edit"
              aria-label="Edit"
              title="Edit"
              onClick={() => toUnitForm("edit", r)}
            />
          </div>
        ),
      },
    ];

    return (
      <>
        <div className="admin-page-header admin-events-header">
          <div>
            <h1 className="admin-page-header__title">Organizations &gt; Period &gt; Structure</h1>
            <p className="admin-page-header__desc">{ORG_SUBTITLE}</p>
          </div>
          <div className="admin-page-header__actions">
            <select
              className="admin-select admin-org-period"
              aria-label="Period"
              value={selectedPeriodId}
              onChange={(e) => {
                setSelectedPeriodId(e.target.value);
                setPeriodPage(1);
                setMenuFor(null);
              }}
            >
              {periodOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <Button
              variant="ghost"
              size="sm"
              icon="plus"
              className="admin-btn--events-add"
              onClick={() => toUnitForm("create")}
            >
              Add New Unit
            </Button>
            <Button
              variant="outline"
              size="sm"
              icon="chevronLeft"
              onClick={() => setView("period")}
            >
              Back
            </Button>
          </div>
        </div>

        <Card className="admin-events-card admin-list-card admin-org-card">
          <CardBody flush>
            {/* Section tabs: same band as the Period/PPI lists so the page's
                top edge matches; clicking returns to the parent list. */}
            <div className="admin-tabs" role="tablist" aria-label="Organization lists">
              <button
                type="button"
                role="tab"
                aria-selected={false}
                className="admin-tabs__btn"
                onClick={() => {
                  setView("period");
                  setMenuFor(null);
                }}
              >
                Period
                <span className="admin-tabs__count">{periods.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={false}
                className="admin-tabs__btn"
                onClick={() => {
                  setView("ppi");
                  setMenuFor(null);
                }}
              >
                PPI
                <span className="admin-tabs__count">{ppis.length}</span>
              </button>
            </div>
            <DataTable
              columns={columns}
              rows={unitPageRows}
              rowKey={(r) => r.id}
              minRows={Math.min(6, pageSize)}
              emptyState={
                <div className="admin-empty admin-empty--stack">
                  <span className="admin-empty__heading">
                    <Icon name="grid" size={16} />
                    <span className="admin-empty__title">No units for this period yet</span>
                  </span>
                  <span className="admin-empty__hint">
                    Pick another period, or add the first unit with “Add New Unit”.
                  </span>
                </div>
              }
            />
            {paginationBar(unitShownStart, unitShownEnd, sortedUnitRows.length)}
          </CardBody>
        </Card>

        {deleteModal}

        <ToastBanner message={toast.message} />
      </>
    );
  }

  if (view === "unit") {
    /* -- single-row editor cell inside the cream panel (dark inputs) -- */
    return (
      <>
        <div className="admin-page-header admin-events-header">
          <div>
            <h1 className="admin-page-header__title">
              Organizations &gt; Period &gt; Structure &gt;{" "}
              {unitFormMode === "create" ? "Create Unit" : "Edit Unit"}
            </h1>
            <p className="admin-page-header__desc">{ORG_SUBTITLE}</p>
          </div>
        </div>

        <div className="admin-org-form">
          <div className="admin-form-grid admin-form-grid--3">
            {/* Name / Code / Type — one row */}
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="org-unit-name">
                Name *
              </label>
              <input
                id="org-unit-name"
                className="admin-input"
                type="text"
                placeholder="e.g Badan Koordinasi Kawasan"
                value={unitForm.name}
                onChange={(e) => setUnitForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="org-unit-code">
                Code *
              </label>
              <input
                id="org-unit-code"
                className="admin-input"
                type="text"
                placeholder="e.g Koor"
                value={unitForm.code}
                onChange={(e) => setUnitForm((f) => ({ ...f, code: e.target.value }))}
              />
            </div>
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="org-unit-type">
                Type *
              </label>
              <select
                id="org-unit-type"
                className="admin-select"
                value={unitForm.type}
                onChange={(e) => setUnitForm((f) => ({ ...f, type: e.target.value as UnitType }))}
              >
                {UNIT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {/* Core Members — same reorderable list as events Guest/Speakers,
                only the row content differs (photo upload + name + role,
                with a crown button to mark the member as Head of). */}
            <div className="admin-form-grid__full">
              <EditableList
                title="Core Members"
                subtitle="Heads of unit and members without divisions."
                emptyHint="There are no members of the unit yet."
                addLabel="Add New Member"
                count={unitForm.members.length}
                onAdd={addMember}
                onRemove={(i) => removeMember(i)}
                onReorder={reorderMembers}
                renderRow={(i) => {
                  const m = unitForm.members[i] ?? {
                    id: "",
                    name: "",
                    role: roleForIndex(i),
                    photo: null,
                    previousRole: null,
                  };
                  return (
                    <div className="admin-org-member--list">
                      <PhotoDrop
                        value={m.photo}
                        label="Member photo"
                        onPick={(photo) => setMember(i, { photo })}
                        onClear={() => setMember(i, { photo: null })}
                      />
                      <div className="admin-field admin-org-name-field">
                        <label className="admin-field__label" htmlFor={`member-name-${i}`}>
                          Name *
                        </label>
                        <input
                          id={`member-name-${i}`}
                          className="admin-input admin-input--dark admin-org-member__name"
                          type="text"
                          placeholder="Name"
                          value={m.name}
                          onChange={(e) => setMember(i, { name: e.target.value })}
                        />
                      </div>
                      <div className="admin-field admin-org-role-field">
                        <label className="admin-field__label" htmlFor={`member-role-${i}`}>
                          Role *
                        </label>
                        <input
                          id={`member-role-${i}`}
                          className="admin-input admin-input--dark admin-org-member__role"
                          type="text"
                          placeholder="Role"
                          value={m.role}
                          onChange={(e) => setMember(i, { role: e.target.value })}
                        />
                      </div>
                      <Button
                        variant="ghost"
                        className={`admin-org-member__head${m.role === HEAD_ROLE ? " admin-org-member__head--on" : ""}`}
                        icon="crown"
                        aria-label="Set as Head of"
                        title="Set as Head of"
                        onClick={() => toggleMemberHead(i)}
                      >
                        Head
                      </Button>
                    </div>
                  );
                }}
              />
            </div>

            {/* Divisions */}
            <div className="admin-field admin-form-grid__full">
              <div className="admin-org-section">
                <div className="admin-org-section__head">
                  <div>
                    <h3 className="admin-org-section__title">Divisions</h3>
                    <p className="admin-org-section__sub">
                      Add a division if the unit has division
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    icon="plus"
                    className="admin-org-add"
                    onClick={addDivision}
                  >
                    Add New Division
                  </Button>
                </div>
                {unitForm.divisions.length === 0 ? (
                  <div className="admin-org-panel">
                    <div className="admin-org-empty">
                      There are no divisions. Click &quot;Add Division&quot; if this unit has a
                      division.
                    </div>
                  </div>
                ) : (
                  <div className="admin-org-panel">
                    {unitForm.divisions.map((d, i) => (
                      <div
                        key={d.id}
                        className={`admin-org-division--group${divisionDragFrom === i ? " admin-org-division--group--dragging" : ""}`}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (divisionDragFrom !== null && divisionDragFrom !== i) {
                            reorderDivisions(divisionDragFrom, i);
                          }
                          setDivisionDragFrom(null);
                        }}
                      >
                        <div className="admin-org-division--list">
                          <span
                            className="admin-org-division__handle"
                            draggable
                            aria-label="Drag division to reorder"
                            title="Drag to reorder"
                            onDragStart={(e) => {
                              setDivisionDragFrom(i);
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("text/plain", String(i));
                            }}
                            onDragEnd={() => setDivisionDragFrom(null)}
                          >
                            <Icon name="grip" size={48} />
                          </span>
                          <div className="admin-field admin-org-division-field">
                            <label className="admin-field__label" htmlFor={`division-name-${i}`}>
                              Division Name *
                            </label>
                            <input
                              id={`division-name-${i}`}
                              className="admin-input admin-input--dark"
                              type="text"
                              placeholder="Division name"
                              value={d.name}
                              onChange={(e) => setDivision(i, e.target.value)}
                            />
                          </div>
                          <Button
                            variant="danger"
                            size="sm"
                            icon="trash"
                            aria-label="Delete division"
                            onClick={() => removeDivision(i)}
                          >
                            Delete Division
                          </Button>
                        </div>
                        {d.members.map((m, j) => (
                          <div key={m.id} className="admin-org-divisionmember--list">
                            <PhotoDrop
                              value={m.photo}
                              label="Division member photo"
                              onPick={(photo) => setDivisionMember(i, j, { photo })}
                              onClear={() => setDivisionMember(i, j, { photo: null })}
                            />
                            <div className="admin-field admin-org-divisionmember-field">
                              <label
                                className="admin-field__label"
                                htmlFor={`division-member-name-${i}-${j}`}
                              >
                                Name *
                              </label>
                              <input
                                id={`division-member-name-${i}-${j}`}
                                className="admin-input admin-input--dark"
                                type="text"
                                placeholder="Name"
                                value={m.name}
                                onChange={(e) => setDivisionMember(i, j, { name: e.target.value })}
                              />
                            </div>
                            <div className="admin-field admin-org-divisionmember-role">
                              <label
                                className="admin-field__label"
                                htmlFor={`division-member-role-${i}-${j}`}
                              >
                                Role *
                              </label>
                              <input
                                id={`division-member-role-${i}-${j}`}
                                className="admin-input  admin-input--dark"
                                type="text"
                                placeholder="Role"
                                value={m.role}
                                onChange={(e) => setDivisionMember(i, j, { role: e.target.value })}
                              />
                            </div>
                            <Button
                              variant="ghost"
                              className={`admin-org-divisionmember__head${m.role === DIVISION_HEAD_ROLE ? " admin-org-divisionmember__head--on" : ""}`}
                              icon="crown"
                              aria-label="Set as Head of"
                              title="Set as Head of"
                              onClick={() => toggleDivisionMemberHead(i, j)}
                            >
                              Head
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              icon="trash"
                              aria-label="Remove division member"
                              onClick={() => removeDivisionMember(i, j)}
                            >
                              Delete
                            </Button>
                          </div>
                        ))}
                        <div className="admin-org-division-addrow">
                          <button
                            type="button"
                            className="admin-org-division-add"
                            onClick={() => addDivisionMember(i)}
                          >
                            <Icon name="plus" size={16} />
                            Add New Member
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* footer actions — Back left, Save right (same tight no-divider
              footer as the newsletter/article forms). */}
          <div className="admin-form-actions admin-form-grid__full">
            <Button
              variant="outline"
              size="sm"
              icon="chevronLeft"
              onClick={() => setView("structure")}
            >
              Back
            </Button>
            <div className="admin-form-actions__right">
              <Button variant="outline" size="sm" icon="cloud" onClick={saveUnit}>
                Save
              </Button>
            </div>
          </div>
        </div>

        <ToastBanner message={toast.message} />
      </>
    );
  }

  /* ---- PPI chapters ---- */
  const ppiSelected = selected.size;
  const columns: Column<PpiItem>[] = [
    {
      key: "check",
      width: "24px",
      align: "left",
      header: (
        <label className="admin-checkbox">
          <input
            type="checkbox"
            aria-label="Select all on page"
            checked={pageSelected}
            ref={(el) => {
              if (el) el.indeterminate = pageSomeSelected && !pageSelected;
            }}
            onChange={toggleAllPage}
            className="admin-table__checkbox"
          />
          <span aria-hidden="true" />
        </label>
      ),
      render: (r) => (
        <label className="admin-checkbox">
          <input
            type="checkbox"
            aria-label={`Select ${r.name}`}
            checked={selected.has(r.id)}
            onChange={() => toggleOne(r.id)}
            className="admin-table__checkbox"
          />
          <span aria-hidden="true" />
        </label>
      ),
    },
    {
      key: "name",
      header: (
        <SortHeader
          label="PPI"
          active={ppiSort === "name"}
          dir={ppiSortDir}
          onClick={() => onPpiSort("name")}
        />
      ),
      width: "16%",
      render: (r) => (
        <div>
          <div className="admin-table__title">{r.name}</div>
          <div className="admin-table__sub">#{r.code}</div>
        </div>
      ),
    },
    {
      key: "country",
      header: (
        <SortHeader
          label="Country"
          active={ppiSort === "country"}
          dir={ppiSortDir}
          onClick={() => onPpiSort("country")}
        />
      ),
      width: "12%",
      render: (r) => <span className="admin-table__title">{r.country}</span>,
    },
    {
      key: "timezone",
      header: "Timezone",
      width: "16%",
      render: (r) => (
        <span className="admin-table__sub admin-org-timezone">
          <Icon name="clock" size={12} /> {r.timezone}
        </span>
      ),
    },
    {
      key: "members",
      header: (
        <SortHeader
          label="Members"
          active={ppiSort === "members"}
          dir={ppiSortDir}
          onClick={() => onPpiSort("members")}
        />
      ),
      width: "8%",
      render: (r) => <span className="admin-table__title">{r.members}</span>,
    },
    {
      key: "notes",
      header: "Conditions",
      width: "22%",
      render: (r) => <span className="admin-org-notes">{r.notes}</span>,
    },
    {
      key: "status",
      header: "Status",
      width: "16%",
      render: () => (
        <div className="admin-org-badges">
          <span className="admin-org-status admin-org-status--risk">At risk of a vacuum</span>
          <span className="admin-org-status admin-org-status--inactive">Inactive</span>
        </div>
      ),
    },
    {
      key: "aksi",
      header: "",
      align: "right",
      width: "12%",
      render: (r) => (
        <div className="admin-table__actions">
          <Button
            variant="ghost"
            size="icon"
            icon="trash"
            className="admin-table__delete"
            aria-label={`Delete ${r.name}`}
            title="Delete"
            onClick={() => requestDelete({ kind: "ppi", item: r })}
          />
          <Button
            variant="ghost"
            size="icon"
            icon="edit"
            aria-label="Edit"
            title="Edit"
            onClick={() => toast.show("Edit PPI — form not in the design yet")}
          />
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="admin-page-header admin-events-header">
        <div>
          <h1 className="admin-page-header__title">Organizations &gt; PPI</h1>
          <p className="admin-page-header__desc">{ORG_SUBTITLE}</p>
        </div>
        <div className="admin-page-header__actions">
          <Button variant="outline" size="sm" icon="download" onClick={exportPpisCsv}>
            Export CSV
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon="plus"
            className="admin-btn--events-add"
            onClick={() => toast.show("Add New PPI — form not in the design yet")}
          >
            Add New PPI
          </Button>
        </div>
      </div>

      <Card className="admin-events-card admin-list-card admin-org-card">
        <CardBody flush>
          {/* Section tabs: Period list vs PPI chapters (top-level switch). */}
          <div className="admin-tabs" role="tablist" aria-label="Organization lists">
            <button
              type="button"
              role="tab"
              aria-selected={false}
              className="admin-tabs__btn"
              onClick={() => {
                setView("period");
                setMenuFor(null);
              }}
            >
              Period
              <span className="admin-tabs__count">{periods.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "ppi"}
              className={`admin-tabs__btn${view === "ppi" ? " admin-tabs__btn--active" : ""}`}
              onClick={() => setView("ppi")}
            >
              PPI
              <span className="admin-tabs__count">{ppis.length}</span>
            </button>
          </div>

          <DataTable columns={columns} rows={ppiPageRows} rowKey={(r) => r.id} minRows={pageSize} />

          {ppiSelected > 0 ? (
            /* Bulk action bar — shown in place of the pagination bar while
               rows are selected (same treatment as the Events list). */
            <div className="admin-bulkbar">
              <span className="admin-bulkbar__summary">
                <label className="admin-checkbox">
                  <input
                    type="checkbox"
                    aria-label="Select all on page"
                    checked={pageSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = pageSomeSelected && !pageSelected;
                    }}
                    onChange={toggleAllPage}
                    className="admin-table__checkbox"
                  />
                  <span aria-hidden="true" />
                </label>
                {ppiSelected} selected
              </span>
              <div className="admin-bulkbar__actions">
                <Button
                  variant="danger"
                  size="sm"
                  icon="trash"
                  onClick={() => requestDelete({ kind: "many", count: ppiSelected })}
                >
                  Delete
                </Button>
              </div>
            </div>
          ) : (
            paginationBar(ppiShownStart, ppiShownEnd, ppis.length)
          )}
        </CardBody>
      </Card>

      {deleteModal}

      <ToastBanner message={toast.message} />
    </>
  );
}
