import { describe, expect, it } from "vitest";
import {
  applicantsCsv,
  attendanceCsv,
  peopleCsv,
  programsCsv,
  zoomCsv,
} from "../../apps/admin/src/components/exports-model";

describe("admin CSV exports (M8)", () => {
  it("programmes: one row per milestone, a programme without milestones keeps one row", () => {
    expect(
      programsCsv([
        {
          name: "Seminar",
          unitName: "Media",
          status: "running",
          progress: 50,
          health: "on_track",
          milestones: [
            { title: "Venue", dueOn: "2026-11-13", done: true },
            { title: "=Poster", dueOn: null, done: false },
          ],
        },
        {
          name: "Empty",
          unitName: "",
          status: "proposed",
          progress: 0,
          health: null,
          milestones: [],
        },
      ]),
    ).toEqual([
      [
        '"Programme"',
        '"Unit"',
        '"Status"',
        '"Progress %"',
        '"Health"',
        '"Milestone"',
        '"Due"',
        '"Done"',
      ],
      [
        '"Seminar"',
        '"Media"',
        '"Running"',
        '"50"',
        '"On track"',
        '"Venue"',
        '"2026-11-13"',
        '"yes"',
      ],
      ['"Seminar"', '"Media"', '"Running"', '"50"', '"On track"', '"\'=Poster"', '""', '"no"'],
      ['"Empty"', '""', '"Proposed"', '"0"', '""', '""', '""', '""'],
    ]);
  });

  it("zoom bookings, attendance, applicants and accounts", () => {
    expect(
      zoomCsv([
        {
          topic: "Rapat",
          startsAt: "2026-11-10T10:00:00.000Z",
          endsAt: "2026-11-10T11:00:00.000Z",
          timeZone: "Asia/Tokyo",
          status: "approved",
          requester: "Rina",
        },
      ])[1],
    ).toEqual([
      '"Rapat"',
      '"2026-11-10 10:00"',
      '"2026-11-10 11:00"',
      '"Asia/Tokyo"',
      '"approved"',
      '"Rina"',
    ]);
    expect(
      attendanceCsv([
        { name: "Rina", role: "chair", presentAt: "2026-11-10T10:01:00.000Z", method: "code" },
        { name: "Budi", role: "member", presentAt: null, method: null },
      ]).slice(1),
    ).toEqual([
      ['"Rina"', '"Chair"', '"present"', '"2026-11-10 10:01"', '"code"'],
      ['"Budi"', '"Participant"', '"absent"', '""', '""'],
    ]);
    expect(
      applicantsCsv([
        {
          name: "Ana",
          email: "ana@example.org",
          statusLabel: "Interview",
          choices: [{ name: "Media" }, { name: "IT" }],
          submittedAt: "2026-11-01T02:00:00.000Z",
          offer: null,
          personality: { full: "ENFJ-A" },
        },
      ])[1],
    ).toEqual([
      '"Ana"',
      '"ana@example.org"',
      '"Interview"',
      '"Media; IT"',
      '"2026-11-01 02:00"',
      '""',
      '"ENFJ-A"',
    ]);
    const roles = new Map([
      ["r1", "Admin"],
      ["r2", "Sekjen"],
    ]);
    expect(
      peopleCsv(
        [
          {
            name: "Ana",
            email: "ana@example.org",
            status: "active",
            createdAt: "2026-01-01T00:00:00.000Z",
            lastSignInAt: null,
            roleId: "r1",
            orgRoleIds: ["r2", "gone"],
          },
        ],
        roles,
      )[1],
    ).toEqual([
      '"Ana"',
      '"ana@example.org"',
      '"active"',
      '"2026-01-01 00:00"',
      '""',
      '"Admin"',
      '"Sekjen; gone"',
    ]);
  });
});
