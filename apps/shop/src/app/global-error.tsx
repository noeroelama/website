"use client";

import { Poppins } from "next/font/google";
import { ErrorPage } from "@website/ui";
import "@website/ui/styles.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
});

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
