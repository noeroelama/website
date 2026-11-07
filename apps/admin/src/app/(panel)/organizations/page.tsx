import { CHAPTER_SIGNAL_LABELS } from "@website/domain/organizations";
import { mergeCandidates } from "@website/domain/members";
import { can, scopedChapterIds } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { toChapterItem } from "@/components/chapters-model";
import { formatUtc } from "@/components/format";
import { OrganizationsPage, type OrgView } from "@/components/organizations-page";
import { toPeriodItem } from "@/components/periods-model";
import { requireAdminViewer } from "@/server/context";
import { adminReads, chapterRecords } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

const VIEWS: readonly OrgView[] = ["period", "ppi", "universities"];

export default async function OrganizationsRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireAdminViewer("/organizations", "organizations.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const params = await searchParams;
  const canReadPeriods = can(viewer.principal, "periods.read");
  const canReadUniversities = can(viewer.principal, "universities.read");
  const contactScope = scopedChapterIds(viewer.principal, "organizations.edit");
  const [chapters, periods, pending] = await Promise.all([
    adminReads.listChapters(),
    canReadPeriods ? adminReads.listPeriods() : null,
    canReadUniversities ? adminReads.listPendingUniversities() : null,
  ]);
  const signals = await chapterRecords().signals(chapters);
  const chapterItems = chapters.map(toChapterItem);

  // Universities tab: approved campuses of one PPI country (`?country=JP`), plus the review queue.
  let universities = null;
  if (pending) {
    const countries = [
      ...new Map(chapterItems.map((c) => [c.countryCode, c.country])).entries(),
    ].sort((a, b) => a[1].localeCompare(b[1]));
    const asked = typeof params["country"] === "string" ? params["country"].toUpperCase() : "";
    const country = countries.some(([code]) => code === asked) ? asked : (countries[0]?.[0] ?? "");
    const codes = [...new Set([country, ...pending.map((u) => u.countryCode)])].filter(Boolean);
    const approved = new Map(
      await Promise.all(
        codes.map(async (c) => [c, await adminReads.listApprovedUniversities(c)] as const),
      ),
    );
    universities = {
      country,
      countries: countries.map(([code, name]) => ({ code, name })),
      approved: (approved.get(country) ?? []).map((u) => ({
        id: u.id,
        name: u.name,
        city: u.city,
        source: u.source,
      })),
      requests: pending.map((u) => ({
        id: u.id,
        version: u.version,
        name: u.name,
        countryCode: u.countryCode,
        city: u.city,
        submittedBy: u.submittedBy,
        proposedAt: formatUtc(u.createdAt),
        candidates: mergeCandidates(u, approved.get(u.countryCode) ?? []).map((c) => ({
          id: c.id,
          name: c.name,
        })),
      })),
      canEdit: can(viewer.principal, "universities.edit"),
    };
  }

  const view = VIEWS.find((v) => v === params["view"]) ?? "period";
  return (
    <OrganizationsPage
      chapters={chapterItems}
      signals={Object.fromEntries(
        chapters.flatMap((c) => {
          const s = signals.get(c.id);
          return s ? [[c.id, CHAPTER_SIGNAL_LABELS[s.signal]]] : [];
        }),
      )}
      canEdit={can(viewer.principal, "organizations.edit")}
      contactEditIds={contactScope === "all" ? [] : contactScope}
      periods={periods?.map(toPeriodItem) ?? null}
      canEditPeriods={can(viewer.principal, "periods.edit")}
      universities={universities}
      initialView={view}
    />
  );
}
