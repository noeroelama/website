"use client";

import { useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import {
  ALBUM_EVENT_OPTIONS,
  INITIAL_ALBUMS,
  PAGE_SIZE_OPTIONS,
  formatDateTime,
  timeAgo,
  type AlbumItem,
  type AlbumStatus,
} from "@/data/mock/gallery";

/* ==================================================================
   Gallery — album list (search, filters, bulk actions) + create/edit
   form. Ported from the Figma "GALLERY ADMIN" screens.

   NOTE on CSS reuse: the table/card and header reuse the `.admin-events-*`
   scopes on purpose — `.admin-events-card` and `.admin-events-header`
   exist in the light theme (globals.css) with the dark layers added by
   preview-dark.css, so the gallery list gets the matching dark table,
   sortable headers, bulk bar and pagination for free. The form surface
   is scoped under `.admin-gallery-form` (mirror of `.admin-events-form`).
   Colours come from the shared design tokens, no hex values outside
   globals.css.
   ================================================================== */

/** Public URL prefix for an album page, shown in the "URL *" field and Copy Link. */
const ALBUM_URL_PREFIX = "ppidk.asiania.id/photos/";

/** Small monogram chip standing in for the Figma row avatar (author / event type). */
function initialsOf(name: string): string {
  return name.trim().slice(0, 2).toUpperCase() || "AL";
}

/** Sortable album-table columns (checkbox and actions are never sorted). */
type SortKey = "title" | "author" | "date";

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

/** One editable photo tile in the Edit Album 5×2 grid. */
interface AlbumPhoto {
  /** data URL of the picked image, or null for an empty tile. */
  src: string | null;
  status: "uploaded" | "processing" | "error";
}

interface AlbumForm {
  event: string;
  total: string;
  albumLink: string;
  url: string;
  banner: string | null;
  photos: AlbumPhoto[];
}

const EMPTY_FORM: AlbumForm = {
  event: ALBUM_EVENT_OPTIONS[0] ?? "",
  total: "",
  albumLink: "",
  url: "",
  banner: null,
  photos: [],
};

/** Filter choice for the status select: any of the mock statuses, or "all". */
type StatusFilter = "all" | AlbumStatus;

/** Filter choice for the "Last Modified" select — same bucketing as the Events
 *  and Articles filter panels. */
type DateFilter = "all" | "today" | "month" | "year" | "past";

/** Pending delete action shown in the dark confirm modal (one album or many). */
type DeleteConfirm = { kind: "one"; album: AlbumItem } | { kind: "many"; count: number };

export function GalleryPage() {
  const pathname = usePathname();

  /* Re-keying the whole screen on the current path remounts it whenever the
     gallery route is (re)entered, so navigating away and back starts from a
     clean state — empty searchbox, all data, first page, no filters — without
     needing to reset state in an effect. */
  return <GalleryList key={pathname} />;
}

function GalleryList() {
  const toast = useToastMessage();

  /* ---- list state ---- */
  const [albums, setAlbums] = useState<AlbumItem[]>(INITIAL_ALBUMS);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState(""); // diterapkan hanya saat Search diklik / Enter ditekan
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("all");
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
  const [form, setForm] = useState<AlbumForm>(EMPTY_FORM);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const activeFilterCount =
    (eventTypeFilter !== "all" ? 1 : 0) +
    (statusFilter !== "all" ? 1 : 0) +
    (dateFilter !== "all" ? 1 : 0);

  /* Distinct event types across the mock albums — feed the Event Type filter
     from the albums' own content (like the Events/Articles category filters). */
  const albumEventTypes = useMemo(
    () => Array.from(new Set(albums.map((a) => a.eventType))).sort(),
    [albums],
  );

  /* ---- header sort: click toggles asc → desc (first click on a new column = asc) ---- */
  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortValue = (a: AlbumItem, key: SortKey): string => {
    switch (key) {
      case "title":
        return a.title.toLowerCase();
      case "author":
        return a.createdBy.toLowerCase();
      case "date":
        return a.modifiedAt;
    }
  };

  /* ---- derived rows ---- */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const m = today.slice(0, 7); // YYYY-MM, for the "this month" filter
    const y = today.slice(0, 4); // YYYY, for the "this year" filter
    return albums.filter((a) => {
      if (eventTypeFilter !== "all" && a.eventType !== eventTypeFilter) return false;
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      if (dateFilter !== "all") {
        const d = a.modifiedAt.slice(0, 10); // ISO date part of the timestamp
        if (dateFilter === "today") {
          if (d !== today) return false;
        } else if (dateFilter === "month") {
          if (!d.startsWith(m)) return false;
        } else if (dateFilter === "year") {
          if (!d.startsWith(y)) return false;
        } else if (dateFilter === "past") {
          if (d >= today) return false;
        }
      }
      if (q) {
        const hay = [a.title, a.event, a.eventType, a.url].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [albums, query, today, eventTypeFilter, statusFilter, dateFilter]);

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

  /* ---- row / bulk mutations ---- */
  const setStatusFor = (ids: Set<string>, status: AlbumStatus, label: string) => {
    if (ids.size === 0) {
      toast.show("Select albums first");
      return;
    }
    setAlbums((prev) => prev.map((a) => (ids.has(a.id) ? { ...a, status } : a)));
    toast.show(`${ids.size} album${ids.size === 1 ? "" : "s"} ${label}`);
  };

  const setStatusForId = (id: string, status: AlbumStatus, label: string) => {
    setAlbums((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
    setMenuFor(null);
    toast.show(`Album ${label}`);
  };

  const publishSelected = () => setStatusFor(selected, "published", "published");
  const makePrivateSelected = () => setStatusFor(selected, "private", "made private");

  const deleteSelected = () => {
    if (selected.size === 0) {
      toast.show("Select albums to delete");
      return;
    }
    setDeleteConfirm({ kind: "many", count: selected.size });
  };

  const deleteAlbum = (a: AlbumItem) => {
    setMenuFor(null);
    setDeleteConfirm({ kind: "one", album: a });
  };

  /* Deletes are confirmed in the dark modal (like Events/Tools) instead of
     window.confirm. The modal only stores *what* would be deleted; doDelete
     applies the change once the user confirms. */
  const doDelete = () => {
    if (!deleteConfirm) return;
    if (deleteConfirm.kind === "one") {
      const a = deleteConfirm.album;
      setAlbums((prev) => prev.filter((x) => x.id !== a.id));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(a.id);
        return next;
      });
      setDeleteConfirm(null);
      toast.show("Album deleted");
    } else {
      const ids = Array.from(selected);
      setAlbums((prev) => prev.filter((a) => !selected.has(a.id)));
      setSelected(new Set());
      setDeleteConfirm(null);
      toast.show(`${ids.length} album${ids.length === 1 ? "" : "s"} deleted`);
    }
  };

  const copyLink = (a: AlbumItem) => {
    void navigator.clipboard?.writeText(`https://${ALBUM_URL_PREFIX}${a.url}`);
    toast.show(`Link for "${a.title}" copied`);
    setMenuFor(null);
  };

  /* ---- form open / save ---- */
  const toForm = (mode: "create" | "edit", a?: AlbumItem) => {
    setFormMode(mode);
    setEditingId(a?.id ?? null);
    const samplePhotos: AlbumPhoto[] =
      mode === "edit"
        ? Array.from({ length: 10 }, (_, i) => ({
            src: `/events/ev${String((i % 10) + 1).padStart(2, "0")}.png`,
            status: "uploaded" as const,
          }))
        : [];
    setForm(
      a
        ? {
            event: ALBUM_EVENT_OPTIONS.includes(a.event) ? a.event : EMPTY_FORM.event,
            total: String(a.total),
            albumLink: a.albumLink,
            url: a.url,
            banner: null,
            photos: samplePhotos,
          }
        : EMPTY_FORM,
    );
    setView("form");
  };

  const fromForm = (status: AlbumStatus): AlbumItem | null => {
    const eventName = form.event.trim();
    if (!eventName || !form.albumLink.trim()) {
      toast.show("Event and album link are required");
      return null;
    }
    /* Banner is required on create; on edit it starts empty unless re-uploaded. */
    if (formMode === "create" && !form.banner) {
      toast.show("Event banner is required");
      return null;
    }
    const slug =
      form.url.trim().replace(/\s+/g, "-") ||
      eventName.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-album";
    const existing = albums.find((a) => a.id === editingId);
    const eventType = existing?.eventType ?? "Album";
    const next: AlbumItem = {
      id: editingId ?? `al-${Date.now()}`,
      title: `${eventName} Album`,
      event: eventName,
      eventType,
      total: Number(form.total) || 0,
      url: slug,
      albumLink: form.albumLink.trim(),
      image: existing?.image ?? "/events/ev01.png",
      photos: existing?.photos ?? Array.from({ length: 5 }, () => "/events/ev01.png"),
      status,
      createdBy: existing?.createdBy ?? "Admin",
      email: existing?.email ?? "admin@asiania.id",
      createdAt: existing?.createdAt ?? new Date().toISOString().slice(0, 10),
      modifiedAt: new Date().toISOString().slice(0, 10),
    };
    return next;
  };

  const saveDraft = () => {
    const next = fromForm("draft");
    if (!next) return;
    setAlbums((prev) => {
      const exists = prev.some((a) => a.id === next.id);
      return exists ? prev.map((a) => (a.id === next.id ? next : a)) : [next, ...prev];
    });
    toast.show("Draft saved");
    setView("list");
  };

  const publishAlbum = () => {
    const next = fromForm("published");
    if (!next) return;
    setAlbums((prev) => {
      const exists = prev.some((a) => a.id === next.id);
      return exists ? prev.map((a) => (a.id === next.id ? next : a)) : [next, ...prev];
    });
    toast.show("Album published");
    setPage(1);
    setView("list");
  };

  const onBannerFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.show("Please choose an image file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.show("Image must be max 5MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, banner: reader.result as string }));
    reader.readAsDataURL(file);
  };

  /* ---- table columns ---- */
  const checkboxCol: Column<AlbumItem> = {
    key: "check",
    width: "4%",
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

  const columns: Column<AlbumItem>[] = [
    checkboxCol,
    {
      key: "title",
      header: (
        <SortHeader
          label="Gallery"
          active={sortKey === "title"}
          dir={sortDir}
          onClick={() => onSort("title")}
        />
      ),
      width: "38%",
      render: (r) => (
        <div className="admin-gallery-album">
          <span className="admin-gallery-stack" aria-hidden="true">
            {(r.photos.length > 0 ? r.photos : [r.image]).slice(0, 5).map((src, i) => (
              <span
                key={`${r.id}-${i}`}
                className={`admin-gallery-stack__item${
                  i === 4 ? " admin-gallery-stack__item--more" : ""
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- local packed asset (public/events) */}
                <img className="admin-gallery-stack__img" src={src} alt="" />
                {i === 4 && <span className="admin-gallery-stack__count">{r.total}+</span>}
              </span>
            ))}
          </span>
          <div>
            <div className="admin-table__title">{r.event}</div>
            <div className="admin-table__sub">{r.eventType}</div>
          </div>
        </div>
      ),
    },
    {
      key: "event",
      header: (
        <SortHeader
          label="Author"
          active={sortKey === "author"}
          dir={sortDir}
          onClick={() => onSort("author")}
        />
      ),
      width: "26%",
      render: (r) => (
        <div className="admin-gallery-event">
          <span className="admin-gallery-event__avatar" aria-hidden="true">
            {initialsOf(r.createdBy)}
          </span>
          <div>
            <div className="admin-table__title">{r.createdBy}</div>
            <div className="admin-table__sub">{r.email}</div>
          </div>
        </div>
      ),
    },
    {
      key: "date",
      header: (
        <SortHeader
          label="Last Modified"
          active={sortKey === "date"}
          dir={sortDir}
          onClick={() => onSort("date")}
        />
      ),
      width: "16%",
      render: (r) => (
        <span className="admin-gallery-meta">
          <span className="admin-table__title">{formatDateTime(r.modifiedAt)}</span>
          <span className="admin-table__sub">{timeAgo(r.modifiedAt)}</span>
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
          <Button
            variant="ghost"
            size="icon"
            icon="edit"
            aria-label="Edit"
            onClick={() => toForm("edit", r)}
            title="Edit"
          />
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
                <button
                  type="button"
                  className="admin-row-menu__item"
                  role="menuitem"
                  onClick={() => setStatusForId(r.id, "published", "published")}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- packed public asset */}
                  <img
                    src="/globe.png"
                    alt=""
                    width={14}
                    height={14}
                    className="admin-status-badge__img"
                  />{" "}
                  Publish
                </button>
                <button
                  type="button"
                  className="admin-row-menu__item"
                  role="menuitem"
                  onClick={() => setStatusForId(r.id, "private", "made private")}
                >
                  <Icon name="lock" size={14} /> Make Private
                </button>
                <button
                  type="button"
                  className="admin-row-menu__item"
                  role="menuitem"
                  onClick={() => copyLink(r)}
                >
                  <Icon name="copy" size={14} /> Copy Link
                </button>
                {/* Divider above the destructive action, separating Delete from the rest. */}
                <div className="admin-row-menu__divider" role="separator" />
                <button
                  type="button"
                  className="admin-row-menu__item admin-row-menu__item--danger"
                  role="menuitem"
                  onClick={() => deleteAlbum(r)}
                >
                  <Icon name="trash" size={14} /> Delete Gallery
                </button>
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

  const clearFilters = () => {
    setQuery("");
    setSearch("");
    setEventTypeFilter("all");
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
              {formMode === "create" ? "Gallery > Create Album" : "Gallery > Edit Album"}
            </h1>
            <p className="admin-page-header__desc">
              {formMode === "create"
                ? "Fill in the details to create a new album, then publish it to the public site."
                : "Update gallery album information."}
            </p>
          </div>
        </div>

        <div className="admin-gallery-form">
          <div className="admin-form-grid">
            {/* Event */}
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="album-event">
                Event *
              </label>
              <select
                id="album-event"
                className="admin-select"
                value={form.event}
                onChange={(e) => setForm({ ...form, event: e.target.value })}
              >
                <option value="" disabled>
                  Select an event...
                </option>
                {ALBUM_EVENT_OPTIONS.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            </div>

            {/* Total Photos/Videos */}
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="album-total">
                Total Photos/Videos *
              </label>
              <input
                id="album-total"
                className="admin-input"
                type="text"
                inputMode="numeric"
                placeholder="e.g. 150"
                value={form.total}
                onChange={(e) => setForm({ ...form, total: e.target.value })}
              />
            </div>

            {/* Album Link */}
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="album-link">
                Album Link *
              </label>
              <input
                id="album-link"
                className="admin-input"
                type="url"
                placeholder="https://photos.app.goo.gl/xxxxxxxxxxxxxxxxx"
                value={form.albumLink}
                onChange={(e) => setForm({ ...form, albumLink: e.target.value })}
              />
            </div>

            {/* URL */}
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="album-url">
                URL *
              </label>
              <div className="admin-field__row">
                <div className="admin-url-slug">
                  <span className="admin-url-slug__prefix" aria-label="Album URL prefix">
                    /photos/
                  </span>
                  <input
                    id="album-url"
                    className="admin-url-slug__slug"
                    type="text"
                    aria-label="Album URL slug"
                    placeholder="album-name"
                    value={form.url}
                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* Event Banner — the label sits above the photos, then the
                dropzone below the grid (matches the Edit Album design). */}
            <div className="admin-field admin-form-grid__full">
              <span className="admin-field__label">Event Banner *</span>

              {/* Photo grid — Edit Album only (the Create screen has no photos yet) */}
              {formMode === "edit" ? (
                <PhotoGrid
                  photos={form.photos}
                  onChange={(next) => setForm((f) => ({ ...f, photos: next }))}
                  onToast={(msg) => toast.show(msg)}
                />
              ) : null}

              <div
                className="admin-dropzone"
                onClick={() => bannerInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) onBannerFile(file);
                }}
              >
                {form.banner ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element -- data-URL upload, not optimizable */}
                    <img
                      src={form.banner}
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
                      Any image format • Converted to WebP • Max 5MB •{" "}
                      {formMode === "edit" ? "1 Remaining" : "10 Remaining"}
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
                  if (file) onBannerFile(file);
                  e.target.value = "";
                }}
              />
            </div>
          </div>

          {/* footer actions — spans the full grid (the line above reaches the
              card edges) and pushes Save draft/Publish to the far right. */}
          <div className="admin-form-actions admin-form-grid__full">
            <Button variant="outline" size="sm" icon="chevronLeft" onClick={() => setView("list")}>
              Back
            </Button>
            <div className="admin-form-actions__right">
              <Button variant="outline" size="sm" icon="cloud" onClick={saveDraft}>
                Save draft
              </Button>
              <Button variant="outline" size="sm" onClick={publishAlbum}>
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
          <h1 className="admin-page-header__title">Gallery</h1>
          <p className="admin-page-header__desc">
            Browse and manage all photo albums and galleries published on the public Gallery page.
          </p>
        </div>
        <div className="admin-page-header__actions">
          <Button
            variant="ghost"
            size="sm"
            icon="plus"
            className="admin-btn--events-add"
            onClick={() => toForm("create")}
          >
            Add New Album
          </Button>
          <Button
            variant="outline"
            size="sm"
            icon="filter"
            onClick={() => setFiltersOpen((v) => !v)}
            className={activeFilterCount > 0 ? "admin-btn--filter-on" : ""}
          >
            Filters {activeFilterCount > 0 ? `(${activeFilterCount})` : ""}
          </Button>
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
              aria-label="Search albums"
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

      <Card className="admin-events-card admin-gallery-card">
        <CardBody flush>
          {/* Toggle filter panel */}
          {filtersOpen ? (
            <div className="admin-filter-panel">
              <div className="admin-field">
                <span className="admin-field__label">Event Type</span>
                <select
                  className="admin-select"
                  value={eventTypeFilter}
                  onChange={(e) => {
                    setEventTypeFilter(e.target.value);
                    setPage(1);
                    setMenuFor(null);
                  }}
                >
                  <option value="all">All types</option>
                  {albumEventTypes.map((t) => (
                    <option key={t} value={t}>
                      {t}
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
                  <option value="private">Private</option>
                  <option value="draft">Draft</option>
                </select>
              </div>
              <div className="admin-field">
                <span className="admin-field__label">Last Modified</span>
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
                  <option value="past">Before today</option>
                </select>
              </div>
              <button type="button" className="admin-filter-panel__clear" onClick={clearFilters}>
                <Icon name="x" size={12} />
                Clear filters
              </button>
            </div>
          ) : null}

          {/* Table — always rendered so it keeps its full height; the empty
              message becomes one body row inside the static table. */}
          <DataTable
            columns={columns}
            rows={pageRows}
            rowKey={(r) => r.id}
            emptyText="No albums yet"
            hideHeader={false}
            minRows={pageSize}
            emptyState={
              <div className="admin-empty admin-empty--stack">
                <span className="admin-empty__heading">
                  <Icon name="inbox" size={16} />
                  <span className="admin-empty__title">
                    {query.trim()
                      ? `No albums match “${query.trim()}”`
                      : "No albums match your filters"}
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
                  <Button variant="primary" size="sm" icon="plus" onClick={() => toForm("create")}>
                    Add New Album
                  </Button>
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
                    aria-label="Select all matching albums"
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
                Select all {filtered.length} albums
              </button>
              <div className="admin-bulkbar__actions">
                <Button variant="primary" size="sm" onClick={publishSelected}>
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
                <Button variant="primary" size="sm" icon="lock" onClick={makePrivateSelected}>
                  Make private
                </Button>
                <Button variant="danger" size="sm" icon="trash" onClick={deleteSelected}>
                  Delete
                </Button>
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
            ? `Delete ${deleteConfirm.count} Album${deleteConfirm.count === 1 ? "" : "s"}?`
            : deleteConfirm
              ? `Delete "${deleteConfirm.album.title}"?`
              : "Delete album"
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

/** 5×2 editable photo grid used by the Edit Album form (10 tiles). */
function PhotoGrid({
  photos,
  onChange,
  onToast,
}: {
  photos: AlbumPhoto[];
  onChange: (next: AlbumPhoto[]) => void;
  onToast: (msg: string) => void;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  /** Current tile count — defaults to 10 once the grid has been opened. */
  const count = 10;

  const handleFile = (idx: number, file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      onToast("Please choose an image file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      onToast("Image must be max 5MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const next = [...photos];
      next[idx] = { src: reader.result as string, status: "uploaded" };
      onChange(next);
    };
    reader.readAsDataURL(file);
  };

  const clearTile = (idx: number) => {
    /* Remove the photo entirely so the remaining filled tiles re-flow to the
       top-left grid slots (the freed slot becomes the trailing empty tile). */
    onChange(photos.filter((_, i) => i !== idx));
  };

  return (
    <div className="admin-gallery-grid">
      {Array.from({ length: count }, (_, i) => {
        const photo = photos[i] ?? { src: null, status: "uploaded" as const };
        return (
          <div
            key={i}
            className={`admin-gallery-tile${photo.src ? " admin-gallery-tile--filled" : ""}`}
            role="button"
            tabIndex={0}
            aria-label={`Album photo ${i + 1}`}
            onClick={() => refs.current[i]?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                refs.current[i]?.click();
              }
            }}
          >
            {photo.src ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- data-URL upload, not optimizable */}
                <img src={photo.src} alt="" className="admin-gallery-tile__img" />
                <span
                  className={`admin-gallery-tile__status admin-gallery-tile__status--${photo.status}`}
                >
                  {photo.status === "uploaded"
                    ? "Uploaded"
                    : photo.status === "processing"
                      ? "Processing"
                      : "Error"}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  icon="x"
                  className="admin-gallery-tile__clear"
                  aria-label={`Remove photo ${i + 1}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    clearTile(i);
                  }}
                />
              </>
            ) : (
              <Icon name="gallery" size={20} />
            )}
            <input
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                handleFile(i, e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
