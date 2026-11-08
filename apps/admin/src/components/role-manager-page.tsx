"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { ROLE_COLORS, type RoleColor } from "@website/permissions";
import {
  addPersonAction,
  assignRoleAction,
  cancelInviteAction,
  deleteRoleAction,
  findPeopleAction,
  logPeopleExportAction,
  personDetailsAction,
  revokeRoleAction,
  saveRoleAction,
  setStatusAction,
} from "@/app/(panel)/roles/actions";
import { ActionError } from "@/components/action-error";
import { actionMessage, type ActionFailure } from "@/components/action-message";
import { downloadCsv } from "@/components/csv";
import { peopleCsv } from "@/components/exports-model";
import { formatUtc } from "@/components/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Column } from "@/components/ui/data-table";
import { FieldError } from "@/components/ui/field-error";
import { Icon } from "@/components/ui/icon";
import {
  ListCard,
  SortMenu,
  ListEmpty,
  SearchBox,
  Tabs,
  useListTable,
} from "@/components/ui/list-controls";
import { Modal } from "@/components/ui/modal";
import { Select, useDropdown } from "@/components/ui/select";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import { label, USER_STATUS_LABELS } from "@/labels";
import {
  DEFAULT_ROLE_ID,
  filterPermissionGroups,
  matchesPerson,
  matchesRole,
  joinPermissions,
  permissionGroups,
  personSortValue,
  roleInk,
  roleTabs,
  splitPermissions,
  type PersonRow,
  type PersonSortKey,
} from "./role-manager-model";

export interface RoleOption {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

type Result = { ok: true } | ActionFailure;
const GLOBAL = { type: "global" } as const;
const statusLabel = (status: PersonRow["status"]) =>
  status === "invited" ? "Invited" : label(USER_STATUS_LABELS, status);
const STATUS_TONE = { active: "success", inactive: "danger", invited: "warn" } as const;
const lastSignIn = (row: PersonRow) =>
  formatUtc(row.lastSignInAt ? new Date(row.lastSignInAt) : null);

export function RolePill({ name, color }: { name: string; color: string }) {
  return (
    <span
      className={`admin-role-pill admin-role-pill--${roleInk(color)}`}
      style={{ "--role-color": color } as CSSProperties}
    >
      {name}
    </span>
  );
}

function RemovableChip({ label, onRemove }: { label: string; onRemove: (() => void) | null }) {
  return (
    <span className="admin-role-chip">
      {label}
      {onRemove ? (
        <button type="button" aria-label={`Remove ${label}`} onClick={onRemove}>
          <Icon name="x" size={12} />
        </button>
      ) : null}
    </span>
  );
}

function Footer({ onCancel, children }: { onCancel: () => void; children?: ReactNode }) {
  return (
    <div className="admin-modal__footer-row">
      <Button variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      {children}
    </div>
  );
}

export function RoleManagerPeople({
  rows,
  roles,
  selfId,
  canEdit,
  canEditRoles,
  reauthUrl,
}: {
  rows: PersonRow[];
  roles: RoleOption[];
  selfId: string;
  canEdit: boolean;
  canEditRoles: boolean;
  reauthUrl: string | null;
}) {
  const toast = useToastMessage();
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [searchKey, setSearchKey] = useState(0);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PersonRow | null>(null);

  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);
  const names = useMemo(() => new Map(roles.map((r) => [r.id, r.name])), [roles]);
  const sortValue = useCallback(
    (row: PersonRow, key: PersonSortKey) => personSortValue(row, key, names),
    [names],
  );
  const filtered = useMemo(
    () => rows.filter((row) => matchesPerson(row, { tab, query })),
    [rows, tab, query],
  );
  const filterText = useCallback(
    (row: PersonRow, key: PersonSortKey) =>
      key === "name"
        ? row.name
        : key === "status"
          ? statusLabel(row.status)
          : key === "lastSignIn"
            ? (row.lastSignInAt?.slice(0, 10) ?? "Never")
            : row.roleId === null
              ? "Visitor"
              : (names.get(row.roleId) ?? row.roleId),
    [names],
  );
  const table = useListTable<PersonRow, PersonSortKey>(
    filtered,
    sortValue,
    { key: "name", dir: "asc" },
    filterText,
  );
  const tabs = useMemo(() => roleTabs(rows, roles), [rows, roles]);

