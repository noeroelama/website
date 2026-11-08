"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  FORM_USAGES,
  QUESTION_TYPES,
  type FormUsage,
  type QuestionType,
} from "@website/domain/forms";
import { utcToWallTime, wallTimeToUtc } from "@website/domain/shared";
import {
  closeFormAction,
  publishFormAction,
  removeFormAction,
  saveFormAction,
} from "@/app/(panel)/forms/actions";
import { actionMessage } from "@/components/action-message";
import { formatInZone, timeAgo } from "@/components/format";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, DELETE_HINT } from "@/components/ui/confirm-dialog";
import type { Column } from "@/components/ui/data-table";
import { EditableList } from "@/components/ui/editable-list";
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
import { Select } from "@/components/ui/select";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import { FORM_USAGE_LABELS, label, QUESTION_TYPE_LABELS } from "@/labels";
import {
  blankQuestion,
  fromDraft,
  hasOptions,
  matchesFormTab,
  toDraft,
  type FormItem,
  type FormTab,
  type QuestionDraft,
} from "./forms-model";
import { moveItem } from "./list-model";

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

type SortKey = "title" | "status" | "modified";
const sortValue = (f: FormItem, key: SortKey): string =>
  key === "title" ? f.title.toLowerCase() : key === "status" ? f.status : f.modifiedAt;
const filterText = (f: FormItem, key: SortKey): string =>
  key === "title"
    ? f.title
    : key === "status"
      ? f.statusLabel
      : formatInZone(f.modifiedAt, "UTC", false);

const TABS = [
  { key: "all", label: "All" },
  { key: "published", label: "Published" },
  { key: "drafts", label: "Drafts" },
  { key: "closed", label: "Closed" },
] as const;

interface FormDraft {
  title: string;
  description: string;
  usage: FormUsage;
  opensAt: string;
  closesAt: string;
  questions: QuestionDraft[];
}

const EMPTY_FORM: FormDraft = {
  title: "",
  description: "",
  usage: "public",
  opensAt: "",
  closesAt: "",
  questions: [blankQuestion()],
};

function draftFrom(f: FormItem, zone: string): FormDraft {
  const wall = (iso: string | null) => (iso ? utcToWallTime(new Date(iso), zone) : "");
  return {
    title: f.title,
    description: f.description,
    usage: f.usage,
    opensAt: wall(f.opensAt),
    closesAt: wall(f.closesAt),
    questions: f.questions.map(toDraft),
  };
}

type DeleteConfirm = { kind: "one"; form: FormItem } | { kind: "many"; count: number };

interface FormsPageProps {
  initial: FormItem[];
  canEdit: boolean;
  canPublish: boolean;
  canSeeResponses: boolean;
  publicBase: string;
}

const FORM_PATH = "/f/";

export function FormsPage(props: FormsPageProps) {
  const pathname = usePathname();
  return <FormsList key={pathname} {...props} />;
}

