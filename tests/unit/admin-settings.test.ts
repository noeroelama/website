import { describe, expect, it } from "vitest";
import { integrationStatus } from "../../apps/admin/src/server/settings";

describe("dashboard: integration status (L3)", () => {
  it("says which integrations are configured and never returns a secret", () => {
    const env = {
      MESSAGING_MODE: "live",
      WAHA_BASE_URL: "https://waha.example.org",
      WAHA_API_KEY: "waha-secret-value",
      ZOOM_ACCOUNT_ID: "acc",
      ZOOM_CLIENT_ID: "id",
      ZOOM_CLIENT_SECRET: "zoom-secret-value",
      ZOOM_HOST_USER: "host@example.org",
      SHORTLINK_API_KEY: "sid-secret-value",
    };
    const status = integrationStatus(env);
    expect(status.messagingMode).toBe("live");
    expect(
      Object.fromEntries(status.integrations.map((i) => [i.name, i.configured])),
    ).toMatchObject({
      "WhatsApp messages (WAHA)": true,
      "WhatsApp poll answers": false,
      "WhatsApp chatbot (Cloud API)": false,
      "Zoom rooms": true,
      "Zoom webhooks": false,
      "Short links": true,
      "Minutes drafting (AI)": false,
    });
    const missing = Object.fromEntries(status.integrations.map((i) => [i.name, i.missing]));
    expect(missing["Zoom rooms"]).toEqual([]);
    expect(missing["Zoom webhooks"]).toEqual(["ZOOM_WEBHOOK_SECRET_TOKEN"]);
    expect(missing["WhatsApp poll answers"]).toEqual(["WAHA_WEBHOOK_SECRET"]);
    expect(integrationStatus({ GOPPI_BASE_URL: "x" }).integrations).toContainEqual(
      expect.objectContaining({ name: "Short links", missing: ["GOPPI_API_KEY"] }),
    );
    const text = JSON.stringify(status);
    for (const value of Object.values(env).filter((v) => v.includes("secret"))) {
      expect(text).not.toContain(value);
    }
    expect(integrationStatus({}).messagingMode).toBe("log");
    expect(integrationStatus({ RESEND_API_KEY: "re_x" }).integrations).toContainEqual(
      expect.objectContaining({ name: "E-mail (Resend)", missing: ["EMAIL_FROM_TRANSACTIONAL"] }),
    );
  });
});
