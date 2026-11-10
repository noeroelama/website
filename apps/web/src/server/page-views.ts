import "server-only";
import { lazyEnv } from "@website/config/env";
import { createSqlPageViewStore, type PageViewHit } from "@website/db/sql";
import { clientIp, keyedHash } from "@website/security";
import { webDb } from "./db";
import { getWebEnv } from "./env";
import { logger } from "./session";

const PAGE = /^\/[\w\-./~%@]{0,199}$/;
const HOST = /^[a-z0-9.-]{1,100}$/;
const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse/i;

/** Sections of the site whose pages are counted; content sections keep their item slug. */
const WITH_ITEMS = new Set([
  "news",
  "events",
  "gallery",
  "recruitment",
  "newsletter",
  "activities",
]);
const SECTIONS = new Set([...WITH_ITEMS, "about", "map", "privacy", "terms", "verify", "attend"]);

/** The page as counted: a known section, plus one item slug where the section has items. */
export function countedPage(path: string): string | null {
  const [section = "", item] = path.split("?")[0]?.split("/").filter(Boolean) ?? [];
  if (section === "") return "/";
  if (!SECTIONS.has(section)) return null;
  return WITH_ITEMS.has(section) && item ? `/${section}/${item}` : `/${section}`;
}

function referrerHost(value: unknown): string | null {
  if (typeof value !== "string" || !URL.canParse(value)) return null;
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  return (url.protocol === "https:" || url.protocol === "http:") && HOST.test(host) ? host : null;
}

export function pageViewHit(
  input: { page: unknown; referrer: unknown },
  headers: Headers,
  secret: string,
  now: Date,
): PageViewHit | null {
  const ua = headers.get("user-agent") ?? "";
  if (!ua || BOT.test(ua)) return null;
  if (typeof input.page !== "string" || !PAGE.test(input.page)) return null;
  const page = countedPage(input.page);
  if (!page) return null;
  const day = now.toISOString().slice(0, 10);
  return {
    page,
    // The day is in the hash, so one visitor cannot be followed from one day to the next.
    visitor: keyedHash("page-view", `${day}|${clientIp(headers)}|${ua}`, secret),
    mobile: /Mobi|Android|iPhone|iPad/i.test(ua),
    referrer: referrerHost(input.referrer),
    at: now,
  };
}

const store = lazyEnv(() => createSqlPageViewStore(webDb()));

export async function trackPageView(
  input: { page: unknown; referrer: unknown },
  headers: Headers,
): Promise<void> {
  const secret = getWebEnv().LINK_SIGNING_SECRET;
  const hit = secret ? pageViewHit(input, headers, secret, new Date()) : null;
  if (!hit) return;
  await store()
    .record(hit)
    .catch((error: unknown) => logger().error("page_view_failed", { error: String(error) }));
}
