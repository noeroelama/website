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

describe("audit helper handed to every admin mutation", () => {
  const rename = createGuardedAction({
    permission: "articles.edit",
    input: z.object({ id: z.string(), title: z.string() }).strict(),
    handler: (input, _principal, audit) =>
      Promise.resolve(
        audit({
          module: "articles",
          action: "UPDATE",
          resourceType: "content",
          resourceId: input.id,
          title: input.title,
          before: { title: "Old", body: "same" },
          after: { title: input.title, body: "same" },
          versionBefore: 1,
          versionAfter: 2,
        }),
      ),
  });

  it("takes the actor from the server-side principal and context, never from the input", async () => {
    const result = await rename(
      () => Promise.resolve(editor),
      () =>
        Promise.resolve({
          actorEmail: "editor@example.org",
          requestId: "req-12345678",
          authTime: null,
        }),
    )({ id: "n1", title: "New" });
    expect(result).toMatchObject({
      ok: true,
      data: {
        actor: { type: "staff", id: "u", email: "editor@example.org" },
        request: { requestId: "req-12345678" },
        module: "articles",
        action: "UPDATE",
        title: "New",
        // Only changed fields are kept.
        before: { title: "Old" },
        after: { title: "New" },
        revertible: true,
        revertOf: null,
        prevHash: null,
        hash: null,
      },
    });
    expect(
      await rename(() => Promise.resolve(editor))({ id: "n1", title: "x", actor: "z" }),
    ).toMatchObject({
      error: "invalid_input",
    });
  });

  it("without a context it still records the staff uid, with a generated request id", async () => {
    const result = await rename(() => Promise.resolve(editor))({ id: "n1", title: "New" });
    expect(result.ok && result.data.actor).toEqual({ type: "staff", id: "u", email: null });
    expect(result.ok && result.data.request.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("form errors per field (red fields on the add/edit form)", () => {
  it("returns the first message for each invalid field, keyed by field name", async () => {
    const save = createGuardedAction({
      permission: "articles.edit",
      input: z
        .object({
          title: z.string().min(3, "Title is too short."),
          slug: z.string().regex(/^[a-z-]+$/, "Use lower-case letters and dashes."),
        })
        .strict(),
      handler: () => Promise.resolve("saved"),
    });
    expect(await save(() => Promise.resolve(editor))({ title: "x", slug: "Bad Slug" })).toEqual({
      ok: false,
      error: "invalid_input",
      issues: ["Title is too short.", "Use lower-case letters and dashes."],
      fields: { title: "Title is too short.", slug: "Use lower-case letters and dashes." },
    });
  });
});
