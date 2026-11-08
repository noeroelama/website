import { can, DEFAULT_ROLE_COLOR, isSystemRoleId } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { RoleManagerRoles } from "@/components/role-manager-page";
import { requireAdminViewer, signInAgainUrl } from "@/server/context";
import { adminReads } from "@/server/wiring";

export const instant = false;

export default async function RoleManagerEditPage() {
  const viewer = await requireAdminViewer("/roles/edit", "roles.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const roles = await adminReads.listRoles();
  const holders = await adminReads.countHolders(roles.map((r) => r.id));

  return (
    <RoleManagerRoles
      roles={roles.map((role) => ({
        id: role.id,
        name: role.name,
        color: role.color ?? DEFAULT_ROLE_COLOR,
        permissions: [...role.permissions],
        version: "version" in role && typeof role.version === "number" ? role.version : null,
        holders: holders.get(role.id) ?? 0,
        builtIn: isSystemRoleId(role.id),
      }))}
      canEdit={can(viewer.principal, "roles.edit")}
      canSeePeople={can(viewer.principal, "users.read")}
      reauthUrl={signInAgainUrl("/roles/edit")}
    />
  );
}
