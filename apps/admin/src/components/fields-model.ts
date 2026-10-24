/**
 * Pure rules behind the field feedback (`ui/field-error.tsx`) and the searchable dropdown
 * (`ui/select.tsx`). The requirements come from the control's own HTML attributes (`required`,
 * `type`, `minLength`, `min`/`max`, `pattern` + `title`) and the browser's `validity` flags, so a
 * form declares its rules once, on the input. The server still checks everything on save.
 */

/** What the browser knows about one form control (read from the element). */
export interface FieldState {
  value: string;
  /** Input type (`text`, `email`, `number`, …), or `select-one` / `textarea`. */
  type: string;
  required: boolean;
  /** 0 = no minimum. */
  minLength: number;
  /** "" = no limit. */
  min: string;
  max: string;
  hasPattern: boolean;
  /** The control's `title`: describes its pattern. */
  patternHint: string | null;
  badInput: boolean;
  typeMismatch: boolean;
  patternMismatch: boolean;
  rangeUnderflow: boolean;
  rangeOverflow: boolean;
}

export interface Requirement {
  text: string;
  met: boolean;
}

const DATE_TYPES = new Set(["date", "datetime-local", "time", "month", "week"]);

/** Every requirement of the field, each met or unmet. Empty when there is nothing to check. */
export function fieldRequirements(field: FieldState): Requirement[] {
  const filled = field.value.trim() !== "";
  const list: Requirement[] = field.required ? [{ text: "Required", met: filled }] : [];
  // An empty optional field is fine; a number box with letters in it reads as "" + badInput.
  if (!filled && !field.badInput) return list;

  if (field.type === "email") {
    list.push({ text: "A valid e-mail address, e.g. name@example.org", met: !field.typeMismatch });
  }
  if (field.type === "url") {
    list.push({ text: "A full link starting with https://", met: !field.typeMismatch });
  }
  if (field.type === "number") list.push({ text: "A number", met: !field.badInput });
  if (field.minLength > 0) {
    list.push({
      text: `At least ${field.minLength} characters`,
      met: field.value.length >= field.minLength,
    });
  }
  if (field.min !== "" || field.max !== "") {
    const met = !field.rangeUnderflow && !field.rangeOverflow;
    const show = (v: string) => (DATE_TYPES.has(field.type) ? v.replace("T", " ") : v);
    if (DATE_TYPES.has(field.type)) {
      if (field.min !== "") list.push({ text: `Not before ${show(field.min)}`, met });
      if (field.max !== "") list.push({ text: `Not after ${show(field.max)}`, met });
    } else if (field.min !== "" && field.max !== "") {
      list.push({ text: `Between ${field.min} and ${field.max}`, met });
    } else {
      list.push({
        text: field.min !== "" ? `At least ${field.min}` : `At most ${field.max}`,
        met,
      });
    }
  }
  if (field.hasPattern) {
    list.push({
      text: field.patternHint || "Matches the required format",
      met: !field.patternMismatch,
    });
  }
  return list;
}

export interface OptionItem {
  value: string;
  label: string;
  disabled: boolean;
}

interface ElementLike {
  type: unknown;
  props: { value?: unknown; disabled?: unknown; children?: unknown };
}

const isElement = (node: unknown): node is ElementLike =>
  typeof node === "object" && node !== null && "type" in node && "props" in node;

/** Plain text of an option's children (`"Role "`, `1` → `"Role 1"`). */
const textOf = (node: unknown): string =>
  Array.isArray(node)
    ? node.map(textOf).join("")
    : typeof node === "string" || typeof node === "number"
      ? String(node)
      : "";

/**
 * The `<option>` elements among a `<select>`'s children (React elements), through mapped arrays,
 * fragments and other wrappers. Text, null and booleans are skipped like React does.
 */
export function optionsFrom(children: unknown): OptionItem[] {
  if (Array.isArray(children)) return children.flatMap(optionsFrom);
  if (!isElement(children)) return [];
  if (children.type !== "option") return optionsFrom(children.props.children);
  const label = textOf(children.props.children);
  const { value, disabled } = children.props;
  const text = typeof value === "string" || typeof value === "number" ? String(value) : label;
  return [{ value: text, label, disabled: disabled === true }];
}

/** Dropdowns with more than 5 options get a search box. */
export const needsSearch = (options: readonly OptionItem[]): boolean => options.length > 5;

/** Lower case, without accents and surrounding spaces ("Türkiye" → "turkiye"). */
const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

/** Options whose label contains the search text. */
export function filterOptions(options: readonly OptionItem[], query: string): OptionItem[] {
  const q = fold(query);
  return options.filter((option) => fold(option.label).includes(q));
}
