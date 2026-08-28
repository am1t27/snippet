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
  applyLives,
  placementFor,
  livesFor,
  minPlayersFor,
  knockoutMaxRounds,
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

describe("applyLives (LIVES rule and Sweep)", () => {
  const e = (id, correct, elapsedMs, score = 0, joinIndex = 0) =>
    ({ id, correct, elapsedMs, score, joinIndex });
  const lives = (pairs) => new Map(pairs);

  it("takes one life from every player who was wrong or absent", () => {
    const out = applyLives(
      [e("a", true, 1000), e("b", false, 2000), e("c", false, null)],
      lives([["a", 3], ["b", 3], ["c", 2]])
    );
    expect(out.lost.sort()).toEqual(["b", "c"]);
    expect(out.lives.get("a")).toBe(3);
    expect(out.lives.get("b")).toBe(2);
    expect(out.lives.get("c")).toBe(1);
    expect(out.swept).toBe(false);
  });

  it("Sweep: a clean round costs the slowest correct player a life", () => {
    const out = applyLives(
      [e("a", true, 1000), e("b", true, 2000), e("c", true, 9000)],
      lives([["a", 3], ["b", 3], ["c", 3]])
    );
    expect(out.swept).toBe(true);
    expect(out.lost).toEqual(["c"]);
    expect(out.lives.get("c")).toBe(2);
    expect(out.lives.get("a")).toBe(3);
  });

  it("Sweep fires at two alive players, which is the old final-two case", () => {
    const out = applyLives([e("a", true, 1000), e("b", true, 1001)], lives([["a", 4], ["b", 4]]));
    expect(out.swept).toBe(true);
    expect(out.lost).toEqual(["b"]);
  });

  it("Sweep fires at four alive players too", () => {
    const out = applyLives(
      [e("a", true, 10), e("b", true, 20), e("c", true, 30), e("d", true, 40)],
      lives([["a", 3], ["b", 3], ["c", 3], ["d", 3]])
    );
    expect(out.swept).toBe(true);
    expect(out.lost).toEqual(["d"]);
  });

  it("Sweep stays dormant when anyone was wrong", () => {
    const out = applyLives([e("a", true, 1000), e("b", false, 2000)], lives([["a", 3], ["b", 3]]));
    expect(out.swept).toBe(false);
    expect(out.lost).toEqual(["b"]);
    expect(out.lives.get("a")).toBe(3);
  });

  it("Sweep stays dormant when a held player misses the round", () => {
    // A player inside the rejoin grace window scores as no-answer, so the
    // round is not a clean sweep and a network blip never triggers Sweep.
    const out = applyLives([e("a", true, 1000), e("held", false, null)], lives([["a", 3], ["held", 3]]));
    expect(out.swept).toBe(false);
    expect(out.lost).toEqual(["held"]);
  });

  it("never drops a life below zero", () => {
    const out = applyLives([e("a", false, null)], lives([["a", 0]]));
    expect(out.lives.get("a")).toBe(0);
  });

  it("does not mutate the input map", () => {
    const before = lives([["a", 3]]);
    applyLives([e("a", false, 100)], before);
    expect(before.get("a")).toBe(3);
  });

  it("every round costs at least one life, which is what bounds the match", () => {
    // Termination proof in miniature: no round can leave the board unchanged.
    for (const entries of [
      [e("a", true, 1), e("b", true, 2)],
      [e("a", false, 1), e("b", true, 2)],
      [e("a", false, null), e("b", false, null)],
    ]) {
      const out = applyLives(entries, lives([["a", 3], ["b", 3]]));
      expect(out.lost.length).toBeGreaterThan(0);
    }
  });

  it("handles an empty round without throwing", () => {
    const out = applyLives([], lives([]));
    expect(out.lost).toEqual([]);
    expect(out.swept).toBe(false);
  });
});

