import { describe, expect, it } from "vitest";
import {
  type FieldState,
  fieldRequirements,
  filterOptions,
  needsSearch,
  optionsFrom,
} from "../../apps/admin/src/components/fields-model";

const field = (state: Partial<FieldState>): FieldState => ({
  value: "",
  type: "text",
  required: false,
  minLength: 0,
  min: "",
  max: "",
  patternHint: null,
  hasPattern: false,
  badInput: false,
  typeMismatch: false,
  patternMismatch: false,
  rangeUnderflow: false,
  rangeOverflow: false,
  ...state,
});

describe("form field requirements (shown under a field after it is left)", () => {
  it("a required field is unmet while empty or blank, met once filled", () => {
    expect(fieldRequirements(field({ required: true }))).toEqual([
      { text: "Required", met: false },
    ]);
    expect(fieldRequirements(field({ required: true, value: "   " }))).toEqual([
      { text: "Required", met: false },
    ]);
    expect(fieldRequirements(field({ required: true, value: "Simposium" }))).toEqual([
      { text: "Required", met: true },
    ]);
  });

  it("an optional field has nothing to check while it is empty", () => {
    expect(fieldRequirements(field({ type: "email" }))).toEqual([]);
    expect(fieldRequirements(field({ value: "anything" }))).toEqual([]);
  });

  it("lists every requirement of the field, each met or unmet", () => {
    expect(
      fieldRequirements(field({ required: true, type: "email", value: "x", typeMismatch: true })),
    ).toEqual([
      { text: "Required", met: true },
      { text: "A valid e-mail address, e.g. name@example.org", met: false },
    ]);
    expect(fieldRequirements(field({ type: "url", value: "https://ppiasiania.id" }))).toEqual([
      { text: "A full link starting with https://", met: true },
    ]);
  });

  it("checks numbers, ranges and minimum length", () => {
    expect(fieldRequirements(field({ type: "number", badInput: true }))).toEqual([
      { text: "A number", met: false },
    ]);
    expect(
      fieldRequirements(
        field({ type: "number", value: "120", min: "-90", max: "90", rangeOverflow: true }),
      ),
    ).toEqual([
      { text: "A number", met: true },
      { text: "Between -90 and 90", met: false },
    ]);
    expect(fieldRequirements(field({ type: "number", value: "1", min: "0" }))).toEqual([
      { text: "A number", met: true },
      { text: "At least 0", met: true },
    ]);
    expect(fieldRequirements(field({ value: "ab", max: "", minLength: 3 }))).toEqual([
      { text: "At least 3 characters", met: false },
    ]);
    expect(
      fieldRequirements(
        field({ type: "datetime-local", value: "2026-01-01T09:00", min: "2026-02-01T00:00" }),
      ),
    ).toEqual([{ text: "Not before 2026-02-01 00:00", met: true }]);
  });

  it("describes a pattern with the field's title, or a generic text", () => {
    expect(
      fieldRequirements(
        field({
          value: "J",
          hasPattern: true,
          patternHint: "2 letters, e.g. JP",
          patternMismatch: true,
        }),
      ),
    ).toEqual([{ text: "2 letters, e.g. JP", met: false }]);
    expect(fieldRequirements(field({ value: "JP", hasPattern: true }))).toEqual([
      { text: "Matches the required format", met: true },
    ]);
  });
});

describe("dropdown options and search (more than 5 options get a search box)", () => {
  const options = [
    { value: "jp", label: "PPI Jepang", disabled: false },
    { value: "kr", label: "PPI Korea Selatan", disabled: false },
    { value: "tr", label: "PPI Türkiye", disabled: false },
  ];

  it("reads value and label from <option> children, including mapped lists and fragments", () => {
    const option = (props: Record<string, unknown>, ...text: unknown[]) => ({
      type: "option",
      props: { ...props, children: text.length === 1 ? text[0] : text },
    });
    const fragment = (...children: unknown[]) => ({
      type: Symbol("fragment"),
      props: { children },
    });
    const children = [
      option({ value: "" }, "All roles"),
      [1, 2].map((n) => option({ value: `r${n}` }, "Role ", n)),
      fragment(option({ value: "x", disabled: true }, "Archived")),
      option({}, "Plain"),
      null,
      false,
      "stray text",
    ];
    expect(optionsFrom(children)).toEqual([
      { value: "", label: "All roles", disabled: false },
      { value: "r1", label: "Role 1", disabled: false },
      { value: "r2", label: "Role 2", disabled: false },
      { value: "x", label: "Archived", disabled: true },
      { value: "Plain", label: "Plain", disabled: false },
    ]);
  });

  it("a search box only appears when there are more than 5 options", () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ value: `${i}`, label: `${i}`, disabled: false }));
    expect(needsSearch(many(5))).toBe(false);
    expect(needsSearch(many(6))).toBe(true);
  });

  it("filters by label, ignoring case, accents and surrounding spaces", () => {
    expect(filterOptions(options, "  korea ")).toEqual([options[1]]);
    expect(filterOptions(options, "turkiye")).toEqual([options[2]]);
    expect(filterOptions(options, "PPI")).toEqual(options);
    expect(filterOptions(options, "")).toEqual(options);
    expect(filterOptions(options, "zzz")).toEqual([]);
  });
});
