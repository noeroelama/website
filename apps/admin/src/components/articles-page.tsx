"use client";

/* eslint-disable @next/next/no-img-element */

import { useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  NEWS_CATEGORIES,
  slugify,
  type FeaturedImage,
  type NewsCategory,
} from "@website/domain/content";
import {
  removeNewsAction,
  saveNewsAction,
  setNewsPublishedAction,
} from "@/app/(panel)/articles/actions";
import { actionMessage } from "@/components/action-message";
import { formatInZone, formatUtc, timeAgo } from "@/components/format";
import { publicImage, useImageUpload } from "@/components/image-upload";
import { UploadBar } from "@/components/ui/upload-bar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, DELETE_HINT } from "@/components/ui/confirm-dialog";
import type { Column } from "@/components/ui/data-table";
import { FieldError } from "@/components/ui/field-error";
import { Icon } from "@/components/ui/icon";
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
import { Modal } from "@/components/ui/modal";
import {
  joinBlocks,
  newBlock,
  splitBlocks,
  RichTextStack,
  type RichTextBlock,
} from "@/components/ui/rich-text-box";
import { Select } from "@/components/ui/select";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import { label, NEWS_CATEGORY_LABELS } from "@/labels";
import {
  matchesArticleTab,
  needsSettings,
  type ArticleItem,
  type ArticleTab,
} from "./articles-model";

const ARTICLE_PATH = "/news/";

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

type SortKey = "title" | "status" | "date";

const sortValue = (a: ArticleItem, key: SortKey): string =>
  key === "title" ? a.title.toLowerCase() : key === "status" ? a.status : a.modifiedAt;

const filterText = (a: ArticleItem, key: SortKey): string =>
  key === "title"
    ? a.title
    : key === "status"
      ? a.status === "published"
        ? "Public"
        : a.status === "scheduled"
          ? "Scheduled"
          : "Private"
      : formatInZone(a.modifiedAt, "UTC", false);

const TABS = [
  { key: "all", label: "All" },
  { key: "published", label: "Published" },
  { key: "drafts", label: "Drafts" },
] as const;

interface ArticleForm {
  title: string;
  author: string;
  category: NewsCategory;
  url: string;
  excerpt: string;
  banner: FeaturedImage | null;
  date: string;
  tags: string[];
  bodies: RichTextBlock[];
}

const EMPTY_FORM: ArticleForm = {
  title: "",
  author: "",
  category: NEWS_CATEGORIES[0],
  url: "",
  excerpt: "",
  banner: null,
  date: "",
  tags: [],
  bodies: [newBlock()],
};

type DeleteConfirm = { kind: "one"; article: ArticleItem } | { kind: "many"; count: number };

type SaveIntent = "draft" | "publish";

interface ArticleListProps {
  initial: ArticleItem[];
  canEdit: boolean;
  canPublish: boolean;
  publicBase: string;
  defaultAuthor: string;
}

function formFrom(a: ArticleItem): ArticleForm {
  return {
    title: a.title,
    author: a.author,
    category: a.categoryKey,
    url: a.url,
    excerpt: a.excerpt,
    banner: a.featuredImage,
    date: toLocalInput(a.publishAt),
    tags: a.tags,
    bodies: splitBlocks(a.body),
  };
}

