"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useState, type FormEvent, type ReactNode } from "react";
import { ActionError } from "@/components/action-error";
import { actionMessage, type ActionFailure } from "@/components/action-message";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { minorDigits } from "@website/domain/programs";

const FieldMessages = createContext<Readonly<Record<string, string>>>({});

export type ActionResult = { ok: true } | ActionFailure;

export function FormModal({
  open,
  title,
  submitLabel = "Save",
  onClose,
  onSubmit,
  children,
}: {
  open: boolean;
  title: string;
  submitLabel?: string;
  onClose: () => void;
  onSubmit: (form: FormData) => Promise<ActionResult>;
  children: ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Readonly<Record<string, string>>>({});
  const close = () => {
    setError(null);
    setFields({});
    onClose();
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    const result = await onSubmit(new FormData(event.currentTarget));
    setBusy(false);
    if (!result.ok) {
      setFields(result.fields ?? {});
      return setError(actionMessage(result));
    }
    close();
    router.refresh();
  };
  return (
    <Modal open={open} title={title} onClose={close}>
      <form onSubmit={(e) => void submit(e)}>
        <FieldMessages.Provider value={fields}>{children}</FieldMessages.Provider>
        <ActionError text={error} />
        <div className="admin-modal__footer-row">
          <Button variant="outline" icon="chevronLeft" onClick={close}>
            Back
          </Button>
          <Button type="submit" loading={busy}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function Field({
  label,
  name,
  rows,
  hint,
  ...input
}: {
  label: string;
  name: string;
  rows?: number;
  hint?: string;
  type?: string;
  required?: boolean;
  defaultValue?: string | number;
  min?: number;
  max?: number;
  step?: number | "any";
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  inputMode?: "numeric" | "decimal" | "email" | "url" | "tel";
  autoComplete?: string;
}) {
  const message = useContext(FieldMessages)[name];
  const id = `field-${name}`;
  return (
    <div className="admin-field">
      <label className="admin-field__label" htmlFor={id}>
        {label}
        {input.required ? " *" : ""}
      </label>
      {rows ? (
        <textarea id={id} name={name} rows={rows} className="admin-textarea" {...input} />
      ) : (
        <input id={id} name={name} className="admin-input" {...input} />
      )}
      <FieldError id={`${id}-error`} message={message} hint={hint} />
    </div>
  );
}

export function ChoiceField({
  label,
  name,
  defaultValue,
  options,
}: {
  label: string;
  name: string;
  defaultValue: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  const id = `field-${name}`;
  return (
    <div className="admin-field">
      <label className="admin-field__label" htmlFor={id}>
        {label}
      </label>
      <Select id={id} name={name} className="admin-select" defaultValue={defaultValue}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function PeriodSwitch({
  path,
  current,
  periods,
}: {
  path: string;
  current: string;
  periods: ReadonlyArray<{ id: string; name: string }>;
}) {
  const router = useRouter();
  return (
    <Select
      aria-label="Period"
      className="admin-select"
      value={current}
      onChange={(e) => router.push(`${path}?period=${e.target.value}`)}
    >
      {periods.map((p) => (
        <option key={p.id} value={p.id}>
          Period {p.name}
        </option>
      ))}
    </Select>
  );
}

export const text = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};
export const num = (form: FormData, name: string): number => {
  const value = text(form, name);
  return value === "" ? Number.NaN : Number(value);
};

export function parseBudgets(value: string): Array<{ amountMinor: number; currency: string }> {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [code = "", amount = ""] = line.split(/\s+/);
      const currency = code.toUpperCase();
      const digits = /^[A-Z]{3}$/.test(currency) ? minorDigits(currency) : 0;
      return { currency, amountMinor: Math.round(Number(amount.replace(/,/g, "")) * 10 ** digits) };
    });
}

export const budgetText = (budgets: ReadonlyArray<{ amountMinor: number; currency: string }>) =>
  budgets.map((b) => `${b.currency} ${b.amountMinor / 10 ** minorDigits(b.currency)}`).join("\n");
