# Image uploads (files)

## What it does

Staff upload images (event banners, speaker photos, article images, gallery photos, chapter
logos, unit member photos, KTM scans) exactly as the Figma flowchart's image pipeline says: only jpg, jpeg, png or
webp, at most 5 MB, checked in the browser and again on the server; the server stores a WebP
copy (longest side ≤ 2400 px or the preset's limit, quality 82, metadata stripped) plus a 480 px
wide thumbnail for tables and card grids.

## Where it lives

| Part                                     | File                                                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Rules: types, 5 MB, magic bytes, presets | `packages/domain/src/shared/images.ts`                                                               |
| Storage adapter (MySQL `files`)          | `packages/db/src/sql/storage.ts` (`createDbFileStorage`)                                             |
| Serving: `/files/…`, `/private-files?t=` | `apps/web/src/server/files.ts` (`createFileRoutes`)                                                  |
| Server pipeline + route logic (sharp)    | `apps/admin/src/server/images.ts` (`createImageUploads`)                                             |
| Route                                    | `apps/admin/src/app/api/uploads/[preset]/route.ts`                                                   |
| Browser: checks, compression, upload     | `apps/admin/src/components/image-upload.ts` (`useImageUpload`)                                       |
| Drop zone (presentational)               | `apps/admin/src/components/ui/drop-zone.tsx`                                                         |
| Tests                                    | `tests/unit/images.test.ts`, `tests/security/uploads.test.ts`, `tests/security/file-storage.test.ts` |

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

## Private PDFs

- `read(path)` on the same adapter returns a stored file's bytes on the server (letter archives,
  letterhead images for rendering). Letter archives are saved private
  (`contentType: application/pdf`) and checked against their sha256 when served
  (`packages/domain/docs/documents.md` → Letter PDF).
- Preset `letterhead` (`letter_types.edit`, public, longest side 2400 px ≈ A4 at 290 dpi).

## Rules and assumptions

- `POST /api/uploads/<preset>`: same origin (request guard), staff only, the page's edit
  permission (`banner`/`speaker` → `events.edit`, `thumbnail` → `articles.edit`, `gallery` →
  `gallery.edit`, `logo` → `organizations.edit`, `cabinet` → `structure.edit`, `ktm` →
  `members.edit`) checked before the body
  is read; body > 5 MB → 413 "Maximum file size is 5 MB"; real type from the bytes (SVG, GIF and
  broken files → 400 "File type not supported"). Signatures are uploaded on web later.
- Browser: `checkImageFile` first (nothing is uploaded when it fails), then the native canvas
  shrinks the image to WebP (no library); the server re-encodes anyway.
- Web and admin keep files in the MySQL `files` collection (`createDbFileStorage`, id `public/<path>` or `private/<path>`, bytes as base64), so no folder or `FILE_STORAGE_DIR` is needed. The ops scripts that copy or import files (`copy-firestore-to-mysql.mjs --files`, `import-ppidk-{documents,programs,recruitment}.mjs --files`) write through the same adapter, so what they copy is served immediately. `createDiskFileStorage` (folder `public/<path>` and `private/<path>`) is kept for tests and a possible return to disk storage; nothing in production uses it.
  Paths are checked (`checkFilePath`: plain names only, no `..`, no absolute paths).
- Storage names: `<folder>/<preset>_<timestamp>_<uuid8>.webp` and `…_thumb.webp`, never
  overwritten. Public presets get the URL `<WEB_URL>/files/<path>`, served by web with
  `Cache-Control: public, max-age=31536000, immutable`; private presets (`ktm`, `signature`) and
  PDFs get no URL — read them with `signedReadUrl(path)` (a `<WEB_URL>/private-files?t=` link
  signed with `LINK_SIGNING_SECRET`, 15 minutes, purpose `file`) after a permission check.
- Each upload writes an `UPLOAD` audit entry (not revertible). Files are not deleted when a
  record changes, so a revert within 14 days still finds them.

## Configuration

- `WEB_URL`, the same on web and admin; `LINK_SIGNING_SECRET` (the same on both) for private links.
- Backups: the files are rows in the database, so the nightly `mysqldump` includes them
  (`docs/disaster-recovery.md`).
- `sharp` (native) is a dependency of admin. The cPanel host's glibc is old: after the first
  deploy run `node -e "require('sharp')"` in the admin app root. If it fails, install the
  WebAssembly build instead (`npm install --cpu=wasm32 sharp`, package `@img/sharp-wasm32`):
  same API, slower, no native code — then record it in `docs/deployment.md`.
