import { invitationText, isArchived } from "@website/domain/zoom";
import { can, canInSomeScope } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { ZoomPage } from "@/components/zoom-page";
import { requireAdminViewer } from "@/server/context";
import { canCancelZoom } from "@/server/zoom";
import { adminReads } from "@/server/wiring";

export const instant = false;

const DAY = 86_400_000;

export default async function AdminZoomPage() {
  const viewer = await requireAdminViewer("/zoom", "zoom.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const { principal } = viewer;
  const now = new Date();
  const [bookings, { settings, version }] = await Promise.all([
    adminReads.listZoom(new Date(now.getTime() - 30 * DAY), new Date(now.getTime() + 180 * DAY)),
    adminReads.zoomSettings(),
  ]);
  const visible = bookings.filter(
    (b) =>
      b.requestedBy === principal.userId ||
      can(principal, "zoom.read", { orgUnitPath: b.orgUnitPath }),
  );
  const recorded = visible.filter((b) => b.recordingUuids.length > 0);
  const [people, files] = await Promise.all([
    adminReads.getUsers([...new Set(visible.map((b) => b.requestedBy))]),
    adminReads.recordingFiles(recorded.map((b) => b.id)),
  ]);
  const recordingOf = (b: (typeof visible)[number]) => {
    if (b.recordingUuids.length === 0) return null;
    const mine = files.filter((f) => f.bookingId === b.id);
    if (isArchived(b.recordingUuids, mine)) return "Recording archived in Drive";
    const clash = mine.filter((f) => f.status === "clash" || f.status === "failed").length;
    const done = mine.filter((f) => f.status === "done").length;
    return `Recording: ${done} of ${mine.length} files in Drive${clash ? `, ${clash} need a look` : ""}`;
  };
  return (
    <ZoomPage
      canRequest={canInSomeScope(principal, "zoom.edit")}
      settings={
        can(principal, "zoom.settings")
          ? {
              version,
              licences: settings.licences,
              concurrentPerLicence: settings.concurrentPerLicence,
              approvalRequired: settings.approvalRequired,
              minNoticeHours: settings.minNoticeHours,
              maxDurationMinutes: settings.maxDurationMinutes,
              autoDeleteRecordings: settings.autoDeleteRecordings,
              hostKeySet: settings.hostKeyEncrypted !== null,
            }
          : null
      }
      rules={{
        approvalRequired: settings.approvalRequired,
        minNoticeHours: settings.minNoticeHours,
        maxDurationMinutes: settings.maxDurationMinutes,
      }}
      rows={visible.map((b) => ({
        id: b.id,
        version: b.version,
        topic: b.topic,
        startsAt: b.startsAt.toISOString(),
        endsAt: b.endsAt.toISOString(),
        timeZone: b.timeZone,
        status: b.status,
        requester: people.get(b.requestedBy)?.name ?? people.get(b.requestedBy)?.email ?? "",
        joinUrl: b.shortUrl ?? b.joinUrl,
        roomError: b.roomError,
        recording: recordingOf(b),
        decisionNote: b.decisionNote,
        invitation: b.joinUrl ? invitationText(b) : null,
        canDecide:
          b.status === "pending" && can(principal, "zoom.approve", { orgUnitPath: b.orgUnitPath }),
        canCancel:
          (b.status === "pending" || b.status === "approved") && canCancelZoom(principal, b),
      }))}
    />
  );
}
