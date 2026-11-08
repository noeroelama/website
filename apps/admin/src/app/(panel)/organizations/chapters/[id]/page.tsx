import { notFound } from "next/navigation";
import { officerWarning, quarterOf, shiftQuarter } from "@website/domain/organizations";
import { can } from "@website/permissions";
import { safeId } from "@website/security/validation";
import { AccessMessage } from "@/components/access-message";
import { ChapterRecordsPage } from "@/components/chapter-records-page";
import { formatUtc } from "@/components/format";
import { requireAdminViewer } from "@/server/context";
import { adminReads, chapterRecords } from "@/server/wiring";

export const instant = false;

export default async function ChapterRecordsRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireAdminViewer(`/organizations/chapters/${id}`, "organizations.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  if (!safeId.safeParse(id).success) notFound();
  const chapter = await adminReads.getChapter(id);
  if (!chapter || chapter.deletedAt) notFound();
  if (!can(viewer.principal, "organizations.read", { chapterId: id })) notFound();
  const [officers, reports, signals] = await Promise.all([
    adminReads.chapterOfficers(id),
    adminReads.chapterReports(id),
    chapterRecords().signals([chapter]),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const current = quarterOf(today);
  return (
    <ChapterRecordsPage
      chapter={{ id: chapter.id, name: chapter.name }}
      signal={signals.get(chapter.id) ?? null}
      officers={officers.map((o) => ({ ...o, warning: officerWarning(o, today) }))}
      reports={reports.map((r) => ({
        quarter: r.quarter,
        activeMembers: r.activeMembers,
        activities: r.activities,
        obstacles: r.obstacles,
        submittedAt: formatUtc(r.submittedAt),
        filledByCentre: r.filledByCentre,
      }))}
      quarters={[current, shiftQuarter(current, -1), shiftQuarter(current, -2)]}
      canEdit={can(viewer.principal, "organizations.edit", { chapterId: id })}
    />
  );
}
