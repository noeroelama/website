"use client";

import { useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { EVENT_TYPES, type EventImage, type EventType } from "@website/domain/events";
import { utcToWallTime, wallTimeToUtc } from "@website/domain/shared";
import {
  removeEventAction,
  saveEventAction,
  setEventPublishedAction,
} from "@/app/(panel)/events/actions";
import { actionMessage } from "@/components/action-message";
import { formatInZone } from "@/components/format";
import { publicImage, useImageUpload } from "@/components/image-upload";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EditableList } from "@/components/ui/editable-list";
import { FieldError } from "@/components/ui/field-error";
import { Icon } from "@/components/ui/icon";
import { PhotoDrop } from "@/components/ui/photo-drop";
import { Modal } from "@/components/ui/modal";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import { EVENT_TYPE_LABELS, label } from "@/labels";
import {
  PAGE_SIZE_OPTIONS,
  matchesTab,
  type EventItem,
  type EventStatus,
  type EventTab,
} from "./events-model";

/* ==================================================================
   Event — list (tabs, search, filters, bulk actions) + create/edit form.
   Ported from the Figma "EVENT ADMIN" screens; colours come from the
   shared design tokens, no hex values outside globals.css.
   ================================================================== */

/** Public event path on the web app (apps/web /events/[slug]). */
const EVENT_PATH = "/events/";

/** The browser's IANA time zone: the default for a new event. */
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Small monogram chip standing in for the Figma row avatar. */
function typeInitials(type: string): string {
  return type.trim().slice(0, 2).toUpperCase() || "EV";
}

/** Sortable event-table columns (Location, checkbox and actions are never sorted). */
type SortKey = "title" | "date" | "status" | "registered";

/** Sortable table header: label + arrow icon. Active column shows a filled arrow. */
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

/** One guest/speaker row: optional photo, name, and a short description. */
interface GuestSpeakerItem {
  photo: EventImage | null;
  name: string;
  description: string;
}

/** One rundown row: single time plus a title and a description. */
interface RundownItem {
  time: string;
  title: string;
  description: string;
}

/** One sponsor row: optional photo and a short tool-tip/tagline. */
interface SponsorItem {
  photo: EventImage | null;
  tip: string;
}

interface EventForm {
  title: string;
  type: EventType;
  /** datetime-local values on the clock of `timezone`. */
  start: string;
  deadline: string;
  timezone: string;
  location: string;
  url: string;
  description: string;
  registrationLink: string;
  banner: EventImage | null;
  guests: GuestSpeakerItem[];
  rundown: RundownItem[];
  sponsors: SponsorItem[];
}

const EMPTY_FORM: EventForm = {
  title: "",
  type: EVENT_TYPES[0],
  start: "",
  deadline: "",
  timezone: "UTC",
  location: "",
  url: "",
  description: "",
  registrationLink: "",
  banner: null,
  guests: [],
  rundown: [],
  sponsors: [],
};

/** Filter choices for the event-date select. */
type DateFilter = "all" | "today" | "month" | "year" | "past";

/** Filter choice for the status select: any status, or "all". */
type StatusFilter = "all" | EventStatus;

/** Pending delete action shown in the dark confirm modal (one event or many). */
type DeleteConfirm = { kind: "one"; event: EventItem } | { kind: "many"; count: number };

interface EventsListProps {
  /** Rows from the server (src/app/(panel)/events/page.tsx); refreshed after every change. */
  initial: EventItem[];
  canEdit: boolean;
  /** WEB_URL, for "Copy Link". */
  publicBase: string;
}

export function EventsPage(props: EventsListProps) {
  const pathname = usePathname();
  // key={pathname} remounts the page when the events route is (re)entered, so
  // search/tabs/filters reset to their initial empty state on every visit
  // (same pattern as Articles & Gallery).
  return <EventsList key={pathname} {...props} />;
}

/** Form values for an existing event (times on the event's own clock). */
function formFrom(ev: EventItem): EventForm {
  return {
    title: ev.title,
    type: ev.type,
    start: utcToWallTime(new Date(ev.startsAt), ev.timezone),
    deadline: ev.registrationClosesAt
      ? utcToWallTime(new Date(ev.registrationClosesAt), ev.timezone)
      : "",
    timezone: ev.timezone,
    location: ev.location,
    url: ev.url,
    description: ev.description,
    registrationLink: ev.registrationUrl ?? "",
    banner: ev.banner,
    guests: ev.speakers.map((s) => ({ ...s })),
    rundown: ev.schedule.map((r) => ({ ...r })),
    sponsors: ev.sponsors.map((s) => ({ photo: s.logo, tip: s.caption })),
  };
}

/** Events list + create/edit screen (all state lives here; remounted by
 *  EventsPage on navigation so it starts clean). */
