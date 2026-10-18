import { describe, expect, it, vi } from "vitest";
import type { PublicEvent } from "@website/domain/events";
import { RuleViolationError } from "@website/domain/shared";
import { createEventRegistration } from "../../apps/web/src/server/registrations";

const event: PublicEvent = {
  id: "e1",
  slug: "simposium",
  title: "Simposium",
  type: "seminar",
  startsAt: new Date("2026-11-20T02:00:00Z"),
  timezone: "Asia/Tokyo",
  registrationClosesAt: null,
  location: "Tokyo",
  chapterId: null,
  description: "",
  bannerImage: null,
  registrationUrl: null,
  schedule: [],
  speakers: [],
  sponsors: [],
};
const member = { uid: "u1", email: "sari@example.org" };
const setup = (overrides: Partial<Parameters<typeof createEventRegistration>[0]> = {}) => {
  const send = vi.fn(() => Promise.resolve("sent" as const));
  const register = vi.fn(() => Promise.resolve({ status: "confirmed" as const, created: true }));
  const deps = {
    findEvent: (slug: string) => Promise.resolve(slug === "simposium" ? event : null),
    register,
    captcha: (token: string) => Promise.resolve(token === "good"),
    send,
    profileComplete: (uid: string) => Promise.resolve(uid === "u1"),
    now: () => new Date("2026-10-18T00:00:00Z"),
    ...overrides,
  };
  return { run: createEventRegistration(deps), send, register };
};

describe("event registration from the website", () => {
  it("guests are sent to sign in; bad input and a failed captcha are refused", async () => {
    const { run, register } = setup();
    expect(await run(null, { slug: "simposium", token: "good" }, "id")).toEqual({
      ok: false,
      error: "signin",
    });
    expect(await run(member, { slug: "Bad Slug", token: "good" }, "id")).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(await run(member, { slug: "simposium", token: "bad" }, "id")).toEqual({
      ok: false,
      error: "captcha",
    });
    // Member-only: the profile must be complete first (B3).
    expect(
      await run(
        { uid: "new", email: "new@example.org" },
        { slug: "simposium", token: "good" },
        "id",
      ),
    ).toEqual({ ok: false, error: "profile" });
    expect(await run(member, { slug: "missing", token: "good" }, "id")).toEqual({
      ok: false,
      error: "closed",
    });
    expect(register).not.toHaveBeenCalled();
  });

  it("registers and sends one confirmation e-mail keyed by event and member", async () => {
    const { run, send, register } = setup();
    expect(await run(member, { slug: "simposium", token: "good" }, "en")).toEqual({
      ok: true,
      status: "confirmed",
    });
    expect(register).toHaveBeenCalledWith("e1", "u1", new Date("2026-10-18T00:00:00Z"));
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "email", to: "sari@example.org" }),
      "event:e1:registered:u1",
    );
    const [message] = send.mock.calls[0] as unknown as [{ subject: string; text: string }];
    expect(message.subject).toContain("Simposium");
  });

  it("escapes the event title in the e-mail HTML", async () => {
    const quoted = { ...event, title: `Seminar "AI" & Data` };
    const { run, send } = setup({ findEvent: () => Promise.resolve(quoted) });
    await run(member, { slug: "simposium", token: "good" }, "id");
    const [message] = send.mock.calls[0] as unknown as [{ html: string }];
    expect(message.html).toContain("Seminar &#34;AI&#34; &#38; Data");
  });

  it("a repeated registration sends nothing; a closed event and a waitlist are reported", async () => {
    const repeated = setup({
      register: () => Promise.resolve({ status: "waitlisted" as const, created: false }),
    });
    expect(await repeated.run(member, { slug: "simposium", token: "good" }, "id")).toEqual({
      ok: true,
      status: "waitlisted",
    });
    expect(repeated.send).not.toHaveBeenCalled();
    const waitlisted = setup({
      register: () => Promise.resolve({ status: "waitlisted" as const, created: true }),
    });
    await waitlisted.run(member, { slug: "simposium", token: "good" }, "en");
    const [mail] = waitlisted.send.mock.calls[0] as unknown as [{ text: string }];
    expect(mail.text).toContain("waiting list");
    const closed = setup({
      register: () => Promise.reject(new RuleViolationError("Registration is closed.")),
    });
    expect(await closed.run(member, { slug: "simposium", token: "good" }, "id")).toEqual({
      ok: false,
      error: "closed",
    });
    const broken = setup({ register: () => Promise.reject(new Error("db down")) });
    await expect(broken.run(member, { slug: "simposium", token: "good" }, "id")).rejects.toThrow(
      "db down",
    );
  });
});
