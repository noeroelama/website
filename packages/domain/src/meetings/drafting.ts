import { z } from "zod";

export interface DraftRequest {
  readonly title: string;
  readonly agenda: ReadonlyArray<{ id: string; title: string }>;
  readonly participants: ReadonlyArray<{ uid: string; name: string }>;
  readonly transcript: string;
}

export const MAX_TRANSCRIPT_CHARS = 200_000;

export const DraftOutputSchema = z
  .object({
    items: z
      .array(z.object({ agendaItemId: z.string().max(200), notes: z.string().max(20_000) }))
      .max(30),
    actionItems: z
      .array(
        z.object({
          title: z.string().min(1).max(500),
          picUid: z.string().max(200).nullable(),
          dueOn: z.iso.date().nullable(),
        }),
      )
      .max(50),
  })
  .strip();
export type DraftOutput = z.infer<typeof DraftOutputSchema>;

export interface MinutesDrafter {
  draft(request: DraftRequest): Promise<DraftOutput>;
}

export const draftNotes = (draft: DraftOutput): Record<string, string> =>
  Object.fromEntries(draft.items.map((i) => [i.agendaItemId, i.notes]));

export const draftProposals = (draft: DraftOutput, participantIds: readonly string[]) =>
  draft.actionItems.map((a) => ({
    title: a.title,
    pic: a.picUid !== null && participantIds.includes(a.picUid) ? a.picUid : null,
    dueOn: a.dueOn,
  }));

const TIMING = /^\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}\s+-->\s+/;
const SPEAKER = /^([^:]{1,60}):\s+(.*)$/;

export function parseVtt(vtt: string): string {
  const lines: string[] = [];
  let inNote = false;
  for (const raw of vtt.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (line === "") {
      inNote = false;
      continue;
    }
    if (inNote || line === "WEBVTT" || line.startsWith("WEBVTT ")) continue;
    if (line.startsWith("NOTE")) {
      inNote = true;
      continue;
    }
    if (/^\d+$/.test(line) || TIMING.test(line)) continue;
    lines.push(line.replace(/<[^>]+>/g, ""));
  }
  const counts = new Map<string, number>();
  for (const line of lines) {
    const name = SPEAKER.exec(line)?.[1];
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const out: Array<{ speaker: string | null; text: string }> = [];
  for (const line of lines) {
    const m = SPEAKER.exec(line);
    const said = m && (counts.get(m[1] as string) as number) >= 2 ? m : null;
    const speaker = said ? (said[1] as string) : null;
    const text = said ? (said[2] as string) : line;
    const last = out[out.length - 1];
    if (last && speaker !== null && last.speaker === speaker) last.text += ` ${text}`;
    else out.push({ speaker, text });
  }
  return out.map((o) => (o.speaker ? `${o.speaker}: ${o.text}` : o.text)).join("\n");
}
