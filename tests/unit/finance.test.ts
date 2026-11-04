import { describe, expect, it } from "vitest";
import {
  attachDocument,
  authorizeRequest,
  completeRequest,
  FinanceRequestInputSchema,
  isEditable,
  markPaid,
  MAX_FINANCE_DOCUMENTS,
  missingFields,
  rejectRequest,
  removeDocument,
  returnRequest,
  reviewRequest,
  submitRequest,
  type FinanceFile,
  type FinanceRequest,
} from "@website/domain/finance";
import { formatMoney, minorDigits, money, toMinor } from "@website/domain/shared";
import { money as shopMoney } from "@website/domain/shop";

const now = new Date("2026-11-04T03:00:00Z");
const file = (name = "rab.pdf"): FinanceFile => ({
  path: `finance/p1/r1_${name}`,
  name,
  size: 10,
  sha256: "a".repeat(64),
});

const base: FinanceRequest = {
  id: "r1",
  version: 1,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  category: "disbursement",
  orgUnitId: "media",
  title: "Webinar AI",
  description: "",
  amountMinor: 150_000_000,
  currency: "IDR",
  date: "2026-11-20",
  account: "BNI 123 a.n. PPIDK",
  fundSource: "Kas pusat",
  programId: null,
  periodId: "p1",
  orgUnitPath: ["dirs", "media"],
  status: "draft",
  createdBy: "ari",
  documents: [],
  submittedAt: null,
  treasurer: null,
  coordinator: null,
  revisionNote: null,
  revisionRound: 0,
  rejection: null,
  payment: null,
  doneAt: null,
};

const submitted = submitRequest(base, now);
const reviewed = reviewRequest(submitted, "bendahara", "Angka sesuai", now);
const authorized = authorizeRequest(reviewed, "koor", "", now);

describe("money (DEC-8: shared kernel, shop API unchanged)", () => {
  it("is the same helper in shop and shared", () => {
    expect(shopMoney).toBe(money);
    expect(() => money(1, "usd")).toThrow("ISO 4217");
  });

  it("knows each currency's minor digits and formats with the code", () => {
    expect(minorDigits("JPY")).toBe(0);
    expect(minorDigits("IDR")).toBe(2);
    expect(formatMoney(money(150_000_000, "IDR"))).toBe("IDR 1,500,000.00");
    expect(formatMoney(money(5000, "JPY"))).toBe("JPY 5,000");
  });

  it("reads typed amounts into minor units", () => {
    expect(toMinor("1,500,000.5", "IDR")).toBe(150_000_050);
    expect(toMinor(" 12 ", "AUD")).toBe(1200);
    expect(toMinor("5000", "JPY")).toBe(5000);
    expect(toMinor("50.5", "JPY")).toBeNull();
    expect(toMinor("1.234", "IDR")).toBeNull();
    expect(toMinor("-1", "IDR")).toBeNull();
    expect(toMinor("abc", "IDR")).toBeNull();
    expect(toMinor("999999999999999", "IDR")).toBeNull();
  });
});

describe("finance request input (I1)", () => {
  it("is strict, trims text and only takes known categories and currencies", () => {
    const parsed = FinanceRequestInputSchema.parse({
      category: "budget",
      orgUnitId: "media",
      title: "  RAB Kongres ",
      amountMinor: 0,
      currency: "JPY",
    });
    expect(parsed).toMatchObject({
      title: "RAB Kongres",
      description: "",
      date: null,
      account: "",
      fundSource: "",
      programId: null,
    });
    const bad = (patch: Record<string, unknown>) =>
      FinanceRequestInputSchema.safeParse({ ...parsed, ...patch }).success;
    expect(bad({ category: "gift" })).toBe(false);
    expect(bad({ currency: "XXX" })).toBe(false);
    expect(bad({ amountMinor: -1 })).toBe(false);
    expect(bad({ amountMinor: 1.5 })).toBe(false);
    expect(bad({ extra: 1 })).toBe(false);
    expect(bad({ programId: "prog-1" })).toBe(true);
  });
});

describe("required documents and fields per category (PPIDK KeuanganService::WAJIB)", () => {
  it("lists what is missing for each category", () => {
    const empty = {
      ...base,
      title: " ",
      amountMinor: 0,
      date: null,
      account: "",
      fundSource: "",
    };
    expect(missingFields({ ...empty, category: "receipt" })).toEqual([
      "Title",
      "Amount",
      "Date",
      "Destination account",
      "Fund source",
      "Documents (proposal, budget plan or receipts)",
    ]);
    expect(missingFields({ ...empty, category: "disbursement" })).toEqual([
      "Title",
      "Amount",
      "Date",
      "Destination account",
      "Fund source",
    ]);
    expect(missingFields({ ...empty, category: "reimbursement" })).toEqual([
      "Title",
      "Amount",
      "Destination account",
      "Documents (proposal, budget plan or receipts)",
    ]);
    expect(missingFields({ ...empty, category: "budget" })).toEqual([
      "Title",
      "Amount",
      "Date",
      "Documents (proposal, budget plan or receipts)",
    ]);
    expect(missingFields({ ...base, category: "budget", documents: [file()] })).toEqual([]);
  });

  it("refuses to submit an incomplete request", () => {
    expect(() => submitRequest({ ...base, category: "reimbursement" }, now)).toThrow(
      "Complete first: Documents (proposal, budget plan or receipts).",
    );
  });
});

