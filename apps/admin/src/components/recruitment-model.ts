import { isRecruitmentOpen, type Recruitment } from "@website/domain/recruitment";

export interface RecruitmentItem {
  id: string;
  version: number;
  periodId: string;
  periodName: string;
  title: string;
  description: string;
  opensAt: string;
  closesAt: string;
  maxChoices: number;
  offerDays: number;
  formId: string;
  formVersion: number;
  pactTemplateUrl: string | null;
  published: boolean;
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

export interface UnitDraft {
  orgUnitId: string;
  name: string;
  depth: number;
  offered: boolean;
  quota: string;
  portfolioRequired: boolean;
  filled: number;
}

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

export const unitsInput = (drafts: readonly UnitDraft[]) =>
  drafts
    .filter((d) => d.offered)
    .map((d) => ({
      orgUnitId: d.orgUnitId,
      quota: Number(d.quota),
      portfolioRequired: d.portfolioRequired,
    }));
