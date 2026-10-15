import { notFound } from "next/navigation";
import { ADMIN_PAGES, can, isSystemRoleId } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { requireAdminViewer, signInAgainUrl } from "@/server/context";
import { adminReads } from "@/server/wiring";
import { RoleForm, type PermissionGroup } from "../role-forms";

export const instant = false;

/** Checkbox groups: one per admin page (read, edit and its named extras). */
const GROUPS: PermissionGroup[] = Object.entries(ADMIN_PAGES).map(
  ([page, definition]: [string, { label: string; extras?: Record<string, string> }]) => ({
    page,
    label: definition.label,
    options: [
      { value: `${page}.read`, label: "Read" },
      { value: `${page}.edit`, label: "Edit" },
      ...Object.entries(definition.extras ?? {}).map(([extra, label]) => ({
        value: `${page}.${extra}`,
        label,
      })),
    ],
  }),
);

export default async function RolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireAdminViewer(`/roles/${id}`, "roles.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const isNew = id === "new";
  const role = isNew ? null : await adminReads.getRole(id);
  if (!isNew && role === null) notFound();
  const builtIn = role !== null && isSystemRoleId(role.id);
  const holders = role ? ((await adminReads.countHolders([role.id])).get(role.id) ?? 0) : 0;
  const editable = can(viewer.principal, "roles.edit") && !builtIn;

  return (
    <>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">{role?.name ?? "New role"}</h1>
          <p className="admin-page-header__desc">
            {builtIn ? <Badge tone="primary">Built-in — read only</Badge> : null}{" "}
            {role ? `${holders} account(s) hold this role.` : null}
          </p>
        </div>
      </div>
      <Card>
        <CardBody>
          {editable ? (
            <RoleForm
              role={{
                id: role?.id ?? null,
                name: role?.name ?? "",
                permissions: role?.permissions ?? [],
                version:
                  role && "version" in role && typeof role.version === "number"
                    ? role.version
                    : null,
              }}
              groups={GROUPS}
              holders={holders}
              reauthUrl={signInAgainUrl(`/roles/${id}`)}
            />
          ) : (
            <ul>
              {(role?.permissions ?? []).map((permission) => (
                <li key={permission}>{permission}</li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}
