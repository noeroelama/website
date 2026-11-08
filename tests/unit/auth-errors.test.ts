import { describe, expect, it } from "vitest";
import { authErrorMessage, signUpSchema } from "../../apps/web/src/lib/auth-errors";

describe("sign-in error messages (no account enumeration, no internal details)", () => {
  it("gives the same message for unknown email and wrong password", () => {
    const wrong = authErrorMessage({ code: "auth/wrong-password" });
    expect(authErrorMessage({ code: "auth/user-not-found" })).toBe(wrong);
    expect(authErrorMessage({ code: "auth/invalid-credential" })).toBe(wrong);
    expect(wrong).toBe("Email or password is incorrect.");
  });

  it("explains actionable cases and hides everything else", () => {
    expect(authErrorMessage({ code: "auth/too-many-requests" })).toMatch(/Too many attempts/);
    expect(authErrorMessage({ code: "auth/popup-closed-by-user" })).toBe("");
    expect(authErrorMessage({ code: "auth/cancelled-popup-request" })).toBe("");
    expect(authErrorMessage({ code: "auth/email-already-in-use" })).toMatch(/sign in or reset/);
    expect(authErrorMessage({ code: "auth/weak-password" })).toMatch(/at least 8/);
    expect(authErrorMessage({ code: "auth/network-request-failed" })).toMatch(/connection/);
    expect(authErrorMessage({ name: "NotAllowedError" })).toBe("");
    expect(authErrorMessage({ code: "passkey/failed" })).toMatch(/Passkey sign-in didn't work/);
    expect(authErrorMessage({ code: "passkey/reauthenticate" })).toMatch(/sign in again/);
    expect(authErrorMessage(new Error("internal: projects/123 quota"))).toBe(
      "Something went wrong. Please try again.",
    );
    expect(authErrorMessage("x")).toBe("Something went wrong. Please try again.");
  });
});

describe("sign-up form validation", () => {
  it("requires a valid email, 8+ character password and matching confirmation", () => {
    const ok = { email: "a@b.org", password: "longenough1", confirm: "longenough1" };
    expect(signUpSchema.safeParse(ok).success).toBe(true);
    expect(signUpSchema.safeParse({ ...ok, email: "nope" }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...ok, password: "short", confirm: "short" }).success).toBe(
      false,
    );
    expect(signUpSchema.safeParse({ ...ok, confirm: "different1" }).success).toBe(false);
  });
});
