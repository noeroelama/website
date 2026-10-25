import { canInSomeScope } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { toIncomingItem } from "@/components/incoming-model";
import { IncomingPage } from "@/components/incoming-page";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

export default async function AdminIncomingPage() {
  const viewer = await requireAdminViewer("/incoming", "incoming.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const periods = await adminReads.listPeriods();
  const period = periods.find((p) => p.status === "active") ?? null;
  const [letters, units, seats] = period
    ? await Promise.all([
        adminReads.listIncoming(period.id),
        adminReads.listOrgUnits(period.id),
        adminReads.listAppointments(period.id),
      ])
    : [[], [], []];
  const officers = [
    ...new Map(
      seats.filter((a) => a.status === "active").map((a) => [a.userId, `${a.name} — ${a.title}`]),
    ),
  ];
  const people = await adminReads.getUsers(
    [
      ...new Set(
        letters.flatMap((l) => [
          l.recordedBy,
          ...l.dispositions.flatMap((d) => [d.fromUserId, d.toUserId ?? ""]),
        ]),
      ),
    ].filter(Boolean),
  );
  const names = new Map<string, string>([
    ...[...people].map(([uid, u]) => [uid, u.name ?? u.email ?? uid] as [string, string]),
    ...units.map((u) => [u.id, u.name] as [string, string]),
  ]);
  return (
    <IncomingPage
      periodName={period?.name ?? null}
      initial={letters.map((l) => toIncomingItem(l, names))}
      units={units.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name }))}
      officers={officers.map(([id, name]) => ({ id, name }))}
      canEdit={canInSomeScope(viewer.principal, "incoming.edit")}
      canDispose={canInSomeScope(viewer.principal, "incoming.dispose")}
    />
  );
}
