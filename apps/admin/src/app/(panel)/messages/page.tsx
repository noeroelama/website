import { can } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { formatUtc } from "@/components/format";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";
import { RetryButton } from "./retry-button";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireAdminViewer("/messages", "messages.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  if (!can(viewer.principal, "messages.read")) return <AccessMessage reason="no-access" />;
  const cursor = (await searchParams)["cursor"];
  const page = await adminReads.listFailedMessages(typeof cursor === "string" ? cursor : undefined);
  const canRetry = can(viewer.principal, "messages.edit");

  return (
    <>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Messages</h1>
          <p className="admin-page-header__desc">
            E-mails that could not be sent. Retry sends the same message again (same key, so the
            provider never delivers it twice).
          </p>
        </div>
      </div>
      <Card>
        <CardBody flush>
          <DataTable
            rowKey={(row) => row.id}
            rows={page.items}
            emptyText="No failed messages"
            columns={[
              {
                key: "subject",
                header: "Message",
                render: (row) => (
                  <>
                    <span className="admin-table__title">{row.subject}</span>
                    <span className="admin-table__sub">
                      {row.to} · {row.key}
                    </span>
                  </>
                ),
              },
              { key: "lastError", header: "Reason" },
              { key: "attempts", header: "Attempts", align: "right" },
              { key: "createdAt", header: "Created", render: (row) => formatUtc(row.createdAt) },
              {
                key: "actions",
                header: "",
                render: (row) => (canRetry ? <RetryButton id={row.id} /> : null),
              },
            ]}
          />
        </CardBody>
      </Card>
      {page.nextCursor ? (
        <p>
          <Button href={`/messages?cursor=${page.nextCursor}`} variant="outline">
            Load more
          </Button>
        </p>
      ) : null}
    </>
  );
}
