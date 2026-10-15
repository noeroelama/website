import { can, isSystemRoleId } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { Badge } from "@/components/ui/badge";
import { Fab } from "@/components/ui/fab";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { label, ROLE_TYPE_LABELS } from "@/labels";
import { requireAdminViewer, signInAgainUrl } from "@/server/context";
import { adminReads } from "@/server/wiring";
import { SuggestedRolesButton } from "./role-forms";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

export default async function RolesPage() {
  const viewer = await requireAdminViewer("/roles", "roles.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const roles = await adminReads.listRoles();
  const holders = await adminReads.countHolders(roles.map((r) => r.id));
  const canEdit = can(viewer.principal, "roles.edit");
  const rows = roles.map((role) => ({
    id: role.id,
    name: role.name,
    permissions: role.permissions.length,
    holders: holders.get(role.id) ?? 0,
    builtIn: isSystemRoleId(role.id),
  }));

  return (
    <>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Roles</h1>
          <p className="admin-page-header__desc">
            A role is a set of page permissions (read, edit and extras). Give roles to people on the
            Users page. Built-in roles cannot be changed.
          </p>
        </div>
        {canEdit ? (
          <div className="admin-toolbar__actions">
            <SuggestedRolesButton reauthUrl={signInAgainUrl("/roles")} />
          </div>
        ) : null}
      </div>
      <Card>
        <CardBody flush>
          <DataTable
            rowKey={(row) => row.id}
            rows={rows}
            columns={[
              {
                key: "name",
                header: "Role",
                render: (row) => <a href={`/roles/${row.id}`}>{row.name}</a>,
              },
              { key: "permissions", header: "Permissions", align: "right" },
              { key: "holders", header: "Holders", align: "right" },
              {
                key: "type",
                header: "Type",
                render: (row) =>
                  row.builtIn ? (
                    <Badge tone="primary">{label(ROLE_TYPE_LABELS, "builtIn")}</Badge>
                  ) : (
                    <Badge>{label(ROLE_TYPE_LABELS, "custom")}</Badge>
                  ),
              },
            ]}
          />
        </CardBody>
      </Card>
      {canEdit ? <Fab href="/roles/new" label="New role" /> : null}
    </>
  );
}
