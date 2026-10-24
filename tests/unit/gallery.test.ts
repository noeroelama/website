import { describe, expect, it } from "vitest";
import { AlbumInputSchema, canHaveAlbum, toPublicAlbum, type Album } from "@website/domain/gallery";

const image = {
  url: "https://storage.example/galleries/a.webp",
  thumbUrl: "https://storage.example/galleries/a_thumb.webp",
  path: "galleries/a.webp",
  thumbPath: "galleries/a_thumb.webp",
  width: 2400,
  height: 1600,
};
const valid = {
  eventId: "e1",
  images: [image],
  totalPhotos: 150,
  albumUrl: "https://photos.app.goo.gl/abc",
  slug: "",
};

describe("gallery album (GALLERY DASHBOARD)", () => {
  it("needs an event and 1 to 10 images", () => {
    expect(AlbumInputSchema.safeParse(valid).success).toBe(true);
    expect(AlbumInputSchema.safeParse({ ...valid, images: [] }).success).toBe(false);
    expect(AlbumInputSchema.safeParse({ ...valid, images: Array(10).fill(image) }).success).toBe(
      true,
    );
    expect(AlbumInputSchema.safeParse({ ...valid, images: Array(11).fill(image) }).success).toBe(
      false,
    );
    expect(AlbumInputSchema.safeParse({ ...valid, eventId: "" }).success).toBe(false);
  });

  it("total photos is required and never negative; the album link must be http(s)", () => {
    expect(AlbumInputSchema.parse({ ...valid, totalPhotos: 0 }).totalPhotos).toBe(0);
    for (const bad of [
      { totalPhotos: null },
      { totalPhotos: -1 },
      { totalPhotos: 1.5 },
      { albumUrl: "" },
      { albumUrl: "javascript:alert(1)" },
      { albumUrl: "ftp://x" },
      { slug: "Bad Slug" },
      { extra: 1 },
    ]) {
      expect(AlbumInputSchema.safeParse({ ...valid, ...bad }).success, JSON.stringify(bad)).toBe(
        false,
      );
    }
  });

  it("only a published, live event can have an album", () => {
    expect(canHaveAlbum({ published: true, deletedAt: null })).toBe(true);
    expect(canHaveAlbum({ published: false, deletedAt: null })).toBe(false);
    expect(canHaveAlbum({ published: true, deletedAt: new Date() })).toBe(false);
  });

  it("public album: cover, count (total or number of images), no internal fields", () => {
    const now = new Date("2026-10-18T00:00:00Z");
    const album: Album = {
      id: "a1",
      version: 2,
      slug: "simposium",
      eventId: "e1",
      eventTitle: "Simposium",
      images: [image, image],
      totalPhotos: null,
      albumUrl: "https://photos.app.goo.gl/abc",
      published: true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    const dto = toPublicAlbum(album);
    expect(dto).toMatchObject({ slug: "simposium", photoCount: 2, cover: image });
    expect(dto).not.toHaveProperty("version");
    expect(toPublicAlbum({ ...album, totalPhotos: 150 }).photoCount).toBe(150);
    // Albums imported from PPIDK may have no featured image yet.
    expect(toPublicAlbum({ ...album, images: [] })).toMatchObject({ cover: null, photoCount: 0 });
  });
});

describe("Gallery page rows (server mapping)", () => {
  const now = new Date("2026-10-18T00:00:00Z");
  const album: Album = {
    id: "a1",
    version: 1,
    slug: "s",
    eventId: "e1",
    eventTitle: "S",
    images: [image],
    totalPhotos: null,
    albumUrl: "https://photos.app.goo.gl/abc",
    published: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  it("maps status, the photo count, the event type and the author", async () => {
    const { toAlbumItem } = await import("../../apps/admin/src/components/gallery-model");
    const author = { name: "Nevyllo K.", email: "nk@example.org", initials: "NK" };
    expect(toAlbumItem(album, "Symposium", null)).toMatchObject({
      status: "draft",
      photoCount: 1,
      total: null,
      eventType: "Symposium",
      author: null,
    });
    expect(toAlbumItem({ ...album, published: true, totalPhotos: 9 }, "", author)).toMatchObject({
      status: "published",
      photoCount: 9,
      author,
    });
  });

  it("the author is whoever made the album's newest audited change", async () => {
    const { lastEditors } = await import("../../apps/admin/src/components/authors");
    const entry = (resourceId: string, id: string, resourceType = "album") => ({
      resourceType,
      resourceId,
      actor: { type: "staff" as const, id, email: `${id}@example.org` },
    });
    // Audit entries come newest first: the first entry per album wins.
    const editors = lastEditors(
      [entry("a1", "ana"), entry("a2", "budi"), entry("a1", "citra"), entry("x", "dewi", "event")],
      "album",
    );
    expect([...editors.entries()].map(([album, actor]) => [album, actor.id])).toEqual([
      ["a1", "ana"],
      ["a2", "budi"],
    ]);
  });

  it("shows the author as first name + last initial, falling back to the e-mail", async () => {
    const { toAuthor } = await import("../../apps/admin/src/components/authors");
    expect(toAuthor("Nevyllo Zamuel Kalangi", "nk@example.org")).toEqual({
      name: "Nevyllo K.",
      email: "nk@example.org",
      initials: "NK",
    });
    expect(toAuthor("  Ana  ", "ana@example.org")).toEqual({
      name: "Ana",
      email: "ana@example.org",
      initials: "A",
    });
    expect(toAuthor(null, "budi.santoso@example.org")).toEqual({
      name: "budi.santoso",
      email: "budi.santoso@example.org",
      initials: "B",
    });
    expect(toAuthor(null, null)).toBeNull();
  });
});
