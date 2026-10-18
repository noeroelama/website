"use client";

// Editor toolbar icons are bundled 30×30 PNG tiles (public/Button-*.png): static
// assets with no LCP or bandwidth concern, so plain <img> — not next/image — is
// deliberate here. Kill the rule for the whole file.
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  exportSubscribersAction,
  removeCampaignAction,
  saveCampaignAction,
  sendCampaignAction,
  sendTestAction,
} from "@/app/(panel)/newsletter/actions";
import { actionMessage } from "@/components/action-message";
import { publicImage, useImageUpload } from "@/components/image-upload";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Icon } from "@/components/ui/icon";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import type { CampaignStatus } from "@website/domain/newsletter";
import { formatInZone, timeAgo } from "@/components/format";
import type { CampaignItem as NewsletterItem, SubscriberItem } from "./newsletter-model";
import { Modal } from "@/components/ui/modal";

/** Filter choices for the subscriber "Joined" date select. */
type JoinedFilter = "all" | "today" | "month" | "year";
type CampaignStatusFilter = "all" | CampaignStatus;
type SubscriberStatus = SubscriberItem["status"];

/** Dates on this page: UTC, same text on the server and in the browser. */
const formatDate = (iso: string) => formatInZone(iso, "UTC").split(",")[0] ?? iso;
const formatDateTime = (iso: string) => `${formatInZone(iso, "UTC")} UTC`;

/** Pending delete action shown in the dark confirm modal (one campaign,
    one subscriber, or a selected batch — like the Events/Articles pages). */
type DeleteConfirm = { kind: "campaign"; item: NewsletterItem } | { kind: "many"; count: number };

/* ==================================================================
   Newsletter — campaigns + subscribers. Tabs "Campaign" / "Subscribers"
   swap the table content (list view), plus the create/edit composer
   (form view). Ported from the Figma "NEWSLETTER ADMIN" screens; colours
   come from the shared design
   tokens, no hex values outside globals.css.
   ================================================================== */

const PAGE_SIZE_OPTIONS = [10, 20, 50];

/* ---- Sortable table header: label + arrow (gold when active). Same
        pattern as the Events/Gallery list pages. ---- */
type CampaignSortKey = "subject" | "status" | "recipients" | "sent";
type SubscriberSortKey = "name" | "country" | "subscribed";

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`admin-th-sort${active ? " admin-th-sort--active" : ""}`}
      onClick={onClick}
    >
      <span>{label}</span>
      <Icon name={active ? (dir === "asc" ? "arrowUp" : "arrowDown") : "sort"} size={12} />
    </button>
  );
}

/* ---- Rich-text toolbar chip: one formatting button (keeps focus in the
        editor so commands act on the live selection). Same pattern as the
        article type boxes. ---- */
function EditorButton({
  icon,
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={active ? "admin-editor__btn admin-editor__btn--active" : "admin-editor__btn"}
      aria-label={label}
      aria-pressed={active}
      aria-disabled={disabled}
      title={label}
      disabled={disabled}
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
    >
      {icon}
    </button>
  );
}

/* ==================================================================
   ComposerEditor — the Content Blocks * rich-text area.

   A single black composer card (10-button toolbar + contentEditable
   body), same command set as the article type boxes: alignment cycle,
   image, blockquote, heading 1/2, divider, lists, link popover, code.
   `value` seeds the body once on mount; typed text flows out via
   `onChange` (HTML; the server sanitises it).
   ================================================================== */
