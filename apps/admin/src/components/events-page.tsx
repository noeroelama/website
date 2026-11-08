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
import { formatInZone, timeAgo } from "@/components/format";
import { publicImage, useImageUpload } from "@/components/image-upload";
import { Button } from "@/components/ui/button";
import type { Column } from "@/components/ui/data-table";
import { EditableList } from "@/components/ui/editable-list";
import { FieldError } from "@/components/ui/field-error";
import { Icon } from "@/components/ui/icon";
import { PhotoDrop } from "@/components/ui/photo-drop";
import { ConfirmDialog, DELETE_HINT } from "@/components/ui/confirm-dialog";
import {
  ListCard,
  ListEmpty,
  MenuDivider,
  MenuItem,
  RowMenu,
  SearchBox,
  SelectCheckbox,
  Tabs,
  useBulkActions,
  useListTable,
  SortMenu,
} from "@/components/ui/list-controls";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import { EVENT_TYPE_LABELS, label } from "@/labels";
import { moveItem } from "./list-model";
import {
  countdownLabel,
  eventsCsv,
  matchesTab,
  type EventItem,
  type EventTab,
} from "./events-model";
import { Select } from "@/components/ui/select";
import { downloadCsv } from "@/components/csv";

const EVENT_PATH = "/events/";

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function typeInitials(type: string): string {
  return type.trim().slice(0, 2).toUpperCase() || "EV";
}

type SortKey = "title" | "date" | "status" | "registered";

const sortValue = (e: EventItem, key: SortKey): string =>
  key === "title"
    ? e.title.toLowerCase()
    : key === "date"
      ? e.startsAt
      : key === "status"
        ? e.status
        : e.modifiedAt;

const filterText = (e: EventItem, key: SortKey): string =>
  key === "title"
    ? e.title
    : key === "date"
      ? formatInZone(e.startsAt, e.timezone, false)
      : key === "status"
        ? e.status === "published"
          ? "Public"
          : "Private"
        : formatInZone(e.modifiedAt, "UTC", false);

const TABS = [
  { key: "all", label: "All" },
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
  { key: "drafts", label: "Drafts" },
] as const;

interface GuestSpeakerItem {
  photo: EventImage | null;
  name: string;
  description: string;
}

interface RundownItem {
  time: string;
  title: string;
  description: string;
}

interface SponsorItem {
  photo: EventImage | null;
  tip: string;
}

