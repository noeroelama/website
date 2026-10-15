import { describe, expect, it } from "vitest";
import {
  checkImageFile,
  detectImageType,
  IMAGE_ERROR_MESSAGES,
  IMAGE_PRESETS,
  imagePaths,
  MAX_IMAGE_BYTES,
} from "@website/domain/shared";

const bytes = (...values: number[]) =>
  new Uint8Array([...values, ...new Array<number>(16).fill(0)]);
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

describe("image upload rules (flowchart section 2, DEC-12)", () => {
  it("accepts only jpg, jpeg, png and webp up to 5 MB, with the flowchart's messages", () => {
    expect(checkImageFile({ type: "image/jpeg", size: 1000 })).toBeNull();
    expect(checkImageFile({ type: "image/png", size: MAX_IMAGE_BYTES })).toBeNull();
    expect(checkImageFile({ type: "image/webp", size: 1 })).toBeNull();
    expect(checkImageFile({ type: "image/svg+xml", size: 10 })).toBe("unsupported_type");
    expect(checkImageFile({ type: "image/gif", size: 10 })).toBe("unsupported_type");
    expect(checkImageFile({ type: "image/png", size: MAX_IMAGE_BYTES + 1 })).toBe("too_large");
    expect(IMAGE_ERROR_MESSAGES).toEqual({
      unsupported_type: "File type not supported",
      too_large: "Maximum file size is 5 MB",
    });
  });

  it("detects the real type from the first bytes, never from the name or header", () => {
    expect(detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(detectImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(
      "image/png",
    );
    expect(detectImageType(bytes(...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WEBP")))).toBe(
      "image/webp",
    );
    expect(detectImageType(bytes(...ascii("<svg xmlns")))).toBeNull();
    expect(detectImageType(bytes(...ascii("GIF89a")))).toBeNull();
    expect(detectImageType(new Uint8Array([0xff]))).toBeNull();
  });

  it("every preset has a folder, a size limit and a visibility; KTM and signatures are private", () => {
    for (const [name, preset] of Object.entries(IMAGE_PRESETS)) {
      expect(preset.folder, name).toMatch(/^[a-z]+(\/[a-z-]+)*$/);
      expect(preset.maxPx, name).toBeGreaterThanOrEqual(480);
      expect(preset.maxPx, name).toBeLessThanOrEqual(2400);
    }
    expect(IMAGE_PRESETS.ktm.visibility).toBe("private");
    expect(IMAGE_PRESETS.signature.visibility).toBe("private");
    expect(IMAGE_PRESETS.banner.visibility).toBe("public");
  });

  it("names objects <folder>/<preset>_<timestamp>_<uuid8>.webp plus a _thumb variant", () => {
    expect(imagePaths("banner", new Date("2026-10-16T00:00:00Z"), "0123456789abcdef")).toEqual({
      path: "events/banners/banner_1792108800000_01234567.webp",
      thumbPath: "events/banners/banner_1792108800000_01234567_thumb.webp",
    });
  });
});