function ComposerEditor({
  value,
  onChange,
  readOnly: isReadOnly = false,
  onAdd,
  onDelete,
  canDelete = false,
  isDragOver = false,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  uploadImage,
}: {
  value: string;
  onChange: (text: string) => void;
  /** Uploads an inline image (preset "newsletter"); resolves to its public URL. */
  uploadImage: (file: File) => Promise<string | null>;
  /** When true the composer is review-only: toolbar disabled and the body
      not editable (used for sent campaigns opened from the list). */
  readOnly?: boolean;
  /** Article-style type-box controls: the + adds a new box below this one,
      the drag handle reorders, and (when more than one box exists) a trash
      button removes this box. Hidden entirely in read-only mode. */
  onAdd?: () => void;
  onDelete?: () => void;
  canDelete?: boolean;
  isDragOver?: boolean;
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const editorImageInputRef = useRef<HTMLInputElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const editorSeededRef = useRef(false);
  const [alignCycle, setAlignCycle] = useState<number>(0);
  const [activeCmds, setActiveCmds] = useState<string[]>([]);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkPos, setLinkPos] = useState<{ top: number; left: number } | null>(null);

  /* Seed the body with the initial value exactly once (edit prefill). */
  useEffect(() => {
    const el = editorRef.current;
    if (el && !editorSeededRef.current && value) {
      el.innerHTML = value;
      editorSeededRef.current = true;
    }
  }, [value]);

  const saveRange = () => {
    const sel = document.getSelection();
    if (sel && sel.rangeCount > 0) savedRangeRef.current = sel.getRangeAt(0).cloneRange();
  };

  const restoreRange = () => {
    const el = editorRef.current;
    if (!el || !savedRangeRef.current) return;
    el.focus();
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(savedRangeRef.current);
  };

  const syncEditorText = () => {
    const el = editorRef.current;
    if (el) onChange(el.innerHTML);
  };

  const onEditorInput = () => syncEditorText();
  const onEditorBlur = () => saveRange();

  const selectionInEditor = () => {
    const el = editorRef.current;
    const sel = document.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return false;
    const node = sel.getRangeAt(0).startContainer;
    return node === el || el.contains(node);
  };

  const ensureCaret = () => {
    const el = editorRef.current;
    const sel = document.getSelection();
    if (!el || !sel) return;
    if (selectionInEditor()) return;
    if (savedRangeRef.current && el.contains(savedRangeRef.current.startContainer)) {
      restoreRange();
      return;
    }
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    savedRangeRef.current = r.cloneRange();
  };

  const exec = (cmd: string, arg?: string) => {
    ensureCaret();
    try {
      document.execCommand(cmd, false, arg);
    } catch {
      /* stale restored range — the live selection still applies */
    }
    syncEditorText();
    editorRef.current?.focus();
    setTimeout(refreshActive, 0);
  };

  const BLOCK_TAGS = ["DIV", "P", "H1", "H2", "H3", "BLOCKQUOTE", "PRE", "LI"];
  const nearestBlock = (node: Node | null): HTMLElement | null => {
    const el = editorRef.current;
    if (node && node.nodeType === Node.TEXT_NODE) node = node.parentNode;
    while (node && node !== el && node instanceof HTMLElement) {
      if (BLOCK_TAGS.includes(node.tagName.toUpperCase())) return node;
      node = node.parentNode;
    }
    return null;
  };

  const insideTag = (node: Node | null, tag: string): HTMLElement | null => {
    const el = editorRef.current;
    if (node && node.nodeType === Node.TEXT_NODE) node = node.parentNode;
    while (node && node !== el) {
      if (node instanceof HTMLElement && node.tagName.toUpperCase() === tag) return node;
      node = node.parentNode;
    }
    return null;
  };

  const ALIGN_ORDER = ["alignLeft", "alignCenter", "alignRight", "alignJustify"] as const;
  type AlignCmd = (typeof ALIGN_ORDER)[number];
  const alignToCmd: Record<AlignCmd, string> = {
    alignLeft: "justifyLeft",
    alignCenter: "justifyCenter",
    alignRight: "justifyRight",
    alignJustify: "justifyFull",
  };
  const alignToTile: Record<AlignCmd, string> = {
    alignLeft: "/Button-align-left.png",
    alignCenter: "/Button-align-center.png",
    alignRight: "/Button-align-right.png",
    alignJustify: "/Button-align-justify.png",
  };

  const activeAlign = (): AlignCmd | null => {
    try {
      if (document.queryCommandState("justifyLeft")) return "alignLeft";
      if (document.queryCommandState("justifyCenter")) return "alignCenter";
      if (document.queryCommandState("justifyRight")) return "alignRight";
      if (document.queryCommandState("justifyFull")) return "alignJustify";
    } catch {
      /* keep null — default state */
    }
    return null;
  };

  const detectActive = (): string[] => {
    const sel = document.getSelection();
    const list: string[] = [];
    try {
      if (document.queryCommandState("insertUnorderedList")) list.push("bullet");
      if (document.queryCommandState("insertOrderedList")) list.push("number");
      const block = nearestBlock(sel?.anchorNode ?? null)?.tagName.toUpperCase();
      if (block === "H1") list.push("h1");
      else if (block === "H2") list.push("h2");
      else if (block === "BLOCKQUOTE") list.push("comment");
      if (insideTag(sel?.anchorNode ?? null, "CODE")) list.push("code");
      if (insideTag(sel?.anchorNode ?? null, "A")) list.push("link");
    } catch {
      /* some browsers reject the query commands — keep everything inactive */
    }
    return list;
  };

  const onEditorSelect = () => {
    refreshActive();
    saveRange();
  };

  const refreshActive = () => {
    const el = editorRef.current;
    const sel = document.getSelection();
    if (!el || !sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return;
    setActiveCmds(detectActive());
    const align = activeAlign();
    if (align) setAlignCycle(ALIGN_ORDER.indexOf(align));
  };

  const unwrapElement = (node: HTMLElement) => {
    while (node.firstChild) node.parentNode?.insertBefore(node.firstChild, node);
    node.parentNode?.removeChild(node);
  };

  const placeCaret = (r: Range) => {
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
    savedRangeRef.current = r.cloneRange();
    syncEditorText();
    setTimeout(refreshActive, 0);
  };

  const BLOCK_WRAPS = ["H1", "H2", "BLOCKQUOTE"];
  const insideBlockWrap = (node: Node | null): HTMLElement | null => {
    const el = editorRef.current;
    if (node && node.nodeType === Node.TEXT_NODE) node = node.parentNode;
    while (node && node !== el) {
      if (node instanceof HTMLElement && BLOCK_WRAPS.includes(node.tagName.toUpperCase()))
        return node;
      node = node.parentNode;
    }
    return null;
  };

  const applyWrapFormat = (tag: "H1" | "H2" | "BLOCKQUOTE" | "CODE") => {
    const el = editorRef.current;
    ensureCaret();
    const sel = document.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return;
    const anchor = sel.anchorNode ?? sel.getRangeAt(0).startContainer;
    const existing = insideTag(anchor, tag);
    if (existing) {
      const r = document.createRange();
      if (existing.previousSibling) r.setStartAfter(existing.previousSibling);
      else r.setStart(existing.parentNode ?? el, 0);
      r.collapse(true);
      unwrapElement(existing);
      placeCaret(r);
      return;
    }
    const other = BLOCK_WRAPS.includes(tag) ? insideBlockWrap(anchor) : null;
    if (other) {
      const keep = Array.from(other.childNodes);
      const wrap = document.createElement(tag);
      keep.forEach((n) => wrap.appendChild(n));
      other.parentNode?.replaceChild(wrap, other);
      const r = document.createRange();
      r.selectNodeContents(wrap);
      r.collapse(false);
      placeCaret(r);
      return;
    }
    const range = sel.getRangeAt(0);
    if (range.collapsed) {
      const wrap = document.createElement(tag);
      range.insertNode(wrap);
      const r = document.createRange();
      r.selectNodeContents(wrap);
      r.collapse(false);
      placeCaret(r);
      return;
    }
    const contents = range.extractContents();
    const wrap = document.createElement(tag);
    wrap.appendChild(contents);
    range.insertNode(wrap);
    const r = document.createRange();
    r.selectNodeContents(wrap);
    placeCaret(r);
  };

  const normalizeLink = (raw: string): string => {
    const t = raw.trim();
    if (!t) return t;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(t)) return t;
    return `https://${t}`;
  };

  const openLinkModal = () => {
    const el = editorRef.current;
    if (!el) return;
    ensureCaret();
    const sel = document.getSelection();
    const text = sel && sel.rangeCount > 0 ? sel.toString() : "";
    setLinkText(text);
    setLinkUrl("");
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      setLinkPos({ top: rect.bottom + 12, left: Math.max(8, rect.left) });
    } else {
      const rect = el.getBoundingClientRect();
      setLinkPos({ top: rect.top + 28, left: Math.max(8, rect.left) });
    }
    setLinkOpen(true);
  };

  const applyLink = () => {
    if (!linkUrl.trim()) {
      setLinkOpen(false);
      return;
    }
    exec("createLink", normalizeLink(linkUrl));
    setLinkOpen(false);
    refreshActive();
  };

  const runCommand = (cmd: string) => {
    switch (cmd) {
      case "alignCycle": {
        const next = ALIGN_ORDER[(alignCycle + 1) % ALIGN_ORDER.length]!;
        exec(alignToCmd[next]);
        break;
      }
      case "image":
        editorImageInputRef.current?.click();
        break;
      case "comment":
        applyWrapFormat("BLOCKQUOTE");
        break;
      case "h1":
        applyWrapFormat("H1");
        break;
      case "h2":
        applyWrapFormat("H2");
        break;
      case "divider":
        exec("insertHorizontalRule");
        break;
      case "bullet":
        exec("insertUnorderedList");
        break;
      case "number":
        exec("insertOrderedList");
        break;
      case "link":
        if (insideTag(document.getSelection()?.anchorNode ?? null, "A")) {
          const el = editorRef.current;
          ensureCaret();
          const sel = document.getSelection();
          if (!el || !sel || sel.rangeCount === 0) break;
          const existing = insideTag(sel.anchorNode ?? sel.getRangeAt(0).startContainer, "A");
          if (existing) {
            const r = document.createRange();
            if (existing.previousSibling) r.setStartAfter(existing.previousSibling);
            else r.setStart(existing.parentNode ?? el, 0);
            r.collapse(true);
            unwrapElement(existing);
            placeCaret(r);
          }
        } else {
          openLinkModal();
        }
        break;
      case "code":
        applyWrapFormat("CODE");
        break;
      default:
        break;
    }
  };

  return (
    <div
      className={isDragOver ? "admin-editor admin-editor--drag-over" : "admin-editor"}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* A strip above the format chips: a plus that adds a NEW type box
          below this one, a drag handle that reorders it, and — when more
          than one box exists — a trash button that removes this box.
          Read-only campaigns show the composer without the strip. */}
      {!isReadOnly ? (
        <div className="admin-editor__top">
          <button
            type="button"
            className="admin-editor__top-btn"
            aria-label="Add a type box"
            title="Add a type box"
            onClick={onAdd}
          >
            <Icon name="plus" size={16} />
          </button>
          <span
            className="admin-editor__top-drag"
            draggable
            role="img"
            aria-label="Drag handle"
            title="Drag to reorder"
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          >
            <Icon name="gripBold" size={16} />
          </span>
          {canDelete && (
            <button
              type="button"
              className="admin-editor__top-btn admin-editor__top-btn--danger"
              aria-label="Delete this type box"
              title="Delete this type box"
              onClick={onDelete}
            >
              <Icon name="trash" size={16} />
            </button>
          )}
        </div>
      ) : null}
      <div className="admin-editor__toolbar" role="toolbar" aria-label="Formatting">
        <EditorButton
          icon={
            <img
              src={alignToTile[ALIGN_ORDER[alignCycle]!]}
              alt=""
              className="admin-editor__btn-img"
            />
          }
          label={`Align ${ALIGN_ORDER[alignCycle]!.replace("align", "").toLowerCase()}`}
          active={alignCycle > 0}
          disabled={isReadOnly}
          onClick={() => runCommand("alignCycle")}
        />
        <EditorButton
          icon={<img src="/Button-1.png" alt="" className="admin-editor__btn-img" />}
          label="Insert image"
          disabled={isReadOnly}
          onClick={() => runCommand("image")}
        />
        <EditorButton
          icon={<img src="/Button-2.png" alt="" className="admin-editor__btn-img" />}
          label="Comment"
          active={activeCmds.includes("comment")}
          disabled={isReadOnly}
          onClick={() => runCommand("comment")}
        />
        <EditorButton
          icon={<img src="/Button-3.png" alt="" className="admin-editor__btn-img" />}
          label="Heading 1"
          active={activeCmds.includes("h1")}
          disabled={isReadOnly}
          onClick={() => runCommand("h1")}
        />
        <EditorButton
          icon={<img src="/Button-4.png" alt="" className="admin-editor__btn-img" />}
          label="Heading 2"
          active={activeCmds.includes("h2")}
          disabled={isReadOnly}
          onClick={() => runCommand("h2")}
        />
        <EditorButton
          icon={<img src="/Button-5.png" alt="" className="admin-editor__btn-img" />}
          label="Divider"
          disabled={isReadOnly}
          onClick={() => runCommand("divider")}
        />
        <EditorButton
          icon={<img src="/Button-6.png" alt="" className="admin-editor__btn-img" />}
          label="Bullet list"
          active={activeCmds.includes("bullet")}
          disabled={isReadOnly}
          onClick={() => runCommand("bullet")}
        />
        <EditorButton
          icon={<img src="/Button-7.png" alt="" className="admin-editor__btn-img" />}
          label="Numbered list"
          active={activeCmds.includes("number")}
          disabled={isReadOnly}
          onClick={() => runCommand("number")}
        />
        <EditorButton
          icon={<img src="/Button-8.png" alt="" className="admin-editor__btn-img" />}
          label="Link"
          active={activeCmds.includes("link")}
          disabled={isReadOnly}
          onClick={() => runCommand("link")}
        />
        <EditorButton
          icon={<img src="/Button-9.png" alt="" className="admin-editor__btn-img" />}
          label="Code"
          active={activeCmds.includes("code")}
          disabled={isReadOnly}
          onClick={() => runCommand("code")}
        />
      </div>
      <input
        ref={editorImageInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          /* uploaded first: the campaign stores the https URL, never a data URL */
          void uploadImage(file).then((url) => {
            if (url) exec("insertImage", url);
          });
        }}
      />
      <div
        ref={editorRef}
        className="admin-editor__body"
        contentEditable={isReadOnly ? "false" : "true"}
        role="textbox"
        aria-multiline="true"
        aria-label="Campaign content"
        onInput={onEditorInput}
        onBlur={onEditorBlur}
        onKeyUp={onEditorSelect}
        onClick={onEditorSelect}
        onSelect={onEditorSelect}
      />

      {linkOpen && linkPos ? (
        <div
          role="dialog"
          aria-label="Insert link"
          className="admin-link-pop"
          style={{ top: linkPos.top, left: linkPos.left }}
        >
          <label className="admin-link-pop__label" htmlFor="nw-link-text">
            Text
          </label>
          <input
            id="nw-link-text"
            className="admin-input admin-input--dark"
            type="text"
            placeholder="Link text"
            value={linkText}
            onChange={(e) => setLinkText(e.target.value)}
          />
          <label className="admin-link-pop__label" htmlFor="nw-link-url">
            Hyperlink
          </label>
          <input
            id="nw-link-url"
            className="admin-input admin-input--dark"
            type="url"
            placeholder="https://example.com"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyLink();
              if (e.key === "Escape") setLinkOpen(false);
            }}
          />
          <button type="button" className="admin-link-pop__apply" onClick={applyLink}>
            Apply
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** One Content Blocks "type box": a single composer card (top strip +/drag,
    toolbar, black body). The + button adds a box below; the drag handle
    reorders them — the same box model as the article form. */
