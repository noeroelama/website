import { can, DEFAULT_ROLE_COLOR, scopedChapterIds } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { RoleManagerPeople } from "@/components/role-manager-page";
import { DEFAULT_ROLE_ID, inviteRow, personRow } from "@/components/role-manager-model";
import { requireAdminViewer, signInAgainUrl } from "@/server/context";
import { adminReads } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

/** Role Manager: everyone who holds a role (plus pending invites), by role. */
export default async function RoleManagerPage() {
  const viewer = await requireAdminViewer("/roles", "users.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  // Chapter-scoped staff see only their chapters' accounts (filtered in the query, A2).
  const chapters = scopedChapterIds(viewer.principal, "users.read");
  if (chapters !== "all" && chapters.length === 0) return <AccessMessage reason="no-access" />;

  const roles = await adminReads.listRoles();
  const roleIds = roles.map((r) => r.id).filter((id) => id !== DEFAULT_ROLE_ID);
  const [holders, invites] = await Promise.all([
    adminReads.listRoleHolders(roleIds, chapters === "all" ? undefined : chapters),
    // Invites belong to no chapter yet: only staff with users.read everywhere see them.
    chapters === "all" ? adminReads.listInvites() : [],
  ]);

  return (
    <RoleManagerPeople
      rows={[...holders.map(personRow), ...invites.map(inviteRow)]}
      roles={roles.map((r) => ({ id: r.id, name: r.name, color: r.color ?? DEFAULT_ROLE_COLOR }))}
      selfId={viewer.principal.userId}
      canEdit={can(viewer.principal, "users.edit")}
      canEditRoles={can(viewer.principal, "roles.read")}
      reauthUrl={signInAgainUrl("/roles")}
    />
  );
}
