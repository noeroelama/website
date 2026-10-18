import type { Metadata } from "next";
import { cookies } from "next/headers";
import { DICTIONARIES, LANG_COOKIE, languageFrom } from "@/i18n/dictionaries";
import { ConfirmButton } from "../link-action";

export const metadata: Metadata = { title: "Newsletter", robots: { index: false } };

// Depends on the link's query string; nothing is written until the visitor presses Confirm.
export const instant = false;

export default async function ConfirmPage({ searchParams }: PageProps<"/newsletter/confirm">) {
  const params = await searchParams;
  const t = DICTIONARIES[languageFrom((await cookies()).get(LANG_COOKIE)?.value)].newsletter;
  const s = typeof params["s"] === "string" ? params["s"] : "";
  const token = typeof params["t"] === "string" ? params["t"] : "";
  return (
    <main className="ui-shell">
      <h1 className="ui-shell-title">{t.confirmTitle}</h1>
      {s && token ? (
        <ConfirmButton
          s={s}
          t={token}
          labels={{
            button: t.confirmButton,
            confirmed: t.confirmed,
            expired: t.expired,
            invalid: t.invalidLink,
          }}
        />
      ) : (
        <p>{t.invalidLink}</p>
      )}
    </main>
  );
}
