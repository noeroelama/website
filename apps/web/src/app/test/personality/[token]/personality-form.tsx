"use client";

import { useState, type FormEvent } from "react";
import type { Axis, AxisScore } from "@website/domain/recruitment";
import type { Dictionary } from "@/i18n/dictionaries";
import { submitPersonalityAction } from "./actions";

type Labels = Dictionary["personality"];
const AXIS_ORDER: readonly Axis[] = ["mind", "energy", "nature", "tactics", "identity"];
const SCALE = [-3, -2, -1, 0, 1, 2, 3] as const;

export function PersonalityResultView(props: {
  result: { code: string; identity: string; full: string; axes: Readonly<Record<Axis, AxisScore>> };
  labels: Labels;
}) {
  const t = props.labels;
  const [name, description] = t.types[props.result.code] ?? ["", ""];
  return (
    <section>
      <h2>
        {t.resultTitle}: {props.result.full} — {name}
      </h2>
      <p>{description}</p>
      <p className="site-muted">{t.identityNote[props.result.identity as "A" | "T"]}</p>
      <ul>
        {AXIS_ORDER.map((axis) => {
          const score = props.result.axes[axis];
          const positive = score.lean >= 0;
          return (
            <li key={axis}>
              {t.axes[axis].label}: {score.pct}% {positive ? t.axes[axis].pos : t.axes[axis].neg}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function PersonalityForm(props: {
  token: string;
  items: { no: number; text: string }[];
  labels: Labels;
}) {
  const t = props.labels;
  const [answers, setAnswers] = useState<(number | null)[]>(() => props.items.map(() => null));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<
    Parameters<typeof PersonalityResultView>[0]["result"] | null
  >(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (answers.some((a) => a === null)) {
      setMessage(t.missing);
      return;
    }
    setBusy(true);
    try {
      const outcome = await submitPersonalityAction({ token: props.token, answers });
      if (outcome.ok) setResult(outcome.result);
      else
        setMessage(
          outcome.error === "link"
            ? t.invalidLink
            : outcome.error === "taken"
              ? t.taken
              : t.missing,
        );
    } catch {
      setMessage(t.failed);
    } finally {
      setBusy(false);
    }
  };

  if (result) return <PersonalityResultView result={result} labels={t} />;
  return (
    <form className="ui-form site-form" onSubmit={(e) => void submit(e)}>
      {props.items.map((item, i) => (
        <fieldset key={item.no} className="ui-field site-choices">
          <legend>
            {item.no}. {item.text}
          </legend>
          <div className="site-scale">
            {SCALE.map((value, s) => (
              <label key={value} className="site-choice">
                <input
                  type="radio"
                  name={`item-${item.no}`}
                  required
                  checked={answers[i] === value}
                  onChange={() => setAnswers(answers.map((a, j) => (j === i ? value : a)))}
                />
                {t.scale[s]}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <button className="ui-button" type="submit" disabled={busy}>
        {busy ? t.sending : t.submit}
      </button>
      {message && (
        <p role="status" className="ui-message">
          {message}
        </p>
      )}
    </form>
  );
}
