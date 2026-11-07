import { can } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { requireAdminViewer } from "@/server/context";
import { getAdminEnv } from "@/server/env";
import { integrationStatus } from "@/server/settings";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

const SECTIONS = [
  { key: "zoom", title: "Zoom" },
  { key: "whatsapp", title: "WhatsApp" },
  { key: "other", title: "Other integrations" },
] as const;

/**
 * Settings (L3): where each setting lives. Zoom and letterhead settings are edited on their own
 * pages (with their own permissions); integrations are set in the cPanel app screen.
 */
export default async function SettingsPage() {
  const viewer = await requireAdminViewer("/settings", "settings.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const { messagingMode, integrations } = integrationStatus(getAdminEnv());
  const { principal } = viewer;
  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Settings</h1>
          <p className="admin-page-header__desc">
            Secrets are set in the hosting app screen (see docs/environment.md), never here. This
            page only shows whether each integration is configured.
          </p>
        </div>
      </div>
      {SECTIONS.map((section) => (
        <Card key={section.key}>
          <CardHeader title={section.title} />
          <CardBody>
            {section.key === "zoom" && can(principal, "zoom.settings") ? (
              <p>
                <a href="/zoom">Licences, concurrency and the Host Key</a> are edited on the Zoom
                page.
              </p>
            ) : null}
            {section.key === "whatsapp" ? (
              <p>
                Messages are{" "}
                {messagingMode === "live" ? "sent for real" : "only logged (MESSAGING_MODE=log)"}.
              </p>
            ) : null}
            <ul>
              {integrations
                .filter((i) => i.section === section.key)
                .map((i) => (
                  <li key={i.name}>
                    {i.name}{" "}
                    <Badge tone={i.configured ? "success" : "danger"}>
                      {i.configured ? "Configured" : "Not configured"}
                    </Badge>
                  </li>
                ))}
            </ul>
          </CardBody>
        </Card>
      ))}
      <Card>
        <CardHeader title="Letters" />
        <CardBody>
          <p>
            The letterhead and letter types are edited on{" "}
            {can(principal, "letter_types.read") ? (
              <a href="/letters/types">Letter types</a>
            ) : (
              "the Letter types page"
            )}
            .
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
