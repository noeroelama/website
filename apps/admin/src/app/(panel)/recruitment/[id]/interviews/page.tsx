import { notFound } from "next/navigation";
import { can } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { InterviewsPage } from "@/components/interviews-page";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

export const instant = false;

export default async function InterviewsRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireAdminViewer(`/recruitment/${id}/interviews`, "recruitment.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const committee = ["recruitment.review", "recruitment.offer", "recruitment.confirm"] as const;
  if (!committee.some((p) => can(viewer.principal, p))) return <AccessMessage reason="no-access" />;
  const recruitment = await adminReads.getRecruitment(id);
  if (!recruitment || recruitment.deletedAt) notFound();
  const [slots, applications] = await Promise.all([
    adminReads.listInterviewSlots(recruitment.id),
    adminReads.listApplications(recruitment.id),
  ]);
  const booking = applications.filter((a) => a.status === "interview" && a.interview);
  const users = await adminReads.getUsers(booking.map((a) => a.userId));
  return (
    <InterviewsPage
      recruitment={{ id: recruitment.id, title: recruitment.title }}
      slots={slots.map((s) => ({
        id: s.id,
        startsAt: s.startsAt.toISOString(),
        durationMinutes: s.durationMinutes,
        capacity: s.capacity,
        booked: s.booked,
        location: s.location,
        applicants: booking
          .filter((a) => a.interview?.slotId === s.id)
          .map((a) => users.get(a.userId)?.name ?? users.get(a.userId)?.email ?? a.userId),
      }))}
      canEdit={can(viewer.principal, "recruitment.review")}
    />
  );
}
