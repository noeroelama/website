"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CASH_CATEGORIES,
  CASH_CATEGORY_LABELS,
  FINANCE_CURRENCIES,
  type CashCategory,
  type CashKind,
} from "@website/domain/finance";
import { toMinor } from "@website/domain/shared";
import { addCashEntryAction } from "@/app/(panel)/finance/actions";
import { actionMessage } from "@/components/action-message";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import type { CashSection } from "./finance-model";

interface Props {
  periodName: string | null;
  range: { from: string | null; to: string | null };
  rangeError: string | null;
  sections: CashSection[];
  canWrite: boolean;
  canExport: boolean;
}

interface Draft {
  date: string;
  kind: CashKind;
  category: CashCategory;
  description: string;
  amount: string;
  currency: string;
}

const today = () => new Date().toISOString().slice(0, 10);

export function CashbookPage({
  periodName,
  range,
  rangeError,
  sections,
  canWrite,
  canExport,
}: Props) {
  const toast = useToastMessage();
  const router = useRouter();
  const [from, setFrom] = useState(range.from ?? "");
  const [to, setTo] = useState(range.to ?? "");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);

  const query = new URLSearchParams(
    Object.entries({ from: range.from, to: range.to }).filter(
      (pair): pair is [string, string] => pair[1] !== null,
    ),
  ).toString();

  const save = async () => {
    if (!draft) return;
    const amountMinor = toMinor(draft.amount, draft.currency);
    if (!amountMinor) {
      setFieldErrors({ amountMinor: "Type an amount more than zero, e.g. 1500000.00." });
      return;
    }
    setBusy(true);
    const result = await addCashEntryAction({
      date: draft.date,
      kind: draft.kind,
      category: draft.category,
      description: draft.description,
      amountMinor,
      currency: draft.currency,
    });
    setBusy(false);
    if (!result.ok) {
      setFieldErrors(result.fields ?? {});
      return toast.show(actionMessage(result));
    }
    setDraft(null);
    toast.show("Entry added");
    router.refresh();
  };

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Finance &gt; Cash book</h1>
          <p className="admin-page-header__desc">
            {periodName
              ? `Cash book of the ${periodName} board. Paid requests add their line themselves.`
              : "Activate a board period first (Organizations → Periods)."}
          </p>
        </div>
        <div className="admin-page-header__actions">
          {canWrite ? (
            <Button
              variant="outline"
              size="sm"
              icon="plus"
              disabled={!periodName}
              onClick={() => {
                setFieldErrors({});
                setDraft({
                  date: today(),
                  kind: "in",
                  category: "opening_balance",
                  description: "",
                  amount: "",
                  currency: "IDR",
                });
              }}
            >
              Manual entry
            </Button>
          ) : null}
        </div>
      </div>
      <div className="admin-dark-form">
        <div className="admin-form-grid">
          <label className="admin-field">
            <span className="admin-field__label">From</span>
            <input
              className="admin-input"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="admin-field">
            <span className="admin-field__label">To</span>
            <input
              className="admin-input"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
        {rangeError ? <p className="admin-card__subtitle">{rangeError}</p> : null}
        <div className="admin-form-actions">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const next = new URLSearchParams(
                Object.entries({ from, to }).filter((pair) => pair[1] !== ""),
              );
              router.push(`/finance/cashbook?${next.toString()}`);
            }}
          >
            Show
          </Button>
          {canExport ? (
            <div className="admin-form-actions__right">
              <Button variant="outline" size="sm" href={`/api/finance/report?${query}&format=csv`}>
                Download CSV
              </Button>
              <Button variant="outline" size="sm" href={`/api/finance/report?${query}&format=pdf`}>
                Download PDF
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      {sections.length === 0 ? (
        <p className="admin-card__subtitle">No cash book entries in this range.</p>
      ) : null}
      {sections.map((s) => (
        <div key={s.currency} className="admin-dark-form">
          <h2 className="admin-field__label">
            {s.currency} · opening {s.opening} · in {s.totalIn} · out {s.totalOut} · closing{" "}
            {s.closing}
          </h2>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Description</th>
                  <th>In</th>
                  <th>Out</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {s.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.date}</td>
                    <td>{r.category}</td>
                    <td>
                      {r.description}
                      {r.fromRequest ? " (request)" : ""}
                    </td>
                    <td>{r.amountIn}</td>
                    <td>{r.amountOut}</td>
                    <td>{r.balance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <Modal
        asForm
        open={draft !== null}
        title="Manual cash book entry"
        onClose={() => setDraft(null)}
        footer={
          <div className="admin-modal__footer-row">
            <Button variant="outline" icon="chevronLeft" onClick={() => setDraft(null)}>
              Back
            </Button>
            <Button
              type="submit"
              variant="primary"
              icon="plus"
              disabled={busy}
              onClick={() => save()}
            >
              Add
            </Button>
          </div>
        }
      >
        {draft ? (
          <div className="admin-form-grid">
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="cash-date">
                Date
              </label>
              <input
                id="cash-date"
                className="admin-input"
                type="date"
                value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
              />
              <FieldError id="cash-date-error" message={fieldErrors["date"]} />
            </div>
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="cash-kind">
                Kind
              </label>
              <Select
                id="cash-kind"
                className="admin-select"
                value={draft.kind}
                onChange={(e) => {
                  const kind = e.target.value as CashKind;
                  setDraft({ ...draft, kind, category: CASH_CATEGORIES[kind][0] });
                }}
              >
                <option value="in">Money in</option>
                <option value="out">Money out</option>
              </Select>
            </div>
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="cash-category">
                Category
              </label>
              <Select
                id="cash-category"
                className="admin-select"
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value as CashCategory })}
              >
                {CASH_CATEGORIES[draft.kind].map((c) => (
                  <option key={c} value={c}>
                    {CASH_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="admin-field admin-form-grid__full">
              <label className="admin-field__label" htmlFor="cash-description">
                Description
              </label>
              <input
                id="cash-description"
                className="admin-input"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
              <FieldError id="cash-description-error" message={fieldErrors["description"]} />
            </div>
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="cash-amount">
                Amount
              </label>
              <input
                id="cash-amount"
                className="admin-input"
                inputMode="decimal"
                value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
              />
              <FieldError id="cash-amount-error" message={fieldErrors["amountMinor"]} />
            </div>
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="cash-currency">
                Currency
              </label>
              <Select
                id="cash-currency"
                className="admin-select"
                value={draft.currency}
                onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
              >
                {FINANCE_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        ) : null}
      </Modal>
      <ToastBanner message={toast.message} />
    </div>
  );
}
