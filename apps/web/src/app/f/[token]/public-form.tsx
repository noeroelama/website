"use client";

import { useState, type FormEvent } from "react";
import type { Question } from "@website/domain/forms";
import { FormFields } from "@/components/form-fields";
import type { Dictionary } from "@/i18n/dictionaries";
import { captchaToken } from "@/lib/captcha-client";
import { answersFrom, EMPTY_VALUES, type FieldValues } from "@/lib/form-answers";
import type { FormSubmitResult } from "@/server/forms";
import { submitFormAction } from "./actions";

/** The answering form of /f/{token}. The server re-checks everything (window, version, answers). */
export function PublicFormClient(props: {
  token: string;
  version: number;
  questions: readonly Question[];
  labels: Dictionary["forms"];
}) {
  const t = props.labels;
  const [value, setValue] = useState<FieldValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const describe = (result: FormSubmitResult): string => {
    if (result.ok) return t.thanks;
    if (result.error === "captcha") return t.captchaFailed;
    if (result.error === "closed" || result.error === "not_found") return t.closed;
    if (result.error === "changed") return t.changed;
    if (result.error === "answers") return t.checkAnswers;
    return t.failed;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const captcha = await captchaToken("form_submit");
      const result = await submitFormAction({
        token: props.token,
        version: props.version,
        answers: answersFrom(props.questions, value),
        captcha,
      });
      // Server messages are in English: show the visitor's language instead.
      setErrors(
        !result.ok && result.error === "answers"
          ? Object.fromEntries(
              Object.entries(result.fields).map(([id, text]) => [
                id,
                text === "This question is required." ? t.requiredAnswer : t.invalidAnswer,
              ]),
            )
          : {},
      );
      setDone(result.ok);
      setMessage(describe(result));
    } catch {
      setMessage(t.failed);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="ui-form">
        <p role="status" className="ui-message" data-tone="info">
          {message}
        </p>
        <button
          className="ui-button"
          type="button"
          onClick={() => {
            setValue(EMPTY_VALUES);
            setDone(false);
            setMessage(null);
          }}
        >
          {t.another}
        </button>
      </div>
    );
  }

  return (
    <form className="ui-form site-form" onSubmit={(e) => void submit(e)}>
      <FormFields
        questions={props.questions}
        value={value}
        onChange={setValue}
        errors={errors}
        labels={t}
      />
      {errors["form"] && <p className="ui-message">{t.changed}</p>}
      <button className="ui-button" type="submit" disabled={busy}>
        {busy ? t.sending : t.submit}
      </button>
      {message && (
        <p role="status" className="ui-message">
          {message}
        </p>
      )}
      <p className="site-muted">{t.recaptchaNotice}</p>
    </form>
  );
}
