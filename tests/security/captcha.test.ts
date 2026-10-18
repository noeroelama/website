import { describe, expect, it } from "vitest";
import { createRecaptchaVerifier, passesCaptcha } from "../../apps/web/src/server/captcha";

const answer = (body: unknown) => (() => Promise.resolve(Response.json(body))) as typeof fetch;

describe("reCAPTCHA v3 on public forms", () => {
  it("accepts only a successful token made for the same action", async () => {
    const ok = createRecaptchaVerifier({
      secret: "s",
      fetchImpl: answer({ success: true, score: 0.9, action: "event_register" }),
    });
    expect(await ok.verify("t", "event_register")).toEqual({ success: true, score: 0.9 });
    expect(await ok.verify("t", "newsletter")).toEqual({ success: false, score: 0.9 });
    const refused = createRecaptchaVerifier({ secret: "s", fetchImpl: answer({ success: false }) });
    expect(await refused.verify("t", "event_register")).toEqual({ success: false, score: null });
  });

  it("fails closed on network errors", async () => {
    const broken = createRecaptchaVerifier({
      secret: "s",
      fetchImpl: () => Promise.reject(new Error("offline")),
    });
    expect(await broken.verify("t", "a")).toEqual({ success: false, score: null });
  });

  it("applies the minimum score; without a key only development and test pass", async () => {
    const verifier = (score: number | null) => ({
      verify: () => Promise.resolve({ success: true, score }),
    });
    const config = { minScore: 0.5, appEnv: "production" };
    expect(await passesCaptcha(verifier(0.7), config, "t", "a")).toBe(true);
    expect(await passesCaptcha(verifier(0.3), config, "t", "a")).toBe(false);
    expect(await passesCaptcha(verifier(null), config, "t", "a")).toBe(false);
    for (const [appEnv, expected] of [
      ["development", true],
      ["test", true],
      ["staging", false],
      ["production", false],
    ] as const) {
      expect(await passesCaptcha(null, { minScore: 0.5, appEnv }, "t", "a")).toBe(expected);
    }
  });
});
