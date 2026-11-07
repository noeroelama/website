import { describe, expect, it } from "vitest";
import { createSqlApplicationStore } from "@website/db/sql";
import type { LpjReport, Program } from "@website/domain/programs";
import { createDeadlineReminders } from "../../apps/admin/src/server/deadline-reminders";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlApplicationStore>[0];

describe("deadline reminders (M6)", () => {
  const fake = fakeDb();
  const booked = (startsAt: string, status = "interview") => ({
    recruitmentId: "r1",
    userId: "applicant",
    status,
    interview: { slotId: "s1", startsAt: new Date(startsAt) },
  });
  fake.docs.set("applications/r1_a", booked("2026-11-11T09:00:00Z"));
  fake.docs.set("applications/r1_b", booked("2026-11-12T09:00:00Z"));
  fake.docs.set("applications/r1_c", booked("2026-11-11T10:00:00Z", "withdrawn"));

  const program = {
    id: "p1",
    name: "Seminar",
    pics: ["pic1", "pic2"],
    status: "running",
    milestones: [
      { id: "m1", title: "Venue", dueOn: "2026-11-13", completedAt: null },
      { id: "m2", title: "Poster", dueOn: "2026-11-20", completedAt: null },
      { id: "m3", title: "Done", dueOn: "2026-11-12", completedAt: new Date() },
    ],
  } as unknown as Program;
  const lpj = (id: string, dueOn: string, status = "draft") =>
    ({
      id,
      programId: id,
      pics: ["pic1"],
      dueOn,
      status,
      plan: { name: "Seminar" },
    }) as unknown as LpjReport;

  const sent: string[] = [];
  const reminders = createDeadlineReminders({
    applications: createSqlApplicationStore(fake.db as unknown as Db),
    programs: () => Promise.resolve([program]),
    lpj: () =>
      Promise.resolve([
        lpj("l-due", "2026-11-12"),
        lpj("l-late", "2026-11-01", "returned"),
        lpj("l-desk", "2026-11-01", "submitted"),
        lpj("l-far", "2026-12-01"),
      ]),
    contacts: (uids) =>
      Promise.resolve(new Map(uids.map((u) => [u, { email: `${u}@x.org`, phone: null }]))),
    send: (_message, key) => {
      const status = sent.includes(key) ? "duplicate" : "sent";
      if (status === "sent") sent.push(key);
      return Promise.resolve(status as "sent");
    },
    adminUrl: "https://admin.example.org",
    now: () => new Date("2026-11-10T01:00:00Z"),
  });

  it("reminds interviews tomorrow, milestones and LPJs due within 3 days, and overdue LPJs, once", async () => {
    expect(await reminders()).toEqual({ messages: 5 });
    expect(sent).toEqual([
      "reminder:interview:r1_a:2026-11-11:applicant",
      "reminder:milestone:p1_m1:2026-11-13:pic1",
      "reminder:milestone:p1_m1:2026-11-13:pic2",
      "reminder:lpj-due:l-due:2026-11-12:pic1",
      "reminder:lpj-overdue:l-late:2026-11-01:pic1",
    ]);
    expect(await reminders()).toEqual({ messages: 0 });
  });
});
