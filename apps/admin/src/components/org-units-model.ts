import type { OrgUnit, OrgUnitType } from "@website/domain/organizations";

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
  };
}