function ArticleList({
  initial: articles,
  canEdit,
  canPublish,
  publicBase,
  defaultAuthor,
}: ArticleListProps) {
  const toast = useToastMessage();
  const router = useRouter();
  const uploader = useImageUpload("thumbnail");
  // Images inside the text: their own upload bar under the editor.
  const inlineUploader = useImageUpload("thumbnail");
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});

  const [tab, setTab] = useState<ArticleTab>("all");
  const [query, setQuery] = useState("");
  const [searchKey, setSearchKey] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null);
  const [settingsIntent, setSettingsIntent] = useState<SaveIntent | null>(null);

  const [view, setView] = useState<"list" | "form">("list");
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ArticleForm>(EMPTY_FORM);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return articles.filter(
      (a) => matchesArticleTab(a, tab) && (!q || a.title.toLowerCase().includes(q)),
    );
  }, [articles, tab, query]);

  const counts = useMemo(
    () => ({
      all: articles.length,
      published: articles.filter((a) => a.status !== "draft").length,
      drafts: articles.filter((a) => a.status === "draft").length,
    }),
    [articles],
  );

  const table = useListTable(filtered, sortValue, undefined, filterText);
  const { selected } = table;

  type Failure = Parameters<typeof actionMessage>[0];
  const fail = (result: Failure) => {
    setFieldErrors(result.fields ?? {});
    toast.show(actionMessage(result));
  };
  const bulk = useBulkActions({
    noun: "article",
    show: toast.show,
    onFailure: fail,
    onFinish: table.clearSelection,
  });
  const { busy, setBusy } = bulk;
  const articlesWith = (ids: readonly string[]) => articles.filter((a) => ids.includes(a.id));

  const setPublishedFor = (ids: readonly string[], published: boolean) => {
    if (ids.length === 0) {
      toast.show("Select articles first");
      return;
    }
    void bulk.run(
      articlesWith(ids),
      (a) => setNewsPublishedAction({ id: a.id, version: a.version, published }),
      published ? "published" : "made private",
    );
  };

  const deleteSelected = () => {
    if (selected.size === 0) {
      toast.show("Select articles to delete");
      return;
    }
    setDeleteConfirm({ kind: "many", count: selected.size });
  };

  const doDelete = () => {
    if (!deleteConfirm) return;
    const ids = deleteConfirm.kind === "one" ? [deleteConfirm.article.id] : Array.from(selected);
    setDeleteConfirm(null);
    void bulk.run(
      articlesWith(ids),
      (a) => removeNewsAction({ id: a.id, version: a.version }),
      "deleted",
    );
  };

  const copyLink = (a: ArticleItem) => {
    void navigator.clipboard?.writeText(`${publicBase}${ARTICLE_PATH}${a.url}`);
    toast.show(`Link for "${a.title}" copied`);
  };

  const openPreview = (id: string | null) => {
    if (!id) {
      toast.show("Save the draft first, then preview it");
      return;
    }
    window.open(`/articles/${id}/preview`, "_blank", "noopener");
  };

  const toForm = (mode: "create" | "edit", a?: ArticleItem) => {
    setFormMode(mode);
    setEditingId(a?.id ?? null);
    setFieldErrors({});
    setForm(a ? formFrom(a) : { ...EMPTY_FORM, author: defaultAuthor });
    setView("form");
  };

  const closeSettings = () => {
    setSettingsIntent(null);
    setTagInput("");
    if (view === "list") setEditingId(null);
  };

  const save = async (intent: SaveIntent) => {
    const current = articles.find((a) => a.id === editingId);
    setBusy(true);
    const result = await saveNewsAction({
      ...(editingId ? { id: editingId } : {}),
      version: current?.version ?? null,
      intent,
      title: form.title,
      slug: form.url.trim(),
      author: form.author,
      category: form.category,
      publishAt: form.date ? new Date(form.date).toISOString() : null,
      summary: form.excerpt,
      tags: form.tags,
      body: joinBlocks(form.bodies),
      featuredImage: form.banner,
    });
    setBusy(false);
    if (!result.ok) {
      fail(result);
      if (result.fields && needsSettings(result.fields)) setSettingsIntent(intent);
      return;
    }
    setFieldErrors({});
    toast.show(
      result.data.status === "scheduled"
        ? "Article scheduled"
        : intent === "draft"
          ? "Draft saved"
          : current?.status === "draft" || !current
            ? "Article published"
            : "Article saved",
    );
    setSettingsIntent(null);
    setTagInput("");
    setEditingId(null);
    if (view === "form") {
      setTab("all");
      table.setPage(1);
      table.clearSelection();
      setView("list");
    }
    router.refresh();
  };

  const openSettings = (a: ArticleItem) => {
    setEditingId(a.id);
    setFieldErrors({});
    setForm(formFrom(a));
    setSettingsIntent(a.status === "draft" ? "draft" : "publish");
  };

  const [tagInput, setTagInput] = useState("");
  const addTags = () => {
    const typed = tagInput
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (typed.length > 0) setForm((f) => ({ ...f, tags: [...new Set([...f.tags, ...typed])] }));
    setTagInput("");
  };
  const removeTag = (t: string) => setForm((f) => ({ ...f, tags: f.tags.filter((x) => x !== t) }));

  const setTitle = (title: string) =>
    setForm((f) => ({
      ...f,
      title,
      url: f.url === "" || f.url === slugify(f.title) ? slugify(title) : f.url,
    }));

  const onBannerFile = async (file: File) => {
    const image = await uploader.upload(file);
    const banner = image ? publicImage(image) : null;
    if (banner) setForm((f) => ({ ...f, banner }));
  };
  const uploadInlineImage = async (file: File) => (await inlineUploader.upload(file))?.url ?? null;

  const errorProps = (field: string, id: string) =>
    fieldErrors[field] ? { "aria-invalid": true, "aria-describedby": `${id}-error` } : {};

  const checkboxCol: Column<ArticleItem> = {
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
  };

  const columns: Column<ArticleItem>[] = [
    checkboxCol,
    {
      key: "title",
      header: table.header("title", "Article"),
      width: "34%",
      render: (r) => (
        <div className="admin-event-title">
          <span className="admin-article-thumb" aria-hidden="true">
            {r.image ? <img className="admin-article-thumb__img" src={r.image} alt="" /> : null}
          </span>
          <div>
            <div className="admin-table__title">{r.title}</div>
            <div className="admin-table__sub">{r.category}</div>
          </div>
        </div>
      ),
    },
    {
      key: "author",
      header: "Author",
      width: "26%",
      render: (r) =>
        r.byline ? (
          <div className="admin-gallery-author">
            <span className="admin-gallery-author__avatar" aria-hidden="true">
              {r.byline.initials}
            </span>
            <span className="admin-table__title" title={r.author}>
              {r.byline.name}
            </span>
          </div>
        ) : null,
    },
    {
      key: "status",
      header: table.header("status", "Status"),
      width: "12%",
      render: (r) =>
        r.status === "scheduled" && r.publishAt ? (
          <span
            className="admin-status-badge"
            title={`Goes public ${formatUtc(new Date(r.publishAt))} UTC`}
          >
            <Icon name="clock" size={12} />
            Scheduled
          </span>
        ) : (
          <span className="admin-status-badge">
            <Icon name={r.status === "published" ? "globe" : "lock"} size={12} />
            {r.status === "published" ? "Public" : "Private"}
          </span>
        ),
    },
    {
      key: "date",
      header: table.header("date", "Last Modified"),
      width: "16%",
      render: (r) => (
        <span className="admin-event-meta">
          <span className="admin-table__title" title={`${formatUtc(new Date(r.modifiedAt))} UTC`}>
            {timeAgo(r.modifiedAt)}
          </span>
          {r.editor ? <span className="admin-table__sub">{r.editor.name}</span> : null}
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
              aria-label={`Edit ${r.title}`}
              onClick={() => toForm("edit", r)}
              title="Edit"
            />
          ) : null}
          <RowMenu>
            {canPublish ? (
              <MenuItem
                icon={r.status === "draft" ? "globeSimple" : "lock"}
                disabled={busy}
                onClick={() => setPublishedFor([r.id], r.status === "draft")}
              >
                {r.status === "draft" ? "Publish" : "Make Private"}
              </MenuItem>
            ) : null}
            <MenuItem icon="copy" onClick={() => copyLink(r)}>
              Copy<span className="admin-long"> Link</span>
            </MenuItem>
            {canEdit ? (
              <>
                <MenuItem icon="settings" onClick={() => openSettings(r)}>
                  Settings
                </MenuItem>
                <MenuDivider />
                <MenuItem
                  icon="trash"
                  danger
                  onClick={() => setDeleteConfirm({ kind: "one", article: r })}
                >
                  Delete<span className="admin-long"> Article</span>
                </MenuItem>
              </>
            ) : null}
          </RowMenu>
        </div>
      ),
    },
  ];

  const deleteCount = deleteConfirm?.kind === "many" ? deleteConfirm.count : 1;
  const deleteLabel = deleteCount === 1 ? "Delete Article" : `Delete ${deleteCount} Articles`;

  const switchTab = (next: ArticleTab) => {
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

  const clearFilters = () => {
    setQuery("");
    setSearchKey((k) => k + 1);
    table.clearFilters();
    table.setPage(1);
  };

  const settingsPanel = (
    <Modal
      asForm
      open={settingsIntent !== null}
      title="Settings"
      onClose={closeSettings}
      footer={
        <div className="admin-modal__footer-row">
          <Button variant="outline" icon="chevronLeft" onClick={closeSettings}>
            Back
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon="cloud"
            disabled={busy || settingsIntent === null}
            onClick={() => settingsIntent && void save(settingsIntent)}
          >
            Save
          </Button>
        </div>
      }
    >
      <div className="admin-form-grid">
        <div className="admin-field admin-form-grid__full">
          <label className="admin-field__label" htmlFor="article-title">
            Title *
          </label>
          <input
            id="article-title"
            required
            minLength={3}
            maxLength={200}
            className="admin-input"
            type="text"
            placeholder="Article title"
            value={form.title}
            onChange={(e) => setTitle(e.target.value)}
            {...errorProps("title", "article-title")}
          />
          <FieldError id="article-title-error" message={fieldErrors["title"]} />
        </div>

        <div className="admin-field">
          <label className="admin-field__label" htmlFor="article-category">
            Category *
          </label>
          <Select
            id="article-category"
            required
            className="admin-select"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value as NewsCategory })}
            {...errorProps("category", "article-category")}
          >
            {NEWS_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {label(NEWS_CATEGORY_LABELS, c)}
              </option>
            ))}
          </Select>
          <FieldError id="article-category-error" message={fieldErrors["category"]} />
        </div>
        <div className="admin-field">
          <label className="admin-field__label" htmlFor="article-date">
            Publish Date &amp; Time *
          </label>
          <input
            id="article-date"
            required
            className="admin-input"
            type="datetime-local"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            {...errorProps("publishAt", "article-date")}
          />
          <FieldError
            id="article-date-error"
            message={fieldErrors["publishAt"]}
            hint="Your time zone. A future date schedules it."
          />
        </div>

        <div className="admin-field admin-form-grid__full">
          <label className="admin-field__label" htmlFor="article-url">
            URL *
          </label>
          <div className="admin-field__row">
            <div className="admin-url-slug">
              <span className="admin-url-slug__prefix" aria-hidden="true">
                {ARTICLE_PATH}
              </span>
              <input
                id="article-url"
                required
                maxLength={120}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                title="Lower-case letters, numbers and dashes"
                className="admin-url-slug__slug"
                type="text"
                placeholder="simposium-ppidk-asia-oseania-2026"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                {...errorProps("slug", "article-url")}
              />
            </div>
          </div>
          <FieldError id="article-url-error" message={fieldErrors["slug"]} />
        </div>

        <div className="admin-field admin-form-grid__full">
          <label className="admin-field__label" htmlFor="article-summary">
            Short Summary *
          </label>
          <textarea
            id="article-summary"
            required
            className="admin-input admin-textarea"
            rows={5}
            maxLength={500}
            placeholder="Concise summary for cards and previews"
            value={form.excerpt}
            onChange={(e) => setForm({ ...form, excerpt: e.target.value })}
            {...errorProps("summary", "article-summary")}
          />
          <FieldError id="article-summary-error" message={fieldErrors["summary"]} />
        </div>

        <div className="admin-field admin-form-grid__full">
          <label className="admin-field__label" htmlFor="article-tags">
            Tag/Keywords
          </label>
          <div className="admin-article-tags-row">
            <input
              id="article-tags"
              className="admin-input"
              type="text"
              placeholder="Add tags, separated by commas"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTags();
                }
              }}
              {...errorProps("tags", "article-tags")}
            />
            <Button variant="primary" onClick={addTags}>
              Add
            </Button>
          </div>
          {form.tags.length > 0 ? (
            <ul className="admin-article-tags" aria-label="Tags">
              {form.tags.map((t) => (
                <li key={t} className="admin-article-tags__chip">
                  {t}
                  <button
                    type="button"
                    className="admin-article-tags__remove"
                    aria-label={`Remove ${t}`}
                    onClick={() => removeTag(t)}
                  >
                    <Icon name="x" size={12} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <FieldError id="article-tags-error" message={fieldErrors["tags"]} hint="Up to 10 tags." />
        </div>
      </div>
    </Modal>
  );

  if (view === "form") {
    return (
      <div>
        <div>
          <div className="admin-page-header">
            <div>
              <h1 className="admin-page-header__title">
                {formMode === "create" ? "Article > Create" : "Article > Edit"}
              </h1>
              <p className="admin-page-header__desc">
                {formMode === "create"
                  ? "Write a new news article and publish it to the public News page."
                  : "Update article information."}
              </p>
            </div>
          </div>

          <form className="admin-dark-form" onSubmit={(event) => event.preventDefault()}>
            <div className="admin-article-frame">
              <div className="admin-field">
                <span className="admin-field__label">Featured Image *</span>
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
                    aria-label="Upload the featured image"
                    aria-describedby="article-image-error"
                    onClick={() => bannerInputRef.current?.click()}
                  />
                  {form.banner ? (
                    <>
                      <img
                        src={form.banner.thumbUrl}
                        alt="Featured image"
                        className="admin-dropzone__image"
                      />
                      <span className="admin-dropzone__badge">Click to change</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        icon="x"
                        className="admin-dropzone__remove"
                        aria-label="Remove the featured image"
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
                <UploadBar upload={uploader} />
                <FieldError
                  id="article-image-error"
                  message={uploader.error ?? fieldErrors["featuredImage"]}
                />
              </div>

              <RichTextStack
                blocks={form.bodies}
                onChange={(bodies) => setForm((f) => ({ ...f, bodies }))}
                uploadImage={uploadInlineImage}
                label="Article content"
              />
              <UploadBar upload={inlineUploader} />
              <FieldError
                id="article-body-error"
                message={inlineUploader.error ?? fieldErrors["body"]}
              />
            </div>

            <div className="admin-form-actions">
              <Button
                variant="outline"
                size="sm"
                icon="chevronLeft"
                onClick={() => setView("list")}
              >
                Back
              </Button>
              <div className="admin-form-actions__right">
                <Button
                  variant="outline"
                  size="sm"
                  icon="eye"
                  onClick={() => openPreview(editingId)}
                >
                  Preview
                </Button>
                <Button
                  type="submit"
                  formNoValidate
                  variant="outline"
                  size="sm"
                  icon="cloud"
                  disabled={busy || uploader.busy || inlineUploader.busy}
                  onClick={() => save("draft")}
                >
                  Save draft
                </Button>
                {canPublish ? (
                  <Button
                    type="submit"
                    variant="outline"
                    size="sm"
                    icon="globeSimple"
                    disabled={busy || uploader.busy || inlineUploader.busy}
                    onClick={() => save("publish")}
                  >
                    Publish
                  </Button>
                ) : null}
              </div>
            </div>
          </form>

          <ToastBanner message={toast.message} />
        </div>
        {settingsPanel}
      </div>
    );
  }

  return (
    <div>
      <div>
        <div className="admin-page-header admin-events-header">
          <div>
            <h1 className="admin-page-header__title">Article</h1>
            <p className="admin-page-header__desc">
              Browse, search, and manage all published and draft news articles.
            </p>
          </div>
          <div className="admin-page-header__actions">
            <div className="admin-fab">
              {canEdit ? (
                <Button variant="outline" size="sm" icon="plus" onClick={() => toForm("create")}>
                  Add New Article
                </Button>
              ) : null}
            </div>
            <SortMenu columns={columns} />
            <SearchBox
              key={searchKey}
              placeholder="Search by title..."
              label="Search articles"
              onSearch={filterBy(setQuery)}
            />
          </div>
        </div>

        <Tabs
          label="Article lists"
          tabs={TABS.map((t) => ({ ...t, count: counts[t.key] }))}
          active={tab}
          onSelect={switchTab}
        />

        <ListCard
          table={table}
          noun="article"
          columns={columns}
          empty={
            <ListEmpty
              noun="article"
              query={query}
              filters={table.filterCount}
              emptyHint="Add the first article."
              onClear={clearFilters}
              addLabel="Add New Article"
              onAdd={canEdit ? () => toForm("create") : null}
            />
          }
          bulkActions={
            canPublish || canEdit ? (
              <>
                {canPublish ? (
                  <Button
                    variant="primary"
                    size="sm"
                    icon="globeSimple"
                    disabled={busy}
                    onClick={() => setPublishedFor(Array.from(selected), true)}
                  >
                    Publish
                  </Button>
                ) : null}
                {canEdit ? (
                  <Button
                    variant="danger"
                    size="sm"
                    icon="trash"
                    disabled={busy}
                    onClick={deleteSelected}
                  >
                    Delete
                  </Button>
                ) : null}
              </>
            ) : null
          }
        />

        <ConfirmDialog
          open={deleteConfirm !== null}
          title={`${deleteLabel}?`}
          confirmLabel={deleteLabel}
          icon="trash"
          pending={busy}
          onConfirm={doDelete}
          onCancel={() => setDeleteConfirm(null)}
        >
          {DELETE_HINT}
        </ConfirmDialog>

        <ToastBanner message={toast.message} />
      </div>
      {settingsPanel}
    </div>
  );
}

export function ArticlesPage(props: ArticleListProps) {
  const pathname = usePathname();
  return <ArticleList key={pathname} {...props} />;
}
