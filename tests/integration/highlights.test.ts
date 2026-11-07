import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSqlFormWebStore } from "@website/db/sql";
import type { PublicEvent } from "@website/domain/events";
import type { Recruitment } from "@website/domain/recruitment";
import { publicHighlights } from "../../apps/web/src/server/highlights";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlFormWebStore>[0];
const now = new Date("2026-11-07T00:00:00Z");
const at = (iso: string) => new Date(iso);

describe("public highlights (L1)", () => {
  it("open recruitments, public forms in their window, upcoming events; nothing else", async () => {
    const fake = fakeDb();
    const form = (id: string, extra: object) =>
      fake.db
        .collection("forms")
        .doc(id)
        .set({
          title: `Form ${id}`,
          description: "",
          usage: "public",
          status: "published",
          publicToken: `token-${id}-aaaaaaaaaaaaaaaaaaaa`,
          currentVersion: 1,
          opensAt: null,
          closesAt: null,
          responseCount: 0,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          ...extra,
        });
    await form("open", {});
    await form("later", { opensAt: at("2026-12-01T00:00:00Z") });
    await form("draft", { status: "draft" });
    await form("recruit", { usage: "recruitment" });
    await form("gone", { deletedAt: now });
    const forms = await createSqlFormWebStore(fake.db as unknown as Db).listPublished();
    expect(forms.map((f) => f.id).sort()).toEqual(["later", "open"]);

    const recruitment = (id: string, closesAt: string, published = true) =>
      ({
        id,
        title: `Oprec ${id}`,
        published,
        deletedAt: null,
        opensAt: at("2026-11-01T00:00:00Z"),
        closesAt: at(closesAt),
      }) as unknown as Recruitment;
    const event = (slug: string, startsAt: string) =>
      ({ slug, title: `Event ${slug}`, startsAt: at(startsAt) }) as PublicEvent;

    const items = publicHighlights(
      {
        recruitments: [
          recruitment("r1", "2026-11-30T00:00:00Z"),
          recruitment("r2", "2026-11-05T00:00:00Z"),
          recruitment("r3", "2026-11-30T00:00:00Z", false),
        ],
        forms,
        events: [
          event("late", "2026-12-20T00:00:00Z"),
          event("past", "2026-11-01T00:00:00Z"),
          event("soon", "2026-11-20T00:00:00Z"),
        ],
      },
      now,
    );
    expect(items.map((i) => [i.kind, i.href])).toEqual([
      ["recruitment", "/recruitment/r1"],
      ["form", "/f/token-open-aaaaaaaaaaaaaaaaaaaa"],
      ["event", "/events/soon"],
      ["event", "/events/late"],
    ]);
  });

  it("can never include meetings, Zoom bookings or unit agendas", () => {
    const source = readFileSync("apps/web/src/server/highlights.ts", "utf8");
    for (const forbidden of ["meetings", "zoom", "calendar", "tasks", "programs"]) {
      expect(source).not.toMatch(new RegExp(`@website/domain/${forbidden}`));
    }
    const kinds = new Set(
      publicHighlights({ recruitments: [], forms: [], events: [] }, now).map((i) => i.kind),
    );
    expect(kinds.size).toBe(0);
  });
});
