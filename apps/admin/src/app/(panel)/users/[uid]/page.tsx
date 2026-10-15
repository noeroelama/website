import { notFound } from "next/navigation";
import { can } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { formatUtc } from "@/components/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { label, USER_STATUS_LABELS } from "@/labels";
import { requireAdminViewer, signInAgainUrl } from "@/server/context";
import { adminReads } from "@/server/wiring";
import { UserRoleEditor } from "./user-actions";

export const instant = false;

const PROVIDER_LABEL: Record<string, string> = {
  "google.com": "Google",
  password: "E-mail and password",
};

export default async function UserPage({ params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const viewer = await requireAdminViewer(`/users/${uid}`, "users.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  if (!can(viewer.principal, "users.read")) return <AccessMessage reason="no-access" />;
  const user = await adminReads.getUser(uid);
  if (!user) notFound();
  const [roles, methods] = await Promise.all([
    adminReads.listRoles(),
    adminReads.signInMethods(uid).catch(() => null),
  ]);
  const roleName = new Map(roles.map((r) => [r.id, r.name]));
  const self = viewer.principal.userId === uid;

  return (
    <>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">{user.name ?? user.email ?? user.uid}</h1>
          <p className="admin-page-header__desc">
            {user.email}{" "}
            <Badge tone={user.status === "active" ? "success" : "danger"}>
              {label(USER_STATUS_LABELS, user.status)}
            </Badge>
          </p>
        </div>
      </div>
      <Card>
        <CardHeader title="Account" />
        <CardBody>
          <dl className="admin-account__dl">
            <dt>Created</dt>
            <dd>{formatUtc(user.createdAt)}</dd>
            <dt>Last sign-in</dt>
            <dd>{formatUtc(user.lastSignInAt)}</dd>
            <dt>Sign-in methods</dt>
            <dd>
              {methods
                ? [
                    ...methods.providers.map((p) => PROVIDER_LABEL[p] ?? p),
                    ...(methods.passkeys > 0 ? [`${methods.passkeys} passkey(s)`] : []),
                    ...(methods.mfaFactors > 0 ? ["Two-step verification"] : []),
                  ].join(", ") || "—"
                : "Unavailable"}
            </dd>
          </dl>
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Roles"
          subtitle={
            self
              ? "You cannot change your own account."
              : "Staff roles need two sign-in methods on the account."
          }
        />
        <CardBody>
          <UserRoleEditor
            uid={user.uid}
            version={user.version}
            status={user.status}
            assignments={user.roleAssignments.map((a) => ({
              roleId: a.roleId,
              roleName: roleName.get(a.roleId) ?? a.roleId,
              scope: a.scope,
            }))}
            roles={roles.map((r) => ({ id: r.id, name: r.name }))}
            canEdit={can(viewer.principal, "users.edit") && !self}
            reauthUrl={signInAgainUrl(`/users/${uid}`)}
          />
        </CardBody>
      </Card>
    </>
  );
}
