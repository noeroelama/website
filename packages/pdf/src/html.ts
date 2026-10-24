/**
 * The sanitized rich text of a letter (news allowlist, `sanitizeRichText`) as printable blocks:
 * paragraphs, headings, list items and rules, each a list of styled runs. Images, links and
 * code are printed as their text only (letters with images or tables use the upload path).
 */
export interface Run {
  readonly text: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
}

export type Align = "left" | "center" | "right" | "justify";

export type Block =
  | {
      readonly kind: "paragraph";
      readonly runs: Run[];
      readonly align: Align;
      readonly quote: boolean;
    }
  | {
      readonly kind: "heading";
      readonly level: number;
      readonly runs: Run[];
      readonly align: Align;
    }
  | { readonly kind: "item"; readonly marker: string; readonly depth: number; readonly runs: Run[] }
  | { readonly kind: "rule" };

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code =
        name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

const BLOCK_TAGS = new Set(["p", "div", "h1", "h2", "h3", "h4", "pre", "figure", "figcaption"]);
const TOKEN = /<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/gi;

const alignOf = (attributes: string): Align | null => {
  const match = /text-align\s*:\s*(left|center|right|justify)/i.exec(attributes);
  return match ? (match[1]!.toLowerCase() as Align) : null;
};

export function htmlToBlocks(html: string): Block[] {
  const blocks: Block[] = [];
  const style = { bold: 0, italic: 0, underline: 0 };
  const lists: Array<{ ordered: boolean; n: number }> = [];
  let runs: Run[] = [];
  let open: { tag: string; align: Align | null } | null = null;
  /** The list item being read: its first block gets the marker, later blocks "" (indented). */
  let item: { marker: string; depth: number } | null = null;
  let quote = 0;

  const flush = () => {
    // Collapse white space like a browser (a <br> is kept as "\n"), then trim the block's ends.
    const collapsed = runs.map((r) =>
      r.text === "\n" ? r : { ...r, text: r.text.replace(/\s+/g, " ") },
    );
    const cleaned = collapsed
      .map((r, i) => {
        if (r.text === "\n") return r;
        const text = i === 0 ? r.text.trimStart() : r.text;
        return { ...r, text: i === collapsed.length - 1 ? text.trimEnd() : text };
      })
      .filter((r) => r.text !== "");
    const hasText = cleaned.some((r) => r.text.trim() !== "");
    if (hasText) {
      const tag = open?.tag ?? "p";
      if (item) {
        blocks.push({ kind: "item", marker: item.marker, depth: item.depth, runs: cleaned });
        item = { ...item, marker: "" };
      } else if (/^h[1-4]$/.test(tag)) {
        blocks.push({
          kind: "heading",
          level: Number(tag[1]),
          runs: cleaned,
          align: open?.align ?? "left",
        });
      } else {
        blocks.push({
          kind: "paragraph",
          runs: cleaned,
          align: open?.align ?? "justify",
          quote: quote > 0,
        });
      }
    }
    runs = [];
  };

  for (const match of html.matchAll(TOKEN)) {
    const [, closing, rawTag, attributes = "", text] = match;
    if (text !== undefined) {
      runs.push({
        text: decodeEntities(text),
        bold: style.bold > 0,
        italic: style.italic > 0,
        underline: style.underline > 0,
      });
      continue;
    }
    const tag = (rawTag as string).toLowerCase();
    const change = closing ? -1 : 1;
    if (tag === "b" || tag === "strong") style.bold = Math.max(0, style.bold + change);
    else if (tag === "i" || tag === "em") style.italic = Math.max(0, style.italic + change);
    else if (tag === "u") style.underline = Math.max(0, style.underline + change);
    else if (tag === "br") runs.push({ text: "\n", bold: false, italic: false, underline: false });
    else if (tag === "hr") {
      flush();
      blocks.push({ kind: "rule" });
    } else if (tag === "ul" || tag === "ol") {
      flush();
      if (closing) lists.pop();
      else lists.push({ ordered: tag === "ol", n: 0 });
    } else if (tag === "blockquote") {
      flush();
      quote = Math.max(0, quote + change);
    } else if (tag === "li") {
      flush();
      const list = lists.at(-1);
      item = closing
        ? null
        : {
            marker: list?.ordered ? `${(list.n += 1)}.` : "•",
            depth: Math.max(0, lists.length - 1),
          };
    } else if (BLOCK_TAGS.has(tag)) {
      flush();
      open = closing ? null : { tag, align: alignOf(attributes) };
    }
  }
  flush();
  return blocks;
}
