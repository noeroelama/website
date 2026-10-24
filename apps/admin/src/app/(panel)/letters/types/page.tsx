import { canInSomeScope } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { LetterTypesPage } from "@/components/letter-types-page";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

export default async function AdminLetterTypesPage() {
  const viewer = await requireAdminViewer("/letters/types", "letter_types.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const types = await adminReads.listLetterTypes();
  return (
    <LetterTypesPage
      initial={types.map((t) => ({
        id: t.id,
        version: t.version,
        name: t.name,
        code: t.code,
        description: t.description,
        numberFormat: t.numberFormat,
        numberPadding: t.numberPadding,
        requiresCoordinator: t.requiresCoordinator,
        requiresRecipient: t.requiresRecipient,
        contentPublic: t.contentPublic,
        active: t.active,
        sort: t.sort,
      }))}
      canEdit={canInSomeScope(viewer.principal, "letter_types.edit")}
    />
  );
}
