"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { usePathname } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import {
  INITIAL_LINKS,
  PREFIX,
  PAGE_SIZE_OPTIONS,
  formatDate,
  type ShortLink,
} from "@/data/mock/short-links";

/* ==================================================================
   Tools — QR Generator (left ~30%) & URL Shortener (right ~70%)
   Ported from the earlier Vite admin; colours come from the shared
   design tokens. No hex values are allowed outside styles.css, so QR
   colours are read from the resolved `--color-*` custom properties.
   ================================================================== */

/** Resolve a single CSS custom property from :root (used for QR colours). */
function tokenValue(name: string): string {
  if (typeof window === "undefined") return "";
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value;
}

/** QR foreground/background from the brand tokens; undefined → qrcode's own defaults. */
function colorForQr(): { dark: string; light: string } | undefined {
  const dark = tokenValue("--color-brand-950");
  const light = tokenValue("--color-white");
  return dark && light ? { dark, light } : undefined;
}

/* ---- Centre-logo data URL (memoised per app run) ---- */
let logoUrlPromise: Promise<string> | null = null;

/** Load the public brand icon once and return it as a data URL for the SVG QR. */
function dataUrlForLogo(): Promise<string> {
  logoUrlPromise ??= new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const side = Math.min(img.naturalWidth, img.naturalHeight) || 256;
        canvas.width = side;
        canvas.height = side;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve("");
        ctx.drawImage(img, 0, 0, side, side);
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve("");
      }
    };
    img.onerror = () => resolve("");
    img.src = "/icon.png";
  });
  return logoUrlPromise;
}

