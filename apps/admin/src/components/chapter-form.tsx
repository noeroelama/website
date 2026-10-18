"use client";

import { useRef, useState } from "react";
import type { FeaturedImage } from "@website/domain/content";
import type { SocialLink } from "@website/domain/organizations";
import { saveChapterAction } from "@/app/(panel)/organizations/actions";
import { actionMessage } from "@/components/action-message";
import { publicImage, useImageUpload } from "@/components/image-upload";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Modal } from "@/components/ui/modal";
import type { ChapterItem } from "./chapters-model";

interface Form {
  name: string;
  countryCode: string;
  timezone: string;
  logo: FeaturedImage | null;
  contactName: string;
  contactPublic: string;
  website: string;
  email: string;
  instagram: string;
  socials: SocialLink[];
  latitude: string;
  longitude: string;
  slug: string;
}

const fromChapter = (c: ChapterItem | null): Form => ({
  name: c?.name ?? "",
  countryCode: c?.countryCode ?? "",
  timezone: c?.timezone ?? "",
  logo: c?.logo ?? null,
  contactName: c?.contactName ?? "",
  contactPublic: c?.contactPublic ?? "",
  website: c?.website ?? "",
  email: c?.email ?? "",
  instagram: c?.instagram ?? "",
  socials: c?.socials ?? [],
  latitude: c ? String(c.latitude) : "",
  longitude: c ? String(c.longitude) : "",
  slug: c?.slug ?? "",
});

/**
 * Add / edit a PPI chapter (feature A2). Every field is public (map card, About), so the contact
 * person is entered with the contact the chapter wants published only. Saved with a version check.
 */
export function ChapterForm(props: {
  chapter: ChapterItem | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState<Form>(() => fromChapter(props.chapter));
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const logo = useImageUpload("logo");
  const logoInput = useRef<HTMLInputElement>(null);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const field = (key: keyof Form, label: string, hint?: string, type = "text") => (
    <div className="admin-field">
      <label className="admin-field__label" htmlFor={`chapter-${key}`}>
        {label}
      </label>
      <input
        id={`chapter-${key}`}
        className="admin-input"
        type={type}
        value={form[key] as string}
        onChange={(e) => set(key, e.target.value as never)}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={`chapter-${key}-error`}
      />
      <FieldError id={`chapter-${key}-error`} message={errors[key] ?? hint} />
    </div>
  );

  const save = async () => {
    setBusy(true);
    const result = await saveChapterAction({
      ...(props.chapter ? { id: props.chapter.id } : {}),
      version: props.chapter?.version ?? null,
      ...form,
      latitude: Number(form.latitude),
      longitude: Number(form.longitude),
    });
    setBusy(false);
    if (!result.ok) {
      setErrors(result.fields ?? {});
      setMessage(actionMessage(result));
      return;
    }
    props.onSaved(props.chapter ? "Chapter saved" : "Chapter added");
  };

  return (
    <Modal
      open
      title={props.chapter ? `Edit ${props.chapter.name}` : "Add New PPI"}
      width={640}
      onClose={props.onClose}
      footer={
        <div className="admin-modal__footer-row admin-modal__footer-row--end">
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon="cloud"
            disabled={busy || logo.busy}
            onClick={() => void save()}
          >
            Save
          </Button>
        </div>
      }
    >
      <div className="admin-form-grid">
        {field("name", "Name *", "e.g. PPI Jepang")}
        {field("countryCode", "Country *", "2-letter ISO code, e.g. JP")}
        {field("timezone", "Time zone *", "IANA name, e.g. Asia/Tokyo")}
        {field("slug", "URL", "Built from the name when empty")}
        {field("latitude", "Map latitude *", "Marker position, e.g. 36.2", "number")}
        {field("longitude", "Map longitude *", "e.g. 138.25", "number")}
        {field("contactName", "Contact person", "Shown publicly")}
        {field("contactPublic", "Public contact", "E-mail or phone the contact allows to publish")}
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
              disabled={logo.busy}
              onClick={() => logoInput.current?.click()}
            >
              {logo.busy ? "Uploading…" : form.logo ? "Replace logo" : "Upload logo"}
            </Button>
            {form.logo && (
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
