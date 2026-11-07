import type { Metadata } from "next";
import { Suspense } from "react";
import { Highlights } from "@/components/highlights";
import { Localized } from "@/i18n/localized";

export const metadata: Metadata = { title: "Activities" };

/**
 * M4: every open recruitment, public form in its answer window and upcoming published event —
 * the home panel's read model without its limit. Never meetings, Zoom or unit agendas.
 */
export default function ActivitiesPage() {
  return (
    <main className="ui-shell">
      <Localized render={(t) => <h1 className="ui-shell-title">{t.pages.activities}</h1>} />
      <Suspense fallback={null}>
        <Highlights all />
      </Suspense>
    </main>
  );
}
