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
  QR_DOWNLOAD_PX,
  QR_ERROR_CORRECTION,
  QR_MARGIN,
  QR_MAX_LENGTH,
  qrLogoPlate,
  qrTextProblem,
} from "@website/domain/documents";
import { withoutScheme } from "@/components/format";
import { PREFIX, formatDate, type ShortLink } from "@/components/links-model";
import { PAGE_SIZE_OPTIONS } from "@/components/list-model";
import { actionMessage } from "@/components/action-message";
import {
  createLinkAction,
  linkClicksAction,
  renameLinkAction,
  setLinkArchivedAction,
} from "@/app/(panel)/tools/actions";
import { Select } from "@/components/ui/select";

function tokenValue(name: string): string {
  if (typeof window === "undefined") return "";
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value;
}

function colorForQr(): { dark: string; light: string } | undefined {
  const dark = tokenValue("--color-brand-950");
  const light = tokenValue("--color-brand-50");
  return dark && light ? { dark, light } : undefined;
}

let logoPromise: Promise<HTMLImageElement | null> | null = null;

function brandLogo(): Promise<HTMLImageElement | null> {
  logoPromise ??= new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = "/logo.webp";
  });
  return logoPromise;
}

function QrPreview({
  text,
  size,
  downloadSize,
  showLogo,
  onClear,
}: {
  text: string;
  size: number;
  downloadSize: number;
  showLogo: boolean;
  onClear?: () => void;
}) {
  const [dataUrl, setDataUrl] = useState("");

  useEffect(() => {
    if (!text.trim()) return;
    let alive = true;
    QRCode.toDataURL(text.trim(), {
      width: size,
      margin: QR_MARGIN,
      errorCorrectionLevel: QR_ERROR_CORRECTION,
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

  const shown = text.trim() && dataUrl ? dataUrl : "";
  const plate = qrLogoPlate(size);
  const ready = Boolean(shown);

  const save = (href: string, name: string) => {
    const a = document.createElement("a");
    a.href = href;
    a.download = name;
    a.click();
  };

  const downloadPng = async () => {
    const value = text.trim();
    if (!ready || !value) return;
    try {
      const canvas = document.createElement("canvas");
      const colors = colorForQr();
      await QRCode.toCanvas(canvas, value, {
        width: downloadSize,
        margin: QR_MARGIN,
        errorCorrectionLevel: QR_ERROR_CORRECTION,
        ...(colors ? { color: colors } : {}),
      });
      const logo = showLogo ? await brandLogo() : null;
      const ctx = canvas.getContext("2d");
      if (logo && ctx) {
        const plate = qrLogoPlate(canvas.width);
        ctx.fillStyle = colors?.light || tokenValue("--color-white");
        ctx.fillRect(plate.x, plate.y, plate.size, plate.size);
        const scale = plate.logo.size / Math.max(logo.naturalWidth, logo.naturalHeight);
        const w = logo.naturalWidth * scale;
        const h = logo.naturalHeight * scale;
        ctx.drawImage(
          logo,
          plate.logo.x + (plate.logo.size - w) / 2,
          plate.logo.y + (plate.logo.size - h) / 2,
          w,
          h,
        );
      }
      save(canvas.toDataURL("image/png"), "qr-code.png");
    } catch {
      /* Keep the button inert if generation fails (e.g. content overflows the symbol). */
    }
  };

  const downloadSvg = async () => {
    const value = text.trim();
    if (!ready || !value) return;
    try {
      const svg = await QRCode.toString(value, {
        type: "svg",
        width: downloadSize,
        margin: QR_MARGIN,
        errorCorrectionLevel: QR_ERROR_CORRECTION,
        ...(colorForQr() ? { color: colorForQr() } : {}),
      });
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
      save(url, "qr-code.svg");
      URL.revokeObjectURL(url);
    } catch {
      /* Keep the button inert if generation fails (e.g. content overflows the symbol). */
    }
  };

  return (
    <div className="admin-qr-preview">
      <div className="admin-qr-preview__container">
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
            <div
              className="admin-qr-preview__logo"
              style={{ width: plate.size, height: plate.size }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- static packed asset */}
              <img
                src="/logo.webp"
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
        <Button variant="primary" icon="download" onClick={() => downloadPng()} disabled={!ready}>
          Download PNG
        </Button>
        <Button variant="primary" icon="download" onClick={() => downloadSvg()} disabled={!ready}>
          Download SVG
        </Button>
      </div>
    </div>
  );
}

type QrType = "link" | "text";
type QrSize = "small" | "medium" | "large";

type DeleteConfirm = { kind: "one"; link: ShortLink } | { kind: "many"; count: number };

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
        <div className="admin-link-result__link">{withoutScheme(link.shortUrl)}</div>
        <div className="admin-link-result__meta">Redirects to {withoutScheme(link.original)}</div>
      </div>
      <div className="admin-link-result__actions">
        <Button variant="primary" icon="qr" onClick={onGenerateQr}>
          Generate QR
        </Button>
        <Button variant="primary" icon="copy" onClick={onCopy}>
          Copy
        </Button>
        <Button variant="primary" icon="external" onClick={onVisit}>
          Visit URL
        </Button>
      </div>
    </div>
  );
}

const QR_SIZE_OPTIONS: { value: QrSize; label: string; hint: string; px: number }[] = [
  { value: "small", label: "Small", hint: "For screens", px: 132 },
  { value: "medium", label: "Medium", hint: "For A4 print", px: 180 },
  { value: "large", label: "Large", hint: "For posters", px: 230 },
];

interface ToolsProps {
  initialLinks: ShortLink[];
  canEdit: boolean;
}

export function ToolsPage(props: ToolsProps) {
  const pathname = usePathname();
  return <ToolsList key={pathname} {...props} />;
}

function ToolsList({ initialLinks, canEdit }: ToolsProps) {
  const toast = useToastMessage();

  const [qrType, setQrType] = useState<QrType>("link");
  const [qrLink, setQrLink] = useState("");
  const [qrText, setQrText] = useState("");
  const [qrSize, setQrSize] = useState<QrSize>("small");
  const [qrLogo, setQrLogo] = useState(true);
  const [qrCreated, setQrCreated] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

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
    const problem = qrTextProblem(qrValue);
    if (problem) {
      toast.show(problem);
      return;
    }
    setQrCreated(true);
    toast.show("QR code generated successfully");
  };

  const [longUrl, setLongUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [links, setLinks] = useState<ShortLink[]>(initialLinks);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [editingLink, setEditingLink] = useState<ShortLink | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editSaved, setEditSaved] = useState(false);
  const [createdLink, setCreatedLink] = useState<ShortLink | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [editForm, setEditForm] = useState({ original: "", title: "", slug: "" });
  const [editClicks, setEditClicks] = useState<string>("…");
  const [busy, setBusy] = useState(false);

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

  const generateLink = async () => {
    const raw = longUrl.trim();
    if (!raw) {
      toast.show("Paste a long URL first");
      return;
    }
    if (busy) return;
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const finalSlug = slug.trim().replace(/\s+/g, "-");
    setBusy(true);
    const result = await createLinkAction({
      longUrl: normalized,
      title: linkTitle.trim(),
      slug: finalSlug || null,
    });
    setBusy(false);
    if (!result.ok) {
      toast.show(actionMessage(result));
      return;
    }
    const newLink = result.data;
    setLinks((prev) => [newLink, ...prev]);
    setCreatedLink(newLink);
    toast.show(`Short link created: ${withoutScheme(newLink.shortUrl)}`);
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
    setEditClicks("…");
    void linkClicksAction({ id: link.id }).then((r) =>
      setEditClicks(r.ok ? (r.data.clicks === null ? "not reported" : String(r.data.clicks)) : "—"),
    );
  };

  const saveEdit = async () => {
    if (!editingLink) return;
    const result = await renameLinkAction({
      id: editingLink.id,
      version: editingLink.version,
      title: editForm.title.trim(),
    });
    if (!result.ok) {
      toast.show(actionMessage(result));
      return;
    }
    const updated = result.data;
    setLinks((prev) => prev.map((l) => (l.id === editingLink.id ? updated : l)));
    setEditingLink(updated);
    setCreatedLink(updated);
    setEditSaved(true);
    toast.show(`Link ${withoutScheme(updated.shortUrl)} updated`);
  };

  const generateQrFromLink = (link: ShortLink) => {
    setQrType("link");
    setQrLink(link.shortUrl);
    setQrCreated(true);
    toast.show("QR ready — review the QR Generator panel");
  };

  const copyShort = (link: ShortLink) => {
    void navigator.clipboard?.writeText(link.shortUrl);
    toast.show(`Link ${withoutScheme(link.shortUrl)} copied`);
  };

  const goToLink = (link: ShortLink) => {
    window.open(link.shortUrl, "_blank", "noopener,noreferrer");
  };

  const archiveOne = async (link: ShortLink, archived: boolean) => {
    const result = await setLinkArchivedAction({ id: link.id, version: link.version, archived });
    if (!result.ok) {
      toast.show(actionMessage(result));
      return false;
    }
    setLinks((prev) => prev.map((l) => (l.id === link.id ? result.data : l)));
    return true;
  };
  const doDelete = async () => {
    if (!deleteConfirm) return;
    const targets =
      deleteConfirm.kind === "one"
        ? [deleteConfirm.link]
        : links.filter((l) => selected.has(l.id) && !l.archived);
    const archived = deleteConfirm.kind === "many" || !deleteConfirm.link.archived;
    setDeleteConfirm(null);
    let done = 0;
    for (const link of targets) if (await archiveOne(link, archived)) done += 1;
    setSelected(new Set());
    if (done > 0) {
      toast.show(archived ? `${done} link${done === 1 ? "" : "s"} archived` : "Link restored");
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
          <div className="admin-table__title">
            {withoutScheme(r.shortUrl)}
            {r.archived ? " · Archived" : ""}
          </div>
          <div className="admin-table__sub admin-table__sub--redirect">
            <Icon name="cornerDownRight" size={16} />
            <span>{withoutScheme(r.original)}</span>
          </div>
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
          {canEdit ? (
            <Button
              variant="ghost"
              size="icon"
              className="admin-table__delete"
              icon={r.archived ? "undo" : "trash"}
              aria-label={r.archived ? "Restore" : "Archive"}
              onClick={() => deleteLink(r)}
              title={r.archived ? "Restore" : "Archive"}
            />
          ) : null}
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

  const pageNumbers: number[] = [];
  const winStart = Math.max(1, Math.min(safePage - 2, totalPages - 4));
  const winEnd = Math.min(totalPages, winStart + 4);
  for (let i = winStart; i <= winEnd; i++) pageNumbers.push(i);
  const compact = pageNumbers;

  const shownStart = filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const shownEnd = Math.min(safePage * pageSize, filtered.length);

  return (
    <div className="admin-tools">
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Tools</h1>
          <p className="admin-page-header__desc">All PPIDK ASIANIA organizational tools.</p>
        </div>
      </div>

      <div className="admin-tools-grid">
        <Card>
          <CardHeader title={<span className="admin-card__title">QR Generator</span>} />
          <CardBody style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
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
                  Plain text
                </label>
              </div>
            </div>

            {qrType === "link" ? (
              <label className="admin-field">
                <span className="admin-field__label">Link *</span>
                <input
                  className="admin-input"
                  type="url"
                  placeholder="https://"
                  value={qrLink}
                  maxLength={QR_MAX_LENGTH}
                  onChange={(e) => setQrLink(e.target.value)}
                />
              </label>
            ) : (
              <label className="admin-field">
                <span className="admin-field__label">Text</span>
                <textarea
                  className="admin-input admin-textarea"
                  rows={3}
                  placeholder="Type your content here…"
                  value={qrText}
                  maxLength={QR_MAX_LENGTH}
                  onChange={(e) => setQrText(e.target.value)}
                />
              </label>
            )}

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

            <label className="admin-qr-switch">
              <input
                type="checkbox"
                className="admin-qr-switch__input"
                checked={qrLogo}
                onChange={(e) => setQrLogo(e.target.checked)}
              />
              <span className="admin-qr-switch__track" aria-hidden="true" />
              <span className="admin-qr-switch__text">
                <span className="admin-qr-switch__label">Add PPIDK Asiania logo in the centre</span>
                <span className="admin-qr-switch__hint">
                  PNG only (never in the SVG). Turn this off for long content.
                </span>
              </span>
            </label>

            <Button
              variant="primary"
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
                downloadSize={QR_DOWNLOAD_PX[qrSize]}
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

        <Card className="admin-tools-card">
          <CardHeader title={<span className="admin-card__title">URL Shortener</span>} />
          <CardBody className="admin-tools-form">
            {createdLink ? (
              <LinkResultBanner
                title="Short link created"
                link={createdLink}
                onCopy={() => copyShort(createdLink)}
                onVisit={() => goToLink(createdLink)}
                onGenerateQr={() => generateQrFromLink(createdLink)}
              />
            ) : null}

            <label className="admin-field">
              <span className="admin-field__label">Long URL *</span>
              <input
                className="admin-input"
                type="url"
                placeholder="https://example.com/register"
                value={longUrl}
                onChange={(e) => setLongUrl(e.target.value)}
              />
            </label>

            <label className="admin-field">
              <span className="admin-field__label">Title</span>
              <input
                className="admin-input"
                type="text"
                placeholder="Title"
                value={linkTitle}
                onChange={(e) => setLinkTitle(e.target.value)}
              />
            </label>

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
                    placeholder="simkongresppidkasiania"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void generateLink();
                    }}
                  />
                </div>
                <Button
                  variant="primary"
                  icon="link"
                  onClick={() => generateLink()}
                  disabled={!canEdit || busy}
                  style={{ whiteSpace: "nowrap" }}
                >
                  Generate Link
                </Button>
              </div>
            </div>
          </CardBody>

          <CardBody flush>
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
                <input
                  className="admin-searchbox__input"
                  type="search"
                  placeholder="Search by title..."
                  aria-label="Search links"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
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
              <Button variant="danger" icon="trash" onClick={deleteSelected} disabled={!canEdit}>
                Archive
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

            <div className="admin-darkbar">
              <span className="admin-darkbar__info">
                Showing {shownStart}–{shownEnd} of {filtered.length}
              </span>

              <span className="admin-darkbar__info">
                Rows per page
                <Select
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
                </Select>
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

      <Modal
        asForm
        open={editOpen}
        title="Edit Link"
        subtitle="Edit shortened link details."
        onClose={() => {
          setEditOpen(false);
          setEditingLink(null);
          setEditSaved(false);
        }}
        footer={
          <div className="admin-modal__footer-row">
            <Button
              variant="outline"
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
              type="submit"
              variant="primary"
              icon="cloud"
              onClick={() => saveEdit()}
              disabled={editSaved}
            >
              {editSaved ? "Saved" : "Save draft"}
            </Button>
          </div>
        }
      >
        <div className="admin-form-grid">
          <div className="admin-field admin-form-grid__full">
            <label className="admin-field__label" htmlFor="edit-original">
              Long URL *
            </label>
            <input
              id="edit-original"
              className="admin-input"
              type="url"
              placeholder="https://example.com/register"
              value={editForm.original}
              readOnly
            />
          </div>
          <div className="admin-field admin-form-grid__full">
            <label className="admin-field__label" htmlFor="edit-title">
              Title *
            </label>
            <input
              id="edit-title"
              className="admin-input"
              type="text"
              placeholder="Title"
              value={editForm.title}
              onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
            />
          </div>
          <div className="admin-field admin-form-grid__full">
            <span className="admin-field__label">Short URL</span>
            <p>
              {editingLink ? withoutScheme(editingLink.shortUrl) : ""} · Clicks: {editClicks}
            </p>
            <p className="admin-field__hint">
              The address and the short URL cannot change at the provider; archive this link and
              make a new one instead.
            </p>
          </div>

          {editSaved && editingLink ? (
            <div className="admin-form-grid__full">
              <LinkResultBanner
                tone="cream"
                title="Short link updated"
                link={editingLink}
                onCopy={() => copyShort(editingLink)}
                onVisit={() => goToLink(editingLink)}
                onGenerateQr={() => generateQrFromLink(editingLink)}
              />
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={deleteConfirm !== null}
        title={
          deleteConfirm?.kind === "one" && deleteConfirm.link.archived
            ? "Restore link"
            : "Archive link"
        }
        width={420}
        hideClose
        onClose={() => setDeleteConfirm(null)}
        footer={
          <div className="admin-modal__footer-row">
            <Button variant="outline" icon="chevronLeft" onClick={() => setDeleteConfirm(null)}>
              Back
            </Button>
            <Button variant="danger" icon="trash" onClick={() => doDelete()}>
              {deleteConfirm?.kind === "one" && deleteConfirm.link.archived ? "Restore" : "Archive"}
            </Button>
          </div>
        }
      >
        <p className="admin-delete-confirm__message">
          {deleteConfirm?.kind === "many"
            ? `Archive ${deleteConfirm.count} selected link${deleteConfirm.count === 1 ? "" : "s"}? They stop working; their short URLs stay reserved.`
            : deleteConfirm
              ? `${deleteConfirm.link.archived ? "Restore" : "Archive"} "${withoutScheme(deleteConfirm.link.shortUrl)}"?`
              : ""}
        </p>
      </Modal>

      <ToastBanner message={toast.message} />
    </div>
  );
}
