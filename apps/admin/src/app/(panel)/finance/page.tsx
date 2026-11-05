import { WorkflowGuide } from "@website/ui";
import { WORKFLOWS } from "@/components/workflow-guides";
import { orgUnitPath } from "@website/domain/organizations";
import { can, canInSomeScope, scopedOrgUnitIds } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { toFinanceItem } from "@/components/finance-model";
import { FinancePage } from "@/components/finance-page";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

/** The newest requests of the active period the viewer covers (unit-scoped staff: their units). */
const LIMIT = 300;

export default async function AdminFinancePage() {
  const viewer = await requireAdminViewer("/finance", "finance.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const { principal } = viewer;
  const periods = await adminReads.listPeriods();
  const period = periods.find((p) => p.status === "active") ?? null;
  const [units, requests] = period
    ? await Promise.all([
        adminReads.listOrgUnits(period.id),
        adminReads.listFinance({
          periodId: period.id,
          orgUnitIds: scopedOrgUnitIds(principal, "finance.read"),
          limit: LIMIT,
        }),
      ])
    : [[], []];
  const people = await adminReads.getUsers([
    ...new Set(
      requests.flatMap((r) =>
        [r.createdBy, r.treasurer?.uid, r.coordinator?.uid, r.payment?.uid].filter(
          (u): u is string => !!u,
        ),
      ),
    ),
  ]);
  const names = new Map([...people].map(([uid, u]) => [uid, u.name ?? u.email ?? uid]));
  const unitName = new Map(units.map((u) => [u.id, u.name]));
  return (
    <>
      <WorkflowGuide id="finance" flow={WORKFLOWS.finance} />
      <FinancePage
        periodName={period?.name ?? null}
        initial={requests.map((r) =>
          toFinanceItem(r, names, unitName.get(r.orgUnitId) ?? "", principal.userId),
        )}
        units={units
          .filter(
            (u) => u.active && can(principal, "finance.edit", { orgUnitPath: orgUnitPath(u) }),
          )
          .map((u) => ({ id: u.id, name: u.name }))}
        desks={{
          edit: canInSomeScope(principal, "finance.edit"),
          review: canInSomeScope(principal, "finance.review"),
          authorize: canInSomeScope(principal, "finance.authorize"),
          pay: canInSomeScope(principal, "finance.pay"),
          cashbook: can(principal, "finance.cashbook") || can(principal, "finance.export"),
        }}
      />
    </>
  );
}