function EventsList({ initial: events, canEdit, publicBase }: EventsListProps) {
  const toast = useToastMessage();
  const router = useRouter();
  const bannerUpload = useImageUpload("banner");
  /* Speaker photos and sponsor logos: the small "speaker" preset (1024 px, public). */
  const photoUpload = useImageUpload("speaker");
  /* A server action is running: the action buttons are disabled meanwhile. */
  const [busy, setBusy] = useState(false);
  /* Server validation messages per field (GuardedResult `fields`). */
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});

  /* ---- list state ---- */
  const [today] = useState(() => new Date().toISOString());
  const [tab, setTab] = useState<EventTab>("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState(""); // diterapkan hanya saat Search diklik / Enter ditekan
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null);

  /* ---- form view state ---- */
  const [view, setView] = useState<"list" | "form">("list");
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EventForm>(EMPTY_FORM);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const activeFilterCount =
    (typeFilter !== "all" ? 1 : 0) +
    (statusFilter !== "all" ? 1 : 0) +
    (dateFilter !== "all" ? 1 : 0);

  /* ---- header sort: click toggles asc → desc (first click on a new column = asc) ---- */
  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  /* Year is enough to sort statuses/modified dates with the right precedence. */
  const sortValue = (e: EventItem, key: SortKey): string => {
    switch (key) {
      case "title":
        return e.title.toLowerCase();
      case "date":
        return e.startsAt;
      case "status":
        return e.status;
      case "registered":
        return e.modifiedAt;
    }
  };

  /* ---- derived rows ---- */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((e) => {
      if (!matchesTab(e, tab, today)) return false;
      if (typeFilter !== "all" && e.type !== typeFilter) return false;
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      if (dateFilter !== "all") {
        const d = e.startsAt.slice(0, 10);
        if (dateFilter === "today") {
          if (d !== today.slice(0, 10)) return false;
        } else if (dateFilter === "month") {
          if (!d.startsWith(today.slice(0, 7))) return false;
        } else if (dateFilter === "year") {
          if (!d.startsWith(today.slice(0, 4))) return false;
        } else if (dateFilter === "past") {
          if (d >= today.slice(0, 10)) return false;
        }
      }
      if (q) {
        const hay = [e.title, e.typeLabel, e.location, e.url, e.description]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [events, tab, today, query, typeFilter, statusFilter, dateFilter]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const counts = useMemo(() => {
    const upcoming = events.filter((e) => matchesTab(e, "upcoming", today)).length;
    const past = events.filter((e) => matchesTab(e, "past", today)).length;
    const drafts = events.filter((e) => e.status === "draft").length;
    return { all: events.length, upcoming, past, drafts };
  }, [events, today]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);
  const pageAllSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));
  const pageSomeSelected = pageRows.some((r) => selected.has(r.id));
  const allFilteredSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));

  /* ---- selection helpers ---- */
  const togglePage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (pageAllSelected) pageRows.forEach((r) => next.delete(r.id));
      else pageRows.forEach((r) => next.add(r.id));
      return next;
    });
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filtered.forEach((r) => next.delete(r.id));
      else filtered.forEach((r) => next.add(r.id));
      return next;
    });
  };

  /* ---- row / bulk mutations (server actions; the page re-reads after each) ---- */
  type Failure = Parameters<typeof actionMessage>[0];
  const fail = (result: Failure) => {
    setFieldErrors(result.fields ?? {});
    toast.show(actionMessage(result));
  };

  /* One action per event, one after the other (each has its own version check). */
  const runForEach = async (
    ids: readonly string[],
    run: (e: EventItem) => Promise<{ ok: true } | Failure>,
    done: string,
  ) => {
    setBusy(true);
    setMenuFor(null);
    let count = 0;
    let failure: Failure | null = null;
    for (const e of events.filter((x) => ids.includes(x.id))) {
      const result = await run(e);
      if (!result.ok) {
        failure = result;
        break;
      }
      count++;
    }
    setBusy(false);
    setSelected(new Set());
    router.refresh();
    if (failure) fail(failure);
    else toast.show(`${count} event${count === 1 ? "" : "s"} ${done}`);
  };

  const setPublishedFor = (ids: readonly string[], published: boolean) => {
    if (ids.length === 0) {
      toast.show("Select events first");
      return;
    }
    void runForEach(
      ids,
      (e) => setEventPublishedAction({ id: e.id, version: e.version, published }),
      published ? "published" : "unpublished",
    );
  };

  const publishSelected = () => setPublishedFor(Array.from(selected), true);
  const unpublishSelected = () => setPublishedFor(Array.from(selected), false);

  const deleteSelected = () => {
    if (selected.size === 0) {
      toast.show("Select events to delete");
      return;
    }
    setDeleteConfirm({ kind: "many", count: selected.size });
  };

  const deleteEvent = (e: EventItem) => {
    setMenuFor(null);
    setDeleteConfirm({ kind: "one", event: e });
  };

  /* Deletes are confirmed in the dark modal (like Tools) instead of
     window.confirm. The modal only stores *what* would be deleted; doDelete
     runs the soft delete (registrations are kept) once the user confirms. */
  const doDelete = () => {
    if (!deleteConfirm) return;
    const ids = deleteConfirm.kind === "one" ? [deleteConfirm.event.id] : Array.from(selected);
    setDeleteConfirm(null);
    void runForEach(ids, (e) => removeEventAction({ id: e.id, version: e.version }), "deleted");
  };

  const copyLink = (e: EventItem) => {
    void navigator.clipboard?.writeText(`${publicBase}${EVENT_PATH}${e.url}`);
    toast.show(`Link for "${e.title}" copied`);
    setMenuFor(null);
  };

  /* ---- form open / save ---- */
  const toForm = (mode: "create" | "edit", ev?: EventItem) => {
    setFormMode(mode);
    setEditingId(ev?.id ?? null);
    setFieldErrors({});
    setForm(ev ? formFrom(ev) : { ...EMPTY_FORM, timezone: browserZone() });
    setView("form");
  };

  /* Save draft / Publish now. Times are read on the event's clock (its time zone). */
  const save = async (publish: boolean) => {
    const current = events.find((e) => e.id === editingId);
    setBusy(true);
    const result = await saveEventAction({
      ...(editingId ? { id: editingId } : {}),
      version: current?.version ?? null,
      publish,
      title: form.title,
      type: form.type,
      startsAt: wallTimeToUtc(form.start, form.timezone)?.toISOString() ?? "",
      timezone: form.timezone,
      registrationClosesAt: wallTimeToUtc(form.deadline, form.timezone)?.toISOString() ?? null,
      location: form.location,
      description: form.description,
      bannerImage: form.banner,
      registrationUrl: form.registrationLink,
      slug: form.url.trim(),
      schedule: form.rundown,
      speakers: form.guests,
      sponsors: form.sponsors.map((sp) => ({ logo: sp.photo, caption: sp.tip })),
    });
    setBusy(false);
    if (!result.ok) {
      fail(result);
      return;
    }
    setFieldErrors({});
    toast.show(publish ? "Event published" : "Draft saved");
    router.refresh();
    if (publish) {
      setTab("all");
      setPage(1);
    }
    setView("list");
  };

  const onBannerFile = async (file: File) => {
    const image = await bannerUpload.upload(file);
    const banner = image ? publicImage(image) : null;
    if (banner) setForm((f) => ({ ...f, banner }));
  };
  const uploadPhoto = async (file: File) => {
    const image = await photoUpload.upload(file);
    return image ? publicImage(image) : null;
  };

  /* ---- editable lists (Guest/Speakers detail, Rundown detail, Sponsors) ---- */
  const updateGuest = (idx: number, patch: Partial<GuestSpeakerItem>) => {
    setForm((f) => ({
      ...f,
      guests: f.guests.map((g, i) => (i === idx ? { ...g, ...patch } : g)),
    }));
  };

  const updateRundown = (idx: number, patch: Partial<RundownItem>) => {
    setForm((f) => ({
      ...f,
      rundown: f.rundown.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    }));
  };

  const updateSponsor = (idx: number, patch: Partial<SponsorItem>) => {
    setForm((f) => ({
      ...f,
      sponsors: f.sponsors.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    }));
  };

  const addGuest = () => {
    setForm((f) => ({
      ...f,
      guests: [...f.guests, { photo: null, name: "", description: "" }],
    }));
  };

  const addRundown = () => {
    setForm((f) => ({
      ...f,
      rundown: [...f.rundown, { time: "", title: "", description: "" }],
    }));
  };

  const addSponsor = () => {
    setForm((f) => ({ ...f, sponsors: [...f.sponsors, { photo: null, tip: "" }] }));
  };

  const removeFrom = (key: "guests" | "rundown" | "sponsors", idx: number) => {
    setForm((f) => ({ ...f, [key]: f[key].filter((_, i) => i !== idx) }));
  };

  /** Move an item within one editable list (drag & drop / up / down). */
  const reorder = <K extends "guests" | "rundown" | "sponsors">(
    key: K,
    from: number,
    to: number,
  ) => {
    setForm((f) => {
      const target = f[key];
      if (from < 0 || from >= target.length || to < 0 || to >= target.length || from === to) {
        return f;
      }
      const next = [...target];
      const [moved] = next.splice(from, 1);
      if (moved === undefined) return f;
      next.splice(to, 0, moved);
      return { ...f, [key]: next };
    });
  };

  /* Red field + message for a server validation error (GuardedResult `fields`). */
  const errorProps = (field: string) =>
    fieldErrors[field] ? { "aria-invalid": true, "aria-describedby": `event-${field}-error` } : {};
  const errorFor = (field: string) => (
    <FieldError id={`event-${field}-error`} message={fieldErrors[field]} />
  );

  /* ---- table columns ---- */
  const checkboxCol: Column<EventItem> = {
    key: "check",
    width: "24px",
    align: "left",
    header: (
      <label className="admin-checkbox">
        <input
          type="checkbox"
          aria-label="Select all on page"
          checked={pageAllSelected}
          ref={(el) => {
            if (el) el.indeterminate = pageSomeSelected && !pageAllSelected;
          }}
          onChange={togglePage}
          className="admin-table__checkbox"
        />
        <span aria-hidden="true" />
      </label>
    ),
    render: (r) => (
      <label className="admin-checkbox">
        <input
          type="checkbox"
          aria-label={`Select ${r.title}`}
          checked={selected.has(r.id)}
          onChange={() => toggleSelect(r.id)}
          className="admin-table__checkbox"
        />
        <span aria-hidden="true" />
      </label>
    ),
  };

  const columns: Column<EventItem>[] = [
    checkboxCol,
    {
      key: "title",
      header: (
        <SortHeader
          label="Event"
          active={sortKey === "title"}
          dir={sortDir}
          onClick={() => onSort("title")}
        />
      ),
      width: "32%",
      render: (r) => (
        <div className="admin-event-title">
          <span className="admin-event-avatar" aria-hidden="true">
            {r.banner ? (
              // eslint-disable-next-line @next/next/no-img-element -- Storage thumbnail (WebP)
              <img
                className="admin-event-avatar__img"
                src={r.banner.thumbUrl}
                alt=""
                width={20}
                height={20}
              />
            ) : (
              typeInitials(r.typeLabel)
            )}
          </span>
          <div>
            <div className="admin-table__title">{r.title}</div>
            <div className="admin-table__sub">{r.typeLabel}</div>
          </div>
        </div>
      ),
    },
    {
      key: "date",
      header: (
        <SortHeader
          label="Event Date"
          active={sortKey === "date"}
          dir={sortDir}
          onClick={() => onSort("date")}
        />
      ),
      width: "14%",
      render: (r) => (
        <span className="admin-event-date">
          <span className="admin-table__title">{formatInZone(r.startsAt, r.timezone)}</span>
          <Countdown date={r.startsAt} />
        </span>
      ),
    },
    {
      key: "location",
      header: "Location",
      width: "22%",
      render: (r) => (
        <span className="admin-event-location">
          <Icon name="mapPin" size={13} />
          <span>{r.location}</span>
        </span>
      ),
    },
    {
      key: "status",
      header: (
        <SortHeader
          label="Status"
          active={sortKey === "status"}
          dir={sortDir}
          onClick={() => onSort("status")}
        />
      ),
      width: "12%",
      render: (r) => {
        if (r.status === "published")
          return (
            <span className="admin-status-badge admin-status-badge--published">
              {/* eslint-disable-next-line @next/next/no-img-element -- packed public asset */}
              <img
                src="/globe.png"
                alt=""
                width={12}
                height={12}
                className="admin-status-badge__img"
              />{" "}
              Public
            </span>
          );
        return (
          <span className="admin-status-badge admin-status-badge--draft">
            <Icon name="edit" size={12} /> Draft
          </span>
        );
      },
    },
    {
      key: "registered",
      header: (
        <SortHeader
          label="Last Modified"
          active={sortKey === "registered"}
          dir={sortDir}
          onClick={() => onSort("registered")}
        />
      ),
      width: "12%",
      render: (r) => (
        <span className="admin-event-meta">
          <span className="admin-table__title">{formatInZone(r.modifiedAt, "UTC")} UTC</span>
        </span>
      ),
    },
    {
      key: "aksi",
      header: "",
      align: "right",
      width: "12%",
      render: (r) => (
        <div className="admin-table__actions">
          {canEdit ? (
            <Button
              variant="ghost"
              size="icon"
              icon="edit"
              aria-label="Edit"
              onClick={() => toForm("edit", r)}
              title="Edit"
            />
          ) : null}
          <div className="admin-row-menu">
            {menuFor === r.id ? (
              <div className="admin-row-menu__backdrop" onClick={() => setMenuFor(null)} />
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              icon="more"
              aria-label="More actions"
              title="More actions"
              onClick={() => setMenuFor(menuFor === r.id ? null : r.id)}
            />
            {menuFor === r.id ? (
              <div className="admin-row-menu__panel" role="menu">
                {canEdit ? (
                  <button
                    type="button"
                    className="admin-row-menu__item"
                    role="menuitem"
                    disabled={busy}
                    onClick={() => setPublishedFor([r.id], r.status === "draft")}
                  >
                    {r.status === "draft" ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element -- packed public asset */}
                        <img
                          src="/globe.png"
                          alt=""
                          width={14}
                          height={14}
                          className="admin-status-badge__img"
                        />{" "}
                        Publish
                      </>
                    ) : (
                      <>
                        <Icon name="lock" size={14} /> Unpublish
                      </>
                    )}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="admin-row-menu__item"
                  role="menuitem"
                  onClick={() => copyLink(r)}
                >
                  <Icon name="copy" size={14} /> Copy Link
                </button>
                {canEdit ? (
                  <>
                    {/* Divider above the destructive action, separating Delete from the rest. */}
                    <div className="admin-row-menu__divider" role="separator" />
                    <button
                      type="button"
                      className="admin-row-menu__item admin-row-menu__item--danger"
                      role="menuitem"
                      onClick={() => deleteEvent(r)}
                    >
                      <Icon name="trash" size={14} /> Delete Event
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ),
    },
  ];

  const shownStart = filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const shownEnd = Math.min(safePage * pageSize, filtered.length);

  /* ---- pagination: sliding window of 5 consecutive page numbers ---- */
  const pageNumbers: number[] = [];
  const winStart = Math.max(1, Math.min(safePage - 2, totalPages - 4));
  const winEnd = Math.min(totalPages, winStart + 4);
  for (let i = winStart; i <= winEnd; i++) pageNumbers.push(i);

  const switchTab = (next: EventTab) => {
    setTab(next);
    setPage(1);
    setSelected(new Set());
    setMenuFor(null);
  };

  const clearFilters = () => {
    setQuery("");
    setSearch("");
    setTypeFilter("all");
    setStatusFilter("all");
    setDateFilter("all");
    setFiltersOpen(false);
    setPage(1);
    setMenuFor(null);
  };

  if (view === "form") {
    return (
      <>
        <div className="admin-page-header">
          <div>
            <h1 className="admin-page-header__title">
              {formMode === "create" ? "Event > Create" : "Event > Edit"}
            </h1>
            <p className="admin-page-header__desc">
              {formMode === "create"
                ? "Fill in the details to create a new event, then publish it to the public site."
                : "Update the event details below, then publish the changes to the public site."}
            </p>
          </div>
        </div>

        <div className="admin-events-form">
          <div className="admin-form-grid">
            {/* Title */}
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="event-title">
                Title *
              </label>
              <input
                id="event-title"
                className="admin-input"
                type="text"
                placeholder="Event title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                {...errorProps("title")}
              />
              {errorFor("title")}
            </div>

            {/* Event Type */}
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="event-type">
                Event Type *
              </label>
              <select
                id="event-type"
                className="admin-select"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as EventType })}
              >
                {EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {label(EVENT_TYPE_LABELS, t)}
                  </option>
                ))}
              </select>
            </div>

            {/* Event Date & Time + Registration Deadline */}
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="event-date">
                Event Date &amp; Time *
              </label>
              <input
                id="event-date"
                className="admin-input admin-input--datetime"
                type="datetime-local"
                value={form.start}
                onChange={(e) => setForm({ ...form, start: e.target.value })}
                {...errorProps("startsAt")}
              />
              {errorFor("startsAt")}
            </div>

            <div className="admin-field">
              <label className="admin-field__label" htmlFor="event-deadline">
                Registration Deadline
              </label>
              <input
                id="event-deadline"
                className="admin-input"
                type="datetime-local"
                value={form.deadline}
                onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                {...errorProps("registrationClosesAt")}
              />
              {errorFor("registrationClosesAt")}
            </div>

            {/* Time zone of the event: both times above are on this clock. */}
            <div className="admin-field admin-form-grid__full">
              <label className="admin-field__label" htmlFor="event-timezone">
                Time Zone *
              </label>
              <input
                id="event-timezone"
                className="admin-input"
                type="text"
                placeholder="Asia/Tokyo"
                value={form.timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                {...errorProps("timezone")}
              />
              <FieldError
                id="event-timezone-error"
                message={
                  fieldErrors["timezone"] ??
                  "Where the event happens (IANA name). The date, time and deadline are on this clock."
                }
              />
            </div>

            {/* Location + URL */}
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="event-location">
                Location *
              </label>
              <input
                id="event-location"
                className="admin-input"
                type="text"
                placeholder="Event location"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                {...errorProps("location")}
              />
              {errorFor("location")}
            </div>

            <div className="admin-field">
              <label className="admin-field__label" htmlFor="event-url">
                URL
              </label>
              <div className="admin-field__row">
                <div className="admin-url-slug">
                  <span className="admin-url-slug__prefix" aria-label="Event URL prefix">
                    /events/
                  </span>
                  <input
                    id="event-url"
                    className="admin-url-slug__slug"
                    type="text"
                    aria-label="Event URL slug"
                    placeholder="random when empty"
                    value={form.url}
                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                    {...errorProps("slug")}
                  />
                </div>
              </div>
              {errorFor("slug")}
            </div>

            {/* Description */}
            <div className="admin-field admin-form-grid__full">
              <label className="admin-field__label" htmlFor="event-desc">
                Description *
              </label>
              <textarea
                id="event-desc"
                className="admin-input admin-textarea"
                rows={4}
                placeholder="Event description..."
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                {...errorProps("description")}
              />
              {errorFor("description")}
            </div>

            {/* Registration Link */}
            <div className="admin-field admin-form-grid__full">
              <label className="admin-field__label" htmlFor="event-reg-link">
                Registration Link
              </label>
              <input
                id="event-reg-link"
                className="admin-input"
                type="url"
                placeholder="https://example.com/register"
                value={form.registrationLink}
                onChange={(e) => setForm({ ...form, registrationLink: e.target.value })}
                {...errorProps("registrationUrl")}
              />
              {errorFor("registrationUrl")}
            </div>

            {/* Banner */}
            <div className="admin-field admin-form-grid__full">
              <span className="admin-field__label">Event Banner *</span>
              <div
                className="admin-dropzone"
                onClick={() => bannerInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) void onBannerFile(file);
                }}
              >
                {bannerUpload.busy ? (
                  <span className="admin-dropzone__title">Uploading…</span>
                ) : form.banner ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element -- Storage thumbnail (WebP) */}
                    <img
                      src={form.banner.thumbUrl}
                      alt="Uploaded banner"
                      className="admin-dropzone__image"
                    />
                    <span className="admin-dropzone__badge">Click to change</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      icon="x"
                      className="admin-dropzone__remove"
                      aria-label="Remove uploaded image"
                      onClick={(e) => {
                        e.stopPropagation();
                        setForm({ ...form, banner: null });
                      }}
                    />
                  </>
                ) : (
                  <>
                    <Icon name="upload" size={34} />
                    <span className="admin-dropzone__title">
                      Drag &amp; drop banner image or click to browse
                    </span>
                    <span className="admin-card__subtitle">
                      Any image format • Converted to WebP • Max 5MB
                    </span>
                  </>
                )}
              </div>
              <input
                ref={bannerInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onBannerFile(file);
                  e.target.value = "";
                }}
              />
              <FieldError
                id="event-bannerImage-error"
                message={bannerUpload.error ?? fieldErrors["bannerImage"]}
              />
            </div>
          </div>

          {/* ---- editable sections ---- */}
          <EditableList
            title="Guest/Speakers"
            emptyHint="No guest/speakers added"
            addLabel="Add Speaker"
            count={form.guests.length}
            onAdd={addGuest}
            onRemove={(i) => removeFrom("guests", i)}
            onReorder={(from, to) => reorder("guests", from, to)}
            renderRow={(i) => {
              const g = form.guests[i] ?? { photo: null, name: "", description: "" };
              return (
                <div className="admin-guest">
                  <PhotoDrop
                    value={g.photo?.thumbUrl ?? null}
                    label="Guest photo"
                    onFile={(file) =>
                      void uploadPhoto(file).then((photo) => photo && updateGuest(i, { photo }))
                    }
                    onClear={() => updateGuest(i, { photo: null })}
                  />
                  <div className="admin-field">
                    <label className="admin-field__label" htmlFor={`guest-name-${i}`}>
                      Name *
                    </label>
                    <input
                      id={`guest-name-${i}`}
                      className="admin-input"
                      type="text"
                      placeholder="Speaker's Name"
                      value={g.name}
                      onChange={(e) => updateGuest(i, { name: e.target.value })}
                    />
                  </div>
                  <div className="admin-field">
                    <label className="admin-field__label" htmlFor={`guest-desc-${i}`}>
                      Description
                    </label>
                    <input
                      id={`guest-desc-${i}`}
                      className="admin-input"
                      type="text"
                      placeholder="Short Bio"
                      value={g.description}
                      onChange={(e) => updateGuest(i, { description: e.target.value })}
                    />
                  </div>
                </div>
              );
            }}
          />
          <EditableList
            title="Rundown"
            emptyHint="No rundown added"
            addLabel="Add Rundown"
            count={form.rundown.length}
            onAdd={addRundown}
            onRemove={(i) => removeFrom("rundown", i)}
            onReorder={(from, to) => reorder("rundown", from, to)}
            renderRow={(i) => {
              const r = form.rundown[i] ?? { time: "", title: "", description: "" };
              return (
                <div className="admin-rundown">
                  <div className="admin-field admin-field--fit">
                    <label className="admin-field__label" htmlFor={`rundown-time-${i}`}>
                      Time
                    </label>
                    <input
                      id={`rundown-time-${i}`}
                      className="admin-input admin-input--time"
                      type="time"
                      value={r.time}
                      onChange={(e) => updateRundown(i, { time: e.target.value })}
                    />
                  </div>
                  <div className="admin-field">
                    <label className="admin-field__label" htmlFor={`rundown-title-${i}`}>
                      Title *
                    </label>
                    <input
                      id={`rundown-title-${i}`}
                      className="admin-input"
                      type="text"
                      placeholder="Rundown Title"
                      value={r.title}
                      onChange={(e) => updateRundown(i, { title: e.target.value })}
                    />
                  </div>
                  <div className="admin-field">
                    <label className="admin-field__label" htmlFor={`rundown-desc-${i}`}>
                      Description
                    </label>
                    <input
                      id={`rundown-desc-${i}`}
                      className="admin-input"
                      type="text"
                      placeholder="Rundown Description"
                      value={r.description}
                      onChange={(e) => updateRundown(i, { description: e.target.value })}
                    />
                  </div>
                </div>
              );
            }}
          />
          <EditableList
            title="Sponsors"
            emptyHint="No sponsors added"
            addLabel="Add Sponsor"
            count={form.sponsors.length}
            onAdd={addSponsor}
            onRemove={(i) => removeFrom("sponsors", i)}
            onReorder={(from, to) => reorder("sponsors", from, to)}
            renderRow={(i) => {
              const s = form.sponsors[i] ?? { photo: null, tip: "" };
              return (
                <div className="admin-sponsor">
                  <PhotoDrop
                    value={s.photo?.thumbUrl ?? null}
                    label="Sponsor logo"
                    onFile={(file) =>
                      void uploadPhoto(file).then((photo) => photo && updateSponsor(i, { photo }))
                    }
                    onClear={() => updateSponsor(i, { photo: null })}
                  />
                  <div className="admin-field">
                    <label className="admin-field__label" htmlFor={`sponsor-tip-${i}`}>
                      Caption *
                    </label>
                    <input
                      id={`sponsor-tip-${i}`}
                      className="admin-input"
                      type="text"
                      placeholder="e.g. PPIDK ASIANIA"
                      value={s.tip}
                      onChange={(e) => updateSponsor(i, { tip: e.target.value })}
                    />
                  </div>
                </div>
              );
            }}
          />

          {/* footer actions — spans the full grid (the line above reaches the
                card edges) and pushes Save draft/Publish to the far right. */}
          <FieldError id="event-photo-error" message={photoUpload.error} />
          {["schedule", "speakers", "sponsors"].map((field) => (
            <FieldError key={field} id={`event-${field}-error`} message={fieldErrors[field]} />
          ))}
          <div className="admin-form-actions admin-form-grid__full">
            <Button variant="outline" size="sm" icon="chevronLeft" onClick={() => setView("list")}>
              Back
            </Button>
            <div className="admin-form-actions__right">
              <Button
                variant="outline"
                size="sm"
                icon="cloud"
                disabled={busy || bannerUpload.busy || photoUpload.busy}
                onClick={() => void save(false)}
              >
                Save draft
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || bannerUpload.busy || photoUpload.busy}
                onClick={() => void save(true)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- packed public asset, same logo as the Public badge */}
                <img
                  src="/globe.png"
                  alt=""
                  width={14}
                  height={14}
                  className="admin-status-badge__img"
                />{" "}
                Publish
              </Button>
            </div>
          </div>
        </div>

        <ToastBanner message={toast.message} />
      </>
    );
  }

  return (
    <>
      <div className="admin-page-header admin-events-header">
        <div>
          <h1 className="admin-page-header__title">Event</h1>
          <p className="admin-page-header__desc">
            Manage all upcoming and past events shown on the public Event page.
          </p>
        </div>
        <div className="admin-page-header__actions">
          {/* "Add New Event" now reads like the table's row-action buttons
              (ghost ink) instead of a filled maroon call-to-action. */}
          {canEdit ? (
            <Button
              variant="ghost"
              size="sm"
              icon="plus"
              className="admin-btn--events-add"
              onClick={() => toForm("create")}
            >
              Add New Event
            </Button>
          ) : null}
          {/* Filter moved to the header, to the right of Add New Event. */}
          <Button
            variant="outline"
            size="sm"
            icon="filter"
            onClick={() => setFiltersOpen((v) => !v)}
            className={activeFilterCount > 0 ? "admin-btn--filter-on" : ""}
          >
            Filters {activeFilterCount > 0 ? `(${activeFilterCount})` : ""}
          </Button>
          {/* Search bar + button sit beside the Filter button. */}
          <form
            className="admin-searchbox"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(search);
              setPage(1);
              setPageSize(10);
              setMenuFor(null);
            }}
          >
            <Icon name="search" size={16} className="admin-searchbox__icon" />
            <input
              className="admin-searchbox__input"
              type="search"
              placeholder="Search"
              aria-label="Search events"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                // Emptying the box (✕ or clear) drops the applied query too,
                // so the list returns to its default view.
                if (e.target.value === "") {
                  setQuery("");
                  setPage(1);
                  setMenuFor(null);
                }
              }}
            />
            <button type="submit" className="admin-searchbox__submit">
              Search
            </button>
          </form>
        </div>
      </div>

      <Card className="admin-events-card admin-list-card">
        <CardBody flush>
          {/* Toggle filter panel */}
          {filtersOpen ? (
            <div className="admin-filter-panel">
              <div className="admin-field">
                <span className="admin-field__label">Event Type</span>
                <select
                  className="admin-select"
                  value={typeFilter}
                  onChange={(e) => {
                    setTypeFilter(e.target.value);
                    setPage(1);
                    setMenuFor(null);
                  }}
                >
                  <option value="all">All types</option>
                  {EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {label(EVENT_TYPE_LABELS, t)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="admin-field">
                <span className="admin-field__label">Status</span>
                <select
                  className="admin-select"
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value as StatusFilter);
                    setPage(1);
                    setMenuFor(null);
                  }}
                >
                  <option value="all">All statuses</option>
                  <option value="published">Public</option>
                  <option value="draft">Draft</option>
                </select>
              </div>
              <div className="admin-field">
                <span className="admin-field__label">Event Date</span>
                <select
                  className="admin-select"
                  value={dateFilter}
                  onChange={(e) => {
                    setDateFilter(e.target.value as DateFilter);
                    setPage(1);
                    setMenuFor(null);
                  }}
                >
                  <option value="all">All dates</option>
                  <option value="today">Today</option>
                  <option value="month">This month</option>
                  <option value="year">This year</option>
                  <option value="past">Past events</option>
                </select>
              </div>
              <button type="button" className="admin-filter-panel__clear" onClick={clearFilters}>
                <Icon name="x" size={12} />
                Clear filters
              </button>
            </div>
          ) : null}

          {/* Tabs */}
          <div className="admin-tabs" role="tablist" aria-label="Event lists">
            {(
              [
                ["all", "All"],
                ["upcoming", "Upcoming"],
                ["past", "Past"],
                ["drafts", "Drafts"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={`admin-tabs__btn${tab === key ? " admin-tabs__btn--active" : ""}`}
                onClick={() => switchTab(key)}
              >
                {label}
                <span className="admin-tabs__count">{counts[key]}</span>
              </button>
            ))}
          </div>

          {/* Table — always rendered so it keeps its full height; the empty
              message becomes one body row inside the static table. */}
          <DataTable
            columns={columns}
            rows={pageRows}
            rowKey={(r) => r.id}
            emptyText="No events yet"
            hideHeader={false}
            minRows={pageSize}
            emptyState={
              <div className="admin-empty admin-empty--stack">
                <span className="admin-empty__heading">
                  <Icon name="inbox" size={16} />
                  <span className="admin-empty__title">
                    {query.trim()
                      ? `No events match “${query.trim()}”`
                      : "No events match your filters"}
                  </span>
                </span>
                <span className="admin-empty__hint">
                  {activeFilterCount > 0
                    ? `${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"} are on. Try a new search or clear them.`
                    : "Try a new search or clear them."}
                </span>
                <span className="admin-empty__actions">
                  {query.trim() || activeFilterCount > 0 ? (
                    <Button
                      variant="outline"
                      size="sm"
                      icon="x"
                      className="admin-gallery-clear"
                      onClick={clearFilters}
                    >
                      Clear filters
                    </Button>
                  ) : null}
                  {canEdit ? (
                    <Button
                      variant="primary"
                      size="sm"
                      icon="plus"
                      onClick={() => toForm("create")}
                    >
                      Add New Event
                    </Button>
                  ) : null}
                </span>
              </div>
            }
          />

          {/* Bulk action bar — shown in place of the pagination bar while rows are selected */}
          {selected.size > 0 ? (
            <div className="admin-bulkbar">
              <span className="admin-bulkbar__summary">
                <label className="admin-checkbox">
                  <input
                    type="checkbox"
                    aria-label="Select all matching events"
                    checked={allFilteredSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = selected.size > 0 && !allFilteredSelected;
                    }}
                    onChange={selectAllFiltered}
                    className="admin-table__checkbox"
                  />
                  <span aria-hidden="true" />
                </label>
                {selected.size} selected
              </span>
              <button
                type="button"
                className="admin-bulkbar__select-all"
                onClick={selectAllFiltered}
              >
                Select all {filtered.length} events
              </button>
              <div className="admin-bulkbar__actions">
                {canEdit ? (
                  <>
                    <Button variant="primary" size="sm" disabled={busy} onClick={publishSelected}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- packed public asset, same logo as the Public badge */}
                      <img
                        src="/globe.png"
                        alt=""
                        width={14}
                        height={14}
                        className="admin-status-badge__img"
                      />{" "}
                      Publish
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      icon="lock"
                      disabled={busy}
                      onClick={unpublishSelected}
                    >
                      Unpublish
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      icon="trash"
                      disabled={busy}
                      onClick={deleteSelected}
                    >
                      Delete
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          ) : (
            /* Pagination: Showing … of N · Rows per page · page numbers */
            <div className="admin-darkbar">
              <span className="admin-darkbar__info">
                Showing {shownStart}–{shownEnd} of {filtered.length}
              </span>
              <span className="admin-darkbar__info">
                Rows per page
                <select
                  className="admin-darkbar__select"
                  aria-label="Rows per page"
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
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
                  className={`admin-darkbar__btn${p === safePage ? " admin-darkbar__btn--active" : ""}`}
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
          )}
        </CardBody>
      </Card>

      {/* Delete confirmation popup — dark, compact, styled like the Tools page
          delete modal; the two actions sit flush right. */}
      <Modal
        open={deleteConfirm !== null}
        title={
          deleteConfirm?.kind === "many"
            ? `Delete ${deleteConfirm.count} Event${deleteConfirm.count === 1 ? "" : "s"}?`
            : deleteConfirm
              ? `Delete "${deleteConfirm.event.title}"?`
              : "Delete event"
        }
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
          {deleteConfirm ? (
            <span className="admin-delete-confirm__hint">
              They disappear from the public page now. You can revert deletion on the admin log
              before 14 days.
            </span>
          ) : null}
        </p>
      </Modal>

      <ToastBanner message={toast.message} />
    </>
  );
}

/** "N day(s) left" in gold under the Event Date (hidden once the day has passed). */
function Countdown({ date }: { date: string }) {
  const [now] = useState(() => Date.now());
  const target = new Date(date.length === 10 ? `${date}T00:00:00` : date);
  const days = Math.ceil((target.getTime() - now) / 86_400_000);
  if (Number.isNaN(target.getTime()) || days < 1) return null;
  return (
    <span className="admin-event-date__count">
      {days === 1 ? "1 day left" : `${days} days left`}
    </span>
  );
}
