"use client";

import { useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { FeaturedImage } from "@website/domain/content";
import { ALBUM_MAX_IMAGES } from "@website/domain/gallery";
import {
  removeAlbumAction,
  saveAlbumAction,
  setAlbumPublishedAction,
} from "@/app/(panel)/gallery/actions";
import { actionMessage } from "@/components/action-message";
import { formatInZone, timeAgo } from "@/components/format";
import { publicImage, useImageUpload } from "@/components/image-upload";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FieldError } from "@/components/ui/field-error";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import {
  PAGE_SIZE_OPTIONS,
  type AlbumEventOption,
  type AlbumItem,
  type AlbumStatus,
} from "./gallery-model";

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

/** Public album path on the web app (apps/web /gallery/[slug]). */
const ALBUM_PATH = "/gallery/";

/** Sortable album-table columns (checkbox and actions are never sorted). */
type SortKey = "title" | "total" | "date";

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

interface AlbumForm {
  eventId: string;
  total: string;
  albumLink: string;
  url: string;
  /** Featured images (1 to 10), uploaded with the "gallery" preset. */
  photos: FeaturedImage[];
}

const EMPTY_FORM: AlbumForm = { eventId: "", total: "", albumLink: "", url: "", photos: [] };

/** Filter choice for the status select: any status, or "all". */
type StatusFilter = "all" | AlbumStatus;

/** Filter choice for the "Last Modified" select — same bucketing as the Events
 *  and Articles filter panels. */
type DateFilter = "all" | "today" | "month" | "year" | "past";

/** Pending delete action shown in the dark confirm modal (one album or many). */
type DeleteConfirm = { kind: "one"; album: AlbumItem } | { kind: "many"; count: number };

interface GalleryListProps {
  /** Rows from the server (src/app/(panel)/gallery/page.tsx); refreshed after every change. */
  initial: AlbumItem[];
  /** Published events an album can belong to. */
  events: AlbumEventOption[];
  canEdit: boolean;
  /** WEB_URL, for "Copy Link". */
  publicBase: string;
}

export function GalleryPage(props: GalleryListProps) {
  const pathname = usePathname();

  /* Re-keying the whole screen on the current path remounts it whenever the
     gallery route is (re)entered, so navigating away and back starts from a
     clean state — empty searchbox, all data, first page, no filters — without
     needing to reset state in an effect. */
  return <GalleryList key={pathname} {...props} />;
}

