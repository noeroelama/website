# Image uploads (files)

## What it does

Staff upload images (event banners, speaker photos, article images, gallery photos, chapter
logos, KTM scans) exactly as the Figma flowchart's image pipeline says: only jpg, jpeg, png or
webp, at most 5 MB, checked in the browser and again on the server; the server stores a WebP
copy (longest side ≤ 2400 px or the preset's limit, quality 82, metadata stripped) plus a 480 px
wide thumbnail for tables and card grids.

## Where it lives

| Part                                     | File                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------- |
| Rules: types, 5 MB, magic bytes, presets | `packages/domain/src/shared/images.ts`                                |
| Firebase Storage adapter                 | `packages/db/src/firestore/storage.ts` (`createFirebaseImageStorage`) |
| Server pipeline + route logic (sharp)    | `apps/admin/src/server/images.ts` (`createImageUploads`)              |
| Route                                    | `apps/admin/src/app/api/uploads/[preset]/route.ts`                    |
| Browser: checks, compression, upload     | `apps/admin/src/components/image-upload.ts` (`useImageUpload`)        |
| Drop zone (presentational)               | `apps/admin/src/components/ui/drop-zone.tsx`                          |
| Tests                                    | `tests/unit/images.test.ts`, `tests/security/uploads.test.ts`         |

## How to use it

```tsx
const { upload, busy, error } = useImageUpload("banner");
<DropZone
  label="Drag & drop the banner or click to browse"
  hint="JPG, PNG or WebP • max 5 MB"
  previewUrl={banner?.thumbUrl}
  busy={busy}
  error={error}
  onFile={async (file) => setBanner(await upload(file))}
/>;
// store { path, thumbPath, url, thumbUrl, width, height } on the record
```

## Rules and assumptions

- `POST /api/uploads/<preset>`: same origin (request guard), staff only, the page's edit
  permission (`banner`/`speaker` → `events.edit`, `thumbnail` → `articles.edit`, `gallery` →
  `gallery.edit`, `logo` → `organizations.edit`, `ktm` → `members.edit`) checked before the body
  is read; body > 5 MB → 413 "Maximum file size is 5 MB"; real type from the bytes (SVG, GIF and
  broken files → 400 "File type not supported"). Signatures are uploaded on web later.
- Browser: `checkImageFile` first (nothing is uploaded when it fails), then the native canvas
  shrinks the image to WebP (no library); the server re-encodes anyway.
- Storage names: `<folder>/<preset>_<timestamp>_<uuid8>.webp` and `…_thumb.webp`, never
  overwritten. Public presets get a download-token URL with `Cache-Control: public,
max-age=31536000, immutable`; private presets (`ktm`, `signature`) get no URL — read them with
  `signedReadUrl(path)` (15 minutes) after a permission check.
- Each upload writes an `UPLOAD` audit entry (not revertible). Files are not deleted when a
  record changes; Storage soft delete (≥ 30 days) covers the 14-day revert window.

## Configuration

- `FIREBASE_STORAGE_BUCKET` in admin (e.g. `ppidk-website-prod.firebasestorage.app`).
- `sharp` (native) is a dependency of admin. The cPanel host's glibc is old: after the first
  deploy run `node -e "require('sharp')"` in the admin app root. If it fails, install the
  WebAssembly build instead (`npm install --cpu=wasm32 sharp`, package `@img/sharp-wasm32`):
  same API, slower, no native code — then record it in `docs/deployment.md`.
