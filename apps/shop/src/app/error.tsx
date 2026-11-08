"use client";

import { ErrorPage } from "@website/ui";

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
