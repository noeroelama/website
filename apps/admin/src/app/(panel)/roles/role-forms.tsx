"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { actionMessage } from "@/components/action-message";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { addSuggestedRolesAction, deleteRoleAction, saveRoleAction } from "./actions";

/** Error text plus, when the action needs a fresh sign-in, the link to do it. */
export function ActionError({
  text,
  reauthUrl,
}: {
  text: string | null;
  reauthUrl?: string | null;
}) {
  if (!text) return null;
  return (
    <p role="alert" className="admin-sign-out-error">
      {text}{" "}
      {reauthUrl && text.startsWith("For your security") ? (
        <a href={reauthUrl}>Sign in again</a>
      ) : null}
    </p>
  );
}

export function SuggestedRolesButton({ reauthUrl }: { reauthUrl: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <>
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await addSuggestedRolesAction();
            if (!result.ok) return setMessage(actionMessage(result));
            setMessage(
              result.data.added.length > 0
                ? `Added: ${result.data.added.join(", ")}.`
                : "All suggested roles exist already.",
            );
            router.refresh();
          })
        }
      >
        Add suggested roles
      </Button>
      <ActionError text={message} reauthUrl={reauthUrl} />
    </>
  );
}

export interface PermissionGroup {
  readonly page: string;
  readonly label: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
}

export function RoleForm(props: {
  readonly role: {
    readonly id: string | null;
    readonly name: string;
    readonly permissions: readonly string[];
    readonly version: number | null;
  };
  readonly groups: readonly PermissionGroup[];
  readonly holders: number;
  readonly reauthUrl: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(props.role.name);
  const [checked, setChecked] = useState(() => new Set(props.role.permissions));
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const toggle = (value: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });

  const save = () =>
    start(async () => {
      const result = await saveRoleAction({
        ...(props.role.id === null ? {} : { id: props.role.id }),
        name,
        permissions: [...checked],
        version: props.role.version,
      });
      if (!result.ok) return setError(actionMessage(result));
      router.push(`/roles/${result.data.id}`);
      router.refresh();
    });

  const remove = () =>
    start(async () => {
      if (props.role.id === null || props.role.version === null) return;
      const result = await deleteRoleAction({ id: props.role.id, version: props.role.version });
      setConfirming(false);
      if (!result.ok) return setError(actionMessage(result));
      router.push("/roles");
      router.refresh();
    });

  return (
    <form
      className="admin-tools-form"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <label className="admin-field">
        <span className="admin-field__label">Role name</span>
        <input
          className="admin-input"
          required
          minLength={2}
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <p className="admin-page-header__desc">
        Edit includes read. Any extra (publish, export…) also includes read.
      </p>
      <div className="admin-form-grid">
        {props.groups.map((group) => (
          <fieldset key={group.page} className="admin-field">
            <legend className="admin-field__label">{group.label}</legend>
            {group.options.map((option) => (
              <label key={option.value} className="admin-checkbox">
                <input
                  type="checkbox"
                  checked={checked.has(option.value)}
                  onChange={() => toggle(option.value)}
                />
                {option.label}
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <ActionError text={error} reauthUrl={props.reauthUrl} />
      <div className="admin-form-actions">
        {props.role.id !== null ? (
          <Button
            type="button"
            variant="danger"
            disabled={pending || props.holders > 0}
            title={props.holders > 0 ? "Remove the role from every account first" : undefined}
            onClick={() => setConfirming(true)}
          >
            Move to trash
          </Button>
        ) : null}
        <div className="admin-form-actions__right">
          <Button href="/roles" variant="ghost">
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            Save role
          </Button>
        </div>
      </div>
      <Modal
        open={confirming}
        title="Move this role to trash?"
        onClose={() => setConfirming(false)}
        footer={
          <div className="admin-modal__footer-row admin-modal__footer-row--end">
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={pending} onClick={remove}>
              Move to trash
            </Button>
          </div>
        }
      >
        <p className="admin-delete-confirm__message">
          Nobody holds this role. It disappears from the Roles page; the audit log keeps its
          history.
        </p>
      </Modal>
    </form>
  );
}
