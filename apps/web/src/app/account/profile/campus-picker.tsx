"use client";

import { useEffect, useState } from "react";
import type { Dictionary } from "@/i18n/dictionaries";
import type { UniversityChoice } from "@/server/universities";
import { campusChoicesAction, proposeCampusAction } from "./actions";

type Text = Dictionary["profile"];

/**
 * University field of the profile (A3): the campuses of the chosen PPI country, filtered in the
 * browser as the member types (name or alias, anywhere in the name), plus "my campus is not
 * listed" to propose one. Typing without picking keeps the typed name (no campus id).
 */
export function CampusPicker(props: {
  t: Text;
  countryCode: string;
  value: { id: string | null; name: string };
  onChange: (value: { id: string | null; name: string }) => void;
  error: string | undefined;
}) {
  const { t, countryCode } = props;
  const [choices, setChoices] = useState<UniversityChoice[]>([]);
  const [proposing, setProposing] = useState(false);
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void campusChoicesAction(countryCode).then((list) => {
      if (current) setChoices(list);
    });
    return () => {
      current = false;
    };
  }, [countryCode]);

  const query = props.value.name.trim().toLowerCase();
  const matches = choices
    .filter(
      (c) =>
        query === "" ||
        c.name.toLowerCase().includes(query) ||
        c.aliases.some((a) => a.toLowerCase().includes(query)),
    )
    .slice(0, 50);

  const propose = async () => {
    setBusy(true);
    const result = await proposeCampusAction({ name: props.value.name, countryCode, city });
    setBusy(false);
    if (result.ok) {
      setChoices((list) => [
        ...list,
        { id: result.id, name: result.name, aliases: [], pending: true },
      ]);
      props.onChange({ id: result.id, name: result.name });
      setProposing(false);
      setMessage(t.universityProposed);
      return;
    }
    setMessage(result.error === "duplicate" ? result.message : t.invalid);
  };

  return (
    <div className="ui-field">
      <label className="ui-field">
        {t.universitySearch}
        <input
          className="ui-input"
          value={props.value.name}
          required
          onChange={(e) => props.onChange({ id: null, name: e.target.value })}
        />
      </label>
      {countryCode && (
        <select
          className="ui-input"
          aria-label={t.university}
          size={Math.min(6, Math.max(2, matches.length))}
          value={props.value.id ?? ""}
          onChange={(e) => {
            const choice = matches.find((c) => c.id === e.target.value);
            if (choice) props.onChange({ id: choice.id, name: choice.name });
          }}
        >
          {matches.length === 0 && (
            <option value="" disabled>
              {t.universityNone}
            </option>
          )}
          {matches.map((c) => (
            <option key={c.id} value={c.id}>
              {c.pending ? `${c.name} (${t.universityPending})` : c.name}
            </option>
          ))}
        </select>
      )}
      {countryCode && !proposing && (
        <button className="ui-button" type="button" onClick={() => setProposing(true)}>
          + {t.universityMissing}
        </button>
      )}
      {proposing && (
        <>
          <label className="ui-field">
            {t.universityCity}
            <input className="ui-input" value={city} onChange={(e) => setCity(e.target.value)} />
          </label>
          <button
            className="ui-button"
            type="button"
            disabled={busy || props.value.name.trim().length < 3}
            onClick={() => void propose()}
          >
            {t.universityPropose}: {props.value.name}
          </button>
        </>
      )}
      {(message ?? props.error) && (
        <p role="status" className="ui-message" data-tone={props.error ? "error" : "info"}>
          {props.error ?? message}
        </p>
      )}
    </div>
  );
}
