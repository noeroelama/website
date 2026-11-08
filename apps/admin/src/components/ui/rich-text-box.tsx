"use client";

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

export interface RichTextBlock {
  id: string;
  text: string;
}

let BLOCK_SEQ = 0;
export const newBlock = (text = ""): RichTextBlock => ({ id: `box-${++BLOCK_SEQ}`, text });

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

export const joinBlocks = (blocks: readonly RichTextBlock[]): string =>
  blocks.map((block) => `<div>${block.text}</div>`).join("");

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
    let inline = false;
    for (const n of nodes) {
      if (!isBlock(n) && inline) texts[texts.length - 1] += outer(n);
      else texts.push(outer(n));
      inline = !isBlock(n);
    }
  }
  return texts.length > 0 ? texts.map((text) => newBlock(text)) : [newBlock()];
}

export function RichTextStack({
  blocks,
  onChange,
  uploadImage,
  label,
  readOnly = false,
}: {
  blocks: readonly RichTextBlock[];
  onChange: (blocks: RichTextBlock[]) => void;
  uploadImage: (file: File) => Promise<string | null>;
  label: string;
  readOnly?: boolean;
}) {
  const [dragSource, setDragSource] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [focus, setFocus] = useState<{ id: string; command?: string | undefined } | null>(null);
  const endDrag = () => {
    setDragSource(null);
    setDragOver(null);
  };
  return (
    <div
      className="admin-editor-list"
      onMouseDown={(e) => {
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
      onMouseDown={(e) => e.preventDefault()}
    >
      {icon}
    </button>
  );
}

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
  autoFocus: boolean;
  startCommand: string | undefined;
  onFocused: () => void;
  uploadImage: (file: File) => Promise<string | null>;
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

  const savedRangeRef = useRef<Range | null>(null);

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
    } catch {}
    syncEditorText();
    editorRef.current?.focus();
  };

  const runCommand = (cmd: string) => {
    if (cmd === "image") editorImageInputRef.current?.click();
    if (cmd === "link") openLinkModal();
  };

  const normalizeLink = (raw: string): string => {
    const t = raw.trim();
    if (!t) return t;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(t)) return t;
    return `https://${t}`;
  };

  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkPos, setLinkPos] = useState<{ top: number; left: number } | null>(null);

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
      setLinkPos({
        top: rect.top + 8,
        left: Math.max(8, rect.left + 12),
      });
    }
    setLinkOpen(true);
  };

  const applyLink = () => {
    const el = editorRef.current;
    if (!el) return;
    const url = linkUrl.trim();
    if (!url) return;
    restoreRange();
    const sel = document.getSelection();
    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    const full = normalizeLink(url);
    const text = linkText.trim() || url;
    if (range && !range.collapsed) {
      document.execCommand("createLink", false, full);
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
        const r = document.createRange();
        r.setStartAfter(anchor);
        r.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(r);
        savedRangeRef.current = r.cloneRange();
      }
    } else {
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

  const onEditorBlur = () => {
    saveRange();
  };

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

  const onEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const empty = !el.textContent?.trim() && !el.querySelector("img, hr");
    if (e.key === "Backspace" && empty && canDelete) {
      e.preventDefault();
      onDelete();
    }
  };

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
        {!readOnly ? (
          <div
            className="admin-editor__add"
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
                e.currentTarget.focus();
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
                if (editorRef.current) e.dataTransfer.setDragImage(editorRef.current, 0, 0);
                e.dataTransfer.setData("text/plain", "");
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
