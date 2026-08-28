import { describe, it, expect } from "vitest";
import {
  sanitizeSettings,
  poolSizeFor,
  buildRound,
  cleanName,
  questionValueFor,
  speedBonusFor,
  streakBonusFor,
  DEFAULT_SETTINGS,
  MAX_SPEED_BONUS,
  rankRoundResults,
  pickEliminated,
} from "../gameLogic.js";

const POOL = [
  { trackId: 1, trackName: "Alpha", artistName: "Ann", previewUrl: "u1" },
  { trackId: 2, trackName: "Bravo", artistName: "Ben", previewUrl: "u2" },
  { trackId: 3, trackName: "Charlie", artistName: "Cara", previewUrl: "u3" },
  { trackId: 4, trackName: "Delta", artistName: "Dee", previewUrl: "u4" },
  { trackId: 5, trackName: "Echo", artistName: "Eli", previewUrl: "u5" },
  { trackId: 6, trackName: "Foxtrot", artistName: "Fae", previewUrl: "u6" },
  { trackId: 7, trackName: "Golf", artistName: "Gus", previewUrl: "u7" },
];

describe("sanitizeSettings", () => {
  it("accepts valid values", () => {
    expect(
      sanitizeSettings({ rounds: 15, roundMs: 7500, optionsCount: 6, mode: "artist", decade: "2010s", clip: "intro", genre: "bollywood" })
    ).toEqual({
      rounds: 15,
      roundMs: 7500,
      optionsCount: 6,
      mode: "ARTIST",
      decade: "2010s",
      clip: "INTRO",
      genre: "bollywood",
      format: "CLASSIC",
      knockout: "SLOWEST",
    });
    // "rap" is no longer its own family — it clamps to the hip-hop default.
    expect(sanitizeSettings({ genre: "rap" }).genre).toBe("hip-hop");
  });

  it("accepts and uppercases knockout settings", () => {
    const s = sanitizeSettings({ format: "knockout", knockout: "lives" });
    expect(s.format).toBe("KNOCKOUT");
    expect(s.knockout).toBe("LIVES");
  });

  it("defaults knockout settings and clamps junk values", () => {
    expect(sanitizeSettings({}).format).toBe("CLASSIC");
    expect(sanitizeSettings({}).knockout).toBe("SLOWEST");
    expect(sanitizeSettings({ format: "battle" }).format).toBe("CLASSIC");
    expect(sanitizeSettings({ knockout: "sudden" }).knockout).toBe("SLOWEST");
  });

  it("keeps knockout rule populated even under CLASSIC", () => {
    // Fixed object shape: the rule is always present, just unused in CLASSIC.
    expect(sanitizeSettings({ format: "CLASSIC", knockout: "LIVES" })).toHaveProperty("knockout", "LIVES");
  });

  it("clamps every off-list / hostile field back to the default", () => {
    expect(sanitizeSettings({ rounds: 999, roundMs: 1, optionsCount: 100, mode: "x", decade: "1800s", genre: "polka" })).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings("evil")).toEqual(DEFAULT_SETTINGS);
  });
});

describe("poolSizeFor", () => {
  it("scales with rounds + options but stays bounded [16, 60]", () => {
    expect(poolSizeFor({ rounds: 5, optionsCount: 4 })).toBe(16);
    expect(poolSizeFor({ rounds: 15, optionsCount: 6 })).toBe(27);
    expect(poolSizeFor({ rounds: 100, optionsCount: 6 })).toBe(60);
  });
});

describe("buildRound", () => {
  it("TITLE mode: optionsCount distinct titles including the answer", () => {
    for (let i = 0; i < 50; i++) {
      const r = buildRound(POOL, new Set(), { optionsCount: 4, mode: "TITLE" });
      expect(r.options).toHaveLength(4);
      expect(r.options).toContain(r.correct);
      expect(new Set(r.options).size).toBe(4); // no duplicate options
      expect(r.correct).toBe(r.trackName);
    }
  });

  it("ARTIST mode: options are artist names and the answer is the artist", () => {
    for (let i = 0; i < 50; i++) {
      const r = buildRound(POOL, new Set(), { optionsCount: 4, mode: "ARTIST" });
      expect(r.options).toContain(r.artistName);
      expect(r.correct).toBe(r.artistName);
      expect(new Set(r.options).size).toBe(4);
    }
  });

  it("prefers unused tracks for the correct answer", () => {
    const used = new Set([1, 2, 3, 4, 5, 6]); // only track 7 unused
    const r = buildRound(POOL, used, { optionsCount: 4, mode: "TITLE" });
    expect(r.trackId).toBe(7);
  });

  it("supports 6 options when the pool is large enough", () => {
    const r = buildRound(POOL, new Set(), { optionsCount: 6, mode: "TITLE" });
    expect(r.options).toHaveLength(6);
    expect(new Set(r.options).size).toBe(6);
  });
});

