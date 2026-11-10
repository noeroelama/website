import "server-only";

const INTEGRATIONS: ReadonlyArray<{
  readonly name: string;
  readonly section: "whatsapp" | "zoom" | "other";
  readonly anyOf: ReadonlyArray<readonly string[]>;
}> = [
  {
    name: "WhatsApp messages (WAHA)",
    section: "whatsapp",
    anyOf: [["WAHA_BASE_URL", "WAHA_API_KEY"]],
  },
  { name: "WhatsApp poll answers", section: "whatsapp", anyOf: [["WAHA_WEBHOOK_SECRET"]] },
  {
    name: "WhatsApp chatbot (Cloud API)",
    section: "whatsapp",
    anyOf: [
      [
        "WHATSAPP_CLOUD_PHONE_NUMBER_ID",
        "WHATSAPP_CLOUD_TOKEN",
        "WHATSAPP_CLOUD_APP_SECRET",
        "WHATSAPP_CLOUD_VERIFY_TOKEN",
      ],
    ],
  },
  {
    name: "Zoom rooms",
    section: "zoom",
    anyOf: [["ZOOM_ACCOUNT_ID", "ZOOM_CLIENT_ID", "ZOOM_CLIENT_SECRET", "ZOOM_HOST_USER"]],
  },
  { name: "Zoom webhooks", section: "zoom", anyOf: [["ZOOM_WEBHOOK_SECRET_TOKEN"]] },
  {
    name: "Recording archive (Google Drive)",
    section: "zoom",
    anyOf: [["GOOGLE_DRIVE_CLIENT_EMAIL", "GOOGLE_DRIVE_PRIVATE_KEY", "GOOGLE_DRIVE_FOLDER_ID"]],
  },
  { name: "Minutes drafting (AI)", section: "other", anyOf: [["ANTHROPIC_API_KEY"]] },
  {
    name: "Short links",
    section: "other",
    anyOf: [["GOPPI_BASE_URL", "GOPPI_API_KEY"], ["SHORTLINK_API_KEY"]],
  },
  { name: "Calendar feeds", section: "other", anyOf: [["CALENDAR_FEED_SIGNING_SECRET"]] },
  {
    name: "E-mail (Resend)",
    section: "other",
    anyOf: [["RESEND_API_KEY", "EMAIL_FROM_TRANSACTIONAL"]],
  },
];

export function integrationStatus(env: Readonly<Record<string, unknown>>) {
  return {
    messagingMode: env["MESSAGING_MODE"] === "live" ? ("live" as const) : ("log" as const),
    integrations: INTEGRATIONS.map(({ name, section, anyOf }) => ({
      name,
      section,
      missing: anyOf
        .map((group) => group.filter((key) => !env[key]))
        .reduce((a, b) => (b.length < a.length ? b : a)),
    })).map((i) => ({ ...i, configured: i.missing.length === 0 })),
  };
}