interface EventForm {
  title: string;
  type: EventType;
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

type DeleteConfirm = { kind: "one"; event: EventItem } | { kind: "many"; count: number };

interface EventsListProps {
  initial: EventItem[];
  canEdit: boolean;
  publicBase: string;
}

export function EventsPage(props: EventsListProps) {
  const pathname = usePathname();
  return <EventsList key={pathname} {...props} />;
}

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

function EventsList({ initial: events, canEdit, publicBase }: EventsListProps) {
  const toast = useToastMessage();
  const router = useRouter();
  const bannerUpload = useImageUpload("banner");
  const photoUpload = useImageUpload("speaker");
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});

  const [today] = useState(() => new Date().toISOString());
  const [tab, setTab] = useState<EventTab>("all");
  const [query, setQuery] = useState("");
  const [searchKey, setSearchKey] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null);

  const [view, setView] = useState<"list" | "form">("list");
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EventForm>(EMPTY_FORM);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter(
      (e) => matchesTab(e, tab, today) && (!q || e.title.toLowerCase().includes(q)),
    );
  }, [events, tab, today, query]);

  const counts = useMemo(
    () => ({
      all: events.length,
      upcoming: events.filter((e) => matchesTab(e, "upcoming", today)).length,
      past: events.filter((e) => matchesTab(e, "past", today)).length,
      drafts: events.filter((e) => e.status === "draft").length,
    }),
    [events, today],
  );

  const table = useListTable(filtered, sortValue, undefined, filterText);
  const { selected } = table;

  type Failure = Parameters<typeof actionMessage>[0];
  const fail = (result: Failure) => {
    setFieldErrors(result.fields ?? {});
    toast.show(actionMessage(result));
  };
  const bulk = useBulkActions({
    noun: "event",
    show: toast.show,
    onFailure: fail,
    onFinish: table.clearSelection,
  });
  const { busy, setBusy } = bulk;
  const eventsWith = (ids: readonly string[]) => events.filter((e) => ids.includes(e.id));

  const setPublishedFor = (ids: readonly string[], published: boolean) => {
    if (ids.length === 0) {
      toast.show("Select events first");
      return;
    }
    void bulk.run(
      eventsWith(ids),
      (e) => setEventPublishedAction({ id: e.id, version: e.version, published }),
      published ? "published" : "made private",
    );
  };

  const deleteSelected = () => {
    if (selected.size === 0) {
      toast.show("Select events to delete");
      return;
    }
    setDeleteConfirm({ kind: "many", count: selected.size });
  };

  const doDelete = () => {
    if (!deleteConfirm) return;
    const ids = deleteConfirm.kind === "one" ? [deleteConfirm.event.id] : Array.from(selected);
    setDeleteConfirm(null);
    void bulk.run(
      eventsWith(ids),
      (e) => removeEventAction({ id: e.id, version: e.version }),
      "deleted",
    );
  };

  const copyLink = (e: EventItem) => {
    void navigator.clipboard?.writeText(`${publicBase}${EVENT_PATH}${e.url}`);
    toast.show(`Link for "${e.title}" copied`);
  };

  const toForm = (mode: "create" | "edit", ev?: EventItem) => {
    setFormMode(mode);
    setEditingId(ev?.id ?? null);
    setFieldErrors({});
    setForm(ev ? formFrom(ev) : { ...EMPTY_FORM, timezone: browserZone() });
    setView("form");
  };

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
    if (publish) switchTab("all");
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

  const reorder = <K extends "guests" | "rundown" | "sponsors">(
    key: K,
    from: number,
    to: number,
  ) => {
    setForm((f) => ({ ...f, [key]: moveItem<EventForm[K][number]>(f[key], from, to) }));
  };

  const errorProps = (field: string) =>
    fieldErrors[field] ? { "aria-invalid": true, "aria-describedby": `event-${field}-error` } : {};
  const errorFor = (field: string) => (
    <FieldError id={`event-${field}-error`} message={fieldErrors[field]} />
  );

  const columns: Column<EventItem>[] = [
    {
      key: "check",
      width: "24px",
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
          label={`Select ${r.title}`}
          checked={selected.has(r.id)}
          onChange={() => table.toggle(r.id)}
        />
      ),
    },
    {
      key: "title",
      header: table.header("title", "Event"),
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
      header: table.header("date", "Event Date"),
      width: "14%",
      render: (r) => (
        <span className="admin-event-date">
          <span className="admin-event-date__line">
            <Icon name="calendar" size={13} className="admin-event-date__icon" />
            <span className="admin-table__title">
              {formatInZone(r.startsAt, r.timezone, false)}
            </span>
          </span>
          {countdown(r.startsAt)}
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
      header: table.header("status", "Status"),
      width: "12%",
      render: (r) => (
        <span className="admin-status-badge">
          <Icon name={r.status === "published" ? "globe" : "lock"} size={12} />
          {r.status === "published" ? "Public" : "Private"}
        </span>
      ),
    },
    {
      key: "registered",
      header: table.header("registered", "Last Modified"),
      width: "12%",
      render: (r) => (
        <span className="admin-event-meta">
          <span className="admin-table__title" title={`${formatInZone(r.modifiedAt, "UTC")} UTC`}>
            {timeAgo(r.modifiedAt)}
          </span>
          {r.author ? <span className="admin-table__sub">{r.author.name}</span> : null}
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
          <RowMenu>
            {canEdit ? (
              <>
                <MenuItem
                  icon="globeSimple"
                  className="admin-row-menu__item--wide"
                  disabled={busy || r.status === "published"}
                  onClick={() => setPublishedFor([r.id], true)}
                >
                  Publish
                </MenuItem>
                <MenuItem
                  icon="lock"
                  className="admin-row-menu__item--wide"
                  disabled={busy || r.status === "draft"}
                  onClick={() => setPublishedFor([r.id], false)}
                >
                  Make Private
                </MenuItem>
                <MenuItem
                  icon="lock"
                  className="admin-row-menu__item--phone"
                  disabled={busy}
                  onClick={() => setPublishedFor([r.id], r.status !== "published")}
                >
                  Visibility
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
                  onClick={() => setDeleteConfirm({ kind: "one", event: r })}
                >
                  Delete<span className="admin-long"> Event</span>
                </MenuItem>
              </>
            ) : null}
          </RowMenu>
        </div>
      ),
    },
  ];

  const switchTab = (next: EventTab) => {
    setTab(next);
    table.setPage(1);
    table.clearSelection();
  };

  const filterBy =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      table.setPage(1);
    };

  const deleteCount = deleteConfirm?.kind === "many" ? deleteConfirm.count : 1;
  const deleteLabel = deleteCount === 1 ? "Delete Event" : `Delete ${deleteCount} Events`;

  const countdown = (startsAt: string) => {
    const text = countdownLabel(startsAt, Date.parse(today));
    return text ? <span className="admin-event-date__count">{text}</span> : null;
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
              {formMode === "create" ? "Event > Create" : "Event > Edit"}
            </h1>
            <p className="admin-page-header__desc">
              {formMode === "create"
                ? "Fill in the details to create a new event, then publish it to the public site."
                : "Update event information."}
            </p>
          </div>
        </div>

        <form className="admin-dark-form" onSubmit={(event) => event.preventDefault()}>
          <div className="admin-form-grid">
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="event-title">
                Title *
              </label>
              <input
                id="event-title"
                required
                className="admin-input"
                type="text"
                placeholder="Event title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                {...errorProps("title")}
              />
              {errorFor("title")}
            </div>

            <div className="admin-field">
              <label className="admin-field__label" htmlFor="event-type">
                Event Type *
              </label>
              <Select
                id="event-type"
                required
                className="admin-select"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as EventType })}
              >
                {EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {label(EVENT_TYPE_LABELS, t)}
                  </option>
                ))}
              </Select>
              <FieldError id="event-type-error" message={fieldErrors["type"]} />
            </div>

            <div className="admin-field">
              <label className="admin-field__label" htmlFor="event-date">
                Event Date &amp; Time *
              </label>
              <input
                id="event-date"
                required
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

            <div className="admin-field">
              <label className="admin-field__label" htmlFor="event-location">
                Location *
              </label>
              <input
                id="event-location"
                required
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
                URL *
              </label>
              <div className="admin-field__row">
                <div className="admin-url-slug">
                  <span className="admin-url-slug__prefix" aria-label="Event URL prefix">
                    /events/
                  </span>
                  <input
                    id="event-url"
                    required
                    className="admin-url-slug__slug"
                    type="text"
                    aria-label="Event URL slug"
                    placeholder="simkongresppidkasiania2026"
                    value={form.url}
                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                    {...errorProps("slug")}
                  />
                </div>
              </div>
              {errorFor("slug")}
            </div>

            <div className="admin-field admin-form-grid__full">
              <label className="admin-field__label" htmlFor="event-desc">
                Description *
              </label>
              <textarea
                id="event-desc"
                required
                className="admin-input admin-textarea"
                rows={4}
                placeholder="Event description..."
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                {...errorProps("description")}
              />
              {errorFor("description")}
            </div>

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

            <div className="admin-field admin-form-grid__full">
              <span className="admin-field__label">Event Banner *</span>
              <div
                className="admin-dropzone"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) void onBannerFile(file);
                }}
              >
                <button
                  type="button"
                  className="admin-pick"
                  aria-label="Upload the event banner"
                  onClick={() => bannerInputRef.current?.click()}
                />
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
                      Name
                    </label>
                    <input
                      id={`guest-name-${i}`}
                      className="admin-input"
                      type="text"
                      placeholder="Speakers name"
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
                      Time *
                    </label>
                    <input
                      id={`rundown-time-${i}`}
                      required
                      className="admin-input admin-input--time"
                      type="time"
                      value={r.time}
                      onChange={(e) => updateRundown(i, { time: e.target.value })}
                    />
                    <FieldError id={`rundown-time-${i}-error`} />
                  </div>
                  <div className="admin-field">
                    <label className="admin-field__label" htmlFor={`rundown-title-${i}`}>
                      Title *
                    </label>
                    <input
                      id={`rundown-title-${i}`}
                      required
                      className="admin-input"
                      type="text"
                      placeholder="Rundown Title"
                      value={r.title}
                      onChange={(e) => updateRundown(i, { title: e.target.value })}
                    />
                    <FieldError id={`rundown-title-${i}-error`} />
                  </div>
                  <div className="admin-field">
                    <label className="admin-field__label" htmlFor={`rundown-desc-${i}`}>
                      Description
                    </label>
                    <input
                      id={`rundown-desc-${i}`}
                      className="admin-input"
                      type="text"
                      placeholder="Rundown description..."
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
                      Tooltip
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

          <FieldError id="event-photo-error" message={photoUpload.error} />
          {["timezone", "schedule", "speakers", "sponsors"].map((field) => (
            <FieldError key={field} id={`event-${field}-error`} message={fieldErrors[field]} />
          ))}
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
                disabled={busy || bannerUpload.busy || photoUpload.busy}
                onClick={() => save(false)}
              >
                Save draft
              </Button>
              <Button
                type="submit"
                variant="outline"
                size="sm"
                icon="globeSimple"
                disabled={busy || bannerUpload.busy || photoUpload.busy}
                onClick={() => save(true)}
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
          <h1 className="admin-page-header__title">Event</h1>
          <p className="admin-page-header__desc">
            Browse, search, and manage all upcoming and past events shown on the public Event page.
          </p>
        </div>
        <div className="admin-page-header__actions">
          <div className="admin-fab">
            <Button
              variant="outline"
              size="sm"
              icon="download"
              disabled={filtered.length === 0}
              onClick={() => downloadCsv("events", eventsCsv(filtered))}
            >
              Export CSV
            </Button>
            {canEdit ? (
              <Button variant="outline" size="sm" icon="plus" onClick={() => toForm("create")}>
                Add New Event
              </Button>
            ) : null}
          </div>
          <SortMenu columns={columns} />
          <SearchBox
            key={searchKey}
            placeholder="Search by title..."
            label="Search events"
            onSearch={filterBy(setQuery)}
          />
        </div>
      </div>

      <Tabs
        label="Event lists"
        tabs={TABS.map((t) => ({ ...t, count: counts[t.key] }))}
        active={tab}
        onSelect={switchTab}
      />

      <ListCard
        table={table}
        noun="event"
        columns={columns}
        empty={
          <ListEmpty
            noun="event"
            query={query}
            filters={table.filterCount}
            emptyHint="Add the first event."
            onClear={clearFilters}
            addLabel="Add New Event"
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
