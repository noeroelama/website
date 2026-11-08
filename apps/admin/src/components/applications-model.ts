import { answerText, type FileAnswer, type Question } from "@website/domain/forms";
import {
  offerExpired,
  AXES,
  type Application,
  type PersonalityScore,
  type ApplicationStatus,
  type Recruitment,
  type RevisionRound,
} from "@website/domain/recruitment";
import { APPLICATION_STATUS_LABELS, label } from "../labels";

export const QUEUE_TABS = [
  { key: "all", label: "All" },
  { key: "review", label: "To review" },
  { key: "revision", label: "Revision" },
  { key: "interview", label: "Interview" },
  { key: "offered", label: "Offered" },
  { key: "accepted", label: "Accepted" },
  { key: "placement", label: "Placement" },
  { key: "closed", label: "Closed" },
] as const;
export type QueueTab = (typeof QUEUE_TABS)[number]["key"];

const TAB_STATUSES: Record<Exclude<QueueTab, "all">, readonly ApplicationStatus[]> = {
  review: ["submitted"],
  revision: ["revision"],
  interview: ["interview"],
  offered: ["offered"],
  accepted: ["accepted"],
  placement: ["approved", "pakta_review", "confirmed"],
  closed: ["admin_rejected", "declined", "rejected", "withdrawn"],
};

export function matchesQueueTab(item: Pick<ApplicationItem, "status">, tab: QueueTab): boolean {
  return tab === "all" || TAB_STATUSES[tab].includes(item.status);
}

export interface ApplicationItem {
  id: string;
  version: number;
  userId: string;
  name: string;
  email: string;
  status: ApplicationStatus;
  statusLabel: string;
  choices: { id: string; name: string }[];
  submittedAt: string | null;
  revisionRound: number;
  offer: { orgUnitId: string; unitName: string; expiresAt: string; expired: boolean } | null;
  answers: { id: string; label: string; text: string; file: FileAnswer | null }[];
  portfolio: FileAnswer | null;
  pacts: FileAnswer[];
  pactNote: string | null;
  appointmentId: string | null;
  personality: { full: string; axes: string } | null;
  revisions: {
    round: number;
    request: string;
    requestedAt: string;
    resubmittedAt: string | null;
  }[];
}

const isFile = (value: unknown): value is FileAnswer =>
  typeof value === "object" && value !== null && !Array.isArray(value) && "path" in value;

export function toApplicationItem(
  a: Application,
  r: Pick<Recruitment, "units">,
  questions: readonly Question[],
  user: { name: string | null; email: string | null } | null,
  revisions: readonly RevisionRound[],
  now: Date,
  personality: Pick<PersonalityScore, "full" | "axes"> | null = null,
): ApplicationItem {
  const unitName = (id: string) => r.units.find((u) => u.orgUnitId === id)?.name ?? id;
  return {
    id: a.id,
    version: a.version,
    userId: a.userId,
    name: user?.name ?? user?.email ?? a.userId,
    email: user?.email ?? "",
    status: a.status,
    statusLabel: label(APPLICATION_STATUS_LABELS, a.status),
    choices: a.choices.map((id) => ({ id, name: unitName(id) })),
    submittedAt: a.submittedAt?.toISOString() ?? null,
    revisionRound: a.revisionRound,
    offer: a.offer && {
      orgUnitId: a.offer.orgUnitId,
      unitName: unitName(a.offer.orgUnitId),
      expiresAt: a.offer.expiresAt.toISOString(),
      expired: offerExpired(a.offer, now),
    },
    answers: questions.map((q) => {
      const value = a.answers[q.id];
      return {
        id: q.id,
        label: q.label,
        text: answerText(value),
        file: isFile(value) ? value : null,
      };
    }),
    portfolio: a.portfolio,
    pacts: [...a.pacts],
    pactNote: a.pactNote,
    appointmentId: a.appointmentId,
    personality: personality && {
      full: personality.full,
      axes: AXES.map(
        (axis) => `${personality.axes[axis].pct}% ${personality.axes[axis].letter}`,
      ).join(" · "),
    },
    revisions: revisions
      .filter((rev) => rev.applicationId === a.id)
      .map((rev) => ({
        round: rev.round,
        request: rev.request,
        requestedAt: rev.requestedAt.toISOString(),
        resubmittedAt: rev.resubmittedAt?.toISOString() ?? null,
      })),
  };
}
