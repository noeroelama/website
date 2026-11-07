import { orgUnitPath } from "@website/domain/organizations";
import { can, canInSomeScope, scopedOrgUnitIds, type Principal } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { toIncomingItem } from "@/components/incoming-model";
import { IncomingPage } from "@/components/incoming-page";
import { LetterTypesPage } from "@/components/letter-types-page";
import { toLetterItem } from "@/components/letters-model";
import { LetterSectionTabs, LettersPage, type LetterSection } from "@/components/letters-page";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

/** The newest letters of the active period the viewer covers (unit-scoped staff: their units). */
const LIMIT = 300;

/** Outgoing, incoming letters and letter types in one page (`?tab=incoming|types`). */
export default async function AdminLettersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireAdminViewer("/letters", "letters.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const { principal } = viewer;
  const sections: { key: LetterSection; label: string }[] = [
    { key: "outgoing", label: "Outgoing" },
    ...(canInSomeScope(principal, "incoming.read")
      ? [{ key: "incoming" as const, label: "Incoming" }]
      : []),
    ...(canInSomeScope(principal, "letter_types.read")
      ? [{ key: "types" as const, label: "Letter types" }]
      : []),
  ];
  const tab = (await searchParams)["tab"];
  const active = sections.find((s) => s.key === tab)?.key ?? "outgoing";
  return (
    <>
      <LetterSectionTabs sections={sections} active={active} />
      {active === "incoming"
        ? await incomingSection(principal)
        : active === "types"
          ? await typesSection(principal)
          : await outgoingSection(principal)}
    </>
  );
}

async function outgoingSection(principal: Principal) {
  const periods = await adminReads.listPeriods();
  const period = periods.find((p) => p.status === "active") ?? null;
  const [types, units, page] = await Promise.all([
    adminReads.listLetterTypes(),
    period ? adminReads.listOrgUnits(period.id) : Promise.resolve([]),
    period
      ? adminReads.listLetters({
          periodId: period.id,
          orgUnitIds: scopedOrgUnitIds(principal, "letters.read"),
          limit: LIMIT,
        })
      : Promise.resolve({ items: [], nextCursor: null }),
  ]);
  const people = await adminReads.getUsers([
    ...new Set(
      page.items.flatMap((l) =>
        [l.createdBy, l.secretary?.uid, l.coordinator?.uid].filter((u): u is string => !!u),
      ),
    ),
  ]);
  const names = new Map([...people].map(([uid, u]) => [uid, u.name ?? u.email ?? uid]));
  const typeById = new Map(types.map((t) => [t.id, t]));
  const unitName = new Map(units.map((u) => [u.id, u.name]));
  return (
    <LettersPage
      periodName={period?.name ?? null}
      truncated={page.nextCursor !== null}
      initial={page.items.map((l) =>
        toLetterItem(
          l,
          typeById.get(l.typeId),
          unitName.get(l.orgUnitId) ?? "",
          names,
          can(principal, "letters.edit", { orgUnitPath: l.orgUnitPath }),
        ),
      )}
      types={types
        .filter((t) => t.active)
        .map((t) => ({
          id: t.id,
          name: t.name,
          code: t.code,
          requiresRecipient: t.requiresRecipient,
          requiresCoordinator: t.requiresCoordinator,
        }))}
      units={units
        .filter((u) => u.active && can(principal, "letters.edit", { orgUnitPath: orgUnitPath(u) }))
        .map((u) => ({ id: u.id, name: u.name }))}
      viewerId={principal.userId}
      desks={{
        review: canInSomeScope(principal, "letters.review"),
        sign: canInSomeScope(principal, "letters.sign"),
        signCoordinator: canInSomeScope(principal, "letters.sign_coordinator"),
        issue: canInSomeScope(principal, "letters.issue"),
        cancel: canInSomeScope(principal, "letters.cancel"),
      }}
      canWrite={canInSomeScope(principal, "letters.edit")}
    />
  );
}

async function incomingSection(principal: Principal) {
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
      canEdit={canInSomeScope(principal, "incoming.edit")}
      canDispose={canInSomeScope(principal, "incoming.dispose")}
    />
  );
}

async function typesSection(principal: Principal) {
  const [types, settings] = await Promise.all([
    adminReads.listLetterTypes(),
    adminReads.getLetterSettings(),
  ]);
  return (
    <LetterTypesPage
      initial={types.map((t) => ({
        id: t.id,
        version: t.version,
        name: t.name,
        code: t.code,
        description: t.description,
        numberFormat: t.numberFormat,
        numberPadding: t.numberPadding,
        requiresCoordinator: t.requiresCoordinator,
        requiresRecipient: t.requiresRecipient,
        contentPublic: t.contentPublic,
        active: t.active,
        sort: t.sort,
      }))}
      letterhead={settings.letterhead}
      letterheadVersion={settings.version}
      canEdit={canInSomeScope(principal, "letter_types.edit")}
    />
  );
}
