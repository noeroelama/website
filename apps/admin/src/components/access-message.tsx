/**
 * Shown by a staff page when it cannot show its content. Normally a signed-out visitor never
 * sees this: requireAdminViewer() redirects to the web sign-in page first.
 */
export function AccessMessage({ reason }: { reason: "signed-out" | "no-access" }) {
  return (
    <p data-testid="auth-state">
      {reason === "signed-out"
        ? "Not signed in — sign-in required."
        : "This account has no staff access. Ask an administrator for a role."}
    </p>
  );
}
