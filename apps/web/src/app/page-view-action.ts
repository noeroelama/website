"use server";

import { headers } from "next/headers";
import { trackPageView } from "@/server/page-views";

export async function pageViewAction(input: { page: string; referrer: string | null }) {
  await trackPageView(input, await headers());
}
