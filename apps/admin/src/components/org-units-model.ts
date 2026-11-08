import {
  unitPeopleCount,
  type OrgUnit,
  type OrgUnitType,
  type UnitDivision,
  type UnitMember,
} from "@website/domain/organizations";

/** A unit row of Organizations → Period → Structure, mapped on the server from `orgUnits/{id}`. */
export interface OrgUnitItem {
  id: string;
  version: number;
  periodId: string;
  parentId: string | null;
  /** Ancestor ids, root first (its length is the indent in the tree). */
  path: string[];
  name: string;
  code: string;
  type: OrgUnitType;
  description: string;
  sort: number;
  active: boolean;
  members: UnitMember[];
  divisions: UnitDivision[];
  /** Core members plus every division's members ("4 People"). */
  people: number;
}

export function toOrgUnitItem(u: OrgUnit): OrgUnitItem {
  return {
    id: u.id,
    version: u.version,
    periodId: u.periodId,
    parentId: u.parentId,
    path: [...u.path],
    name: u.name,
    code: u.code,
    type: u.type,
    description: u.description,
    sort: u.sort,
    active: u.active,
    members: u.members.map((m) => ({ ...m })),
    divisions: u.divisions.map((d) => ({
      name: d.name,
      members: d.members.map((m) => ({ ...m })),
    })),
    people: unitPeopleCount(u),
  };
}
