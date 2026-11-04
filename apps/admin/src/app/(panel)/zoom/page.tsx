import { invitationText } from "@website/domain/zoom";
import { can, canInSomeScope } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { ZoomPage } from "@/components/zoom-page";
import { requireAdminViewer } from "@/server/context";
import { canCancelZoom } from "@/server/zoom";
import { adminReads } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

const DAY = 86_400_000;

/** Zoom bookings (F1): 30 days back to 180 days ahead, the viewer's own and their units'. */
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
  const people = await adminReads.getUsers([...new Set(visible.map((b) => b.requestedBy))]);
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
