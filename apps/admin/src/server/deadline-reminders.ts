import "server-only";
import type { SqlApplicationStore } from "@website/db/sql";
import { messageTo, type Contact, type Messenger } from "@website/domain/messaging";
import { addDaysUtc, isOverdue, type LpjReport, type Program } from "@website/domain/programs";

export const REMINDER_DAYS = 3;

const both = (id: string, en: string) => `${id}\n\n${en}`;
const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

interface Reminder {
  readonly key: string;
  readonly uids: readonly string[];
  readonly subject: string;
  readonly text: string;
}

export function createDeadlineReminders(deps: {
  applications: Pick<SqlApplicationStore, "interviewsBetween">;
  programs: () => Promise<Program[]>;
  lpj: () => Promise<LpjReport[]>;
  contacts: (uids: readonly string[]) => Promise<Map<string, Contact>>;
  send: Messenger["send"];
  adminUrl: string;
  now: () => Date;
}) {
  return async (): Promise<{ messages: number }> => {
    const now = deps.now();
    const today = now.toISOString().slice(0, 10);
    const tomorrow = addDaysUtc(now, 1);
    const last = addDaysUtc(now, REMINDER_DAYS);
    const soon = (day: string | null): day is string => day !== null && day >= today && day <= last;
    const [interviews, programs, lpjs] = await Promise.all([
      deps.applications.interviewsBetween(
        new Date(`${tomorrow}T00:00:00Z`),
        new Date(`${addDaysUtc(now, 2)}T00:00:00Z`),
      ),
      deps.programs(),
      deps.lpj(),
    ]);

    const reminders: Reminder[] = [
      ...interviews.map((a) => {
        const at = `${a.interview?.startsAt.toISOString().slice(0, 16).replace("T", " ")} UTC`;
        return {
          key: `reminder:interview:${a.id}:${tomorrow}`,
          uids: [a.userId],
          subject: "Wawancara besok / Interview tomorrow",
          text: both(`Wawancara Anda besok, ${at}.`, `Your interview is tomorrow, ${at}.`),
        };
      }),
      ...programs
        .filter((p) => p.status === "approved" || p.status === "running")
        .flatMap((p) =>
          p.milestones
            .filter((m) => !m.completedAt && soon(m.dueOn))
            .map((m) => ({
              key: `reminder:milestone:${p.id}_${m.id}:${m.dueOn}`,
              uids: p.pics,
              subject: `Tenggat / Due: ${m.title}`,
              text: both(
                `Milestone "${m.title}" (${p.name}) jatuh tempo ${m.dueOn}.\n${deps.adminUrl}/programs/${p.id}`,
                `Milestone "${m.title}" (${p.name}) is due ${m.dueOn}.`,
              ),
            })),
        ),
      ...lpjs
        .filter((l) => l.status === "draft" || l.status === "returned")
        .flatMap((l) => {
          const link = `${deps.adminUrl}/lpj/${l.id}`;
          if (isOverdue(l, now)) {
            return [
              {
                key: `reminder:lpj-overdue:${l.id}:${l.dueOn}`,
                uids: l.pics,
                subject: "LPJ terlambat / LPJ overdue",
                text: both(
                  `LPJ "${l.plan.name}" melewati tenggat ${l.dueOn}.\n${link}`,
                  `The LPJ was due ${l.dueOn} and is not submitted yet.`,
                ),
              },
            ];
          }
          return soon(l.dueOn)
            ? [
                {
                  key: `reminder:lpj-due:${l.id}:${l.dueOn}`,
                  uids: l.pics,
                  subject: "Tenggat LPJ / LPJ due",
                  text: both(
                    `LPJ "${l.plan.name}" jatuh tempo ${l.dueOn}.\n${link}`,
                    `The LPJ is due ${l.dueOn}.`,
                  ),
                },
              ]
            : [];
        }),
    ];

    const contacts = await deps.contacts([...new Set(reminders.flatMap((r) => r.uids))]);
    let messages = 0;
    for (const r of reminders) {
      for (const uid of r.uids) {
        const status = await deps.send(
          messageTo(contacts.get(uid) ?? null, {
            subject: r.subject,
            text: r.text,
            html: `<p>${escapeHtml(r.text).replace(/\n/g, "<br>")}</p>`,
          }),
          `${r.key}:${uid}`,
        );
        if (status !== "duplicate") messages += 1;
      }
    }
    return { messages };
  };
}
