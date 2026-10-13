import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  normalizePermissions,
  resolveAssignments,
  SUPERADMIN_ROLE_ID,
  type Principal,
} from "@website/permissions";
import { createGuardedAction } from "../../apps/admin/src/server/guarded-action";
import { denyAllUserDirectory } from "../../apps/admin/src/server/user-directory";

const publishNews = createGuardedAction({
  permission: "articles.publish",
  input: z.object({ id: z.string().min(1) }),
  handler: (input) => Promise.resolve({ published: input.id }),
});

// Custom roles as created in the admin Roles page.
const roles = new Map([
  [
    "editor",
    { id: "editor", name: "Editor", permissions: normalizePermissions(["articles.publish"]) },
  ],
  [
    "viewer",
    { id: "viewer", name: "Viewer", permissions: normalizePermissions(["articles.read"]) },
  ],
]);

const asUser = (roleId: string): Principal => ({
  kind: "user",
  userId: "u",
  active: true,
  assignments: resolveAssignments([{ roleId, scope: { type: "global" } }], roles),
});

describe("admin guarded actions (server-side enforcement)", () => {
  it("rejects unauthenticated callers before validating input", async () => {
    expect(await publishNews(() => Promise.resolve(null))({ role: SUPERADMIN_ROLE_ID })).toEqual({
      ok: false,
      error: "unauthenticated",
    });
  });

  it("rejects signed-in members (same user pool, no staff role)", async () => {
    expect(await publishNews(() => Promise.resolve(asUser("member")))({ id: "n1" })).toMatchObject({
      error: "forbidden",
    });
  });

  it("rejects staff without the permission, ignoring payload role fields", async () => {
    expect(
      await publishNews(() => Promise.resolve(asUser("viewer")))({ id: "n1", role: "superadmin" }),
    ).toMatchObject({ error: "forbidden" });
  });

  it("validates input and runs the handler for permitted staff", async () => {
    expect(await publishNews(() => Promise.resolve(asUser("editor")))({ id: "" })).toMatchObject({
      error: "invalid_input",
    });
    expect(await publishNews(() => Promise.resolve(asUser("editor")))({ id: "n1" })).toEqual({
      ok: true,
      data: { published: "n1" },
    });
  });

  it("a Firebase login alone grants nothing (no user record → no principal)", async () => {
    expect(await denyAllUserDirectory.findPrincipalByUid("any-firebase-uid")).toBeNull();
  });
});
