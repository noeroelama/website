import sanitizeHtml from "sanitize-html";

/** http image URLs on this machine only (localhost, 127.0.0.1); malformed URLs are not. */
function isLoopback(src: string): boolean {
  try {
    return ["localhost", "127.0.0.1"].includes(new URL(src).hostname);
  } catch {
    return false;
  }
}

/**
 * Rich text allowlist (news bodies, newsletter campaigns). Run it when the text is SAVED and
 * again when it is RENDERED. Everything not listed is removed: scripts, styles, event handlers,
 * iframes, forms, SVG, inline styles (except text alignment from the admin editor). Links may only be https/http/mailto and open safely; images
 * only from https URLs — or plain http from this machine, where local development serves the
 * uploads (http://localhost:3000/files/…).
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "div",
    "br",
    "h1",
    "h2",
    "h3",
    "h4",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "blockquote",
    "ul",
    "ol",
    "li",
    "a",
    "img",
    "figure",
    "figcaption",
    "hr",
    "code",
    "pre",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "width", "height"],
    "*": ["style"],
  },
  allowedStyles: { "*": { "text-align": [/^(left|right|center|justify)$/] } },
  allowedSchemes: ["https", "http", "mailto"],
  allowedSchemesByTag: { img: ["https", "http"] },
  exclusiveFilter: (frame) => {
    const src = frame.attribs["src"] ?? "";
    return frame.tag === "img" && /^http:/i.test(src) && !isLoopback(src);
  },
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }),
  },
};

export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, OPTIONS);
}

/** Text only (no tags, no scripts): the plain-text part of an HTML e-mail. */
export function htmlToText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).trim();
}
