"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AnswerValue, Question } from "@website/domain/forms";
import { FormFields } from "@/components/form-fields";
import type { Dictionary } from "@/i18n/dictionaries";
import { answersFrom, valuesFrom, type FieldValues } from "@/lib/form-answers";
import type { ApplyResult } from "@/server/recruitment";
import { saveApplicationDraftAction, submitApplicationAction } from "../actions";

interface Unit {
  id: string;
  name: string;
  portfolioRequired: boolean;
}

export function ApplyForm(props: {
  recruitmentId: string;
  maxChoices: number;
  units: Unit[];
  questions: readonly Question[];
  initial: { choices: string[]; answers: Record<string, AnswerValue>; portfolio: string | null };
  labels: Dictionary["recruitment"];
  formLabels: Dictionary["forms"];
}) {
  const t = props.labels;
  const router = useRouter();
  const [choices, setChoices] = useState<string[]>(() =>
    Array.from({ length: props.maxChoices }, (_, i) => props.initial.choices[i] ?? ""),
  );
  const [value, setValue] = useState<FieldValues>(() =>
    valuesFrom(props.questions, props.initial.answers),
  );
  const [portfolio, setPortfolio] = useState(props.initial.portfolio);
  const [files, setFiles] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      props.questions.flatMap((q) => {
        const answer = props.initial.answers[q.id];
        return q.type === "file" && answer && typeof answer === "object" && "name" in answer
          ? [[q.id, answer.name]]
          : [];
      }),
    ),
  );
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const chosen = choices.filter(Boolean);
  const needsPortfolio = props.units.some((u) => u.portfolioRequired && chosen.includes(u.id));

  const describe = (result: ApplyResult, done: string): string => {
    if (result.ok) return done;
    if (result.error === "answers") return props.formLabels.checkAnswers;
    if (result.error === "refused") return result.message ?? t.failed;
    if (result.error === "locked") return t.locked;
    if (result.error === "closed") return t.actions.closed;
    if (result.error === "profile") return t.profile;
    if (result.error === "signin") return t.signIn;
    return t.failed;
  };

  const show = (result: ApplyResult, done: string) => {
    setErrors(
      !result.ok && result.error === "answers"
        ? Object.fromEntries(
            Object.entries(result.fields).map(([id, text]) => [
              id,
              text === "This question is required."
                ? props.formLabels.requiredAnswer
                : props.formLabels.invalidAnswer,
            ]),
          )
        : {},
    );
    setMessage(describe(result, done));
  };

  const saveDraft = () =>
    saveApplicationDraftAction({
      recruitmentId: props.recruitmentId,
      choices: chosen,
      answers: answersFrom(
        props.questions.filter((q) => q.type !== "file"),
        value,
      ),
    });

  const run = async (submit: boolean) => {
    setBusy(true);
    try {
      const draft = await saveDraft();
      if (!submit || !draft.ok) {
        show(draft, t.saved);
        return;
      }
      const result = await submitApplicationAction({ recruitmentId: props.recruitmentId });
      show(result, t.submitted);
      if (result.ok) router.push(`/recruitment/${props.recruitmentId}`);
    } catch {
      setMessage(t.failed);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File, questionId: string | null = null) => {
    setBusy(true);
    setMessage(t.uploading);
    try {
      const draft = await saveDraft();
      if (!draft.ok) {
        show(draft, t.saved);
        return;
      }
      const query = questionId ? `?question=${encodeURIComponent(questionId)}` : "";
      const response = await fetch(`/api/recruitment/${props.recruitmentId}/portfolio${query}`, {
        method: "POST",
        body: file,
        headers: {
          "Content-Type": "application/pdf",
          "X-File-Name": encodeURIComponent(file.name),
        },
      });
      const body = (await response.json()) as { ok?: boolean; name?: string; error?: string };
      if (body.ok && body.name) {
        const name = body.name;
        if (questionId === null) setPortfolio(name);
        else setFiles((f) => ({ ...f, [questionId]: name }));
        setMessage(null);
      } else {
        setMessage(
          body.error === "not_pdf" ? t.notPdf : body.error === "too_large" ? t.tooLarge : t.failed,
        );
      }
    } catch {
      setMessage(t.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="ui-form site-form"
      onSubmit={(e) => {
        e.preventDefault();
        void run(true);
      }}
    >
      <fieldset className="ui-field site-choices">
        <legend>{t.units}</legend>
        <span className="site-muted">{t.choicesHint.replace("{n}", String(props.maxChoices))}</span>
        {choices.map((choice, i) => (
          <label key={i} className="ui-field">
            {t.choice} {i + 1}
            <select
              className="ui-input"
              required={i === 0}
              value={choice}
              onChange={(e) => setChoices(choices.map((c, j) => (j === i ? e.target.value : c)))}
            >
              <option value="">{t.none}</option>
              {props.units
                .filter((u) => u.id === choice || !choices.includes(u.id))
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                    {u.portfolioRequired ? ` (${t.portfolio})` : ""}
                  </option>
                ))}
            </select>
          </label>
        ))}
      </fieldset>

      {needsPortfolio && (
        <div className="ui-field">
          <label htmlFor="portfolio">{t.upload}</label>
          {portfolio && (
            <span className="site-muted">
              {t.uploaded} {portfolio}
            </span>
          )}
          <input
            id="portfolio"
            className="ui-input"
            type="file"
            accept="application/pdf"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = "";
            }}
          />
        </div>
      )}

      <FormFields
        questions={props.questions}
        value={value}
        onChange={setValue}
        errors={errors}
        labels={props.formLabels}
        onFile={(questionId, file) => upload(file, questionId)}
        fileNames={files}
        disabled={busy}
      />

      <div className="site-filters">
        <button className="ui-button" type="button" disabled={busy} onClick={() => void run(false)}>
          {busy ? t.saving : t.saveDraft}
        </button>
        <button className="ui-button" type="submit" disabled={busy}>
          {t.submit}
        </button>
      </div>
      {message && (
        <p role="status" className="ui-message">
          {message}
        </p>
      )}
    </form>
  );
}
