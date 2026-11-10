"use client";

import { useRef, useState, type InputHTMLAttributes } from "react";
import type { FeaturedImage } from "@website/domain/content";
import {
  CHAPTER_REGIONS,
  CHAPTER_RISKS,
  type ChapterRisk,
  type SocialLink,
} from "@website/domain/organizations";
import { saveChapterAction, setChapterActiveAction } from "@/app/(panel)/organizations/actions";
import { actionMessage } from "@/components/action-message";
import { publicImage, useImageUpload } from "@/components/image-upload";
import { UploadBar } from "@/components/ui/upload-bar";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Modal } from "@/components/ui/modal";
import { CHAPTER_REGION_LABELS, CHAPTER_RISK_LABELS, label } from "@/labels";
import type { ChapterItem } from "./chapters-model";
import { Select } from "@/components/ui/select";

interface Form {
  name: string;
  countryCode: string;
  region: string;
  mapNo: string;
  timezone: string;
  logo: FeaturedImage | null;
  contactName: string;
  contactPublic: string;
  description: string;
  role: string;
  phone: string;
  website: string;
  email: string;
  instagram: string;
  socials: SocialLink[];
  latitude: string;
  longitude: string;
  slug: string;
  memberCount: string;
  conditions: string;
  risk: ChapterRisk;
  active: boolean;
}

const fromChapter = (c: ChapterItem | null, suggestedMapNo?: number): Form => ({
  name: c?.name ?? "",
  countryCode: c?.countryCode ?? "",
  region: c?.region ?? "",
  mapNo: c ? String(c.mapNo ?? "") : String(suggestedMapNo ?? ""),
  timezone: c?.timezone ?? "",
  logo: c?.logo ?? null,
  contactName: c?.contactName ?? "",
  contactPublic: c?.contactPublic ?? "",
  description: c?.description ?? "",
  role: c?.role ?? "",
  phone: c?.phone ?? "",
  website: c?.website ?? "",
  email: c?.email ?? "",
  instagram: c?.instagram ?? "",
  socials: c?.socials ?? [],
  latitude: c ? String(c.latitude) : "",
  longitude: c ? String(c.longitude) : "",
  slug: c?.slug ?? "",
  memberCount: String(c?.memberCount ?? 0),
  conditions: c?.conditions.join("\n") ?? "",
  risk: c?.risk ?? "none",
  active: c?.active ?? true,
});

