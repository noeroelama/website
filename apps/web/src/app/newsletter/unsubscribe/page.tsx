import type { Metadata } from "next";
import { cookies } from "next/headers";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { UnsubscribeButton } from "../link-action";

export const metadata: Metadata = { title: "Newsletter", robots: { index: false } };

// The signed link from a campaign e-mail; the visitor presses the button to unsubscribe.
export const instant = false;

export default async function UnsubscribePage({
  searchParams,
}: PageProps<"/newsletter/unsubscribe">) {
  const params = await searchParams;
  const t = DICTIONARIES[languageFrom((await cookies()).get(LANG_COOKIE)?.value)].newsletter;
  const token = typeof params["t"] === "string" ? params["t"] : "";
  return (
    <main className="ui-shell">
      <h1 className="ui-shell-title">{t.unsubscribeTitle}</h1>
      {token ? (
        <UnsubscribeButton
          token={token}
          labels={{ button: t.unsubscribeButton, done: t.unsubscribed, invalid: t.invalidLink }}
        />
      ) : (
        <p>{t.invalidLink}</p>
      )}
    </main>
  );
}
