import { notFound } from "next/navigation";
import { meetingStatus } from "@website/domain/meetings";
import { utcToWallTime } from "@website/domain/shared";
import { inTreeOrder, orgUnitPath } from "@website/domain/organizations";
import { can } from "@website/permissions";
import { safeId } from "@website/security/validation";
import { AccessMessage } from "@/components/access-message";
import { MeetingPage } from "@/components/meeting-page";
import { requireAdminViewer } from "@/server/context";
import { canRunMeeting, canSeeMeeting } from "@/server/meetings";
import { adminReads } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

/** One meeting (F4): details, room, attendance (code screen and manual ticks). */
export default async function MeetingRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireAdminViewer(`/meetings/${id}`, "meetings.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const { principal } = viewer;
  if (!safeId.safeParse(id).success) notFound();
  const meeting = await adminReads.getMeeting(id);
  if (!meeting || meeting.deletedAt || !canSeeMeeting(principal, meeting)) notFound();
  const [units, people] = await Promise.all([
    adminReads.listOrgUnits(meeting.periodId),
    adminReads.getUsers(meeting.participantIds),
  ]);
  const now = new Date();
  const status = meetingStatus(meeting, now);
  const runs = canRunMeeting(principal, meeting);
  const canEdit =
    status === "scheduled" && can(principal, "meetings.edit", { orgUnitPath: meeting.orgUnitPath });
  const name = (uid: string) => people.get(uid)?.name ?? people.get(uid)?.email ?? uid;
  return (
    <MeetingPage
      meeting={{
        id: meeting.id,
        version: meeting.version,
        periodId: meeting.periodId,
        title: meeting.title,
        description: meeting.description,
        unitName: units.find((u) => u.id === meeting.orgUnitId)?.name ?? "Whole region",
        startsAt: meeting.startsAt.toISOString(),
        endsAt: meeting.endsAt.toISOString(),
        timeZone: meeting.timeZone,
        status,
        started: now.getTime() >= meeting.startsAt.getTime(),
        externalUrl: meeting.room.externalUrl,
        zoomRequestId: meeting.room.zoomRequestId,
        cancelReason: meeting.cancelReason,
        agenda: meeting.agenda.map((a) => a.title),
        participants: meeting.participants.map((p) => ({
          uid: p.uid,
          name: name(p.uid),
          role: p.role,
          presentAt: meeting.attendance[p.uid]?.at.toISOString() ?? null,
          method: meeting.attendance[p.uid]?.method ?? null,
        })),
      }}
      runs={runs && status !== "cancelled"}
      edit={
        canEdit
          ? {
              units: [
                ...(can(principal, "meetings.edit", { orgUnitPath: [] })
                  ? [{ id: "", name: "Whole region" }]
                  : []),
                ...inTreeOrder(units)
                  .filter(
                    (u) =>
                      !u.deletedAt &&
                      can(principal, "meetings.edit", { orgUnitPath: orgUnitPath(u) }),
                  )
                  .map((u) => ({ id: u.id, name: u.name })),
              ],
              values: {
                id: meeting.id,
                version: meeting.version,
                title: meeting.title,
                description: meeting.description,
                orgUnitId: meeting.orgUnitId,
                startsAtLocal: utcToWallTime(meeting.startsAt, meeting.timeZone),
                timeZone: meeting.timeZone,
                durationMinutes: Math.round(
                  (meeting.endsAt.getTime() - meeting.startsAt.getTime()) / 60_000,
                ),
                agenda: meeting.agenda.map((a) => a.title),
                participants: meeting.participants.map((p) => ({
                  email: people.get(p.uid)?.email ?? "",
                  role: p.role,
                })),
              },
            }
          : null
      }
    />
  );
}
