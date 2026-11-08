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
import type { Column } from "@/components/ui/data-table";
import { FieldError } from "@/components/ui/field-error";
import { Icon } from "@/components/ui/icon";
import { ConfirmDialog, DELETE_HINT } from "@/components/ui/confirm-dialog";
import {
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
import { type AlbumEventOption, type AlbumItem } from "./gallery-model";
import { Select } from "@/components/ui/select";

const ALBUM_PATH = "/gallery/";

const STACK_SIZE = 4;

type SortKey = "title" | "date";

const sortValue = (a: AlbumItem, key: SortKey): string =>
  key === "title" ? a.event.toLowerCase() : a.modifiedAt;

const filterText = (a: AlbumItem, key: SortKey): string =>
  key === "title" ? a.event : formatInZone(a.modifiedAt, "UTC", false);

interface AlbumForm {
  eventId: string;
  total: string;
  albumLink: string;
  url: string;
  photos: FeaturedImage[];
}

const EMPTY_FORM: AlbumForm = { eventId: "", total: "", albumLink: "", url: "", photos: [] };

type DeleteConfirm = { kind: "one"; album: AlbumItem } | { kind: "many"; count: number };

interface GalleryListProps {
  initial: AlbumItem[];
  events: AlbumEventOption[];
  canEdit: boolean;
  publicBase: string;
}

export function GalleryPage(props: GalleryListProps) {
  const pathname = usePathname();

  return <GalleryList key={pathname} {...props} />;
}

function GalleryList({ initial: albums, events, canEdit, publicBase }: GalleryListProps) {
  const toast = useToastMessage();
  const router = useRouter();
  const upload = useImageUpload("gallery");
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});

  const [query, setQuery] = useState("");
  const [searchKey, setSearchKey] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null);

  const [view, setView] = useState<"list" | "form">("list");
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AlbumForm>(EMPTY_FORM);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return albums.filter(
      (a) => !q || [a.event, a.url, a.albumLink].join(" ").toLowerCase().includes(q),
    );
  }, [albums, query]);

  const table = useListTable(filtered, sortValue, undefined, filterText);
  const { selected } = table;

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

  const replacePhoto = async (file: File, index: number) => {
    const image = await upload.upload(file);
    const photo = image ? publicImage(image) : null;
    if (!photo) return;
    setForm((f) => ({ ...f, photos: f.photos.map((p, i) => (i === index ? photo : p)) }));
  };

  const addPhotos = async (files: FileList | null) => {
    const room = ALBUM_MAX_IMAGES - form.photos.length;
    const picked = Array.from(files ?? []);
    if (picked.length > room) toast.show(`At most ${ALBUM_MAX_IMAGES} images — adding ${room}`);
    for (const file of picked.slice(0, room)) {
      const image = await upload.upload(file);
      const photo = image ? publicImage(image) : null;
      if (!photo) return;
      setForm((f) => ({ ...f, photos: [...f.photos, photo] }));
    }
  };

  const errorProps = (field: string) =>
    fieldErrors[field] ? { "aria-invalid": true, "aria-describedby": `album-${field}-error` } : {};
  const errorFor = (field: string) => (
    <FieldError id={`album-${field}-error`} message={fieldErrors[field]} />
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
      header: table.header("title", "Gallery"),
      width: "38%",
      render: (r) => {
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
      header: table.header("date", "Last Modified"),
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
                <MenuItem
                  icon="globeSimple"
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

  const deleteCount = deleteConfirm?.kind === "many" ? deleteConfirm.count : 1;
  const deleteLabel = deleteCount === 1 ? "Delete Album" : `Delete ${deleteCount} Albums`;

  const filterBy =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      table.setPage(1);
    };

  const clearFilters = () => {
    setQuery("");
    setSearchKey((k) => k + 1);
    table.clearFilters();
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

        <form className="admin-dark-form" onSubmit={(event) => event.preventDefault()}>
          <div className="admin-form-grid">
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
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    void addPhotos(e.dataTransfer.files);
                  }}
                >
                  <button
                    type="button"
                    className="admin-pick"
                    aria-label="Upload banner images"
                    onClick={() => bannerInputRef.current?.click()}
                  />
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

          <div className="admin-form-actions admin-form-grid__full">
            <Button variant="outline" size="sm" icon="chevronLeft" onClick={() => setView("list")}>
              Back
            </Button>
            <div className="admin-form-actions__right">
              <Button
                type="submit"
                formNoValidate
                variant="outline"
                size="sm"
                icon="cloud"
                disabled={busy || upload.busy}
                onClick={() => save(false)}
              >
                Save draft
              </Button>
              <Button
                type="submit"
                variant="outline"
                size="sm"
                disabled={busy || upload.busy}
                onClick={() => save(true)}

                icon="globeSimple"
              >
                Publish
              </Button>
            </div>
          </div>
        </form>

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
        noun="album"
        columns={columns}
        empty={
          <ListEmpty
            noun="album"
            query={query}
            filters={table.filterCount}
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
                icon="globeSimple"
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
        <div key={`${photo.path}-${i}`} className="admin-gallery-tile">
          <button
            type="button"
            className="admin-pick"
            aria-label={`Replace banner image ${i + 1}`}
            onClick={() => refs.current[i]?.click()}
          />
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