describe("placementFor", () => {
  it("gives the first player eliminated of eight the last place", () => {
    expect(placementFor(8, 0, [{ id: "a", score: 100 }])).toEqual([{ id: "a", placement: 8 }]);
  });

  it("counts placements down as the field thins", () => {
    expect(placementFor(8, 1, [{ id: "b", score: 100 }])).toEqual([{ id: "b", placement: 7 }]);
    expect(placementFor(8, 6, [{ id: "g", score: 100 }])).toEqual([{ id: "g", placement: 2 }]);
  });

  it("orders a simultaneous batch by score, higher score placing better", () => {
    expect(
      placementFor(8, 5, [{ id: "low", score: 100 }, { id: "high", score: 900 }])
    ).toEqual([{ id: "high", placement: 2 }, { id: "low", placement: 3 }]);
  });

  it("awards 1st to the highest score when everyone left goes out together", () => {
    // No draw state: the last two both hit zero, score separates them.
    expect(
      placementFor(8, 6, [{ id: "loser", score: 400 }, { id: "winner", score: 800 }])
    ).toEqual([{ id: "winner", placement: 1 }, { id: "loser", placement: 2 }]);
  });

  it("gives the sole survivor first place", () => {
    expect(placementFor(3, 2, [{ id: "champ", score: 50 }])).toEqual([{ id: "champ", placement: 1 }]);
  });

  it("handles an empty batch", () => {
    expect(placementFor(8, 0, [])).toEqual([]);
  });
});

describe("knockout sizing and scoring helpers", () => {
  const ko = (knockout) => sanitizeSettings({ format: "KNOCKOUT", knockout });

  it("gives a duel more lives than a crowd", () => {
    expect(livesFor(2)).toBe(4);
    expect(livesFor(3)).toBe(3);
    expect(livesFor(8)).toBe(3);
  });

  it("requires three players for SLOWEST and two for LIVES", () => {
    // A 2-player SLOWEST match would end after a single round.
    expect(minPlayersFor(ko("SLOWEST"))).toBe(3);
    expect(minPlayersFor(ko("LIVES"))).toBe(2);
    expect(minPlayersFor(sanitizeSettings({ format: "CLASSIC" }))).toBe(1);
  });

  it("bounds SLOWEST at one elimination per round", () => {
    expect(knockoutMaxRounds(ko("SLOWEST"), 8)).toBe(7);
    expect(knockoutMaxRounds(ko("SLOWEST"), 3)).toBe(2);
  });

  it("bounds LIVES by the lives on the board", () => {
    // 8 players * 3 lives - 1: every round costs a life, survivor ends on one.
    expect(knockoutMaxRounds(ko("LIVES"), 8)).toBe(23);
    // A duel: 2 players * 4 lives - 1.
    expect(knockoutMaxRounds(ko("LIVES"), 2)).toBe(7);
  });

  it("returns no bound under CLASSIC", () => {
    expect(knockoutMaxRounds(sanitizeSettings({ format: "CLASSIC" }), 8)).toBe(null);
  });

  it("sizes the pool from the knockout bound, not settings.rounds", () => {
    const s = ko("LIVES");
    // Worst case 23 rounds + 4 options + 6 headroom, under the 60 ceiling.
    expect(poolSizeFor(s, 8)).toBe(33);
    // CLASSIC is unchanged by the new parameter.
    const classic = sanitizeSettings({ format: "CLASSIC" });
    expect(poolSizeFor(classic)).toBe(poolSizeFor(classic, 8));
  });

  it("plateaus the knockout question value after round 10", () => {
    // Identical to classic through round 10 (roundIndex 9).
    for (const i of [0, 5, 9]) {
      expect(questionValueFor(i, "KNOCKOUT")).toBe(questionValueFor(i));
    }
    // Flat at 2550 from round 11 onward, so a long match cannot print XP.
    expect(questionValueFor(9, "KNOCKOUT")).toBe(2550);
    expect(questionValueFor(10, "KNOCKOUT")).toBe(2550);
    expect(questionValueFor(22, "KNOCKOUT")).toBe(2550);
  });

  it("leaves classic scoring untouched at every round", () => {
    expect(questionValueFor(0)).toBe(300);
    expect(questionValueFor(22)).toBe(300 + 22 * 250);
  });
});