interface EditorBox {
  id: string;
  text: string;
}

/** Form shape for create/edit. */
interface NewsletterForm {
  subject: string;
  bodies: EditorBox[];
}

const EMPTY_FORM: NewsletterForm = {
  subject: "",
  bodies: [{ id: "box-0", text: "" }],
};

/** Fresh id for a new type box (monotonic, no collisions while the form lives). */
let BOX_SEQ = 1;
const nextBoxId = () => `box-${BOX_SEQ++}`;

/* ==================================================================
   NewsletterPage — the page itself: campaigns list + composer form.
   ================================================================== */
interface NewsletterProps {
  /** Rows from the server (src/app/(panel)/newsletter/page.tsx); refreshed after every change. */
  campaigns: NewsletterItem[];
  /** Subscribers; addresses arrive masked unless the viewer has newsletter.edit. */
  subscribers: SubscriberItem[];
  canEdit: boolean;
  canSend: boolean;
  canExport: boolean;
}

export function NewsletterPage(props: NewsletterProps) {
  const pathname = usePathname();
  // key={pathname} remounts the page when the newsletter route is (re)entered,
  // so search/tab/filter state resets on every visit (same pattern as
  // Events / Articles / Gallery).
  return <NewsletterList key={pathname} {...props} />;
}

/** Newsletter list + composer form (all state lives here; remounted by
 *  NewsletterPage on navigation so it starts clean). */