  const reset =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      table.setPage(1);
    };
  const clear = () => {
    setQuery("");
    setTab("all");
    setSearchKey((k) => k + 1);
    table.setPage(1);
  };
  const pill = (id: string | null) =>
    id === null ? (
      "Visitor"
    ) : (
      <RolePill name={names.get(id) ?? id} color={roleById.get(id)?.color ?? ""} />
    );

  const columns: Column<PersonRow>[] = [
    {
      key: "name",
      width: "30%",
      header: table.header("name", "Name"),
      render: (row) => (
        <span className="admin-role-person" title={row.email ?? undefined}>
          <span className="admin-table__title">{row.name}</span>
        </span>
      ),
    },
    {
      key: "role",
      width: "22%",
      header: table.header("role", "Role"),
      render: (row) => pill(row.roleId),
    },
    {
      key: "status",
      width: "16%",
      header: table.header("status", "Status"),
      render: (row) => <Badge tone={STATUS_TONE[row.status]}>{statusLabel(row.status)}</Badge>,
    },
    {
      key: "lastSignIn",
      width: "24%",
      header: table.header("lastSignIn", "Last login"),
      render: lastSignIn,
    },
    {
      key: "edit",
      header: "",
      align: "right",
      render: (row) => (
        <Button
          variant="ghost"
          size="icon"
          icon="edit"
          aria-label={`Edit ${row.name}`}
          title={`Edit ${row.name}`}
          onClick={() => setEditing(row)}
        />
      ),
    },
  ];

  return (
    <div className="admin-role-manager">
      <div className="admin-page-header admin-events-header">
        <div>
          <h1 className="admin-page-header__title">Role Manager</h1>
          <p className="admin-page-header__desc">PPIDK Asiania Role Management System</p>
        </div>
        <div className="admin-page-header__actions">
          {canEditRoles ? (
            <Button href="/roles/edit" variant="outline" size="sm" icon="edit">
              Edit Role
            </Button>
          ) : null}
          <div className="admin-fab">
            {canEdit ? (
              <Button variant="outline" size="sm" icon="plus" onClick={() => setAdding(true)}>
                Add New People
              </Button>
            ) : null}
          </div>
          <Button
            variant="outline"
            size="sm"
            icon="download"
            onClick={() =>
              void (async () => {
                const result = await logPeopleExportAction({ rows: filtered.length });
                if (result.ok) downloadCsv("accounts", peopleCsv(filtered, names));
                else toast.show(actionMessage(result));
              })()
            }
          >
            Export CSV
          </Button>
          <SortMenu columns={columns} />
          <SearchBox
            key={searchKey}
            placeholder="Search by name or e-mail..."
            label="Search people by name or e-mail"
            onSearch={reset(setQuery)}
          />
        </div>
      </div>

      <div className="admin-audit-tabbar">
        <Tabs label="Roles" tabs={tabs} active={tab} onSelect={reset(setTab)} />
      </div>

      <ListCard
        table={table}
        noun="account"
        columns={columns}
        empty={
          <ListEmpty
            noun="account"
            query={query}
            filters={tab === "all" ? 0 : 1}
            emptyHint="Nobody holds a role yet. Add the first person with Add New People."
            onClear={clear}
            addLabel="Add New People"
            onAdd={canEdit ? () => setAdding(true) : null}
          />
        }
      />

      <AddPeopleModal
        open={adding}
        roles={roles.filter((r) => r.id !== DEFAULT_ROLE_ID)}
        reauthUrl={reauthUrl}
        onClose={() => setAdding(false)}
        onDone={(text) => {
          setAdding(false);
          toast.show(text);
        }}
      />
      {editing ? (
        <PersonModal
          key={editing.id}
          row={editing}
          roles={roles.filter((r) => r.id !== DEFAULT_ROLE_ID)}
          pill={pill}
          canEdit={canEdit && editing.uid !== selfId}
          self={editing.uid === selfId}
          reauthUrl={reauthUrl}
          onClose={() => setEditing(null)}
          onDone={(text) => {
            setEditing(null);
            toast.show(text);
          }}
        />
      ) : null}
      <ToastBanner message={toast.message} />
    </div>
  );
}

