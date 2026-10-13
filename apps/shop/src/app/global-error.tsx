"use client"; // Error boundaries must be Client Components.

import { Poppins } from "next/font/google";
import { ErrorPage } from "@website/ui";
import "@website/ui/styles.css";

// global-error replaces the root layout when it fails, so it loads the font and styles itself.
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
});

/** Shown when the root layout throws. Same rules as error.tsx: no error details in the browser. */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en" className={poppins.variable}>
      <body>
        <title>Something went wrong</title>
        <ErrorPage
          status={500}
          reference={error.digest}
          action={
            <button type="button" className="ui-button" onClick={() => retry()}>
              Try again
            </button>
          }
        />
      </body>
    </html>
  );
}
