"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Scope } from "@website/permissions";
import { ActionError } from "@/components/action-error";
import { actionMessage, type ActionFailure } from "@/components/action-message";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { label, SCOPE_LABELS } from "@/labels";
import { assignRoleAction, revokeRoleAction, setStatusAction } from "../actions";

export function UserRoleEditor(props: {
  readonly uid: string;
  readonly version: number;
  readonly status: "active" | "inactive";
  readonly assignments: readonly {
    roleId: string;
    roleName: string;
    scope: Scope;
    periodId: string | null;
    revoked: boolean;
  }[];
  readonly roles: readonly { id: string; name: string }[];
  readonly canEdit: boolean;
  readonly reauthUrl: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [roleId, setRoleId] = useState(props.roles[0]?.id ?? "");
  const [chapterId, setChapterId] = useState("");
  const [orgUnitId, setOrgUnitId] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [confirmStatus, setConfirmStatus] = useState(false);

  const run = (action: () => Promise<{ ok: true } | ActionFailure>) =>
    start(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) return setError(actionMessage(result));
      router.refresh();
    });
  const base = { uid: props.uid, version: props.version };
  const scopeLabel = (scope: Scope) =>
    scope.type === "global"
      ? label(SCOPE_LABELS, "global")
      : scope.type === "chapter"
        ? `${label(SCOPE_LABELS, "chapter")} ${scope.chapterId}`
        : `${label(SCOPE_LABELS, "orgUnit")} ${scope.orgUnitId}`;
  const rowLabel = (a: (typeof props.assignments)[number]) =>
    [
      `${a.roleName} — ${scopeLabel(a.scope)}`,
      a.periodId ? ` · ${a.periodId}` : "",
      a.revoked ? " · ended" : "",
    ].join("");

  return (
    <>
      <ul className="admin-form-separator__list">
        {props.assignments.map((a) => (
          <li key={rowLabel(a)} className="admin-account__row">
            <span>{rowLabel(a)}</span>
            {props.canEdit && !a.revoked ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  run(() =>
                    revokeRoleAction({
                      ...base,
                      roleId: a.roleId,
                      scope: a.scope,
                      periodId: a.periodId,
                    }),
                  )
                }
              >
                Remove
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {props.canEdit ? (
        <form
          className="admin-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            const scope: Scope = orgUnitId.trim()
              ? { type: "orgUnit", orgUnitId: orgUnitId.trim() }
              : chapterId.trim()
                ? { type: "chapter", chapterId: chapterId.trim() }
                : { type: "global" };
            run(() =>
              assignRoleAction({ ...base, roleId, scope, periodId: periodId.trim() || null }),
            );
          }}
        >
          <select
            className="admin-select"
            aria-label="Role"
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
          >
            {props.roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
          <input
            className="admin-input"
            aria-label="Chapter id (empty = all chapters)"
            placeholder="Chapter id (empty = all chapters)"
            value={chapterId}
            onChange={(e) => setChapterId(e.target.value)}
          />
          <input
            className="admin-input"
            aria-label="Unit id (optional)"
            placeholder="Unit id (optional)"
            value={orgUnitId}
            onChange={(e) => setOrgUnitId(e.target.value)}
          />
          <input
            className="admin-input"
            aria-label="Period id (empty = any period)"
            placeholder="Period id (empty = any period)"
            value={periodId}
            onChange={(e) => setPeriodId(e.target.value)}
          />
          <Button type="submit" disabled={pending}>
            Give role
          </Button>
        </form>
      ) : null}
      <ActionError text={error} reauthUrl={props.reauthUrl} />
      {props.canEdit ? (
        <div className="admin-form-actions">
          <Button
            variant={props.status === "active" ? "danger" : "success"}
            disabled={pending}
            onClick={() => setConfirmStatus(true)}
          >
            {props.status === "active" ? "Deactivate account" : "Reactivate account"}
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmStatus}
        title={props.status === "active" ? "Deactivate this account?" : "Reactivate this account?"}
        confirmLabel={props.status === "active" ? "Deactivate" : "Reactivate"}
        tone={props.status === "active" ? "danger" : "success"}
        pending={pending}
        onCancel={() => setConfirmStatus(false)}
        onConfirm={() => {
          setConfirmStatus(false);
          run(() =>
            setStatusAction({ ...base, status: props.status === "active" ? "inactive" : "active" }),
          );
        }}
      >
        {props.status === "active"
          ? "The person is signed out everywhere and cannot sign in until the account is reactivated."
          : "The person can sign in again with the roles the account still has."}
      </ConfirmDialog>
    </>
  );
}
