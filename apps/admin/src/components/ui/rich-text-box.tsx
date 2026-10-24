"use client";

// Editor toolbar icons are bundled 30×30 PNG tiles (public/Button-*.png): static assets with no
// LCP or bandwidth concern, so plain <img> — not next/image — is deliberate here.
/* eslint-disable @next/next/no-img-element */

import {
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from "react";
import { moveItem } from "../list-model";
import { Button } from "./button";
import { Icon } from "./icon";

/*
 * Rich-text content of the Article and Newsletter forms: a stack of "type boxes" (each a full
 * editor card: + / drag / delete strip, 10-button toolbar, contentEditable body). The + adds
 * a box below, the grip reorders, the trash removes a box (one always stays). Each box owns
 * its own selection, toolbar state and link popover; the HTML flows out through `onChange`
 * (the server sanitises it when saving). Styling: `admin-editor*` in globals.css.
 */

/** One box: kept as {id, text} so React keys stay stable while boxes are added or moved. */
export interface RichTextBlock {
  id: string;
  /** The box's HTML. */
  text: string;
}

let BLOCK_SEQ = 0;
/** A new box (ids are unique while the page lives). */
export const newBlock = (text = ""): RichTextBlock => ({ id: `box-${++BLOCK_SEQ}`, text });

/** The saved content: every box's HTML, in order. */
export const joinBlocks = (blocks: readonly RichTextBlock[]): string =>
  blocks.map((block) => block.text).join("");

/** The stack of boxes. `label` names the content for screen readers ("Article content"). */
export function RichTextStack({
  blocks,
  onChange,
  uploadImage,
  label,
  readOnly = false,
}: {
  blocks: readonly RichTextBlock[];
  onChange: (blocks: RichTextBlock[]) => void;
  /** Uploads an inline image; resolves to its public URL (null when the upload failed). */
  uploadImage: (file: File) => Promise<string | null>;
  label: string;
  readOnly?: boolean;
}) {
  const [dragSource, setDragSource] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const endDrag = () => {
    setDragSource(null);
    setDragOver(null);
  };
  return (
    <div className="admin-editor-list">
      {blocks.map((block, i) => (
        <RichTextBox
          key={block.id}
          value={block.text}
          label={label}
          readOnly={readOnly}
          uploadImage={uploadImage}
          onChange={(text) => {
            if (text !== block.text) onChange(blocks.map((b, j) => (j === i ? { ...b, text } : b)));
          }}
          onAdd={() => onChange([...blocks.slice(0, i + 1), newBlock(), ...blocks.slice(i + 1)])}
          onDelete={() => onChange(blocks.filter((_, j) => j !== i))}
          canDelete={blocks.length > 1}
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
            if (dragSource !== null) onChange(moveItem(blocks, dragSource, i));
            endDrag();
          }}
          onDragEnd={endDrag}
        />
      ))}
    </div>
  );
}

/** Rich-text toolbar chip (formatting button). */
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
      disabled={disabled}
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

/** One box of the stack (internal: use `RichTextStack`). */
function RichTextBox({
  value,
  onChange,
  label,
  readOnly,
  uploadImage,
  onAdd,
  onDelete,
  canDelete,
  isDragOver,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: {
  value: string;
  onChange: (text: string) => void;
  label: string;
  readOnly: boolean;
  uploadImage: (file: File) => Promise<string | null>;
  onAdd: () => void;
  onDelete: () => void;
  canDelete: boolean;
  isDragOver: boolean;
  onDragStart: () => void;
  onDragOver: (e: ReactDragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: ReactDragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}) {
  const id = useId();
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
    if (!url) return;
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
      <div
        className={isDragOver ? "admin-editor admin-editor--drag-over" : "admin-editor"}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {/* A strip above the format chips: a plus that adds a NEW box below this one, a drag
            handle that reorders it, and — when more than one box exists — a trash button that
            removes this box. Read-only content shows no strip. */}
        {!readOnly ? (
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
            disabled={readOnly}
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
            disabled={readOnly}
            icon={<img src="/Button-1.png" alt="" className="admin-editor__btn-img" />}
            label="Insert image"
            onClick={() => runCommand("image")}
          />
          <EditorButton
            disabled={readOnly}
            icon={<img src="/Button-2.png" alt="" className="admin-editor__btn-img" />}
            label="Comment"
            active={activeCmds.includes("comment")}
            onClick={() => runCommand("comment")}
          />
          <EditorButton
            disabled={readOnly}
            icon={<img src="/Button-3.png" alt="" className="admin-editor__btn-img" />}
            label="Heading 1"
            active={activeCmds.includes("h1")}
            onClick={() => runCommand("h1")}
          />
          <EditorButton
            disabled={readOnly}
            icon={<img src="/Button-4.png" alt="" className="admin-editor__btn-img" />}
            label="Heading 2"
            active={activeCmds.includes("h2")}
            onClick={() => runCommand("h2")}
          />
          <EditorButton
            disabled={readOnly}
            icon={<img src="/Button-5.png" alt="" className="admin-editor__btn-img" />}
            label="Divider"
            onClick={() => runCommand("divider")}
          />
          <EditorButton
            disabled={readOnly}
            icon={<img src="/Button-6.png" alt="" className="admin-editor__btn-img" />}
            label="Bullet list"
            active={activeCmds.includes("bullet")}
            onClick={() => runCommand("bullet")}
          />
          <EditorButton
            disabled={readOnly}
            icon={<img src="/Button-7.png" alt="" className="admin-editor__btn-img" />}
            label="Numbered list"
            active={activeCmds.includes("number")}
            onClick={() => runCommand("number")}
          />
          <EditorButton
            disabled={readOnly}
            icon={<img src="/Button-8.png" alt="" className="admin-editor__btn-img" />}
            label="Link"
            active={activeCmds.includes("link")}
            onClick={() => runCommand("link")}
          />
          <EditorButton
            disabled={readOnly}
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
            /* uploaded first: the body stores the public https URL, never a data URL */
            e.target.value = "";
            void uploadImage(file).then((url) => {
              if (url) exec("insertImage", url);
            });
          }}
        />
        <div
          ref={editorRef}
          className="admin-editor__body"
          contentEditable={!readOnly}
          role="textbox"
          aria-multiline="true"
          aria-readonly={readOnly}
          aria-label={label}
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
          <label className="admin-link-pop__label" htmlFor={`${id}-text`}>
            Text
          </label>
          <input
            id={`${id}-text`}
            className="admin-input"
            type="text"
            placeholder="Link text"
            value={linkText}
            onChange={(e) => setLinkText(e.target.value)}
          />
          <label className="admin-link-pop__label" htmlFor={`${id}-url`}>
            Hyperlink
          </label>
          <div className="admin-link-pop__row">
            <input
              id={`${id}-url`}
              className="admin-input"
              type="text"
              placeholder="https://example.com"
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
            <Button
              variant="primary"
              size="sm"
              icon="link"
              disabled={!linkUrl.trim()}
              onClick={applyLink}
            >
              Save
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
