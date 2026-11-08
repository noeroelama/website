import { cashReport, ReportRangeSchema } from "@website/domain/finance";
import { can } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { CashbookPage } from "@/components/cashbook-page";
import { toCashSections } from "@/components/finance-model";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

export const instant = false;

export default async function AdminCashbookPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireAdminViewer("/finance/cashbook", "finance.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const { principal } = viewer;
  const canWrite = can(principal, "finance.cashbook");
  const canExport = can(principal, "finance.export");
  if (!canWrite && !canExport) return <AccessMessage reason="no-access" />;
  const params = await searchParams;
  const text = (key: string) => (typeof params[key] === "string" ? params[key] : null) || null;
  const parsed = ReportRangeSchema.safeParse({ from: text("from"), to: text("to") });
  const range = parsed.success ? parsed.data : { from: null, to: null };
  const periods = await adminReads.listPeriods();
  const period = periods.find((p) => p.status === "active") ?? null;
  const entries = period ? await adminReads.listCashEntries(period.id) : [];
  return (
    <CashbookPage
      periodName={period?.name ?? null}
      range={range}
      rangeError={parsed.success ? null : (parsed.error.issues[0]?.message ?? null)}
      sections={toCashSections(cashReport(entries, range))}
      canWrite={canWrite}
      canExport={canExport}
    />
  );
}
