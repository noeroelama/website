/** Error after a server action; when it needs a fresh sign-in, also the link to do it. */
export function ActionError({
  text,
  reauthUrl,
}: {
  text: string | null;
  reauthUrl?: string | null;
}) {
  if (!text) return null;
  return (
    <p role="alert" className="admin-field__error">
      {text}{" "}
      {reauthUrl && text.startsWith("For your security") ? (
        <a href={reauthUrl}>Sign in again</a>
      ) : null}
    </p>
  );
}
