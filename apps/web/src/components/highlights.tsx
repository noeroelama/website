import { cookies } from "next/headers";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { formatEventTime } from "@/lib/event-time";
import { publicEvents } from "@/server/events";
import { publishedPublicForms } from "@/server/forms-wiring";
import { publicHighlights } from "@/server/highlights";
import { publishedRecruitments } from "@/server/recruitment-wiring";
import { logger } from "@/server/session";

export async function Highlights({ all = false }: { all?: boolean }) {
  const language = languageFrom((await cookies()).get(LANG_COOKIE)?.value);
  const t = DICTIONARIES[language].home;
  const items = await Promise.all([publishedRecruitments(), publishedPublicForms(), publicEvents()])
    .then(([recruitments, forms, events]) =>
      publicHighlights({ recruitments, forms, events }, new Date(), all ? Infinity : undefined),
    )
    .catch((error: unknown) => {
      logger().error("home_highlights_failed", { error: String(error) });
      return [];
    });
  if (items.length === 0) return all ? <p>{t.noActivities}</p> : null;
  return (
    <section>
      {all ? null : <h2>{t.highlights}</h2>}
      <ul>
        {items.map((item) => (
          <li key={item.href}>
            {t.highlightKinds[item.kind]}: <a href={item.href}>{item.title}</a>
            {item.at
              ? ` — ${item.kind === "event" ? t.starts : t.closes} ${formatEventTime(item.at, "UTC", language)}`
              : ""}
          </li>
        ))}
      </ul>
      {all ? null : <a href="/activities">{t.allActivities}</a>}
    </section>
  );
}