interface Suggestion {
  readonly uid: string;
  readonly name: string | null;
  readonly email: string | null;
}

const SUGGEST_DELAY_MS = 300;

function AddPeopleModal({
  open,
  roles,
  reauthUrl,
  onClose,
  onDone,
}: {
  open: boolean;
  roles: RoleOption[];
  reauthUrl: string | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [person, setPerson] = useState("");
  const [roleId, setRoleId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Readonly<Record<string, string>>>({});
  const listId = useId();
  const [found, setFound] = useState<{ text: string; items: Suggestion[] }>({
    text: "",
    items: [],
  });
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(0);
  const text = person.trim();
  const suggestions = listOpen && found.text === text ? found.items : [];

  useEffect(() => {
    if (text.length < 2) return;
    let live = true;
    const timer = window.setTimeout(() => {
      void findPeopleAction({ query: text }).then(
        (result) => {
          if (live && result.ok) setFound({ text, items: result.data });
        },
        () => undefined,
      );
    }, SUGGEST_DELAY_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [text]);

  const choose = (item: Suggestion) => {
    setPerson(item.email ?? item.name ?? "");
    setListOpen(false);
  };
  const close = () => {
    setPerson("");
    setRoleId("");
    setError(null);
    setFields({});
    onClose();
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    const result = await addPersonAction({ person, roleId });
    setBusy(false);
    if (!result.ok) {
      setFields(result.fields ?? {});
      return setError(actionMessage(result));
    }
    const who = person.trim();
    setPerson("");
    setRoleId("");
    setFields({});
    router.refresh();
    onDone(result.data.invited ? `Invite sent to ${who}` : `Role given to ${who}`);
  };

  return (
    <Modal
      open={open}
      title="Add New People"
      className="admin-modal--side"
      width={548}
      hideClose
      onClose={close}
      footer={
        <Footer onCancel={close}>
          <Button
            variant="primary"
            type="submit"
            form="add-people-form"
            disabled={busy || !person.trim() || !roleId}
          >
            Invite
          </Button>
        </Footer>
      }
    >
      <form
        id="add-people-form"
        className="admin-role-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="admin-field">
          <label className="admin-field__label" htmlFor="people-person">
            Email or Name
          </label>
          <div className="admin-role-suggest">
            <input
              id="people-person"
              className="admin-input"
              required
              maxLength={120}
              autoComplete="off"
              placeholder="username@example.com or John Kennedy"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={suggestions.length > 0}
              aria-controls={listId}
              {...(suggestions[active] ? { "aria-activedescendant": `${listId}-${active}` } : {})}
              value={person}
              onChange={(e) => {
                setPerson(e.target.value);
                setActive(0);
                setListOpen(true);
              }}
              onFocus={() => setListOpen(true)}
              onBlur={() => setListOpen(false)}
              onKeyDown={(event) => {
                if (suggestions.length === 0) return;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const step = event.key === "ArrowDown" ? 1 : -1;
                  setActive((i) => Math.min(Math.max(i + step, 0), suggestions.length - 1));
                } else if (event.key === "Enter" && suggestions[active]) {
                  event.preventDefault();
                  choose(suggestions[active]);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setListOpen(false);
                }
              }}
              {...(fields["person"] ? { "aria-invalid": true } : {})}
              aria-describedby="people-person-error"
            />
            {suggestions.length > 0 ? (
              <ul
                id={listId}
                role="listbox"
                aria-label="Matching people"
                className="admin-row-menu__panel admin-combo__list admin-role-suggest__list"
              >
                {suggestions.map((item, i) => (
                  <li
                    key={item.uid}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    style={{ "--i": i } as CSSProperties}
                    className={`admin-row-menu__item${i === active ? " admin-combo__option--active" : ""}`}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(item)}
                  >
                    <span className="admin-role-suggest__name">{item.name ?? item.email}</span>
                    {item.name && item.email ? (
                      <span className="admin-role-suggest__email">{item.email}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <FieldError
            id="people-person-error"
            message={fields["person"]}
            hint="An e-mail without an account gets an invite."
          />
        </div>
        <div className="admin-field">
          <label className="admin-field__label" htmlFor="people-role">
            Role
          </label>
          <Select
            id="people-role"
            className="admin-select"
            required
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
          >
            <option value="">Select Role</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </Select>
        </div>
        <ActionError text={error} reauthUrl={reauthUrl} />
      </form>
    </Modal>
  );
}

function PersonModal({
  row,
  roles,
  pill,
  canEdit,
  self,
  reauthUrl,
  onClose,
  onDone,
}: {
  row: PersonRow;
  roles: RoleOption[];
  pill: (id: string | null) => ReactNode;
  canEdit: boolean;
  self: boolean;
  reauthUrl: string | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState(row.roleId ?? "");
  const [methods, setMethods] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const uid = row.uid;
  const names = new Map(roles.map((r) => [r.id, r]));

  useEffect(() => {
    if (uid === null) return;
    let live = true;
    void personDetailsAction({ uid }).then(
      (result) => {
        if (!live) return;
        if (!result.ok) return setMethods("Unavailable");
        const { providers, mfaFactors, passkeys } = result.data;
        const list = [
          ...providers.map((p) =>
            p === "google.com" ? "Google" : p === "password" ? "E-mail and password" : p,
          ),
          ...(passkeys > 0 ? [`${passkeys} passkey${passkeys === 1 ? "" : "s"}`] : []),
          ...(mfaFactors > 0 ? ["Two-step verification"] : []),
        ];
        setMethods(list.join(", ") || "—");
      },
      () => {
        if (live) setMethods("Unavailable");
      },
    );
    return () => {
      live = false;
    };
  }, [uid]);

  const save = async () => {
    const before = row.roleId ?? "";
    if (uid === null || chosen === before) return onDone("Nothing changed");
    setBusy(true);
    setError(null);
    const change = { uid, version: row.version, scope: GLOBAL, periodId: null };
    const result =
      chosen === ""
        ? await revokeRoleAction({ ...change, roleId: before })
        : await assignRoleAction({ ...change, roleId: chosen });
    setBusy(false);
    router.refresh();
    if (!result.ok) return setError(actionMessage(result));
    onDone(`Role of ${row.name} saved`);
  };
  const run = async (action: () => Promise<Result>, message: string) => {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    setConfirm(false);
    if (!result.ok) return setError(actionMessage(result));
    router.refresh();
    onDone(message);
  };

  if (uid === null) {
    return (
      <Modal
        open
        title="Invited"
        className="admin-modal--side"
        width={548}
        hideClose
        onClose={onClose}
        footer={
          <Footer onCancel={onClose}>
            {canEdit ? (
              <Button
                variant="danger"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => cancelInviteAction({ email: row.email }),
                    `Invite of ${row.name} cancelled`,
                  )
                }
              >
                Cancel invite
              </Button>
            ) : null}
          </Footer>
        }
      >
        <dl className="admin-role-facts">
          <dt>Email</dt>
          <dd>{row.email}</dd>
          <dt>Role</dt>
          <dd>{pill(row.roleId)}</dd>
          <dt>Invited</dt>
          <dd>{formatUtc(row.createdAt ? new Date(row.createdAt) : null)}</dd>
        </dl>
        <p className="admin-role-note">
          The role is given when this e-mail signs in for the first time (verified e-mail). A staff
          role waits until the account has a second sign-in method.
        </p>
        <ActionError text={error} reauthUrl={reauthUrl} />
      </Modal>
    );
  }

  return (
    <Modal
      open
      title="Edit People"
      className="admin-modal--side"
      width={548}
      hideClose
      onClose={onClose}
      footer={
        <Footer onCancel={onClose}>
          {canEdit ? (
            <Button variant="primary" disabled={busy} onClick={() => save()}>
              Save
            </Button>
          ) : null}
        </Footer>
      }
    >
      <dl className="admin-role-facts">
        <dt>Email or Name</dt>
        <dd>
          {row.name}
          {row.email && row.email !== row.name ? ` · ${row.email}` : ""}
        </dd>
        <dt>Status</dt>
        <dd>
          <Badge tone={row.status === "active" ? "success" : "danger"}>
            {statusLabel(row.status)}
          </Badge>
        </dd>
        <dt>Last sign-in</dt>
        <dd>{formatUtc(row.lastSignInAt ? new Date(row.lastSignInAt) : null)}</dd>
        <dt>Sign-in methods</dt>
        <dd>{methods ?? "Loading…"}</dd>
      </dl>

      <div className="admin-field">
        <label className="admin-field__label" htmlFor="person-role">
          Website role
        </label>
        <Select
          id="person-role"
          className="admin-select"
          disabled={!canEdit}
          value={chosen}
          onChange={(e) => setChosen(e.target.value)}
        >
          <option value="">Visitor (no role)</option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </Select>
        <p className="admin-role-note">
          {self
            ? "You cannot change your own account."
            : "One role per account: a new one replaces it. Staff roles need two sign-in methods on the account. A change signs the person out."}
        </p>
      </div>
      {row.orgRoleIds.length > 0 ? (
        <div className="admin-field">
          <span className="admin-field__label">Organizational roles</span>
          <span
            className="admin-role-pills"
            title="Given for one chapter, unit or board period, or by an appointment: changed there"
          >
            {row.orgRoleIds.map((id) => (
              <RemovableChip key={id} label={names.get(id)?.name ?? id} onRemove={null} />
            ))}
          </span>
        </div>
      ) : null}

      {canEdit ? (
        <div>
          <Button
            variant={row.status === "active" ? "danger" : "success"}
            size="sm"
            disabled={busy}
            onClick={() => setConfirm(true)}
          >
            {row.status === "active" ? "Deactivate account" : "Reactivate account"}
          </Button>
        </div>
      ) : null}
      <ActionError text={error} reauthUrl={reauthUrl} />

      <ConfirmDialog
        open={confirm}
        title={row.status === "active" ? "Deactivate this account?" : "Reactivate this account?"}
        confirmLabel={row.status === "active" ? "Deactivate" : "Reactivate"}
        tone={row.status === "active" ? "danger" : "success"}
        pending={busy}
        onCancel={() => setConfirm(false)}
        onConfirm={() =>
          void run(
            () =>
              setStatusAction({
                uid,
                version: row.version,
                status: row.status === "active" ? "inactive" : "active",
              }),
            row.status === "active" ? `${row.name} deactivated` : `${row.name} reactivated`,
          )
        }
      >
        {row.status === "active"
          ? "The person is signed out everywhere and cannot sign in until the account is reactivated."
          : "The person can sign in again with the roles the account still has."}
      </ConfirmDialog>
    </Modal>
  );
}

export interface RoleRow {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly permissions: readonly string[];
  readonly version: number | null;
  readonly holders: number;
  readonly builtIn: boolean;
}

const PERMISSION_GROUPS = permissionGroups();

type RoleSortKey = "role" | "permissions";
const roleSortValue = (row: RoleRow, key: RoleSortKey): string | number =>
  key === "role" ? row.name.toLowerCase() : row.permissions.length;
const roleFilterText = (row: RoleRow, key: RoleSortKey): string =>
  key === "role" ? row.name : String(row.permissions.length);

export function RoleManagerRoles({
  roles,
  canEdit,
  canSeePeople,
  reauthUrl,
}: {
  roles: RoleRow[];
  canEdit: boolean;
  canSeePeople: boolean;
  reauthUrl: string | null;
}) {
  const router = useRouter();
  const toast = useToastMessage();
  const [query, setQuery] = useState("");
  const [searchKey, setSearchKey] = useState(0);
  const [editing, setEditing] = useState<RoleRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<RoleRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => roles.filter((role) => matchesRole(role, query)), [roles, query]);
  const table = useListTable<RoleRow, RoleSortKey>(
    filtered,
    roleSortValue,
    undefined,
    roleFilterText,
  );

  const remove = async () => {
    if (!deleting || deleting.version === null) return;
    setBusy(true);
    setError(null);
    const result = await deleteRoleAction({ id: deleting.id, version: deleting.version });
    setBusy(false);
    if (!result.ok) return setError(actionMessage(result));
    setDeleting(null);
    router.refresh();
    toast.show(`Role ${deleting.name} deleted`);
  };
  const lockedReason = (row: RoleRow) =>
    !canEdit
      ? "Your role does not allow this."
      : row.builtIn
        ? "Built-in roles cannot be changed."
        : undefined;

  const columns: Column<RoleRow>[] = [
    {
      key: "role",
      width: "25%",
      header: table.header("role", "Role"),
      render: (row) => <RolePill name={row.name} color={row.color} />,
    },
    {
      key: "permissions",
      header: table.header("permissions", "Permissions"),
      render: (row) => (
        <span className="admin-role-perms">
          {row.permissions.length > 0 ? row.permissions.join(", ") : "-"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "112px",
      render: (row) => {
        const locked = lockedReason(row);
        const held =
          row.holders > 0
            ? `${row.holders} account${row.holders === 1 ? "" : "s"} hold this role: remove it from them first.`
            : undefined;
        return (
          <span className="admin-role-actions">
            <Button
              variant="ghost"
              size="icon"
              icon="trash"
              className="admin-role-delete"
              aria-label={`Delete ${row.name}`}
              title={locked ?? held ?? `Delete ${row.name}`}
              disabled={locked !== undefined || held !== undefined}
              onClick={() => {
                setError(null);
                setDeleting(row);
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              icon="edit"
              aria-label={`Edit ${row.name}`}
              title={locked ?? `Edit ${row.name}`}
              disabled={locked !== undefined}
              onClick={() => setEditing(row)}
            />
          </span>
        );
      },
    },
  ];

  return (
    <div className="admin-role-manager">
      <div className="admin-page-header admin-events-header">
        <div>
          <h1 className="admin-page-header__title admin-role-title">
            {canSeePeople ? <Link href="/roles">Role Manager</Link> : "Role Manager"}
            <span aria-hidden="true"> &gt; </span>
            Edit Role
          </h1>
          <p className="admin-page-header__desc">PPIDK Asiania Role Management System</p>
        </div>
        <div className="admin-page-header__actions">
          <div className="admin-fab">
            {canEdit ? (
              <Button variant="outline" size="sm" icon="plus" onClick={() => setEditing("new")}>
                Add New Role
              </Button>
            ) : null}
          </div>
          <SortMenu columns={columns} />
          <SearchBox
            key={searchKey}
            placeholder="Search by role..."
            label="Search roles by name or permission"
            onSearch={(value) => {
              setQuery(value);
              table.setPage(1);
            }}
          />
        </div>
      </div>

      <ListCard
        table={table}
        noun="role"
        columns={columns}
        empty={
          <ListEmpty
            noun="role"
            query={query}
            filters={0}
            emptyHint="Add the first role with Add New Role."
            onClear={() => {
              setQuery("");
              setSearchKey((k) => k + 1);
            }}
            addLabel="Add New Role"
            onAdd={canEdit ? () => setEditing("new") : null}
          />
        }
      />

      {editing ? (
        <RoleModal
          key={editing === "new" ? "new" : editing.id}
          role={editing === "new" ? null : editing}
          reauthUrl={reauthUrl}
          onClose={() => setEditing(null)}
          onDone={(text) => {
            setEditing(null);
            toast.show(text);
          }}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this role?"
        confirmLabel="Delete"
        icon="trash"
        pending={busy}
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
      >
        Nobody holds {deleting?.name}. It disappears from Role Manager; the audit log keeps its
        history.
        <ActionError text={error} reauthUrl={reauthUrl} />
      </ConfirmDialog>
      <ToastBanner message={toast.message} />
    </div>
  );
}

function RoleModal({
  role,
  reauthUrl,
  onClose,
  onDone,
}: {
  role: RoleRow | null;
  reauthUrl: string | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(role?.name ?? "");
  const [color, setColor] = useState<RoleColor>(
    (ROLE_COLORS as readonly string[]).includes(role?.color ?? "")
      ? (role?.color as RoleColor)
      : ROLE_COLORS[0],
  );
  const [initial] = useState(() => splitPermissions(role?.permissions ?? []));
  const [pages, setPages] = useState<ReadonlySet<string>>(initial.pages);
  const [single, setSingle] = useState<ReadonlySet<string>>(initial.single);
  const permissions = joinPermissions(pages, single);
  const toggle = (set: ReadonlySet<string>, value: string) => {
    const next = new Set(set);
    if (!next.delete(value)) next.add(value);
    return next;
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Readonly<Record<string, string>>>({});
  const [tried, setTried] = useState(false);
  const noPermissions = permissions.length === 0;

  const submit = async () => {
    setTried(true);
    if (noPermissions) return;
    setBusy(true);
    setError(null);
    const result = await saveRoleAction({
      ...(role ? { id: role.id } : {}),
      name,
      color,
      permissions,
      version: role?.version ?? null,
    });
    setBusy(false);
    if (!result.ok) {
      setFields(result.fields ?? {});
      return setError(actionMessage(result));
    }
    router.refresh();
    onDone(role ? `Role ${name.trim()} saved` : `Role ${name.trim()} created`);
  };

  return (
    <Modal
      open
      title={role ? "Edit Role" : "Create Role"}
      className="admin-modal--side"
      width={548}
      hideClose
      onClose={onClose}
      footer={
        <Footer onCancel={onClose}>
          <Button variant="primary" type="submit" form="role-form" loading={busy}>
            {role ? "Save Role" : "Create Role"}
          </Button>
        </Footer>
      }
    >
      <form
        id="role-form"
        className="admin-role-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="admin-field">
          <label className="admin-field__label" htmlFor="role-name">
            Role Name *
          </label>
          <input
            id="role-name"
            className="admin-input"
            required
            minLength={2}
            maxLength={60}
            placeholder="e.g BPH"
            value={name}
            onChange={(e) => setName(e.target.value)}
            {...(fields["name"] ? { "aria-invalid": true } : {})}
            aria-describedby="role-name-error"
          />
          <FieldError id="role-name-error" message={fields["name"]} />
        </div>

        <div className="admin-field">
          <span className="admin-field__label">Preview</span>
          <span>
            <RolePill name={name.trim() || "BPH"} color={color} />
          </span>
        </div>

        <div className="admin-field">
          <span className="admin-field__label" id="role-color-label">
            Color *
          </span>
          <div className="admin-role-swatches" role="radiogroup" aria-labelledby="role-color-label">
            {ROLE_COLORS.map((swatch) => (
              <button
                key={swatch}
                type="button"
                role="radio"
                aria-checked={swatch === color}
                aria-label={`Colour ${swatch}`}
                className="admin-role-swatch"
                style={{ "--role-color": swatch } as CSSProperties}
                onClick={() => setColor(swatch)}
              />
            ))}
          </div>
        </div>

        <fieldset className="admin-field admin-role-tree">
          <legend className="admin-field__label">Permissions *</legend>
          {pages.size + single.size > 0 ? (
            <span className="admin-role-pills">
              {PERMISSION_GROUPS.filter((g) => pages.has(g.page)).map((group) => (
                <RemovableChip
                  key={group.page}
                  label={group.label}
                  onRemove={() => setPages((set) => toggle(set, group.page))}
                />
              ))}
              {PERMISSION_GROUPS.flatMap((g) => g.permissions)
                .filter((p) => single.has(p.value))
                .map((permission) => (
                  <RemovableChip
                    key={permission.value}
                    label={permission.label}
                    onRemove={() => setSingle((set) => toggle(set, permission.value))}
                  />
                ))}
            </span>
          ) : null}
          <PermissionPicker
            pages={pages}
            single={single}
            onTogglePage={(page) => setPages((set) => toggle(set, page))}
            onTogglePermission={(value) => setSingle((set) => toggle(set, value))}
          />
          {tried && noPermissions ? (
            <p role="alert" className="admin-field__error">
              Choose at least one permission.
            </p>
          ) : (
            <p className="admin-role-note">
              A ticked page gives all its permissions. Edit includes read; an extra (publish,
              export…) also includes read.
            </p>
          )}
        </fieldset>
        <ActionError text={error} reauthUrl={reauthUrl} />
      </form>
    </Modal>
  );
}

function PermissionPicker({
  pages,
  single,
  onTogglePage,
  onTogglePermission,
}: {
  pages: ReadonlySet<string>;
  single: ReadonlySet<string>;
  onTogglePage: (page: string) => void;
  onTogglePermission: (value: string) => void;
}) {
  const panelId = useId();
  const { trigger, box, open, position, show, hide } = useDropdown<HTMLButtonElement>();
  const [query, setQuery] = useState("");
  const groups = filterPermissionGroups(PERMISSION_GROUPS, query);

  return (
    <div
      className="admin-combo admin-role-picker"
      ref={box}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        hide();
        trigger.current?.focus();
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="admin-select admin-combo__trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          if (open) return hide();
          setQuery("");
          show();
        }}
      >
        <span className="admin-combo__value">Add more permissions</span>
        <Icon name="chevronDown" size={14} />
      </button>
      {open ? (
        <div
          id={panelId}
          className="admin-row-menu__panel admin-combo__panel admin-role-picker__panel"
          style={position}
        >
          <input
            className="admin-input admin-combo__search"
            type="search"
            placeholder="Search permissions…"
            aria-label="Search permissions"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {groups.length === 0 ? <p className="admin-combo__empty">No matches</p> : null}
          <ul className="admin-role-tree__pages">
            {groups.map((group) => {
              const whole = pages.has(group.page);
              const some = PERMISSION_GROUPS.find((g) => g.page === group.page)?.permissions.some(
                (p) => single.has(p.value),
              );
              return (
                <li key={group.page}>
                  <label
                    className="admin-radio admin-role-tree__page"
                    title={
                      some ? "Untick its single permissions to tick the whole page." : undefined
                    }
                  >
                    <input
                      type="checkbox"
                      checked={whole}
                      disabled={some}
                      onChange={() => onTogglePage(group.page)}
                    />
                    {group.label}
                  </label>
                  <ul className="admin-role-tree__perms">
                    {group.permissions.map((permission) => (
                      <li key={permission.value}>
                        <label className="admin-radio">
                          <input
                            type="checkbox"
                            checked={whole || single.has(permission.value)}
                            disabled={whole}
                            onChange={() => onTogglePermission(permission.value)}
                          />
                          {permission.label}
                        </label>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
