import { mergeCandidates } from "@website/domain/members";
import { can } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { formatUtc } from "@/components/format";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";
import { ReviewQueue, type ProposalRow } from "./review-queue";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

/** Universities: campuses proposed by members, waiting for review (A3). */
export default async function UniversitiesPage() {
  const viewer = await requireAdminViewer("/universities", "universities.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  if (!can(viewer.principal, "universities.read")) return <AccessMessage reason="no-access" />;
  const pending = await adminReads.listPendingUniversities();
  const countries = [...new Set(pending.map((u) => u.countryCode))];
  const approved = new Map(
    await Promise.all(
      countries.map(async (c) => [c, await adminReads.listApprovedUniversities(c)] as const),
    ),
  );
  const rows: ProposalRow[] = pending.map((u) => ({
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
  }));

  return (
    <>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Universities</h1>
          <p className="admin-page-header__desc">
            Campuses members proposed because they were not listed. Approve a real campus, merge a
            duplicate into the listed one (members follow it), or reject.
          </p>
        </div>
      </div>
      <ReviewQueue rows={rows} canEdit={can(viewer.principal, "universities.edit")} />
    </>
  );
}
