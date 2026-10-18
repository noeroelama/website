import { describe, expect, it } from "vitest";
import { sanitizeRichText } from "@website/security/html";

describe("rich text sanitiser (news body, campaigns): allowlist on write AND render", () => {
  it("keeps headings, paragraphs, emphasis, lists, links and https images", () => {
    const html =
      '<h2>Judul</h2><p><strong>Tebal</strong> <em>miring</em> <u>garis</u></p><ul><li>satu</li></ul><ol><li>dua</li></ol><blockquote>kutip</blockquote><p><a href="https://ppiasiania.id/x">tautan</a></p><img src="https://firebasestorage.googleapis.com/v0/b/x/o/a.webp" alt="foto">';
    const clean = sanitizeRichText(html);
    for (const part of [
      "<h2>Judul</h2>",
      "<strong>Tebal</strong>",
      "<em>miring</em>",
      "<ul><li>satu</li></ul>",
      "<ol>",
      "<blockquote>",
      'alt="foto"',
    ])
      expect(clean).toContain(part);
    expect(clean).toContain('href="https://ppiasiania.id/x"');
    expect(clean).toContain('rel="noopener noreferrer"');
  });

  it("removes scripts, styles, event handlers, iframes, forms and dangerous URLs", () => {
    const evil =
      '<script>alert(1)</script><style>p{}</style><p onclick="steal()" style="color:red">x</p><iframe src="https://e.example"></iframe><form><input></form><a href="javascript:alert(1)">j</a><a href="data:text/html,x">d</a><img src="http://insecure.example/a.png" onerror="x()"><img src="data:image/png;base64,AAA"><svg><use href="#x"/></svg>';
    const clean = sanitizeRichText(evil);
    for (const bad of [
      "<script",
      "alert(1)",
      "<style",
      "onclick",
      "style=",
      "<iframe",
      "<form",
      "<input",
      "javascript:",
      "data:",
      "onerror",
      "http://insecure",
      "<svg",
    ])
      expect(clean, bad).not.toContain(bad);
    expect(clean).toContain("<p>x</p>");
  });

  it("keeps what the admin editor makes: H1, code, div lines and text alignment only", () => {
    const clean = sanitizeRichText(
      '<h1>A</h1><div style="text-align: center; color: red">b</div><p><code>c</code></p><pre>d</pre><p style="position:fixed">e</p>',
    );
    expect(clean).toContain("<h1>A</h1>");
    expect(clean).toContain('<div style="text-align:center">b</div>');
    expect(clean).toContain("<code>c</code>");
    expect(clean).toContain("<pre>d</pre>");
    expect(clean).toContain("<p>e</p>");
    expect(clean).not.toContain("color");
  });

  it("is stable: sanitising clean output again changes nothing", () => {
    const once = sanitizeRichText('<p><a href="https://a.example">a</a> <b>b</b></p>');
    expect(sanitizeRichText(once)).toBe(once);
  });
});
