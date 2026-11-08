import { cookies } from "next/headers";
import { Suspense, type ReactNode } from "react";
import {
  DICTIONARIES,
  LANG_COOKIE,
  languageFrom,
  type Dictionary,
  type Language,
} from "./dictionaries";

type Render = (t: Dictionary, language: Language) => ReactNode;

async function FromCookie({ render }: { render: Render }) {
  const language = languageFrom((await cookies()).get(LANG_COOKIE)?.value);
  return render(DICTIONARIES[language], language);
}

export function Localized({ render }: { render: Render }) {
  return (
    <Suspense fallback={render(DICTIONARIES.id, "id")}>
      <FromCookie render={render} />
    </Suspense>
  );
}
