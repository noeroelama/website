import type { Metadata } from "next";
import { can } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { formatUtc } from "@/components/format";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { SURVEY_SOURCE_LABELS, surveySummary } from "@website/domain/messaging";
import { DataTable } from "@/components/ui/data-table";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";
import { RetryButton } from "./retry-button";

export const metadata: Metadata = { title: "Email", robots: { index: false } };

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

/** E-mails the system could not send, with Retry (was the Messages page). */
export default async function EmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireAdminViewer("/emails", "messages.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  if (!can(viewer.principal, "messages.read")) return <AccessMessage reason="no-access" />;
  const cursor = (await searchParams)["cursor"];
  const [page, surveys] = await Promise.all([
    adminReads.listFailedMessages(typeof cursor === "string" ? cursor : undefined),
    adminReads.surveysLastYear(),
  ]);
  const canRetry = can(viewer.principal, "messages.edit");

  return (
    <>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Email</h1>
          <p className="admin-page-header__desc">
            E-mails and WhatsApp messages that could not be sent. Retry sends the same message again
            (same key, so the provider never delivers it twice).
          </p>
        </div>
      </div>
      <Card className="admin-list-card">
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
                      {row.channel === "whatsapp"
                        ? // A WhatsApp number is restricted personal data: only its end is shown.
                          `WhatsApp ••••${(row.to ?? "").slice(-4)}`
                        : row.to}{" "}
                      · {row.key}
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
          <Button href={`/emails?cursor=${page.nextCursor}`} variant="outline">
            Load more
          </Button>
        </p>
      ) : null}
      <Card>
        <CardHeader
          title="Satisfaction (WhatsApp polls)"
          subtitle="Last 12 months, per notification source; 1-5 stars"
        />
        <CardBody flush>
          <DataTable
            rowKey={(row) => row.source}
            rows={surveySummary(surveys)}
            columns={[
              {
                key: "source",
                header: "Source",
                render: (row) => SURVEY_SOURCE_LABELS[row.source],
              },
              { key: "sent", header: "Asked", align: "right" },
              { key: "answered", header: "Answered", align: "right" },
              {
                key: "average",
                header: "Average",
                align: "right",
                render: (row) => (row.average === null ? "—" : `${row.average} ★`),
              },
              {
                key: "distribution",
                header: "1★ … 5★",
                render: (row) => row.distribution.join(" · "),
              },
            ]}
          />
        </CardBody>
      </Card>
    </>
  );
}
