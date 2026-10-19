import {
  PROFILE_FIELD_CLASS,
  type GuardedProfileField,
  type MemberProfile,
} from "@website/domain/members";
import { can, scopedChapterIds } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { formatUtc } from "@/components/format";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";
import { MemberQueues, type ChangeRow, type VerifyRow } from "./member-queues";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

/** Members: profiles to verify and changes of verified data to decide (B4), per chapter. */
export default async function MembersPage() {
  const viewer = await requireAdminViewer("/members", "members.verify");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  // Only the viewer's chapters (PPIDK §73); "all" with a global assignment.
  const chapters = scopedChapterIds(viewer.principal, "members.verify");
  const [toVerify, requests] = await Promise.all([
    adminReads.listToVerify(chapters),
    adminReads.listChangeRequests(chapters),
  ]);
  const scope = (p: { chapterId: string | null }) => ({ chapterId: p.chapterId ?? "" });
  // Restricted values (birth date, gender) are shown only with members.pii for that chapter.
  const shown = (chapterId: string | null, field: string, value: unknown) =>
    PROFILE_FIELD_CLASS[field as GuardedProfileField] === "restricted" &&
    !can(viewer.principal, "members.pii", scope({ chapterId }))
      ? "(restricted)"
      : typeof value === "string"
        ? value
        : (JSON.stringify(value) ?? "—");
  const verifyRows: VerifyRow[] = toVerify.map((p: MemberProfile) => ({
    uid: p.userId,
    version: p.version,
    name: p.fullName,
    detail: `${p.ppiCountry} · ${p.university} · ${p.educationLevel} ${p.yearOfEntry}`,
    born: shown(p.chapterId, "dateOfBirth", p.dateOfBirth),
  }));
  const versions = new Map(
    await Promise.all(
      requests.map(
        async (r) => [r.userId, (await adminReads.getMemberProfile(r.userId))?.version] as const,
      ),
    ),
  );
  const changeRows: ChangeRow[] = requests.map((r) => ({
    uid: r.userId,
    version: versions.get(r.userId) ?? 0,
    name: r.fullName,
    since: formatUtc(r.createdAt),
    changes: Object.entries(r.changes).map(
      ([field, change]) =>
        `${field}: ${shown(r.chapterId, field, change.from)} → ${shown(r.chapterId, field, change.to)}`,
    ),
  }));

  return (
    <>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Members</h1>
          <p className="admin-page-header__desc">
            Verify members&apos; data, and approve or reject changes of verified data (name, birth
            date, gender, PPI country, campus). Only your chapters are listed.
          </p>
        </div>
      </div>
      <MemberQueues toVerify={verifyRows} changes={changeRows} />
    </>
  );
}
