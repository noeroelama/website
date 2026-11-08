import { z } from "zod";
import { safeId } from "@website/security/validation";

export const CursorQuerySchema = z.object({
  cursor: safeId.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type CursorQuery = z.infer<typeof CursorQuerySchema>;

export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    nextCursor: z.string().nullable(),
  });
}