function NewsletterList({ campaigns, subscribers, canEdit, canSend, canExport }: NewsletterProps) {
  const toast = useToastMessage();
  const router = useRouter();
  const upload = useImageUpload("newsletter");
  const [busy, setBusy] = useState(false);
  /* Send / schedule popup: which campaign, and the chosen time (datetime-local, viewer zone). */
  const [sendFor, setSendFor] = useState<NewsletterItem | null>(null);
  const [sendAt, setSendAt] = useState("");
  const [previewFor, setPreviewFor] = useState<NewsletterItem | null>(null);
  const [view, setView] = useState<"list" | "form">("list");
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<NewsletterForm>(EMPTY_FORM);

  const [tab, setTab] = useState<"campaign" | "subscriber">("campaign");
  const [statusFilter, setStatusFilter] = useState<CampaignStatusFilter>("all");
  const [subStatusFilter, setSubStatusFilter] = useState<"all" | SubscriberStatus>("all");
  const [joinedFilter, setJoinedFilter] = useState<JoinedFilter>("all");
  const [subFiltersOpen, setSubFiltersOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortKey, setSortKey] = useState<CampaignSortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null);
  /* Type-box drag state: which box is being dragged and which it hovers over
     (mirrors the article form's reorder). */
  const [dragSource, setDragSource] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const isCampaign = tab === "campaign";

  /* ---- header sort: first click on a column = asc, same column toggles asc ↔ desc ---- */
  const onSort = (key: CampaignSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortValue = (c: NewsletterItem, key: CampaignSortKey): string | number => {
    switch (key) {
      case "subject":
        return c.subject.toLowerCase();
      case "status":
        return c.status;
      case "recipients":
        return c.sentCount;
      case "sent":
        return c.sentAt ?? c.sendAt ?? "9999-99-99";
    }
  };

  /* ---- the subscribers table sorts independently (Subscriber / PPI
          Country / Joined), same first-click-asc toggle logic ---- */
  const [subSortKey, setSubSortKey] = useState<SubscriberSortKey | null>(null);
  const [subSortDir, setSubSortDir] = useState<"asc" | "desc">("asc");

  const onSubSort = (key: SubscriberSortKey) => {
    if (subSortKey === key) {
      setSubSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSubSortKey(key);
      setSubSortDir("asc");
    }
  };

  const subSortValue = (s: SubscriberItem, key: SubscriberSortKey): string | number => {
    switch (key) {
      case "name":
        return s.email.toLowerCase();
      case "country":
        return s.status;
      case "subscribed":
        return s.subscribed;
    }
  };

  /* ---- derived lists (one per table; `filtered` follows the active tab) ---- */
  const filteredCampaigns = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = campaigns.filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (q && !c.subject.toLowerCase().includes(q)) return false;
      return true;
    });
    if (!sortKey) return list;
    const copy = [...list];
    copy.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      const cmp =
        typeof av === "number" && typeof bv === "number" ? av - bv : av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [campaigns, statusFilter, query, sortKey, sortDir]);

  const filteredSubs = useMemo(() => {
    const q = query.trim().toLowerCase();
    /* Same date-anchor approach as the events page: compare the ISO
       subscribed date against "today" (YYYY-MM-DD). */
    const today = new Date().toISOString().slice(0, 10);
    const list = subscribers.filter((s) => {
      if (subStatusFilter !== "all" && s.status !== subStatusFilter) return false;
      if (joinedFilter === "today" && s.subscribed !== today) return false;
      if (joinedFilter === "month" && !s.subscribed.startsWith(today.slice(0, 7))) return false;
      if (joinedFilter === "year" && !s.subscribed.startsWith(today.slice(0, 4))) return false;
      if (q && !s.email.toLowerCase().includes(q)) return false;
      return true;
    });
    if (!subSortKey) return list;
    const copy = [...list];
    copy.sort((a, b) => {
      const av = subSortValue(a, subSortKey);
      const bv = subSortValue(b, subSortKey);
      const cmp =
        typeof av === "number" && typeof bv === "number" ? av - bv : av < bv ? -1 : av > bv ? 1 : 0;
      return subSortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [subscribers, subStatusFilter, joinedFilter, query, subSortKey, subSortDir]);

  const filtered = isCampaign ? filteredCampaigns : filteredSubs;

  const counts = useMemo(
    () => ({ campaign: campaigns.length, subscriber: subscribers.length }),
    [campaigns, subscribers],
  );

  const activeFilterCount =
    (isCampaign ? (statusFilter !== "all" ? 1 : 0) : subStatusFilter !== "all" ? 1 : 0) +
    (query.trim() ? 1 : 0);
  /* Badge count for the Subscribers "Filters" toggle — panel filters only
     (status / PPI country / joined date), same as the events page (search
     is separate). */
  const subActiveFilterCount =
    (subStatusFilter !== "all" ? 1 : 0) + (joinedFilter !== "all" ? 1 : 0);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  // Typed slices per tab — the DataTable generic is inferred from `columns`,
  // so the union `pageRows` cannot be passed straight to either table.
  const pageCampaignRows = filteredCampaigns.slice((safePage - 1) * pageSize, safePage * pageSize);
  const pageSubRows = filteredSubs.slice((safePage - 1) * pageSize, safePage * pageSize);

  const shownStart = filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const shownEnd = Math.min(safePage * pageSize, filtered.length);

  const pageNumbers: number[] = [];
  const winStart = Math.max(1, Math.min(safePage - 2, totalPages - 4));
  const winEnd = Math.min(totalPages, winStart + 4);
  for (let i = winStart; i <= winEnd; i++) pageNumbers.push(i);

  /* ---- selection helpers ---- */
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pageSelected = pageRows.every((r) => selected.has(r.id));
  const pageSomeSelected = pageRows.some((r) => selected.has(r.id));

  const togglePage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (pageSelected) pageRows.forEach((r) => next.delete(r.id));
      else pageRows.forEach((r) => next.add(r.id));
      return next;
    });
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));

  const selectAllFiltered = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filtered.forEach((r) => next.delete(r.id));
      else filtered.forEach((r) => next.add(r.id));
      return next;
    });
  };

  const switchTab = (next: "campaign" | "subscriber") => {
    setTab(next);
    setPage(1);
    setSelected(new Set());
    setMenuFor(null);
    /* Each tab is its own list — clear the shared search state so the
       searchbox starts fresh (same as opening the events/articles pages). */
    setSearch("");
    setQuery("");
  };

  const clearFilters = () => {
    setQuery("");
    setSearch("");
    setStatusFilter("all");
    setSubStatusFilter("all");
    setJoinedFilter("all");
    setSubFiltersOpen(false);
    setPage(1);
    setMenuFor(null);
  };

  /* ---- mutations (server actions; the page re-reads after each) ---- */
  type Failure = Parameters<typeof actionMessage>[0];
  const changeable = (c: NewsletterItem) => c.status === "draft" || c.status === "scheduled";

  const deleteCampaign = (c: NewsletterItem) => {
    setMenuFor(null);
    setDeleteConfirm({ kind: "campaign", item: c });
  };

  const deleteSelected = () => {
    if (selected.size === 0) {
      toast.show("Select campaigns to delete");
      return;
    }
    setDeleteConfirm({ kind: "many", count: selected.size });
  };

  /* Soft delete; drafts and scheduled campaigns only (the server refuses the rest). */
  const doDelete = async () => {
    if (!deleteConfirm) return;
    const rows =
      deleteConfirm.kind === "campaign"
        ? [deleteConfirm.item]
        : campaigns.filter((c) => selected.has(c.id));
    setDeleteConfirm(null);
    setBusy(true);
    let failure: Failure | null = null;
    for (const c of rows) {
      const result = await removeCampaignAction({ id: c.id, version: c.version });
      if (!result.ok) {
        failure = result;
        break;
      }
    }
    setBusy(false);
    setSelected(new Set());
    setMenuFor(null);
    router.refresh();
    toast.show(failure ? actionMessage(failure) : "Deleted");
  };

  /* Export CSV (newsletter.export): built on the server, logged as a security event. */
  const exportCsv = async () => {
    const result = await exportSubscribersAction();
    if (!result.ok) {
      toast.show(actionMessage(result));
      return;
    }
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + result.data.csv + "\r\n"], { type: "text/csv;charset=utf-8;" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.show(`Exported ${subscribers.length} subscribers`);
  };

  /* Send now (empty time) or schedule (newsletter.send); audited SEND. */
  const doSend = async () => {
    if (!sendFor) return;
    setBusy(true);
    const result = await sendCampaignAction({
      id: sendFor.id,
      version: sendFor.version,
      sendAt: sendAt ? new Date(sendAt).toISOString() : null,
    });
    setBusy(false);
    if (!result.ok) {
      toast.show(actionMessage(result));
      return;
    }
    setSendFor(null);
    setSendAt("");
    setView("list");
    router.refresh();
    toast.show(result.data.status === "scheduled" ? "Campaign scheduled" : "Sending started");
  };

  /* ---- form ---- */
  const toForm = (mode: "create" | "edit", item?: NewsletterItem) => {
    setFormMode(mode);
    setEditingId(item?.id ?? null);
    setForm(
      item ? { subject: item.subject, bodies: [{ id: nextBoxId(), text: item.body }] } : EMPTY_FORM,
    );
    setSelected(new Set());
    setView("form");
  };

  /* ---- content blocks: add, edit, reorder ---- */
  /* The campaign body is a stack of composer boxes. Each box edits its own
     HTML in form.bodies; the + button inserts a fresh empty box right below
     the one it was pressed on. */
  const addBoxAfter = (index: number) => {
    setForm((f) => {
      const bodies = [...f.bodies];
      bodies.splice(index + 1, 0, { id: nextBoxId(), text: "" });
      return { ...f, bodies };
    });
  };

  const updateBox = (index: number, text: string) => {
    setForm((f) => {
      if (f.bodies[index]?.text === text) return f;
      const bodies = f.bodies.map((b, i) => (i === index ? { ...b, text } : b));
      return { ...f, bodies };
    });
  };

  /* Remove a type box (the last one stays). */
  const removeBox = (index: number) => {
    setForm((f) => {
      if (f.bodies.length <= 1) return f;
      const bodies = f.bodies.filter((_, i) => i !== index);
      return { ...f, bodies };
    });
  };

  const moveBox = (from: number, to: number) => {
    if (from === to) return;
    setForm((f) => {
      const bodies = [...f.bodies];
      const [moved] = bodies.splice(from, 1);
      if (!moved) return f;
      bodies.splice(to, 0, moved);
      return { ...f, bodies };
    });
  };

  /* Save draft (newsletter.edit). Returns the saved row's id and version, or null. */
  const saveDraft = async (): Promise<{ id: string; version: number } | null> => {
    const current = campaigns.find((c) => c.id === editingId);
    setBusy(true);
    const result = await saveCampaignAction({
      ...(editingId ? { id: editingId } : {}),
      version: current?.version ?? null,
      subject: form.subject,
      body: form.bodies.map((b) => b.text).join(""),
      segment: "all",
    });
    setBusy(false);
    if (!result.ok) {
      toast.show(actionMessage(result));
      return null;
    }
    setEditingId(result.data.id);
    router.refresh();
    return result.data;
  };

  const saveAndClose = async () => {
    if (await saveDraft()) {
      toast.show("Draft saved");
      setView("list");
    }
  };

  /* Publish = save, then open the send / schedule popup for the saved version. */
  const publishCampaign = async () => {
    const saved = await saveDraft();
    if (!saved) return;
    setSendFor({
      id: saved.id,
      version: saved.version,
      subject: form.subject,
      body: "",
      status: "draft",
      sendAt: null,
      sentAt: null,
      sentCount: 0,
      modifiedAt: new Date().toISOString(),
    });
  };

  /* Send Test: saves, then mails the saved campaign to your own address only. */
  const sendTest = async () => {
    const saved = await saveDraft();
    if (!saved) return;
    const result = await sendTestAction({ id: saved.id });
    toast.show(result.ok ? "Test e-mail sent to your address" : actionMessage(result));
  };

  const uploadImage = async (file: File) => {
    const image = await upload.upload(file);
    if (!image) toast.show(upload.error ?? "Upload failed");
    return image ? (publicImage(image)?.url ?? null) : null;
  };

  /* ---- table columns ---- */
  /* Shared select-all checkbox column — one factory so both tables get the
     same header, only the per-row aria-label differs. The subscribers table
     passes 14px (fixed layout) so the checkbox sits flush like the campaign
     table's auto-layout 30px cell. */
  const makeCheckboxCol = <T extends { id: string }>(
    label: (item: T) => string,
    width = "24px",
  ): Column<T> => ({
    key: "check",
    width,
    align: "left",
    header: (
      <label className="admin-checkbox">
        <input
          type="checkbox"
          aria-label="Select all on page"
          checked={pageSelected}
          ref={(el) => {
            if (el) el.indeterminate = pageSomeSelected && !pageSelected;
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
          aria-label={label(r)}
          checked={selected.has(r.id)}
          onChange={() => toggleSelect(r.id)}
          className="admin-table__checkbox"
        />
        <span aria-hidden="true" />
      </label>
    ),
  });

  const checkboxCol = makeCheckboxCol<NewsletterItem>((r) => `Select ${r.subject}`, "3%");

  const columns: Column<NewsletterItem>[] = [
    checkboxCol,
    {
      key: "subject",
      header: (
        <SortHeader
          label="Campaign"
          active={sortKey === "subject"}
          dir={sortDir}
          onClick={() => onSort("subject")}
        />
      ),
      width: "30%",
      render: (r) => (
        <div>
          <div className="admin-table__title">{r.subject}</div>
          <div className="admin-table__sub admin-table__sub--logo">
            <span className="admin-table__sub-logo" aria-hidden="true" />
            <span className="admin-table__sub-text">All confirmed subscribers</span>
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: (
        <SortHeader
          label="Status"
          active={sortKey === "status"}
          dir={sortDir}
          onClick={() => onSort("status")}
        />
      ),
      width: "10%",
      render: (r) => (
        <span className={`admin-newsletter-badge admin-newsletter-badge--${r.status}`}>
          {r.status === "sent" ? (
            <Icon name="check" size={11} />
          ) : r.status === "draft" ? (
            <Icon name="dot" size={12} />
          ) : (
            <Icon name="clock" size={11} />
          )}
          {r.status === "sent"
            ? "Sent"
            : r.status === "sending"
              ? "Sending"
              : r.status === "scheduled"
                ? "Scheduled"
                : "Draft"}
        </span>
      ),
    },
    {
      key: "recipients",
      header: (
        <SortHeader
          label="Recipients"
          active={sortKey === "recipients"}
          dir={sortDir}
          onClick={() => onSort("recipients")}
        />
      ),
      width: "9%",
      align: "right",
      render: (r) => (
        /* Same class as the Open/Click rate cells so font + style always match,
           including the "—" placeholder on draft rows. */
        <span className="admin-newsletter-rate">{r.status === "draft" ? "—" : r.sentCount}</span>
      ),
    },
    {
      key: "sent",
      header: (
        <SortHeader
          label="Sent"
          active={sortKey === "sent"}
          dir={sortDir}
          onClick={() => onSort("sent")}
        />
      ),
      width: "12%",
      render: (r) => {
        /* Date-only for sent + draft; scheduled keeps its send time too. */
        const when =
          r.status === "sent" ? r.sentAt : r.status === "draft" ? r.modifiedAt : r.sendAt;
        return when ? (
          <span className="admin-event-meta">
            <span
              className={`admin-table__title${
                r.status === "scheduled" ? " admin-event-date--scheduled" : ""
              }`}
            >
              {r.status === "scheduled" ? formatDateTime(when) : formatDate(when)}
            </span>
          </span>
        ) : (
          <span className="admin-table__muted">—</span>
        );
      },
    },
    {
      key: "aksi",
      header: "",
      align: "right",
      width: "10%",
      render: (r) => (
        <div className="admin-table__actions">
          {/* Sent campaigns can still be opened for review — the form renders
              that campaign read-only. Draft/scheduled rows open the editable
              composer; both are plain-icon buttons (no label). */}
          {!changeable(r) || !canEdit ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open"
              onClick={() => toForm("edit", r)}
              title="Open (read only)"
            >
              {/* Same bar glyph as the "Avg. click rate · last 5" KPI card
                  (chart.png). Here it sits on a dark row, so the PNG's own
                  cream ink shows as-is — no invert filter. */}
              <img src="/chart.png" width={14} height={14} alt="" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              icon="edit"
              aria-label="Edit"
              title="Edit"
              onClick={() => toForm("edit", r)}
            />
          )}
          <div className="admin-row-menu">
            {menuFor === r.id ? (
              <div className="admin-row-menu__backdrop" onClick={() => setMenuFor(null)} />
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              icon="more"
              aria-label="More actions"
              title="More actions"
              onClick={() => setMenuFor(menuFor === r.id ? null : r.id)}
            />
            {menuFor === r.id ? (
              <div className="admin-row-menu__panel" role="menu">
                {canSend ? (
                  <button
                    type="button"
                    className="admin-row-menu__item"
                    role="menuitem"
                    disabled={!changeable(r) || busy}
                    onClick={() => {
                      setMenuFor(null);
                      setSendFor(r);
                    }}
                  >
                    <Icon name="send" size={14} /> Send / Schedule…
                  </button>
                ) : null}
                <button
                  type="button"
                  className="admin-row-menu__item"
                  role="menuitem"
                  onClick={() => {
                    setMenuFor(null);
                    setPreviewFor(r);
                  }}
                >
                  <Icon name="eye" size={14} /> Preview
                </button>
                {/* Divider above the destructive action, separating Delete from the rest. */}
                <div className="admin-row-menu__divider" role="separator" />
                <button
                  type="button"
                  className="admin-row-menu__item admin-row-menu__item--danger"
                  role="menuitem"
                  disabled={!canEdit || !changeable(r)}
                  onClick={() => deleteCampaign(r)}
                >
                  <Icon name="trash" size={14} /> Delete Campaign
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ),
    },
  ];

  /* Subscribers table — Figma columns: Subscriber (name+email, email carries
     the users logo like the Active-subscribers KPI), PPI Country, Joined
     (subscription date), row delete. All three data columns are sortable. */
  const subscriberColumns: Column<SubscriberItem>[] = [
    {
      key: "name",
      header: (
        <SortHeader
          label="Subscribers"
          active={subSortKey === "name"}
          dir={subSortDir}
          onClick={() => onSubSort("name")}
        />
      ),
      width: "33%",
      render: (r) => (
        <div>
          <div className="admin-table__sub admin-table__sub--logo">
            {/* Same users glyph as the "Active subscribers" KPI, repainted in
                the email's ink (PNG is maroon; CSS paints it via alpha mask). */}
            <span className="admin-table__sub-logo" aria-hidden="true" />
            <span className="admin-table__sub-text">{r.email}</span>
          </div>
        </div>
      ),
    },
    {
      key: "country",
      header: (
        <SortHeader
          label="Status"
          active={subSortKey === "country"}
          dir={subSortDir}
          onClick={() => onSubSort("country")}
        />
      ),
      width: "26%",
      render: (r) => <span>{r.status}</span>,
    },
    {
      key: "subscribed",
      header: (
        <SortHeader
          label="Joined"
          active={subSortKey === "subscribed"}
          dir={subSortDir}
          onClick={() => onSubSort("subscribed")}
        />
      ),
      width: "20%",
      render: (r) => (
        <span className="admin-event-meta">
          <span className="admin-table__title">{formatDate(r.subscribed)}</span>
          <span className="admin-table__sub">{timeAgo(r.subscribed)}</span>
        </span>
      ),
    },
  ];

  /* Send / schedule popup (also opened by Publish in the form). */
  const sendModal = (
    <Modal
      open={sendFor !== null}
      title={sendFor ? `Send "${sendFor.subject}"` : "Send"}
      width={440}
      onClose={() => setSendFor(null)}
      footer={
        <div className="admin-modal__footer-row admin-modal__footer-row--end">
          <Button variant="ghost" onClick={() => setSendFor(null)}>
            Cancel
          </Button>
          <Button variant="primary" icon="send" disabled={busy} onClick={() => void doSend()}>
            {sendAt ? "Schedule" : "Send now"}
          </Button>
        </div>
      }
    >
      <div className="admin-field">
        <label className="admin-field__label" htmlFor="campaign-send-at">
          Send at (your time zone; empty = now)
        </label>
        <input
          id="campaign-send-at"
          className="admin-input"
          type="datetime-local"
          value={sendAt}
          onChange={(e) => setSendAt(e.target.value)}
        />
        <p className="admin-card__subtitle">
          Goes to every confirmed subscriber, about 100 per cron run. It cannot be undone.
        </p>
      </div>
    </Modal>
  );

  /* ---- form view ---- */
  /* Sent campaigns open in review mode: the composer and actions are locked
     (a broadcast newsletter can't be un-sent), only Back/Preview stay live. */
  const editingCampaign = formMode === "edit" ? campaigns.find((c) => c.id === editingId) : null;
  const formReadonly = !canEdit || (editingCampaign ? !changeable(editingCampaign) : false);

  if (view === "form") {
    return (
      <>
        <div className="admin-page-header">
          <div>
            <h1 className="admin-page-header__title">
              {formMode === "create"
                ? "Newsletter > Campaigns > Create"
                : "Newsletter > Campaigns > Edit"}
            </h1>
            <p className="admin-page-header__desc">
              {formMode === "create"
                ? "Write the campaign content, then save it as a draft or publish it."
                : "Update the campaign details below, then publish the changes."}
            </p>
          </div>
        </div>

        <div className="admin-newsletter-form">
          <div className="admin-form-grid">
            {/* Subject */}
            <div className="admin-field admin-form-grid__full">
              <label className="admin-field__label" htmlFor="campaign-subject">
                Subject *
              </label>
              <input
                id="campaign-subject"
                className="admin-input"
                type="text"
                placeholder="Event title"
                value={form.subject}
                readOnly={formReadonly}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
              />
            </div>

            {/* Content Blocks — a stack of composer "type boxes". One composer
                per box: each is a full editor card (top strip +/drag, toolbar,
                black body). The + button adds a box below; dragging the grip
                reorders boxes. */}
            <div className="admin-field admin-form-grid__full">
              <span className="admin-field__label">Content Blocks *</span>
              <div className="admin-editor-list">
                {form.bodies.map((block, i) => (
                  <ComposerEditor
                    key={block.id}
                    value={block.text}
                    onChange={(text) => updateBox(i, text)}
                    readOnly={formReadonly}
                    onAdd={() => addBoxAfter(i)}
                    onDelete={() => removeBox(i)}
                    canDelete={form.bodies.length > 1}
                    isDragOver={dragOver === i}
                    onDragStart={() => setDragSource(i)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (dragOver !== i) setDragOver(i);
                    }}
                    onDragLeave={() => {
                      if (dragOver === i) setDragOver(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragSource !== null) moveBox(dragSource, i);
                      setDragSource(null);
                      setDragOver(null);
                    }}
                    onDragEnd={() => {
                      setDragSource(null);
                      setDragOver(null);
                    }}
                    uploadImage={uploadImage}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* footer actions — spans the full grid; the row hugs the content
              above (no divider), like the article form. */}
          <div className="admin-form-actions admin-form-grid__full">
            <Button variant="outline" size="sm" icon="chevronLeft" onClick={() => setView("list")}>
              Back
            </Button>
            <div className="admin-form-actions__right">
              <Button
                variant="outline"
                size="sm"
                icon="send"
                onClick={() => void sendTest()}
                disabled={formReadonly || busy || upload.busy}
              >
                Send Test
              </Button>
              <Button
                variant="outline"
                size="sm"
                icon="cloud"
                onClick={() => void saveAndClose()}
                disabled={formReadonly || busy || upload.busy}
              >
                Save draft
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void publishCampaign()}
                disabled={formReadonly || !canSend || busy || upload.busy}
              >
                <img
                  src="/globe.png"
                  alt=""
                  width={14}
                  height={14}
                  className="admin-status-badge__img"
                />{" "}
                Publish
              </Button>
            </div>
          </div>
        </div>

        {sendModal}
        <ToastBanner message={toast.message} />
      </>
    );
  }

  /* ---- list view ---- */
  return (
    <>
      <div className="admin-page-header admin-events-header admin-newsletter-header">
        <div className="admin-page-header__copy">
          <h1 className="admin-page-header__title">
            {isCampaign ? "Newsletter > Campaigns" : "Newsletter > Subscribers"}
          </h1>
          <p className="admin-page-header__desc">PPIDK ASIANIA GALLERY ADMIN PAGE</p>
        </div>
        <div className="admin-page-header__actions">
          {isCampaign ? (
            <>
              {canEdit ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon="plus"
                  className="admin-btn--events-add"
                  onClick={() => toForm("create")}
                >
                  Add New Campaign
                </Button>
              ) : null}
              <label className="admin-newsletter-status" htmlFor="campaign-status-filter">
                <span className="admin-newsletter-status__label">Status</span>
                <select
                  id="campaign-status-filter"
                  className="admin-newsletter-status__select"
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value as CampaignStatusFilter);
                    setPage(1);
                    setMenuFor(null);
                  }}
                >
                  <option value="all">All</option>
                  <option value="sent">Sent</option>
                  <option value="sending">Sending</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="draft">Draft</option>
                </select>
              </label>
              {/* Search bar + button sit beside the Status filter. */}
              <form
                className="admin-searchbox"
                onSubmit={(e) => {
                  e.preventDefault();
                  setQuery(search);
                  setPage(1);
                  setPageSize(10);
                  setMenuFor(null);
                }}
              >
                <Icon name="search" size={16} className="admin-searchbox__icon" />
                <input
                  className="admin-searchbox__input"
                  type="search"
                  placeholder="Search"
                  aria-label="Search campaigns"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    // Emptying the box (✕ or clear) drops the applied query
                    // too, so the list returns to its default view.
                    if (e.target.value === "") {
                      setQuery("");
                      setPage(1);
                      setMenuFor(null);
                    }
                  }}
                />
                <button type="submit" className="admin-searchbox__submit">
                  Search
                </button>
              </form>
            </>
          ) : (
            <>
              {canExport ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon="download"
                  className="admin-btn--events-add"
                  onClick={() => void exportCsv()}
                >
                  Export CSV
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                icon="filter"
                onClick={() => setSubFiltersOpen((v) => !v)}
                className={subActiveFilterCount > 0 ? "admin-btn--filter-on" : ""}
              >
                Filters {subActiveFilterCount > 0 ? `(${subActiveFilterCount})` : ""}
              </Button>
              <form
                className="admin-searchbox"
                onSubmit={(e) => {
                  e.preventDefault();
                  setQuery(search);
                  setPage(1);
                  setPageSize(10);
                  setMenuFor(null);
                }}
              >
                <Icon name="search" size={16} className="admin-searchbox__icon" />
                <input
                  className="admin-searchbox__input"
                  type="search"
                  placeholder="Search"
                  aria-label="Search subscribers by e-mail"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    // Emptying the box (✕ or clear) drops the applied query
                    // too, so the list returns to its default view.
                    if (e.target.value === "") {
                      setQuery("");
                      setPage(1);
                      setMenuFor(null);
                    }
                  }}
                />
                <button type="submit" className="admin-searchbox__submit">
                  Search
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      {/* Tabs sit above the KPI strip, directly under the header row (Figma
          order: header → tabs → KPI strip → table). Each tab owns its table:
          Campaign (campaigns) or Subscribers (subscriber list). */}
      <div
        className="admin-tabs admin-newsletter-tabs"
        role="tablist"
        aria-label="Newsletter lists"
      >
        {(
          [
            ["campaign", "Campaign"],
            ["subscriber", "Subscribers"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`admin-tabs__btn${tab === key ? " admin-tabs__btn--active" : ""}`}
            onClick={() => switchTab(key)}
          >
            {label}
            <span className="admin-tabs__count">{counts[key]}</span>
          </button>
        ))}
      </div>

      {/* KPI strip — confirmed subscribers (open/click tracking is not collected). */}
      <div className="admin-newsletter-kpis">
        <div className="admin-newsletter-kpi">
          <span className="admin-newsletter-kpi__label">
            <img src="/icon-users.png" width={14} height={14} alt="" aria-hidden="true" />
            Confirmed subscribers
          </span>
          <span className="admin-newsletter-kpi__row">
            <span className="admin-newsletter-kpi__value">
              {subscribers.filter((s) => s.status === "confirmed").length}
            </span>
          </span>
        </div>
      </div>

      <Card className="admin-events-card admin-list-card admin-newsletter-card">
        <CardBody flush>
          {/* Subscribers "Filters" panel — same toggle strip as the events
              page: label + select + Clear, shown only while the header
              toggle is open (campaigns keep their inline Status select). */}
          {!isCampaign && subFiltersOpen ? (
            <div className="admin-filter-panel">
              <div className="admin-field">
                <span className="admin-field__label">Status</span>
                <select
                  className="admin-select"
                  value={subStatusFilter}
                  onChange={(e) => {
                    setSubStatusFilter(e.target.value as "all" | SubscriberStatus);
                    setPage(1);
                    setMenuFor(null);
                  }}
                >
                  <option value="all">All statuses</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="pending">Pending</option>
                  <option value="unsubscribed">Unsubscribed</option>
                </select>
              </div>
              <div className="admin-field">
                <span className="admin-field__label">Joined</span>
                <select
                  className="admin-select"
                  value={joinedFilter}
                  onChange={(e) => {
                    setJoinedFilter(e.target.value as JoinedFilter);
                    setPage(1);
                    setMenuFor(null);
                  }}
                >
                  <option value="all">All dates</option>
                  <option value="today">Today</option>
                  <option value="month">This month</option>
                  <option value="year">This year</option>
                </select>
              </div>
              <button type="button" className="admin-filter-panel__clear" onClick={clearFilters}>
                <Icon name="x" size={12} />
                Clear filters
              </button>
            </div>
          ) : null}
          {/* Table for the active tab — always rendered so it keeps its full height. */}
          {isCampaign ? (
            /* Scoped wrapper: same fixed layout as the subscribers table so
               the checkbox column keeps its 3% exact width (auto layout lets
               leftover column space inflate the checkbox cell, and the
               campaign's %-columns sum leaves ~8% to redistribute). */
            <div className="admin-newsletter-campaigns">
              <DataTable
                columns={columns}
                rows={pageCampaignRows}
                rowKey={(r) => r.id}
                emptyText="No campaigns yet"
                hideHeader={false}
                minRows={pageSize}
                emptyState={
                  <div className="admin-empty admin-empty--stack">
                    <span className="admin-empty__heading">
                      <Icon name="mail" size={16} />
                      <span className="admin-empty__title">
                        {query.trim()
                          ? `No campaigns match “${query.trim()}”`
                          : "No campaigns match your filters"}
                      </span>
                    </span>
                    <span className="admin-empty__hint">
                      {activeFilterCount > 0
                        ? `${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"} are on. Try a new search or clear them.`
                        : "Try a new search or clear them."}
                    </span>
                    <span className="admin-empty__actions">
                      {query.trim() || activeFilterCount > 0 ? (
                        <Button
                          variant="outline"
                          size="sm"
                          icon="x"
                          className="admin-gallery-clear"
                          onClick={clearFilters}
                        >
                          Clear filters
                        </Button>
                      ) : null}
                      {canEdit ? (
                        <Button
                          variant="primary"
                          size="sm"
                          icon="plus"
                          onClick={() => toForm("create")}
                        >
                          Add New Campaign
                        </Button>
                      ) : null}
                    </span>
                  </div>
                }
              />
            </div>
          ) : (
            /* Scoped wrapper: the subscribers table uses fixed layout so its
               narrow checkbox column keeps the 3% exact width with no
               leftover space inflating the gap between checkbox and name. */
            <div className="admin-newsletter-subs">
              <DataTable
                columns={subscriberColumns}
                rows={pageSubRows}
                rowKey={(r) => r.id}
                emptyText="No subscribers yet"
                hideHeader={false}
                minRows={pageSize}
                emptyState={
                  <div className="admin-empty admin-empty--stack">
                    <span className="admin-empty__heading">
                      <Icon name="users" size={16} />
                      <span className="admin-empty__title">
                        {query.trim()
                          ? `No subscribers match “${query.trim()}”`
                          : "No subscribers match your filters"}
                      </span>
                    </span>
                    <span className="admin-empty__hint">
                      {activeFilterCount > 0
                        ? `${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"} are on. Try a new search or clear them.`
                        : "Try a new search or clear them."}
                    </span>
                    <span className="admin-empty__actions">
                      {query.trim() || activeFilterCount > 0 ? (
                        <Button
                          variant="outline"
                          size="sm"
                          icon="x"
                          className="admin-gallery-clear"
                          onClick={clearFilters}
                        >
                          Clear filters
                        </Button>
                      ) : null}
                    </span>
                  </div>
                }
              />
            </div>
          )}

          {/* Bulk action bar — shown in place of the pagination bar while rows are selected */}
          {isCampaign && selected.size > 0 ? (
            <div className="admin-bulkbar">
              <span className="admin-bulkbar__summary">
                <label className="admin-checkbox">
                  <input
                    type="checkbox"
                    aria-label={`Select all matching ${isCampaign ? "campaigns" : "subscribers"}`}
                    checked={allFilteredSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = selected.size > 0 && !allFilteredSelected;
                    }}
                    onChange={selectAllFiltered}
                    className="admin-table__checkbox"
                  />
                  <span aria-hidden="true" />
                </label>
                {selected.size} selected
              </span>
              <button
                type="button"
                className="admin-bulkbar__select-all"
                onClick={selectAllFiltered}
              >
                Select all {filtered.length} {isCampaign ? "campaigns" : "subscribers"}
              </button>
              <div className="admin-bulkbar__actions">
                {canEdit ? (
                  <Button
                    variant="danger"
                    size="sm"
                    icon="trash"
                    disabled={busy}
                    onClick={deleteSelected}
                  >
                    Delete
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            /* Pagination: Showing … of N · Rows per page · page numbers */
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
              {pageNumbers.map((p) => (
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
          )}
        </CardBody>
      </Card>

      {/* Delete confirmation popup — dark, compact, styled like the Events /
          Articles delete modal; the two actions sit flush right. */}
      <Modal
        open={deleteConfirm !== null}
        title={
          deleteConfirm?.kind === "many"
            ? `Delete ${deleteConfirm.count} Campaign${deleteConfirm.count === 1 ? "" : "s"}?`
            : deleteConfirm?.kind === "campaign"
              ? `Delete "${deleteConfirm.item.subject}"?`
              : "Delete"
        }
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
              onClick={() => void doDelete()}
            >
              Delete
            </Button>
          </div>
        }
      >
        <p className="admin-delete-confirm__message">
          {deleteConfirm ? (
            <span className="admin-delete-confirm__hint">
              Only drafts and scheduled campaigns can be deleted. You can revert deletion on the
              admin log before 14 days.
            </span>
          ) : null}
        </p>
      </Modal>

      {sendModal}
      <Modal
        open={previewFor !== null}
        title={previewFor?.subject ?? "Preview"}
        width={640}
        onClose={() => setPreviewFor(null)}
      >
        {/* Stored body was sanitised by the server (allowlist) when it was saved. */}
        <div dangerouslySetInnerHTML={{ __html: previewFor?.body ?? "" }} />
      </Modal>

      <ToastBanner message={toast.message} />
    </>
  );
}
