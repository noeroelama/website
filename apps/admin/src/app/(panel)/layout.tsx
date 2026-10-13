import { Suspense, type ReactNode } from "react";
import { AppShell, StatusBadge } from "@website/ui";
import { AdminSidebar } from "@/components/admin-sidebar";
import { initials, navigationFor } from "@/navigation";
import { getAdminViewer } from "@/server/context";

/**
 * Frame for every staff page. Partial Prerendering: the page segment ({children}) is ALWAYS
 * rendered — in the prerendered fallback and after the session is known — so Next.js can
 * validate instant navigation. The side panel depends on the session and streams in.
 *
 * The layout is not the security boundary (layouts are not re-run on every client navigation):
 * each page checks the session itself inside its own <Suspense> (see (panel)/page.tsx).
 */
export default function PanelLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<SignedOutFrame>{children}</SignedOutFrame>}>
      <Panel>{children}</Panel>
    </Suspense>
  );
}

async function Panel({ children }: { children: ReactNode }) {
  const viewer = await getAdminViewer();
  if (!viewer) return <SignedOutFrame>{children}</SignedOutFrame>;

  const name = viewer.name ?? viewer.email ?? "Staff member";
  return (
    <AdminSidebar
      items={navigationFor(viewer.principal)}
      user={{ name, email: viewer.email, initials: initials(name) }}
    >
      {children}
    </AdminSidebar>
  );
}

function SignedOutFrame({ children }: { children: ReactNode }) {
  return (
    <AppShell title="Admin">
      <p>
        <StatusBadge label="admin: ok" status="ok" />
      </p>
      {children}
    </AppShell>
  );
}
