import { ACCOUNT_STATUSES, can } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { formatUtc } from "@/components/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { label, SCOPE_LABELS, USER_STATUS_LABELS } from "@/labels";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

export const instant = false;

const PAGE_SIZE = 25;
const one = (value: string | string[] | undefined) =>
  typeof value === "string" && value.length > 0 ? value : undefined;

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireAdminViewer("/users", "users.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  // Account lists are global for now; chapter-scoped lists come with the chapter scope rules.
  if (!can(viewer.principal, "users.read")) return <AccessMessage reason="no-access" />;

  const params = await searchParams;
  const roleId = one(params["role"]);
  const status = one(params["status"]);
  const cursor = one(params["cursor"]);
  const [roles, page] = await Promise.all([
    adminReads.listRoles(),
    adminReads.listUsers({
      roleId,
      status: ACCOUNT_STATUSES.find((s) => s === status),
      cursor,
      limit: PAGE_SIZE,
    }),
  ]);
  const roleName = new Map(roles.map((r) => [r.id, r.name]));
  const next = new URLSearchParams({
    ...(roleId ? { role: roleId } : {}),
    ...(status ? { status } : {}),
    ...(page.nextCursor ? { cursor: page.nextCursor } : {}),
  });

  return (
    <>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Users</h1>
          <p className="admin-page-header__desc">
            Every account that has signed in. Open one to give or remove roles, or to deactivate it.
          </p>
        </div>
      </div>
      <form className="admin-toolbar" method="get">
        <select className="admin-select" name="role" defaultValue={roleId ?? ""} aria-label="Role">
          <option value="">All roles</option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
        <select
          className="admin-select"
          name="status"
          defaultValue={status ?? ""}
          aria-label="Status"
        >
          <option value="">Any status</option>
          {ACCOUNT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {label(USER_STATUS_LABELS, value)}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>
      <Card>
        <CardBody flush>
          <DataTable
            rowKey={(row) => row.uid}
            rows={page.items}
            emptyText="No accounts match these filters"
            columns={[
              {
                key: "account",
                header: "Account",
                render: (row) => (
                  <a href={`/users/${row.uid}`}>
                    <span className="admin-table__title">{row.name ?? row.email ?? row.uid}</span>
                    <span className="admin-table__sub">{row.email}</span>
                  </a>
                ),
              },
              {
                key: "status",
                header: "Status",
                render: (row) => (
                  <Badge tone={row.status === "active" ? "success" : "danger"}>
                    {label(USER_STATUS_LABELS, row.status)}
                  </Badge>
                ),
              },
              {
                key: "roles",
                header: "Roles",
                render: (row) =>
                  row.roleAssignments
                    .map(
                      (a) =>
                        `${roleName.get(a.roleId) ?? a.roleId}${
                          a.scope.type === "chapter"
                            ? ` (${label(SCOPE_LABELS, "chapter")} ${a.scope.chapterId})`
                            : ""
                        }`,
                    )
                    .join(", "),
              },
              {
                key: "lastSignInAt",
                header: "Last sign-in",
                render: (row) => formatUtc(row.lastSignInAt),
              },
            ]}
          />
        </CardBody>
      </Card>
      {page.nextCursor ? (
        <p>
          <Button href={`/users?${next.toString()}`} variant="outline">
            Load more
          </Button>
        </p>
      ) : null}
    </>
  );
}
