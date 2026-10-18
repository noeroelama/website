"use client";

import { useRouter } from "next/navigation";
import { LANG_COOKIE, type Language } from "@/i18n/dictionaries";

function saveLanguage(language: Language) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${LANG_COOKIE}=${language}; Max-Age=31536000; Path=/; SameSite=Lax${secure}`;
}

/** Sets the `lang` cookie (1 year, not personal data) and re-renders the page in that language. */
export function LanguageSwitch(props: {
  current: Language;
  label: string;
  switchTo: string;
  names: Record<Language, string>;
}) {
  const router = useRouter();
  const choose = (language: Language) => {
    saveLanguage(language);
    router.refresh();
  };
  return (
    <div className="site-lang" role="group" aria-label={props.label}>
      {(["id", "en"] as const).map((language) => (
        <button
          key={language}
          type="button"
          className="site-lang__button"
          aria-pressed={props.current === language}
          aria-label={`${props.switchTo} ${props.names[language]}`}
          onClick={() => choose(language)}
        >
          {props.names[language]}
        </button>
      ))}
    </div>
  );
}
