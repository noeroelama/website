# @website/pdf

PDF and QR rendering for documents (DEC-6): `pdf-lib` draws the pages with the standard Times
fonts, `qrcode` makes the verification QR. Pure JavaScript (no browser, no native module), so it
runs on the DomaiNesia host. Server-side only (apps call it from `src/server/**`).

## Responsibilities

- `renderLetterPdf(input)` — an A4 letter laid out like PPIDK's letter template.
- `htmlToBlocks(html)` — the sanitized letter body as printable blocks.
- `qrPng(text, size)` — a QR PNG with the shared rules of `@website/domain/documents` (qr.ts).

## Structure

| File            | Purpose                                                                     |
| --------------- | --------------------------------------------------------------------------- |
| `src/html.ts`   | Sanitized rich text → paragraphs, headings, list items, rules (styled runs) |
| `src/flow.ts`   | Text layout: WinAnsi-safe text, word wrap, justification, page breaks       |
| `src/letter.ts` | The letter: letterhead (images or text), meta, body, desks, QR, stamp       |
| `src/qr.ts`     | QR PNG                                                                      |

## Rules

- Inputs are plain data: images are PNG or JPEG bytes (the admin converts WebP uploads first).
- Characters the standard fonts cannot draw print as `?` (Indonesian and English text is fine).
- Images and tables inside a letter body are not printed: such letters use the upload path.

## Commands

```bash
pnpm --filter @website/pdf lint
pnpm --filter @website/pdf typecheck
```

## Documentation

Feature docs: [`packages/domain/docs/documents.md`](../domain/docs/documents.md) (Letter PDF).
Project-wide guides: [../../docs/](../../docs/README.md).
