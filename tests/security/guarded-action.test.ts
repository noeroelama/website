import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ConcurrencyConflictError } from "@website/domain/shared";
import { normalizePermissions, type Principal } from "@website/permissions";
import { createGuardedAction } from "../../apps/admin/src/server/guarded-action";

const editor: Principal = {
  kind: "user",
  userId: "u",
  active: true,
  assignments: [
    {
      roleId: "editor",
      scope: { type: "global" },
      permissions: new Set(normalizePermissions(["articles.edit"])),
    },
  ],
};

describe("race conditions in admin writes", () => {
  it("a stale write (optimistic concurrency) returns 'conflict' instead of overwriting", async () => {
    const save = createGuardedAction({
      permission: "articles.edit",
      input: z.object({ id: z.string() }),
      handler: () => Promise.reject(new ConcurrencyConflictError("version changed")),
    });
    expect(await save(() => Promise.resolve(editor))({ id: "n1" })).toEqual({
      ok: false,
      error: "conflict",
    });
  });

  it("unexpected errors are not converted into messages for the client (framework shows a generic error)", async () => {
    const save = createGuardedAction({
      permission: "articles.edit",
      input: z.object({ id: z.string() }),
      handler: () => Promise.reject(new Error("db password=x")),
    });
    await expect(save(() => Promise.resolve(editor))({ id: "n1" })).rejects.toThrow();
  });
});