function GalleryList({ initial: albums, events, canEdit, publicBase }: GalleryListProps) {
  const toast = useToastMessage();
  const router = useRouter();
  const upload = useImageUpload("gallery");
  /* A server action is running: the action buttons are disabled meanwhile. */
  const [busy, setBusy] = useState(false);
  /* Server validation messages per field (GuardedResult `fields`). */
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});

  /* ---- list state ---- */
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState(""); // diterapkan hanya saat Search diklik / Enter ditekan
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const [filtersOpen, setFiltersOpen] = useState(false);
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

  const activeFilterCount = (statusFilter !== "all" ? 1 : 0) + (dateFilter !== "all" ? 1 : 0);

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
        return a.event.toLowerCase();
      case "total":
        return String(a.photoCount).padStart(9, "0");
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
        const hay = [a.event, a.url, a.albumLink].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [albums, query, today, statusFilter, dateFilter]);

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

  /* ---- row / bulk mutations (server actions; the page re-reads after each) ---- */
  type Failure = Parameters<typeof actionMessage>[0];
  const fail = (result: Failure) => {
    setFieldErrors(result.fields ?? {});
    toast.show(actionMessage(result));
  };

  /* One action per album, one after the other (each has its own version check). */
  const runForEach = async (
    ids: readonly string[],
    run: (a: AlbumItem) => Promise<{ ok: true } | Failure>,
    done: string,
  ) => {
    setBusy(true);
    setMenuFor(null);
    let count = 0;
    let failure: Failure | null = null;
    for (const a of albums.filter((x) => ids.includes(x.id))) {
      const result = await run(a);
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
    else toast.show(`${count} album${count === 1 ? "" : "s"} ${done}`);
  };

  const setPublishedFor = (ids: readonly string[], published: boolean) => {
    if (ids.length === 0) {
      toast.show("Select albums first");
      return;
    }
    void runForEach(
      ids,
      (a) => setAlbumPublishedAction({ id: a.id, version: a.version, published }),
      published ? "published" : "unpublished",
    );
  };

  const publishSelected = () => setPublishedFor(Array.from(selected), true);
  const unpublishSelected = () => setPublishedFor(Array.from(selected), false);

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
     window.confirm. Soft delete: the images stay in Storage. */
  const doDelete = () => {
    if (!deleteConfirm) return;
    const ids = deleteConfirm.kind === "one" ? [deleteConfirm.album.id] : Array.from(selected);
    setDeleteConfirm(null);
    void runForEach(ids, (a) => removeAlbumAction({ id: a.id, version: a.version }), "deleted");
  };

  const copyLink = (a: AlbumItem) => {
    void navigator.clipboard?.writeText(`${publicBase}${ALBUM_PATH}${a.url}`);
    toast.show(`Link for "${a.event}" copied`);
    setMenuFor(null);
  };

  /* ---- form open / save ---- */
  const toForm = (mode: "create" | "edit", a?: AlbumItem) => {
    setFormMode(mode);
    setEditingId(a?.id ?? null);
    setFieldErrors({});
    setForm(
      a
        ? {
            eventId: a.eventId,
            total: a.total === null ? "" : String(a.total),
            albumLink: a.albumLink,
            url: a.url,
            photos: a.images,
          }
        : { ...EMPTY_FORM, eventId: events[0]?.id ?? "" },
    );
    setView("form");
  };

  /* Save draft / Publish. Rule: an event and at least one image (server-checked too). */
  const save = async (publish: boolean) => {
    const current = albums.find((a) => a.id === editingId);
    const total = form.total.trim();
    setBusy(true);
    const result = await saveAlbumAction({
      ...(editingId ? { id: editingId } : {}),
      version: current?.version ?? null,
      publish,
      eventId: form.eventId,
      images: form.photos,
      totalPhotos: total === "" ? null : Number(total),
      albumUrl: form.albumLink,
      slug: form.url.trim(),
    });
    setBusy(false);
    if (!result.ok) {
      fail(result);
      return;
    }
    setFieldErrors({});
    toast.show(publish ? "Album published" : "Draft saved");
    router.refresh();
    setPage(1);
    setView("list");
  };

  /* Uploads one image (preset "gallery") into tile `index` (or appends it). */
  const addPhoto = async (file: File, index = form.photos.length) => {
    if (index >= ALBUM_MAX_IMAGES) {
      toast.show(`At most ${ALBUM_MAX_IMAGES} images`);
      return;
    }
    const image = await upload.upload(file);
    const photo = image ? publicImage(image) : null;
    if (!photo) return;
    setForm((f) => {
      const photos = [...f.photos];
      photos.splice(index, index < photos.length ? 1 : 0, photo);
      return { ...f, photos };
    });
  };

  /* Red field + message for a server validation error. */
  const errorProps = (field: string) =>
    fieldErrors[field] ? { "aria-invalid": true, "aria-describedby": `album-${field}-error` } : {};
  const errorFor = (field: string) => (
    <FieldError id={`album-${field}-error`} message={fieldErrors[field]} />
  );

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
          aria-label={`Select ${r.event}`}
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
            {r.images.slice(0, 5).map((image, i) => (
              <span
                key={`${r.id}-${i}`}
                className={`admin-gallery-stack__item${
                  i === 4 ? " admin-gallery-stack__item--more" : ""
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- Storage thumbnail (WebP) */}
                <img className="admin-gallery-stack__img" src={image.thumbUrl} alt="" />
                {i === 4 && <span className="admin-gallery-stack__count">{r.photoCount}+</span>}
              </span>
            ))}
          </span>
          <div>
            <div className="admin-table__title">{r.event}</div>
            <div className="admin-table__sub">
              {r.status === "published" ? "Public" : "Draft"} · {ALBUM_PATH}
              {r.url}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "event",
      header: (
        <SortHeader
          label="Photos"
          active={sortKey === "total"}
          dir={sortDir}
          onClick={() => onSort("total")}
        />
      ),
      width: "26%",
      render: (r) => (
        <div className="admin-gallery-event">
          <div>
            <div className="admin-table__title">{r.photoCount} photos</div>
            <a
              className="admin-table__sub"
              href={r.albumLink}
              target="_blank"
              rel="noopener noreferrer"
            >
              Full album
            </a>
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
          <span className="admin-table__title">{formatInZone(r.modifiedAt, "UTC")} UTC</span>
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
                      onClick={() => deleteAlbum(r)}
                    >
                      <Icon name="trash" size={14} /> Delete Gallery
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

  const clearFilters = () => {
    setQuery("");
    setSearch("");
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
                value={form.eventId}
                onChange={(e) => setForm({ ...form, eventId: e.target.value })}
                {...errorProps("eventId")}
              >
                <option value="" disabled>
                  Select a published event...
                </option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title}
                  </option>
                ))}
              </select>
              {errorFor("eventId")}
            </div>

            {/* Total Photos/Videos */}
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="album-total">
                Total Photos/Videos
              </label>
              <input
                id="album-total"
                className="admin-input"
                type="text"
                inputMode="numeric"
                placeholder="e.g. 150"
                value={form.total}
                onChange={(e) => setForm({ ...form, total: e.target.value })}
                {...errorProps("totalPhotos")}
              />
              {errorFor("totalPhotos")}
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
                {...errorProps("albumUrl")}
              />
              {errorFor("albumUrl")}
            </div>

            {/* URL */}
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="album-url">
                URL
              </label>
              <div className="admin-field__row">
                <div className="admin-url-slug">
                  <span className="admin-url-slug__prefix" aria-label="Album URL prefix">
                    {ALBUM_PATH}
                  </span>
                  <input
                    id="album-url"
                    className="admin-url-slug__slug"
                    type="text"
                    aria-label="Album URL slug"
                    placeholder="the event's URL when empty"
                    value={form.url}
                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                    {...errorProps("slug")}
                  />
                </div>
              </div>
              {errorFor("slug")}
            </div>

            {/* Event Banner — the label sits above the photos, then the
                dropzone below the grid (matches the Edit Album design). */}
            <div className="admin-field admin-form-grid__full">
              <span className="admin-field__label">
                Featured Images * (1 to {ALBUM_MAX_IMAGES})
              </span>

              <PhotoGrid
                photos={form.photos}
                onPick={(index, file) => void addPhoto(file, index)}
                onRemove={(index) =>
                  setForm((f) => ({ ...f, photos: f.photos.filter((_, i) => i !== index) }))
                }
              />

              <div
                className="admin-dropzone"
                onClick={() => bannerInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) void addPhoto(file);
                }}
              >
                <Icon name="upload" size={34} />
                <span className="admin-dropzone__title">
                  {upload.busy ? "Uploading…" : "Drag & drop an image or click to browse"}
                </span>
                <span className="admin-card__subtitle">
                  Any image format • Converted to WebP • Max 5MB •{" "}
                  {ALBUM_MAX_IMAGES - form.photos.length} Remaining
                </span>
              </div>
              <input
                ref={bannerInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void addPhoto(file);
                  e.target.value = "";
                }}
              />
              <FieldError id="album-images-error" message={upload.error ?? fieldErrors["images"]} />
            </div>
          </div>

          {/* footer actions — spans the full grid (the line above reaches the
              card edges) and pushes Save draft/Publish to the far right. */}
          <div className="admin-form-actions admin-form-grid__full">
            <Button variant="outline" size="sm" icon="chevronLeft" onClick={() => setView("list")}>
              Back
            </Button>
            <div className="admin-form-actions__right">
              <Button
                variant="outline"
                size="sm"
                icon="cloud"
                disabled={busy || upload.busy}
                onClick={() => void save(false)}
              >
                Save draft
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || upload.busy}
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
          <h1 className="admin-page-header__title">Gallery</h1>
          <p className="admin-page-header__desc">
            Browse and manage all photo albums and galleries published on the public Gallery page.
          </p>
        </div>
        <div className="admin-page-header__actions">
          {canEdit ? (
            <Button
              variant="ghost"
              size="sm"
              icon="plus"
              className="admin-btn--events-add"
              onClick={() => toForm("create")}
            >
              Add New Album
            </Button>
          ) : null}
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
                  {canEdit ? (
                    <Button
                      variant="primary"
                      size="sm"
                      icon="plus"
                      onClick={() => toForm("create")}
                    >
                      Add New Album
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
            ? `Delete ${deleteConfirm.count} Album${deleteConfirm.count === 1 ? "" : "s"}?`
            : deleteConfirm
              ? `Delete the "${deleteConfirm.album.event}" album?`
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

/** 5×2 photo grid of the album form (10 tiles): pick a tile to upload or replace its image. */
function PhotoGrid({
  photos,
  onPick,
  onRemove,
}: {
  photos: readonly FeaturedImage[];
  onPick: (index: number, file: File) => void;
  onRemove: (index: number) => void;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  return (
    <div className="admin-gallery-grid">
      {Array.from({ length: ALBUM_MAX_IMAGES }, (_, i) => {
        const photo = photos[i];
        return (
          <div
            key={i}
            className={`admin-gallery-tile${photo ? " admin-gallery-tile--filled" : ""}`}
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
            {photo ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- Storage thumbnail (WebP) */}
                <img src={photo.thumbUrl} alt="" className="admin-gallery-tile__img" />
                <span className="admin-gallery-tile__status admin-gallery-tile__status--uploaded">
                  Uploaded
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  icon="x"
                  className="admin-gallery-tile__clear"
                  aria-label={`Remove photo ${i + 1}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(i);
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
                const file = e.target.files?.[0];
                if (file) onPick(Math.min(i, photos.length), file);
                e.target.value = "";
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
