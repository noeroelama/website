"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { pageViewAction } from "@/app/page-view-action";

let firstPage = true;

export function PageViewTracker() {
  const pathname = usePathname();
  useEffect(() => {
    // Only the page the visitor landed on has a meaningful referrer.
    const referrer =
      firstPage && document.referrer && new URL(document.referrer).host !== location.host
        ? document.referrer
        : null;
    firstPage = false;
    pageViewAction({ page: pathname, referrer }).catch(() => undefined);
  }, [pathname]);
  return null;
}
