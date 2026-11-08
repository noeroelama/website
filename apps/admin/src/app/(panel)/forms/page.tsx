import { can } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { authorsById, lastEditors } from "@/components/authors";
import { toFormItem } from "@/components/forms-model";
import { FormsPage } from "@/components/forms-page";
import { requireAdminViewer } from "@/server/context";
import { getAppUrls } from "@/server/env";
import { adminReads } from "@/server/wiring";

export const instant = false;

const AUTHOR_HISTORY = 500;

export default async function AdminFormsPage() {
  const viewer = await requireAdminViewer("/forms", "forms.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const [forms, history] = await Promise.all([
    adminReads.listForms(),
    adminReads.listAudit({ module: "forms", limit: AUTHOR_HISTORY }),
  ]);
  const editors = lastEditors(history.items, "form");
  const [versions, users] = await Promise.all([
    adminReads.currentFormVersions(forms),
    adminReads.getUsers([...new Set([...editors.values()].map((a) => a.id))]),
  ]);
  const authors = authorsById(editors, users);
  return (
    <FormsPage
      initial={forms.map((f) => toFormItem(f, versions.get(f.id), authors.get(f.id) ?? null))}
      canEdit={can(viewer.principal, "forms.edit")}
      canPublish={can(viewer.principal, "forms.publish")}
      canSeeResponses={can(viewer.principal, "forms.responses")}
      publicBase={getAppUrls().WEB_URL ?? ""}
    />
  );
}
