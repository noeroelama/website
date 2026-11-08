import type {
  Form,
  FormStatus,
  FormUsage,
  FormVersion,
  Question,
  QuestionType,
} from "@website/domain/forms";
import { FORM_STATUS_LABELS, FORM_USAGE_LABELS, label } from "../labels";
import type { Author } from "./authors";

export type FormTab = "all" | "published" | "drafts" | "closed";

export interface FormItem {
  id: string;
  version: number;
  title: string;
  description: string;
  usage: FormUsage;
  usageLabel: string;
  status: FormStatus;
  statusLabel: string;
  opensAt: string | null;
  closesAt: string | null;
  publicToken: string | null;
  responseCount: number;
  currentVersion: number;
  answered: boolean;
  questions: Question[];
  modifiedAt: string;
  author: Author | null;
}

export function toFormItem(
  form: Form,
  current: FormVersion | undefined,
  author: Author | null,
): FormItem {
  return {
    id: form.id,
    version: form.version,
    title: form.title,
    description: form.description,
    usage: form.usage,
    usageLabel: label(FORM_USAGE_LABELS, form.usage),
    status: form.status,
    statusLabel: label(FORM_STATUS_LABELS, form.status),
    opensAt: form.opensAt?.toISOString() ?? null,
    closesAt: form.closesAt?.toISOString() ?? null,
    publicToken: form.publicToken,
    responseCount: form.responseCount,
    currentVersion: form.currentVersion,
    answered: current?.answered ?? false,
    questions: current ? [...current.questions] : [],
    modifiedAt: form.updatedAt.toISOString(),
    author,
  };
}

export function matchesFormTab(item: Pick<FormItem, "status">, tab: FormTab): boolean {
  if (tab === "all") return true;
  if (tab === "drafts") return item.status === "draft";
  return item.status === tab;
}

export interface QuestionDraft {
  id: string;
  type: QuestionType;
  label: string;
  description: string;
  required: boolean;
  options: string;
  allowOther: boolean;
  maxSelections: string;
  min: string;
  max: string;
}

export const blankQuestion = (): QuestionDraft => ({
  id: "",
  type: "short_text",
  label: "",
  description: "",
  required: false,
  options: "",
  allowOther: false,
  maxSelections: "",
  min: "",
  max: "",
});

const numberText = (value: number | null) => (value === null ? "" : String(value));

export function toDraft(q: Question): QuestionDraft {
  return {
    id: q.id,
    type: q.type,
    label: q.label,
    description: q.description,
    required: q.required,
    options: q.options.join("\n"),
    allowOther: q.allowOther,
    maxSelections: numberText(q.maxSelections),
    min: numberText(q.min),
    max: numberText(q.max),
  };
}

const toNumber = (text: string) => (text.trim() === "" ? null : Number(text));

export function fromDraft(d: QuestionDraft) {
  return {
    id: d.id,
    type: d.type,
    label: d.label,
    description: d.description,
    required: d.required,
    options: d.options
      .split("\n")
      .map((o) => o.trim())
      .filter(Boolean),
    allowOther: d.allowOther,
    maxSelections: toNumber(d.maxSelections),
    min: toNumber(d.min),
    max: toNumber(d.max),
  };
}

export const hasOptions = (type: QuestionType) =>
  type === "single_choice" || type === "multi_choice";
