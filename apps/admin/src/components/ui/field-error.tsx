"use client";

import { useEffect, useRef, useState } from "react";
import { fieldRequirements, type FieldState, type Requirement } from "@/components/fields-model";
import { Icon } from "./icon";

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const CONTROL =
  "input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]), select, textarea";

const stateOf = (control: Control): FieldState => ({
  value: control.value,
  type: control.type,
  required: control.required,
  minLength: "minLength" in control ? Math.max(control.minLength, 0) : 0,
  min: control instanceof HTMLInputElement ? control.min : "",
  max: control instanceof HTMLInputElement ? control.max : "",
  hasPattern: control instanceof HTMLInputElement && control.pattern !== "",
  patternHint: control.title || null,
  badInput: control.validity.badInput,
  typeMismatch: control.validity.typeMismatch,
  patternMismatch: control.validity.patternMismatch,
  rangeUnderflow: control.validity.rangeUnderflow,
  rangeOverflow: control.validity.rangeOverflow,
});

const same = (a: Requirement[], b: Requirement[]) => JSON.stringify(a) === JSON.stringify(b);

export function FieldError({
  id,
  message,
  hint,
}: {
  id: string;
  message?: string | null | undefined;
  hint?: string | undefined;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const control = useRef<Control | null>(null);
  const [touched, setTouched] = useState(false);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [edited, setEdited] = useState(false);
  const [shownMessage, setShownMessage] = useState(message);
  if (message !== shownMessage) {
    setShownMessage(message);
    setEdited(false);
  }

  useEffect(() => {
    const field = ref.current?.closest<HTMLElement>(".admin-field");
    const input = field?.querySelector<Control>(CONTROL) ?? null;
    control.current = input;
    if (!field || !input) return;
    const read = () => {
      const next = fieldRequirements(stateOf(input));
      setRequirements((current) => (same(current, next) ? current : next));
    };
    const onEdit = () => {
      setEdited(true);
      read();
    };
    const onLeave = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && field.contains(event.relatedTarget)) return;
      setTouched(true);
      read();
    };
    const onInvalid = (event: Event) => {
      event.preventDefault();
      setTouched(true);
      read();
    };
    field.addEventListener("focusout", onLeave);
    field.addEventListener("input", onEdit);
    field.addEventListener("change", onEdit);
    input.addEventListener("invalid", onInvalid);
    return () => {
      field.removeEventListener("focusout", onLeave);
      field.removeEventListener("input", onEdit);
      field.removeEventListener("change", onEdit);
      input.removeEventListener("invalid", onInvalid);
    };
  }, []);

  const items: Requirement[] = [
    ...(message && !edited ? [{ text: message, met: false }] : []),
    ...(touched ? requirements : []),
  ];
  const invalid = items.some((item) => !item.met);

  useEffect(() => {
    const input = control.current;
    if (!input || items.length === 0) return;
    if (invalid) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
    const described = (input.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
    if (!described.includes(id))
      input.setAttribute("aria-describedby", [...described, id].join(" "));
  });

  const line = (item: Requirement) => (
    <>
      <Icon name={item.met ? "check" : "warning"} size={14} className="admin-field__icon" />
      <span>{item.text}</span>
    </>
  );

  return (
    <div id={id} ref={ref} className="admin-field__feedback" aria-live="polite">
      {items.length === 1 && items[0] ? (
        <p className={`admin-field__msg admin-field__msg--${items[0].met ? "ok" : "error"}`}>
          {line(items[0])}
        </p>
      ) : items.length > 1 ? (
        <ul className="admin-field__reqs">
          {items.map((item) => (
            <li
              key={item.text}
              className={`admin-field__msg admin-field__msg--${item.met ? "ok" : "error"}`}
            >
              {line(item)}
            </li>
          ))}
        </ul>
      ) : hint ? (
        <p className="admin-field__hint">{hint}</p>
      ) : null}
    </div>
  );
}
