import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  normalizePermissions,
  resolveAssignments,
  SUPERADMIN_ROLE_ID,
  type Principal,
} from "@website/permissions";
import { createGuardedAction } from "../../apps/admin/src/server/guarded-action";

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
    expect(await publishNews(() => Promise.resolve(asUser("visitor")))({ id: "n1" })).toMatchObject(
      {
        error: "forbidden",
      },
    );
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
});

describe("permission in some scope (the handler checks the record's own rule)", () => {
  const runMeeting = createGuardedAction({
    permission: "articles.read",
    inSomeScope: true,
    input: z.object({ id: z.string() }),
    handler: (input) => Promise.resolve(input.id),
  });
  const scoped = (permissions: string[]): Principal => ({
    kind: "user",
    userId: "u",
    active: true,
    assignments: [
      {
        roleId: "r",
        scope: { type: "orgUnit", orgUnitId: "media" },
        permissions: new Set(normalizePermissions(permissions)),
      },
    ],
  });
  it("passes with the permission in any scope and refuses without it", async () => {
    expect(await runMeeting(() => Promise.resolve(scoped(["articles.read"])))({ id: "m" })).toEqual(
      {
        ok: true,
        data: "m",
      },
    );
    expect(
      await runMeeting(() => Promise.resolve(scoped(["events.read"])))({ id: "m" }),
    ).toMatchObject({ ok: false, error: "forbidden" });
  });
});
