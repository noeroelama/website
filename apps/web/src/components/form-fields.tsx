"use client";

import { TEXT_LIMITS, type Question } from "@website/domain/forms";
import { OTHER, type FieldValues } from "@/lib/form-answers";

export interface FormFieldLabels {
  readonly required: string;
  readonly other: string;
  readonly otherPlaceholder: string;
  readonly fileOnlyInApplication: string;
}

export function FormFields(props: {
  questions: readonly Question[];
  value: FieldValues;
  onChange: (next: FieldValues) => void;
  errors: Readonly<Record<string, string>>;
  labels: FormFieldLabels;
  onFile?: (questionId: string, file: File) => Promise<void>;
  fileNames?: Readonly<Record<string, string>>;
  disabled?: boolean;
}) {
  const { values, others } = props.value;
  const set = (id: string, value: string | readonly string[] | boolean) =>
    props.onChange({ values: { ...values, [id]: value }, others });
  const setOther = (id: string, text: string) =>
    props.onChange({ values, others: { ...others, [id]: text } });

  return (
    <>
      {props.questions.map((q) => {
        const id = `answer-${q.id}`;
        const error = props.errors[q.id];
        const describedBy = [q.description ? `${id}-help` : "", error ? `${id}-error` : ""]
          .filter(Boolean)
          .join(" ");
        const aria = {
          "aria-invalid": error ? true : undefined,
          "aria-describedby": describedBy || undefined,
        };
        const title = (
          <>
            {q.label}
            {q.required ? <span aria-label={props.labels.required}> *</span> : null}
          </>
        );
        const help = q.description ? (
          <span id={`${id}-help`} className="site-muted">
            {q.description}
          </span>
        ) : null;
        const message = error ? (
          <span id={`${id}-error`} role="alert" className="ui-message">
            {error}
          </span>
        ) : null;

        if (q.type === "single_choice" || q.type === "multi_choice") {
          const multi = q.type === "multi_choice";
          const picked = values[q.id];
          const list: readonly string[] = Array.isArray(picked)
            ? picked
            : typeof picked === "string"
              ? [picked]
              : [];
          const toggle = (option: string, on: boolean) =>
            set(q.id, multi ? (on ? [...list, option] : list.filter((v) => v !== option)) : option);
          const options = [...q.options, ...(q.allowOther ? [OTHER] : [])];
          return (
            <fieldset key={q.id} className="ui-field site-choices" {...aria}>
              <legend>{title}</legend>
              {help}
              {options.map((option) => (
                <label key={option} className="site-choice">
                  <input
                    type={multi ? "checkbox" : "radio"}
                    name={id}
                    required={!multi && q.required}
                    checked={list.includes(option)}
                    onChange={(e) => toggle(option, e.target.checked)}
                  />
                  {option === OTHER ? props.labels.other : option}
                </label>
              ))}
              {list.includes(OTHER) ? (
                <input
                  className="ui-input"
                  aria-label={props.labels.other}
                  placeholder={props.labels.otherPlaceholder}
                  maxLength={TEXT_LIMITS.other}
                  required
                  value={others[q.id] ?? ""}
                  onChange={(e) => setOther(q.id, e.target.value)}
                />
              ) : null}
              {message}
            </fieldset>
          );
        }

        if (q.type === "consent") {
          return (
            <div key={q.id} className="ui-field">
              <label className="site-choice">
                <input
                  id={id}
                  type="checkbox"
                  required={q.required}
                  checked={values[q.id] === true}
                  onChange={(e) => set(q.id, e.target.checked)}
                  {...aria}
                />
                {title}
              </label>
              {help}
              {message}
            </div>
          );
        }

        if (q.type === "file") {
          const onFile = props.onFile;
          if (!onFile) {
            return (
              <p key={q.id} className="site-muted">
                {q.label}: {props.labels.fileOnlyInApplication}
              </p>
            );
          }
          const name = props.fileNames?.[q.id];
          return (
            <div key={q.id} className="ui-field">
              <label htmlFor={id}>{title}</label>
              {help}
              {name ? <span className="site-muted">{name}</span> : null}
              <input
                id={id}
                className="ui-input"
                type="file"
                accept="application/pdf"
                disabled={props.disabled}
                {...aria}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onFile(q.id, file);
                  e.target.value = "";
                }}
              />
              {message}
            </div>
          );
        }

        const text = typeof values[q.id] === "string" ? (values[q.id] as string) : "";
        const common = {
          id,
          className: "ui-input",
          required: q.required,
          value: text,
          ...aria,
        };
        return (
          <div key={q.id} className="ui-field">
            <label htmlFor={id}>{title}</label>
            {help}
            {q.type === "long_text" ? (
              <textarea
                {...common}
                rows={5}
                maxLength={TEXT_LIMITS.long_text}
                onChange={(e) => set(q.id, e.target.value)}
              />
            ) : (
              <input
                {...common}
                type={
                  q.type === "email"
                    ? "email"
                    : q.type === "number"
                      ? "number"
                      : q.type === "date"
                        ? "date"
                        : "text"
                }
                maxLength={q.type === "short_text" ? TEXT_LIMITS.short_text : undefined}
                min={q.type === "number" ? (q.min ?? undefined) : undefined}
                max={q.type === "number" ? (q.max ?? undefined) : undefined}
                step={q.type === "number" ? "any" : undefined}
                onChange={(e) => set(q.id, e.target.value)}
              />
            )}
            {message}
          </div>
        );
      })}
    </>
  );
}
