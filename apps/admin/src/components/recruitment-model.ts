import { isRecruitmentOpen, type Recruitment } from "@website/domain/recruitment";

/** A recruitment row of the Recruitment page, mapped on the server. */
export interface RecruitmentItem {
  id: string;
  version: number;
  periodId: string;
  periodName: string;
  title: string;
  description: string;
  /** ISO (UTC). */
  opensAt: string;
  closesAt: string;
  maxChoices: number;
  offerDays: number;
  formId: string;
  formVersion: number;
  pactTemplateUrl: string | null;
  published: boolean;
  /** Published and inside the window right now. */
  open: boolean;
  units: {
    orgUnitId: string;
    name: string;
    quota: number;
    portfolioRequired: boolean;
    filled: number;
  }[];
}

export function toRecruitmentItem(
  r: Recruitment,
  periodName: string,
  seats: ReadonlyMap<string, { filled: number }>,
  now: Date,
): RecruitmentItem {
  return {
    id: r.id,
    version: r.version,
    periodId: r.periodId,
    periodName,
    title: r.title,
    description: r.description,
    opensAt: r.opensAt.toISOString(),
    closesAt: r.closesAt.toISOString(),
    maxChoices: r.maxChoices,
    offerDays: r.offerDays,
    formId: r.formId,
    formVersion: r.formVersion,
    pactTemplateUrl: r.pactTemplateUrl,
    published: r.published,
    open: isRecruitmentOpen(r, now),
    units: r.units.map((u) => ({ ...u, filled: seats.get(u.orgUnitId)?.filled ?? 0 })),
  };
}

/** One unit line of the editor (every unit of the period is listed; `offered` ticks it). */
export interface UnitDraft {
  orgUnitId: string;
  name: string;
  /** Indent in the tree. */
  depth: number;
  offered: boolean;
  quota: string;
  portfolioRequired: boolean;
  /** Seats already accepted (the quota cannot go below). */
  filled: number;
}

/** Editor lines for a period's units, with the recruitment's current settings. */
export function unitDrafts(
  units: readonly { id: string; name: string; path: readonly string[] }[],
  current: RecruitmentItem["units"],
): UnitDraft[] {
  return units.map((u) => {
    const offered = current.find((c) => c.orgUnitId === u.id);
    return {
      orgUnitId: u.id,
      name: u.name,
      depth: u.path.length,
      offered: offered !== undefined,
      quota: offered ? String(offered.quota) : "1",
      portfolioRequired: offered?.portfolioRequired ?? false,
      filled: offered?.filled ?? 0,
    };
  });
}

/** The ticked lines as the save action expects them (the server validates). */
export const unitsInput = (drafts: readonly UnitDraft[]) =>
  drafts
    .filter((d) => d.offered)
    .map((d) => ({
      orgUnitId: d.orgUnitId,
      quota: Number(d.quota),
      portfolioRequired: d.portfolioRequired,
    }));
