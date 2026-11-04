import { describe, expect, it } from "vitest";
import { cashReport, type CashEntry, type FinanceRequest } from "@website/domain/finance";
import {
  amountText,
  inTab,
  toCashSections,
  toFinanceItem,
} from "../../apps/admin/src/components/finance-model";

const at = new Date("2026-11-04T03:00:00Z");

describe("Finance page model", () => {
  it("groups statuses into tabs", () => {
    expect(inTab("all", "rejected")).toBe(true);
    expect(inTab("draft", "revision")).toBe(true);
    expect(inTab("desks", "reviewed")).toBe(true);
    expect(inTab("desks", "authorized")).toBe(false);
    expect(inTab("closed", "done")).toBe(true);
  });

  it("shows amounts in the form in major units of the currency", () => {
    expect(amountText(150_000_050, "IDR")).toBe("1500000.50");
    expect(amountText(5000, "JPY")).toBe("5000");
  });

  it("maps a request with names, labels, desks and the payment", () => {
    const request = {
      id: "f1",
      version: 6,
      category: "reimbursement",
      orgUnitId: "media",
      title: "Konsumsi rapat",
      description: "",
      amountMinor: 1_200_00,
      currency: "AUD",
      date: null,
      account: "CBA 1",
      fundSource: "",
      programId: null,
      status: "paid",
      createdBy: "ari",
      documents: [{ path: "finance/p1/f1_doc.pdf", name: "nota.pdf", size: 1, sha256: "x" }],
      treasurer: { uid: "tina", at, note: "OK" },
      coordinator: { uid: "kord", at, note: null },
      revisionNote: null,
      rejection: null,
      payment: {
        uid: "tina",
        at,
        amountMinor: 1_100_00,
        proof: { path: "finance/p1/f1_proof.pdf", name: "tf.pdf", size: 1, sha256: "y" },
      },
    } as unknown as FinanceRequest;
    const names = new Map([["tina", "Tina"]]);
    expect(toFinanceItem(request, names, "Media", "tina")).toMatchObject({
      categoryLabel: "Reimbursement",
      statusLabel: "Paid",
      amount: "AUD 1,200.00",
      requester: "ari",
      mine: false,
      treasurer: "Tina — OK",
      coordinator: "kord",
      documents: [{ path: "finance/p1/f1_doc.pdf", name: "nota.pdf" }],
      rejectionNote: null,
      paid: { amount: "AUD 1,100.00", by: "Tina", proofName: "tf.pdf" },
    });
    expect(
      toFinanceItem(
        { ...request, treasurer: null, payment: null, rejection: { uid: "k", at, note: "No" } },
        names,
        "",
        "ari",
      ),
    ).toMatchObject({ mine: true, treasurer: null, paid: null, rejectionNote: "No" });
  });

  it("formats the cash report per currency for the cash book page", () => {
    const line = (fields: Partial<CashEntry>) =>
      ({
        id: "c1",
        date: "2026-11-01",
        kind: "in",
        category: "dues",
        description: "Iuran",
        amountMinor: 5000,
        currency: "JPY",
        source: "manual",
        createdAt: at,
        ...fields,
      }) as CashEntry;
    const sections = toCashSections(
      cashReport(
        [line({}), line({ id: "c2", kind: "out", category: "activity", source: "request" })],
        {
          from: null,
          to: null,
        },
      ),
    );
    expect(sections).toEqual([
      {
        currency: "JPY",
        opening: "JPY 0",
        totalIn: "JPY 5,000",
        totalOut: "JPY 5,000",
        closing: "JPY 0",
        rows: [
          {
            id: "c1",
            date: "2026-11-01",
            category: "Member dues",
            description: "Iuran",
            amountIn: "JPY 5,000",
            amountOut: "",
            balance: "JPY 5,000",
            fromRequest: false,
          },
          {
            id: "c2",
            date: "2026-11-01",
            category: "Activity / programme",
            description: "Iuran",
            amountIn: "",
            amountOut: "JPY 5,000",
            balance: "JPY 0",
            fromRequest: true,
          },
        ],
      },
    ]);
  });
});
