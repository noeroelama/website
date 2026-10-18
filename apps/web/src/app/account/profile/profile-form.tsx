"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  EDUCATION_LEVELS,
  GENDERS,
  INDONESIA_PROVINCES,
  type MemberProfileInput,
} from "@website/domain/members";
import type { Dictionary } from "@/i18n/dictionaries";
import { saveProfileAction } from "./actions";

/** The stored answers (everything but the consent, which is given again on every save). */
export type ProfileFormValues = Omit<MemberProfileInput, "consent">;

type Text = Dictionary["profile"];
type Flat = Record<string, string>;

/** Flat form state → the profile input. Empty optional text is left out (not sent as ""). */
function toInput(f: Flat): Record<string, unknown> {
  const optional = (value: string | undefined) => (value?.trim() ? value : undefined);
  return {
    fullName: f["fullName"],
    gender: f["gender"],
    dateOfBirth: f["dateOfBirth"],
    ppiCountry: f["ppiCountry"],
    university: f["university"],
    educationLevel: f["educationLevel"],
    majors: [f["major1"], f["major2"], f["major3"]].filter((m) => m?.trim()),
    yearOfEntry: Number(f["yearOfEntry"]),
    estimatedGraduationYear: Number(f["estimatedGraduationYear"]),
    addressAbroad: {
      line1: f["abroad.line1"],
      line2: optional(f["abroad.line2"]),
      city: f["abroad.city"],
      stateOrProvince: optional(f["abroad.stateOrProvince"]),
      postalCode: optional(f["abroad.postalCode"]),
      countryCode: f["abroad.countryCode"],
    },
    addressIndonesia: {
      line1: f["id.line1"],
      line2: optional(f["id.line2"]),
      city: f["id.city"],
      province: f["id.province"],
      postalCode: optional(f["id.postalCode"]),
    },
    whatsappNumber: f["whatsappNumber"],
    emergencyContact: {
      phone: f["emergency.phone"],
      name: optional(f["emergency.name"]),
      relationship: optional(f["emergency.relationship"]),
    },
    timezone: f["timezone"],
  };
}

function fromValues(v: ProfileFormValues | null): Flat {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    fullName: v?.fullName ?? "",
    gender: v?.gender ?? "",
    dateOfBirth: v?.dateOfBirth ?? "",
    ppiCountry: v?.ppiCountry ?? "",
    university: v?.university ?? "",
    educationLevel: v?.educationLevel ?? "",
    major1: v?.majors[0] ?? "",
    major2: v?.majors[1] ?? "",
    major3: v?.majors[2] ?? "",
    yearOfEntry: v ? String(v.yearOfEntry) : "",
    estimatedGraduationYear: v ? String(v.estimatedGraduationYear) : "",
    "abroad.line1": v?.addressAbroad.line1 ?? "",
    "abroad.line2": v?.addressAbroad.line2 ?? "",
    "abroad.city": v?.addressAbroad.city ?? "",
    "abroad.stateOrProvince": v?.addressAbroad.stateOrProvince ?? "",
    "abroad.postalCode": v?.addressAbroad.postalCode ?? "",
    "abroad.countryCode": v?.addressAbroad.countryCode ?? "",
    "id.line1": v?.addressIndonesia.line1 ?? "",
    "id.line2": v?.addressIndonesia.line2 ?? "",
    "id.city": v?.addressIndonesia.city ?? "",
    "id.province": v?.addressIndonesia.province ?? "",
    "id.postalCode": v?.addressIndonesia.postalCode ?? "",
    whatsappNumber: v?.whatsappNumber ?? "",
    "emergency.phone": v?.emergencyContact.phone ?? "",
    "emergency.name": v?.emergencyContact.name ?? "",
    "emergency.relationship": v?.emergencyContact.relationship ?? "",
    timezone: v?.timezone ?? zone,
  };
}

/**
 * The member profile form (B3). The server validates everything again with the same schema
 * (memberProfileInputSchema); the e-mail comes from the session, never from this form.
 */
