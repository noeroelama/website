import { WorkflowGuide } from "@website/ui";
import { WORKFLOWS } from "@/components/workflow-guides";
import { orgUnitPath } from "@website/domain/organizations";
import { can, canInSomeScope, scopedOrgUnitIds } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { toLetterItem } from "@/components/letters-model";
import { LettersPage } from "@/components/letters-page";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

/** The newest letters of the active period the viewer covers (unit-scoped staff: their units). */
const LIMIT = 300;

export default async function AdminLettersPage() {
  const viewer = await requireAdminViewer("/letters", "letters.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const { principal } = viewer;
  const periods = await adminReads.listPeriods();
  const period = periods.find((p) => p.status === "active") ?? null;
  const [types, units, page] = await Promise.all([
    adminReads.listLetterTypes(),
    period ? adminReads.listOrgUnits(period.id) : Promise.resolve([]),
    period
      ? adminReads.listLetters({
          periodId: period.id,
          orgUnitIds: scopedOrgUnitIds(principal, "letters.read"),
          limit: LIMIT,
        })
      : Promise.resolve({ items: [], nextCursor: null }),
  ]);
  const people = await adminReads.getUsers([
    ...new Set(
      page.items.flatMap((l) =>
        [l.createdBy, l.secretary?.uid, l.coordinator?.uid].filter((u): u is string => !!u),
      ),
    ),
  ]);
  const names = new Map([...people].map(([uid, u]) => [uid, u.name ?? u.email ?? uid]));
  const typeById = new Map(types.map((t) => [t.id, t]));
  const unitName = new Map(units.map((u) => [u.id, u.name]));
  return (
    <>
      <WorkflowGuide id="letters" flow={WORKFLOWS.letters} />
      <LettersPage
        periodName={period?.name ?? null}
        truncated={page.nextCursor !== null}
        initial={page.items.map((l) =>
          toLetterItem(
            l,
            typeById.get(l.typeId),
            unitName.get(l.orgUnitId) ?? "",
            names,
            can(principal, "letters.edit", { orgUnitPath: l.orgUnitPath }),
          ),
        )}
        types={types
          .filter((t) => t.active)
          .map((t) => ({
            id: t.id,
            name: t.name,
            code: t.code,
            requiresRecipient: t.requiresRecipient,
            requiresCoordinator: t.requiresCoordinator,
          }))}
        units={units
          .filter(
            (u) => u.active && can(principal, "letters.edit", { orgUnitPath: orgUnitPath(u) }),
          )
          .map((u) => ({ id: u.id, name: u.name }))}
        viewerId={principal.userId}
        desks={{
          review: canInSomeScope(principal, "letters.review"),
          sign: canInSomeScope(principal, "letters.sign"),
          signCoordinator: canInSomeScope(principal, "letters.sign_coordinator"),
          issue: canInSomeScope(principal, "letters.issue"),
          cancel: canInSomeScope(principal, "letters.cancel"),
        }}
        canWrite={canInSomeScope(principal, "letters.edit")}
        canManageTypes={canInSomeScope(principal, "letter_types.read")}
      />
    </>
  );
}
