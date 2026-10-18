"use client";

// Editor toolbar icons are bundled 30×30 PNG tiles (public/Button-*.png): static
// assets with no LCP or bandwidth concern, so plain <img> — not next/image — is
// deliberate here. Kill the rule for the whole file.
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { NEWS_CATEGORIES, type FeaturedImage, type NewsCategory } from "@website/domain/content";
import {
  removeNewsAction,
  saveNewsAction,
  setNewsPublishedAction,
} from "@/app/(panel)/articles/actions";
import { actionMessage } from "@/components/action-message";
import { formatUtc, timeAgo } from "@/components/format";
import { useImageUpload, type UploadedImage } from "@/components/image-upload";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FieldError } from "@/components/ui/field-error";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import { label, NEWS_CATEGORY_LABELS } from "@/labels";
import {
  PAGE_SIZE_OPTIONS,
  matchesArticleTab,
  type ArticleItem,
  type ArticleStatus,
  type ArticleTab,
} from "./articles-model";

/* ==================================================================
   Article — list (tabs, search, filters, bulk actions) + create/edit
   form. Ported from the Figma "ARTICLE ADMIN" screens.

   NOTE on CSS reuse: the table/card and header reuse the `.admin-events-*`
   scopes on purpose — `.admin-events-card` and `.admin-events-header`
   exist in the light theme (globals.css) with the dark layers added by
   preview-dark.css, so the article list gets the matching dark table,
   sortable headers, tabs, bulk bar and pagination for free. The form
   surface is scoped under `.admin-article-form` (mirror of the gallery/
   events form surfaces).
   ================================================================== */

/** Public article path on the web app (apps/web /news/[slug]). */
const ARTICLE_PATH = "/news/";

/** Featured image from an upload (the thumbnail preset is public, so both URLs are set). */
function toFeaturedImage(image: UploadedImage): FeaturedImage | null {
  if (!image.url || !image.thumbUrl) return null;
  const { url, thumbUrl, path, thumbPath, width, height } = image;
  return { url, thumbUrl, path, thumbPath, width, height };
}

/** ISO timestamp → the value of a datetime-local input, in the viewer's time zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** Sortable article-table columns (checkbox and actions are never sorted). */
type SortKey = "title" | "author" | "status" | "date";

/** Sortable table header: label + arrow icon. Active column shows a filled arrow. */
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

/** Rich-text toolbar chip for the content editor (formatting buttons). */
function EditorButton({
  icon,
  label,
  active = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={active ? "admin-editor__btn admin-editor__btn--active" : "admin-editor__btn"}
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      /* Keep focus in the editor: a toolbar mousedown normally moves focus and
         clears the live selection, so the command would run on the wrong text. */
      onMouseDown={(e) => e.preventDefault()}
    >
      {icon}
    </button>
  );
}

/** One rich-text "type box": an independent contentEditable article body.
    Kept as {id, text} so React keys stay stable across add/reorder — a box's
    typed content lives in the DOM, and a per-index key would make React treat
    a moved box as a new child and drop its edits. */
interface EditorBox {
  id: string;
  /** The box's HTML (the server sanitises the joined boxes when saving). */
  text: string;
}

interface ArticleForm {
  title: string;
  author: string;
  category: NewsCategory;
  url: string;
  excerpt: string;
  banner: FeaturedImage | null;
  /** Publish date & time, in the Settings popup's datetime-local format. */
  date: string;
  /** Keywords shown as chips in the Settings popup ("Tag/Keywords"). */
  tags: string[];
  /** The article's rich-text "type boxes". New boxes are added with the
      toolbar + button; the drag handle reorders them. */
  bodies: EditorBox[];
}

const EMPTY_FORM: ArticleForm = {
  title: "",
  author: "",
  category: NEWS_CATEGORIES[0],
  url: "",
  excerpt: "",
  banner: null,
  date: "",
  tags: [],
  bodies: [{ id: "box-0", text: "" }],
};

/** Fresh id for a new type box (monotonic, no collisions while the form lives). */
let BOX_SEQ = 1;
const nextBoxId = () => `box-${BOX_SEQ++}`;

/** Filter choice for the status select: any status, or "all". */
type StatusFilter = "all" | ArticleStatus;

/** When-last-modified filter for the date select (mirrors the Events page). */
type DateFilter = "all" | "today" | "month" | "year" | "past";

/** Pending delete action shown in the dark confirm modal (one article or many). */
type DeleteConfirm = { kind: "one"; article: ArticleItem } | { kind: "many"; count: number };

/* ==================================================================
   ContentBox - one rich-text "type box" of the article form.

   A full editor card (top strip with +/drag, 10-button toolbar, black
   body). Each box owns its own contentEditable, selection memory and
   toolbar state, so several boxes can be edited independently. HTML
   flows two-way: `value` seeds the editable once on mount; edits are
   reported back via `onChange`. The parent drives add/drag.
   ================================================================== */
