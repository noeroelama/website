import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Conversation, SqlConversationStore } from "@website/db/sql";
import { normalizeUniversityName } from "@website/domain/members";
import { readBodyLimited } from "@website/security";

export const CONVERSATION_TTL_MS = 30 * 60_000;
const MAX_OPTIONS = 9;

export interface ChatbotDeps {
  readonly conversations: Pick<SqlConversationStore, "get" | "save">;
  readonly phoneId: (phone: string) => string;
  readonly chapters: () => Promise<
    ReadonlyArray<{ id: string; name: string; countryCode: string }>
  >;
  readonly universities: (
    countryCode: string,
  ) => Promise<ReadonlyArray<{ id: string; name: string }>>;
  readonly matchCampus:
    ((typed: string, names: readonly string[]) => Promise<number | null>) | null;
  readonly ensureAccount: (email: string, name: string) => Promise<string>;
  readonly recordUser: (uid: string, email: string, name: string) => Promise<void>;
  readonly openRecruitments: () => Promise<ReadonlyArray<{ id: string; title: string }>>;
  readonly webUrl: string;
  readonly logError: (message: string, fields: Record<string, unknown>) => void;
  readonly now: () => Date;
}

const MENU = [
  "Menu PPIDK Asia-Oseania:",
  "• daftar: buat akun anggota / create a member account",
  "• oprec: lowongan pengurus yang dibuka / open recruitments",
  "• bantuan: bantuan / help",
  "• batal: batalkan / cancel",
].join("\n");
const HELP =
  "Ketik *daftar* untuk membuat akun, *oprec* untuk melihat lowongan, *batal* untuk berhenti. " +
  "Akun dibuka di website dengan Google atau 'Lupa kata sandi' memakai e-mail yang sama.\n\n" +
  "Type *daftar* to create an account, *oprec* for open recruitments, *batal* to stop.";

const numbered = (items: readonly string[]) =>
  items.map((item, i) => `${i + 1}. ${item}`).join("\n");
const pick = (text: string, count: number): number | null => {
  const n = Number(text.trim());
  return Number.isInteger(n) && n >= 1 && n <= count ? n - 1 : null;
};
const Email = z.email().max(254);

export function createChatbot(deps: ChatbotDeps) {
  async function step(
    convo: Conversation | null,
    text: string,
  ): Promise<[Conversation | null, string]> {
    const word = text.trim().toLowerCase();
    if (word === "batal") return [null, "Dibatalkan. / Cancelled. Ketik *menu* untuk mulai lagi."];
    if (word === "menu" || word === "halo" || word === "hai") return [null, MENU];
    if (word === "bantuan" || word === "help") return [null, HELP];
    if (word === "daftar") return [{ state: "name", data: {} }, "Nama lengkap? / Your full name?"];
    if (word === "oprec") {
      const open = (await deps.openRecruitments()).slice(0, MAX_OPTIONS);
      if (open.length === 0)
        return [null, "Belum ada lowongan dibuka. / No open recruitments now."];
      return [
        { state: "oprec", data: { ids: open.map((r) => r.id) } },
        `Lowongan dibuka / Open recruitments:\n${numbered(open.map((r) => r.title))}\n\nBalas nomornya. / Reply with the number.`,
      ];
    }
    const data = convo?.data ?? {};
    switch (convo?.state) {
      case "name": {
        const name = text.trim().replace(/\s+/g, " ").slice(0, 120);
        if (name.length < 2) return [convo, "Ketik nama lengkapmu. / Type your full name."];
        return [
          { state: "email", data: { ...data, name } },
          "Alamat e-mail? / Your e-mail address?",
        ];
      }
      case "email": {
        const email = Email.safeParse(text.trim().toLowerCase());
        if (!email.success) return [convo, "E-mail tidak valid. / That is not a valid e-mail."];
        const chapters = (await deps.chapters()).slice(0, MAX_OPTIONS);
        return [
          {
            state: "chapter",
            data: {
              ...data,
              email: email.data,
              chapters: chapters.map((c) => [c.id, c.countryCode]),
            },
          },
          `PPI negara mana? / Which country chapter?\n${numbered(chapters.map((c) => c.name))}`,
        ];
      }
      case "chapter": {
        const chapters = data["chapters"] as Array<[string, string]>;
        const i = pick(text, chapters.length);
        if (i === null) return [convo, "Balas dengan nomor. / Reply with the number."];
        const [chapterId, countryCode] = chapters[i] as [string, string];
        return [
          { state: "campus", data: { ...data, chapterId, countryCode } },
          "Nama kampus? / Your university?",
        ];
      }
      case "campus": {
        const typed = normalizeUniversityName(text);
        const all = await deps.universities(data["countryCode"] as string);
        let found = all.filter((u) => normalizeUniversityName(u.name).includes(typed));
        if (found.length === 0 && deps.matchCampus && all.length > 0) {
          const guess = await deps
            .matchCampus(
              text,
              all.map((u) => u.name),
            )
            .catch((error: unknown) => {
              deps.logError("campus match failed", { error: String(error) });
              return null;
            });
          found = guess === null || !all[guess] ? [] : [all[guess]];
        }
        if (found.length === 0) {
          return [
            convo,
            "Kampus tidak ditemukan; coba nama lain atau singkatannya. / Not found; try another name.",
          ];
        }
        const options = found.slice(0, MAX_OPTIONS);
        return [
          { state: "campusPick", data: { ...data, campuses: options.map((u) => [u.id, u.name]) } },
          `Pilih kampus / Pick your university:\n${numbered(options.map((u) => u.name))}\n\nAtau ketik nama lain. / Or type another name.`,
        ];
      }
      case "campusPick": {
        const campuses = data["campuses"] as Array<[string, string]>;
        const i = pick(text, campuses.length);
        if (i === null) return step({ state: "campus", data }, text);
        const [universityId, universityName] = campuses[i] as [string, string];
        return [
          { state: "confirm", data: { ...data, universityId, universityName } },
          `Benar? / Correct?\n${String(data["name"])}\n${String(data["email"])}\n${universityName}\n\nBalas *ya* atau *batal*. / Reply *ya* or *batal*.`,
        ];
      }
      case "confirm": {
        if (word !== "ya" && word !== "yes") return [convo, "Balas *ya* atau *batal*."];
        const email = data["email"] as string;
        const name = data["name"] as string;
        const uid = await deps.ensureAccount(email, name);
        await deps.recordUser(uid, email, name);
        return [
          null,
          `Akun dibuat untuk ${email}. Masuk di ${deps.webUrl}/login dengan Google, atau pilih "Lupa kata sandi" untuk membuat kata sandi, lalu lengkapi profil (kampus: ${String(data["universityName"])}).\n\n` +
            `Account ready for ${email}. Sign in at ${deps.webUrl}/login with Google or "Forgot password", then complete your profile.`,
        ];
      }
      case "oprec": {
        const ids = data["ids"] as string[];
        const i = pick(text, ids.length);
        if (i === null) return [convo, "Balas dengan nomor. / Reply with the number."];
        return [
          null,
          `Daftar di sini (masuk dulu) / Apply here (sign in first):\n${deps.webUrl}/recruitment/${ids[i] as string}\n\nTes kepribadian ada di halaman lamaran setelah mendaftar. / The personality test is on the application page.`,
        ];
      }
      default:
        return [null, MENU];
    }
  }

  return async function handle(phone: string, text: string): Promise<string> {
    const id = deps.phoneId(phone);
    const now = deps.now();
    const convo = await deps.conversations.get(id, now);
    const [next, reply] = await step(convo, text.slice(0, 500));
    await deps.conversations.save(id, next, new Date(now.getTime() + CONVERSATION_TTL_MS));
    return reply;
  };
}

