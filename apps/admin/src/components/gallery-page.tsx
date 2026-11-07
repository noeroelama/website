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
import { Button } from "@/components/ui/button";
import { SortHeader, type Column } from "@/components/ui/data-table";
import { FieldError } from "@/components/ui/field-error";
import { Icon } from "@/components/ui/icon";
import { ConfirmDialog, DELETE_HINT } from "@/components/ui/confirm-dialog";
import {
  FiltersButton,
  ListCard,
  ListEmpty,
  MenuDivider,
  MenuItem,
  RowMenu,
  SearchBox,
  SelectCheckbox,
  useBulkActions,
  useListTable,
  SortMenu,
} from "@/components/ui/list-controls";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import { matchesDate, type DateFilter } from "./list-model";
import { type AlbumEventOption, type AlbumItem, type AlbumStatus } from "./gallery-model";
import { Select } from "@/components/ui/select";

/* ==================================================================
   Gallery — album list (search, filters, bulk actions) + create/edit
   form. Matches the Figma "GALLERY ADMIN" screens (dark page).

   The dark table / form rules are shared by every admin page (globals.css
   "Dark admin pages").
   The header reuses the `.admin-events-header` controls (cream Add /
   Filters buttons, outlined search). Colours come from the shared design
   tokens, no hex values outside globals.css.
   ================================================================== */

/** Public album path on the web app (apps/web /gallery/[slug]). */
const ALBUM_PATH = "/gallery/";

/** Thumbnails shown per row before the "N+" tile. */
const STACK_SIZE = 4;

/** Sortable album-table columns (checkbox and actions are never sorted). */
type SortKey = "title" | "date";

