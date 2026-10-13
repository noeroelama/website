import type { ReactNode } from "react";

/** Fixed, generic copy per status. Nothing here comes from the error itself. */
const COPY = {
  401: { title: "Sign-in required", message: "Please sign in to view this page." },
  403: { title: "Access denied", message: "You do not have permission to view this page." },
  404: {
    title: "Page not found",
    message: "The page you are looking for does not exist or has been moved.",
  },
  500: {
    title: "Something went wrong",
    message: "An unexpected error occurred. Please try again later.",
  },
} as const;

export type ErrorStatus = keyof typeof COPY;

/**
 * Error page shared by web, admin and shop (their not-found, forbidden, unauthorized, error and
 * global-error files). It never receives the error: details are logged on the server only.
 * `reference` is the opaque Next.js error digest, which matches the server log line.
 */
export function ErrorPage(props: {
  status: ErrorStatus;
  reference?: string | undefined;
  action?: ReactNode;
}) {
  const { title, message } = COPY[props.status];
  return (
    <main className="ui-shell">
      <p className="ui-error-status">{props.status}</p>
      <h1 className="ui-shell-title">{title}</h1>
      <p>{message}</p>
      {props.reference && <p className="ui-error-reference">Reference: {props.reference}</p>}
      <p className="ui-error-actions">
        {props.action}
        <a href="/" className="ui-button">
          Back to home
        </a>
      </p>
    </main>
  );
}
