"use client"; // Error boundaries must be Client Components.

import { ErrorPage } from "@website/ui";

/**
 * Shown when a page throws. Next.js logs the error in the server terminal; the browser gets only
 * generic copy and the digest that identifies that log line (docs: packages/ui/docs/error-pages.md).
 */
export default function PageError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <ErrorPage
      status={500}
      reference={error.digest}
      action={
        <button type="button" className="ui-button" onClick={() => retry()}>
          Try again
        </button>
      }
    />
  );
}
