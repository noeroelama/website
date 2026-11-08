import { z } from "zod";

export const AXES = ["mind", "energy", "nature", "tactics", "identity"] as const;
export type Axis = (typeof AXES)[number];

export const AXIS_POLES = {
  mind: { pos: "E", neg: "I" },
  energy: { pos: "N", neg: "S" },
  nature: { pos: "F", neg: "T" },
  tactics: { pos: "J", neg: "P" },
  identity: { pos: "A", neg: "T" },
} as const satisfies Record<Axis, { pos: string; neg: string }>;

const CODE_ORDER = ["mind", "energy", "nature", "tactics"] as const;

type Item = readonly [id: string, en: string, key: 1 | -1];

const RAW: Record<Axis, readonly Item[]> = {
  mind: [
    ["Saya adalah sumber keramaian dalam sebuah pesta.", "I am the life of the party.", 1],
    ["Saya tidak banyak bicara.", "I don't talk a lot.", -1],
    ["Saya merasa nyaman berada di antara banyak orang.", "I feel comfortable around people.", 1],
    ["Saya cenderung berada di belakang layar.", "I keep in the background.", -1],
    ["Saya mudah memulai percakapan.", "I start conversations.", 1],
    ["Saya tidak punya banyak hal untuk dibicarakan.", "I have little to say.", -1],
    [
      "Di keramaian, saya mengobrol dengan banyak orang berbeda.",
      "I talk to a lot of different people at parties.",
      1,
    ],
    [
      "Saya tidak suka menarik perhatian ke diri sendiri.",
      "I don't like to draw attention to myself.",
      -1,
    ],
    [
      "Saya tidak keberatan menjadi pusat perhatian.",
      "I don't mind being the center of attention.",
      1,
    ],
    [
      "Saya cenderung pendiam di antara orang yang belum dikenal.",
      "I am quiet around strangers.",
      -1,
    ],
    ["Saya cepat akrab dengan orang lain.", "I make friends easily.", 1],
    ["Saya merasa sulit mendekati orang baru.", "I find it difficult to approach others.", -1],
  ],
  energy: [
    ["Saya punya perbendaharaan kata yang kaya.", "I have a rich vocabulary.", 1],
    [
      "Saya sulit memahami gagasan yang abstrak.",
      "I have difficulty understanding abstract ideas.",
      -1,
    ],
    ["Saya punya imajinasi yang hidup.", "I have a vivid imagination.", 1],
    ["Saya kurang tertarik pada ide-ide abstrak.", "I am not interested in abstract ideas.", -1],
    ["Saya sering punya ide-ide yang bagus.", "I have excellent ideas.", 1],
    ["Saya merasa imajinasi saya tidak begitu baik.", "I do not have a good imagination.", -1],
    ["Saya cepat memahami berbagai hal.", "I am quick to understand things.", 1],
    [
      "Saya senang merenungkan berbagai hal secara mendalam.",
      "I spend time reflecting on things.",
      1,
    ],
    ["Kepala saya penuh dengan ide.", "I am full of ideas.", 1],
    [
      "Saya suka memikirkan cara-cara baru dalam melakukan sesuatu.",
      "I like to think of new ways to do things.",
      1,
    ],
    ["Saya menghindari bacaan yang sulit.", "I avoid difficult reading material.", -1],
    [
      "Saya jarang menyelami sebuah topik secara mendalam.",
      "I rarely look for a deeper meaning in things.",
      -1,
    ],
  ],
  nature: [
    ["Saya kurang peduli pada orang lain.", "I feel little concern for others.", -1],
    ["Saya tertarik pada orang lain.", "I am interested in people.", 1],
    ["Saya kadang melontarkan kata-kata yang menyakiti orang.", "I insult people.", -1],
    ["Saya ikut merasakan perasaan orang lain.", "I sympathize with others' feelings.", 1],
    [
      "Saya kurang tertarik pada masalah orang lain.",
      "I am not interested in other people's problems.",
      -1,
    ],
    ["Saya punya hati yang lembut.", "I have a soft heart.", 1],
    [
      "Saya sebenarnya tidak begitu peduli pada orang lain.",
      "I am not really interested in others.",
      -1,
    ],
    ["Saya menyediakan waktu untuk orang lain.", "I take time out for others.", 1],
    ["Saya bisa merasakan emosi orang di sekitar saya.", "I feel others' emotions.", 1],
    ["Saya membuat orang lain merasa nyaman.", "I make people feel at ease.", 1],
    ["Saya cenderung memercayai perkataan orang.", "I trust what people say.", 1],
    [
      "Saya curiga ada maksud tersembunyi di balik tindakan orang lain.",
      "I suspect hidden motives in others.",
      -1,
    ],
  ],
  tactics: [
    ["Saya selalu siap.", "I am always prepared.", 1],
    ["Saya sering meninggalkan barang-barang berserakan.", "I leave my belongings around.", -1],
    ["Saya memperhatikan detail.", "I pay attention to details.", 1],
    ["Saya sering membuat berantakan.", "I make a mess of things.", -1],
    ["Saya langsung menyelesaikan tugas-tugas rutin.", "I get chores done right away.", 1],
    [
      "Saya sering lupa mengembalikan barang ke tempatnya.",
      "I often forget to put things back in their proper place.",
      -1,
    ],
    ["Saya menyukai keteraturan.", "I like order.", 1],
    ["Saya cenderung mengelak dari kewajiban.", "I shirk my duties.", -1],
    ["Saya mengikuti jadwal.", "I follow a schedule.", 1],
    ["Saya teliti dalam pekerjaan saya.", "I am exacting in my work.", 1],
    ["Saya menjalankan rencana yang sudah saya buat.", "I carry out my plans.", 1],
    ["Saya sering membuang-buang waktu.", "I waste my time.", -1],
  ],
  identity: [
    ["Saya mudah merasa stres.", "I get stressed out easily.", -1],
    ["Saya santai hampir sepanjang waktu.", "I am relaxed most of the time.", 1],
    ["Saya sering mengkhawatirkan banyak hal.", "I worry about things.", -1],
    ["Saya jarang merasa murung.", "I seldom feel blue.", 1],
    ["Saya mudah terganggu.", "I am easily disturbed.", -1],
    ["Saya mudah kesal.", "I get upset easily.", -1],
    ["Suasana hati saya sering berubah-ubah.", "I change my mood a lot.", -1],
    [
      "Saya sering mengalami perubahan suasana hati yang tiba-tiba.",
      "I have frequent mood swings.",
      -1,
    ],
    ["Saya mudah tersinggung.", "I get irritated easily.", -1],
    ["Saya sering merasa sedih tanpa sebab yang jelas.", "I often feel blue.", -1],
    ["Saya tetap tenang di bawah tekanan.", "I remain calm under pressure.", 1],
    ["Saya mudah panik.", "I panic easily.", -1],
  ],
};

