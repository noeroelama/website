export function AccessMessage({ reason }: { reason: "signed-out" | "no-access" | "profile" }) {
  return (
    <p data-testid="auth-state">
      {reason === "signed-out"
        ? "Not signed in — sign-in required."
        : reason === "profile"
          ? "Complete your member profile on the website first (Your account → Member profile)."
          : "Your role does not include this page. Ask an administrator for access."}
    </p>
  );
}