describe("status machine: draft → submitted → reviewed → authorized → paid → done", () => {
  it("walks the happy path with both desks recorded", () => {
    expect(submitted).toMatchObject({ status: "submitted", submittedAt: now, revisionNote: null });
    expect(reviewed).toMatchObject({
      status: "reviewed",
      treasurer: { uid: "bendahara", at: now, note: "Angka sesuai" },
    });
    expect(authorized).toMatchObject({
      status: "authorized",
      coordinator: { uid: "koor", at: now, note: null },
    });
    const paid = markPaid(authorized, "bendahara", 149_000_000, file("transfer.pdf"), now);
    expect(paid).toMatchObject({
      status: "paid",
      payment: { uid: "bendahara", at: now, amountMinor: 149_000_000 },
    });
    expect(completeRequest(paid, now)).toMatchObject({ status: "done", doneAt: now });
  });

  it("refuses every step out of order", () => {
    expect(() => submitRequest(submitted, now)).toThrow("Only drafts");
    expect(() => reviewRequest(base, "bendahara", "", now)).toThrow("not submitted");
    expect(() => authorizeRequest(submitted, "koor", "", now)).toThrow("treasurer");
    expect(() => markPaid(reviewed, "bendahara", 1, file(), now)).toThrow("authorised");
    expect(() => completeRequest(authorized, now)).toThrow("paid");
    expect(() => returnRequest(authorized, "coordinator", "koor", "x")).toThrow("desk");
    expect(() => rejectRequest(base, "treasurer", "bendahara", "x", now)).toThrow("desk");
  });

  it("pays a positive amount with proof", () => {
    expect(() => markPaid(authorized, "bendahara", 0, file(), now)).toThrow("more than zero");
  });

  it("is editable only as a draft or in revision", () => {
    expect(isEditable(base)).toBe(true);
    expect(isEditable({ ...base, status: "revision" })).toBe(true);
    expect(isEditable(submitted)).toBe(false);
  });
});

describe("return (clears both desks) and reject (final)", () => {
  it("lets the treasurer return a submitted request and the coordinator a reviewed one", () => {
    const back = returnRequest(reviewed, "coordinator", "koor", "  Lampirkan RAB  ");
    expect(back).toMatchObject({
      status: "revision",
      revisionNote: "Lampirkan RAB",
      revisionRound: 1,
      treasurer: null,
      coordinator: null,
    });
    expect(returnRequest(submitted, "treasurer", "bendahara", "x").status).toBe("revision");
    expect(() => returnRequest(submitted, "coordinator", "koor", "x")).toThrow("desk");
    expect(() => returnRequest(reviewed, "treasurer", "bendahara", "x")).toThrow("desk");
    expect(() => returnRequest(submitted, "treasurer", "bendahara", " ")).toThrow("fixed");
    const again = submitRequest(back, now);
    expect(again).toMatchObject({ status: "submitted", revisionNote: null, revisionRound: 1 });
  });

  it("rejects with a reason, and a rejected request is final", () => {
    const rejected = rejectRequest(reviewed, "coordinator", "koor", "Di luar program", now);
    expect(rejected).toMatchObject({
      status: "rejected",
      rejection: { uid: "koor", at: now, note: "Di luar program" },
    });
    expect(rejectRequest(submitted, "treasurer", "bendahara", "x", now).status).toBe("rejected");
    expect(() => rejectRequest(submitted, "treasurer", "bendahara", "", now)).toThrow("reason");
    expect(() => submitRequest(rejected, now)).toThrow();
    expect(() => returnRequest(rejected, "coordinator", "koor", "x")).toThrow();
    expect(isEditable(rejected)).toBe(false);
  });
});

describe("separation of duties", () => {
  it("never lets the requester act at a desk on their own request", () => {
    const own = "ari";
    expect(() => reviewRequest(submitted, own, "", now)).toThrow("own request");
    expect(() => authorizeRequest(reviewed, own, "", now)).toThrow("own request");
    expect(() => returnRequest(submitted, "treasurer", own, "x")).toThrow("own request");
    expect(() => rejectRequest(reviewed, "coordinator", own, "x", now)).toThrow("own request");
    expect(() => markPaid(authorized, own, 1, file(), now)).toThrow("own request");
  });

  it("needs a different person for the coordinator's authorisation than the treasurer's review", () => {
    expect(() => authorizeRequest(reviewed, "bendahara", "", now)).toThrow("different person");
  });
});

describe("documents (private PDFs)", () => {
  it("attaches and removes while editable, at most 10", () => {
    const one = attachDocument(base, file());
    expect(one.documents).toEqual([file()]);
    expect(removeDocument(one, file().path).documents).toEqual([]);
    expect(() => removeDocument(one, "finance/other.pdf")).toThrow("No such document");
    expect(() => attachDocument(submitted, file())).toThrow("draft");
    expect(() => removeDocument(submitted, file().path)).toThrow("draft");
    const full = {
      ...base,
      documents: Array.from({ length: MAX_FINANCE_DOCUMENTS }, () => file()),
    };
    expect(() => attachDocument(full, file())).toThrow("at most 10");
  });
});
