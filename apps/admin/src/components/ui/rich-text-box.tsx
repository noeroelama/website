"use client";

// Editor toolbar icons are bundled 30×30 PNG tiles (public/Button-*.png): static assets with no
// LCP or bandwidth concern, so plain <img> — not next/image — is deliberate here.
/* eslint-disable @next/next/no-img-element */

import {
  useEffect,
  useEffectEvent,
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

/** The + menu (as in PPIT): each entry adds a box below, holding `html` or started with `command`. */
interface BlockKind {
  label: string;
  tile: string;
  html?: string;
  command?: "image" | "link";
}
const BLOCK_MENU: readonly BlockKind[] = [
  { label: "Paragraph", tile: "/Button-align-left.png" },
  { label: "Image", tile: "/Button-1.png", command: "image" },
  { label: "Quote", tile: "/Button-2.png", html: "<blockquote><br></blockquote>" },
  { label: "Heading 1", tile: "/Button-3.png", html: "<h1><br></h1>" },
  { label: "Heading 2", tile: "/Button-4.png", html: "<h2><br></h2>" },
  { label: "Divider", tile: "/Button-5.png", html: "<hr>" },
  { label: "Bullet list", tile: "/Button-6.png", html: "<ul><li><br></li></ul>" },
  { label: "Numbered list", tile: "/Button-7.png", html: "<ol><li><br></li></ol>" },
  { label: "Link", tile: "/Button-8.png", command: "link" },
  { label: "Code", tile: "/Button-9.png", html: "<code><br></code>" },
];

/** Puts the caret at the end of a box's text (inside its last paragraph or item) and focuses it. */
function focusEnd(el: HTMLElement) {
  el.focus();
  let target: Element = el;
  while (target.lastElementChild && !["BR", "HR", "IMG"].includes(target.lastElementChild.tagName))
    target = target.lastElementChild;
  const range = document.createRange();
  range.selectNodeContents(target);
  range.collapse(false);
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
}

/** The saved content: each box's HTML in its own <div>, in order, so `splitBlocks` gets the
    same boxes back when the content is edited again. */
export const joinBlocks = (blocks: readonly RichTextBlock[]): string =>
  blocks.map((block) => `<div>${block.text}</div>`).join("");

/** Tags that start a new box in content saved before boxes were kept (see `splitBlocks`). */
const BLOCK_TAGS = [
  "P",
  "DIV",
  "H1",
  "H2",
  "H3",
  "H4",
  "BLOCKQUOTE",
  "UL",
  "OL",
  "HR",
  "PRE",
  "FIGURE",
];

/**
 * The boxes of saved content (browser only; the <template> parses without loading anything).
 * Content from `joinBlocks` is a row of <div>s, one per box. Older content was one long HTML:
 * each block element becomes a box, and text or inline tags next to each other share one.
 */
export function splitBlocks(html: string): RichTextBlock[] {
  const template = document.createElement("template");
  template.innerHTML = html;
  const nodes = [...template.content.childNodes].filter(
    (n) => n.textContent?.trim() || n instanceof Element,
  );
  const outer = (n: Node) => (n instanceof Element ? n.outerHTML : (n.textContent ?? ""));
  const isBlock = (n: Node) => n instanceof Element && BLOCK_TAGS.includes(n.tagName);
  const texts: string[] = [];
  if (nodes.every((n) => n instanceof Element && n.tagName === "DIV")) {
    for (const n of nodes) texts.push((n as Element).innerHTML);
  } else {
    let inline = false; // the last box holds text or inline tags
    for (const n of nodes) {
      if (!isBlock(n) && inline) texts[texts.length - 1] += outer(n);
      else texts.push(outer(n));
      inline = !isBlock(n);
    }
  }
  return texts.length > 0 ? texts.map((text) => newBlock(text)) : [newBlock()];
}

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
  /* The box that takes the caret next (a new box from the + menu, or the one above a removed
     box), and the menu command it starts with. */
  const [focus, setFocus] = useState<{ id: string; command?: string | undefined } | null>(null);
  const endDrag = () => {
    setDragSource(null);
    setDragOver(null);
  };
  return (
    <div
      className="admin-editor-list"
      onMouseDown={(e) => {
        // A click on the empty space below the content continues the last box.
        const bodies = e.currentTarget.querySelectorAll<HTMLElement>(".admin-editor__body");
        const last = bodies[bodies.length - 1];
        if (e.target !== e.currentTarget || readOnly || !last) return;
        e.preventDefault();
        focusEnd(last);
      }}
    >
      {blocks.map((block, i) => (
        <RichTextBox
          key={block.id}
          value={block.text}
          label={label}
          readOnly={readOnly}
          autoFocus={block.id === focus?.id}
          startCommand={block.id === focus?.id ? focus.command : undefined}
          onFocused={() => setFocus(null)}
          uploadImage={uploadImage}
          onChange={(text) => {
            if (text !== block.text) onChange(blocks.map((b, j) => (j === i ? { ...b, text } : b)));
          }}
          onAdd={(kind) => {
            const added = newBlock(kind.html);
            setFocus({ id: added.id, command: kind.command });
            onChange([...blocks.slice(0, i + 1), added, ...blocks.slice(i + 1)]);
          }}
          onDelete={() => {
            const above = blocks[i - 1];
            setFocus(above ? { id: above.id } : null);
            onChange(blocks.filter((_, j) => j !== i));
          }}
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

/** One entry of the + block menu. */
function EditorButton({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="admin-editor__btn"
      aria-label={label}
      title={label}
      onClick={onClick}
      /* Keep focus in the editor until the new box takes it. */
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
  autoFocus,
  startCommand,
  onFocused,
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
  /** Take the caret (end of the text) when this turns true, then run `startCommand`. */
  autoFocus: boolean;
  startCommand: string | undefined;
  onFocused: () => void;
  uploadImage: (file: File) => Promise<string | null>;
  /** Adds a box below: a paragraph, heading, list, image … picked in the + menu. */
  onAdd: (kind: BlockKind) => void;
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
  };

  /* The + menu entries that need the new box itself: pick an image to upload, or open the
   link popover. (Headings, lists, quotes, code and dividers arrive as the box's HTML.) */
  const runCommand = (cmd: string) => {
    if (cmd === "image") editorImageInputRef.current?.click();
    if (cmd === "link") openLinkModal();
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

  /* A box added from the + menu mounts with the caret: it comes in with an animation. */
  const [isNew] = useState(autoFocus);
  const [menuOpen, setMenuOpen] = useState(false);

  const takeFocus = useEffectEvent(() => {
    if (!editorRef.current) return;
    focusEnd(editorRef.current);
    if (startCommand) runCommand(startCommand);
    onFocused();
  });
  useEffect(() => {
    if (autoFocus) takeFocus();
  }, [autoFocus]);

  /* Backspace in an empty box removes it (the caret moves to the box above). */
  const onEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const empty = !el.textContent?.trim() && !el.querySelector("img, hr");
    if (e.key === "Backspace" && empty && canDelete) {
      e.preventDefault();
      onDelete();
    }
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
        className={[
          "admin-editor",
          isNew && "admin-editor--new",
          isDragOver && "admin-editor--drag-over",
        ]
          .filter(Boolean)
          .join(" ")}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {/* Under each box, a plus that opens the block menu; the chosen entry adds a box below. Left of the text, a drag handle that reorders the box; when more
            than one box exists, a trash button at the end removes it. Read-only content shows
            none of them. */}
        {!readOnly ? (
          <div
            className="admin-editor__add"
            /* The menu closes on Escape and when focus leaves the + and its menu. */
            onKeyDown={(e) => {
              if (e.key === "Escape") setMenuOpen(false);
            }}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) setMenuOpen(false);
            }}
          >
            <button
              type="button"
              className="admin-editor__top-btn"
              aria-label="Add a block below"
              title="Add a block below"
              aria-haspopup="true"
              aria-expanded={menuOpen}
              onClick={(e) => {
                e.currentTarget.focus(); // Safari does not focus buttons on click
                setMenuOpen((open) => !open);
              }}
            >
              <Icon name="plus" size={16} />
            </button>
            {menuOpen ? (
              <div className="admin-editor__toolbar" role="toolbar" aria-label="Add a block">
                {BLOCK_MENU.map((kind) => (
                  <EditorButton
                    key={kind.label}
                    icon={<img src={kind.tile} alt="" className="admin-editor__btn-img" />}
                    label={kind.label}
                    onClick={() => {
                      setMenuOpen(false);
                      onAdd(kind);
                    }}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {!readOnly ? (
          <div className="admin-editor__top">
            <span
              className="admin-editor__top-drag"
              draggable
              role="img"
              aria-label="Drag handle"
              title="Drag to reorder"
              onDragStart={(e) => {
                // The drag preview is the box's text, not just the grip icon.
                if (editorRef.current) e.dataTransfer.setDragImage(editorRef.current, 0, 0);
                e.dataTransfer.setData("text/plain", ""); // Firefox only starts a drag with data
                onDragStart();
              }}
              onDragEnd={onDragEnd}
            >
              <Icon name="gripBold" size={16} />
            </span>
          </div>
        ) : null}
        {!readOnly && canDelete ? (
          <button
            type="button"
            className="admin-editor__top-btn admin-editor__top-btn--danger"
            aria-label="Delete this type box"
            title="Delete this type box"
            onClick={onDelete}
          >
            <Icon name="trash" size={16} />
          </button>
        ) : null}
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
          onKeyDown={onEditorKeyDown}
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
              type="url"
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
