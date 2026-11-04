import { describe, expect, it } from "vitest";
import type { FinanceRequest } from "@website/domain/finance";
import { amountText, inTab, toFinanceItem } from "../../apps/admin/src/components/finance-model";

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
});
