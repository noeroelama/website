/**
 * Shown by a staff page when it cannot show its content. Normally a signed-out visitor never
 * sees this: requireAdminViewer() redirects to the web sign-in page first, and shows the
 * restricted (403) page to signed-in users without any staff role.
 */
export function AccessMessage({ reason }: { reason: "signed-out" | "no-access" }) {
  return (
    <p data-testid="auth-state">
      {reason === "signed-out"
        ? "Not signed in — sign-in required."
        : "Your role does not include this page. Ask an administrator for access."}
    </p>
  );
}