describe("scoring", () => {
  it("questionValue grows by step per round", () => {
    expect(questionValueFor(0)).toBe(300);
    expect(questionValueFor(9)).toBe(300 + 9 * 250);
  });

  it("speed bonus is max at t=0 and zero at/after the deadline", () => {
    expect(speedBonusFor(0, 10000)).toBe(MAX_SPEED_BONUS);
    expect(speedBonusFor(10000, 10000)).toBe(0);
    expect(speedBonusFor(99999, 10000)).toBe(0);
    expect(speedBonusFor(5000, 10000)).toBe(Math.round(MAX_SPEED_BONUS * 0.5));
  });

  it("streak bonus tiers", () => {
    expect(streakBonusFor(1)).toBe(0);
    expect(streakBonusFor(2)).toBe(50);
    expect(streakBonusFor(3)).toBe(100);
    expect(streakBonusFor(4)).toBe(200);
    expect(streakBonusFor(9)).toBe(200);
  });
});

describe("cleanName", () => {
  it("strips disallowed characters and trims length", () => {
    expect(cleanName("  good_name-1  ")).toBe("good_name-1");
    expect(cleanName("a".repeat(40)).length).toBe(20);
    expect(cleanName("dr🤖op<>")).toBe("drop");
  });
  it("masks profane handles", () => {
    expect(cleanName("fuck")).toBe("****");
  });
});

describe("rankRoundResults / pickEliminated", () => {
  // Helper: keeps the tests readable. joinIndex defaults ascending.
  const e = (id, correct, elapsedMs, score = 0, joinIndex = 0) =>
    ({ id, correct, elapsedMs, score, joinIndex });

  it("ranks correct answers first, fastest to slowest", () => {
    const ranked = rankRoundResults([
      e("slow", true, 8000),
      e("fast", true, 1000),
      e("mid", true, 4000),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["fast", "mid", "slow"]);
  });

  it("ranks every correct answer above every wrong one", () => {
    const ranked = rankRoundResults([e("wrong", false, 100), e("correct", true, 9000)]);
    expect(ranked.map((r) => r.id)).toEqual(["correct", "wrong"]);
  });

  it("ranks a missing answer below a wrong one", () => {
    const ranked = rankRoundResults([e("absent", false, null), e("wrong", false, 9000)]);
    expect(ranked.map((r) => r.id)).toEqual(["wrong", "absent"]);
  });

  it("does not reward answering wrong quickly", () => {
    // Both wrong: speed is irrelevant, score breaks the tie.
    const ranked = rankRoundResults([
      e("fastWrong", false, 100, 500),
      e("slowWrong", false, 9000, 900),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["slowWrong", "fastWrong"]);
  });

  it("breaks ties by higher score, then by earlier join order", () => {
    const ranked = rankRoundResults([
      e("late", false, null, 100, 5),
      e("early", false, null, 100, 1),
      e("rich", false, null, 999, 9),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["rich", "early", "late"]);
  });

  it("does not mutate its input", () => {
    const input = [e("b", true, 5000), e("a", true, 1000)];
    const copy = input.slice();
    rankRoundResults(input);
    expect(input).toEqual(copy);
  });

  it("eliminates the last-ranked player", () => {
    expect(pickEliminated([e("a", true, 1000), e("b", false, 2000)])).toBe("b");
  });

  it("eliminates the slowest player even when everyone was correct", () => {
    // The signature moment of SLOWEST: right answer, still knocked out.
    expect(
      pickEliminated([e("a", true, 1000), e("b", true, 2000), e("c", true, 9000)])
    ).toBe("c");
  });

  it("returns null for an empty round", () => {
    expect(pickEliminated([])).toBe(null);
  });
});