const sortValue = (a: AlbumItem, key: SortKey): string =>
  key === "title" ? a.event.toLowerCase() : a.modifiedAt;

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
  /* Server validation messages per field (GuardedResult `fields`). */
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});

  /* ---- list state (sorting, paging and selection: useListTable) ---- */
  const [query, setQuery] = useState(""); // applied on Search / Enter
  const [searchKey, setSearchKey] = useState(0); // a new key empties the search box
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null);

  /* ---- form view state ---- */
  const [view, setView] = useState<"list" | "form">("list");
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AlbumForm>(EMPTY_FORM);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const activeFilterCount = (statusFilter !== "all" ? 1 : 0) + (dateFilter !== "all" ? 1 : 0);

  /* ---- derived rows ---- */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return albums.filter(
      (a) =>
        (statusFilter === "all" || a.status === statusFilter) &&
        matchesDate(a.modifiedAt, dateFilter, today) &&
        (!q || [a.event, a.url, a.albumLink].join(" ").toLowerCase().includes(q)),
    );
  }, [albums, query, today, statusFilter, dateFilter]);

  const table = useListTable(filtered, sortValue);
  const { selected } = table;

  /* ---- row / bulk mutations (server actions; the page re-reads after each) ---- */
  type Failure = Parameters<typeof actionMessage>[0];
  const fail = (result: Failure) => {
    setFieldErrors(result.fields ?? {});
    toast.show(actionMessage(result));
  };
  const bulk = useBulkActions({
    noun: "album",
    show: toast.show,
    onFailure: fail,
    onFinish: table.clearSelection,
  });
  const { busy, setBusy } = bulk;
  const albumsWith = (ids: readonly string[]) => albums.filter((a) => ids.includes(a.id));

  const setPublishedFor = (ids: readonly string[], published: boolean) => {
    if (ids.length === 0) {
      toast.show("Select albums first");
      return;
    }
    void bulk.run(
      albumsWith(ids),
      (a) => setAlbumPublishedAction({ id: a.id, version: a.version, published }),
      published ? "published" : "made private",
    );
  };

  const deleteSelected = () => {
    if (selected.size === 0) {
      toast.show("Select albums to delete");
      return;
    }
    setDeleteConfirm({ kind: "many", count: selected.size });
  };

  /* Deletes are confirmed in the popup first. Soft delete: the images stay in Storage. */
  const doDelete = () => {
    if (!deleteConfirm) return;
    const ids = deleteConfirm.kind === "one" ? [deleteConfirm.album.id] : Array.from(selected);
    setDeleteConfirm(null);
    void bulk.run(
      albumsWith(ids),
      (a) => removeAlbumAction({ id: a.id, version: a.version }),
      "deleted",
    );
  };

  const copyLink = (a: AlbumItem) => {
    void navigator.clipboard?.writeText(`${publicBase}${ALBUM_PATH}${a.url}`);
    toast.show(`Link for "${a.event}" copied`);
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
        : EMPTY_FORM,
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
    table.setPage(1);
    setView("list");
  };

  /* Uploads one image (preset "gallery") in place of tile `index`. */
  const replacePhoto = async (file: File, index: number) => {
    const image = await upload.upload(file);
    const photo = image ? publicImage(image) : null;
    if (!photo) return;
    setForm((f) => ({ ...f, photos: f.photos.map((p, i) => (i === index ? photo : p)) }));
  };

  /* Uploads the picked or dropped images one by one and appends them (only as many as fit). */
  const addPhotos = async (files: FileList | null) => {
    const room = ALBUM_MAX_IMAGES - form.photos.length;
    const picked = Array.from(files ?? []);
    if (picked.length > room) toast.show(`At most ${ALBUM_MAX_IMAGES} images — adding ${room}`);
    for (const file of picked.slice(0, room)) {
      const image = await upload.upload(file);
      const photo = image ? publicImage(image) : null;
      if (!photo) return; // stop so the upload error stays on screen
      setForm((f) => ({ ...f, photos: [...f.photos, photo] }));
    }
  };

  /* Red field + message for a server validation error. */
  const errorProps = (field: string) =>
    fieldErrors[field] ? { "aria-invalid": true, "aria-describedby": `album-${field}-error` } : {};
  const errorFor = (field: string) => (
    <FieldError id={`album-${field}-error`} message={fieldErrors[field]} />
  );

  /* ---- table columns ---- */
  const sortHeader = (key: SortKey, text: string) => (
    <SortHeader
      label={text}
      active={table.sort.key === key}
      dir={table.sort.dir}
      onClick={() => table.onSort(key)}
    />
  );

  const checkboxCol: Column<AlbumItem> = {
    key: "check",
    width: "4%",
    align: "left",
    header: (
      <SelectCheckbox
        label="Select all on page"
        checked={table.pageAll}
        indeterminate={table.pageSome && !table.pageAll}
        onChange={table.togglePage}
      />
    ),
    render: (r) => (
      <SelectCheckbox
        label={`Select ${r.event}`}
        checked={selected.has(r.id)}
        onChange={() => table.toggle(r.id)}
      />
    ),
  };

  const columns: Column<AlbumItem>[] = [
    checkboxCol,
    {
      key: "title",
      header: sortHeader("title", "Gallery"),
      width: "38%",
      render: (r) => {
        /* Four thumbnails, then a dark tile counting the photos not shown ("48+"). */
        const thumbs = r.images.slice(0, STACK_SIZE);
        const more = r.photoCount - thumbs.length;
        return (
          <div className="admin-gallery-album">
            <span className="admin-gallery-stack" aria-hidden="true">
              {thumbs.map((image, i) => (
                // eslint-disable-next-line @next/next/no-img-element -- Storage thumbnail (WebP)
                <img
                  key={`${r.id}-${i}`}
                  className="admin-gallery-stack__img"
                  src={image.thumbUrl}
                  alt=""
                />
              ))}
              {more > 0 ? <span className="admin-gallery-stack__more">{more}+</span> : null}
            </span>
            <div>
              <div className="admin-table__title">{r.event}</div>
              <div className="admin-table__sub">{r.eventType}</div>
            </div>
          </div>
        );
      },
    },
    {
      key: "author",
      header: "Author",
      width: "30%",
      render: (r) =>
        r.author ? (
          <div className="admin-gallery-author">
            <span className="admin-gallery-author__avatar" aria-hidden="true">
              {r.author.initials}
            </span>
            <div>
              <div className="admin-table__title">{r.author.name}</div>
              <div className="admin-table__sub">{r.author.email}</div>
            </div>
          </div>
        ) : (
          <span className="admin-table__sub">—</span>
        ),
    },
    {
      key: "date",
      header: sortHeader("date", "Last Modified"),
      width: "20%",
      render: (r) => (
        <span className="admin-gallery-meta">
          <span className="admin-table__title" title="UTC">
            {formatInZone(r.modifiedAt, "UTC")}
          </span>
          <span className="admin-table__sub">{timeAgo(r.modifiedAt)}</span>
        </span>
      ),
    },
    {
      key: "aksi",
      header: "",
      align: "right",
      width: "8%",
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
          <RowMenu>
            {canEdit ? (
              <>
                {/* Both always listed (as in the design); the current state is disabled. */}
                <MenuItem
                  icon="globe"
                  disabled={busy || r.status === "published"}
                  onClick={() => setPublishedFor([r.id], true)}
                >
                  Publish
                </MenuItem>
                <MenuItem
                  icon="lock"
                  disabled={busy || r.status === "draft"}
                  onClick={() => setPublishedFor([r.id], false)}
                >
                  Make Private
                </MenuItem>
              </>
            ) : null}
            <MenuItem icon="copy" onClick={() => copyLink(r)}>
              Copy<span className="admin-long"> Link</span>
            </MenuItem>
            {canEdit ? (
              <>
                <MenuDivider />
                <MenuItem
                  icon="trash"
                  danger
                  onClick={() => setDeleteConfirm({ kind: "one", album: r })}
                >
                  Delete<span className="admin-long"> Gallery</span>
                </MenuItem>
              </>
            ) : null}
          </RowMenu>
        </div>
      ),
    },
  ];

  /* "Delete 10 Albums" / "Delete Album": the delete modal's title (+ "?") and its button. */
  const deleteCount = deleteConfirm?.kind === "many" ? deleteConfirm.count : 1;
  const deleteLabel = deleteCount === 1 ? "Delete Album" : `Delete ${deleteCount} Albums`;

  /* A changed filter starts again at page 1. */
  const filterBy =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      table.setPage(1);
    };

  const clearFilters = () => {
    setQuery("");
    setSearchKey((k) => k + 1);
    setStatusFilter("all");
    setDateFilter("all");
    setFiltersOpen(false);
    table.setPage(1);
  };

  if (view === "form") {
    return (
      <div>
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

        <div className="admin-dark-form">
          <div className="admin-form-grid">
            {/* Event */}
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="album-event">
                Event *
              </label>
              <Select
                id="album-event"
                required
                className="admin-select"
                value={form.eventId}
                onChange={(e) => setForm({ ...form, eventId: e.target.value })}
                {...errorProps("eventId")}
              >
                <option value="" disabled>
                  Select an event...
                </option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title}
                  </option>
                ))}
              </Select>
              {errorFor("eventId")}
            </div>

            {/* Total Photos/Videos */}
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="album-total">
                Total Photos/Videos *
              </label>
              <input
                id="album-total"
                required
                pattern="[0-9]+"
                title="A whole number, e.g. 150"
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
                required
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

            <div className="admin-field admin-form-grid__full">
              <span className="admin-field__label">Photos *</span>

              <PhotoGrid
                photos={form.photos}
                onPick={(index, file) => void replacePhoto(file, index)}
                onRemove={(index) =>
                  setForm((f) => ({ ...f, photos: f.photos.filter((_, i) => i !== index) }))
                }
              />

              {form.photos.length < ALBUM_MAX_IMAGES ? (
                <div
                  className="admin-dropzone"
                  role="button"
                  tabIndex={0}
                  aria-label="Upload banner images"
                  onClick={() => bannerInputRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      bannerInputRef.current?.click();
                    }
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    void addPhotos(e.dataTransfer.files);
                  }}
                >
                  <Icon name="upload" size={34} />
                  <span className="admin-dropzone__title">
                    {upload.busy ? "Uploading…" : "Drag & drop banner images or click to browse"}
                  </span>
                  <span className="admin-card__subtitle">
                    Any image format • Converted to WebP • Max 5MB •{" "}
                    {ALBUM_MAX_IMAGES - form.photos.length} Remaining
                  </span>
                </div>
              ) : null}
              <input
                ref={bannerInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: "none" }}
                onChange={(e) => {
                  void addPhotos(e.target.files);
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
      </div>
    );
  }

  return (
    <div>
      <div className="admin-page-header admin-events-header">
        <div>
          <h1 className="admin-page-header__title">Gallery</h1>
          <p className="admin-page-header__desc">
            Browse and manage all photo albums and galleries published on the public Gallery page.
          </p>
        </div>
        <div className="admin-page-header__actions">
          <div className="admin-fab">
            {canEdit ? (
              <Button variant="outline" size="sm" icon="plus" onClick={() => toForm("create")}>
                Add New Album
              </Button>
            ) : null}
          </div>
          <FiltersButton
            count={activeFilterCount}
            open={filtersOpen}
            onToggle={() => setFiltersOpen((v) => !v)}
          />
          <SortMenu columns={columns} />
          <SearchBox
            key={searchKey}
            placeholder="Search by title..."
            label="Search albums"
            onSearch={filterBy(setQuery)}
          />
        </div>
      </div>

      <ListCard
        table={table}
        total={filtered.length}
        noun="album"
        columns={columns}
        filters={
          filtersOpen ? (
            <div className="admin-filter-panel">
              <div className="admin-field">
                <span className="admin-field__label">Status</span>
                <Select
                  className="admin-select"
                  value={statusFilter}
                  onChange={(e) => filterBy(setStatusFilter)(e.target.value as StatusFilter)}
                >
                  <option value="all">All statuses</option>
                  <option value="published">Public</option>
                  <option value="draft">Draft</option>
                </Select>
              </div>
              <div className="admin-field">
                <span className="admin-field__label">Last Modified</span>
                <Select
                  className="admin-select"
                  value={dateFilter}
                  onChange={(e) => filterBy(setDateFilter)(e.target.value as DateFilter)}
                >
                  <option value="all">All dates</option>
                  <option value="today">Today</option>
                  <option value="month">This month</option>
                  <option value="year">This year</option>
                  <option value="past">Before today</option>
                </Select>
              </div>
              <button type="button" className="admin-filter-panel__clear" onClick={clearFilters}>
                <Icon name="x" size={12} />
                Clear filters
              </button>
            </div>
          ) : null
        }
        empty={
          <ListEmpty
            noun="album"
            query={query}
            filters={activeFilterCount}
            emptyHint="Add the first album of a published event."
            onClear={clearFilters}
            addLabel="Add New Album"
            onAdd={canEdit ? () => toForm("create") : null}
          />
        }
        bulkActions={
          canEdit ? (
            <>
              <Button
                variant="primary"
                size="sm"
                icon="globe"
                disabled={busy}
                onClick={() => setPublishedFor(Array.from(selected), true)}
              >
                Publish
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon="lock"
                disabled={busy}
                onClick={() => setPublishedFor(Array.from(selected), false)}
              >
                Make private
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
          ) : null
        }
      />

      <ConfirmDialog
        open={deleteConfirm !== null}
        title={`${deleteLabel}?`}
        confirmLabel={deleteLabel}
        icon="trash"
        onConfirm={doDelete}
        onCancel={() => setDeleteConfirm(null)}
      >
        {DELETE_HINT}
      </ConfirmDialog>

      <ToastBanner message={toast.message} />
    </div>
  );
}

/** Uploaded banner images, five per row with a red remove button; click an image to replace it. */
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
  if (photos.length === 0) return null;

  return (
    <div className="admin-gallery-grid">
      {photos.map((photo, i) => (
        <div
          key={`${photo.path}-${i}`}
          className="admin-gallery-tile"
          role="button"
          tabIndex={0}
          aria-label={`Replace banner image ${i + 1}`}
          onClick={() => refs.current[i]?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              refs.current[i]?.click();
            }
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- Storage thumbnail (WebP) */}
          <img src={photo.thumbUrl} alt="" className="admin-gallery-tile__img" />
          <button
            type="button"
            className="admin-gallery-tile__clear"
            aria-label={`Remove banner image ${i + 1}`}
            onClick={(e) => {
              e.stopPropagation();
              onRemove(i);
            }}
          >
            <Icon name="x" size={14} />
          </button>
          <input
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onPick(i, file);
              e.target.value = "";
            }}
          />
        </div>
      ))}
    </div>
  );
}
