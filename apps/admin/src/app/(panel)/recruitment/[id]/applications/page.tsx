import { notFound } from "next/navigation";
import { can } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { toApplicationItem } from "@/components/applications-model";
import { ApplicationsPage } from "@/components/applications-page";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

/**
 * Recruitment → Applications. Answers are personal data: only the committee (review, offer or
 * confirm permission) opens the queue; nothing here is cached.
 */
export default async function ApplicationsRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireAdminViewer(`/recruitment/${id}/applications`, "recruitment.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const committee = ["recruitment.review", "recruitment.offer", "recruitment.confirm"] as const;
  if (!committee.some((p) => can(viewer.principal, p))) return <AccessMessage reason="no-access" />;
  const recruitment = await adminReads.getRecruitment(id);
  if (!recruitment || recruitment.deletedAt) notFound();
  const [applications, revisions, version] = await Promise.all([
    adminReads.listApplications(recruitment.id),
    adminReads.listRevisions(recruitment.id),
    adminReads.getFormVersion(recruitment.formId, recruitment.formVersion),
  ]);
  const uids = [...new Set(applications.map((a) => a.userId))];
  const [users, personality] = await Promise.all([
    adminReads.getUsers(uids),
    adminReads.personalityResults(uids),
  ]);
  const now = new Date();
  return (
    <ApplicationsPage
      recruitment={{
        id: recruitment.id,
        title: recruitment.title,
        units: recruitment.units.map((u) => ({ id: u.orgUnitId, name: u.name })),
      }}
      initial={applications.map((a) =>
        toApplicationItem(
          a,
          recruitment,
          version?.questions ?? [],
          users.get(a.userId) ?? null,
          revisions,
          now,
          personality.get(a.userId) ?? null,
        ),
      )}
      canReview={can(viewer.principal, "recruitment.review")}
      canOffer={can(viewer.principal, "recruitment.offer")}
      canConfirm={can(viewer.principal, "recruitment.confirm")}
    />
  );
}
