import { describe, expect, it } from "vitest";
import { DICTIONARIES } from "../../apps/web/src/i18n/dictionaries";
import {
  AXES,
  PERSONALITY_ITEMS,
  PersonalityAnswersSchema,
  personalityLinkData,
  personalityLinkUser,
  scorePersonality,
} from "@website/domain/recruitment";

const along = (sign: 1 | -1) => PERSONALITY_ITEMS.map((item) => item.key * 3 * sign);

describe("personality test (C5, PPIDK TesKepribadian)", () => {
  it("has 60 IPIP-adapted items, 12 per axis, interleaved, numbered 1..60, in two languages", () => {
    expect(PERSONALITY_ITEMS).toHaveLength(60);
    for (const axis of AXES) {
      expect(
        PERSONALITY_ITEMS.filter((i) => i.axis === axis),
        axis,
      ).toHaveLength(12);
    }
    expect(PERSONALITY_ITEMS.slice(0, 5).map((i) => i.axis)).toEqual([...AXES]);
    expect(PERSONALITY_ITEMS.map((i) => i.no)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
    expect(PERSONALITY_ITEMS.every((i) => i.id && i.en)).toBe(true);
  });

  it("scores answers along every key as the positive poles, at 100%", () => {
    const score = scorePersonality(along(1));
    expect(score).toMatchObject({ code: "ENFJ", identity: "A", full: "ENFJ-A" });
    for (const axis of AXES) expect(score.axes[axis]).toMatchObject({ pct: 100, lean: 1 });
  });

  it("scores the opposite answers as the negative poles", () => {
    const score = scorePersonality(along(-1));
    expect(score.full).toBe("ISTP-T");
    expect(score.axes.mind).toEqual({ letter: "I", pct: 100, lean: -1 });
  });

  it("leans to the positive pole on a tie, at 50%", () => {
    const score = scorePersonality(PERSONALITY_ITEMS.map(() => 0));
    expect(score.full).toBe("ENFJ-A");
    expect(score.axes.tactics).toEqual({ letter: "J", pct: 50, lean: 0 });
    const answers = PERSONALITY_ITEMS.map(() => 0);
    answers[1] = 3;
    expect(scorePersonality(answers).axes.energy).toEqual({ letter: "N", pct: 54, lean: 0.0833 });
  });

  it("requires all 60 answers between -3 and 3", () => {
    expect(PersonalityAnswersSchema.safeParse(along(1)).success).toBe(true);
    expect(PersonalityAnswersSchema.safeParse(along(1).slice(1)).success).toBe(false);
    expect(PersonalityAnswersSchema.safeParse([...along(1).slice(1), 4]).success).toBe(false);
    expect(PersonalityAnswersSchema.safeParse([...along(1).slice(1), 1.5]).success).toBe(false);
  });

  it("binds the link to its purpose and user", () => {
    expect(personalityLinkUser(personalityLinkData("ari"))).toBe("ari");
    expect(personalityLinkUser({ purpose: "unsubscribe", uid: "ari" })).toBeNull();
    expect(personalityLinkUser({ purpose: "personality" })).toBeNull();
    expect(personalityLinkUser(null)).toBeNull();
  });
});

describe("personality labels on the website", () => {
  it("names and describes all 16 types in both languages", () => {
    const codes = ["E", "I"].flatMap((m) =>
      ["N", "S"].flatMap((e) => ["F", "T"].flatMap((n) => ["J", "P"].map((t) => m + e + n + t))),
    );
    for (const language of ["id", "en"] as const) {
      const types = DICTIONARIES[language].personality.types;
      expect(Object.keys(types).sort()).toEqual([...codes].sort());
      expect(DICTIONARIES[language].personality.scale).toHaveLength(7);
    }
  });
});