export function ProfileForm(props: {
  t: Text;
  initial: ProfileFormValues | null;
  version: number | null;
  policyVersion: string;
  chapters: { countryCode: string; name: string }[];
  next: string | null;
}) {
  const { t } = props;
  const router = useRouter();
  const [form, setForm] = useState<Flat>(() => fromValues(props.initial));
  const [version, setVersion] = useState(props.version);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "error" | "info" } | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const regencies =
    INDONESIA_PROVINCES.find((p) => p.name === form["id.province"])?.regencies ?? [];

  const input = (key: string, label: string, type = "text", required = true) => (
    <label className="ui-field">
      {label}
      <input
        className="ui-input"
        type={type}
        value={form[key] ?? ""}
        required={required}
        onChange={(e) => set(key, e.target.value)}
      />
    </label>
  );
  const select = (
    key: string,
    label: string,
    options: readonly (readonly [string, string])[],
    onChange?: (value: string) => void,
  ) => (
    <label className="ui-field">
      {label}
      <select
        className="ui-input"
        value={form[key] ?? ""}
        required
        onChange={(e) => (onChange ?? ((value: string) => set(key, value)))(e.target.value)}
      >
        <option value="">{t.choose}</option>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
  const section = (title: string, error: string | undefined, children: ReactNode) => (
    <fieldset className="ui-form">
      <legend>{title}</legend>
      {children}
      {error && (
        <p role="alert" className="ui-message">
          {error}
        </p>
      )}
    </fieldset>
  );

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await saveProfileAction({
        version,
        profile: {
          ...toInput(form),
          consent: { privacyPolicyVersion: props.policyVersion, accepted: agreed },
        },
      });
      if (result.ok) {
        setVersion(result.version);
        setFields({});
        setMessage({ text: t.saved, tone: "info" });
        if (props.next) {
          if (props.next.startsWith("/")) router.push(props.next);
          else window.location.assign(props.next); // e.g. back to the admin app
        }
        return;
      }
      setFields(result.fields ?? {});
      const text = {
        invalid: t.invalid,
        consent: t.consentChanged,
        conflict: t.conflict,
        signin: t.signin,
        verify: t.verifyFirst,
      }[result.error];
      setMessage({ text, tone: "error" });
    } catch {
      setMessage({ text: t.failed, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof ProfileFormValues) => fields[key];
  return (
    <form
      className="ui-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {section(
        t.personal,
        field("fullName") ?? field("gender") ?? field("dateOfBirth"),
        <>
          {input("fullName", t.fullName)}
          {select(
            "gender",
            t.gender,
            GENDERS.map((g) => [g, t.genders[g]] as const),
          )}
          {input("dateOfBirth", t.dateOfBirth, "date")}
        </>,
      )}
      {section(
        t.study,
        field("ppiCountry") ??
          field("university") ??
          field("educationLevel") ??
          field("majors") ??
          field("yearOfEntry") ??
          field("estimatedGraduationYear"),
        <>
          {props.chapters.length > 0
            ? select(
                "ppiCountry",
                t.ppiCountry,
                props.chapters.map((c) => [c.countryCode, c.name] as const),
              )
            : input("ppiCountry", t.ppiCountry)}
          {input("university", t.university)}
          {select(
            "educationLevel",
            t.educationLevel,
            EDUCATION_LEVELS.map((l) => [l, t.levels[l]] as const),
          )}
          {input("major1", t.majors)}
          {input("major2", t.majors, "text", false)}
          {input("major3", t.majors, "text", false)}
          {input("yearOfEntry", t.yearOfEntry, "number")}
          {input("estimatedGraduationYear", t.graduationYear, "number")}
        </>,
      )}
      {section(
        t.abroad,
        field("addressAbroad"),
        <>
          {input("abroad.line1", t.line1)}
          {input("abroad.line2", t.line2, "text", false)}
          {input("abroad.city", t.city)}
          {input("abroad.stateOrProvince", t.stateOrProvince, "text", false)}
          {input("abroad.postalCode", t.postalCode, "text", false)}
          {input("abroad.countryCode", t.countryCode)}
        </>,
      )}
      {section(
        t.indonesia,
        field("addressIndonesia"),
        <>
          {input("id.line1", t.line1)}
          {input("id.line2", t.line2Indonesia, "text", false)}
          {select(
            "id.province",
            t.province,
            INDONESIA_PROVINCES.map((p) => [p.name, p.name] as const),
            (value) => setForm((f) => ({ ...f, "id.province": value, "id.city": "" })),
          )}
          {select(
            "id.city",
            t.regency,
            regencies.map((r) => [r, r] as const),
          )}
          {input("id.postalCode", t.postalCode, "text", false)}
        </>,
      )}
      {section(
        t.contact,
        field("whatsappNumber") ?? field("emergencyContact") ?? field("timezone"),
        <>
          {input("whatsappNumber", t.whatsapp, "tel")}
          {input("emergency.phone", t.emergencyPhone, "tel")}
          {input("emergency.name", t.emergencyName, "text", false)}
          {input("emergency.relationship", t.emergencyRelationship, "text", false)}
          {input("timezone", t.timezone)}
        </>,
      )}
      <label className="ui-field">
        <span>
          <input
            type="checkbox"
            checked={agreed}
            required
            onChange={(e) => setAgreed(e.target.checked)}
          />{" "}
          <a href="/privacy">{t.consent}</a> ({props.policyVersion})
        </span>
      </label>
      {message && (
        <p
          role={message.tone === "info" ? "status" : "alert"}
          className="ui-message"
          data-tone={message.tone}
        >
          {message.text}
        </p>
      )}
      <button className="ui-button" type="submit" disabled={busy}>
        {busy ? t.saving : t.save}
      </button>
    </form>
  );
}
