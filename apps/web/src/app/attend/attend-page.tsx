import { cookies } from "next/headers";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { getSignedInUser } from "@/server/session";
import { AttendForm } from "./attend-form";

export async function AttendPage({ code }: { code: string }) {
  const [jar, user] = await Promise.all([cookies(), getSignedInUser()]);
  const t = DICTIONARIES[languageFrom(jar.get(LANG_COOKIE)?.value)].attend;
  const back = code ? `/attend/${encodeURIComponent(code)}` : "/attend";
  return (
    <main className="ui-shell">
      <h1 className="ui-shell-title">{t.title}</h1>
      <p>{t.intro}</p>
      {user ? (
        <AttendForm code={code} labels={t} />
      ) : (
        <p>
          <a className="ui-button" href={`/login?next=${encodeURIComponent(back)}`}>
            {t.signin}
          </a>
        </p>
      )}
    </main>
  );
}
