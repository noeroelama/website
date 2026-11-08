"use server";

import { z } from "zod";
import { verification } from "@/server/verification-wiring";

const Input = z.object({ code: z.string().max(20), name: z.string().max(200) }).strict();

export async function openLetterAction(input: unknown) {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false as const };
  const view = await verification().view(parsed.data.code, parsed.data.name);
  if (view?.kind !== "letter") return { ok: false as const };
  return {
    ok: true as const,
    content: view.content,
    bodyHtml: view.bodyHtml,
    wrongName: view.wrongName,
    canDownload: view.canDownload,
  };
}
