import { describe, it, expect } from "vitest";
import { xpForScore, xpToNext, levelForXp, rankForLevel, progressWithin, awardFor, RANKS } from "../xpLogic.js";

describe("xp curve", () => {
  it("score converts at 10:1, never negative", () => {
    expect(xpForScore(3250)).toBe(325);
    expect(xpForScore(0)).toBe(0);
    expect(xpForScore(-50)).toBe(0);
    expect(xpForScore(undefined)).toBe(0);
  });
  it("level costs grow: 100, then ~283, ~520", () => {
    expect(xpToNext(1)).toBe(100);
    expect(xpToNext(2)).toBe(283);
    expect(xpToNext(3)).toBe(520);
  });
  it("levelForXp walks the cumulative curve", () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(99)).toBe(1);
    expect(levelForXp(100)).toBe(2);
    expect(levelForXp(100 + 283)).toBe(3);
  });
  it("ranks step every 5 levels and cap at LEGEND", () => {
    expect(rankForLevel(1)).toBe("CADET");
    expect(rankForLevel(5)).toBe("CADET");
    expect(rankForLevel(6)).toBe("BUSKER");
    expect(rankForLevel(31)).toBe("LEGEND");
    expect(rankForLevel(99)).toBe("LEGEND");
    expect(RANKS).toHaveLength(7);
  });
  it("progressWithin exposes bar math", () => {
    const p = progressWithin(150);
    expect(p).toMatchObject({ level: 2, rank: "CADET", into: 50, needed: 283 });
  });
  it("awardFor detects a level-up across the boundary", () => {
    const a = awardFor(90, 200); // 90 + 20 -> 110 xp, level 2
    expect(a).toMatchObject({ gained: 20, total: 110, level: 2, leveledUp: true });
    const b = awardFor(0, 500); // 50 xp, still level 1
    expect(b.leveledUp).toBe(false);
  });
});
