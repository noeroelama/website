import { describe, expect, it } from "vitest";
import {
  can,
  canAccessAdmin,
  DEFAULT_ROLE_ASSIGNMENTS,
  resolveAssignments,
  type Principal,
} from "@website/permissions";

const alice: Principal = {
  kind: "user",
  userId: "alice-uid",
  active: true,
  assignments: resolveAssignments(DEFAULT_ROLE_ASSIGNMENTS, new Map()),
};

describe("users are locked to their own uid", () => {
  it("own-data permissions only match the signed-in user's uid", () => {
    expect(can(alice, "profile.read_own", { ownerId: "alice-uid" })).toBe(true);
    expect(can(alice, "profile.read_own", { ownerId: "bob-uid" })).toBe(false);
    expect(can(alice, "registrations.read_own", { ownerId: "bob-uid" })).toBe(false);
    expect(can(alice, "shop.orders.read_own", {})).toBe(false);
  });

  it("a regular user cannot use any staff permission", () => {
    expect(can(alice, "members.read")).toBe(false);
    expect(canAccessAdmin(alice)).toBe(false);
  });
});
