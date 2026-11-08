import { notFound } from "next/navigation";
import { responseTable } from "@website/domain/forms";
import { can } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { FormResponsesPage } from "@/components/form-responses-page";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

export const instant = false;

const SHOWN = 500;

export default async function FormResponsesRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireAdminViewer(`/forms/${id}/responses`, "forms.responses");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const form = await adminReads.getForm(id);
  if (!form || form.deletedAt) notFound();
  const [versions, responses] = await Promise.all([
    adminReads.listFormVersions(form.id),
    adminReads.listFormResponses(form.id, SHOWN),
  ]);
  const table = responseTable(versions, responses);
  return (
    <FormResponsesPage
      id={form.id}
      title={form.title}
      total={form.responseCount}
      header={table.header}
      rows={table.rows.map((cells, i) => ({ id: responses[i]?.id ?? String(i), cells }))}
      canExport={can(viewer.principal, "forms.export")}
    />
  );
}
