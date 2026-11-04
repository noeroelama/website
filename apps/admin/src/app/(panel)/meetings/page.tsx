import { meetingStatus } from "@website/domain/meetings";
import { canChangePeriod, inTreeOrder, orgUnitPath } from "@website/domain/organizations";
import { can, canInSomeScope } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { MeetingsPage } from "@/components/meetings-page";
import { requireAdminViewer } from "@/server/context";
import { canSeeMeeting } from "@/server/meetings";
import { adminReads } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

/** Meetings (F4) of one period (`?period=`, default the active one) the viewer may see. */
export default async function AdminMeetingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireAdminViewer("/meetings", "meetings.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const { principal } = viewer;
  const asked = (await searchParams)["period"];
  const periods = await adminReads.listPeriods();
  const period =
    periods.find((p) => p.id === asked) ?? periods.find((p) => p.status === "active") ?? periods[0];
  if (!period) return <MeetingsPage period={null} periods={[]} rows={[]} units={[]} />;
  const [meetings, units] = await Promise.all([
    adminReads.listMeetings(period.id),
    adminReads.listOrgUnits(period.id),
  ]);
  const now = new Date();
  const unitName = new Map(units.map((u) => [u.id, u.name]));
  const schedulable =
    canChangePeriod(period.status) && canInSomeScope(principal, "meetings.edit")
      ? [
          ...(can(principal, "meetings.edit", { orgUnitPath: [] })
            ? [{ id: "", name: "Whole region" }]
            : []),
          ...inTreeOrder(units)
            .filter(
              (u) =>
                !u.deletedAt && can(principal, "meetings.edit", { orgUnitPath: orgUnitPath(u) }),
            )
            .map((u) => ({ id: u.id, name: u.name })),
        ]
      : [];
  return (
    <MeetingsPage
      period={{ id: period.id, name: period.name }}
      periods={periods.map((p) => ({ id: p.id, name: p.name }))}
      units={schedulable}
      rows={meetings
        .filter((m) => canSeeMeeting(principal, m))
        .map((m) => ({
          id: m.id,
          title: m.title,
          unitName: m.orgUnitId ? (unitName.get(m.orgUnitId) ?? "") : "Whole region",
          startsAt: m.startsAt.toISOString(),
          timeZone: m.timeZone,
          status: meetingStatus(m, now),
          participants: m.participants.length,
          present: Object.keys(m.attendance).length,
          mine: m.participantIds.includes(principal.userId),
        }))}
    />
  );
}