/* ---------- Real, scannable QR code ---------- */
function QrPreview({
  text,
  size,
  showLogo,
  onClear,
}: {
  text: string;
  size: number;
  showLogo: boolean;
  onClear?: () => void;
}) {
  const [dataUrl, setDataUrl] = useState("");

  useEffect(() => {
    if (!text.trim()) return; // blank stays blank; `shown` also hides any stale dataUrl below
    let alive = true;
    QRCode.toDataURL(text.trim(), {
      width: size,
      margin: 2,
      errorCorrectionLevel: "H",
      ...(colorForQr() ? { color: colorForQr() } : {}),
    })
      .then((url) => {
        if (alive) setDataUrl(url);
      })
      .catch(() => {
        if (alive) setDataUrl("");
      });
    return () => {
      alive = false;
    };
  }, [text, size]);

  /* Never show a stale QR: blank when the input is empty, while generating, or on error. */
  const shown = text.trim() && dataUrl ? dataUrl : "";
  const logoPx = Math.round(size * 0.24);
  const ready = Boolean(shown);

  /* Trigger a browser download of the current QR as PNG (the shown data URL). */
  const downloadPng = () => {
    if (!ready) return;
    const a = document.createElement("a");
    a.href = shown;
    a.download = "qr-code.png";
    a.click();
  };

  /* Build an SVG string identical to the preview (same colours, optional centre logo),
     wrap it in a Blob and trigger a download. */
  const downloadSvg = async () => {
    const value = text.trim();
    if (!ready || !value) return;
    try {
      const svg = await QRCode.toString(value, {
        type: "svg",
        width: size,
        margin: 2,
        ...(colorForQr() ? { color: colorForQr() } : {}),
      });

      let mark = "";
      if (showLogo) {
        /* Centre overlay: white chip + logo, mirroring the on-screen .admin-qr-preview__logo.
           Colours come from the resolved design tokens (never literal hex/rgb — tokens test). */
        const viewBox = (svg.match(/viewBox="0 0 ([0-9.]+) ([0-9.]+)"/) ?? [])[1] ?? "";
        const vb = parseFloat(viewBox) || size;
        const logoHref = await dataUrlForLogo();
        if (logoHref) {
          const markSize = Math.round(vb * 0.24);
          const offset = Math.round((vb - markSize) / 2);
          const radius = Math.max(1, Math.round(markSize * 0.18));
          /* Semi-transparent ink border: brand-950 + "33" alpha (≈20%), built at runtime. */
          const ink = tokenValue("--color-brand-950");
          const chipFill = tokenValue("--color-white");
          mark =
            `<g>` +
            `<rect x="${offset}" y="${offset}" width="${markSize}" height="${markSize}" ` +
            `rx="${radius}" fill="${chipFill}" stroke="${ink}${ink ? "33" : ""}"/>` +
            `<image x="${offset}" y="${offset}" width="${markSize}" height="${markSize}" ` +
            `href="${logoHref}" preserveAspectRatio="xMidYMid meet"/>` +
            `</g>`;
        }
      }

      const blob = new Blob([svg.replace("</svg>", `${mark}</svg>`)], {
        type: "image/svg+xml;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "qr-code.svg";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* Keep the button inert if generation fails (e.g. content overflows the symbol). */
    }
  };

  return (
    <div className="admin-qr-preview">
      <div className="admin-qr-preview__container">
        {/* Height is derived from width (aspect-ratio) in CSS, so the tile stays
            square even when a Large QR is clamped to the fixed dashed frame. */}
        <div className="admin-qr-preview__tile" style={{ width: size }}>
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element -- data-URL QR output, not optimizable
            <img
              src={shown}
              alt="QR code"
              width={size}
              height={size}
              className="admin-qr-preview__image"
            />
          ) : (
            <div className="admin-qr-preview__empty">(empty)</div>
          )}
          {showLogo && shown ? (
            <div className="admin-qr-preview__logo" style={{ width: logoPx, height: logoPx }}>
              {/* Brand mark from the admin public folder; content only — see admin-logo. */}
              {/* eslint-disable-next-line @next/next/no-img-element -- static packed asset */}
              <img
                src="/icon.png"
                alt="PPIDK Asiania logo"
                className="admin-qr-preview__logo-img"
              />
            </div>
          ) : null}
          {onClear ? (
            <Button
              variant="ghost"
              size="icon"
              icon="x"
              className="admin-qr-clear"
              aria-label="Clear QR"
              onClick={onClear}
            />
          ) : null}
        </div>
      </div>
      <div className="admin-qr-preview__actions">
        <Button
          variant="primary"
          size="sm"
          className="admin-btn--black"
          icon="download"
          onClick={downloadPng}
          disabled={!ready}
        >
          Download PNG
        </Button>
        <Button
          variant="primary"
          size="sm"
          className="admin-btn--black"
          icon="download"
          onClick={() => void downloadSvg()}
          disabled={!ready}
        >
          Download SVG
        </Button>
      </div>
    </div>
  );
}

type QrType = "link" | "text";
type QrSize = "small" | "medium" | "large";

/** Pending delete action shown in the dark confirm modal (one link or many). */
type DeleteConfirm = { kind: "one"; link: ShortLink } | { kind: "many"; count: number };

/* Dark result banner (brand-950) shown after a link is created/updated.
   Left: check + "Short Link Created", the link, "Redirect to …".
   Right: cream buttons Generate QR / Copy / Visit URL (logo before text). */

/** Button look for a result banner: maroon on cream, light-on-dark ghost otherwise. */
function bannerButtonProps(isCream: boolean): { variant: "maroon" | "ghost"; className?: string } {
  return isCream ? { variant: "maroon" } : { variant: "ghost", className: "admin-btn--light" };
}

function LinkResultBanner({
  title,
  link,
  onCopy,
  onVisit,
  onGenerateQr,
  tone = "dark",
}: {
  title: string;
  link: ShortLink;
  onCopy: () => void;
  onVisit: () => void;
  onGenerateQr: () => void;
  tone?: "dark" | "cream";
}) {
  const isCream = tone === "cream";
  return (
    <div
      className={
        isCream
          ? "admin-link-result admin-link-result--cream"
          : "admin-link-result admin-link-result--dark"
      }
    >
      <div className="admin-link-result__main">
        <div className="admin-link-result__title">
          <Icon name="check" size={14} />
          {title}
        </div>
        <div className="admin-link-result__link">
          https://{PREFIX}
          {link.slug}
        </div>
        <div className="admin-link-result__meta">Redirect to {link.original}</div>
      </div>
      <div className="admin-link-result__actions">
        <Button {...bannerButtonProps(isCream)} icon="qr" size="sm" onClick={onGenerateQr}>
          Generate QR
        </Button>
        <Button {...bannerButtonProps(isCream)} icon="copy" size="sm" onClick={onCopy}>
          Copy
        </Button>
        <Button {...bannerButtonProps(isCream)} icon="external" size="sm" onClick={onVisit}>
          Visit URL
        </Button>
      </div>
    </div>
  );
}