export function cloudApiReply(
  config: { phoneNumberId: string; token: string } | null,
  fetchImpl: typeof fetch,
) {
  return async (to: string, body: string): Promise<void> => {
    if (!config) throw new Error("whatsapp_cloud_not_configured");
    const response = await fetchImpl(
      `https://graph.facebook.com/v21.0/${config.phoneNumberId}/messages`,
      {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
      },
    );
    if (!response.ok) throw new Error(`whatsapp_cloud_${response.status}`);
  };
}

const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

interface CloudPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          id?: string;
          from?: string;
          type?: string;
          text?: { body?: string };
          interactive?: { list_reply?: { id?: string }; button_reply?: { id?: string } };
        }>;
      };
    }>;
  }>;
}

export function createWhatsappWebhook(deps: {
  readonly verifyToken: string | undefined;
  readonly appSecret: string | undefined;
  readonly record: (provider: string, eventId: string, now: Date) => Promise<boolean>;
  readonly handle: (phone: string, text: string) => Promise<string>;
  readonly send: (to: string, body: string) => Promise<void>;
  readonly logError: (message: string, fields: Record<string, unknown>) => void;
  readonly now: () => Date;
}) {
  return {
    verify(url: URL): Response {
      const q = url.searchParams;
      const ok =
        deps.verifyToken !== undefined &&
        q.get("hub.mode") === "subscribe" &&
        q.get("hub.verify_token") === deps.verifyToken;
      return ok
        ? new Response(q.get("hub.challenge") ?? "", { headers: { "Content-Type": "text/plain" } })
        : reply({ error: "forbidden" }, 403);
    },

    async receive(request: Request): Promise<Response> {
      const bytes = await readBodyLimited(request, 128 * 1024);
      if (!bytes) return reply({ error: "too_large" }, 413);
      const header = request.headers.get("x-hub-signature-256") ?? "";
      const given = Buffer.from(header.replace(/^sha256=/, ""), "hex");
      const expected = createHmac("sha256", deps.appSecret ?? "")
        .update(bytes)
        .digest();
      if (
        !deps.appSecret ||
        !header.startsWith("sha256=") ||
        given.length !== expected.length ||
        !timingSafeEqual(given, expected)
      ) {
        return reply({ error: "unauthenticated" }, 401);
      }
      let payload: CloudPayload;
      try {
        payload = JSON.parse(new TextDecoder().decode(bytes)) as CloudPayload;
      } catch {
        return reply({ error: "invalid_input" }, 400);
      }
      const messages = (payload.entry ?? []).flatMap((e) =>
        (e.changes ?? []).flatMap((c) => c.value?.messages ?? []),
      );
      for (const message of messages) {
        const text =
          message.text?.body ??
          message.interactive?.list_reply?.id ??
          message.interactive?.button_reply?.id;
        if (!message.id || !message.from || text === undefined) continue;
        if (
          !(await deps.record("whatsapp", message.id.replace(/[^A-Za-z0-9_-]/g, "_"), deps.now()))
        )
          continue;
        try {
          await deps.send(message.from, await deps.handle(`+${message.from}`, text));
        } catch (error) {
          deps.logError("chatbot failed", { error: String(error) });
        }
      }
      return reply({ ok: true });
    },
  };
}