export const ITEMS_PER_AXIS = 12;

export interface PersonalityItem {
  readonly no: number;
  readonly id: string;
  readonly en: string;
  readonly axis: Axis;
  readonly key: 1 | -1;
}

export const PERSONALITY_ITEMS: readonly PersonalityItem[] = Array.from(
  { length: ITEMS_PER_AXIS },
  (_, i) =>
    AXES.map((axis) => {
      const [id, en, key] = RAW[axis][i] as Item;
      return { id, en, axis, key };
    }),
)
  .flat()
  .map((item, i) => ({ ...item, no: i + 1 }));

export const PersonalityAnswersSchema = z
  .array(z.number().int().min(-3).max(3))
  .length(PERSONALITY_ITEMS.length, "Answer every statement.");

export interface AxisScore {
  readonly letter: string;
  readonly pct: number;
  readonly lean: number;
}

export interface PersonalityScore {
  readonly code: string;
  readonly identity: string;
  readonly full: string;
  readonly axes: Readonly<Record<Axis, AxisScore>>;
}

export function scorePersonality(answers: readonly number[]): PersonalityScore {
  const sums: Record<Axis, number> = { mind: 0, energy: 0, nature: 0, tactics: 0, identity: 0 };
  PERSONALITY_ITEMS.forEach((item, i) => {
    sums[item.axis] += item.key * (answers[i] as number);
  });
  const max = ITEMS_PER_AXIS * 3;
  const axes = Object.fromEntries(
    AXES.map((axis) => {
      const lean = sums[axis] / max;
      const { pos, neg } = AXIS_POLES[axis];
      return [
        axis,
        {
          letter: lean >= 0 ? pos : neg,
          pct: Math.round(50 + Math.abs(lean) * 50),
          lean: Math.round(lean * 10_000) / 10_000,
        },
      ];
    }),
  ) as Record<Axis, AxisScore>;
  const code = CODE_ORDER.map((axis) => axes[axis].letter).join("");
  return { code, identity: axes.identity.letter, full: `${code}-${axes.identity.letter}`, axes };
}

export const PERSONALITY_LINK_DAYS = 7;
export const personalityLinkData = (uid: string) => ({ purpose: "personality", uid });
export function personalityLinkUser(data: Readonly<Record<string, string>> | null): string | null {
  return data?.["purpose"] === "personality" && data["uid"] ? data["uid"] : null;
}