function FormsList({
  initial: forms,
  canEdit,
  canPublish,
  canSeeResponses,
  publicBase,
}: FormsPageProps) {
  const toast = useToastMessage();
  const router = useRouter();
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [tab, setTab] = useState<FormTab>("all");
  const [query, setQuery] = useState("");
  const [searchKey, setSearchKey] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null);

  const [view, setView] = useState<"list" | "form">("list");
  const [editing, setEditing] = useState<FormItem | null>(null);
  const [zone, setZone] = useState("UTC");
  const [draft, setDraft] = useState<FormDraft>(EMPTY_FORM);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return forms.filter((f) => matchesFormTab(f, tab) && (!q || f.title.toLowerCase().includes(q)));
  }, [forms, tab, query]);
  const counts = useMemo(
    () =>
      Object.fromEntries(
        TABS.map((t) => [t.key, forms.filter((f) => matchesFormTab(f, t.key)).length]),
      ) as Record<FormTab, number>,
    [forms],
  );

  const table = useListTable(filtered, sortValue, undefined, filterText);
  const { selected } = table;

  type Failure = Parameters<typeof actionMessage>[0];
  const fail = (result: Failure) => {
    setFieldErrors(result.fields ?? {});
    toast.show(actionMessage(result));
  };
  const bulk = useBulkActions({
    noun: "form",
    show: toast.show,
    onFailure: fail,
    onFinish: table.clearSelection,
  });
  const { busy, setBusy } = bulk;

  const doDelete = () => {
    if (!deleteConfirm) return;
    const ids = deleteConfirm.kind === "one" ? [deleteConfirm.form.id] : Array.from(selected);
    setDeleteConfirm(null);
    void bulk.run(
      forms.filter((f) => ids.includes(f.id)),
      (f) => removeFormAction({ id: f.id, version: f.version }),
      "deleted",
    );
  };

  const setPublished = (f: FormItem, publish: boolean) =>
    void bulk.run(
      [f],
      (x) => (publish ? publishFormAction : closeFormAction)({ id: x.id, version: x.version }),
      publish ? "published" : "closed",
    );

  const copyLink = (f: FormItem) => {
    void navigator.clipboard?.writeText(`${publicBase}${FORM_PATH}${f.publicToken ?? ""}`);
    toast.show(`Link for "${f.title}" copied`);
  };

  const toForm = (f?: FormItem) => {
    const editorZone = browserZone();
    setZone(editorZone);
    setEditing(f ?? null);
    setFieldErrors({});
    setDraft(f ? draftFrom(f, editorZone) : { ...EMPTY_FORM, questions: [blankQuestion()] });
    setView("form");
  };

  const save = async () => {
    setBusy(true);
    const result = await saveFormAction({
      ...(editing ? { id: editing.id } : {}),
      version: editing?.version ?? null,
      title: draft.title,
      description: draft.description,
      usage: draft.usage,
      opensAt: wallTimeToUtc(draft.opensAt, zone)?.toISOString() ?? null,
      closesAt: wallTimeToUtc(draft.closesAt, zone)?.toISOString() ?? null,
      questions: draft.questions.map(fromDraft),
    });
    setBusy(false);
    if (!result.ok) {
      fail(result);
      return;
    }
    setFieldErrors({});
    toast.show(
      result.data.newVersion
        ? `Saved as version ${result.data.currentVersion} (earlier answers keep their version)`
        : "Form saved",
    );
    router.refresh();
    setView("list");
  };

  const updateQuestion = (idx: number, patch: Partial<QuestionDraft>) =>
    setDraft((d) => ({
      ...d,
      questions: d.questions.map((q, i) => (i === idx ? { ...q, ...patch } : q)),
    }));

  const errorProps = (field: string) =>
    fieldErrors[field] ? { "aria-invalid": true, "aria-describedby": `form-${field}-error` } : {};
  const errorFor = (field: string) => (
    <FieldError id={`form-${field}-error`} message={fieldErrors[field]} />
  );

  const columns: Column<FormItem>[] = [
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
      header: table.header("title", "Form"),
      width: "40%",
      render: (r) => (
        <div>
          <div className="admin-table__title">{r.title}</div>
          <div className="admin-table__sub">{r.usageLabel}</div>
        </div>
      ),
    },
    {
      key: "questions",
      header: "Questions",
      width: "16%",
      render: (r) => (
        <span className="admin-event-meta">
          <span className="admin-table__title">{r.questions.length}</span>
          <span className="admin-table__sub">
            Version {r.currentVersion}
            {r.answered ? " · answered" : ""}
          </span>
        </span>
      ),
    },
    {
      key: "status",
      header: table.header("status", "Status"),
      width: "14%",
      render: (r) => (
        <span className="admin-status-badge">
          <Icon name={r.status === "published" ? "globe" : "lock"} size={12} />
          {r.statusLabel}
        </span>
      ),
    },
    {
      key: "modified",
      header: table.header("modified", "Last Modified"),
      width: "16%",
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
      width: "10%",
      render: (r) => (
        <div className="admin-table__actions">
          {canEdit ? (
            <Button
              variant="ghost"
              size="icon"
              icon="edit"
              aria-label="Edit"
              title="Edit"
              onClick={() => toForm(r)}
            />
          ) : null}
          <RowMenu>
            {canPublish && r.usage === "public" ? (
              <>
                <MenuItem
                  icon="globeSimple"
                  disabled={busy || r.status === "published"}
                  onClick={() => setPublished(r, true)}
                >
                  Publish
                </MenuItem>
                <MenuItem
                  icon="lock"
                  disabled={busy || r.status !== "published"}
                  onClick={() => setPublished(r, false)}
                >
                  Close
                </MenuItem>
              </>
            ) : null}
            {r.publicToken ? (
              <MenuItem icon="copy" onClick={() => copyLink(r)}>
                Copy<span className="admin-long"> Link</span>
              </MenuItem>
            ) : null}
            {canSeeResponses ? (
              <MenuItem icon="inbox" onClick={() => router.push(`/forms/${r.id}/responses`)}>
                Responses ({r.responseCount})
              </MenuItem>
            ) : null}
            {canEdit ? (
              <>
                <MenuDivider />
                <MenuItem
                  icon="trash"
                  danger
                  onClick={() => setDeleteConfirm({ kind: "one", form: r })}
                >
                  Delete Form
                </MenuItem>
              </>
            ) : null}
          </RowMenu>
        </div>
      ),
    },
  ];

  const switchTab = (next: FormTab) => {
    setTab(next);
    table.setPage(1);
    table.clearSelection();
  };

  const deleteCount = deleteConfirm?.kind === "many" ? deleteConfirm.count : 1;
  const deleteLabel = deleteCount === 1 ? "Delete Form" : `Delete ${deleteCount} Forms`;

  if (view === "form") {
    return (
      <div>
        <div className="admin-page-header">
          <div>
            <h1 className="admin-page-header__title">
              {editing ? "Forms > Edit" : "Forms > Create"}
            </h1>
            <p className="admin-page-header__desc">
              {editing?.answered
                ? `People answered version ${editing.currentVersion}. Changed questions are saved as version ${editing.currentVersion + 1}; earlier answers keep their version.`
                : "Write the questions. They can change freely until someone answers."}
            </p>
          </div>
        </div>

        <form className="admin-dark-form" onSubmit={(event) => event.preventDefault()}>
          <div className="admin-form-grid">
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="form-title">
                Title *
              </label>
              <input
                id="form-title"
                required
                minLength={3}
                className="admin-input"
                type="text"
                placeholder="Form title"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                {...errorProps("title")}
              />
              {errorFor("title")}
            </div>

            <div className="admin-field">
              <label className="admin-field__label" htmlFor="form-usage">
                Used for *
              </label>
              <Select
                id="form-usage"
                required
                className="admin-select"
                value={draft.usage}
                disabled={editing !== null && editing.status !== "draft"}
                onChange={(e) => setDraft({ ...draft, usage: e.target.value as FormUsage })}
              >
                {FORM_USAGES.map((u) => (
                  <option key={u} value={u}>
                    {label(FORM_USAGE_LABELS, u)}
                  </option>
                ))}
              </Select>
              <FieldError
                id="form-usage-error"
                message={fieldErrors["usage"]}
                hint="Public forms are answered by guests at their own link; recruitment forms only inside an application."
              />
            </div>

            <div className="admin-field">
              <label className="admin-field__label" htmlFor="form-opens">
                Opens
              </label>
              <input
                id="form-opens"
                className="admin-input"
                type="datetime-local"
                value={draft.opensAt}
                onChange={(e) => setDraft({ ...draft, opensAt: e.target.value })}
                {...errorProps("opensAt")}
              />
              <FieldError
                id="form-opensAt-error"
                message={fieldErrors["opensAt"]}
                hint={`Your time zone (${zone}). Empty = open as soon as it is published.`}
              />
            </div>

            <div className="admin-field">
              <label className="admin-field__label" htmlFor="form-closes">
                Closes
              </label>
              <input
                id="form-closes"
                className="admin-input"
                type="datetime-local"
                value={draft.closesAt}
                onChange={(e) => setDraft({ ...draft, closesAt: e.target.value })}
                {...errorProps("closesAt")}
              />
              <FieldError
                id="form-closesAt-error"
                message={fieldErrors["closesAt"]}
                hint="Empty = open until it is closed."
              />
            </div>

            <div className="admin-field admin-form-grid__full">
              <label className="admin-field__label" htmlFor="form-desc">
                Description
              </label>
              <textarea
                id="form-desc"
                className="admin-input admin-textarea"
                rows={3}
                placeholder="Shown above the questions"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                {...errorProps("description")}
              />
              {errorFor("description")}
            </div>
          </div>

          <EditableList
            title="Questions"
            subtitle="Drag to change the order. Answers are checked on the server against these questions."
            emptyHint="No questions added"
            addLabel="Add Question"
            count={draft.questions.length}
            onAdd={() => setDraft((d) => ({ ...d, questions: [...d.questions, blankQuestion()] }))}
            onRemove={(i) =>
              setDraft((d) => ({ ...d, questions: d.questions.filter((_, j) => j !== i) }))
            }
            onReorder={(from, to) =>
              setDraft((d) => ({ ...d, questions: moveItem(d.questions, from, to) }))
            }
            renderRow={(i) => {
              const q = draft.questions[i] ?? blankQuestion();
              return (
                <QuestionEditor
                  index={i}
                  question={q}
                  onChange={(patch) => updateQuestion(i, patch)}
                />
              );
            }}
          />

          {errorFor("questions")}
          <div className="admin-form-actions admin-form-grid__full">
            <Button variant="outline" size="sm" icon="chevronLeft" onClick={() => setView("list")}>
              Back
            </Button>
            <div className="admin-form-actions__right">
              <Button
                type="submit"
                variant="outline"
                size="sm"
                icon="cloud"
                disabled={busy}
                onClick={() => save()}
              >
                Save
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
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Forms</h1>
          <p className="admin-page-header__desc">
            Build public forms (surveys, sign-ups, suggestion box) and recruitment questions.
          </p>
        </div>
        <div className="admin-page-header__actions">
          <div className="admin-fab">
            {canEdit ? (
              <Button variant="outline" size="sm" icon="plus" onClick={() => toForm()}>
                Add New Form
              </Button>
            ) : null}
          </div>
          <SortMenu columns={columns} />
          <SearchBox
            key={searchKey}
            placeholder="Search by title..."
            label="Search forms"
            onSearch={(value) => {
              setQuery(value);
              table.setPage(1);
            }}
          />
        </div>
      </div>

      <Tabs
        label="Form lists"
        tabs={TABS.map((t) => ({ ...t, count: counts[t.key] }))}
        active={tab}
        onSelect={switchTab}
      />

      <ListCard
        table={table}
        noun="form"
        columns={columns}
        empty={
          <ListEmpty
            noun="form"
            query={query}
            filters={0}
            emptyHint="Add the first form."
            onClear={() => {
              setQuery("");
              setSearchKey((k) => k + 1);
            }}
            addLabel="Add New Form"
            onAdd={canEdit ? () => toForm() : null}
          />
        }
        bulkActions={
          canEdit ? (
            <Button
              variant="danger"
              size="sm"
              icon="trash"
              disabled={busy}
              onClick={() =>
                selected.size === 0
                  ? toast.show("Select forms to delete")
                  : setDeleteConfirm({ kind: "many", count: selected.size })
              }
            >
              Delete
            </Button>
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

function QuestionEditor({
  index: i,
  question: q,
  onChange,
}: {
  index: number;
  question: QuestionDraft;
  onChange: (patch: Partial<QuestionDraft>) => void;
}) {
  return (
    <div className="admin-question">
      <div className="admin-field">
        <label className="admin-field__label" htmlFor={`question-label-${i}`}>
          Question *
        </label>
        <input
          id={`question-label-${i}`}
          required
          className="admin-input"
          type="text"
          placeholder="e.g. Which session did you like most?"
          value={q.label}
          onChange={(e) => onChange({ label: e.target.value })}
        />
        <FieldError id={`question-label-${i}-error`} />
      </div>
      <div className="admin-field">
        <label className="admin-field__label" htmlFor={`question-type-${i}`}>
          Type *
        </label>
        <Select
          id={`question-type-${i}`}
          className="admin-select"
          value={q.type}
          onChange={(e) => onChange({ type: e.target.value as QuestionType })}
        >
          {QUESTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {label(QUESTION_TYPE_LABELS, t)}
            </option>
          ))}
        </Select>
      </div>
      <div className="admin-field admin-question__wide">
        <label className="admin-field__label" htmlFor={`question-desc-${i}`}>
          Help text
        </label>
        <input
          id={`question-desc-${i}`}
          className="admin-input"
          type="text"
          placeholder="Optional explanation under the question"
          value={q.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </div>
      {hasOptions(q.type) ? (
        <div className="admin-field admin-question__wide">
          <label className="admin-field__label" htmlFor={`question-options-${i}`}>
            Options * (one per line)
          </label>
          <textarea
            id={`question-options-${i}`}
            required
            className="admin-input admin-textarea"
            rows={3}
            value={q.options}
            onChange={(e) => onChange({ options: e.target.value })}
          />
          <FieldError id={`question-options-${i}-error`} hint="At least 2, each once." />
        </div>
      ) : null}
      {q.type === "multi_choice" ? (
        <div className="admin-field">
          <label className="admin-field__label" htmlFor={`question-maxsel-${i}`}>
            Most ticks allowed
          </label>
          <input
            id={`question-maxsel-${i}`}
            className="admin-input"
            type="number"
            min={1}
            placeholder="Any"
            value={q.maxSelections}
            onChange={(e) => onChange({ maxSelections: e.target.value })}
          />
          <FieldError id={`question-maxsel-${i}-error`} />
        </div>
      ) : null}
      {q.type === "number" ? (
        <>
          <div className="admin-field">
            <label className="admin-field__label" htmlFor={`question-min-${i}`}>
              Smallest
            </label>
            <input
              id={`question-min-${i}`}
              className="admin-input"
              type="number"
              placeholder="No limit"
              value={q.min}
              onChange={(e) => onChange({ min: e.target.value })}
            />
          </div>
          <div className="admin-field">
            <label className="admin-field__label" htmlFor={`question-max-${i}`}>
              Largest
            </label>
            <input
              id={`question-max-${i}`}
              className="admin-input"
              type="number"
              placeholder="No limit"
              value={q.max}
              onChange={(e) => onChange({ max: e.target.value })}
            />
          </div>
        </>
      ) : null}
      <div className="admin-question__flags">
        <label className="admin-check-label">
          <input
            type="checkbox"
            checked={q.required}
            onChange={(e) => onChange({ required: e.target.checked })}
          />
          Required
        </label>
        {hasOptions(q.type) ? (
          <label className="admin-check-label">
            <input
              type="checkbox"
              checked={q.allowOther}
              onChange={(e) => onChange({ allowOther: e.target.checked })}
            />
            Allow an &quot;Other&quot; answer
          </label>
        ) : null}
        {q.type === "file" ? (
          <span className="admin-field__hint">
            Files are for recruitment forms (signed-in applicants); public forms cannot ask for
            files.
          </span>
        ) : null}
      </div>
    </div>
  );
}
