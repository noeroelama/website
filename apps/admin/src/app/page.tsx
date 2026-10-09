import { Suspense } from "react";
import { AppShell, StatusBadge } from "@website/ui";
import { getPrincipal } from "@/server/context";

// Partial Prerendering: the shell holds no data and is prerendered; everything that depends on
// the session streams in behind <Suspense> and is authenticated server-side on every request.
export default function AdminHomePage() {
  return (
    <AppShell title="Admin">
      <p>
        <StatusBadge label="admin: ok" status="ok" />
      </p>
      <Suspense fallback={<p data-testid="auth-state">Checking sign-in…</p>}>
        <AuthState />
      </Suspense>
    </AppShell>
  );
}

async function AuthState() {
  const principal = await getPrincipal();
  return (
    <p data-testid="auth-state">{principal ? "Signed in" : "Not signed in — sign-in required."}</p>
  );
}