const QR_SIZE_OPTIONS: { value: QrSize; label: string; hint: string; px: number }[] = [
  { value: "small", label: "Small", hint: "For Screens", px: 132 },
  { value: "medium", label: "Medium", hint: "For A4 Print", px: 180 },
  { value: "large", label: "Large", hint: "For Posters", px: 230 },
];

export function ToolsPage() {
  const pathname = usePathname();
  // key={pathname} remounts the page when the tools route is (re)entered, so
  // the searchbox and filters start empty on every visit (same pattern as
  // Articles & Gallery).
  return <ToolsList key={pathname} />;
}

/** Tools screen (all state lives here; remounted by ToolsPage on navigation
 *  so it starts clean). */
function ToolsList() {
  const toast = useToastMessage();

  /* ---- QR Generator ---- */
  const [qrType, setQrType] = useState<QrType>("link");
  const [qrLink, setQrLink] = useState("");
  const [qrText, setQrText] = useState("");
  const [qrSize, setQrSize] = useState<QrSize>("small");
  const [qrLogo, setQrLogo] = useState(true);
  const [qrCreated, setQrCreated] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  /* Read the chosen image, convert it to PNG (canvas), max 5MB. When the image
     is a QR code, decode it and fill the Link / Plain Text field with its content,
     auto-switching the type to match (a URL → Link input, anything else → Text). */
  const onBannerFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.show("Please choose an image file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.show("Image must be max 5MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        setBanner(canvas.toDataURL("image/png"));
        try {
          const { data } = ctx.getImageData(0, 0, img.width, img.height);
          const found = jsQR(data, img.width, img.height);
          const content = found?.data?.trim();
          if (!content) {
            toast.show("No QR code found in this image");
            return;
          }
          const isLink = /^https?:\/\//i.test(content) || content.startsWith(PREFIX);
          if (isLink) {
            setQrType("link");
            setQrLink(content);
          } else {
            setQrType("text");
            setQrText(content);
          }
          toast.show(isLink ? `Link read: ${content}` : "Text read from QR");
        } catch {
          /* Non-QR images keep the plain upload behaviour. */
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const qrValue = qrType === "link" ? qrLink : qrText;
  const qrSizePx = QR_SIZE_OPTIONS.find((o) => o.value === qrSize)?.px ?? 180;

  const generateQr = () => {
    if (!qrValue.trim()) {
      toast.show(qrType === "link" ? "Enter a link first" : "Enter some text first");
      return;
    }
    setQrCreated(true);
    toast.show("QR code generated successfully");
  };

  /* ---- URL Shortener ---- */
  const [longUrl, setLongUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [links, setLinks] = useState<ShortLink[]>(INITIAL_LINKS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [editingLink, setEditingLink] = useState<ShortLink | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editSaved, setEditSaved] = useState(false);
  const [createdLink, setCreatedLink] = useState<ShortLink | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState(""); // diterapkan hanya saat Search diklik / Enter ditekan
  const [selected, setSelected] = useState<Set<string>>(new Set());

  /* --- edit modal form --- */
  const [editForm, setEditForm] = useState({ original: "", title: "", slug: "" });

  /* Result container auto-hides after a few seconds */
  useEffect(() => {
    if (!createdLink) return;
    const t = setTimeout(() => setCreatedLink(null), 4000);
    return () => clearTimeout(t);
  }, [createdLink]);

  useEffect(() => {
    if (!editSaved) return;
    const t = setTimeout(() => setEditSaved(false), 4000);
    return () => clearTimeout(t);
  }, [editSaved]);

  const generateLink = () => {
    const raw = longUrl.trim();
    if (!raw) {
      toast.show("Paste a long URL first");
      return;
    }
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const finalSlug = slug.trim().replace(/\s+/g, "-");
    if (!finalSlug) {
      toast.show("URL is required — enter a short slug");
      return;
    }

    const newLink: ShortLink = {
      id: `l-${Date.now()}`,
      title: linkTitle.trim() || "Untitled link",
      original: normalized,
      slug: finalSlug,
      clicks: 0,
      createdAt: new Date().toISOString().slice(0, 10),
    };
    setLinks((prev) => [newLink, ...prev]);
    setCreatedLink(newLink);
    toast.show(`Short link created: ${PREFIX}${finalSlug}`);
    setLongUrl("");
    setLinkTitle("");
    setSlug("");
    setPage(1);
  };

  const openEdit = (link: ShortLink) => {
    setEditingLink(link);
    setEditForm({ original: link.original, title: link.title, slug: link.slug });
    setEditSaved(false);
    setEditOpen(true);
  };

  const saveEdit = () => {
    if (!editingLink) return;
    const normalized = /^https?:\/\//i.test(editForm.original.trim())
      ? editForm.original.trim()
      : `https://${editForm.original.trim()}`;
    const finalSlug = editForm.slug.trim().replace(/\s+/g, "-") || editingLink.slug;
    const updated: ShortLink = {
      ...editingLink,
      title: editForm.title.trim() || editingLink.title,
      original: normalized,
      slug: finalSlug,
    };
    setLinks((prev) => prev.map((l) => (l.id === editingLink.id ? updated : l)));
    setEditingLink(updated);
    setCreatedLink(updated);
    setEditSaved(true);
    toast.show(`Link ${PREFIX}${finalSlug} updated`);
  };

  const generateQrFromLink = (link: ShortLink) => {
    setQrType("link");
    setQrLink(`https://${PREFIX}${link.slug}`);
    setQrCreated(true);
    toast.show("QR ready — review the QR Generator panel");
  };

  const copyShort = (link: ShortLink) => {
    void navigator.clipboard?.writeText(`https://${PREFIX}${link.slug}`);
    toast.show(`Link ${PREFIX}${link.slug} copied`);
  };

  const goToLink = (link: ShortLink) => {
    window.open(`https://${PREFIX}${link.slug}`, "_blank", "noopener,noreferrer");
  };

  /* Deletes are confirmed in the dark modal (like Edit Link) instead of
     window.confirm. The modal only stores *what* would be deleted; doDelete
     applies the change once the user confirms. */
  const doDelete = () => {
    if (!deleteConfirm) return;
    if (deleteConfirm.kind === "one") {
      const link = deleteConfirm.link;
      setLinks((prev) => prev.filter((l) => l.id !== link.id));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(link.id);
        return next;
      });
      if (editingLink?.id === link.id) {
        setEditOpen(false);
        setEditingLink(null);
      }
      setDeleteConfirm(null);
      toast.show("Link deleted");
    } else {
      const ids = new Set(Array.from(selected).filter((id) => links.some((l) => l.id === id)));
      setLinks((prev) => prev.filter((l) => !ids.has(l.id)));
      setSelected(new Set());
      if (editingLink && ids.has(editingLink.id)) {
        setEditOpen(false);
        setEditingLink(null);
      }
      setDeleteConfirm(null);
      toast.show(`${deleteConfirm.count} link${deleteConfirm.count === 1 ? "" : "s"} deleted`);
    }
  };

  const deleteLink = (link: ShortLink) => {
    setDeleteConfirm({ kind: "one", link });
  };

  const deleteSelected = () => {
    if (selected.size === 0) {
      toast.show("Select links to delete");
      return;
    }
    setDeleteConfirm({ kind: "many", count: selected.size });
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return links;
    return links.filter(
      (l) =>
        l.title.toLowerCase().includes(q) ||
        l.original.toLowerCase().includes(q) ||
        l.slug.toLowerCase().includes(q),
    );
  }, [links, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const pageAllSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));
  const pageSomeSelected = pageRows.some((r) => selected.has(r.id));

  const togglePage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (pageAllSelected) pageRows.forEach((r) => next.delete(r.id));
      else pageRows.forEach((r) => next.add(r.id));
      return next;
    });
  };

  const checkboxCol: Column<ShortLink> = {
    key: "check",
    width: "24px",
    align: "left",
    header: (
      <label className="admin-checkbox">
        <input
          type="checkbox"
          aria-label="Select all on page"
          checked={pageAllSelected}
          ref={(el) => {
            if (el) el.indeterminate = pageSomeSelected && !pageAllSelected;
          }}
          onChange={togglePage}
          className="admin-table__checkbox"
        />
        <span aria-hidden="true" />
      </label>
    ),
    render: (r) => (
      <label className="admin-checkbox">
        <input
          type="checkbox"
          aria-label={`Select ${r.title}`}
          checked={selected.has(r.id)}
          onChange={() => toggleSelect(r.id)}
          className="admin-table__checkbox"
        />
        <span aria-hidden="true" />
      </label>
    ),
  };

  const columns: Column<ShortLink>[] = [
    checkboxCol,
    {
      key: "short",
      header: "URL",
      width: "30%",
      render: (r) => (
        <div>
          <div className="admin-table__title admin-table__title--row">
            <Icon name="link" size={14} />
            {PREFIX}
            {r.slug}
          </div>
          <div className="admin-table__sub">{r.original}</div>
        </div>
      ),
    },
    {
      key: "createdAt",
      header: "Date Created",
      width: "18%",
      render: (r) => formatDate(r.createdAt),
    },
    {
      key: "aksi",
      header: "Actions",
      align: "right",
      width: "30%",
      render: (r) => (
        <div className="admin-table__actions">
          <Button
            variant="ghost"
            size="icon"
            className="admin-table__delete"
            icon="trash"
            aria-label="Delete"
            onClick={() => deleteLink(r)}
            title="Delete"
          />
          <Button
            variant="ghost"
            size="icon"
            icon="edit"
            aria-label="Edit"
            onClick={() => openEdit(r)}
            title="Edit"
          />
          <Button
            variant="ghost"
            size="icon"
            icon="copy"
            aria-label="Copy"
            onClick={() => copyShort(r)}
            title="Copy"
          />
          <Button
            variant="ghost"
            size="icon"
            icon="external"
            aria-label="Go to URL"
            onClick={() => goToLink(r)}
            title="Go to URL"
          />
        </div>
      ),
    },
  ];

  /* --- Pagination: sliding window of 5 consecutive page numbers --- */
  const pageNumbers: number[] = [];
  const winStart = Math.max(1, Math.min(safePage - 2, totalPages - 4));
  const winEnd = Math.min(totalPages, winStart + 4);
  for (let i = winStart; i <= winEnd; i++) pageNumbers.push(i);
  const compact = pageNumbers;

  const shownStart = filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const shownEnd = Math.min(safePage * pageSize, filtered.length);

  return (
    <>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Tools</h1>
          <p className="admin-page-header__desc">All PPIDK ASIANIA organizational tools.</p>
        </div>
      </div>

      <div className="admin-tools-grid">
        {/* ============ QR GENERATOR (left 30%) ============ */}
        <Card>
          <CardHeader title={<span className="admin-card__title">QR Generator</span>} />
          <CardBody style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {/* Type */}
            <div className="admin-field">
              <span className="admin-field__label">Type</span>
              <div className="admin-radio-row">
                <label className="admin-radio">
                  <input
                    type="radio"
                    name="qr-type"
                    checked={qrType === "link"}
                    onChange={() => setQrType("link")}
                  />
                  Link
                </label>
                <label className="admin-radio">
                  <input
                    type="radio"
                    name="qr-type"
                    checked={qrType === "text"}
                    onChange={() => setQrType("text")}
                  />
                  Plain Text
                </label>
              </div>
            </div>

            {/* Value input */}
            {qrType === "link" ? (
              <label className="admin-field">
                <span className="admin-field__label">Link *</span>
                <input
                  className="admin-input admin-input--dark"
                  type="url"
                  placeholder="e.g. https://goppi.id"
                  value={qrLink}
                  onChange={(e) => setQrLink(e.target.value)}
                />
              </label>
            ) : (
              <label className="admin-field">
                <span className="admin-field__label">Text</span>
                <textarea
                  className="admin-input admin-input--dark admin-textarea"
                  rows={3}
                  placeholder="Type your content here…"
                  value={qrText}
                  onChange={(e) => setQrText(e.target.value)}
                />
              </label>
            )}

            {/* Size — horizontal, bold value on top / hint below */}
            <div className="admin-field">
              <span className="admin-field__label">Size</span>
              <div className="admin-radio-row">
                {QR_SIZE_OPTIONS.map((opt) => (
                  <label key={opt.value} className="admin-radio">
                    <input
                      type="radio"
                      name="qr-size"
                      checked={qrSize === opt.value}
                      onChange={() => setQrSize(opt.value)}
                    />
                    <span className="admin-radio__stack">
                      <strong>{opt.label}</strong>
                      <span className="admin-card__subtitle">{opt.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Logo toggle (horizontal switch) */}
            <label className="admin-qr-switch">
              <input
                type="checkbox"
                className="admin-qr-switch__input"
                checked={qrLogo}
                onChange={(e) => setQrLogo(e.target.checked)}
              />
              <span className="admin-qr-switch__track" aria-hidden="true" />
              <span className="admin-qr-switch__text">
                <span className="admin-qr-switch__label">
                  Add PPIDK Asiania logo in the centre.
                </span>
                <span className="admin-qr-switch__hint">Turn this off for long content.</span>
              </span>
            </label>

            <Button
              variant="maroon"
              size="lg"
              icon="qr"
              className="admin-btn--regular"
              onClick={generateQr}
            >
              Generate QR
            </Button>

            {qrCreated ? (
              <QrPreview
                text={qrValue}
                size={qrSizePx}
                showLogo={qrLogo}
                onClear={() => {
                  setQrCreated(false);
                  setQrLink("");
                  setQrText("");
                  setBanner(null);
                }}
              />
            ) : (
              <>
                <div
                  className="admin-dropzone"
                  onClick={() => bannerInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    if (file) onBannerFile(file);
                  }}
                >
                  {banner ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element -- data-URL upload, not optimizable */}
                      <img src={banner} alt="Uploaded banner" className="admin-dropzone__image" />
                      <span className="admin-dropzone__badge">Click to change</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        icon="x"
                        className="admin-dropzone__remove"
                        aria-label="Remove uploaded image"
                        onClick={(e) => {
                          e.stopPropagation();
                          setBanner(null);
                        }}
                      />
                    </>
                  ) : (
                    <>
                      <Icon name="qr" size={34} />
                      <span className="admin-dropzone__title">
                        Drag &amp; drop banner image or click to browse
                      </span>
                      <span className="admin-card__subtitle">
                        Any image format • Converted to WebP • Max 5MB
                      </span>
                    </>
                  )}
                </div>
                <input
                  ref={bannerInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onBannerFile(file);
                    e.target.value = "";
                  }}
                />
              </>
            )}
          </CardBody>
        </Card>

        {/* ============ URL SHORTENER (right 70%) ============ */}
        <Card className="admin-tools-card">
          <CardHeader title={<span className="admin-card__title">URL Shortener</span>} />
          <CardBody className="admin-tools-form">
            {/* Result container (appears above Long URL after Generate) */}
            {createdLink ? (
              <LinkResultBanner
                title="Short Link Created"
                link={createdLink}
                onCopy={() => copyShort(createdLink)}
                onVisit={() => goToLink(createdLink)}
                onGenerateQr={() => generateQrFromLink(createdLink)}
              />
            ) : null}

            {/* Long URL */}
            <label className="admin-field">
              <span className="admin-field__label">Long URL *</span>
              <input
                className="admin-input"
                type="url"
                placeholder="Paste the URL to be shortened, e.g. https://goppi.id/"
                value={longUrl}
                onChange={(e) => setLongUrl(e.target.value)}
              />
            </label>

            {/* Title */}
            <label className="admin-field">
              <span className="admin-field__label">Title</span>
              <input
                className="admin-input"
                type="text"
                placeholder="URL title, e.g. PPIDK Asiania News"
                value={linkTitle}
                onChange={(e) => setLinkTitle(e.target.value)}
              />
            </label>

            {/* Short URL — snug readonly prefix + editable slug */}
            <div className="admin-field">
              <span className="admin-field__label">URL *</span>
              <div className="admin-field__row">
                <div className="admin-url-slug">
                  <span className="admin-url-slug__prefix" aria-label="Short URL prefix">
                    {PREFIX}
                  </span>
                  <input
                    className="admin-url-slug__slug"
                    type="text"
                    aria-label="Short URL slug"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") generateLink();
                    }}
                  />
                </div>
                <Button
                  variant="maroon"
                  icon="link"
                  onClick={generateLink}
                  style={{ whiteSpace: "nowrap" }}
                >
                  Generate Link
                </Button>
              </div>
            </div>
          </CardBody>

          <CardBody flush>
            {/* Toolbar: search left, delete right */}
            <div className="admin-toolbar">
              <form
                className="admin-searchbox"
                onSubmit={(e) => {
                  e.preventDefault();
                  setQuery(search);
                  setPage(1);
                  setPageSize(10);
                }}
              >
                <Icon name="search" size={16} className="admin-searchbox__icon" />
                <input
                  className="admin-searchbox__input"
                  type="search"
                  placeholder="Search"
                  aria-label="Search links"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    // Emptying the box (✕ or clear) drops the applied query
                    // too, so the list returns to its default view.
                    if (e.target.value === "") {
                      setQuery("");
                      setPage(1);
                    }
                  }}
                />
                <button type="submit" className="admin-searchbox__submit">
                  Search
                </button>
              </form>
              <Button variant="danger" size="sm" icon="trash" onClick={deleteSelected}>
                Delete
              </Button>
            </div>

            {pageRows.length === 0 ? (
              <div className="admin-empty admin-tools-empty">
                <span className="admin-empty__heading">
                  <Icon name="search" size={16} />
                  <span className="admin-empty__title">
                    {query.trim()
                      ? `No links match “${query.trim()}”`
                      : "No links match your search"}
                  </span>
                </span>
                <span className="admin-empty__hint">Try a new search or clear it.</span>
                <span className="admin-empty__actions">
                  {query.trim() ? (
                    <Button
                      variant="outline"
                      size="sm"
                      icon="x"
                      className="admin-gallery-clear"
                      onClick={() => {
                        setQuery("");
                        setSearch("");
                      }}
                    >
                      Clear search
                    </Button>
                  ) : null}
                </span>
              </div>
            ) : (
              <DataTable
                columns={columns}
                rows={pageRows}
                rowKey={(r) => r.id}
                emptyText="No links yet"
                hideHeader
              />
            )}

            {/* Pagination: Showing … of N · Rows per page · page numbers */}
            <div className="admin-darkbar">
              <span className="admin-darkbar__info">
                Showing {shownStart}–{shownEnd} of {filtered.length}
              </span>

              <span className="admin-darkbar__info">
                Rows per page
                <select
                  className="admin-darkbar__select"
                  aria-label="Rows per page"
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                >
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </span>

              <span className="admin-darkbar__spacer" />

              <button
                type="button"
                className="admin-darkbar__btn"
                disabled={safePage <= 1}
                onClick={() => setPage(safePage - 1)}
                aria-label="Previous page"
              >
                <Icon name="chevronLeft" size={14} />
              </button>
              {compact.map((p) => (
                <button
                  type="button"
                  key={p}
                  className={`admin-darkbar__btn${p === safePage ? " admin-darkbar__btn--active" : ""}`}
                  onClick={() => setPage(p)}
                >
                  {p}
                </button>
              ))}
              <button
                type="button"
                className="admin-darkbar__btn"
                disabled={safePage >= totalPages}
                onClick={() => setPage(safePage + 1)}
                aria-label="Next page"
              >
                <Icon name="chevronRight" size={14} />
              </button>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Edit link popup */}
      <Modal
        open={editOpen}
        title="Edit Link"
        subtitle="Edit shortened link details."
        className="admin-modal--dark"
        hideClose
        onClose={() => {
          setEditOpen(false);
          setEditingLink(null);
          setEditSaved(false);
        }}
        footer={
          <div className="admin-modal__footer-row">
            <Button
              variant="ghost"
              className="admin-btn--light admin-modal__foot-btn"
              icon="chevronLeft"
              onClick={() => {
                setEditOpen(false);
                setEditingLink(null);
                setEditSaved(false);
              }}
            >
              Back
            </Button>
            <Button
              variant="ghost"
              className="admin-btn--light admin-modal__foot-btn"
              icon="cloud"
              onClick={saveEdit}
              disabled={editSaved}
            >
              {editSaved ? "Saved" : "Save Draft"}
            </Button>
          </div>
        }
      >
        <div className="admin-form-grid">
          <div className="admin-field admin-form-grid__full">
            <label className="admin-field__label" htmlFor="edit-original">
              Long URL
            </label>
            <input
              id="edit-original"
              className="admin-input"
              type="url"
              placeholder="https://…"
              value={editForm.original}
              onChange={(e) => setEditForm({ ...editForm, original: e.target.value })}
            />
          </div>
          <div className="admin-field admin-form-grid__full">
            <label className="admin-field__label" htmlFor="edit-title">
              Title
            </label>
            <input
              id="edit-title"
              className="admin-input"
              type="text"
              placeholder="URL title"
              value={editForm.title}
              onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
            />
          </div>
          <div className="admin-field admin-form-grid__full">
            <label className="admin-field__label" htmlFor="edit-slug">
              URL
            </label>
            <div className="admin-field__row">
              <div className="admin-url-slug">
                <span className="admin-url-slug__prefix" aria-label="Short URL prefix">
                  {PREFIX}
                </span>
                <input
                  id="edit-slug"
                  className="admin-url-slug__slug"
                  type="text"
                  aria-label="Short URL slug"
                  value={editForm.slug}
                  onChange={(e) => setEditForm({ ...editForm, slug: e.target.value })}
                />
              </div>
              <Button
                variant="ghost"
                className="admin-btn--light"
                icon="link"
                onClick={saveEdit}
                style={{ whiteSpace: "nowrap" }}
              >
                Generate Link
              </Button>
            </div>
          </div>

          {/* Result container appears above the Save button after saving */}
          {editSaved && editingLink ? (
            <div className="admin-form-grid__full">
              <LinkResultBanner
                tone="cream"
                title="Short Link Updated"
                link={editingLink}
                onCopy={() => copyShort(editingLink)}
                onVisit={() => goToLink(editingLink)}
                onGenerateQr={() => generateQrFromLink(editingLink)}
              />
            </div>
          ) : null}
        </div>
      </Modal>

      {/* Delete confirmation popup — dark, compact, styled like Edit Link but
          sized to the text; the two actions sit flush right. */}
      <Modal
        open={deleteConfirm !== null}
        title="Delete link"
        width={420}
        className="admin-modal--dark admin-modal--delete"
        hideClose
        onClose={() => setDeleteConfirm(null)}
        footer={
          <div className="admin-modal__footer-row admin-modal__footer-row--end">
            <Button
              variant="ghost"
              className="admin-btn--light admin-modal__foot-btn"
              icon="chevronLeft"
              onClick={() => setDeleteConfirm(null)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              className="admin-modal__foot-btn"
              icon="trash"
              onClick={doDelete}
            >
              Delete
            </Button>
          </div>
        }
      >
        <p className="admin-delete-confirm__message">
          {deleteConfirm?.kind === "many"
            ? `Delete ${deleteConfirm.count} selected link${deleteConfirm.count === 1 ? "" : "s"}? This cannot be undone.`
            : deleteConfirm
              ? `Delete "${PREFIX}${deleteConfirm.link.slug}"? This cannot be undone.`
              : ""}
        </p>
      </Modal>

      <ToastBanner message={toast.message} />
    </>
  );
}
