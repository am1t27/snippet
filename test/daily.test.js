import { describe, it, expect, vi } from "vitest";
vi.mock("node-fetch", () => ({ default: vi.fn() }));
import {
  DAILY_EPOCH, DAILY_ROUNDS, DAILY_OPTIONS, DAILY_ROUND_MS,
  dayKey, dailyNumber, buildDailyRounds, scoreDailyAnswer, computeStreak, shareText,
} from "../dailyLogic.js";

describe("day math", () => {
  it("dayKey is the UTC date", () => {
    expect(dayKey(new Date("2026-08-28T23:59:00Z"))).toBe("2026-08-28");
    expect(dayKey(new Date("2026-08-29T00:00:01Z"))).toBe("2026-08-29");
  });
  it("dailyNumber counts from the epoch as #1", () => {
    expect(dailyNumber(DAILY_EPOCH)).toBe(1);
    expect(dailyNumber("2026-09-01")).toBe(7);
  });
});

describe("buildDailyRounds", () => {
  const mkPool = (genre) =>
    Array.from({ length: 16 }, (_, i) => ({
      trackId: `${genre}-${i}`, trackName: `${genre} song ${i}`,
      artistName: `${genre} artist ${i}`, previewUrl: `https://cdn/${genre}/${i}.m4a`,
      releaseYear: 2020, baseTitle: `${genre} song ${i}`,
    }));
  it("builds 5 rounds with 4 distinct options each and no repeated track", async () => {
    const getSongs = vi.fn(async (genre) => mkPool(genre));
    const rounds = await buildDailyRounds({ getSongs });
    expect(rounds).toHaveLength(DAILY_ROUNDS);
    const ids = new Set(rounds.map((r) => r.trackId));
    expect(ids.size).toBe(DAILY_ROUNDS);
    for (const r of rounds) {
      expect(r.options).toHaveLength(DAILY_OPTIONS);
      expect(new Set(r.options).size).toBe(DAILY_OPTIONS);
      expect(r.options).toContain(r.correct);
      expect(r.audioUrl).toBeTruthy();
    }
    // 5 distinct genres requested
    expect(new Set(getSongs.mock.calls.map((c) => c[0])).size).toBe(DAILY_ROUNDS);
  });
  it("skips a genre whose fetch fails and still builds 5", async () => {
    let failed = false;
    const getSongs = vi.fn(async (genre) => {
      if (!failed) { failed = true; throw new Error("thin genre"); }
      return mkPool(genre);
    });
    const rounds = await buildDailyRounds({ getSongs });
    expect(rounds).toHaveLength(DAILY_ROUNDS);
  });
  it("throws when too few genres are buildable", async () => {
    const getSongs = vi.fn(async () => { throw new Error("all thin"); });
    await expect(buildDailyRounds({ getSongs })).rejects.toThrow(/not enough/);
  });
});

describe("scoreDailyAnswer", () => {
  it("scores like the live game: base + speed, plus streak bonus", () => {
    const s = scoreDailyAnswer({ isCorrect: true, elapsedMs: 0, roundIndex: 0, streak: 1 });
    expect(s.questionValue).toBe(300);
    expect(s.speedBonus).toBe(350);
    expect(s.points).toBe(650);
    const s2 = scoreDailyAnswer({ isCorrect: true, elapsedMs: 5000, roundIndex: 2, streak: 3 });
    expect(s2.questionValue).toBe(800);
    expect(s2.speedBonus).toBe(175);
    expect(s2.streakBonus).toBe(100);
    expect(s2.points).toBe(1075);
  });
  it("wrong or late answers score 0", () => {
    expect(scoreDailyAnswer({ isCorrect: false, elapsedMs: 100, roundIndex: 4, streak: 0 }).points).toBe(0);
    expect(scoreDailyAnswer({ isCorrect: true, elapsedMs: DAILY_ROUND_MS + 1, roundIndex: 0, streak: 0 }).points).toBe(0);
  });
});

describe("computeStreak", () => {
  it("counts consecutive days ending today", () => {
    expect(computeStreak(["2026-08-26", "2026-08-27", "2026-08-28"], "2026-08-28")).toBe(3);
  });
  it("yesterday keeps the streak alive (today not yet played)", () => {
    expect(computeStreak(["2026-08-26", "2026-08-27"], "2026-08-28")).toBe(2);
  });
  it("a gap resets", () => {
    expect(computeStreak(["2026-08-25", "2026-08-28"], "2026-08-28")).toBe(1);
    expect(computeStreak([], "2026-08-28")).toBe(0);
  });
});

describe("shareText", () => {
  it("renders glyphs, number, score, no emoji", () => {
    const t = shareText({ number: 12, score: 1450, perRound: [true, true, false, true, true] });
    expect(t).toContain("SNIPPET DAILY #12");
    expect(t).toContain("1450");
    expect(t).toContain("■ ■ □ ■ ■");
    expect(/[\u{1F300}-\u{1FAFF}]/u.test(t)).toBe(false);
  });
});

// ----- Task 2: daily storage (memory fallback; no DATABASE_URL in vitest) -----
import {
  saveDailyPuzzle, getDailyPuzzle, saveDailyResult, getDailyResult,
  getDailyLeaderboard, getDailyRank, getDailyDaysPlayed,
} from "../storage.js";

describe("daily storage (memory fallback)", () => {
  const rounds = [{ trackId: "1", options: ["a", "b"], correct: "a", audioUrl: "u", artistName: "x", trackName: "a" }];
  it("first save wins and re-save returns the frozen puzzle", async () => {
    const won = await saveDailyPuzzle("2099-01-01", rounds);
    expect(won).toEqual(rounds);
    const again = await saveDailyPuzzle("2099-01-01", [{ trackId: "2" }]);
    expect(again).toEqual(rounds); // frozen
    expect(await getDailyPuzzle("2099-01-01")).toEqual(rounds);
    expect(await getDailyPuzzle("2098-12-31")).toBeNull();
  });
  it("one result per (day, sub); leaderboard ranks by score", async () => {
    expect(await saveDailyResult({ day: "2099-01-02", sub: "s1", name: "A", score: 900, answers: [] })).toBe(true);
    expect(await saveDailyResult({ day: "2099-01-02", sub: "s1", name: "A", score: 9999, answers: [] })).toBe(false);
    await saveDailyResult({ day: "2099-01-02", sub: "s2", name: "B", score: 1200, answers: [] });
    const lb = await getDailyLeaderboard("2099-01-02");
    expect(lb[0]).toMatchObject({ name: "B", score: 1200, rank: 1 });
    expect(lb[1]).toMatchObject({ name: "A", score: 900, rank: 2 });
    expect(await getDailyRank("2099-01-02", "s1")).toBe(2);
    expect(await getDailyRank("2099-01-02", "nobody")).toBeNull();
    expect((await getDailyResult("2099-01-02", "s1")).score).toBe(900);
    expect(await getDailyResult("2099-01-02", "zz")).toBeNull();
    expect(await getDailyDaysPlayed("s1")).toContain("2099-01-02");
  });
});