export function ChapterForm(props: {
  chapter: ChapterItem | null;
  suggestedMapNo?: number;
  contactOnly?: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState<Form>(() => fromChapter(props.chapter, props.suggestedMapNo));
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const logo = useImageUpload("logo");
  const logoInput = useRef<HTMLInputElement>(null);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const field = (
    key: keyof Form,
    label: string,
    hint?: string,
    type = "text",
    board = false,
    rules: InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <div className="admin-field">
      <label className="admin-field__label" htmlFor={`chapter-${key}`}>
        {label}
      </label>
      <input
        id={`chapter-${key}`}
        className="admin-input"
        type={type}
        {...rules}
        disabled={board && props.contactOnly}
        value={form[key] as string}
        onChange={(e) => set(key, e.target.value as never)}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={`chapter-${key}-error`}
      />
      <FieldError id={`chapter-${key}-error`} message={errors[key]} hint={hint} />
    </div>
  );

  const save = async () => {
    setBusy(true);
    const { active, memberCount, conditions, ...fields } = form;
    const result = await saveChapterAction({
      ...(props.chapter ? { id: props.chapter.id } : {}),
      version: props.chapter?.version ?? null,
      ...fields,
      latitude: Number(form.latitude),
      longitude: Number(form.longitude),
      memberCount: Number(memberCount),
      conditions: conditions
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    });
    if (!result.ok) {
      setBusy(false);
      setErrors(result.fields ?? {});
      setMessage(actionMessage(result));
      return;
    }
    if (active !== (props.chapter?.active ?? true)) {
      const status = await setChapterActiveAction({
        id: props.chapter?.id ?? result.data.id,
        version: result.data.version,
        active,
      });
      if (!status.ok) {
        setBusy(false);
        setMessage(actionMessage(status));
        return;
      }
    }
    setBusy(false);
    props.onSaved(props.chapter ? "Chapter saved" : "Chapter added");
  };

  return (
    <Modal
      asForm
      open
      title={props.chapter ? "Edit PPI" : "Create PPI"}
      onClose={props.onClose}
      footer={
        <div className="admin-modal__footer-row">
          <Button variant="outline" icon="chevronLeft" onClick={props.onClose}>
            Back
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon="cloud"
            disabled={busy || logo.busy}
            onClick={() => save()}
          >
            Save
          </Button>
        </div>
      }
    >
      <div className="admin-form-grid">
        {field("name", "Name *", "e.g. PPI Jepang", "text", true, { required: true })}
        {field("countryCode", "Country *", "2-letter ISO code, e.g. JP", "text", true, {
          required: true,
          pattern: "[A-Za-z]{2}",
          title: "A 2-letter country code, e.g. JP",
        })}
        {field("timezone", "Time zone *", "IANA name, e.g. Australia/Sydney", "text", true, {
          required: true,
        })}
        {field("memberCount", "Members", "Registered members", "number", true, { min: 0 })}
        <div className="admin-field">
          <label className="admin-field__label" htmlFor="chapter-active">
            Status
          </label>
          <Select
            id="chapter-active"
            className="admin-input"
            disabled={props.contactOnly}
            value={form.active ? "active" : "inactive"}
            onChange={(e) => set("active", e.target.value === "active")}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive (hidden from the map)</option>
          </Select>
        </div>
        <div className="admin-field">
          <label className="admin-field__label" htmlFor="chapter-region">
            Map region
          </label>
          <Select
            id="chapter-region"
            className="admin-input"
            disabled={props.contactOnly}
            value={form.region}
            onChange={(e) => set("region", e.target.value)}
          >
            <option value="">Not shown on the map</option>
            {CHAPTER_REGIONS.map((region) => (
              <option key={region} value={region}>
                {label(CHAPTER_REGION_LABELS, region)}
              </option>
            ))}
          </Select>
          <FieldError
            id="chapter-region-error"
            message={errors["region"]}
            hint="The group on /map's country table"
          />
        </div>
        {field(
          "mapNo",
          "Map number",
          "№ on /map's country table (next free: pre-filled)",
          "number",
          true,
          {
            min: 1,
            step: 1,
          },
        )}
        <div className="admin-field">
          <label className="admin-field__label" htmlFor="chapter-risk">
            Risk
          </label>
          <Select
            id="chapter-risk"
            className="admin-input"
            disabled={props.contactOnly}
            value={form.risk}
            onChange={(e) => set("risk", e.target.value as ChapterRisk)}
          >
            {CHAPTER_RISKS.map((risk) => (
              <option key={risk} value={risk}>
                {label(CHAPTER_RISK_LABELS, risk)}
              </option>
            ))}
          </Select>
        </div>
        <div className="admin-field admin-form-grid__full">
          <label className="admin-field__label" htmlFor="chapter-conditions">
            Conditions
          </label>
          <textarea
            id="chapter-conditions"
            className="admin-input admin-textarea"
            rows={3}
            disabled={props.contactOnly}
            placeholder="Belum ada pengurus inti yang tercatat"
            value={form.conditions}
            onChange={(e) => set("conditions", e.target.value)}
            aria-describedby="chapter-conditions-error"
          />
          <FieldError
            id="chapter-conditions-error"
            message={errors["conditions"]}
            hint="One per line, at most 5"
          />
        </div>
        {field("slug", "URL", "Built from the name when empty", "text", true)}
        {field("latitude", "Map latitude *", "Marker position, e.g. 36.2", "number", true, {
          required: true,
          min: -90,
          max: 90,
          step: "any",
        })}
        {field("longitude", "Map longitude *", "e.g. 138.25", "number", true, {
          required: true,
          min: -180,
          max: 180,
          step: "any",
        })}
        {field("contactName", "Contact person", "Shown publicly")}
        {field("contactPublic", "Public contact", "E-mail or phone the contact allows to publish")}
        {field("role", "Role", "e.g. Ketua — shown with the contact person")}
        {field("phone", "Phone", "+64 …", "tel")}
        <div className="admin-field admin-form-grid__full">
          <label className="admin-field__label" htmlFor="chapter-description">
            Description
          </label>
          <textarea
            id="chapter-description"
            className="admin-input admin-textarea"
            rows={4}
            placeholder="About the PPI chapter, shown on its public page"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            aria-describedby="chapter-description-error"
          />
          <FieldError
            id="chapter-description-error"
            message={errors["description"]}
            hint="Shown on the chapter page (/map/…)"
          />
        </div>
        {field("website", "Website", "https://…", "url")}
        {field("email", "E-mail", undefined, "email")}
        {field("instagram", "Instagram", "@handle")}

        <div className="admin-field admin-form-grid__full">
          <span className="admin-field__label">Other links (max 5)</span>
          {form.socials.map((link, i) => (
            <div key={i} className="admin-field__row">
              <input
                className="admin-input"
                aria-label={`Link ${i + 1} label`}
                placeholder="YouTube"
                value={link.label}
                onChange={(e) =>
                  set(
                    "socials",
                    form.socials.map((s, j) => (j === i ? { ...s, label: e.target.value } : s)),
                  )
                }
              />
              <input
                className="admin-input"
                aria-label={`Link ${i + 1} URL`}
                placeholder="https://…"
                value={link.url}
                onChange={(e) =>
                  set(
                    "socials",
                    form.socials.map((s, j) => (j === i ? { ...s, url: e.target.value } : s)),
                  )
                }
              />
              <Button
                variant="ghost"
                size="icon"
                icon="x"
                aria-label={`Remove link ${i + 1}`}
                onClick={() =>
                  set(
                    "socials",
                    form.socials.filter((_, j) => j !== i),
                  )
                }
              />
            </div>
          ))}
          {form.socials.length < 5 && (
            <Button
              variant="outline"
              size="sm"
              icon="plus"
              onClick={() => set("socials", [...form.socials, { label: "", url: "" }])}
            >
              Add link
            </Button>
          )}
          <FieldError id="chapter-socials-error" message={errors["socials"]} />
        </div>

        <div className="admin-field admin-form-grid__full">
          <span className="admin-field__label">Logo</span>
          <div className="admin-field__row">
            {form.logo && (
              // eslint-disable-next-line @next/next/no-img-element -- Storage thumbnail (WebP)
              <img src={form.logo.thumbUrl} alt="" width={48} height={48} />
            )}
            <Button
              variant="outline"
              size="sm"
              icon="upload"
              disabled={logo.busy || props.contactOnly}
              onClick={() => logoInput.current?.click()}
            >
              {form.logo ? "Replace logo" : "Upload logo"}
            </Button>
            {form.logo && !props.contactOnly && (
              <Button variant="ghost" size="sm" onClick={() => set("logo", null)}>
                Remove
              </Button>
            )}
          </div>
          <input
            ref={logoInput}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              void logo.upload(file).then((image) => {
                const uploaded = image ? publicImage(image) : null;
                if (uploaded) set("logo", uploaded);
              });
            }}
          />
          <UploadBar upload={logo} />
          <FieldError id="chapter-logo-error" message={logo.error ?? errors["logo"]} />
        </div>
      </div>
      {message && (
        <p role="alert" className="admin-field__error">
          {message}
        </p>
      )}
    </Modal>
  );
}
