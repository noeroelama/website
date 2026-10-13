import { describe, expect, it } from "vitest";
import { safeReturnUrl, signInUrl } from "@website/auth";

const apps = ["https://web.ppiasiania.id", "https://admin.ppiasiania.id", "http://localhost:3001"];

describe("return URL after sign-in (no open redirect)", () => {
  it("allows our own apps and relative paths", () => {
    expect(safeReturnUrl("https://admin.ppiasiania.id/events?x=1", apps)).toBe(
      "https://admin.ppiasiania.id/events?x=1",
    );
    expect(safeReturnUrl("http://localhost:3001/", apps)).toBe("http://localhost:3001/");
    expect(safeReturnUrl("/account", apps)).toBe("/account");
  });

  it("refuses everything else", () => {
    for (const value of [
      null,
      "",
      "https://evil.example",
      "https://admin.ppiasiania.id.evil.example/",
      "https://evil.example@admin.ppiasiania.id/", // userinfo trick
      "http://admin.ppiasiania.id/", // downgrade: origin differs
      "//evil.example/path", // protocol-relative
      "/\\evil.example", // backslash is treated as a slash by browsers
      "javascript:alert(1)",
      "data:text/html,x",
      "account", // not absolute, not a path
      "x".repeat(3000),
    ]) {
      expect(safeReturnUrl(value, apps), String(value).slice(0, 40)).toBeNull();
    }
  });

  it("ignores allowed-origin entries that are not valid URLs", () => {
    expect(
      safeReturnUrl("https://web.ppiasiania.id/", ["not a url", "https://web.ppiasiania.id"]),
    ).toBe("https://web.ppiasiania.id/");
  });
});

describe("sign-in redirect URL", () => {
  it("sends the visitor to the web sign-in page with the page to return to", () => {
    expect(signInUrl("https://web.ppiasiania.id", "https://admin.ppiasiania.id/audit?page=2")).toBe(
      "https://web.ppiasiania.id/login?next=https%3A%2F%2Fadmin.ppiasiania.id%2Faudit%3Fpage%3D2",
    );
    expect(signInUrl("https://web.ppiasiania.id/", "/account")).toBe(
      "https://web.ppiasiania.id/login?next=%2Faccount",
    );
  });
});
