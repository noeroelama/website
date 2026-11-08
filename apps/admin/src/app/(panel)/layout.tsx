import { Suspense, type ReactNode } from "react";
import { AppShell, initials, StatusBadge } from "@website/ui";
import { AdminSidebar } from "@/components/admin-sidebar";
import { navigationFor } from "@/navigation";
import { getAdminViewer } from "@/server/context";
import { getAppUrls } from "@/server/env";

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
      webUrl={getAppUrls().WEB_URL}
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