function ContentBox({
  value,
  onChange,
  onAdd,
  onDelete,
  canDelete,
  toast,
  uploadImage,
  isDragOver,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: {
  value: string;
  onChange: (text: string) => void;
  onAdd: () => void;
  onDelete: () => void;
  canDelete: boolean;
  toast: { show: (text: string) => void };
  /** Uploads an inline image; resolves to its public URL (null when the upload failed). */
  uploadImage: (file: File) => Promise<string | null>;
  isDragOver: boolean;
  onDragStart: (e: ReactDragEvent<HTMLSpanElement>) => void;
  onDragOver: (e: ReactDragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: ReactDragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const editorImageInputRef = useRef<HTMLInputElement>(null);

  /* ---- Rich-text (contentEditable) editor commands ---- */
  /* WYSIWYG like a mail composer: the toolbar buttons format the current
   selection in place via document.execCommand. The selection is remembered
   on blur (clicking the toolbar steals focus) and restored before each
   command, and every command re-syncs the HTML back into the form. */
  const savedRangeRef = useRef<Range | null>(null);

  /* Link is created through a small popup (the standard "insert link" dialog):
   the modal below asks for the link Text and Hyperlink, then stamps an <a>
   over the selection (or inserts one at the caret if nothing is selected). */

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

  const onEditorSelect = () => {
    refreshActive();
    saveRange();
  };

  /* The toolbar never lets the editor blur (see EditorButton), so commands can
   run straight on the live selection; the saved range only takes over when
   focus drifted (e.g. a window.prompt just closed), so the command never acts
   on a stale anchor. */
  const selectionInEditor = () => {
    const el = editorRef.current;
    const sel = document.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return false;
    const node = sel.getRangeAt(0).startContainer;
    return node === el || el.contains(node);
  };
  /* A formatting command needs an anchor. On first mount (or when focus has
   drifted and nothing is saved) there is no caret in the editor yet, so park
   one at the start of the content before running the command. */
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

  /* Nearest block element (div/p/li/...) walking up from a node — used to know
   which heading/quote a caret or selection currently sits in. */
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

  /* Is the caret/selection already inside an element of this tag? */
  const insideTag = (node: Node | null, tag: string): HTMLElement | null => {
    const el = editorRef.current;
    if (node && node.nodeType === Node.TEXT_NODE) node = node.parentNode;
    while (node && node !== el) {
      if (node instanceof HTMLElement && node.tagName.toUpperCase() === tag) return node;
      node = node.parentNode;
    }
    return null;
  };

  /** Which toolbar buttons describe the format at the current caret, so the
    toolbar can show the active one (Gmail/Word style). Blocks and inline
    formats are tracked independently so several buttons can be on at once.

    Alignment is a single rotating button: it advances to the next alignment
    on every press (left → center → right → justify → back to left), so the
    toolbar keeps the *currently selected* alignment highlighted. */
  const ALIGN_ORDER = ["alignLeft", "alignCenter", "alignRight", "alignJustify"] as const;
  type AlignCmd = (typeof ALIGN_ORDER)[number];
  const alignToCmd: Record<AlignCmd, string> = {
    alignLeft: "justifyLeft",
    alignCenter: "justifyCenter",
    alignRight: "justifyRight",
    alignJustify: "justifyFull",
  };
  /* One exported tile per alignment so the rotating Align button visibly
   switches icon as it cycles left → center → right → justify. */
  const alignToTile: Record<AlignCmd, string> = {
    alignLeft: "/Button-align-left.png",
    alignCenter: "/Button-align-center.png",
    alignRight: "/Button-align-right.png",
    alignJustify: "/Button-align-justify.png",
  };
  const [alignCycle, setAlignCycle] = useState<number>(0);
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

  const [activeCmds, setActiveCmds] = useState<string[]>([]);
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
  const refreshActive = () => {
    const el = editorRef.current;
    const sel = document.getSelection();
    if (!el || !sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return;
    setActiveCmds(detectActive());
    /* keep the rotating align button pointing at whatever alignment the caret
     actually sits in (after a command or when careting through the text) */
    const align = activeAlign();
    if (align) setAlignCycle(ALIGN_ORDER.indexOf(align));
  };

  /* Replace an element with its own children (the toggle-off path: text goes
   back to plain, losing the wrapper but keeping the content). */
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

  /* Nearest block wrapper among the heading/quote set above a node — block
   formats are mutually exclusive, so swapping H1→H2 replaces, not nests. */
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

  /* Toggling wrap: if the selection is already inside `tag`, unwrap it (button
   pressed twice → off); otherwise wrap exactly the selected text in it (block
   heading/quote, or inline <code>). This scopes formatting to the selection
   instead of re-formatting the whole paragraph, and lets formats stack (e.g.
   H1 + code, list + link). Block tags swap rather than nest: H1 then H2
   converts the heading level instead of embedding one inside the other. */
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
    /* A different block wrapper already owns this selection → retag it to the
     new block format instead of nesting one block element inside another. */
    const other = BLOCK_WRAPS.includes(tag) ? insideBlockWrap(anchor) : null;
    if (other) {
      const keep = Array.from(other.childNodes);
      const wrap = document.createElement(tag);
      keep.forEach((n) => wrap.appendChild(n));
      other.parentNode?.replaceChild(wrap, other);
      /* caret lands inside the newly tagged block so the toolbar shows it on */
      const r = document.createRange();
      r.selectNodeContents(wrap);
      r.collapse(false);
      placeCaret(r);
      return;
    }
    const range = sel.getRangeAt(0);
    if (range.collapsed) {
      /* No selected text yet: put the caret inside a fresh wrapper so whatever
       the user types next is formatted. */
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
    /* keep the formatted text selected so the user sees exactly what changed */
    const r = document.createRange();
    r.selectNodeContents(wrap);
    placeCaret(r);
  };

  const runCommand = (cmd: string) => {
    switch (cmd) {
      /* The align button rotates: pressing it advances to the next alignment in
       the cycle and applies it. The *current* alignment stays lit. */
      case "alignCycle": {
        const next = ALIGN_ORDER[(alignCycle + 1) % ALIGN_ORDER.length]!;
        exec(alignToCmd[next]);
        /* exec() re-runs refreshActive which re-reads the live alignment, so
         alignCycle already tracks what was actually applied */
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
        /* execCommand already toggles an unordered list on the block */
        exec("insertUnorderedList");
        break;
      case "number":
        /* ditto for an ordered list */
        exec("insertOrderedList");
        break;
      case "link":
        /* Toggle, like the other format buttons: when the caret is already
         inside a link (button lit), clicking removes the hyperlink and keeps
         the text; otherwise the insert-link popover opens. */
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

  /* ---- Link popup (Text + Hyperlink) ---- */

  /* Prepend https:// when the typed link has no scheme, so "google.com" links
   like Gmail does. mailto:/tel:/# anchors keep their own prefix. */
  const normalizeLink = (raw: string): string => {
    const t = raw.trim();
    if (!t) return t;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(t)) return t;
    return `https://${t}`;
  };

  /* The link popover's two fields. The popover is a small card anchored at the
   caret, not a blocking modal, so the page stays visible behind it. */
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkPos, setLinkPos] = useState<{ top: number; left: number } | null>(null);

  /* Open the insert-link popover. The live selection is remembered (so the link
   survives the popover stealing focus); selected text prefills the Text field,
   and the popover is parked just under the caret/selection. */
  const openLinkModal = () => {
    const el = editorRef.current;
    if (!el) return;
    ensureCaret();
    const sel = document.getSelection();
    const text = sel && sel.rangeCount > 0 ? sel.toString() : "";
    setLinkText(text);
    setLinkUrl("");
    /* anchor the card 12px below the caret so it floats over the text being
     linked instead of covering it */
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      setLinkPos({ top: rect.bottom + 12, left: Math.max(8, rect.left) });
    } else {
      const rect = el.getBoundingClientRect();
      setLinkPos({
        top: rect.top + 8,
        left: Math.max(8, rect.left + 12),
      });
    }
    setLinkOpen(true);
  };

  /* Apply the link over the remembered selection (or at the caret), then close. */
  const applyLink = () => {
    const el = editorRef.current;
    if (!el) return;
    const url = linkUrl.trim();
    if (!url) {
      toast.show("Enter a hyperlink first");
      return;
    }
    /* The modal's inputs grabbed focus, so restore the editor selection that
     openLinkModal saved. */
    restoreRange();
    const sel = document.getSelection();
    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    const full = normalizeLink(url);
    const text = linkText.trim() || url;
    if (range && !range.collapsed) {
      /* selected text becomes the link's visible text */
      document.execCommand("createLink", false, full);
      /* set the visible text: the linked selection keeps the exact Text field
       value, so adjusting it here swaps the wording without touching href */
      let node: Node | null = sel?.anchorNode ?? range.startContainer;
      if (node && node.nodeType === Node.TEXT_NODE) node = node.parentNode;
      const anchor =
        node instanceof HTMLElement
          ? (node.closest("a") ?? null)
          : range.commonAncestorContainer instanceof HTMLElement
            ? range.commonAncestorContainer.closest("a")
            : null;
      if (anchor) {
        anchor.textContent = text;
        /* keep the caret just after the link */
        const r = document.createRange();
        r.setStartAfter(anchor);
        r.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(r);
        savedRangeRef.current = r.cloneRange();
      }
    } else {
      /* no selection — insert a new anchor with the Text as its visible text */
      const anchor = document.createElement("a");
      anchor.href = full;
      anchor.textContent = text;
      const r = document.createRange();
      if (range) {
        r.setStart(range.startContainer, range.startOffset);
        r.collapse(true);
      } else {
        r.selectNodeContents(el);
        r.collapse(false);
      }
      r.insertNode(anchor);
      const after = document.createRange();
      after.setStartAfter(anchor);
      after.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(after);
      savedRangeRef.current = after.cloneRange();
    }
    setLinkOpen(false);
    syncEditorText();
    refreshActive();
    el.focus();
  };

  const onEditorInput = () => {
    syncEditorText();
  };

  /* Clicking a toolbar button steals focus; remember the caret so the next
   command acts on the right spot. The link popup relies on the same save. */
  const onEditorBlur = () => {
    saveRange();
  };

  /* The link popover is dismissed exactly like a small popup: Escape cancels it,
   and clicking anywhere outside the card closes it without linking. */
  const linkPopRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!linkOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLinkOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (linkPopRef.current && !linkPopRef.current.contains(e.target as Node)) setLinkOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [linkOpen]);

  /* Seed the contentEditable with the article's stored (server-sanitised) HTML the
   first time the form mounts (after that the editor owns its own live content). */
  const editorSeededRef = useRef(false);
  useEffect(() => {
    const el = editorRef.current;
    if (el && !editorSeededRef.current) {
      el.innerHTML = value;
      editorSeededRef.current = true;
    }
  }, [value]);
  return (
    <>
      {/* Content — rich-text editor */}
      <div
        className={
          isDragOver
            ? "admin-editor admin-form-grid__full admin-editor--drag-over"
            : "admin-editor admin-form-grid__full"
        }
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div className="admin-editor__top">
          {/* A strip above the format chips: a plus that adds a NEW type
                      box below this one, a drag handle that reorders it, and —
                      when more than one box exists — a trash button that
                      removes this box. */}
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
            onClick={() => runCommand("alignCycle")}
          />
          <EditorButton
            icon={<img src="/Button-1.png" alt="" className="admin-editor__btn-img" />}
            label="Insert image"
            onClick={() => runCommand("image")}
          />
          <EditorButton
            icon={<img src="/Button-2.png" alt="" className="admin-editor__btn-img" />}
            label="Comment"
            active={activeCmds.includes("comment")}
            onClick={() => runCommand("comment")}
          />
          <EditorButton
            icon={<img src="/Button-3.png" alt="" className="admin-editor__btn-img" />}
            label="Heading 1"
            active={activeCmds.includes("h1")}
            onClick={() => runCommand("h1")}
          />
          <EditorButton
            icon={<img src="/Button-4.png" alt="" className="admin-editor__btn-img" />}
            label="Heading 2"
            active={activeCmds.includes("h2")}
            onClick={() => runCommand("h2")}
          />
          <EditorButton
            icon={<img src="/Button-5.png" alt="" className="admin-editor__btn-img" />}
            label="Divider"
            onClick={() => runCommand("divider")}
          />
          <EditorButton
            icon={<img src="/Button-6.png" alt="" className="admin-editor__btn-img" />}
            label="Bullet list"
            active={activeCmds.includes("bullet")}
            onClick={() => runCommand("bullet")}
          />
          <EditorButton
            icon={<img src="/Button-7.png" alt="" className="admin-editor__btn-img" />}
            label="Numbered list"
            active={activeCmds.includes("number")}
            onClick={() => runCommand("number")}
          />
          <EditorButton
            icon={<img src="/Button-8.png" alt="" className="admin-editor__btn-img" />}
            label="Link"
            active={activeCmds.includes("link")}
            onClick={() => runCommand("link")}
          />
          <EditorButton
            icon={<img src="/Button-9.png" alt="" className="admin-editor__btn-img" />}
            label="Code"
            active={activeCmds.includes("code")}
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
            if (!file) return;
            /* uploaded through the image pipeline (preset "thumbnail"); the
                         body stores the public https URL, never a data URL */
            e.target.value = "";
            void uploadImage(file).then((url) => {
              if (url) exec("insertImage", url);
            });
          }}
        />
        <div
          ref={editorRef}
          className="admin-editor__body"
          contentEditable
          role="textbox"
          aria-multiline="true"
          aria-label="Article content"
          data-placeholder=""
          onInput={onEditorInput}
          onBlur={onEditorBlur}
          onKeyUp={onEditorSelect}
          onClick={onEditorSelect}
          onSelect={onEditorSelect}
        />
      </div>

      {/* Insert-link popover: a compact card floating just under the caret.
              The page behind stays fully visible (no dimmed overlay) — it is a
              small anchored card, like a context menu. Text prefills with the
              selection; Hyperlink is the URL. */}
      {linkOpen && linkPos ? (
        <div
          ref={linkPopRef}
          role="dialog"
          aria-label="Insert link"
          className="admin-link-pop"
          style={{ top: linkPos.top, left: linkPos.left }}
        >
          <label className="admin-link-pop__label" htmlFor="link-text">
            Text
          </label>
          <input
            id="link-text"
            className="admin-input"
            type="text"
            placeholder="Teks yang terlihat"
            value={linkText}
            onChange={(e) => setLinkText(e.target.value)}
          />
          <label className="admin-link-pop__label" htmlFor="link-url">
            Hyperlink
          </label>
          <div className="admin-link-pop__row">
            <input
              id="link-url"
              className="admin-input"
              type="text"
              placeholder="https://contoh.com"
              value={linkUrl}
              autoFocus
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyLink();
                }
              }}
            />
            <Button variant="primary" size="sm" icon="link" onClick={applyLink}>
              Save
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
interface ArticleListProps {
  /** Rows from the server (src/app/(panel)/articles/page.tsx); refreshed after every change. */
  initial: ArticleItem[];
  canEdit: boolean;
  canPublish: boolean;
  /** WEB_URL, for "Copy Link". */
  publicBase: string;
  /** Pre-filled byline for a new article (the staff member's name). */
  defaultAuthor: string;
}

/** Form values for an existing article (edit view and Settings popup). */
function formFrom(a: ArticleItem): ArticleForm {
  return {
    title: a.title,
    author: a.author,
    category: a.categoryKey,
    url: a.url,
    excerpt: a.excerpt,
    banner: a.featuredImage,
    date: toLocalInput(a.publishAt),
    tags: a.tags,
    bodies: [{ id: nextBoxId(), text: a.body }],
  };
}

function ArticleList({
  initial: articles,
  canEdit,
  canPublish,
  publicBase,
  defaultAuthor,
}: ArticleListProps) {
  const toast = useToastMessage();
  const router = useRouter();
  const uploader = useImageUpload("thumbnail");
  /* A server action is running: the action buttons are disabled meanwhile. */
  const [busy, setBusy] = useState(false);
  /* Server validation messages per field (GuardedResult `fields`). */
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});

  /* ---- list state ---- */
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const [tab, setTab] = useState<ArticleTab>("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState(""); // diterapkan hanya saat Search diklik / Enter ditekan
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  /* ---- form view state ---- */
  const [view, setView] = useState<"list" | "form">("list");
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ArticleForm>(EMPTY_FORM);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  /* ---- type-box drag reorder ---- */
  const [dragSource, setDragSource] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const activeFilterCount =
    (statusFilter !== "all" ? 1 : 0) +
    (categoryFilter !== "all" ? 1 : 0) +
    (dateFilter !== "all" ? 1 : 0);

  /* ---- header sort: click toggles asc → desc (first click on a new column = asc) ---- */
  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortValue = (a: ArticleItem, key: SortKey): string => {
    switch (key) {
      case "title":
        return a.title.toLowerCase();
      case "author":
        return a.author.toLowerCase();
      case "status":
        return a.status;
      case "date":
        return a.modifiedAt;
    }
  };

  /* ---- derived rows ---- */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const m = today.slice(0, 7); // YYYY-MM, for the "this month" filter
    const y = today.slice(0, 4); // YYYY, for the "this year" filter
    return articles.filter((a) => {
      if (!matchesArticleTab(a, tab)) return false;
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      if (categoryFilter !== "all" && a.categoryKey !== categoryFilter) return false;
      if (dateFilter !== "all") {
        const d = a.modifiedAt.slice(0, 10); // ISO date part of the timestamp
        if (dateFilter === "today") {
          if (d !== today) return false;
        } else if (dateFilter === "month") {
          if (!d.startsWith(m)) return false;
        } else if (dateFilter === "year") {
          if (!d.startsWith(y)) return false;
        } else if (dateFilter === "past") {
          if (d >= today) return false;
        }
      }
      if (q) {
        const hay = [a.title, a.category, a.author, a.url, a.excerpt].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [articles, tab, today, query, statusFilter, categoryFilter, dateFilter]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const counts = useMemo(() => {
    const drafts = articles.filter((a) => a.status === "draft").length;
    const published = articles.filter((a) => a.status !== "draft").length;
    return { all: articles.length, published, drafts };
  }, [articles]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);
  /* ---- pagination: sliding window of 5 consecutive page numbers ---- */
  const pageNumbers: number[] = [];
  const winStart = Math.max(1, Math.min(safePage - 2, totalPages - 4));
  const winEnd = Math.min(totalPages, winStart + 4);
  for (let i = winStart; i <= winEnd; i++) pageNumbers.push(i);
  const pageAllSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));
  const pageSomeSelected = pageRows.some((r) => selected.has(r.id));
  const allFilteredSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));

  /* ---- selection helpers ---- */
  const togglePage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (pageAllSelected) pageRows.forEach((r) => next.delete(r.id));
      else pageRows.forEach((r) => next.add(r.id));
      return next;
    });
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filtered.forEach((r) => next.delete(r.id));
      else filtered.forEach((r) => next.add(r.id));
      return next;
    });
  };

  /* ---- row / bulk mutations (server actions; the page re-reads after each) ---- */
  type Failure = Parameters<typeof actionMessage>[0];
  const fail = (result: Failure) => {
    setFieldErrors(result.fields ?? {});
    toast.show(actionMessage(result));
  };

  /* One action per article, one after the other (each has its own version check). */
  const runForEach = async (
    ids: readonly string[],
    run: (a: ArticleItem) => Promise<{ ok: true } | Failure>,
    done: string,
  ) => {
    setBusy(true);
    setMenuFor(null);
    let count = 0;
    let failure: Failure | null = null;
    for (const a of articles.filter((x) => ids.includes(x.id))) {
      const result = await run(a);
      if (!result.ok) {
        failure = result;
        break;
      }
      count++;
    }
    setBusy(false);
    setSelected(new Set());
    router.refresh();
    if (failure) fail(failure);
    else toast.show(`${count} article${count === 1 ? "" : "s"} ${done}`);
  };

  const setPublishedFor = (ids: readonly string[], published: boolean) => {
    if (ids.length === 0) {
      toast.show("Select articles first");
      return;
    }
    void runForEach(
      ids,
      (a) => setNewsPublishedAction({ id: a.id, version: a.version, published }),
      published ? "published" : "unpublished",
    );
  };

  const publishSelected = () => setPublishedFor(Array.from(selected), true);
  const unpublishSelected = () => setPublishedFor(Array.from(selected), false);

  const deleteSelected = () => {
    if (selected.size === 0) {
      toast.show("Select articles to delete");
      return;
    }
    setDeleteConfirm({ kind: "many", count: selected.size });
  };

  const deleteArticle = (a: ArticleItem) => {
    setMenuFor(null);
    setDeleteConfirm({ kind: "one", article: a });
  };

  /* Deletes are confirmed in the dark modal (like Events/Tools) instead of
     window.confirm. The modal only stores *what* would be deleted; doDelete
     runs the soft delete once the user confirms. */
  const doDelete = () => {
    if (!deleteConfirm) return;
    const ids = deleteConfirm.kind === "one" ? [deleteConfirm.article.id] : Array.from(selected);
    setDeleteConfirm(null);
    void runForEach(ids, (a) => removeNewsAction({ id: a.id, version: a.version }), "deleted");
  };

  const copyLink = (a: ArticleItem) => {
    void navigator.clipboard?.writeText(`${publicBase}${ARTICLE_PATH}${a.url}`);
    toast.show(`Link for "${a.title}" copied`);
    setMenuFor(null);
  };

  /* Admin-only preview of the SAVED article, rendered like the public page (also drafts). */
  const openPreview = (id: string | null) => {
    setMenuFor(null);
    if (!id) {
      toast.show("Save the draft first, then preview it");
      return;
    }
    window.open(`/articles/${id}/preview`, "_blank", "noopener");
  };

  /* ---- form open / save ---- */
  const toForm = (mode: "create" | "edit", a?: ArticleItem) => {
    setFormMode(mode);
    setEditingId(a?.id ?? null);
    setFieldErrors({});
    setForm(a ? formFrom(a) : { ...EMPTY_FORM, author: defaultAuthor });
    setView("form");
  };

  /* Save draft / Publish (form view) and Save (Settings popup). Publishing with a
     future date schedules the article; it goes public by itself at that time. */
  const save = async (intent: "draft" | "publish", done: string) => {
    const current = articles.find((a) => a.id === editingId);
    setBusy(true);
    const result = await saveNewsAction({
      ...(editingId ? { id: editingId } : {}),
      version: current?.version ?? null,
      intent,
      title: form.title,
      slug: form.url.trim(),
      author: form.author,
      category: form.category,
      publishAt: form.date ? new Date(form.date).toISOString() : null,
      summary: form.excerpt,
      tags: form.tags,
      body: form.bodies.map((b) => b.text).join(""),
      featuredImage: form.banner,
    });
    setBusy(false);
    if (!result.ok) {
      fail(result);
      return false;
    }
    setFieldErrors({});
    toast.show(result.data.status === "scheduled" ? "Article scheduled" : done);
    router.refresh();
    return true;
  };

  const saveDraft = async () => {
    if (await save("draft", "Draft saved")) setView("list");
  };

  const publishArticle = async () => {
    if (!(await save("publish", "Article published"))) return;
    setTab("all");
    setPage(1);
    setView("list");
  };

  /* Settings popup (row menu → Setting): saves the edited fields with the
     article's current body, keeping it a draft or keeping it published. */
  const saveSettings = async () => {
    const current = articles.find((a) => a.id === editingId);
    if (!(await save(current?.status === "draft" ? "draft" : "publish", "Article settings saved")))
      return;
    setSettingsOpen(false);
    setEditingId(null);
  };

  /* ---- Settings popup: Tag/Keywords input ---- */
  const [tagInput, setTagInput] = useState("");
  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (!t) return;
    if (!form.tags.includes(t)) {
      setForm((f) => ({ ...f, tags: [...f.tags, t] }));
    }
    setTagInput("");
  };
  const removeTag = (t: string) => setForm((f) => ({ ...f, tags: f.tags.filter((x) => x !== t) }));

  /* Images go through the image pipeline (type/size checks, WebP, preset "thumbnail");
     the uploader shows its own error message under the drop zone. */
  const onBannerFile = async (file: File) => {
    const image = await uploader.upload(file);
    const banner = image ? toFeaturedImage(image) : null;
    if (banner) setForm((f) => ({ ...f, banner }));
  };
  const uploadInlineImage = async (file: File) => (await uploader.upload(file))?.url ?? null;

  /* ---- type boxes: add, edit, reorder ---- */
  /* The article body is a stack of ContentBox editors. Each box edits its own
     string in form.bodies; the + button inserts a fresh empty box right below
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

  /* Remove a type box. The last remaining box can't be removed (the UI hides
     the trash button when only one box is left), but guard here too so the
     article always keeps at least one body. */
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

  /* ---- article details: shared by the form view and the Settings popup ---- */
  const errorProps = (field: string, id: string) =>
    fieldErrors[field] ? { "aria-invalid": true, "aria-describedby": `${id}-error` } : {};
  const detailFields = (prefix: string) => (
    <>
      <div className="admin-field admin-form-grid__full">
        <label className="admin-field__label" htmlFor={`${prefix}-title`}>
          Title *
        </label>
        <input
          id={`${prefix}-title`}
          className="admin-input"
          type="text"
          placeholder="Article title"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          {...errorProps("title", `${prefix}-title`)}
        />
        <FieldError id={`${prefix}-title-error`} message={fieldErrors["title"]} />
      </div>

      <div className="admin-field">
        <label className="admin-field__label" htmlFor={`${prefix}-author`}>
          Author *
        </label>
        <input
          id={`${prefix}-author`}
          className="admin-input"
          type="text"
          placeholder="Author name"
          value={form.author}
          onChange={(e) => setForm({ ...form, author: e.target.value })}
          {...errorProps("author", `${prefix}-author`)}
        />
        <FieldError id={`${prefix}-author-error`} message={fieldErrors["author"]} />
      </div>
      <div className="admin-field">
        <label className="admin-field__label" htmlFor={`${prefix}-category`}>
          Category *
        </label>
        <select
          id={`${prefix}-category`}
          className="admin-select"
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value as NewsCategory })}
        >
          {NEWS_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {label(NEWS_CATEGORY_LABELS, c)}
            </option>
          ))}
        </select>
      </div>

      <div className="admin-field">
        <label className="admin-field__label" htmlFor={`${prefix}-date`}>
          Publish Date &amp; Time
        </label>
        <input
          id={`${prefix}-date`}
          className="admin-input"
          type="datetime-local"
          value={form.date}
          onChange={(e) => setForm({ ...form, date: e.target.value })}
          {...errorProps("publishAt", `${prefix}-date`)}
        />
        <FieldError
          id={`${prefix}-date-error`}
          message={fieldErrors["publishAt"] ?? "Your time zone. Empty = when published."}
        />
      </div>
      <div className="admin-field">
        <label className="admin-field__label" htmlFor={`${prefix}-url`}>
          URL
        </label>
        <div className="admin-url-slug">
          <span className="admin-url-slug__prefix" aria-label="Article URL prefix">
            {ARTICLE_PATH}
          </span>
          <input
            id={`${prefix}-url`}
            className="admin-url-slug__slug"
            type="text"
            aria-label="Article URL slug"
            placeholder="built from the title"
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            {...errorProps("slug", `${prefix}-url`)}
          />
        </div>
        <FieldError id={`${prefix}-url-error`} message={fieldErrors["slug"]} />
      </div>

      <div className="admin-field admin-form-grid__full">
        <span className="admin-field__label">Short Summary</span>
        <div className="admin-settings-editor">
          <div className="admin-settings-editor__body-wrap">
            <textarea
              className="admin-settings-editor__body"
              aria-label="Short summary"
              placeholder="Write a short summary of the article…"
              value={form.excerpt}
              onChange={(e) => setForm({ ...form, excerpt: e.target.value })}
              {...errorProps("summary", `${prefix}-summary`)}
            />
          </div>
        </div>
        <FieldError id={`${prefix}-summary-error`} message={fieldErrors["summary"]} />
      </div>

      <div className="admin-field admin-form-grid__full">
        <span className="admin-field__label">Tag/Keywords (max 10)</span>
        <div className="admin-field__row">
          <input
            className="admin-input"
            type="text"
            aria-label="Keyword"
            placeholder="Add a keyword…"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag();
              }
            }}
          />
          <Button variant="maroon" onClick={addTag}>
            Add
          </Button>
        </div>
        {form.tags.length > 0 ? (
          <div className="admin-settings-tags">
            {form.tags.map((t) => (
              <span key={t} className="admin-settings-tags__chip">
                {t}
                <button
                  type="button"
                  className="admin-settings-tags__remove"
                  aria-label={`Remove ${t}`}
                  onClick={() => removeTag(t)}
                >
                  <Icon name="x" size={12} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <FieldError id={`${prefix}-tags-error`} message={fieldErrors["tags"]} />
      </div>
    </>
  );

  /* ---- table columns ---- */
  const checkboxCol: Column<ArticleItem> = {
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

  const columns: Column<ArticleItem>[] = [
    checkboxCol,
    {
      key: "title",
      header: (
        <SortHeader
          label="Article"
          active={sortKey === "title"}
          dir={sortDir}
          onClick={() => onSort("title")}
        />
      ),
      width: "34%",
      render: (r) => (
        <div className="admin-article-title">
          <span className="admin-article-title__thumb" aria-hidden="true">
            {r.image ? <img className="admin-article-title__img" src={r.image} alt="" /> : null}
          </span>
          <div>
            <div className="admin-table__title">{r.title}</div>
            <div className="admin-table__sub">{r.category}</div>
          </div>
        </div>
      ),
    },
    {
      key: "author",
      header: (
        <SortHeader
          label="Author"
          active={sortKey === "author"}
          dir={sortDir}
          onClick={() => onSort("author")}
        />
      ),
      width: "26%",
      render: (r) => (
        <div className="admin-article-author">
          <span className="admin-article-author__avatar" aria-hidden="true">
            {r.authorInitials}
          </span>
          <div>
            <div className="admin-table__title">{r.author}</div>
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
      width: "14%",
      render: (r) => {
        if (r.status === "published")
          return (
            <span className="admin-status-badge admin-status-badge--published">
              <img
                src="/globe.png"
                alt=""
                width={12}
                height={12}
                className="admin-status-badge__img"
              />{" "}
              Public
            </span>
          );
        if (r.status === "scheduled")
          return (
            <span className="admin-status-badge admin-status-badge--scheduled">
              <Icon name="clock" size={12} /> Scheduled
            </span>
          );
        return (
          <span className="admin-status-badge admin-status-badge--draft">
            <Icon name="edit" size={12} /> Draft
          </span>
        );
      },
    },
    {
      key: "date",
      header: (
        <SortHeader
          label="Last Modified"
          active={sortKey === "date"}
          dir={sortDir}
          onClick={() => onSort("date")}
        />
      ),
      width: "16%",
      render: (r) => (
        <span className="admin-article-meta">
          <span className="admin-table__title">{timeAgo(r.modifiedAt)}</span>
          {r.status === "scheduled" && r.publishAt ? (
            <span className="admin-table__sub">Live {formatUtc(new Date(r.publishAt))}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: "aksi",
      header: "",
      align: "right",
      width: "10%",
      render: (r) => (
        <div className="admin-table__actions">
          {canEdit ? (
            <Button
              variant="ghost"
              size="icon"
              icon="edit"
              aria-label="Edit"
              onClick={() => toForm("edit", r)}
              title="Edit"
            />
          ) : null}
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
                {canPublish ? (
                  <button
                    type="button"
                    className="admin-row-menu__item"
                    role="menuitem"
                    disabled={busy}
                    onClick={() => setPublishedFor([r.id], r.status === "draft")}
                  >
                    {r.status === "draft" ? (
                      <>
                        <img
                          src="/globe.png"
                          alt=""
                          width={14}
                          height={14}
                          className="admin-status-badge__img"
                        />{" "}
                        Publish
                      </>
                    ) : (
                      <>
                        <Icon name="lock" size={14} /> Unpublish
                      </>
                    )}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="admin-row-menu__item"
                  role="menuitem"
                  onClick={() => openPreview(r.id)}
                >
                  <Icon name="eye" size={14} /> Preview
                </button>
                <button
                  type="button"
                  className="admin-row-menu__item"
                  role="menuitem"
                  onClick={() => copyLink(r)}
                >
                  <Icon name="copy" size={14} /> Copy Link
                </button>
                {canEdit ? (
                  <>
                    <button
                      type="button"
                      className="admin-row-menu__item"
                      role="menuitem"
                      onClick={() => {
                        setEditingId(r.id);
                        setFieldErrors({});
                        setForm(formFrom(r));
                        setSettingsOpen(true);
                        setMenuFor(null);
                      }}
                    >
                      <Icon name="settings" size={14} /> Setting
                    </button>
                    {/* Divider above the destructive action, separating Delete from the rest. */}
                    <div className="admin-row-menu__divider" role="separator" />
                    <button
                      type="button"
                      className="admin-row-menu__item admin-row-menu__item--danger"
                      role="menuitem"
                      onClick={() => deleteArticle(r)}
                    >
                      <Icon name="trash" size={14} /> Delete Article
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ),
    },
  ];

  const clearFilters = () => {
    setSearch("");
    setQuery("");
    setStatusFilter("all");
    setCategoryFilter("all");
    setDateFilter("all");
    setFiltersOpen(false);
    setPage(1);
    setMenuFor(null);
  };

  /* ---- form view ---- */
  if (view === "form") {
    return (
      <>
        <div className="admin-page-header">
          <div>
            <h1 className="admin-page-header__title">
              {formMode === "create" ? "Article > Create" : "Article > Edit"}
            </h1>
            <p className="admin-page-header__desc">
              {formMode === "create"
                ? "Write a new news article and publish it to the public News page."
                : "Update article information."}
            </p>
          </div>
        </div>

        <div className="admin-article-form">
          <div className="admin-form-grid">
            {detailFields("article")}

            {/* Featured Image + type boxes — one framed container: the image
                section on top, the type boxes below, sharing a single outer
                line. */}
            <div className="admin-form-section admin-form-grid__full">
              <div className="admin-field">
                <span className="admin-field__label">Featured Image</span>
                <div
                  className="admin-dropzone"
                  onClick={() => bannerInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    if (file) void onBannerFile(file);
                  }}
                >
                  {uploader.busy ? (
                    <span className="admin-dropzone__title">Uploading…</span>
                  ) : form.banner ? (
                    <>
                      <img
                        src={form.banner.thumbUrl}
                        alt="Uploaded image"
                        className="admin-dropzone__image"
                      />
                      <span className="admin-dropzone__badge">Click to change</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        icon="x"
                        className="admin-dropzone__remove"
                        aria-label="Remove uploaded image"
                        onClick={(e) => {
                          e.stopPropagation();
                          setForm({ ...form, banner: null });
                        }}
                      />
                    </>
                  ) : (
                    <>
                      <Icon name="upload" size={34} />
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
                    if (file) void onBannerFile(file);
                    e.target.value = "";
                  }}
                />
                <FieldError id="article-upload-error" message={uploader.error} />
              </div>

              {/* Content — article "type boxes". One ContentBox per body: each is
                a full editor card (top strip +/drag, toolbar, black body). The
                + button adds a box below; dragging the grip reorders boxes. */}
              <div className="admin-editor-list">
                {form.bodies.map((box, i) => (
                  <ContentBox
                    key={box.id}
                    value={box.text}
                    onChange={(text) => updateBox(i, text)}
                    onAdd={() => addBoxAfter(i)}
                    onDelete={() => removeBox(i)}
                    canDelete={form.bodies.length > 1}
                    toast={toast}
                    uploadImage={uploadInlineImage}
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
                  />
                ))}
              </div>
            </div>

            {/* footer actions — spans the full grid (the line above reaches the
              card edges) and pushes Preview/Save draft/Publish to the far right.
              The buttons are compact (sm) so the footer stays tidy. */}
            <div className="admin-form-actions admin-form-grid__full">
              <Button
                variant="outline"
                size="sm"
                icon="chevronLeft"
                onClick={() => setView("list")}
              >
                Back
              </Button>
              <div className="admin-form-actions__right">
                <Button
                  variant="outline"
                  size="sm"
                  icon="eye"
                  onClick={() => openPreview(editingId)}
                >
                  Preview
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  icon="cloud"
                  disabled={busy || uploader.busy}
                  onClick={() => void saveDraft()}
                >
                  Save draft
                </Button>
                {canPublish ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || uploader.busy}
                    onClick={() => void publishArticle()}
                  >
                    <img
                      src="/globe.png"
                      alt=""
                      width={14}
                      height={14}
                      className="admin-status-badge__img"
                    />{" "}
                    {form.date && new Date(form.date) > new Date() ? "Schedule" : "Publish"}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <ToastBanner message={toast.message} />
      </>
    );
  }

  /* ---- list view ---- */
  return (
    <>
      <div className="admin-page-header admin-events-header">
        <div>
          <h1 className="admin-page-header__title">Article</h1>
          <p className="admin-page-header__desc">
            Browse, search, and manage all published and draft news articles.
          </p>
        </div>
        <div className="admin-page-header__actions">
          {canEdit ? (
            <Button
              variant="ghost"
              size="sm"
              icon="plus"
              className="admin-btn--events-add"
              onClick={() => toForm("create")}
            >
              Add New Article
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            icon="filter"
            onClick={() => setFiltersOpen((v) => !v)}
            className={activeFilterCount > 0 ? "admin-btn--filter-on" : ""}
          >
            Filters {activeFilterCount > 0 ? `(${activeFilterCount})` : ""}
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
              aria-label="Search articles"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                // Emptying the box (✕ or clear) drops the applied query too,
                // so the list returns to its default view.
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
        </div>
      </div>

      <Card className="admin-events-card admin-list-card">
        <CardBody flush>
          {/* Toggle filter panel */}
          {filtersOpen ? (
            <div className="admin-filter-panel">
              <div className="admin-field">
                <span className="admin-field__label">Category</span>
                <select
                  className="admin-select"
                  value={categoryFilter}
                  onChange={(e) => {
                    setCategoryFilter(e.target.value);
                    setPage(1);
                    setMenuFor(null);
                  }}
                >
                  <option value="all">All categories</option>
                  {NEWS_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {label(NEWS_CATEGORY_LABELS, c)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="admin-field">
                <span className="admin-field__label">Status</span>
                <select
                  className="admin-select"
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value as StatusFilter);
                    setPage(1);
                    setMenuFor(null);
                  }}
                >
                  <option value="all">All statuses</option>
                  <option value="published">Public</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="draft">Draft</option>
                </select>
              </div>
              <div className="admin-field">
                <span className="admin-field__label">Last Modified</span>
                <select
                  className="admin-select"
                  value={dateFilter}
                  onChange={(e) => {
                    setDateFilter(e.target.value as DateFilter);
                    setPage(1);
                    setMenuFor(null);
                  }}
                >
                  <option value="all">All dates</option>
                  <option value="today">Today</option>
                  <option value="month">This month</option>
                  <option value="year">This year</option>
                  <option value="past">Before today</option>
                </select>
              </div>
              <button type="button" className="admin-filter-panel__clear" onClick={clearFilters}>
                <Icon name="x" size={12} />
                Clear filters
              </button>
            </div>
          ) : null}

          {/* Tabs */}
          <div className="admin-tabs" role="tablist" aria-label="Article lists">
            {(
              [
                ["all", "All"],
                ["published", "Published"],
                ["drafts", "Drafts"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={`admin-tabs__btn${tab === key ? " admin-tabs__btn--active" : ""}`}
                onClick={() => {
                  setTab(key);
                  setPage(1);
                }}
              >
                {label}
                <span className="admin-tabs__count">{counts[key]}</span>
              </button>
            ))}
          </div>

          {/* Table — always rendered so it keeps its full height; the empty
              message becomes one body row inside the static table. */}
          <DataTable
            columns={columns}
            rows={pageRows}
            rowKey={(r) => r.id}
            emptyText="No articles yet"
            hideHeader={false}
            minRows={pageSize}
            emptyState={
              <div className="admin-empty admin-empty--stack">
                <span className="admin-empty__heading">
                  <Icon name="inbox" size={16} />
                  <span className="admin-empty__title">
                    {query.trim()
                      ? `No articles match “${query.trim()}”`
                      : "No articles match your filters"}
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
                      Add New Article
                    </Button>
                  ) : null}
                </span>
              </div>
            }
          />

          {/* Bulk action bar — shown in place of the pagination bar while rows are selected */}
          {selected.size > 0 ? (
            <div className="admin-bulkbar">
              <span className="admin-bulkbar__summary">
                <label className="admin-checkbox">
                  <input
                    type="checkbox"
                    aria-label="Select all matching articles"
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
                Select all {filtered.length} articles
              </button>
              <div className="admin-bulkbar__actions">
                {canPublish ? (
                  <>
                    <Button variant="primary" size="sm" disabled={busy} onClick={publishSelected}>
                      <img
                        src="/globe.png"
                        alt=""
                        width={14}
                        height={14}
                        className="admin-status-badge__img"
                      />{" "}
                      Publish
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      icon="lock"
                      disabled={busy}
                      onClick={unpublishSelected}
                    >
                      Unpublish
                    </Button>
                  </>
                ) : null}
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
                Showing {pageRows.length === 0 ? 0 : (safePage - 1) * pageSize + 1}–
                {(safePage - 1) * pageSize + pageRows.length} of {filtered.length}
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

      {/* Settings popup — row menu → Setting. Structured like the Tools "Edit
          Link" modal, but with the colours flipped: the popup window itself is
          a LIGHT cream form card while the overlay behind it stays normal dark. */}
      <Modal
        open={settingsOpen}
        title="Settings"
        className="admin-modal--settings"
        width={440}
        hideClose
        onClose={() => {
          setSettingsOpen(false);
          setEditingId(null);
          setTagInput("");
        }}
        footer={
          <div className="admin-modal__footer-row">
            <Button
              variant="ghost"
              className="admin-modal__foot-btn admin-modal__foot-btn--cancel"
              onClick={() => {
                setSettingsOpen(false);
                setEditingId(null);
                setTagInput("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              className="admin-modal__foot-btn admin-modal__foot-btn--save"
              disabled={busy}
              onClick={() => void saveSettings()}
            >
              <span className="admin-settings-save__logo" aria-hidden="true" /> Save
            </Button>
          </div>
        }
      >
        <div className="admin-form-grid">{detailFields("settings")}</div>
      </Modal>

      {/* Delete confirmation popup — dark, compact, styled like the Tools page
          delete modal; the two actions sit flush right. */}
      <Modal
        open={deleteConfirm !== null}
        title={
          deleteConfirm?.kind === "many"
            ? `Delete ${deleteConfirm.count} Article${deleteConfirm.count === 1 ? "" : "s"}?`
            : deleteConfirm
              ? `Delete "${deleteConfirm.article.title}"?`
              : "Delete article"
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
              onClick={doDelete}
            >
              Delete
            </Button>
          </div>
        }
      >
        <p className="admin-delete-confirm__message">
          {deleteConfirm ? (
            <span className="admin-delete-confirm__hint">
              They disappear from the public page now. You can revert deletion on the admin log
              before 14 days.
            </span>
          ) : null}
        </p>
      </Modal>

      <ToastBanner message={toast.message} />
    </>
  );
}

export function ArticlesPage(props: ArticleListProps) {
  const pathname = usePathname();
  // key={pathname} remounts the list on navigation so search/tab/filter state
  // resets when the user comes back from another page (see Gallery).
  return <ArticleList key={pathname} {...props} />;
}
