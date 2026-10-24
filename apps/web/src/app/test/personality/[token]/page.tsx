import type { Metadata } from "next";
import { cookies } from "next/headers";
import { PERSONALITY_ITEMS } from "@website/domain/recruitment";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { personalityTest } from "@/server/recruitment-wiring";
import { PersonalityForm, PersonalityResultView } from "./personality-form";

// The token is a capability: never indexed, read per request.
export const metadata: Metadata = {
  title: "Personality test",
  robots: { index: false, follow: false },
};
export const instant = false;

/** /test/personality/{token}: the 60 statements, or the stored result (taken once). */
export default async function PersonalityPage({ params }: PageProps<"/test/personality/[token]">) {
  const { token } = await params;
  const [opened, jar] = await Promise.all([personalityTest().open(token), cookies()]);
  const language = languageFrom(jar.get(LANG_COOKIE)?.value);
  const t = DICTIONARIES[language].personality;
  return (
    <main className="ui-shell">
      <h1 className="ui-shell-title">{t.title}</h1>
      {!opened ? (
        <p className="site-notice">{t.invalidLink}</p>
      ) : opened.result ? (
        <PersonalityResultView result={opened.result} labels={t} />
      ) : (
        <>
          <p>{t.intro}</p>
          <p className="site-muted">{t.notice}</p>
          <PersonalityForm
            token={token}
            items={PERSONALITY_ITEMS.map((i) => ({
              no: i.no,
              text: language === "en" ? i.en : i.id,
            }))}
            labels={t}
          />
        </>
      )}
    </main>
  );
}
